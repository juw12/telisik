import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import { parseQuery } from "../js/query.js";
import { SOURCES } from "../js/sources.js";
import { TUNING, WEIGHTS, bestPassages, evidenceNotes, evidenceScore, phraseRun, rank } from "../js/rank.js";
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

test("a title that is the query without its intent words counts as the exact title", () => {
  const parsed = parseQuery("kyoto travel guide");
  const guide = doc({ id: "voyage", source: "wikivoyage", kind: "travel", title: "Kyoto", snippet: "Kyoto was the capital of Japan.", upstreamRank: 0 });
  const article = doc({ id: "wiki", title: "Kyoto Protocol", snippet: "The Kyoto Protocol is an international treaty on emissions.", upstreamRank: 0 });
  const results = rank([article, guide], parsed);
  assert.equal(results[0].id, "voyage");
  assert.equal(results[0].why.titleIsCore, true);
  assert.deepEqual(results[0].why.intentWords, ["travel", "guide"]);
  assert.equal(results[0].why.intentBoost, 1.25);
  assert.equal(results.find((result) => result.id === "wiki").why.titleIsCore, false);
});

test("a repository is matched by its bare name, without the owner", () => {
  const parsed = parseQuery("linux");
  const repo = doc({ id: "repo", source: "github", kind: "code", title: "torvalds/linux", snippet: "Linux kernel source tree", signals: { stars: 180000 } });
  const [result] = rank([repo], parsed);
  assert.equal(result.why.titleIsQuery, true);
});

test("phraseRun: the share of the query a text repeats word for word, in order", () => {
  const query = ["currency", "of", "japan"];
  assert.equal(phraseRun(query, "The yen is the official currency of Japan."), 1);
  assert.equal(phraseRun(query, "Japan has a currency. Of course."), 0);
  assert.equal(phraseRun(["first", "person", "to", "walk", "on", "the", "moon"], "He was the first person to walk on a comet."), 5 / 7);
  // Two words are not a phrase, and a run needs two content words.
  assert.equal(phraseRun(["currency", "japan"], "currency japan"), 0);
  assert.equal(phraseRun(["what", "is", "the", "yen"], "what is the point"), 0);
});

test("a sentence-like query prefers the page that repeats it in order; keyword queries get no such bonus", () => {
  const yen = doc({ id: "yen", title: "Japanese yen", snippet: "The yen is the official currency of Japan.", upstreamRank: 1 });
  const economy = doc({ id: "economy", title: "Economy of Japan", snippet: "Japan has a large economy. Its currency is traded widely.", upstreamRank: 0 });
  const results = rank([economy, yen], parseQuery("currency of japan"));
  const found = results.find((result) => result.id === "yen");
  assert.equal(found.why.phraseRun, 1);
  assert.equal(results.find((result) => result.id === "economy").why.phraseRun, 0);
  assert.equal(TUNING.runBonus, 0.1);
  const without = rank([economy, yen], parseQuery("currency of japan"), { tuning: { runBonus: 0 } });
  assert.ok(found.score > without.find((result) => result.id === "yen").score);
  // No stopword in the query: it is a list of keywords, word order says nothing.
  const keywords = rank([doc({ id: "k", title: "Notes", snippet: "A rust async runtime for servers." })], parseQuery("rust async runtime"));
  assert.equal(keywords[0].why.phraseRun, 0);
});

test("a Wikipedia redirect is another name of the page", () => {
  const infarction = doc({ id: "mi", title: "Myocardial infarction", alias: "Heart attack", snippet: "A myocardial infarction occurs when blood flow stops.", upstreamRank: 1 });
  const burn = doc({ id: "burn", title: "Heartburn", snippet: "Heartburn is not a heart attack, though the attack of pain is similar.", upstreamRank: 0 });
  const pick = (results) => results.find((result) => result.id === "mi");
  const named = pick(rank([burn, infarction], parseQuery("heart attack")));
  assert.equal(named.why.titleIsQuery, true);
  assert.equal(named.why.alias, "Heart attack");
  const unnamed = pick(rank([burn, { ...infarction, alias: undefined }], parseQuery("heart attack myocardial")));
  assert.equal(unnamed.why.titleIsQuery, false);
  assert.equal(unnamed.why.alias, null);
  // Without the redirect the page shares no word with "heart attack" and is not listed at all.
  assert.equal(pick(rank([burn, { ...infarction, alias: undefined }], parseQuery("heart attack"))), undefined);
});

test("an open data set says which government catalogue it comes from", () => {
  const dataset = doc({ id: "data", source: "eudata", kind: "dataset", title: "Unemployment statistics", signals: { jurisdiction: "European Union" } });
  assert.equal(evidenceScore(dataset), 0.65);
  assert.ok(evidenceNotes(dataset).some((note) => /government catalogue, European Union/.test(note)));
});

test("a meaning model is used only when it is given and weighted, and can keep a page that shares no word", () => {
  const parsed = parseQuery("fear of spiders");
  const phobia = doc({ id: "phobia", title: "Arachnophobia", snippet: "An intense dread of arachnids.", upstreamRank: 1 });
  const spider = doc({ id: "spider", title: "Spiders", snippet: "Spiders are air-breathing arthropods; fear of them is common.", upstreamRank: 0 });
  const meaning = {
    vector: (text) => text,
    similarity: (queryVector, text) => (text.startsWith("Arachnophobia") ? 0.9 : 0.2),
  };
  const without = rank([spider, phobia], parsed, { meaning });
  assert.deepEqual(without.map((result) => result.id), ["spider"]);
  assert.equal(without[0].why.meaning, null);
  const withModel = rank([spider, phobia], parsed, { meaning, weights: { meaning: 0.3 } });
  assert.ok(withModel.some((result) => result.id === "phobia"));
  assert.equal(withModel.find((result) => result.id === "phobia").why.meaning, 1);
});
