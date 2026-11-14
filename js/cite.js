// Plain-text citations built only from fields the source returned.

import { SOURCE_BY_ID, describeDate } from "./sources.js";

export function formatCitation(doc, accessedOn) {
  const sourceLabel = SOURCE_BY_ID[doc.source]?.label ?? doc.source;
  const year = doc.date ? doc.date.slice(0, 4) : "n.d.";
  if (doc.kind === "paper" || doc.kind === "medical") {
    const parts = [];
    parts.push(`${doc.author || "Unknown author"} (${year}).`);
    parts.push(`${doc.title.replace(/\.$/, "")}.`);
    if (doc.venue) {
      parts.push(`${doc.venue}.`);
    }
    parts.push(doc.doi ? `https://doi.org/${doc.doi}` : doc.url);
    return parts.join(" ");
  }
  const parts = [];
  if (doc.author) {
    parts.push(`${doc.author}.`);
  }
  parts.push(`"${doc.title.replace(/\.$/, "")}."`);
  const container = doc.venue && doc.kind === "qa" ? `${doc.venue} (${sourceLabel})` : sourceLabel;
  const date = describeDate(doc);
  parts.push(date ? `${container}, ${date}.` : `${container}.`);
  parts.push(doc.url);
  if (accessedOn) {
    parts.push(`(accessed ${accessedOn}).`);
  }
  return parts.join(" ");
}

/** Wayback Machine address for the capture closest to a date ("YYYY-MM-DD"), or the newest one. */
export function snapshotUrl(url, isoDate) {
  const stamp = isoDate ? isoDate.replace(/-/g, "") : "2";
  return `https://web.archive.org/web/${stamp}/${url}`;
}
