// Ranking, written to be read. Every number that moves a result is returned in `why`, and the same
// breakdown is shown in the interface. No money, no click data and no personal profile is involved.

import { fold, formatCount, splitSentences, terms as toTerms, tokenize, stem } from "./text.js";
import { lensWeight } from "./sources.js";

// The sources search their full text; this page only sees titles and excerpts. So the position a
// source gave a document counts for almost as much as the words we can check ourselves.
export const WEIGHTS = { text: 0.5, evidence: 0.2, upstream: 0.3 };
const TITLE_BOOST = 2.5;
const EXTRA_BOOST = 0.5;
const K1 = 1.2;
const B = 0.6;
const DIVERSITY = 0.85;

/** Wording that usually marks an explanation or a definition; used only to choose between sentences. */
const INTENT_CUES = {
  why: /\b(because|due to|caused by|as a result|the reason|results? from)\b/i,
  what: /\b(is an?|is the|are the|refers to|is defined as)\b/i,
};

function logNorm(value, cap) {
  const number = Math.max(0, Number(value) || 0);
  return Math.min(1, Math.log1p(number) / Math.log1p(cap));
}

function countTerms(text) {
  const counts = new Map();
  let length = 0;
  for (const token of tokenize(text)) {
    const term = stem(token);
    counts.set(term, (counts.get(term) ?? 0) + 1);
    length += 1;
  }
  return { counts, length };
}

/** How much independent evidence the source itself reports for a document, 0..1. */
export function evidenceScore(doc) {
  const signals = doc.signals ?? {};
  switch (doc.kind) {
    case "encyclopedia":
      return 0.75;
    case "qa":
      return 0.3 + (signals.accepted ? 0.3 : 0) + 0.4 * logNorm(signals.score, 500);
    case "discussion":
      return 0.2 + 0.5 * logNorm(signals.points, 2000) + 0.3 * logNorm(signals.comments, 1000);
    case "code":
      return (0.15 + 0.85 * logNorm(signals.stars, 100000)) * (signals.archived ? 0.8 : 1);
    case "paper":
    case "medical":
      return 0.25 + 0.6 * logNorm(signals.citations, 5000) + (signals.openAccess ? 0.15 : 0);
    case "book":
      return 0.3 + 0.7 * logNorm(signals.editions, 200);
    case "archive":
      return 0.2 + 0.6 * logNorm(signals.downloads, 100000);
    default:
      return 0.3;
  }
}

/** Short facts shown as badges next to a result; all of them come straight from the source's API. */
export function evidenceNotes(doc) {
  const signals = doc.signals ?? {};
  const notes = [];
  if (doc.kind === "qa") {
    if (signals.accepted) {
      notes.push(signals.isAnswer ? "accepted answer" : "has accepted answer");
    }
    notes.push(`score ${formatCount(signals.score)}`);
  }
  if (doc.kind === "discussion") {
    notes.push(`${formatCount(signals.points)} points`, `${formatCount(signals.comments)} comments`);
  }
  if (doc.kind === "code") {
    notes.push(`${formatCount(signals.stars)} stars`);
    if (signals.license) {
      notes.push(signals.license);
    }
    if (signals.archived) {
      notes.push("archived repo");
    }
  }
  if (doc.kind === "paper" || doc.kind === "medical") {
    notes.push(`cited by ${formatCount(signals.citations)}`);
    if (signals.openAccess) {
      notes.push("open access");
    }
    if (signals.preprint) {
      notes.push("preprint, not peer reviewed");
    }
    if (signals.via) {
      notes.push(`via ${signals.via}`);
    }
  }
  if (doc.kind === "book") {
    notes.push(`${formatCount(signals.editions)} ${signals.editions === 1 ? "edition" : "editions"}`);
    if (signals.readable) {
      notes.push("readable online");
    }
  }
  if (doc.kind === "archive") {
    notes.push(`${formatCount(signals.downloads)} downloads`);
  }
  if (doc.kind === "encyclopedia" && signals.lastEdited) {
    notes.push(`last edited ${signals.lastEdited}`);
  }
  return notes;
}

