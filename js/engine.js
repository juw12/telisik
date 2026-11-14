// The search itself: ask every planned source in parallel, never wait for a slow one, rank what came
// back. Runs entirely in the page; the only network requests are the source APIs themselves.

import { BEFORE_AI_DATE, parseQuery } from "./query.js";
import { SOURCE_BY_ID, planSources } from "./sources.js";
import { bestPassages, rank } from "./rank.js";

export const TIMEOUT_MS = 8000;
const CACHE_KEY = "sumber.cache.v1";
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 60;
const BACKOFF_KEY = "sumber.backoff.v1";

/** Small LRU on top of any Storage-like object; silently becomes memory-only when storage fails. */
export function createCache(storage, now = () => Date.now()) {
  let memory = {};
  try {
    memory = JSON.parse(storage?.getItem(CACHE_KEY) ?? "{}") ?? {};
  } catch {
    memory = {};
  }
  function persist() {
    try {
      storage?.setItem(CACHE_KEY, JSON.stringify(memory));
    } catch {
      try {
        storage?.removeItem(CACHE_KEY);
      } catch {
        // Storage is unavailable (private mode or quota); the in-memory copy still works.
      }
    }
  }
  return {
    get(key) {
      const entry = memory[key];
      if (!entry || now() - entry.t > CACHE_TTL_MS) {
        return null;
      }
      return entry.v;
    },
    set(key, value) {
      memory[key] = { t: now(), v: value };
      const keys = Object.keys(memory).sort((a, b) => memory[b].t - memory[a].t);
      for (const stale of keys.slice(CACHE_MAX)) {
        delete memory[stale];
      }
      persist();
    },
    clear() {
      memory = {};
      try {
        storage?.removeItem(CACHE_KEY);
      } catch {
        // Nothing to clear.
      }
    },
  };
}

function readBackoff(storage) {
  try {
    return JSON.parse(storage?.getItem(BACKOFF_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function writeBackoff(storage, sourceId, until) {
  try {
    const all = readBackoff(storage);
    all[sourceId] = until;
    storage?.setItem(BACKOFF_KEY, JSON.stringify(all));
  } catch {
    // Without storage the back-off simply lasts for this page view only.
  }
}

/** The effective date window: the stricter of the before: operator and the Before-AI switch. */
export function dateWindow(parsed, beforeAI) {
  let before = parsed.before;
  if (beforeAI && (!before || before > BEFORE_AI_DATE)) {
    before = BEFORE_AI_DATE;
  }
  return { before, after: parsed.after };
}

async function fetchSource(adapter, parsed, opts, env) {
  const url = adapter.request(parsed, opts);
  const cached = env.cache?.get(url);
  if (cached) {
    return { state: cached.length ? "ok" : "empty", docs: cached, cached: true };
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  env.signal?.addEventListener("abort", onAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, env.timeoutMs);
  try {
    const response = await env.fetch(url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    const failure = adapter.failure?.(json);
    if (failure) {
      if (failure.state === "limit") {
        writeBackoff(env.storage, adapter.id, env.now() + 10 * 60 * 1000);
      }
      return { ...failure, docs: [] };
    }
    if (response.status === 429 || response.status === 403) {
      writeBackoff(env.storage, adapter.id, env.now() + 60 * 1000);
      return { state: "limit", docs: [], note: "The source's free request limit is used up for now." };
    }
    if (!response.ok || json === null) {
      return { state: "error", docs: [], note: `The source answered with HTTP ${response.status}.` };
    }
    if (typeof json.backoff === "number") {
      writeBackoff(env.storage, adapter.id, env.now() + json.backoff * 1000);
    }
    const docs = adapter.parse(json, { parsed, opts });
    env.cache?.set(url, docs);
    return { state: docs.length ? "ok" : "empty", docs };
  } catch (error) {
    if (env.signal?.aborted) {
      return { state: "cancelled", docs: [] };
    }
    if (timedOut) {
      return { state: "timeout", docs: [], note: `No answer within ${Math.round(env.timeoutMs / 1000)} seconds.` };
    }
    return { state: "error", docs: [], note: "Could not reach the source (offline or blocked on this network)." };
  } finally {
    clearTimeout(timer);
    env.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Run one search.
 * options: { lens, beforeAI, wikiLang, signal, fetch, cache, storage, timeoutMs, now }
 * onUpdate(state) is called whenever a source settles; the returned promise resolves with the
 * final state: { parsed, window, planned, status, results, passages, done }.
 */
export async function search(rawQuery, options = {}, onUpdate = () => {}) {
  const parsed = typeof rawQuery === "string" ? parseQuery(rawQuery) : rawQuery;
  const window_ = dateWindow(parsed, Boolean(options.beforeAI));
  const env = {
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    cache: options.cache ?? null,
    storage: options.storage ?? null,
    signal: options.signal ?? null,
    timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
    now: options.now ?? (() => Date.now()),
  };
  const opts = { ...window_, wikiLang: options.wikiLang ?? "en", lens: options.lens ?? "all" };
  const planned = parsed.text ? planSources(parsed, opts.lens) : [];
  const status = {};
  const pools = {};
  for (const id of planned) {
    status[id] = { state: "loading", count: 0 };
  }

  function snapshot(done) {
    const pool = planned.flatMap((id) => pools[id] ?? []);
    const results = rank(pool, parsed, { ...opts, now: env.now() });
    const kept = {};
    for (const result of results) {
      kept[result.source] = (kept[result.source] ?? 0) + 1;
    }
    for (const id of planned) {
      status[id].count = kept[id] ?? 0;
    }
    const passages = bestPassages(results, parsed, { skipLiving: Boolean(window_.before) });
    return { parsed, window: window_, planned, status: structuredCloneSafe(status), results, passages, done };
  }

  const backoff = readBackoff(env.storage);
  await Promise.all(
    planned.map(async (id) => {
      const adapter = SOURCE_BY_ID[id];
      const started = env.now();
      let outcome;
      if (backoff[id] && backoff[id] > env.now()) {
        outcome = { state: "limit", docs: [], note: "Paused for a few minutes after the source asked us to slow down." };
      } else {
        outcome = await fetchSource(adapter, parsed, opts, env);
      }
      if (["error", "limit", "timeout"].includes(outcome.state) && adapter.fallback) {
        const second = await fetchSource(adapter.fallback, parsed, opts, env);
        if (second.state === "ok") {
          outcome = { ...second, note: `${adapter.label} did not answer; results come from ${adapter.fallback.label}.` };
        }
      }
      if (outcome.state === "cancelled") {
        return;
      }
      pools[id] = outcome.docs;
      status[id] = {
        state: outcome.state,
        count: 0,
        fetched: outcome.docs.length,
        note: outcome.note ?? "",
        cached: Boolean(outcome.cached),
        ms: env.now() - started,
      };
      if (adapter.site) {
        status[id].site = adapter.site(parsed, opts);
      }
      if (!env.signal?.aborted) {
        onUpdate(snapshot(false));
      }
    }),
  );
  return snapshot(true);
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}
