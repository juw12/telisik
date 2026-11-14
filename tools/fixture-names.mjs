// Which fixture file answers which request, shared by the tests and the capture tool.

const HOSTS = {
  "api.stackexchange.com": "stackexchange",
  "hn.algolia.com": "hackernews",
  "api.github.com": "github",
  "gitlab.com": "gitlab",
  "api.openalex.org": "openalex",
  "api.crossref.org": "crossref",
  "www.ebi.ac.uk": "europepmc",
  "archive.org": "archive",
  "api.mwmbl.org": "web",
  "zenodo.org": "zenodo",
  "clinicaltrials.gov": "clinicaltrials",
  "www.gov.uk": "govuk",
  "www.federalregister.gov": "federalregister",
};

const WIKI_SUFFIXES = ["wikipedia", "wikibooks", "wiktionary", "wikinews", "wikiquote", "wikivoyage", "wikisource"];

/** Source id (or fallback id) for a request URL, or null when no fixture belongs to that host. */
export function fixtureNameOf(url) {
  const { hostname, pathname } = new URL(url);
  if (hostname === "openlibrary.org") {
    return pathname.startsWith("/search/inside") ? "bookstext" : "openlibrary";
  }
  if (HOSTS[hostname]) {
    return HOSTS[hostname];
  }
  return WIKI_SUFFIXES.find((name) => hostname.endsWith(`.${name}.org`)) ?? null;
}

export const DEFAULT_FIXTURE_QUERY = "binary search tree";

/** Sources that have little to say about a programming term are captured with a query of their own kind. */
export const FIXTURE_QUERIES = {
  wiktionary: "tree",
  wikiquote: "Einstein quotes",
  wikivoyage: "Jakarta travel",
  wikinews: "earthquake news",
  wikisource: "constitution of the United States",
  wikibooks: "data structures trees",
  govuk: "renew passport",
  federalregister: "drone regulation",
  clinicaltrials: "metformin diabetes",
  bookstext: '"binary search tree"',
};

export function fixtureQuery(id) {
  return FIXTURE_QUERIES[id] ?? DEFAULT_FIXTURE_QUERY;
}
