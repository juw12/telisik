import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeEntities,
  excerptAround,
  termHits,
  escapeHtml,
  formatCount,
  highlight,
  splitSentences,
  stem,
  stripHtml,
  terms,
  tokenize,
  truncate,
} from "../js/text.js";

test("tokenize folds case and accents and splits CJK per character", () => {
  assert.deepEqual(tokenize("Café déjà-vu C3PO"), ["cafe", "deja", "vu", "c3po"]);
  assert.deepEqual(tokenize("搜索 engine"), ["搜", "索", "engine"]);
});

test("stem is conservative", () => {
  assert.equal(stem("trees"), "tree");
  assert.equal(stem("queries"), "query");
  assert.equal(stem("ranking"), "rank");
  assert.equal(stem("class"), "class");
  assert.equal(stem("bus"), "bus");
  assert.equal(stem("bm25"), "bm25");
});

test("terms drops stopwords", () => {
  assert.deepEqual(terms("How does the binary search tree work"), ["binary", "search", "tree", "work"]);
});

test("stripHtml and decodeEntities return plain text", () => {
  assert.equal(stripHtml('a <span class="highlight">b</span> &amp; c&#39;s &lt;tag&gt;'), "a b & c's <tag>");
  assert.equal(decodeEntities("&quot;x&quot; &#x41; &unknown;"), '"x" A &unknown;');
});

test("escapeHtml and highlight never let markup through", () => {
  assert.equal(escapeHtml('<img src=x onerror="1">'), "&lt;img src=x onerror=&quot;1&quot;&gt;");
  const html = highlight("<b>Trees</b> and a tree", ["tree"]);
  assert.equal(html, "&lt;b&gt;<mark>Trees</mark>&lt;/b&gt; and a <mark>tree</mark>");
});

test("splitSentences keeps abbreviations and decimals together", () => {
  const sentences = splitSentences("Version 3.5 is out, e.g. Today. It works! Does it? Yes.");
  assert.deepEqual(sentences, ["Version 3.5 is out, e.g. Today.", "It works!", "Does it?", "Yes."]);
});

test("truncate cuts on a word and marks the cut", () => {
  assert.equal(truncate("short", 10), "short");
  assert.equal(truncate("one two three four five", 14), "one two three…");
});

test("formatCount", () => {
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1500), "1.5k");
  assert.equal(formatCount(45200), "45k");
  assert.equal(formatCount(2300000), "2.3M");
});

test("excerptAround keeps the opening unless a later sentence holds more of the query", () => {
  const opening = "A regulator reduces gas pressure for a diver. ".repeat(4);
  const later = "An o-ring seals the first stage and a damaged ring leaks. ";
  const text = opening + later + "The rest of the page goes on about other parts. ".repeat(3);
  assert.equal(excerptAround("short text", ["ring"], 80), "short text");
  assert.ok(excerptAround(text, ["diver"], 120).startsWith("A regulator reduces"));
  const moved = excerptAround(text, ["ring", "leak"], 120);
  // The earliest sentence whose window holds both words: one sentence of context, then the match.
  assert.ok(moved.startsWith("… A regulator reduces gas pressure for a diver. An o-ring seals"), moved);
  assert.equal(termHits(moved, ["ring", "leak"]), 2);
  assert.ok(text.includes(moved.slice(2).replace(/…$/, "")), "the excerpt is copied, not reworded");
  assert.ok(excerptAround(text, [], 120).startsWith("A regulator reduces"));
});

test("termHits counts different query terms once each, on the stem", () => {
  assert.equal(termHits("Leaks and a leak; the rate of leaking", ["leak", "rate", "seal"]), 2);
  assert.equal(termHits("nothing here", ["leak"]), 0);
});
