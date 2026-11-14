// Source adapters. Each one turns a parsed query into one public, key-less, CORS-enabled API request
// and turns the JSON answer into the same plain document shape. Nothing here writes HTML.

import { decodeEntities, fold, stripHtml, tokenize, truncate } from "./text.js";

const enc = encodeURIComponent;

export const KIND_LABELS = {
  encyclopedia: "Encyclopedia",
  qa: "Q&A",
  discussion: "Discussion",
  code: "Code",
  paper: "Paper",
  medical: "Medical paper",
  book: "Book",
  archive: "Archive",
};

/** Lenses choose which sources are asked and how much each one counts. */
export const LENSES = {
  all: {
    label: "All",
    hint: "Every source",
    weights: {
      wikipedia: 1.1,
      stackexchange: 1.05,
      hackernews: 1,
      openalex: 1,
      github: 0.9,
      openlibrary: 0.9,
      europepmc: 0.85,
      archive: 0.85,
    },
  },
  learn: {
    label: "Learn",
    hint: "Encyclopedia, answers, books",
    weights: { wikipedia: 1.2, stackexchange: 1.1, openlibrary: 1, archive: 0.9, openalex: 0.8 },
  },
  research: {
    label: "Research",
    hint: "Papers and archives",
    weights: { openalex: 1.2, europepmc: 1.1, wikipedia: 0.9, archive: 0.85, openlibrary: 0.8 },
  },
  build: {
    label: "Build",
    hint: "Answers, code, discussion",
    weights: { stackexchange: 1.2, github: 1.15, hackernews: 1, wikipedia: 0.8 },
  },
  discuss: {
    label: "Discuss",
    hint: "What people argued about",
    weights: { hackernews: 1.2, stackexchange: 1.1, github: 0.7 },
  },
};

/** Stack Exchange has ~180 sites and the API needs exactly one. A small keyword router picks it. */
export const SE_SITES = {
  stackoverflow: "Stack Overflow",
  superuser: "Super User",
  askubuntu: "Ask Ubuntu",
  unix: "Unix & Linux",
  math: "Mathematics",
  stats: "Cross Validated",
  physics: "Physics",
  engineering: "Engineering",
  electronics: "Electrical Engineering",
  "3dprinting": "3D Printing",
  mechanics: "Motor Vehicle Maintenance",
  diy: "Home Improvement",
  cooking: "Seasoned Advice",
  english: "English Language",
  tex: "TeX - LaTeX",
  money: "Personal Finance",
  travel: "Travel",
  biology: "Biology",
  chemistry: "Chemistry",
  history: "History",
  security: "Information Security",
  psychology: "Psychology & Neuroscience",
  medicalsciences: "Medical Sciences",
};

const SE_ROUTES = [
  ["math", "theorem proof integral derivative eigenvalue polynomial calculus algebra topology prime lemma conjecture"],
  ["stats", "regression variance bayesian probability statistics statistical correlation anova likelihood confidence"],
  [
    "physics",
    "physics gravity quantum relativity photon electron entropy thermodynamics momentum sky light magnetic wave",
  ],
  ["engineering", "torque beam stress strain bearing weld fatigue gear tolerance bolt hydraulic stiffness shaft"],
  ["electronics", "resistor capacitor voltage pcb mosfet transistor circuit amplifier microcontroller inductor diode"],
  ["3dprinting", "filament pla petg nozzle extruder slicer stringing warping"],
  ["mechanics", "car engine brake clutch tire tyre gearbox coolant spark"],
  ["diy", "drywall plumbing faucet wiring breaker toilet roof insulation paint"],
  ["cooking", "recipe bake baking cook cooking dough sauce simmer roast sourdough boil"],
  ["english", "grammar synonym idiom etymology pronunciation tense adjective preposition"],
  ["tex", "latex tex tikz beamer bibtex overleaf"],
  ["money", "mortgage tax taxes invest investing retirement loan savings dividend etf"],
  ["travel", "visa flight airport passport luggage itinerary layover"],
  ["biology", "cell protein dna gene enzyme species evolution bacteria"],
  ["chemistry", "molecule reaction acid solvent polymer oxidation catalyst"],
  ["history", "empire medieval dynasty revolution ancient century war"],
  ["security", "encryption password vulnerability exploit malware phishing certificate"],
  ["psychology", "sleep memory brain cognitive neuron anxiety behavior behaviour psychology attention dopamine"],
  ["medicalsciences", "disease symptom symptoms vaccine dose treatment infection blood diabetes cancer"],
  ["askubuntu", "ubuntu apt snap"],
  ["unix", "linux bash shell grep awk sed systemd cron"],
  ["superuser", "windows excel outlook keyboard monitor usb bios wifi router"],
].map(([site, words]) => [site, new Set(words.split(" "))]);

