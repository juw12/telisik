import test from "node:test";
import assert from "node:assert/strict";
import { fixtureFetch, hang, memoryStorage } from "./helpers.js";
import { createCache, dateWindow, search } from "../js/engine.js";
import { parseQuery } from "../js/query.js";

test("all sources answer: every one is reported and results are ranked", async () => {
  const updates = [];
  const state = await search("binary search tree", { fetch: fixtureFetch() }, (snapshot) => updates.push(snapshot));
  assert.equal(state.done, true);
  assert.equal(state.planned.length, 8);
  assert.equal(updates.length, 8);
  for (const id of state.planned) {
    assert.equal(state.status[id].state, "ok", id);
  }
  assert.ok(state.results.length >= 20);
  assert.ok(state.passages.length >= 2);
  assert.equal(state.status.stackexchange.site, "stackoverflow");
});

test("one slow source and one broken source do not hold back the rest", async () => {
  const fetch = fixtureFetch({
    github: hang,
    archive: async () => new Response("<html>bad gateway</html>", { status: 502 }),
    hackernews: async () => {
      throw new TypeError("network down");
    },
  });
  const state = await search("binary search tree", { fetch, timeoutMs: 40 });
  assert.equal(state.status.github.state, "timeout");
  assert.equal(state.status.archive.state, "error");
  assert.equal(state.status.hackernews.state, "error");
  assert.equal(state.status.wikipedia.state, "ok");
  assert.ok(state.results.length > 10);
  assert.ok(state.results.every((result) => !["github", "archive", "hackernews"].includes(result.source)));
});

test("rate limits are named, remembered, and OpenAlex falls back to Crossref", async () => {
  const storage = memoryStorage();
  const calls = [];
  const fetch = fixtureFetch(
    {
      github: async () => new Response("{}", { status: 403 }),
      openalex: async () => new Response("{}", { status: 429 }),
      stackexchange: async () =>
        new Response(JSON.stringify({ error_id: 502, error_message: "too many requests from this IP" }), { status: 400 }),
    },
    calls,
  );
  const state = await search("binary search tree", { fetch, storage });
  assert.equal(state.status.github.state, "limit");
  assert.equal(state.status.stackexchange.state, "limit");
  assert.equal(state.status.openalex.state, "ok");
  assert.match(state.status.openalex.note, /Crossref/);
  assert.ok(state.results.some((result) => result.signals.via === "Crossref"));

  const before = calls.length;
  const again = await search("binary search tree", { fetch, storage });
  assert.equal(again.status.stackexchange.state, "limit");
  assert.ok(!calls.slice(before).some((call) => call.name === "stackexchange"), "backed-off source was asked again");
});

test("cache: a repeated search does not touch the network", async () => {
  const calls = [];
  const cache = createCache(memoryStorage());
  const fetch = fixtureFetch({}, calls);
  await search("binary search tree", { fetch, cache });
  const firstRound = calls.length;
  const state = await search("binary search tree", { fetch, cache });
  assert.equal(calls.length, firstRound);
  assert.equal(state.status.wikipedia.cached, true);
  assert.ok(state.results.length >= 20);
});

test("cache expires and keeps a bounded number of entries", () => {
  let now = 1000;
  const cache = createCache(memoryStorage(), () => now);
  cache.set("a", [1]);
  assert.deepEqual(cache.get("a"), [1]);
  now += 61 * 60 * 1000;
  assert.equal(cache.get("a"), null);
  for (let index = 0; index < 80; index += 1) {
    now += 1;
    cache.set(`k${index}`, [index]);
  }
  assert.equal(cache.get("k0"), null);
  assert.deepEqual(cache.get("k79"), [79]);
});

test("Before AI: the stricter date wins and Wikipedia is not quoted", async () => {
  assert.deepEqual(dateWindow(parseQuery("x"), true), { before: "2022-11-30", after: null });
  assert.equal(dateWindow(parseQuery("x before:2015"), true).before, "2015-01-01");
  assert.equal(dateWindow(parseQuery("x before:2024"), true).before, "2022-11-30");
  const state = await search("binary search tree", { fetch: fixtureFetch(), beforeAI: true });
  assert.ok(state.results.length > 5);
  for (const result of state.results) {
    assert.ok(result.living || result.date <= "2022-11-30", `${result.id} ${result.date}`);
  }
  assert.ok(state.passages.every((passage) => passage.source !== "wikipedia"));
});

test("an aborted search reports nothing", async () => {
  const controller = new AbortController();
  const updates = [];
  const fetch = fixtureFetch({ github: hang });
  const pending = search("binary search tree", { fetch, signal: controller.signal, timeoutMs: 5000 }, (s) => updates.push(s));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const seen = updates.length;
  controller.abort();
  await pending;
  assert.equal(updates.length, seen);
});

test("an empty query asks nobody", async () => {
  const calls = [];
  const state = await search("   ", { fetch: fixtureFetch({}, calls) });
  assert.equal(calls.length, 0);
  assert.deepEqual(state.results, []);
});
