import test from "node:test";
import assert from "node:assert/strict";
import { ALONE, positionIn, summarise, systemsFor } from "../tools/compare.mjs";

const entry = { q: "transistor", url: ["en.wikipedia.org/wiki/transistor"] };
const doc = (source, url, upstreamRank, title = "Page") => ({
  id: `${source}:${url}`,
  source,
  kind: source === "wikipedia" ? "encyclopedia" : "code",
  title,
  url,
  snippet: "A transistor is a semiconductor device.",
  extra: "",
  upstreamRank,
  upstreamSize: 3,
  signals: {},
});

test("compare: the position is counted from one and only inside the first ten", () => {
  const docs = [doc("web", "https://example.org/a", 0), doc("wikipedia", "https://en.wikipedia.org/wiki/Transistor", 1)];
  assert.equal(positionIn(docs, entry), 2);
  assert.equal(positionIn([], entry), 0);
  const filler = Array.from({ length: 10 }, (_, index) => doc("web", `https://example.org/${index}`, index));
  assert.equal(positionIn([...filler, docs[1]], entry), 0);
});

test("compare: a longer article name is not accepted as the right answer", () => {
  const docs = [doc("wikipedia", "https://en.wikipedia.org/wiki/Transistor_count", 0)];
  assert.equal(positionIn(docs, entry), 0);
});

test("compare: the summary is the mean of one over the position, and the shares", () => {
  const result = summarise([1, 2, 0, 4]);
  assert.equal(result.queries, 4);
  assert.ok(Math.abs(result.mrr - (1 + 0.5 + 0 + 0.25) / 4) < 1e-12);
  assert.equal(result.at1, 0.25);
  assert.equal(result.at3, 0.5);
  assert.equal(result.at10, 0.75);
  assert.deepEqual(summarise([]), { queries: 0, mrr: 0, at1: 0, at3: 0, at10: 0 });
});

test("compare: a source alone keeps the order the source gave, whatever this page would do", () => {
  const pool = {
    docs: [
      doc("wikipedia", "https://en.wikipedia.org/wiki/Transistor", 1, "Transistor"),
      doc("wikipedia", "https://en.wikipedia.org/wiki/Transistor_count", 0, "Transistor count"),
      doc("github", "https://github.com/example/transistor", 0, "example/transistor"),
    ],
  };
  const lists = systemsFor(entry, pool, undefined);
  assert.deepEqual(Object.keys(lists), ["This page, all sources", ...Object.values(ALONE)]);
  assert.deepEqual(lists[ALONE.wikipedia].map((item) => item.title), ["Transistor count", "Transistor"]);
  assert.equal(positionIn(lists[ALONE.wikipedia], entry), 2);
  assert.equal(lists["This page, all sources"].length, 3);
  assert.equal(lists[ALONE.hackernews].length, 0);
});

test("compare: the outside index is only listed when it answered", () => {
  const pool = { docs: [doc("wikipedia", "https://en.wikipedia.org/wiki/Transistor", 0, "Transistor")] };
  const answered = systemsFor(entry, pool, { ok: true, docs: [{ url: "https://example.org/", title: "Home" }] });
  assert.equal(positionIn(answered["Wiby web index (live)"], entry), 0);
  assert.equal("Wiby web index (live)" in systemsFor(entry, pool, { ok: false, docs: [] }), false);
});
