import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import { parseQuery } from "../js/query.js";
import { SOURCES } from "../js/sources.js";
import { WEIGHTS, bestPassages, evidenceScore, rank } from "../js/rank.js";
import { formatCitation, snapshotUrl } from "../js/cite.js";

function pool(query) {
  const parsed = parseQuery(query);
  const docs = SOURCES.flatMap((source) => source.parse(fixture(source.id), { parsed, opts: {} }));
  return { parsed, docs };
}

function doc(overrides) {
  return {
    id: overrides.id ?? `x:${Math.random()}`,
    source: "wikipedia",
    kind: "encyclopedia",
    title: "",
    url: `https://example.org/${Math.random()}`,
    snippet: "",
    snippetIsMeta: false,
    extra: "",
    date: null,
    dateIsYear: false,
    author: "",
    venue: "",
    signals: {},
    upstreamRank: 0,
    links: {},
    doi: null,
    living: false,
    ...overrides,
  };
}

test("weights add up to one", () => {
  assert.equal(WEIGHTS.text + WEIGHTS.evidence + WEIGHTS.upstream, 1);
});

test("real pool: sorted, explained, mixed sources on the first screen", () => {
  const { parsed, docs } = pool("binary search tree");
  const results = rank(docs, parsed, { lens: "all" });
  assert.ok(results.length >= 20);
  for (let index = 1; index < results.length; index += 1) {
    assert.ok(results[index - 1].finalScore >= results[index].finalScore - 1e-9, `order at ${index}`);
  }
  for (const result of results) {
    assert.ok(result.why.coverage > 0);
    assert.ok(result.why.text >= 0 && result.why.text <= 1);
    assert.ok(result.why.evidence >= 0 && result.why.evidence <= 1);
    assert.ok(result.why.upstream > 0 && result.why.upstream <= 1);
  }
  const firstScreen = new Set(results.slice(0, 8).map((result) => result.source));
  assert.ok(firstScreen.size >= 4, `only ${[...firstScreen]} in the first eight`);
  assert.ok(results.slice(0, 5).some((result) => result.title === "Binary search tree"));
});

test("real pool: one Stack Exchange thread appears once", () => {
  const { parsed, docs } = pool("binary search tree");
  const threads = rank(docs, parsed, {}).filter((result) => result.thread).map((result) => result.thread);
  assert.equal(new Set(threads).size, threads.length);
});

test("documents without any query term are dropped, excluded terms remove documents", () => {
  const parsed = parseQuery("heap sort -java");
  const results = rank(
    [
      doc({ id: "a", title: "Heap sort in C" }),
      doc({ id: "b", title: "Heap sort in Java" }),
      doc({ id: "c", title: "Quick select" }),
    ],
    parsed,
  );
  assert.deepEqual(results.map((result) => result.id), ["a"]);
});

test("a term found in every document still counts (no zero weights for the topic)", () => {
  const parsed = parseQuery("bm25 ranking");
  const results = rank(
    [
      doc({ id: "topic", title: "Okapi BM25", snippet: "BM25 is a ranking function.", upstreamRank: 0 }),
      doc({ id: "side", title: "Notes", snippet: "bm25 appears once here among many other unrelated words.", upstreamRank: 1 }),
    ],
    parsed,
  );
  assert.equal(results[0].id, "topic");
  assert.ok(results[0].why.text > results[1].why.text);
});

test("date window: undated documents go, living pages stay, year precision is respected", () => {
  const parsed = parseQuery("tree");
  const docs = [
    doc({ id: "old", title: "tree", date: "2020-05-01" }),
    doc({ id: "new", title: "tree", date: "2023-01-01" }),
    doc({ id: "year", title: "tree", date: "2022-01-01", dateIsYear: true }),
    doc({ id: "undated", title: "tree" }),
    doc({ id: "living", title: "tree", living: true }),
  ];
  const ids = rank(docs, parsed, { before: "2022-11-30" }).map((result) => result.id).sort();
  assert.deepEqual(ids, ["living", "old", "year"]);
});

