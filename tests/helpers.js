import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fixtureNameOf } from "../tools/fixture-names.mjs";

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function fixture(name) {
  return JSON.parse(readFileSync(path.join(root, "tests", "fixtures", `${name}.json`), "utf8"));
}

export function sourceOfUrl(url) {
  return fixtureNameOf(url);
}

/** fetch() stand-in that answers from the captured fixtures; `overrides` maps a source to a handler. */
export function fixtureFetch(overrides = {}, calls = []) {
  return async (url, init = {}) => {
    const name = sourceOfUrl(url);
    calls.push({ url, name });
    if (overrides[name]) {
      return overrides[name](url, init);
    }
    return new Response(JSON.stringify(fixture(name)), { status: 200 });
  };
}

export function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

/** A request that never answers but, like the real fetch, rejects when its signal aborts. */
export function hang(url, init = {}) {
  return new Promise((resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}
