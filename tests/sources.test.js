import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import { parseQuery } from "../js/query.js";
import {
  API_HOSTS,
  LENSES,
  SOURCES,
  SOURCE_BY_ID,
  isoDay,
  pickStackSite,
  planSources,
  rebuildAbstract,
  stackHost,
} from "../js/sources.js";

const parsed = parseQuery("binary search tree");
const ctx = { parsed, opts: {} };

for (const source of SOURCES) {
  test(`${source.id}: parses the captured answer into plain documents`, () => {
    const docs = source.parse(fixture(source.id), ctx);
    assert.ok(docs.length >= 3, `only ${docs.length} documents`);
    const ids = new Set();
    docs.forEach((doc, index) => {
      assert.equal(doc.source, source.id);
      assert.equal(doc.upstreamRank, index);
      assert.ok(doc.title.length > 0, "title");
      assert.match(doc.url, /^https:\/\/[^\s<>"]+$/, `url ${doc.url}`);
      assert.ok(doc.snippet.length > 0, "snippet");
      assert.ok(!/<[a-z/][^>]*>/i.test(doc.title + doc.snippet), "no markup in text");
      assert.ok(!/&(amp|lt|gt|quot|#\d+);/.test(doc.title + doc.snippet), "no undecoded entities");
      assert.ok(doc.date === null || /^\d{4}-\d{2}-\d{2}$/.test(doc.date), `date ${doc.date}`);
      assert.ok(!ids.has(doc.id), "unique id");
      ids.add(doc.id);
    });
  });

  test(`${source.id}: request goes to an allowed https host and carries the date window`, () => {
    const url = new URL(source.request(parsed, { before: "2022-11-30", after: "2010-01-01", wikiLang: "en" }));
    assert.equal(url.protocol, "https:");
    assert.ok(API_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)), url.hostname);
    assert.ok(decodeURIComponent(url.search).includes("binary search tree"));
  });
}

test("crossref fallback parses into openalex-shaped documents", () => {
  const docs = SOURCE_BY_ID.openalex.fallback.parse(fixture("crossref"), ctx);
  assert.ok(docs.length >= 3);
  assert.equal(docs[0].source, "openalex");
  assert.equal(docs[0].signals.via, "Crossref");
  assert.match(docs[0].url, /^https:\/\/doi\.org\//);
});

test("wikipedia documents are marked as living pages", () => {
  const docs = SOURCE_BY_ID.wikipedia.parse(fixture("wikipedia"), ctx);
  assert.ok(docs.every((doc) => doc.living && doc.date === null));
  assert.equal(docs[0].title, "Binary search tree");
});

test("date window reaches each API in its own syntax", () => {
  const opts = { before: "2022-11-30" };
  assert.match(SOURCE_BY_ID.stackexchange.request(parsed, opts), /todate=1669766400/);
  assert.match(decodeURIComponent(SOURCE_BY_ID.hackernews.request(parsed, opts)), /created_at_i<1669766400/);
  assert.match(decodeURIComponent(SOURCE_BY_ID.github.request(parsed, opts)), /created:<2022-11-30/);
  assert.match(decodeURIComponent(SOURCE_BY_ID.openalex.request(parsed, opts)), /to_publication_date:2022-11-30/);
  assert.match(decodeURIComponent(SOURCE_BY_ID.europepmc.request(parsed, opts)), /FIRST_PDATE:\[1800-01-01 TO 2022-11-30\]/);
});

test("stack exchange site router", () => {
  assert.equal(pickStackSite("python list comprehension"), "stackoverflow");
  assert.equal(pickStackSite("proof of the prime number theorem"), "math");
  assert.equal(pickStackSite("why is the sky blue"), "physics");
  assert.equal(pickStackSite("bolt preload torque"), "engineering");
  assert.equal(pickStackSite("sourdough starter recipe"), "cooking");
  assert.equal(stackHost("stackoverflow"), "stackoverflow.com");
  assert.equal(stackHost("physics"), "physics.stackexchange.com");
  const forced = parseQuery("entropy se:chemistry");
  assert.match(SOURCE_BY_ID.stackexchange.request(forced, {}), /site=chemistry/);
});

test("stack exchange quota errors are reported as a limit", () => {
  const failure = SOURCE_BY_ID.stackexchange.failure({ error_id: 502, error_message: "too many requests from this IP" });
  assert.equal(failure.state, "limit");
  assert.equal(SOURCE_BY_ID.stackexchange.failure({ items: [] }), null);
});

test("lenses and in: operators choose the sources", () => {
  assert.equal(planSources(parsed, "all").length, 8);
  assert.deepEqual(planSources(parsed, "discuss"), ["stackexchange", "hackernews", "github"]);
  assert.deepEqual(planSources(parseQuery("x in:papers"), "discuss"), ["openalex"]);
  for (const lens of Object.values(LENSES)) {
    for (const id of Object.keys(lens.weights)) {
      assert.ok(SOURCE_BY_ID[id], id);
    }
  }
});

test("helpers", () => {
  assert.equal(rebuildAbstract({ world: [1], Hello: [0, 2] }), "Hello world Hello");
  assert.equal(rebuildAbstract(null), "");
  assert.equal(isoDay(1669766400), "2022-11-30");
  assert.equal(isoDay("2021"), "2021-01-01");
  assert.equal(isoDay("2021-05-17T10:00:00Z"), "2021-05-17");
  assert.equal(isoDay(""), null);
});
