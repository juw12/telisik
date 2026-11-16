// Query parser: free text plus a few operators. Everything is decided here, in the browser.
//   "exact phrase"   -exclude   in:papers   se:physics   before:2022   after:2019-06   !g (other engine)

import { STOPWORDS, fold, terms, tokenize } from "./text.js";

/** Date that separates the pre-ChatGPT web from what came after (ChatGPT launched 2022-11-30). */
export const BEFORE_AI_DATE = "2022-11-30";

export const SOURCE_ALIASES = {
  wiki: "wikipedia",
  wikipedia: "wikipedia",
  qa: "stackexchange",
  so: "stackexchange",
  stack: "stackexchange",
  stackexchange: "stackexchange",
  hn: "hackernews",
  hackernews: "hackernews",
  discuss: "hackernews",
  code: "github",
  github: "github",
  gh: "github",
  papers: "openalex",
  paper: "openalex",
  research: "openalex",
  openalex: "openalex",
  med: "europepmc",
  medical: "europepmc",
  pubmed: "europepmc",
  europepmc: "europepmc",
  archive: "archive",
  ia: "archive",
  books: "openlibrary",
  book: "openlibrary",
  openlibrary: "openlibrary",
  web: "web",
  www: "web",
  mwmbl: "web",
  dict: "wiktionary",
  define: "wiktionary",
  dictionary: "wiktionary",
  wiktionary: "wiktionary",
  textbook: "wikibooks",
  textbooks: "wikibooks",
  wikibooks: "wikibooks",
  texts: "wikisource",
  wikisource: "wikisource",
  quote: "wikiquote",
  quotes: "wikiquote",
  wikiquote: "wikiquote",
  travel: "wikivoyage",
  wikivoyage: "wikivoyage",
  news: "wikinews",
  wikinews: "wikinews",
  data: "zenodo",
  dataset: "zenodo",
  zenodo: "zenodo",
  gov: "govuk",
  uk: "govuk",
  govuk: "govuk",
  law: "federalregister",
  us: "federalregister",
  fedreg: "federalregister",
  federalregister: "federalregister",
  trial: "clinicaltrials",
  trials: "clinicaltrials",
  clinicaltrials: "clinicaltrials",
  fulltext: "bookstext",
  inside: "bookstext",
  bookstext: "bookstext",
};

