// Measure the ranking against known-item queries, and try other weights without touching the app.
//   node tools/eval.mjs                 score the shipped WEIGHTS and TUNING on the saved pools
//   node tools/eval.mjs --tune          grid search on the training half, then score the held-out half
//   node tools/eval.mjs --misses        also list the queries whose target is not in the first three
//   node tools/eval.mjs --capture       ask the live sources and save the pools (slow: one query per 7 s)
//   node tools/eval.mjs --capture --retry-failed   ask again only the sources that failed (one query per 20 s)
//   node tools/eval.mjs --capture --retry-failed --skip=stackexchange   leave a source that is still refusing alone
//   node tools/eval.mjs --capture --refresh=github,govuk   ask the named sources and any newly planned ones again
//   node tools/eval.mjs --queries=queries2.json --pools=pools2.json   use the second, blind query set
//   node tools/eval.mjs --pace=13000    milliseconds between captured queries
//   node tools/eval.mjs --half=train    print the training half only (keeps the held-out half unseen)
// Behind a proxy: set NODE_USE_ENV_PROXY=1 and HTTPS_PROXY.
//
// What this is not: the targets in tests/eval/queries.json were written by an AI model, one per query.
// It measures "does the page a person meant come first", not general relevance, and not Google.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { search } from "../js/engine.js";
import { parseQuery } from "../js/query.js";
import { rank, TUNING, WEIGHTS } from "../js/rank.js";
import { planSources } from "../js/sources.js";
import { fixtureNameOf } from "./fixture-names.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const valueOf = (name) => (args.find((arg) => arg.startsWith(`--${name}=`)) ?? "").slice(name.length + 3);
const listOf = (name) => new Set(valueOf(name).split(",").filter(Boolean));
const evalFile = (name, fallback) => path.resolve(path.join(here, "..", "tests", "eval"), valueOf(name) || fallback);
const queriesFile = evalFile("queries", "queries.json");
const poolsFile = evalFile("pools", "pools.json");
const RETRY_FAILED = args.includes("--retry-failed");
const SKIP = listOf("skip");
const REFRESH = listOf("refresh");
const PACE_MS = Number(valueOf("pace")) || (RETRY_FAILED ? 20000 : 7000);
const ORIGIN = {
  Origin: "https://juw12.github.io",
  // Says what it is, as the Wikimedia User-Agent policy asks of scripts.
  "User-Agent": "TelisikCheck/1.0 (https://github.com/juw12/telisik; search quality check, a few requests a minute)",
  Accept: "application/json",
};

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (fallback !== undefined && error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

/** Half of the queries tune the numbers, the other half only judge them. The hash decides, not a person. */
export function splitOf(query) {
  return createHash("sha256").update(query).digest()[0] % 2 === 0 ? "train" : "test";
}

function plainUrl(url) {
  let text = String(url ?? "").toLowerCase();
  try {
    text = decodeURIComponent(text);
  } catch {
    // keep the raw address
  }
  return text.replace(/^https?:\/\/(www\.)?/, "");
}

export function isHit(doc, target) {
  const addresses = [doc.url, doc.links?.article].filter(Boolean).map(plainUrl);
  for (const wanted of target.url ?? []) {
    const at = addresses.find((address) => address.includes(wanted));
    // "wiki/transistor" must not accept "wiki/transistor_count".
    if (at !== undefined && /^([/?#].*)?$/.test(at.slice(at.indexOf(wanted) + wanted.length))) {
      return true;
    }
  }
  return Boolean(target.title && new RegExp(target.title, "i").test(doc.title ?? ""));
}

/** A fallback host answers for the source it stands in for. */
const STANDS_IN_FOR = { gitlab: "github", crossref: "openalex" };

function sourceOfRequest(url) {
  const name = fixtureNameOf(String(url));
  return STANDS_IN_FOR[name] ?? name;
}

const idOf = (failure) => failure.split(":")[0];

/** A source answered in full: it answered, and its second request (when it makes one) did not fail. */
const isFull = (status) => ["ok", "empty"].includes(status?.state) && !status.partial;

function failuresOf(state) {
  return Object.entries(state.status)
    .filter(([, status]) => !isFull(status))
    .map(([id, status]) => `${id}:${status.partial ? `partial-${status.partial}` : status.state}`);
}

/**
 * A retry asks only the sources that failed last time and keeps the rest as it was saved, so a
 * source that answered once is never lost because it refuses today.
 */
export function mergeRetry(before, state, retried) {
  const answered = (id) => retried.has(id) && isFull(state.status[id]);
  const docs = before.planned.flatMap((id) =>
    (answered(id) ? state.pool : before.docs).filter((doc) => doc.source === id),
  );
  return { planned: before.planned, failed: before.failed.filter((failure) => !answered(idOf(failure))), docs };
}

/**
 * A refresh asks the named sources again, and any source the current code plans that the saved
 * pool never asked. Everything else stays as saved. A source that answers replaces its old
 * documents (and those of its stand-in); a source that fails keeps what it had.
 */
export function mergeRefresh(before, state, asked) {
  const ownerOf = (doc) => STANDS_IN_FOR[doc.source] ?? doc.source;
  // An answer given by a stand-in host (GitLab for GitHub) does not count as the source answering.
  const stoodIn = (id) => state.pool.some((doc) => doc.source !== id && ownerOf(doc) === id);
  const answered = new Set(
    [...asked].filter((id) => isFull(state.status[id]) && !stoodIn(id)),
  );
  const docs = [
    ...before.docs.filter((doc) => !answered.has(ownerOf(doc))),
    ...state.pool.filter((doc) => answered.has(ownerOf(doc)) && doc.source === ownerOf(doc)),
  ];
  const failed = [
    ...before.failed.filter((failure) => !answered.has(idOf(failure))),
    ...failuresOf(state).filter(
      (failure) => asked.has(idOf(failure)) && !before.failed.some((old) => idOf(old) === idOf(failure)),
    ),
  ];
  return { planned: state.planned, failed, docs };
}

async function capture(queries) {
  const saved = await readJson(poolsFile, { capturedAt: null, pools: {} });
  const refused = () => Promise.reject(new Error("not asked"));
  const fetchWithOrigin = (url, init) =>
    SKIP.has(sourceOfRequest(url)) ? refused() : fetch(url, { ...init, headers: ORIGIN });
  const options = { lens: "all", timeoutMs: 20000, keepPool: true };
  for (const [index, entry] of queries.entries()) {
    const before = saved.pools[entry.q];
    const label = `${index + 1}/${queries.length} "${entry.q}"`;
    const started = Date.now();
    let pool;
    if (!before || args.includes("--force")) {
      const state = await search(entry.q, { ...options, fetch: fetchWithOrigin });
      pool = { planned: state.planned, failed: failuresOf(state), docs: state.pool };
    } else if (REFRESH.size) {
      const planned = planSources(parseQuery(entry.q), "all");
      const asked = new Set(
        planned.filter((id) => (REFRESH.has(id) || !before.planned.includes(id)) && !SKIP.has(id)),
      );
      const onlyAsked = (url, init) => (asked.has(sourceOfRequest(url)) ? fetchWithOrigin(url, init) : refused());
      pool = mergeRefresh(before, await search(entry.q, { ...options, fetch: onlyAsked }), asked);
      saved.pools[entry.q] = pool;
      saved.capturedAt = new Date().toISOString().slice(0, 10);
      await writeFile(poolsFile, JSON.stringify(saved) + "\n", "utf8");
      console.log(
        `${label}: asked ${[...asked].join(", ") || "nothing"}; ${pool.docs.length} documents` +
          (pool.failed.length ? ` (failed ${pool.failed.join(", ")})` : ""),
      );
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, PACE_MS - (Date.now() - started))));
      continue;
    } else {
      const retried = new Set(RETRY_FAILED ? before.failed.map(idOf).filter((id) => !SKIP.has(id)) : []);
      if (!retried.size) {
        continue;
      }
      const onlyRetried = (url, init) =>
        retried.has(sourceOfRequest(url)) ? fetchWithOrigin(url, init) : Promise.reject(new Error("not asked again"));
      pool = mergeRetry(before, await search(entry.q, { ...options, fetch: onlyRetried }), retried);
    }
    if (before && pool.failed.length === before.failed.length) {
      console.log(`${label}: ${[...pool.failed].join(", ")} still failing, kept the saved pool`);
    } else {
      saved.pools[entry.q] = pool;
      saved.capturedAt = new Date().toISOString().slice(0, 10);
      await writeFile(poolsFile, JSON.stringify(saved) + "\n", "utf8");
      console.log(
        `${label}: ${pool.docs.length} documents from ` +
          `${pool.planned.length - pool.failed.length}/${pool.planned.length} sources` +
          (pool.failed.length ? ` (failed ${pool.failed.join(", ")})` : ""),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, PACE_MS - (Date.now() - started))));
  }
}

