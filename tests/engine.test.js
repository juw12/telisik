import test from "node:test";
import assert from "node:assert/strict";
import { fixture, fixtureFetch, hang, memoryStorage } from "./helpers.js";
import { CACHE_KEEP_MS, ageWords, createCache, dateWindow, isCredibleSuggestion, search } from "../js/engine.js";
import { parseQuery } from "../js/query.js";

test("all sources answer: every one is reported and results are ranked", async () => {
  const updates = [];
  const state = await search("binary search tree", { fetch: fixtureFetch() }, (snapshot) => updates.push(snapshot));
  assert.equal(state.done, true);
  assert.equal(state.planned.length, 10);
  assert.equal(updates.length, 10);
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
    gitlab: hang,
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

test("rate limits are named and remembered; GitHub and OpenAlex hand over to their stand-ins", async () => {
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
  assert.equal(state.status.github.state, "ok");
  assert.match(state.status.github.note, /GitLab/);
  assert.ok(state.results.some((result) => result.source === "github" && result.signals.via === "GitLab"));
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
  assert.equal(cache.get("a"), null, "older than the default hour");
  assert.deepEqual(cache.get("a", 2 * 60 * 60 * 1000), [1], "a longer allowance still accepts it");
  assert.deepEqual(cache.peek("a"), { value: [1], ageMs: 61 * 60 * 1000 });
  for (let index = 0; index < 200; index += 1) {
    now += 1;
    cache.set(`k${index}`, [index]);
  }
  assert.equal(cache.peek("a"), null, "pushed out by newer entries");
  assert.equal(cache.peek("k0"), null);
  assert.deepEqual(cache.get("k199"), [199]);
  now += CACHE_KEEP_MS + 1;
  assert.equal(cache.peek("k199"), null, "too old to show even as a last resort");
});

test("cache survives a full browser store by keeping fewer entries", () => {
  const data = new Map();
  const storage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem(key, value) {
      if (String(value).length > 600) {
        throw new DOMException("full", "QuotaExceededError");
      }
      data.set(key, String(value));
    },
    removeItem: (key) => data.delete(key),
  };
  let now = 1000;
  const cache = createCache(storage, () => now);
  for (let index = 0; index < 40; index += 1) {
    now += 1;
    cache.set(`key${index}`, { d: ["x".repeat(20)], s: null });
  }
  assert.deepEqual(cache.get("key39"), { d: ["x".repeat(20)], s: null });
  const reopened = createCache(storage, () => now);
  assert.deepEqual(reopened.get("key39"), { d: ["x".repeat(20)], s: null });
});

test("a source that fails shows its own saved answer and says how old it is", async () => {
  let now = Date.parse("2026-01-01T00:00:00Z");
  const clock = () => now;
  const cache = createCache(memoryStorage(), clock);
  await search("binary search tree", { fetch: fixtureFetch(), cache, now: clock });

  now += 2 * 60 * 60 * 1000;
  const calls = [];
  const fetch = fixtureFetch(
    {
      wikipedia: async () => new Response("<html>bad gateway</html>", { status: 502 }),
      hackernews: async () => new Response("{}", { status: 429 }),
    },
    calls,
  );
  const state = await search("binary search tree", { fetch, cache, now: clock });
  for (const id of ["wikipedia", "hackernews"]) {
    assert.equal(state.status[id].state, "ok", id);
    assert.equal(state.status[id].stale, true, id);
    assert.equal(state.status[id].ageMs, 2 * 60 * 60 * 1000, id);
    assert.match(state.status[id].note, /saved 2 hours ago/, id);
  }
  assert.ok(state.results.some((result) => result.source === "wikipedia"));
  // Sources with a small free allowance keep their answer for a day, so they are not asked again.
  const askedAgain = new Set(calls.map((call) => call.name));
  for (const id of ["github", "stackexchange", "web"]) {
    assert.ok(!askedAgain.has(id), `${id} was asked again within a day`);
    assert.equal(state.status[id].cached, true, id);
    assert.equal(state.status[id].stale, false, id);
  }
  assert.ok(askedAgain.has("openalex"), "an hour-old answer from an unmetered source is refreshed");
});

test("a paused source still answers what it already has", async () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const clock = () => now;
  const storage = memoryStorage();
  const cache = createCache(memoryStorage(), clock);
  await search("binary search tree", { fetch: fixtureFetch(), cache, storage, now: clock });
  storage.setItem("telisik.backoff.v1", JSON.stringify({ stackexchange: now + 10 * 60 * 1000 }));
  const state = await search("binary search tree", { fetch: fixtureFetch(), cache, storage, now: clock });
  assert.equal(state.status.stackexchange.state, "ok");
  assert.equal(state.status.stackexchange.cached, true);
});

test("a dictionary without the word is simply empty, not an error", async () => {
  const fetch = fixtureFetch({ wiktionary: async () => new Response('{"title":"Not found."}', { status: 404 }) });
  const state = await search("zzzqqq in:dict", { fetch });
  assert.deepEqual(state.planned, ["wiktionary"]);
  assert.equal(state.status.wiktionary.state, "empty");
});