/** Bangs hand the query to another engine. Telisik does not pretend to cover the whole web. */
export const BANGS = {
  g: { name: "Google", url: "https://www.google.com/search?q=%s" },
  ddg: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  b: { name: "Brave Search", url: "https://search.brave.com/search?q=%s" },
  k: { name: "Kagi", url: "https://kagi.com/search?q=%s" },
  m: { name: "Marginalia", url: "https://marginalia-search.com/search?query=%s" },
  r: { name: "Reddit", url: "https://www.reddit.com/search/?q=%s" },
  yt: { name: "YouTube", url: "https://www.youtube.com/results?search_query=%s" },
  maps: { name: "OpenStreetMap", url: "https://www.openstreetmap.org/search?query=%s" },
  s: { name: "Google Scholar", url: "https://scholar.google.com/scholar?q=%s" },
  w: { name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search=%s" },
  gh: { name: "GitHub", url: "https://github.com/search?q=%s" },
  so: { name: "Stack Overflow", url: "https://stackoverflow.com/search?q=%s" },
  hn: { name: "Hacker News", url: "https://hn.algolia.com/?q=%s" },
  a: { name: "Internet Archive", url: "https://archive.org/search?query=%s" },
};

export function bangUrl(key, text) {
  const bang = BANGS[key];
  return bang ? bang.url.replace("%s", encodeURIComponent(text)) : null;
}

/** "2022" -> "2022-01-01", "2022-06" -> "2022-06-01", full dates pass through; anything else is null. */
export function normalizeDate(value) {
  const match = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(String(value ?? "").trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2] ?? 1);
  const day = Number(match[3] ?? 1);
  if (year < 1000 || year > 2999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const QUESTION_OPENERS = new Set(["who", "what", "why", "how", "when", "where", "which"]);

const RECENCY_WORDS = new Set(["latest", "newest", "recent", "new", "today", "current", "now", "terbaru"]);

/** Words that carry no topic in a question ("how does X work"); dropped only from the upstream query. */
const FILLERS = new Set(["work", "works", "working", "explained", "explain", "mean", "means", "exactly", "please"]);

const FILLER_TERMS = new Set([...FILLERS].flatMap((word) => terms(word)));

/**
 * The public search APIs match keywords, mostly with AND, so a whole question finds little.
 * They get the content words and the quoted phrases; ranking still uses every term.
 */
function upstreamQuery(keptWords) {
  const parts = [];
  for (const word of keptWords) {
    if (word.startsWith('"')) {
      parts.push(word);
      continue;
    }
    const tokens = tokenize(word).filter((token) => !STOPWORDS.has(token) && !FILLERS.has(token));
    if (tokens.length) {
      parts.push(word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+#]+$/gu, ""));
    }
  }
  return parts.join(" ").trim();
}

export function parseQuery(raw) {
  const input = String(raw ?? "").trim();
  const parsed = {
    raw: input,
    text: "",
    terms: [],
    phrases: [],
    excluded: [],
    sources: [],
    before: null,
    after: null,
    bang: null,
    upstream: "",
    intent: null,
    isQuestion: false,
    seSite: null,
    wantsRecent: false,
  };
  const kept = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  for (const match of input.matchAll(pattern)) {
    const phrase = match[1];
    const word = match[2];
    if (phrase !== undefined) {
      const clean = phrase.trim();
      if (clean) {
        parsed.phrases.push(fold(clean));
        kept.push(`"${clean}"`);
      }
      continue;
    }
    const bangMatch = /^!([a-z]+)$/i.exec(word);
    if (bangMatch && BANGS[bangMatch[1].toLowerCase()]) {
      parsed.bang = bangMatch[1].toLowerCase();
      continue;
    }
    const siteMatch = /^se:([a-z0-9.]+)$/i.exec(word);
    if (siteMatch) {
      parsed.seSite = siteMatch[1].toLowerCase();
      continue;
    }
    const operator = /^(in|before|after):(.+)$/i.exec(word);
    if (operator) {
      const name = operator[1].toLowerCase();
      const value = operator[2].toLowerCase();
      if (name === "in" && SOURCE_ALIASES[value]) {
        if (!parsed.sources.includes(SOURCE_ALIASES[value])) {
          parsed.sources.push(SOURCE_ALIASES[value]);
        }
        continue;
      }
      const date = name === "in" ? null : normalizeDate(value);
      if (date) {
        parsed[name] = date;
        continue;
      }
    }
    if (/^-[\p{L}\p{N}]/u.test(word)) {
      parsed.excluded.push(fold(word.slice(1)));
      continue;
    }
    kept.push(word);
  }
  parsed.text = kept.join(" ");
  const allTerms = [...new Set(terms(parsed.text))];
  const topicTerms = allTerms.filter((term) => !FILLER_TERMS.has(term));
  parsed.terms = topicTerms.length ? topicTerms : allTerms;
  parsed.upstream = upstreamQuery(kept) || parsed.text;
  const firstWord = fold(kept[0] ?? "").replace(/[^a-z]/g, "");
  parsed.intent = { why: "why", what: "what", who: "what", how: "how" }[firstWord] ?? null;
  // A question or a description ("medicine that kills bacteria") rather than the name of a thing:
  // it opens with a question word, or has three or more words with a joining word among them.
  const words = tokenize(parsed.text);
  parsed.isQuestion =
    !parsed.phrases.length &&
    (QUESTION_OPENERS.has(firstWord) || (words.length >= 3 && words.some((word) => STOPWORDS.has(word))));
  const currentYear = new Date().getFullYear();
  parsed.wantsRecent = kept.some((word) => {
    const lower = word.toLowerCase();
    return RECENCY_WORDS.has(lower) || (/^\d{4}$/.test(lower) && Number(lower) >= currentYear - 1);
  });
  return parsed;
}
