import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isHigher, isHit, mergeRetry, score, splitOf } from "../tools/eval.mjs";

const { queries } = JSON.parse(readFileSync(new URL("./eval/queries.json", import.meta.url), "utf8"));

test("a hit needs the whole address, not a longer page that starts the same", () => {
  const target = { url: ["en.wikipedia.org/wiki/transistor"] };
  assert.equal(isHit({ url: "https://en.wikipedia.org/wiki/Transistor" }, target), true);
  assert.equal(isHit({ url: "https://en.wikipedia.org/wiki/Transistor#History" }, target), true);
  assert.equal(isHit({ url: "https://en.wikipedia.org/wiki/Transistor?action=view" }, target), true);
  assert.equal(isHit({ url: "https://en.wikipedia.org/wiki/Transistor_count" }, target), false);
  assert.equal(isHit({ url: "https://en.wikipedia.org/wiki/History_of_the_transistor" }, target), false);
});

test("a hit is found through escaped addresses, the article link and the title pattern", () => {
  assert.equal(
    isHit({ url: "https://en.wikipedia.org/wiki/Schr%C3%B6dinger_equation" }, { url: ["en.wikipedia.org/wiki/schrödinger_equation"] }),
    true,
  );
  assert.equal(
    isHit({ url: "https://openalex.org/W1", links: { article: "https://doi.org/10.1000/ABC" } }, { url: ["doi.org/10.1000/abc"] }),
    true,
  );
  assert.equal(isHit({ url: "https://example.org/1", title: "Attention Is All You Need" }, { title: "^attention is all you need" }), true);
  assert.equal(isHit({ url: "https://example.org/1", title: "Is attention all you need?" }, { title: "^attention is all you need" }), false);
  assert.equal(isHit({ url: "https://example.org/1" }, {}), false);
});

test("the split is decided by the query text alone and keeps both halves usable", () => {
  for (const entry of queries) {
    assert.equal(splitOf(entry.q), splitOf(entry.q));
    assert.match(splitOf(entry.q), /^(train|test)$/);
  }
  const held = queries.filter((entry) => splitOf(entry.q) === "test").length;
  assert.ok(held >= 25 && queries.length - held >= 25, `held-out ${held} of ${queries.length}`);
});

test("every query is unique and names a target the checker can read", () => {
  const seen = new Set();
  for (const entry of queries) {
    assert.ok(entry.q && !seen.has(entry.q), `duplicate or empty query: ${entry.q}`);
    seen.add(entry.q);
    assert.ok(entry.url?.length || entry.title, `no target for: ${entry.q}`);
    for (const address of entry.url ?? []) {
      assert.equal(address, address.toLowerCase(), `not lower case: ${address}`);
      assert.doesNotMatch(address, /^https?:|^www\./, `has a protocol or www: ${address}`);
    }
    if (entry.title) {
      assert.doesNotThrow(() => new RegExp(entry.title, "i"));
    }
  }
});

test("settings are compared place by place, and a tie changes nothing", () => {
  assert.equal(isHigher([0.6, 0.1, -3], [0.5, 0.9, 0]), true);
  assert.equal(isHigher([0.5, 0.9, -1], [0.5, 0.9, -2]), true);
  assert.equal(isHigher([0.5, 0.8, 0], [0.5, 0.9, -2]), false);
  assert.equal(isHigher([0.5, 0.9, -2], [0.5, 0.9, -2]), false);
});

test("the score counts the place of the first hit and says when the target was never fetched", () => {
  const page = (id, title) => ({
    id,
    source: "wikipedia",
    kind: "encyclopedia",
    title,
    url: `https://en.wikipedia.org/wiki/${title.replaceAll(" ", "_")}`,
    snippet: `${title} is the subject of this article.`,
    snippetIsMeta: false,
    extra: "",
    date: null,
    rank: 0,
    total: 2,
    signals: {},
    links: {},
  });
  const pools = {
    photosynthesis: { docs: [page("a", "Photosynthesis"), { ...page("b", "Chlorophyll"), rank: 1 }] },
    "krebs cycle": { docs: [page("c", "Glycolysis")] },
  };
  const entries = [
    { q: "photosynthesis", url: ["en.wikipedia.org/wiki/photosynthesis"] },
    { q: "krebs cycle", url: ["en.wikipedia.org/wiki/citric_acid_cycle"] },
    { q: "never captured", url: ["example.org/x"] },
  ];
  const result = score(entries, pools);
  assert.equal(result.queries, 2);
  assert.equal(result.poolRecall, 0.5);
  assert.equal(result.at1, 0.5);
  assert.equal(result.mrr, 0.5);
  assert.deepEqual(result.misses, [{ q: "krebs cycle", position: 0 }]);
});

test("a retry keeps what was saved and only fills in the sources that answer this time", () => {
  const before = {
    planned: ["wikipedia", "stackexchange", "github"],
    failed: ["wikipedia:limit", "stackexchange:limit"],
    docs: [{ source: "github", id: "saved" }],
  };
  const state = {
    status: { wikipedia: { state: "ok" }, stackexchange: { state: "limit" }, github: { state: "error" } },
    pool: [{ source: "wikipedia", id: "new" }],
  };
  const merged = mergeRetry(before, state, new Set(["wikipedia", "stackexchange"]));
  assert.deepEqual(merged.failed, ["stackexchange:limit"]);
  assert.deepEqual(merged.docs.map((doc) => doc.id), ["new", "saved"]);
  assert.deepEqual(merged.planned, before.planned);
});