function normaliseUrl(url) {
  return String(url ?? "")
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

function dedupeKeys(doc) {
  const keys = [`url:${normaliseUrl(doc.url)}`];
  if (doc.doi) {
    keys.push(`doi:${doc.doi}`);
  }
  if (doc.kind === "paper" || doc.kind === "medical") {
    keys.push(`title:${tokenize(doc.title).join(" ")}`);
  }
  if (doc.links?.article) {
    keys.push(`url:${normaliseUrl(doc.links.article)}`);
  }
  if (doc.thread) {
    keys.push(`thread:${doc.thread}`);
  }
  return keys;
}

function passesDates(doc, opts) {
  if (!opts.before && !opts.after) {
    return true;
  }
  if (doc.living) {
    return true;
  }
  if (!doc.date) {
    return false;
  }
  if (opts.before) {
    const limit = doc.dateIsYear ? opts.before.slice(0, 4) : opts.before;
    const value = doc.dateIsYear ? doc.date.slice(0, 4) : doc.date;
    if (value > limit) {
      return false;
    }
  }
  if (opts.after) {
    const limit = doc.dateIsYear ? opts.after.slice(0, 4) : opts.after;
    const value = doc.dateIsYear ? doc.date.slice(0, 4) : doc.date;
    if (value < limit) {
      return false;
    }
  }
  return true;
}

/**
 * Rank a pool of documents from several sources.
 * opts: { lens, before, after, sourceLabels, now }
 * Returns documents with { score, why } added, best first.
 */
export function rank(docs, parsed, opts = {}) {
  const queryTerms = parsed.terms;
  const queryWords = tokenize(parsed.text);
  const excluded = new Set(parsed.excluded.map((word) => stem(word)));
  const prepared = [];

  for (const doc of docs) {
    if (!passesDates(doc, opts)) {
      continue;
    }
    const title = countTerms(doc.title);
    const body = countTerms(doc.snippetIsMeta ? "" : doc.snippet);
    const extra = countTerms(doc.extra);
    const weighted = new Map();
    for (const [field, boost] of [
      [title, TITLE_BOOST],
      [body, 1],
      [extra, EXTRA_BOOST],
    ]) {
      for (const [term, count] of field.counts) {
        weighted.set(term, (weighted.get(term) ?? 0) + boost * count);
      }
    }
    let hasExcluded = false;
    for (const term of excluded) {
      if (weighted.has(term)) {
        hasExcluded = true;
      }
    }
    if (hasExcluded) {
      continue;
    }
    const length = TITLE_BOOST * title.length + body.length + EXTRA_BOOST * extra.length;
    prepared.push({ doc, weighted, length, titleCounts: title.counts });
  }

  if (!prepared.length) {
    return [];
  }

  const averageLength = prepared.reduce((sum, entry) => sum + entry.length, 0) / prepared.length || 1;
  const documentFrequency = new Map();
  for (const term of queryTerms) {
    let count = 0;
    for (const entry of prepared) {
      if (entry.weighted.has(term)) {
        count += 1;
      }
    }
    documentFrequency.set(term, count);
  }

  const sourceSizes = new Map();
  for (const entry of prepared) {
    sourceSizes.set(entry.doc.source, Math.max(sourceSizes.get(entry.doc.source) ?? 0, entry.doc.upstreamRank + 1));
  }

  let bestBm25 = 0;
  for (const entry of prepared) {
    let bm25 = 0;
    const matched = [];
    const missing = [];
    for (const term of queryTerms) {
      const frequency = entry.weighted.get(term) ?? 0;
      if (!frequency) {
        missing.push(term);
        continue;
      }
      matched.push(term);
      const seen = documentFrequency.get(term);
      // Every document in the pool was already matched to the query by its source, so a term
      // found everywhere is the topic, not noise: rarity may at most double a term's weight.
      const idf = 1 + Math.min(1, Math.log(1 + (prepared.length - seen + 0.5) / (seen + 0.5)));
      const saturation = (frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * entry.length) / averageLength));
      bm25 += idf * saturation;
    }
    entry.bm25 = bm25;
    entry.matched = matched;
    entry.missing = missing;
    entry.coverage = queryTerms.length ? matched.length / queryTerms.length : 0;
    bestBm25 = Math.max(bestBm25, bm25);
  }

  const scored = [];
  for (const entry of prepared) {
    const { doc } = entry;
    if (queryTerms.length && entry.coverage === 0) {
      continue;
    }
    let text = bestBm25 > 0 ? (entry.bm25 / bestBm25) * (0.5 + 0.5 * entry.coverage) : entry.coverage;
    const haystack = fold(`${doc.title} ${doc.snippet} ${doc.extra}`);
    let phraseNote = "";
    if (parsed.phrases.length) {
      const found = parsed.phrases.every((phrase) => haystack.includes(phrase));
      text = found ? Math.min(1, text + 0.15) : text * 0.6;
      phraseNote = found ? "exact phrase found" : "exact phrase not in the title or excerpt";
    }
    const titleHasAll = queryTerms.length > 0 && queryTerms.every((term) => entry.titleCounts.has(term));
    if (titleHasAll) {
      text = Math.min(1, text + 0.1);
    }
    const titleIsQuery = queryWords.length > 0 && tokenize(doc.title).join(" ") === queryWords.join(" ");
    if (titleIsQuery) {
      text = 1;
    }
    const evidence = Math.min(1, evidenceScore(doc));
    const size = sourceSizes.get(doc.source) ?? 1;
    const upstream = size > 1 ? 1 - doc.upstreamRank / size : 1;
    const lens = lensWeight(opts.lens, doc.source, parsed);
    let recency = 0;
    if (parsed.wantsRecent && doc.date) {
      const ageYears = ((opts.now ?? Date.now()) - Date.parse(doc.date)) / (365.25 * 24 * 3600 * 1000);
      recency = 0.1 * Math.max(0, 1 - ageYears / 5);
    }
    const exactTitle = titleIsQuery ? 0.08 : 0;
    const base =
      WEIGHTS.text * text + WEIGHTS.evidence * evidence + WEIGHTS.upstream * upstream + recency + exactTitle;
    scored.push({
      ...doc,
      score: base * lens,
      why: {
        text,
        coverage: entry.coverage,
        matched: entry.matched,
        missing: entry.missing,
        titleHasAll,
        titleIsQuery,
        phraseNote,
        evidence,
        evidenceNotes: evidenceNotes(doc),
        upstream,
        upstreamPosition: doc.upstreamRank + 1,
        lens,
        recency,
        diversity: 1,
        base,
      },
      alsoIn: [],
    });
  }

  // Merge the same work reported by two sources; keep the better-scored record.
  scored.sort((a, b) => b.score - a.score);
  const seen = new Map();
  const unique = [];
  for (const doc of scored) {
    const keys = dedupeKeys(doc);
    const existing = keys.map((key) => seen.get(key)).find(Boolean);
    if (existing) {
      if (existing.source !== doc.source && !existing.alsoIn.includes(doc.source)) {
        existing.alsoIn.push(doc.source);
      }
      if (!existing.links.pdf && doc.links?.pdf) {
        existing.links.pdf = doc.links.pdf;
      }
      continue;
    }
    for (const key of keys) {
      seen.set(key, doc);
    }
    unique.push(doc);
  }

  // Greedy pick so one source cannot fill the first screen: each repeat costs 15%.
  const remaining = unique.slice();
  const picked = [];
  const perSource = new Map();
  while (remaining.length) {
    let bestIndex = 0;
    let bestValue = -1;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const factor = DIVERSITY ** (perSource.get(candidate.source) ?? 0);
      const value = candidate.score * factor;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    const repeats = perSource.get(chosen.source) ?? 0;
    chosen.why.diversity = DIVERSITY ** repeats;
    chosen.finalScore = chosen.score * chosen.why.diversity;
    perSource.set(chosen.source, repeats + 1);
    picked.push(chosen);
  }
  return picked;
}

