import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import { fixtureQuery } from "../tools/fixture-names.mjs";
import { parseQuery } from "../js/query.js";
import {
  API_HOSTS,
  KIND_LABELS,
  LENSES,
  SOURCES,
  SOURCE_BY_ID,
  dictionaryTerm,
  isoDay,
  pickStackSite,
  planSources,
  rebuildAbstract,
  stackHost,
} from "../js/sources.js";

const parsed = parseQuery("binary search tree");
const ctx = { parsed, opts: {} };

// A dictionary answers with one entry; every other source must give several documents.
const MIN_DOCS = { wiktionary: 1 };

for (const source of SOURCES) {
  const ownParsed = parseQuery(fixtureQuery(source.id));

  test(`${source.id}: parses the captured answer into plain documents`, () => {
    const docs = source.parse(fixture(source.id), { parsed: ownParsed, opts: {} });
    assert.ok(docs.length >= (MIN_DOCS[source.id] ?? 3), `only ${docs.length} documents`);
    assert.ok(KIND_LABELS[source.kind], `kind ${source.kind} has no label`);
    const ids = new Set();
    docs.forEach((doc, index) => {
      assert.equal(doc.source, source.id);
      assert.equal(doc.kind, source.kind);
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
    const url = new URL(source.request(ownParsed, { before: "2022-11-30", after: "2010-01-01", wikiLang: "en" }));
    assert.equal(url.protocol, "https:");
    assert.ok(API_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)), url.hostname);
    const firstWord = ownParsed.text.split(/\s+/)[0].toLowerCase();
    assert.ok(decodeURIComponent(url.pathname + url.search).toLowerCase().includes(firstWord), url.href);
  });
}

test("there are twenty sources and each one describes itself", () => {
  assert.equal(SOURCES.length, 20);
  assert.equal(new Set(SOURCES.map((source) => source.id)).size, 20);
  for (const source of SOURCES) {
    assert.ok(source.label && source.about && /^https:\/\//.test(source.home), source.id);
  }
});

test("gitlab stands in for github and its documents say so", () => {
  const docs = SOURCE_BY_ID.github.fallback.parse(fixture("gitlab"), ctx);
  assert.ok(docs.length >= 3);
  for (const doc of docs) {
    assert.equal(doc.source, "github");
    assert.equal(doc.signals.via, "GitLab");
    assert.match(doc.url, /^https:\/\/gitlab\.com\//);
  }
});

test("sources with a small free allowance report what is left and keep answers for a day", () => {
  const day = 24 * 60 * 60 * 1000;
  for (const id of ["stackexchange", "github", "web", "wiktionary"]) {
    assert.equal(SOURCE_BY_ID[id].cacheMs, day, id);
  }
  assert.deepEqual(SOURCE_BY_ID.stackexchange.quota({ quota_remaining: 12, quota_max: 300 }), {
    remaining: 12,
    max: 300,
    per: "day",
  });
  assert.equal(SOURCE_BY_ID.stackexchange.quota({ items: [] }), null);
  const headers = new Headers({ "x-ratelimit-remaining": "3", "x-ratelimit-limit": "10" });
  assert.deepEqual(SOURCE_BY_ID.github.quota({}, headers), { remaining: 3, max: 10, per: "minute" });
  assert.equal(SOURCE_BY_ID.github.quota({}, new Headers()), null);
});

test("a registered Stack Exchange key is sent only when it looks like one", () => {
  assert.match(SOURCE_BY_ID.stackexchange.request(parsed, { stackKey: "abcDEF123456((" }), /&key=abcDEF123456/);
  assert.doesNotMatch(SOURCE_BY_ID.stackexchange.request(parsed, { stackKey: "" }), /&key=/);
  assert.doesNotMatch(SOURCE_BY_ID.stackexchange.request(parsed, { stackKey: "bad key&x=1" }), /&key=/);
});

test("wikipedia passes on its spelling suggestion as plain text", () => {
  assert.match(SOURCE_BY_ID.wikipedia.request(parsed, {}), /srinfo=suggestion/);
  assert.equal(SOURCE_BY_ID.wikipedia.suggest({ query: { searchinfo: { suggestion: " binary search tree " } } }), "binary search tree");
  assert.equal(SOURCE_BY_ID.wikipedia.suggest({ query: {} }), null);
  assert.equal(SOURCE_BY_ID.wikipedia.suggest(null), null);
});

test("the dictionary is asked for short terms only", () => {
  assert.equal(dictionaryTerm(parseQuery("tree")), "tree");
  assert.equal(dictionaryTerm(parseQuery("define serendipity")), "serendipity");
  assert.equal(dictionaryTerm(parseQuery("meaning of ad hoc")), "ad hoc");
  assert.equal(dictionaryTerm(parseQuery("binary search tree")), "");
  assert.deepEqual(SOURCE_BY_ID.wiktionary.emptyOn, [404]);
  assert.match(SOURCE_BY_ID.wiktionary.request(parseQuery("ad hoc"), {}), /\/definition\/ad_hoc$/);
});

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
  assert.deepEqual(planSources(parsed, "all"), [
    "wikipedia",
    "stackexchange",
    "hackernews",
    "github",
    "openalex",
    "europepmc",
    "archive",
    "openlibrary",
    "web",
    "wikibooks",
  ]);
  const asked = (query, lens = "all") => planSources(parseQuery(query), lens);
  assert.ok(asked("serendipity").includes("wiktionary"));
  assert.ok(asked('"to be or not to be" hamlet').includes("bookstext"));
  assert.ok(asked("metformin diabetes trial").includes("clinicaltrials"));
  assert.ok(asked("einstein quotes").includes("wikiquote"));
  assert.ok(asked("bali travel itinerary").includes("wikivoyage"));
  assert.ok(asked("earthquake news").includes("wikinews"));
  assert.ok(asked("drone regulation").includes("govuk"));
  assert.ok(asked("drone regulation").includes("federalregister"));
  assert.ok(!asked("drone regulation").includes("wikivoyage"));
  assert.deepEqual(asked("anything at all", "official"), [
    "wikipedia",
    "wikisource",
    "clinicaltrials",
    "govuk",
    "federalregister",
  ]);
  assert.ok(asked("protein folding", "research").includes("zenodo"));
  assert.ok(!asked("protein folding", "research").includes("clinicaltrials"));
  assert.deepEqual(asked("x in:gov"), ["govuk"]);
  assert.deepEqual(asked("x in:dict"), ["wiktionary"]);
  assert.deepEqual(asked("x in:trials"), ["clinicaltrials"]);
  assert.deepEqual(asked("x in:web"), ["web"]);
  assert.deepEqual(asked("x in:data"), ["zenodo"]);
  assert.deepEqual(asked("x in:law"), ["federalregister"]);
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
