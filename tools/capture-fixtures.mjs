// Capture real API answers as test fixtures, or print what the engine makes of one live search.
//   node tools/capture-fixtures.mjs --save            capture one fixture per source (and per stand-in)
//   node tools/capture-fixtures.mjs --save --only=web,zenodo
//   node tools/capture-fixtures.mjs "query" [--lens=all] [--before-ai]   live search, nothing saved
// Behind a proxy: set NODE_USE_ENV_PROXY=1 and HTTPS_PROXY.

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { search } from "../js/engine.js";
import { parseQuery } from "../js/query.js";
import { SOURCES } from "../js/sources.js";
import { fixtureQuery } from "./fixture-names.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, "..", "tests", "fixtures");
const args = process.argv.slice(2);
const save = args.includes("--save");
const beforeAI = args.includes("--before-ai");
const lens = (args.find((arg) => arg.startsWith("--lens=")) ?? "--lens=all").slice(7);
const only = (args.find((arg) => arg.startsWith("--only=")) ?? "--only=").slice(7).split(",").filter(Boolean);
const query = args.find((arg) => !arg.startsWith("--"));
// Some sources turn away requests that do not look like a browser's, so the tool names one.
const ORIGIN = {
  Origin: "https://juw12.github.io",
  // Says what it is, as the Wikimedia User-Agent policy asks of scripts.
  "User-Agent": "SumberCheck/1.0 (https://github.com/juw12/sumber; search quality check, a few requests a minute)",
  Accept: "application/json",
};

async function captureAll() {
  await mkdir(fixtureDir, { recursive: true });
  const adapters = SOURCES.flatMap((source) => (source.fallback ? [source, source.fallback] : [source]));
  let failed = 0;
  for (const adapter of adapters) {
    if (only.length && !only.includes(adapter.id)) {
      continue;
    }
    const parsed = parseQuery(fixtureQuery(adapter.id));
    const url = adapter.request(parsed, { wikiLang: "en" });
    try {
      const response = await fetch(url, { headers: ORIGIN, signal: AbortSignal.timeout(25000) });
      const json = JSON.parse(await response.text());
      const docs = adapter.parse(json, { parsed, opts: {} });
      const cors = response.headers.get("access-control-allow-origin") ?? "none";
      console.log(`${adapter.id}: HTTP ${response.status}, CORS ${cors}, ${docs.length} documents for "${parsed.raw}"`);
      if (!response.ok || !docs.length) {
        failed += 1;
        continue;
      }
      await writeFile(path.join(fixtureDir, `${adapter.id}.json`), JSON.stringify(json, null, 1) + "\n", "utf8");
    } catch (error) {
      failed += 1;
      console.log(`${adapter.id}: FAILED ${error.message}`);
    }
  }
  process.exitCode = failed ? 1 : 0;
}

async function liveSearch() {
  const fetchWithOrigin = (url, init) => fetch(url, { ...init, headers: ORIGIN });
  const state = await search(query, { fetch: fetchWithOrigin, lens, beforeAI, timeoutMs: 20000 });
  console.log(`query: ${query} | lens ${lens} | before ${state.window.before ?? "-"}`);
  if (state.suggestion) {
    console.log(`did you mean: ${state.suggestion}`);
  }
  for (const [id, status] of Object.entries(state.status)) {
    const site = status.site ? ` (${status.site})` : "";
    const quota = status.quota ? ` quota ${status.quota.remaining}/${status.quota.max} per ${status.quota.per}` : "";
    console.log(
      `  ${id}${site}: ${status.state} fetched ${status.fetched} kept ${status.count} ${status.ms} ms${quota} ${status.note}`,
    );
  }
  console.log("passages:");
  for (const passage of state.passages) {
    console.log(`  [${passage.resultIndex + 1}] ${passage.text}`);
  }
  console.log("results:");
  state.results.slice(0, 14).forEach((result, index) => {
    const why = result.why;
    console.log(
      `  ${String(index + 1).padStart(2)}. ${result.finalScore.toFixed(3)} ${result.source.padEnd(13)} ` +
        `t${why.text.toFixed(2)} e${why.evidence.toFixed(2)} u${why.upstream.toFixed(2)} ${result.date ?? "living    "} ` +
        result.title.slice(0, 70),
    );
  });
}

if (save) {
  await captureAll();
} else {
  await liveSearch();
}
