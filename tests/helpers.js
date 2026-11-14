import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function fixture(name) {
  return JSON.parse(readFileSync(path.join(root, "tests", "fixtures", `${name}.json`), "utf8"));
}

const HOSTS = {
  "api.stackexchange.com": "stackexchange",
  "hn.algolia.com": "hackernews",
  "api.github.com": "github",
  "api.openalex.org": "openalex",
  "api.crossref.org": "crossref",
  "www.ebi.ac.uk": "europepmc",
  "archive.org": "archive",
  "openlibrary.org": "openlibrary",
};

export function sourceOfUrl(url) {
  const host = new URL(url).hostname;
  return HOSTS[host] ?? (host.endsWith(".wikipedia.org") ? "wikipedia" : null);
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
