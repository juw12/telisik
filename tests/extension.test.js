// The browser extension: where it sends a search, and what it is allowed to do.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HOME, MAX_QUERY, cleanQuery, searchUrl } from "../extension/url.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extension = join(root, "extension");
const read = (path) => readFileSync(join(extension, path), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const textFiles = readdirSync(extension).filter((name) => /\.(html|js|css|json)$/.test(name));
const htmlFiles = textFiles.filter((name) => name.endsWith(".html"));
const jsFiles = textFiles.filter((name) => name.endsWith(".js"));

/** The same reading the site does in js/app.js readLocation(). */
function queryTheSiteWillSee(address) {
  return (new URLSearchParams(new URL(address).hash.slice(1)).get("q") || "").trim();
}

test("an empty search opens the home page", () => {
  for (const nothing of ["", "   ", "\n\t", null, undefined]) {
    assert.equal(searchUrl(nothing), HOME);
  }
});

test("the query travels after the # and nowhere else", () => {
  const url = new URL(searchUrl("binary search tree"));
  assert.equal(url.origin + url.pathname, HOME);
  assert.equal(url.search, "", "a query string would be sent to the server");
  assert.equal(url.hash, "#q=binary+search+tree");
});

test("the site reads back exactly what was typed", () => {
  const samples = [
    "binary search tree",
    "c++ & c# = 100% fun?",
    "what is a #hashtag",
    "\"exact phrase\" site:example.org -noise",
    "!w R\u00e9union",
    "\u65e5\u672c\u8a9e \u691c\u7d22",
    "a+b=c",
    "q=1&lens=code#x",
  ];
  for (const sample of samples) {
    assert.equal(queryTheSiteWillSee(searchUrl(sample)), sample);
  }
});

test("a query cannot add its own settings to the address", () => {
  const params = new URLSearchParams(new URL(searchUrl("cats&lens=code&before_ai=1")).hash.slice(1));
  assert.deepEqual([...params.keys()], ["q"]);
});

test("selected text is tidied: one line, single spaces, capped like the search box", () => {
  assert.equal(cleanQuery("  two\n  lines\tof   text  "), "two lines of text");
  assert.equal(cleanQuery(42), "42");
  const long = "word ".repeat(200);
  assert.ok(cleanQuery(long).length <= MAX_QUERY);
  assert.equal(cleanQuery(long), cleanQuery(long).trim());
  const index = readFileSync(join(root, "index.html"), "utf8");
  assert.ok(index.includes(`maxlength="${MAX_QUERY}"`), "the site's search box has a different limit");
});

test("the extension and the site agree on the search address", () => {
  const opensearch = readFileSync(join(root, "opensearch.xml"), "utf8");
  assert.ok(opensearch.includes(`template="${HOME}#q={searchTerms}"`));
  assert.equal(manifest.homepage_url, HOME);
});

test("the extension asks for no access to any site", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["contextMenus"]);
  for (const key of [
    "host_permissions",
    "optional_permissions",
    "optional_host_permissions",
    "content_scripts",
    "web_accessible_resources",
    "externally_connectable",
    "chrome_settings_overrides",
    "declarative_net_request",
  ]) {
    assert.equal(manifest[key], undefined, `manifest has ${key}`);
  }
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions, { required: ["none"] });
});

test("the extension pages are forbidden from making any network request", () => {
  const policy = manifest.content_security_policy.extension_pages;
  const parts = policy.split(";").map((part) => part.trim());
  assert.ok(parts.includes("default-src 'none'"));
  assert.ok(parts.includes("script-src 'self'"));
  assert.ok(parts.includes("style-src 'self'"));
  assert.ok(!parts.some((part) => part.startsWith("connect-src")), "connect-src would reopen the network");
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|https?:|\*/);
  for (const name of jsFiles) {
    assert.doesNotMatch(
      read(name),
      /\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|new\s+EventSource|importScripts|\beval\s*\(/,
      `extension/${name}`
    );
  }
});

test("every file the manifest names is in the folder", () => {
  const named = [
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.action.default_popup,
    manifest.background.service_worker,
    manifest.chrome_url_overrides.newtab,
  ];
  for (const path of named) {
    assert.ok(existsSync(join(extension, path)), `extension/${path} is missing`);
  }
  assert.equal(manifest.background.type, "module");
});

test("the manifest in the folder is Chrome's; the pack tool writes Firefox's", () => {
  // Chrome reports a manifest error when "background.scripts" is present; Firefox needs exactly that key.
  assert.equal(manifest.background.scripts, undefined);
  const packTool = readFileSync(join(root, "tools", "pack_extension.py"), "utf8");
  assert.match(packTool, /"scripts": \[background\["service_worker"\]\]/);
});

test("extension pages have no inline code and load nothing from another host", () => {
  assert.deepEqual([...htmlFiles].sort(), ["newtab.html", "popup.html"]);
  for (const name of htmlFiles) {
    const html = read(name);
    assert.doesNotMatch(html, /<style\b/i, `${name} has a style element`);
    assert.doesNotMatch(html, /\sstyle\s*=/i, `${name} has a style attribute`);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${name} has an inline script`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, `${name} has an inline event handler`);
    const loaders = html.match(/<(script|link|img|iframe|source|video|audio|object|embed)\b[^>]*>/gi) ?? [];
    for (const tag of loaders) {
      assert.doesNotMatch(tag, /(src|href)\s*=\s*["']?(https?:)?\/\//i, `${name}: ${tag}`);
    }
    for (const [, target] of html.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)) {
      assert.ok(target.startsWith(HOME), `${name} links to ${target}`);
    }
  }
  assert.doesNotMatch(read("page.css"), /@import|url\(/i);
});

test("extension text files have no byte-order mark and no mis-decoded characters", () => {
  for (const name of textFiles) {
    const text = read(name);
    assert.notEqual(text.charCodeAt(0), 0xfeff, `${name} starts with a BOM`);
    assert.doesNotMatch(text, /\u00c3[\u0080-\u00bf]|\u00e2\u20ac|\ufffd/, `${name} contains mojibake`);
  }
});

test("the new tab page names the real address-bar keyword and the store limits are met", () => {
  assert.ok(read("newtab.html").includes(`<kbd>${manifest.omnibox.keyword}</kbd>`));
  assert.ok(manifest.description.length <= 132, "Chrome Web Store allows 132 characters");
  assert.ok(manifest.name.length <= 75);
  assert.ok(manifest.short_name.length <= 12);
  const pack = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(manifest.version, pack.version);
});