export function pickStackSite(text) {
  const tokens = tokenize(text);
  let best = "stackoverflow";
  let bestHits = 0;
  for (const [site, words] of SE_ROUTES) {
    let hits = 0;
    for (const token of tokens) {
      if (words.has(token)) {
        hits += 1;
      }
    }
    if (hits > bestHits) {
      best = site;
      bestHits = hits;
    }
  }
  return best;
}

export function stackHost(site) {
  const own = {
    stackoverflow: "stackoverflow.com",
    superuser: "superuser.com",
    serverfault: "serverfault.com",
    askubuntu: "askubuntu.com",
    mathoverflow: "mathoverflow.net",
  };
  return own[site] ?? `${site}.stackexchange.com`;
}

function unixSeconds(isoDate) {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 1000);
}

/** Any date-like value to "YYYY-MM-DD", or null. */
export function isoDay(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    const date = new Date(value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  const text = String(value);
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(text);
  if (!match) {
    return null;
  }
  return `${match[1]}-${match[2] ?? "01"}-${match[3] ?? "01"}`;
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function list(value) {
  if (value === null || value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function baseDoc(source, kind, nativeId, rank) {
  return {
    id: `${source}:${nativeId}`,
    source,
    kind,
    title: "",
    url: "",
    snippet: "",
    snippetIsMeta: false,
    extra: "",
    date: null,
    dateIsYear: false,
    author: "",
    venue: "",
    signals: {},
    upstreamRank: rank,
    links: {},
    doi: null,
    living: false,
  };
}

/** OpenAlex ships abstracts as {word: [positions]}; put the words back in order. */
export function rebuildAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== "object") {
    return "";
  }
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const position of list(positions)) {
      words[position] = word;
    }
  }
  return words.filter((word) => word !== undefined).join(" ");
}

const wikipedia = {
  id: "wikipedia",
  label: "Wikipedia",
  kind: "encyclopedia",
  home: "https://www.wikipedia.org/",
  about: "Free encyclopedia. Pages are living documents and can change after any date you filter by.",
  request(parsed, opts) {
    const language = /^[a-z-]{2,12}$/.test(opts.wikiLang ?? "") ? opts.wikiLang : "en";
    const query = enc(parsed.upstream);
    return (
      `https://${language}.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
      `&generator=search&gsrsearch=${query}&gsrlimit=8` +
      "&prop=extracts%7Cinfo%7Cdescription%7Cpageprops&ppprop=disambiguation" +
      "&exintro=1&explaintext=1&exsentences=4&exlimit=8&inprop=url" +
      `&list=search&srsearch=${query}&srlimit=8&srprop=snippet%7Ctimestamp`
    );
  },
  parse(json) {
    const pages = Object.values(json?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const hits = new Map(list(json?.query?.search).map((hit) => [hit.pageid, hit]));
    const docs = [];
    for (const page of pages) {
      if (page.pageprops && "disambiguation" in page.pageprops) {
        continue;
      }
      const hit = hits.get(page.pageid);
      const doc = baseDoc("wikipedia", "encyclopedia", page.pageid, docs.length);
      doc.title = page.title ?? "";
      doc.url = page.fullurl ?? `https://en.wikipedia.org/?curid=${page.pageid}`;
      doc.snippet = truncate(String(page.extract ?? "").replace(/\s+/g, " "), 700);
      doc.extra = [page.description ?? "", stripHtml(hit?.snippet ?? "")].join(" ").trim();
      if (!doc.snippet) {
        doc.snippet = stripHtml(hit?.snippet ?? "") || (page.description ?? "");
      }
      doc.living = true;
      doc.signals.lastEdited = isoDay(hit?.timestamp ?? page.touched);
      docs.push(doc);
    }
    return docs;
  },
};