/** Position of the first hit (1 = first), or 0 when the target is not in the ranked list. */
function positionOf(entry, pool, settings) {
  const ranked = rank(pool.docs, parseQuery(entry.q), { lens: "all", now: Date.parse("2026-11-14"), ...settings });
  return ranked.findIndex((doc) => isHit(doc, entry)) + 1;
}

export function score(entries, pools, settings = {}) {
  const totals = { queries: 0, inPool: 0, mrr: 0, at1: 0, at3: 0, at10: 0 };
  const misses = [];
  for (const entry of entries) {
    const pool = pools[entry.q];
    if (!pool) {
      continue;
    }
    totals.queries += 1;
    if (pool.docs.some((doc) => isHit(doc, entry))) {
      totals.inPool += 1;
    }
    const position = positionOf(entry, pool, settings);
    if (position) {
      totals.mrr += 1 / position;
      totals.at1 += position <= 1 ? 1 : 0;
      totals.at3 += position <= 3 ? 1 : 0;
      totals.at10 += position <= 10 ? 1 : 0;
    }
    if (position !== 1) {
      misses.push({ q: entry.q, position });
    }
  }
  const share = (count) => (totals.queries ? count / totals.queries : 0);
  return {
    queries: totals.queries,
    poolRecall: share(totals.inPool),
    mrr: share(totals.mrr),
    at1: share(totals.at1),
    at3: share(totals.at3),
    at10: share(totals.at10),
    misses,
  };
}