test("the same DOI from two sources is merged and remembered", () => {
  const parsed = parseQuery("sleep memory");
  const results = rank(
    [
      doc({ id: "o", source: "openalex", kind: "paper", title: "Sleep and memory", doi: "10.1/x", signals: { citations: 900 } }),
      doc({ id: "e", source: "europepmc", kind: "medical", title: "Sleep and memory.", doi: "10.1/x", signals: { citations: 10 } }),
    ],
    parsed,
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "o");
  assert.deepEqual(results[0].alsoIn, ["europepmc"]);
});

test("addresses that differ only in the query string stay separate; a fragment does not", () => {
  const parsed = parseQuery("tree");
  const thread = (id, url) => doc({ id, source: "hackernews", kind: "discussion", title: "tree", url });
  const results = rank(
    [
      thread("first", "https://news.ycombinator.com/item?id=1"),
      thread("second", "https://news.ycombinator.com/item?id=2"),
      thread("anchor", "https://news.ycombinator.com/item?id=2#comments"),
    ],
    parsed,
  );
  assert.deepEqual(results.map((result) => result.id).sort(), ["first", "second"]);
});

test("evidence: accepted and upvoted answers beat unvoted ones; stars and citations are log-scaled", () => {
  const strong = evidenceScore({ kind: "qa", signals: { accepted: true, score: 400 } });
  const weak = evidenceScore({ kind: "qa", signals: { accepted: false, score: 0 } });
  assert.ok(strong > 0.9 && weak === 0.3);
  assert.ok(evidenceScore({ kind: "code", signals: { stars: 100 } }) < evidenceScore({ kind: "code", signals: { stars: 10000 } }));
  assert.ok(evidenceScore({ kind: "paper", signals: { citations: 1e9, openAccess: true } }) <= 1);
});

test("diversity: a second result from the same source is discounted", () => {
  const parsed = parseQuery("tree");
  const results = rank(
    [
      doc({ id: "w1", title: "tree", upstreamRank: 0 }),
      doc({ id: "w2", title: "tree", upstreamRank: 0 }),
    ],
    parsed,
  );
  assert.equal(results[0].why.diversity, 1);
  assert.equal(results[1].why.diversity, 0.85);
});

test("passages are verbatim, from different documents, and skip metadata lines", () => {
  const { parsed, docs } = pool("binary search tree");
  const results = rank(docs, parsed, { lens: "all" });
  const passages = bestPassages(results, parsed);
  assert.ok(passages.length >= 2 && passages.length <= 3);
  const seenDocs = new Set();
  for (const passage of passages) {
    const result = results[passage.resultIndex];
    assert.equal(result.id, passage.docId);
    assert.ok(result.snippet.replace(/\s+/g, " ").includes(passage.text), "not a verbatim substring");
    assert.equal(result.snippetIsMeta, false);
    assert.ok(!seenDocs.has(passage.docId));
    seenDocs.add(passage.docId);
  }
});

test("passages: living pages are skipped when a date window is active", () => {
  const { parsed, docs } = pool("binary search tree");
  const results = rank(docs, parsed, { before: "2022-11-30" });
  const passages = bestPassages(results, parsed, { skipLiving: true });
  assert.ok(passages.every((passage) => passage.source !== "wikipedia"));
});

test("citations use only returned fields", () => {
  const paper = doc({
    source: "openalex",
    kind: "paper",
    title: "Self-adjusting binary search trees",
    author: "Daniel D. Sleator, Robert E. Tarjan",
    venue: "Journal of the ACM",
    date: "1985-07-01",
    doi: "10.1145/3828.3835",
  });
  assert.equal(
    formatCitation(paper),
    "Daniel D. Sleator, Robert E. Tarjan (1985). Self-adjusting binary search trees. Journal of the ACM. https://doi.org/10.1145/3828.3835",
  );
  const page = doc({ title: "Binary search tree", url: "https://en.wikipedia.org/wiki/Binary_search_tree" });
  assert.equal(
    formatCitation(page, "2026-11-13"),
    '"Binary search tree." Wikipedia. https://en.wikipedia.org/wiki/Binary_search_tree (accessed 2026-11-13).',
  );
  assert.equal(snapshotUrl("https://a.org/x", "2022-11-30"), "https://web.archive.org/web/20221130/https://a.org/x");
});