const stackexchange = {
  id: "stackexchange",
  label: "Stack Exchange",
  kind: "qa",
  home: "https://stackexchange.com/sites",
  about: "Questions and answers voted on by the community. One site per search, chosen from your words.",
  site(parsed, opts) {
    const wanted = parsed.seSite ?? opts.seSite;
    return wanted && /^[a-z0-9.]+$/.test(wanted) ? wanted : pickStackSite(parsed.text);
  },
  request(parsed, opts) {
    const site = this.site(parsed, opts);
    let url =
      "https://api.stackexchange.com/2.3/search/excerpts?order=desc&sort=relevance" +
      `&q=${enc(parsed.upstream)}&site=${enc(site)}&pagesize=8`;
    if (opts.before) {
      url += `&todate=${unixSeconds(opts.before)}`;
    }
    if (opts.after) {
      url += `&fromdate=${unixSeconds(opts.after)}`;
    }
    return url;
  },
  /** The API answers 400 with a JSON body when a quota or a throttle is hit. */
  failure(json) {
    if (!json || json.error_id === undefined) {
      return null;
    }
    const limited = [502, 429].includes(json.error_id) || /throttle|quota|too many/i.test(json.error_message ?? "");
    return { state: limited ? "limit" : "error", note: json.error_message ?? json.error_name ?? "API error" };
  },
  parse(json, ctx) {
    const site = this.site(ctx.parsed, ctx.opts);
    const host = stackHost(site);
    const docs = [];
    for (const item of list(json?.items)) {
      const isAnswer = item.item_type === "answer";
      const nativeId = isAnswer ? `a${item.answer_id}` : `q${item.question_id}`;
      const doc = baseDoc("stackexchange", "qa", `${site}:${nativeId}`, docs.length);
      doc.title = decodeEntities(item.title ?? "");
      doc.url = isAnswer ? `https://${host}/a/${item.answer_id}` : `https://${host}/q/${item.question_id}`;
      doc.snippet = stripHtml(item.excerpt ?? "");
      doc.extra = list(item.tags).join(" ");
      doc.date = isoDay(item.creation_date);
      doc.venue = SE_SITES[site] ?? host;
      doc.thread = `se:${site}:${item.question_id}`;
      doc.signals = {
        score: item.score ?? 0,
        accepted: Boolean(item.is_accepted || item.has_accepted_answer),
        isAnswer,
        answers: item.answer_count ?? null,
      };
      docs.push(doc);
    }
    return docs;
  },
};

