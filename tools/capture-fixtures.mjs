// Capture real API answers as test fixtures and print what the engine makes of them.
// Usage: node tools/capture-fixtures.mjs ["query"] [--save]
// Behind a proxy: set NODE_USE_ENV_PROXY=1 and HTTPS_PROXY.

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { search } from "../js/engine.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, "..", "tests", "fixtures");
const args = process.argv.slice(2);
const save = args.includes("--save");
const beforeAI = args.includes("--before-ai");
const lens = (args.find((arg) => arg.startsWith("--lens=")) ?? "--lens=all").slice(7);
const query = args.find((arg) => !arg.startsWith("--")) ?? "binary search tree";

const HOST_NAMES = {
  "api.stackexchange.com": "stackexchange",
  "hn.algolia.com": "hackernews",
  "api.github.com": "github",
  "api.openalex.org": "openalex",
  "api.crossref.org": "crossref",
  "www.ebi.ac.uk": "europepmc",
  "archive.org": "archive",
  "openlibrary.org": "openlibrary",
};

const captured = {};
async function recordingFetch(url, init) {
  const response = await fetch(url, { ...init, headers: { Origin: "https://juw12.github.io" } });
  const host = new URL(url).hostname;
  const name = HOST_NAMES[host] ?? (host.endsWith("wikipedia.org") ? "wikipedia" : host);
  const text = await response.text();
  captured[name] = text;
  return new Response(text, { status: response.status, headers: { "content-type": "application/json" } });
}

const state = await search(query, { fetch: recordingFetch, lens, beforeAI, timeoutMs: 20000 });

console.log(`query: ${query} | lens ${lens} | before ${state.window.before ?? "-"}`);
for (const [id, status] of Object.entries(state.status)) {
  const site = status.site ? ` (${status.site})` : "";
  console.log(`  ${id}${site}: ${status.state} fetched ${status.fetched} kept ${status.count} ${status.ms} ms ${status.note}`);
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

if (save) {
  await mkdir(fixtureDir, { recursive: true });
  for (const [name, text] of Object.entries(captured)) {
    await writeFile(path.join(fixtureDir, `${name}.json`), JSON.stringify(JSON.parse(text), null, 1) + "\n", "utf8");
  }
  await writeFile(path.join(fixtureDir, "QUERY.txt"), `${query}\n`, "utf8");
  console.log(`saved ${Object.keys(captured).length} fixtures to ${fixtureDir}`);
}
