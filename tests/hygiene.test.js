// Promises the product makes in words, checked against the files that ship.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BANGS, BEFORE_AI_DATE, parseQuery } from "../js/query.js";
import { API_HOSTS, LENSES, SOURCES, WILDCARD_HOSTS } from "../js/sources.js";
import { WEIGHTS } from "../js/rank.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const jsFiles = readdirSync(join(root, "js")).filter((name) => name.endsWith(".js"));
const cssFiles = readdirSync(join(root, "css")).filter((name) => name.endsWith(".css"));
const htmlFiles = ["index.html", "about.html"];
const shipped = [
  ...htmlFiles,
  ...jsFiles.map((name) => `js/${name}`),
  ...cssFiles.map((name) => `css/${name}`),
  "sw.js",
  "manifest.webmanifest",
  "opensearch.xml",
  "icons/icon.svg",
];

test("shipped text files have no byte-order mark and no mis-decoded characters", () => {
  for (const path of shipped) {
    const text = read(path);
    assert.notEqual(text.charCodeAt(0), 0xfeff, `${path} starts with a BOM`);
    assert.doesNotMatch(text, /\u00c3[\u0080-\u00bf]|\u00e2\u20ac|\ufffd/, `${path} contains mojibake`);
  }
});

test("pages load nothing from another host", () => {
  for (const path of htmlFiles) {
    const html = read(path);
    const loaders = html.match(/<(script|link|img|iframe|source|video|audio|object|embed)\b[^>]*>/gi) ?? [];
    for (const tag of loaders) {
      assert.doesNotMatch(tag, /(src|href)\s*=\s*["']?(https?:)?\/\//i, `${path}: ${tag}`);
    }
  }
  for (const name of cssFiles) {
    const css = read(`css/${name}`);
    assert.doesNotMatch(css, /@import|url\(\s*["']?(https?:)?\/\//i, `css/${name} loads a remote file`);
  }
});

test("pages have no inline script, inline style or inline event handler", () => {
  for (const path of htmlFiles) {
    const html = read(path);
    assert.doesNotMatch(html, /<style\b/i, `${path} has a style element`);
    assert.doesNotMatch(html, /\sstyle\s*=/i, `${path} has a style attribute`);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${path} has an inline script`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, `${path} has an inline event handler`);
  }
});

test("every source request goes to an allowed host over https", () => {
  const parsed = parseQuery("binary search tree");
  const adapters = [];
  for (const source of SOURCES) {
    adapters.push(source);
    if (source.fallback) {
      adapters.push(source.fallback);
    }
  }
  assert.ok(adapters.length >= 22);
  for (const adapter of adapters) {
    for (const opts of [{}, { before: "2022-11-30", after: "2015-01-01", wikiLang: "id" }]) {
      const url = new URL(adapter.request(parsed, opts));
      assert.equal(url.protocol, "https:", adapter.id);
      const allowed = API_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
      assert.ok(allowed, `${adapter.id} asks ${url.hostname}`);
    }
  }
});

test("only the engine makes network requests", () => {
  for (const name of jsFiles) {
    if (name === "engine.js") {
      continue;
    }
    const code = read(`js/${name}`);
    assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|new\s+EventSource/, `js/${name}`);
  }
});

test("the content security policy allows exactly the source hosts", () => {
  const html = read("index.html");
  const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  const connect = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("connect-src"))
    .split(/\s+/)
    .slice(1)
    .filter((value) => value !== "'self'");
  const expected = API_HOSTS.map((host) => (WILDCARD_HOSTS.includes(host) ? `https://*.${host}` : `https://${host}`));
  assert.deepEqual([...connect].sort(), [...expected].sort());
  assert.match(policy, /script-src 'self'(;|$)/);
  assert.match(policy, /style-src 'self'(;|$)/);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
});

test("ranking code cannot see the money settings", () => {
  for (const name of ["rank.js", "engine.js", "sources.js", "query.js", "text.js", "cite.js"]) {
    assert.doesNotMatch(read(`js/${name}`), /config\.js|CONFIG\b/, `js/${name} reads the money settings`);
  }
});

test("the offline shell lists every file the pages need", () => {
  const worker = read("sw.js");
  const needed = [
    ...htmlFiles,
    ...jsFiles.map((name) => `js/${name}`),
    ...cssFiles.map((name) => `css/${name}`),
    "manifest.webmanifest",
  ];
  for (const path of needed) {
    assert.ok(worker.includes(`"${path}"`), `sw.js does not cache ${path}`);
  }
  assert.doesNotMatch(worker, /https?:\/\//, "sw.js must not name another host");
});

test("the about page states the numbers the code uses", () => {
  const about = read("about.html");
  assert.ok(about.includes(`${WEIGHTS.text.toFixed(2)} &times; text`));
  assert.ok(about.includes(`${WEIGHTS.evidence.toFixed(2)} &times; evidence`));
  assert.ok(about.includes(`${WEIGHTS.upstream.toFixed(2)} &times; source position`));
  assert.equal(BEFORE_AI_DATE, "2022-11-30");
  assert.ok(about.includes("30 November 2022"));
  for (const key of Object.keys(BANGS)) {
    assert.ok(about.includes(`<code>!${key}</code>`), `bang !${key} is not documented`);
  }
  const index = read("index.html");
  for (const lens of Object.keys(LENSES)) {
    assert.ok(index.includes(`data-lens="${lens}"`), `lens ${lens} has no button`);
  }
});

test("the default-search address keeps the query out of the request", () => {
  assert.match(read("opensearch.xml"), /template="https:\/\/juw12\.github\.io\/telisik\/#q=\{searchTerms\}"/);
  assert.ok(read("about.html").includes("https://juw12.github.io/telisik/#q=%s"));
});
