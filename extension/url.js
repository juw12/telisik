// Where a search goes. No browser API in here, so node can test it.

export const HOME = "https://juw12.github.io/telisik/";
export const MAX_QUERY = 300;

/** One line, single spaces, no longer than the search box on the site allows. */
export function cleanQuery(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY)
    .trim();
}

/**
 * The query goes after the # on purpose: a browser never sends that part to the server,
 * so the host of the page does not learn what was searched.
 */
export function searchUrl(text) {
  const query = cleanQuery(text);
  if (!query) {
    return HOME;
  }
  return `${HOME}#${new URLSearchParams({ q: query })}`;
}