function line(label, result) {
  const pct = (value) => `${(100 * value).toFixed(0)}%`.padStart(4);
  return (
    `${label.padEnd(22)} n=${String(result.queries).padStart(2)}  in pool ${pct(result.poolRecall)}  ` +
    `MRR ${result.mrr.toFixed(3)}  first ${pct(result.at1)}  top 3 ${pct(result.at3)}  top 10 ${pct(result.at10)}`
  );
}

/** Compare two lists of numbers the way words are sorted: the first place that differs decides. */
export function isHigher(key, other) {
  for (let index = 0; index < key.length; index += 1) {
    if (Math.abs(key[index] - other[index]) > 1e-9) {
      return key[index] > other[index];
    }
  }
  return false;
}

function* grid() {
  for (const text of [0.3, 0.4, 0.5, 0.6, 0.7]) {
    for (const evidence of [0.1, 0.2, 0.3]) {
      const upstream = Math.round((1 - text - evidence) * 100) / 100;
      if (upstream < 0.1) {
        continue;
      }
      for (const titleBoost of [1.5, 2.5, 3.5]) {
        for (const b of [0.4, 0.6, 0.75]) {
          for (const diversity of [0.75, 0.85, 0.95]) {
            yield { weights: { text, evidence, upstream }, tuning: { ...TUNING, titleBoost, b, diversity } };
          }
        }
      }
    }
  }
}

