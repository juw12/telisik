import test from "node:test";
import assert from "node:assert/strict";
import { BANGS, bangUrl, normalizeDate, parseQuery } from "../js/query.js";

test("plain query", () => {
  const parsed = parseQuery("  binary search trees ");
  assert.equal(parsed.text, "binary search trees");
  assert.deepEqual(parsed.terms, ["binary", "search", "tree"]);
  assert.equal(parsed.upstream, "binary search trees");
  assert.equal(parsed.bang, null);
});

test("questions keep their topic words for the sources", () => {
  const parsed = parseQuery("How does BM25 ranking work?");
  assert.equal(parsed.upstream, "BM25 ranking");
  assert.deepEqual(parsed.terms, ["bm25", "rank"]);
  assert.equal(parsed.intent, "how");
  assert.equal(parseQuery("why is the sky blue").intent, "why");
});

test("a query made only of stopwords is still sent", () => {
  const parsed = parseQuery("to be or not to be");
  assert.equal(parsed.upstream, "to be or not to be");
});

test("operators", () => {
  const parsed = parseQuery('"exact phrase" rust -java in:papers in:wiki before:2022 after:2019-06 se:physics');
  assert.deepEqual(parsed.phrases, ["exact phrase"]);
  assert.deepEqual(parsed.excluded, ["java"]);
  assert.deepEqual(parsed.sources, ["openalex", "wikipedia"]);
  assert.equal(parsed.before, "2022-01-01");
  assert.equal(parsed.after, "2019-06-01");
  assert.equal(parsed.seSite, "physics");
  assert.equal(parsed.text, '"exact phrase" rust');
  assert.equal(parsed.upstream, '"exact phrase" rust');
});

test("unknown operators stay in the text", () => {
  const parsed = parseQuery("in:nowhere before:soon c++ templates");
  assert.equal(parsed.text, "in:nowhere before:soon c++ templates");
  assert.deepEqual(parsed.sources, []);
  assert.equal(parsed.before, null);
});

test("bangs hand over to another engine", () => {
  const parsed = parseQuery("cheap flights !g");
  assert.equal(parsed.bang, "g");
  assert.equal(parsed.text, "cheap flights");
  assert.equal(bangUrl("g", parsed.text), "https://www.google.com/search?q=cheap%20flights");
  assert.equal(parseQuery("!nope x").bang, null);
  for (const bang of Object.values(BANGS)) {
    assert.match(bang.url, /^https:\/\/.+%s/);
  }
});

test("normalizeDate", () => {
  assert.equal(normalizeDate("2022"), "2022-01-01");
  assert.equal(normalizeDate("2022-7"), "2022-07-01");
  assert.equal(normalizeDate("2022-13"), null);
  assert.equal(normalizeDate("yesterday"), null);
});

test("recency words", () => {
  assert.equal(parseQuery("latest rust release").wantsRecent, true);
  assert.equal(parseQuery("rust ownership").wantsRecent, false);
});
