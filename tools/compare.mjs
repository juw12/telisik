// Head-to-head on the saved answers: this page's ranking against each of its sources used alone,
// and against the Wiby web index (asked live once, answers saved in tests/eval/wiby.json).
//
//   node tools/compare.mjs                      first query set
//   node tools/compare.mjs --queries=queries2.json --pools=pools2.json
//   add --half=train or --half=test to look at one half only
//
// "Alone" means the first results of that source in the order the source returned them.
// Read the Wiby row with care: every right answer in the query files is a page inside one of the
// libraries this page searches, and Wiby indexes small personal sites, so it can hardly score.
// Engines whose terms forbid automated queries (Google, Bing, ChatGPT, Perplexity) are not here.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseQuery } from "../js/query.js";
import { rank } from "../js/rank.js";
import { isHit, splitOf } from "./eval.mjs";

const args = process.argv.slice(2);
const valueOf = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tests", "eval");
const readJson = async (name) => JSON.parse(await readFile(path.join(folder, name), "utf8"));

export const ALONE = {
  wikipedia: "Wikipedia search alone",
  github: "GitHub search alone",
  hackernews: "Hacker News search alone",
  web: "Mwmbl web index alone",
};

/** Position of the right answer in a list, 0 when it is not in the first ten. */
export function positionIn(docs, entry) {
  const at = docs.slice(0, 10).findIndex((doc) => isHit(doc, entry));
  return at + 1;
}

export function summarise(positions) {
  const count = positions.length;
  const share = (test) => (count ? positions.filter(test).length / count : 0);
  return {
    queries: count,
    mrr: count ? positions.reduce((sum, position) => sum + (position ? 1 / position : 0), 0) / count : 0,
    at1: share((position) => position === 1),
    at3: share((position) => position >= 1 && position <= 3),
    at10: share((position) => position >= 1),
  };
}

export function systemsFor(entry, pool, wiby) {
  const ranked = rank(pool.docs, parseQuery(entry.q), { lens: "all", now: Date.parse("2026-11-14") });
  const lists = { "This page, all sources": ranked };
  for (const [source, label] of Object.entries(ALONE)) {
    lists[label] = pool.docs.filter((doc) => doc.source === source).sort((a, b) => a.upstreamRank - b.upstreamRank);
  }
  if (wiby?.ok) {
    lists["Wiby web index (live)"] = wiby.docs;
  }
  return lists;
}

async function main() {
  const { queries } = await readJson(valueOf("queries") || "queries.json");
  const { pools } = await readJson(valueOf("pools") || "pools.json");
  const wiby = await readJson("wiby.json").then((file) => file.results, () => ({}));
  const half = valueOf("half");
  const entries = queries.filter((entry) => pools[entry.q] && (!half || splitOf(entry.q) === half));
  const kinds = [null, ...new Set(entries.map((entry) => entry.kind).filter(Boolean))];
  for (const kind of kinds) {
    const chosen = entries.filter((entry) => !kind || entry.kind === kind);
    const positions = {};
    for (const entry of chosen) {
      for (const [label, docs] of Object.entries(systemsFor(entry, pools[entry.q], wiby[entry.q]))) {
        (positions[label] ??= []).push(positionIn(docs, entry));
      }
    }
    console.log(`\n${kind ?? "all"}${half ? `, ${half} half` : ""}`);
    for (const [label, list] of Object.entries(positions)) {
      const result = summarise(list);
      const percent = (value) => `${Math.round(value * 100)}%`.padStart(4);
      console.log(`  ${label.padEnd(28)} n=${String(result.queries).padStart(2)}  MRR ${result.mrr.toFixed(3)}  first ${percent(result.at1)}  top 3 ${percent(result.at3)}  top 10 ${percent(result.at10)}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