test("remaining free requests are reported with the answer", async () => {
  const fetch = fixtureFetch({
    github: async () =>
      new Response(JSON.stringify(fixture("github")), {
        status: 200,
        headers: { "x-ratelimit-remaining": "2", "x-ratelimit-limit": "10" },
      }),
    stackexchange: async () =>
      new Response(JSON.stringify({ ...fixture("stackexchange"), quota_remaining: 41, quota_max: 300 }), { status: 200 }),
  });
  const state = await search("binary search tree", { fetch });
  assert.deepEqual(state.status.github.quota, { remaining: 2, max: 10, per: "minute" });
  assert.deepEqual(state.status.stackexchange.quota, { remaining: 41, max: 300, per: "day" });
  assert.equal(state.status.wikipedia.quota, null);
});

test("a spelling suggestion is passed on only when it differs from what was typed", async () => {
  const withSuggestion = (suggestion) => async () => {
    const body = structuredClone(fixture("wikipedia"));
    body.query.searchinfo = { suggestion };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const typo = await search("binray search tree", { fetch: fixtureFetch({ wikipedia: withSuggestion("binary search tree") }) });
  assert.equal(typo.suggestion, "binary search tree");
  assert.equal(typo.status.wikipedia.suggestion, "binary search tree");
  const same = await search("Binary Search Tree", { fetch: fixtureFetch({ wikipedia: withSuggestion("binary search tree") }) });
  assert.equal(same.suggestion, null);
  const none = await search("binary search tree", { fetch: fixtureFetch() });
  assert.equal(none.suggestion, null);
});

test("a registered Stack Exchange key reaches the request", async () => {
  const calls = [];
  await search("binary search tree", { fetch: fixtureFetch({}, calls), keys: { stackexchange: "abcDEF123456((" } });
  const asked = calls.find((call) => call.name === "stackexchange");
  assert.match(asked.url, /&key=abcDEF123456/);
});

test("ages are worded for people", () => {
  assert.equal(ageWords(20 * 1000), "1 minute");
  assert.equal(ageWords(45 * 60 * 1000), "45 minutes");
  assert.equal(ageWords(5 * 60 * 60 * 1000), "5 hours");
  assert.equal(ageWords(3 * 24 * 60 * 60 * 1000), "3 days");
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

test("GitHub's second request adds the well-known repository, and a failed second request is said out loud", async () => {
  const items = (rows) => new Response(JSON.stringify({ items: rows }), { status: 200 });
  const first = [{ id: 1, full_name: "someone/kernel-notes", html_url: "https://github.com/someone/kernel-notes", stargazers_count: 12 }];
  const second = [{ id: 2, full_name: "torvalds/linux", html_url: "https://github.com/torvalds/linux", stargazers_count: 180000 }];
  const asked = [];
  const github = (answerSecond) => async (url) => {
    asked.push(url);
    if (!decodeURIComponent(url).includes("in:name")) {
      return items(first);
    }
    return answerSecond ? items(second) : new Response("", { status: 500 });
  };
  const titles = (state) => state.pool.filter((doc) => doc.source === "github").map((doc) => doc.title);

  const state = await search("linux kernel source tree in:code", { fetch: fixtureFetch({ github: github(true) }), keepPool: true });
  assert.equal(asked.length, 2);
  assert.deepEqual(titles(state), ["torvalds/linux", "someone/kernel-notes"]);
  assert.equal(state.status.github.state, "ok");
  assert.equal(state.status.github.partial, null);

  const broken = await search("linux kernel source tree in:code", { fetch: fixtureFetch({ github: github(false) }), keepPool: true });
  assert.deepEqual(titles(broken), ["someone/kernel-notes"]);
  assert.equal(broken.status.github.state, "ok");
  assert.equal(broken.status.github.partial, "error");
  assert.match(broken.status.github.note, /second request could not be reached; showing its first answer only/);
});

test("a spelling suggestion that replaces words the results contain is not shown", async () => {
  const withSuggestion = (suggestion) => async () => {
    const body = structuredClone(fixture("wikipedia"));
    body.query.searchinfo = { suggestion };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  // Every typed word is in the results, so "binary" -> "bindery" is Wikipedia guessing, not a typo.
  const guess = await search("binary search tree", { fetch: fixtureFetch({ wikipedia: withSuggestion("bindery search tree") }) });
  assert.equal(guess.suggestion, null);
  assert.equal(guess.status.wikipedia.suggestion, "bindery search tree");
  // One real typo and one word the results do contain: the proposal is not trusted as a whole.
  const mixed = await search("binray search tree", { fetch: fixtureFetch({ wikipedia: withSuggestion("binary search free") }) });
  assert.equal(mixed.suggestion, null);
});

test("isCredibleSuggestion: only a word found nowhere counts as a typing mistake", () => {
  const results = [{ title: "Bolted joint", snippet: "Preload is set by the torque applied to the bolt.", extra: "" }];
  const typed = (text) => parseQuery(text);
  assert.equal(isCredibleSuggestion("boat payload torque", typed("bolt preload torque"), results), false);
  assert.equal(isCredibleSuggestion("bolt preload torque", typed("bolt prelaod torque"), results), true);
  assert.equal(isCredibleSuggestion("o ring", typed("o-ring"), results), false);
  assert.equal(isCredibleSuggestion(null, typed("bolt"), results), false);
});