/** Openers that point at an earlier sentence, so the sentence cannot stand alone as a quote. */
const DANGLING_OPENER = /^(it|its|this|that|these|those|they|their|he|she|his|her)\b/i;

/**
 * Up to `limit` sentences copied character for character from the excerpts the sources returned.
 * Nothing is paraphrased, merged or generated; a sentence qualifies only if it contains at least
 * half of the query terms and does not open with a pronoun that points at an earlier sentence.
 */
export function bestPassages(results, parsed, opts = {}) {
  const limit = opts.limit ?? 3;
  const queryTerms = parsed.terms;
  if (!queryTerms.length) {
    return [];
  }
  const candidates = [];
  results.slice(0, 10).forEach((doc, index) => {
    if (doc.snippetIsMeta || !doc.snippet) {
      return;
    }
    if (opts.skipLiving && doc.living) {
      return;
    }
    let best = null;
    for (const sentence of splitSentences(doc.snippet)) {
      if (sentence.length < 40 || sentence.length > 320 || /…$/.test(sentence) || /\?$/.test(sentence)) {
        continue;
      }
      if (DANGLING_OPENER.test(sentence)) {
        continue;
      }
      const present = new Set(toTerms(sentence));
      const hits = queryTerms.filter((term) => present.has(term)).length;
      const coverage = hits / queryTerms.length;
      const needed = queryTerms.length === 1 ? 1 : 0.5;
      if (coverage < needed) {
        continue;
      }
      let value = coverage * (0.5 + 0.5 * Math.min(1, doc.finalScore ?? doc.score ?? 0));
      if (parsed.phrases.length && parsed.phrases.every((phrase) => fold(sentence).includes(phrase))) {
        value += 0.2;
      }
      if (parsed.intent && INTENT_CUES[parsed.intent]?.test(sentence)) {
        value += 0.15;
      }
      if (!best || value > best.value) {
        best = { text: sentence, value, resultIndex: index, docId: doc.id, source: doc.source };
      }
    }
    if (best) {
      candidates.push(best);
    }
  });

  const chosen = [];
  const usedSources = new Map();
  while (candidates.length && chosen.length < limit) {
    let bestIndex = 0;
    let bestValue = -1;
    candidates.forEach((candidate, index) => {
      const value = candidate.value * 0.7 ** (usedSources.get(candidate.source) ?? 0);
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    });
    const [pick] = candidates.splice(bestIndex, 1);
    usedSources.set(pick.source, (usedSources.get(pick.source) ?? 0) + 1);
    chosen.push(pick);
  }
  return chosen.sort((a, b) => a.resultIndex - b.resultIndex);
}