async function main() {
  const { queries } = await readJson(queriesFile);
  if (args.includes("--capture")) {
    await capture(queries);
    return;
  }
  const { pools, capturedAt } = await readJson(poolsFile);
  const train = queries.filter((entry) => splitOf(entry.q) === "train");
  const test = queries.filter((entry) => splitOf(entry.q) === "test");
  console.log(`pools captured ${capturedAt}; shipped weights ${JSON.stringify(WEIGHTS)} tuning ${JSON.stringify(TUNING)}`);
  const settings = {};
  const shipped = {
    all: score(queries, pools, settings),
    train: score(train, pools, settings),
    test: score(test, pools, settings),
  };
  // --half=train prints the training half only, so the held-out half stays unseen while tuning.
  const trainOnly = valueOf("half") === "train";
  if (trainOnly) {
    console.log(line("shipped, train", shipped.train));
    for (const kind of [...new Set(queries.map((entry) => entry.kind).filter(Boolean))]) {
      console.log(line(`${kind}, train`, score(train.filter((entry) => entry.kind === kind), pools, settings)));
    }
    for (const miss of args.includes("--misses") ? shipped.train.misses : []) {
      console.log(`  ${miss.position ? `position ${miss.position}` : "not found"}: ${miss.q}`);
    }
    return;
  }
  console.log(line("shipped, all", shipped.all));
  console.log(line("shipped, train", shipped.train));
  console.log(line("shipped, held out", shipped.test));
  for (const kind of [...new Set(queries.map((entry) => entry.kind).filter(Boolean))]) {
    for (const [half, entries] of [["train", train], ["held out", test]]) {
      console.log(line(`${kind}, ${half}`, score(entries.filter((entry) => entry.kind === kind), pools, settings)));
    }
  }
  // A pool is incomplete when a source refused the request (rate limit) on the day of the capture.
  const complete = queries.filter((entry) => pools[entry.q]?.failed.length === 0);
  console.log(line("complete pools only", score(complete, pools)));
  console.log(`${queries.length - complete.length} of ${queries.length} pools are missing at least one source`);
  if (args.includes("--misses")) {
    for (const miss of shipped.all.misses) {
      console.log(`  ${miss.position ? `position ${miss.position}` : "not found"}: ${miss.q} [${splitOf(miss.q)}]`);
    }
  }
  if (!args.includes("--tune")) {
    return;
  }
  let best = null;
  let tried = 0;
  for (const settings of grid()) {
    tried += 1;
    const result = score(train, pools, settings);
    // Ties go to the setting closest to what is shipped, so a number changes only when it has to.
    const distance =
      Math.abs(settings.weights.text - WEIGHTS.text) +
      Math.abs(settings.weights.evidence - WEIGHTS.evidence) +
      Math.abs(settings.tuning.titleBoost - TUNING.titleBoost) / 10 +
      Math.abs(settings.tuning.b - TUNING.b) +
      Math.abs(settings.tuning.diversity - TUNING.diversity);
    const key = [result.mrr, result.at3, -distance];
    if (!best || isHigher(key, best.key)) {
      best = { settings, result, key };
    }
  }
  const heldOut = score(test, pools, best.settings);
  console.log(`\ntried ${tried} settings on the training half; best:`);
  console.log(`  weights ${JSON.stringify(best.settings.weights)} tuning ${JSON.stringify(best.settings.tuning)}`);
  console.log(line("best, train", best.result));
  console.log(line("best, held out", heldOut));
  const better = heldOut.mrr > shipped.test.mrr && heldOut.at3 >= shipped.test.at3 && heldOut.at10 >= shipped.test.at10;
  console.log(
    better
      ? "verdict: the held-out half improves too, so the new numbers are worth shipping."
      : "verdict: the held-out half does not improve, so the shipped numbers stay.",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
