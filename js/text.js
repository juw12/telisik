// Text utilities shared by the query parser, the ranker and the UI. No dependencies.

export const STOPWORDS = new Set(
  (
    "a an and are as at be but by can do does for from how i if in into is it its me my of on or " +
    "so than that the their then there these they this to was we were what when where which who why " +
    "will with you your vs versus not no"
  ).split(" "),
);

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

/** Lower-case and strip diacritics so "Café" matches "cafe". */
export function fold(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Words and numbers; each CJK character is its own token because CJK has no spaces. */
export function tokenize(text) {
  const tokens = [];
  const pattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]+/gu;
  for (const match of fold(text).matchAll(pattern)) {
    tokens.push(match[0]);
  }
  return tokens;
}

/** Conservative English suffix stripping: plural and -ing / -ed only, never shorter than 3 letters. */
export function stem(token) {
  if (!/^[a-z]+$/.test(token) || token.length < 5) {
    return token;
  }
  if (token.endsWith("ies")) {
    return token.slice(0, -3) + "y";
  }
  if (token.endsWith("sses")) {
    return token.slice(0, -2);
  }
  if (token.endsWith("ing") && token.length > 6) {
    return token.slice(0, -3);
  }
  if (token.endsWith("ed") && token.length > 5) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !/(ss|us|is)$/.test(token)) {
    return token.slice(0, -1);
  }
  return token;
}

/** Index terms: tokens without stopwords, stemmed. */
export function terms(text) {
  const result = [];
  for (const token of tokenize(text)) {
    if (!STOPWORDS.has(token)) {
      result.push(stem(token));
    }
  }
  return result;
}

export function decodeEntities(text) {
  return String(text ?? "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const isHex = name[1] === "x" || name[1] === "X";
      const code = parseInt(name.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Plain text from an HTML or XML fragment; never used to build markup. */
export function stripHtml(html) {
  const withoutTags = String(html ?? "").replace(/<[^>]*>/g, " ");
  return decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
}

export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (character) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
  });
}

/** Sentence split that keeps abbreviations like "e.g." and decimals such as "3.5" together. */
export function splitSentences(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return [];
  }
  const pieces = clean.split(/(?<=[.!?。！？])\s+(?=[A-Z0-9"“(\p{Script=Han}])/u);
  const sentences = [];
  for (const piece of pieces) {
    const previous = sentences[sentences.length - 1];
    if (previous && /\b(e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|Prof|Fig|No|al)\.$/.test(previous)) {
      sentences[sentences.length - 1] = previous + " " + piece;
    } else {
      sentences.push(piece);
    }
  }
  return sentences;
}

/** Cut at a word boundary and add an ellipsis only when something was removed. */
export function truncate(text, maxLength) {
  const clean = String(text ?? "").trim();
  if (clean.length <= maxLength) {
    return clean;
  }
  const cut = clean.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:]+$/, "") + "…";
}

/**
 * Escaped HTML with the query terms wrapped in <mark>. Matching is done per word on the stemmed
 * form, so "pipes" is marked for the query "pipe".
 */
export function highlight(text, queryTerms) {
  const wanted = new Set(queryTerms);
  const parts = String(text ?? "").split(/([\p{L}\p{N}]+)/u);
  let html = "";
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const isWord = index % 2 === 1;
    if (isWord && wanted.has(stem(fold(part)))) {
      html += "<mark>" + escapeHtml(part) + "</mark>";
    } else {
      html += escapeHtml(part);
    }
  }
  return html;
}

export function formatCount(value) {
  const number = Number(value) || 0;
  if (number >= 1e6) {
    return (number / 1e6).toFixed(number >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  }
  if (number >= 1e4) {
    return Math.round(number / 1e3) + "k";
  }
  if (number >= 1e3) {
    return (number / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  }
  return String(number);
}
