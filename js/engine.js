// The search itself: ask every planned source in parallel, never wait for a slow one, rank what came
// back. Runs entirely in the page; the only network requests are the source APIs themselves.

import { BEFORE_AI_DATE, parseQuery } from "./query.js";
import { SOURCE_BY_ID, planSources } from "./sources.js";
import { bestPassages, rank } from "./rank.js";
import { terms as toTerms } from "./text.js";

export const TIMEOUT_MS = 8000;
const CACHE_KEY = "telisik.cache.v1";
/** Keys from before the rename to Telisik; removed on first load. */
const OLD_CACHE_KEYS = ["sumber.cache.v1", "sumber.cache.v2", "sumber.backoff.v1"];
/** How long a saved answer counts as fresh. Sources with a small free quota set a longer cacheMs. */
export const CACHE_TTL_MS = 60 * 60 * 1000;
/** A saved answer older than this is thrown away even as a last resort. */
export const CACHE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 150;
const BACKOFF_KEY = "telisik.backoff.v1";

/**
 * Small LRU on top of any Storage-like object; silently becomes memory-only when storage fails.
 * get() returns a fresh value; peek() returns any saved value with its age, for when a source is down.
 */
export function createCache(storage, now = () => Date.now()) {
  let memory = {};
  try {
    for (const oldKey of OLD_CACHE_KEYS) {
      storage?.removeItem(oldKey);
    }
    memory = JSON.parse(storage?.getItem(CACHE_KEY) ?? "{}") ?? {};
  } catch {
    memory = {};
  }
  function newestFirst() {
    return Object.keys(memory).sort((a, b) => memory[b].t - memory[a].t);
  }
  function trim(limit) {
    for (const key of newestFirst()) {
      if (now() - memory[key].t > CACHE_KEEP_MS) {
        delete memory[key];
      }
    }
    for (const key of newestFirst().slice(limit)) {
      delete memory[key];
    }
  }
  function persist() {
    // A full browser store is the usual failure: halve what is kept until the write goes through.
    for (let limit = CACHE_MAX; limit >= 1; limit = Math.floor(limit / 2)) {
      trim(limit);
      try {
        storage?.setItem(CACHE_KEY, JSON.stringify(memory));
        return;
      } catch {
        // Try again with fewer entries.
      }
    }
    try {
      storage?.removeItem(CACHE_KEY);
    } catch {
      // Storage is unavailable (private mode); the in-memory copy still works.
    }
  }
  return {
    get(key, ttlMs = CACHE_TTL_MS) {
      const entry = memory[key];
      if (!entry || now() - entry.t > ttlMs) {
        return null;
      }
      return entry.v;
    },
    peek(key) {
      const entry = memory[key];
      if (!entry || now() - entry.t > CACHE_KEEP_MS) {
        return null;
      }
      return { value: entry.v, ageMs: now() - entry.t };
    },
    set(key, value) {
      memory[key] = { t: now(), v: value };
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

/** "3 minutes", "5 hours", "2 days": how old a saved answer is, in words. */
export function ageWords(ageMs) {
  const minutes = Math.max(1, Math.round(ageMs / 60000));
  if (minutes < 90) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 36) {
    return `${hours} hours`;
  }
  return `${Math.round(hours / 24)} days`;
}

function fromCache(saved) {
  const docs = Array.isArray(saved?.d) ? saved.d : [];
  return { state: docs.length ? "ok" : "empty", docs, cached: true, suggestion: saved?.s ?? null };
}

/**
 * Ask one source. An adapter may name a second, narrower request after seeing its first answer
 * (GitHub does, for queries its best-match order handles badly). The second request goes through
 * the same cache, pause and time limit. When it fails the first answer stands, marked as partial
 * with a note, so the ledger and the evaluation can tell a whole answer from half of one.
 */
async function fetchSource(adapter, parsed, opts, env) {
  const first = await fetchUrl(adapter, adapter.request(parsed, opts), parsed, opts, env);
  if (!adapter.followUp || !["ok", "empty"].includes(first.state)) {
    return first;
  }
  const nextUrl = adapter.followUp(parsed, first.docs, opts);
  if (!nextUrl) {
    return first;
  }
  const second = await fetchUrl(adapter, nextUrl, parsed, opts, env);
  if (second.state === "cancelled") {
    return second;
  }
  if (FAILED.includes(second.state)) {
    return {
      ...first,
      partial: second.state,
      note: `${adapter.label}'s second request ${FAILURE_WORDS[second.state]}; showing its first answer only.`,
    };
  }
  if (second.state !== "ok") {
    return first;
  }
  const docs = adapter.mergeFollowUp(parsed, first.docs, second.docs);
  return {
    ...first,
    state: docs.length ? "ok" : "empty",
    docs,
    cached: Boolean(first.cached && second.cached),
    quota: second.quota ?? first.quota ?? null,
  };
}

async function fetchUrl(adapter, url, parsed, opts, env) {
  // A saved answer is used before anything else, so a paused source still answers what it already has.
  const fresh = env.cache?.get(url, adapter.cacheMs ?? CACHE_TTL_MS);
  if (fresh) {
    return fromCache(fresh);
  }
  if ((env.backoff[adapter.id] ?? 0) > env.now()) {
    return { state: "limit", docs: [], note: "Paused for a few minutes after the source asked us to slow down." };
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
    if (adapter.emptyOn?.includes(response.status)) {
      env.cache?.set(url, { d: [], s: null });
      return { state: "empty", docs: [] };
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
    const suggestion = adapter.suggest?.(json) ?? null;
    const quota = adapter.quota?.(json, response.headers) ?? null;
    env.cache?.set(url, { d: docs, s: suggestion });
    return { state: docs.length ? "ok" : "empty", docs, suggestion, quota };
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

const FAILED = ["error", "limit", "timeout"];
const FAILURE_WORDS = { error: "could not be reached", limit: "is rate-limited", timeout: "did not answer in time" };

/** When a source fails: its own older saved answer first, then the stand-in source, then the failure. */
async function recover(adapter, outcome, parsed, opts, env) {
  const saved = env.cache?.peek(adapter.request(parsed, opts));
  if (saved && Array.isArray(saved.value?.d) && saved.value.d.length) {
    return {
      ...fromCache(saved.value),
      stale: true,
      ageMs: saved.ageMs,
      note: `${adapter.label} ${FAILURE_WORDS[outcome.state]}; showing the answer saved ${ageWords(saved.ageMs)} ago.`,
    };
  }
  if (adapter.fallback) {
    const second = await fetchSource(adapter.fallback, parsed, opts, env);
    if (second.state === "ok") {
      return { ...second, note: `${adapter.label} did not answer; results come from ${adapter.fallback.label}.` };
    }
    if (second.state === "cancelled") {
      return second;
    }
  }
  return outcome;
}

/**
 * Wikipedia proposes a spelling for almost any rare query ("bolt preload" -> "boat payload").
 * The proposal is believed only when it replaces at least one typed word, and every word it
 * replaces is absent from the titles and excerpts of the results.
 */
export function isCredibleSuggestion(suggestion, parsed, results) {
  if (!suggestion) {
    return false;
  }
  const proposed = new Set(toTerms(suggestion));
  const replaced = toTerms(parsed.upstream).filter((term) => !proposed.has(term));
  if (!replaced.length) {
    return false;
  }
  const found = new Set();
  for (const result of results) {
    for (const term of toTerms(`${result.title} ${result.alias ?? ""} ${result.snippet} ${result.extra ?? ""}`)) {
      found.add(term);
    }
  }
  return replaced.every((term) => !found.has(term));
}

/**
 * Run one search.
 * options: { lens, beforeAI, wikiLang, keys, signal, fetch, cache, storage, timeoutMs, now }
 * onUpdate(state) is called whenever a source settles; the returned promise resolves with the
 * final state: { parsed, window, planned, status, suggestion, results, passages, done }.
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
  env.backoff = readBackoff(env.storage);
  const opts = {
    ...window_,
    wikiLang: options.wikiLang ?? "en",
    lens: options.lens ?? "all",
    stackKey: options.keys?.stackexchange ?? "",
  };
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
    // A spelling suggestion is passed on only once every source has settled, and only when each
    // word it replaces was found in no result: a word the sources did find is not a typing mistake.
    const suggestion = done
      ? (planned.map((id) => status[id].suggestion).find((value) => isCredibleSuggestion(value, parsed, results)) ??
        null)
      : null;
    return {
      parsed,
      window: window_,
      planned,
      status: structuredCloneSafe(status),
      suggestion,
      results,
      passages,
      done,
      // The unranked documents, kept only when the evaluation tool asks for them.
      ...(options.keepPool ? { pool } : {}),
    };
  }

  await Promise.all(
    planned.map(async (id) => {
      const adapter = SOURCE_BY_ID[id];
      const started = env.now();
      let outcome = await fetchSource(adapter, parsed, opts, env);
      if (FAILED.includes(outcome.state)) {
        outcome = await recover(adapter, outcome, parsed, opts, env);
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
        partial: outcome.partial ?? null,
        cached: Boolean(outcome.cached),
        stale: Boolean(outcome.stale),
        ageMs: outcome.ageMs ?? null,
        quota: outcome.quota ?? null,
        suggestion: outcome.suggestion ?? null,
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