const hackernews = {
  id: "hackernews",
  label: "Hacker News",
  kind: "discussion",
  home: "https://news.ycombinator.com/",
  about: "Tech discussion threads, searched through the public Algolia index.",
  request(parsed, opts) {
    let url = `https://hn.algolia.com/api/v1/search?query=${enc(parsed.upstream)}&tags=story&hitsPerPage=8`;
    const filters = [];
    if (opts.before) {
      filters.push(`created_at_i<${unixSeconds(opts.before)}`);
    }
    if (opts.after) {
      filters.push(`created_at_i>${unixSeconds(opts.after)}`);
    }
    if (filters.length) {
      url += `&numericFilters=${enc(filters.join(","))}`;
    }
    return url;
  },
  parse(json) {
    const docs = [];
    for (const hit of list(json?.hits)) {
      if (!hit.title) {
        continue;
      }
      const doc = baseDoc("hackernews", "discussion", hit.objectID, docs.length);
      const points = hit.points ?? 0;
      const comments = hit.num_comments ?? 0;
      doc.title = decodeEntities(hit.title);
      doc.url = `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const storyText = stripHtml(hit.story_text ?? "");
      if (storyText) {
        doc.snippet = truncate(storyText, 500);
      } else {
        const about = hit.url ? `Discussion of a page on ${hostOf(hit.url)}` : "Discussion thread";
        doc.snippet = `${about}: ${points} points, ${comments} comments.`;
        doc.snippetIsMeta = true;
      }
      if (hit.url) {
        doc.links.article = hit.url;
        doc.extra = hostOf(hit.url);
      }
      doc.date = isoDay(hit.created_at_i ?? hit.created_at);
      doc.author = hit.author ?? "";
      doc.signals = { points, comments };
      docs.push(doc);
    }
    return docs;
  },
};

const github = {
  id: "github",
  label: "GitHub",
  kind: "code",
  home: "https://github.com/",
  about: "Public repositories. The key-less API allows about ten searches a minute per network.",
  request(parsed, opts) {
    let query = parsed.upstream;
    if (opts.before) {
      query += ` created:<${opts.before}`;
    }
    if (opts.after) {
      query += ` created:>${opts.after}`;
    }
    return `https://api.github.com/search/repositories?q=${enc(query)}&per_page=6`;
  },
  parse(json) {
    const docs = [];
    for (const repo of list(json?.items)) {
      const doc = baseDoc("github", "code", repo.id, docs.length);
      doc.title = repo.full_name ?? "";
      doc.url = repo.html_url ?? "";
      doc.snippet = truncate(repo.description ?? "", 400);
      if (!doc.snippet) {
        doc.snippet = `Repository in ${repo.language ?? "an unspecified language"}, no description given.`;
        doc.snippetIsMeta = true;
      }
      doc.extra = [repo.language ?? "", ...list(repo.topics)].join(" ");
      doc.date = isoDay(repo.created_at);
      doc.author = repo.owner?.login ?? "";
      doc.venue = repo.language ?? "";
      doc.signals = {
        stars: repo.stargazers_count ?? 0,
        archived: Boolean(repo.archived),
        updated: isoDay(repo.pushed_at),
        license: repo.license?.spdx_id && repo.license.spdx_id !== "NOASSERTION" ? repo.license.spdx_id : null,
      };
      docs.push(doc);
    }
    return docs;
  },
};

function authorLine(names) {
  const clean = names.filter(Boolean);
  if (clean.length <= 3) {
    return clean.join(", ");
  }
  return `${clean.slice(0, 3).join(", ")} et al.`;
}

const crossref = {
  id: "crossref",
  label: "Crossref",
  kind: "paper",
  request(parsed, opts) {
    let url =
      `https://api.crossref.org/works?query=${enc(parsed.upstream)}&rows=8` +
      "&select=DOI,title,author,issued,is-referenced-by-count,container-title,abstract,URL,type";
    const filters = [];
    if (opts.before) {
      filters.push(`until-pub-date:${opts.before}`);
    }
    if (opts.after) {
      filters.push(`from-pub-date:${opts.after}`);
    }
    if (filters.length) {
      url += `&filter=${enc(filters.join(","))}`;
    }
    return url;
  },
  parse(json) {
    const docs = [];
    for (const work of list(json?.message?.items)) {
      const title = stripHtml(first(work.title) ?? "");
      if (!title) {
        continue;
      }
      const doc = baseDoc("openalex", "paper", `doi:${work.DOI}`, docs.length);
      const parts = work.issued?.["date-parts"]?.[0] ?? [];
      doc.title = title;
      doc.doi = work.DOI ? String(work.DOI).toLowerCase() : null;
      doc.url = doc.doi ? `https://doi.org/${doc.doi}` : (work.URL ?? "");
      doc.venue = stripHtml(first(work["container-title"]) ?? "");
      doc.author = authorLine(list(work.author).map((person) => [person.given, person.family].filter(Boolean).join(" ")));
      doc.snippet = truncate(stripHtml(work.abstract ?? "").replace(/^abstract\s*/i, ""), 700);
      if (!doc.snippet) {
        doc.snippet = `${doc.venue || "Published work"}${parts[0] ? `, ${parts[0]}` : ""}. No abstract in the index.`;
        doc.snippetIsMeta = true;
      }
      if (parts[0]) {
        doc.date = isoDay(`${parts[0]}-${String(parts[1] ?? 1).padStart(2, "0")}-${String(parts[2] ?? 1).padStart(2, "0")}`);
        doc.dateIsYear = parts.length === 1;
      }
      doc.signals = { citations: work["is-referenced-by-count"] ?? 0, via: "Crossref" };
      docs.push(doc);
    }
    return docs;
  },
};

const openalex = {
  id: "openalex",
  label: "OpenAlex",
  kind: "paper",
  home: "https://openalex.org/",
  about: "Open index of scholarly works. If it does not answer, Crossref is asked instead.",
  fallback: crossref,
  request(parsed, opts) {
    let url =
      `https://api.openalex.org/works?search=${enc(parsed.upstream)}&per_page=8` +
      "&select=id,doi,title,publication_year,publication_date,cited_by_count,open_access," +
      "primary_location,authorships,abstract_inverted_index,type";
    const filters = [];
    if (opts.before) {
      filters.push(`to_publication_date:${opts.before}`);
    }
    if (opts.after) {
      filters.push(`from_publication_date:${opts.after}`);
    }
    if (filters.length) {
      url += `&filter=${enc(filters.join(","))}`;
    }
    return url;
  },
  parse(json) {
    const docs = [];
    for (const work of list(json?.results)) {
      const title = stripHtml(work.title ?? "");
      if (!title) {
        continue;
      }
      const nativeId = String(work.id ?? "").split("/").pop();
      const doc = baseDoc("openalex", "paper", nativeId, docs.length);
      doc.title = title;
      doc.doi = work.doi ? String(work.doi).replace(/^https?:\/\/doi\.org\//i, "").toLowerCase() : null;
      doc.url = doc.doi ? `https://doi.org/${doc.doi}` : (work.primary_location?.landing_page_url ?? work.id ?? "");
      doc.venue = work.primary_location?.source?.display_name ?? "";
      doc.author = authorLine(list(work.authorships).map((entry) => entry.author?.display_name));
      doc.snippet = truncate(rebuildAbstract(work.abstract_inverted_index), 700);
      if (!doc.snippet) {
        const where = doc.venue || "Scholarly work";
        doc.snippet = `${where}${work.publication_year ? `, ${work.publication_year}` : ""}. No abstract in the index.`;
        doc.snippetIsMeta = true;
      }
      doc.date = isoDay(work.publication_date ?? work.publication_year);
      doc.dateIsYear = !work.publication_date;
      if (work.open_access?.oa_url) {
        doc.links.pdf = work.open_access.oa_url;
      }
      doc.signals = { citations: work.cited_by_count ?? 0, openAccess: Boolean(work.open_access?.is_oa) };
      docs.push(doc);
    }
    return docs;
  },
};

const europepmc = {
  id: "europepmc",
  label: "Europe PMC",
  kind: "medical",
  home: "https://europepmc.org/",
  about: "Life-science and medical literature, including PubMed records and preprints.",
  request(parsed, opts) {
    let query = `(${parsed.upstream})`;
    if (opts.before || opts.after) {
      query += ` AND FIRST_PDATE:[${opts.after ?? "1800-01-01"} TO ${opts.before ?? "2999-12-31"}]`;
    }
    return (
      "https://www.ebi.ac.uk/europepmc/webservices/rest/search" +
      `?query=${enc(query)}&format=json&pageSize=6&resultType=core`
    );
  },
  parse(json) {
    const docs = [];
    for (const record of list(json?.resultList?.result)) {
      const title = stripHtml(record.title ?? "").replace(/\.$/, "");
      if (!title) {
        continue;
      }
      const doc = baseDoc("europepmc", "medical", `${record.source}:${record.id}`, docs.length);
      doc.title = title;
      doc.doi = record.doi ? String(record.doi).toLowerCase() : null;
      doc.url = `https://europepmc.org/article/${record.source}/${record.id}`;
      doc.venue = record.journalInfo?.journal?.title ?? record.bookOrReportDetails?.publisher ?? "";
      doc.author = authorLine(
        String(record.authorString ?? "")
          .replace(/\.$/, "")
          .split(", "),
      );
      doc.snippet = truncate(stripHtml(record.abstractText ?? ""), 700);
      if (!doc.snippet) {
        doc.snippet = `${doc.venue || "Record"}${record.pubYear ? `, ${record.pubYear}` : ""}. No abstract in the index.`;
        doc.snippetIsMeta = true;
      }
      doc.date = isoDay(record.firstPublicationDate ?? record.pubYear);
      doc.dateIsYear = !record.firstPublicationDate;
      doc.signals = {
        citations: record.citedByCount ?? 0,
        openAccess: record.isOpenAccess === "Y",
        preprint: record.source === "PPR",
      };
      docs.push(doc);
    }
    return docs;
  },
};

const archive = {
  id: "archive",
  label: "Internet Archive",
  kind: "archive",
  home: "https://archive.org/",
  about: "Scanned books, reports and other texts kept by the Internet Archive.",
  request(parsed, opts) {
    const safeText = parsed.upstream.replace(/[()[\]{}:^~\\/!+]/g, " ").replace(/\s+/g, " ").trim();
    let query = `(${safeText}) AND mediatype:(texts)`;
    if (opts.before || opts.after) {
      query += ` AND date:[${opts.after ?? "0001-01-01"} TO ${opts.before ?? "2999-12-31"}]`;
    }
    const fields = ["identifier", "title", "description", "year", "date", "creator", "downloads"];
    return (
      `https://archive.org/advancedsearch.php?q=${enc(query)}` +
      fields.map((field) => `&fl%5B%5D=${field}`).join("") +
      "&rows=6&output=json"
    );
  },
  parse(json) {
    const docs = [];
    for (const item of list(json?.response?.docs)) {
      const title = stripHtml(first(item.title) ?? "");
      if (!title || !item.identifier) {
        continue;
      }
      const doc = baseDoc("archive", "archive", item.identifier, docs.length);
      doc.title = title;
      doc.url = `https://archive.org/details/${enc(item.identifier)}`;
      doc.snippet = truncate(stripHtml(list(item.description).join(" ")), 500);
      if (!doc.snippet) {
        doc.snippet = "Scanned text held by the Internet Archive. No description in the index.";
        doc.snippetIsMeta = true;
      }
      doc.author = authorLine(list(item.creator).map(String));
      doc.date = isoDay(item.date ?? item.year);
      doc.dateIsYear = true;
      doc.signals = { downloads: Number(item.downloads) || 0 };
      docs.push(doc);
    }
    return docs;
  },
};

const openlibrary = {
  id: "openlibrary",
  label: "Open Library",
  kind: "book",
  home: "https://openlibrary.org/",
  about: "Catalogue of published books, many of them borrowable or free to read.",
  request(parsed) {
    return (
      `https://openlibrary.org/search.json?q=${enc(parsed.upstream)}&limit=8` +
      "&fields=key,title,author_name,first_publish_year,edition_count,first_sentence,ebook_access,subject"
    );
  },
  parse(json) {
    const docs = [];
    for (const book of list(json?.docs)) {
      if (!book.title || !book.key) {
        continue;
      }
      const doc = baseDoc("openlibrary", "book", book.key, docs.length);
      const subjects = list(book.subject).slice(0, 6);
      const firstSentence = stripHtml(first(book.first_sentence) ?? "");
      doc.title = book.title;
      doc.url = `https://openlibrary.org${book.key}`;
      doc.author = authorLine(list(book.author_name));
      if (firstSentence) {
        doc.snippet = truncate(firstSentence, 400);
      } else {
        doc.snippet = subjects.length
          ? `Book. Subjects: ${subjects.join(", ")}.`
          : "Book. No description in the catalogue.";
        doc.snippetIsMeta = true;
      }
      doc.extra = subjects.join(" ");
      if (book.first_publish_year) {
        doc.date = `${book.first_publish_year}-01-01`;
        doc.dateIsYear = true;
      }
      doc.signals = {
        editions: book.edition_count ?? 0,
        readable: ["public", "borrowable"].includes(book.ebook_access),
      };
      docs.push(doc);
    }
    return docs;
  },
};

export const SOURCES = [wikipedia, stackexchange, hackernews, github, openalex, europepmc, archive, openlibrary];

export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((source) => [source.id, source]));

/** Hosts the app is allowed to contact. The end-to-end test fails if any other host is requested. */
export const API_HOSTS = [
  "wikipedia.org",
  "api.stackexchange.com",
  "hn.algolia.com",
  "api.github.com",
  "api.openalex.org",
  "api.crossref.org",
  "www.ebi.ac.uk",
  "archive.org",
  "openlibrary.org",
];

/** Which sources a search will ask: an in: operator wins over the lens. */
export function planSources(parsed, lensId) {
  if (parsed.sources.length) {
    return parsed.sources.filter((id) => SOURCE_BY_ID[id]);
  }
  const lens = LENSES[lensId] ?? LENSES.all;
  return SOURCES.map((source) => source.id).filter((id) => lens.weights[id] !== undefined);
}

export function lensWeight(lensId, sourceId, parsed) {
  if (parsed?.sources?.length) {
    return 1;
  }
  return (LENSES[lensId] ?? LENSES.all).weights[sourceId] ?? 1;
}

export function describeDate(doc) {
  if (!doc.date) {
    return "";
  }
  return doc.dateIsYear ? doc.date.slice(0, 4) : doc.date;
}

export { fold };
