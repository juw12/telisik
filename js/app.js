// The page. It wires the form, the lenses and the settings to the engine and draws what comes back.
// Text from the sources is only ever written with textContent, or through highlight(), which
// escapes it first. No HTML from any API reaches the page.

import { BANGS, bangUrl, parseQuery } from "./query.js";
import { KIND_LABELS, LENSES, SE_SITES, SOURCE_BY_ID, describeDate } from "./sources.js";
import { TUNING, WEIGHTS } from "./rank.js";
import { ageWords, createCache, search } from "./engine.js";
import { formatCitation, snapshotUrl } from "./cite.js";
import { highlight, truncate } from "./text.js";
import { CONFIG, safeHttpsUrl } from "./config.js";

const SETTINGS_KEY = "telisik.settings.v1";
const HISTORY_KEY = "telisik.history.v1";
const HISTORY_MAX = 8;
const PAGE_SIZE = 20;
const FIRST_PAINT_MS = 1200;
const ELSEWHERE = ["g", "ddg", "b", "m", "r", "yt", "s", "maps"];
const REPORT_URL = "https://github.com/juw12/telisik/issues/new";
/** A quota is mentioned in the ledger only once less than this share of it is left. */
const QUOTA_LOW_SHARE = 0.2;
const WIKI_LANGUAGES = [
  ["en", "English"],
  ["id", "Bahasa Indonesia"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["fr", "Français"],
  ["it", "Italiano"],
  ["nl", "Nederlands"],
  ["pt", "Português"],
  ["ru", "Русский"],
  ["ar", "العربية"],
  ["hi", "हिन्दी"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["zh", "中文"],
];
const STATE_WORDS = {
  loading: "asking",
  empty: "no match",
  timeout: "timed out",
  limit: "rate limited",
  error: "unreachable",
};

const byId = (id) => document.getElementById(id);

/** Build an element. `html` is reserved for highlight() output, which is already escaped. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (key === "class") {
      node.className = value;
    } else if (key === "text") {
      node.textContent = value;
    } else if (key === "html") {
      node.innerHTML = value;
    } else {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) {
      node.append(child);
    }
  }
  return node;
}

const storage = {
  read(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "null");
      return value ?? fallback;
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Private mode or a full disk: the page keeps working without remembering.
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to remove.
    }
  },
  raw() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  },
};

// The page was called Sumber until November 2026 and lived on the same origin: carry saved choices over once.
for (const [oldKey, newKey] of [
  ["sumber.settings.v1", SETTINGS_KEY],
  ["sumber.history.v1", HISTORY_KEY],
]) {
  const store = storage.raw();
  try {
    const old = store?.getItem(oldKey);
    if (old !== null && old !== undefined) {
      if (store.getItem(newKey) === null) {
        store.setItem(newKey, old);
      }
      store.removeItem(oldKey);
    }
  } catch {
    // Private mode: nothing was saved, nothing to move.
  }
}

const settings = {
  theme: "auto",
  wikiLang: "en",
  keepHistory: true,
  newTab: false,
  stackKey: "",
  ...storage.read(SETTINGS_KEY, {}),
};

const cache = createCache(storage.raw());

const view = {
  query: "",
  lens: "all",
  beforeAI: false,
  filter: null,
  limit: PAGE_SIZE,
  run: 0,
  controller: null,
  startedAt: 0,
  elapsedMs: null,
  latest: null,
  shown: null,
  pending: null,
  painted: false,
  paintTimer: null,
  open: new Map(),
};

// ---------------------------------------------------------------------------------- helpers

function sourceLabel(sourceId, status) {
  if (sourceId === "stackexchange" && status?.site) {
    return SE_SITES[status.site] ?? "Stack Exchange";
  }
  return SOURCE_BY_ID[sourceId]?.label ?? sourceId;
}

function safeLink(url) {
  try {
    const parsed = new URL(String(url ?? ""));
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function displayUrl(url) {
  try {
    const parsed = new URL(url);
    let path = parsed.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // Keep the encoded form when it is not valid UTF-8.
    }
    const parts = path.split("/").filter(Boolean);
    const host = parsed.hostname.replace(/^www\./, "");
    return truncate([host, ...parts].join(" › "), 72);
  } catch {
    return "";
  }
}

function longDate(isoDate) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate ?? "");
  if (!match) {
    return isoDate ?? "";
  }
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

/** "last edited 2026-10-17" reads as "last edited 17 Oct 2026", like the dates in the kicker. */
function readableDates(text) {
  return String(text ?? "").replace(/\b\d{4}-\d{2}-\d{2}\b/g, (isoDate) => longDate(isoDate));
}

function today() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function linkProps(url, extraClass) {
  return {
    href: url,
    class: extraClass,
    rel: "noopener noreferrer",
    target: settings.newTab ? "_blank" : null,
  };
}

function fixed(value) {
  return Number(value).toFixed(2);
}

function ordinal(value) {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) {
    return `${value}th`;
  }
  return `${value}${{ 1: "st", 2: "nd", 3: "rd" }[value % 10] ?? "th"}`;
}

// ------------------------------------------------------------------------------ url and state

/**
 * Search state lives after the # so the query is never sent to the host that serves this page.
 * A ?q= address still works (older links, form fallback) and is rewritten to the # form.
 */
function readLocation() {
  let params = new URLSearchParams(location.hash.slice(1));
  if (!params.has("q")) {
    params = new URLSearchParams(location.search);
  }
  const lens = params.get("lens");
  return {
    // "title" is what the share sheet of an installed copy sends when no text was selected.
    query: (params.get("q") || params.get("title") || "").trim(),
    lens: LENSES[lens] ? lens : "all",
    beforeAI: params.get("before_ai") === "1",
  };
}

function buildSearchString() {
  const params = new URLSearchParams();
  if (view.query) {
    params.set("q", view.query);
  }
  if (view.lens !== "all") {
    params.set("lens", view.lens);
  }
  if (view.beforeAI) {
    params.set("before_ai", "1");
  }
  const text = params.toString();
  return text ? `${location.pathname}#${text}` : location.pathname;
}

function syncControls() {
  byId("q").value = view.query;
  for (const button of document.querySelectorAll(".lens")) {
    button.setAttribute("aria-pressed", String(button.dataset.lens === view.lens));
  }
  byId("before-ai").setAttribute("aria-pressed", String(view.beforeAI));
}

function showHome() {
  view.controller?.abort();
  view.run += 1;
  clearTimeout(view.paintTimer);
  view.query = "";
  view.latest = null;
  view.shown = null;
  view.pending = null;
  document.body.className = "is-home";
  byId("home-view").hidden = false;
  byId("results-view").hidden = true;
  document.title = "Telisik: search the sources";
  syncControls();
  renderHistory();
}

// ----------------------------------------------------------------------------------- history

function readHistory() {
  const list = storage.read(HISTORY_KEY, []);
  return Array.isArray(list) ? list.filter((item) => typeof item === "string").slice(0, HISTORY_MAX) : [];
}

function rememberQuery(query) {
  if (!settings.keepHistory) {
    return;
  }
  const list = readHistory().filter((item) => item !== query);
  list.unshift(query);
  storage.write(HISTORY_KEY, list.slice(0, HISTORY_MAX));
}

function renderHistory() {
  const list = settings.keepHistory ? readHistory() : [];
  const box = byId("recent");
  const target = byId("recent-list");
  target.replaceChildren();
  for (const query of list) {
    const params = new URLSearchParams({ q: query });
    target.append(el("li", {}, el("a", { class: "tap", href: `#${params}`, text: query })));
  }
  box.hidden = list.length === 0;
}

// ------------------------------------------------------------------------------------ search

function startSearch({ push = true } = {}) {
  const raw = view.query.trim();
  if (!raw) {
    if (push) {
      history.pushState(null, "", location.pathname);
    }
    showHome();
    return;
  }
  const parsed = parseQuery(raw);
  if (parsed.bang) {
    // A bang leaves Telisik on purpose: the query goes to the engine the person named.
    location.assign(bangUrl(parsed.bang, parsed.text));
    return;
  }

  view.controller?.abort();
  view.controller = new AbortController();
  view.run += 1;
  const runId = view.run;
  view.filter = null;
  view.limit = PAGE_SIZE;
  view.latest = null;
  view.shown = null;
  view.pending = null;
  view.painted = false;
  view.elapsedMs = null;
  view.open.clear();
  view.startedAt = performance.now();
  clearTimeout(view.paintTimer);

  if (push) {
    history.pushState(null, "", buildSearchString());
  }
  rememberQuery(raw);
  document.title = `${raw} - Telisik`;
  document.body.className = "is-results";
  byId("home-view").hidden = true;
  byId("results-view").hidden = false;
  syncControls();
  clearResults();
  window.scrollTo(0, 0);

  view.paintTimer = setTimeout(() => {
    if (runId === view.run && !view.painted && view.latest?.results.length) {
      paint(view.latest);
    }
  }, FIRST_PAINT_MS);

  const options = {
    lens: view.lens,
    beforeAI: view.beforeAI,
    wikiLang: settings.wikiLang,
    signal: view.controller.signal,
    cache,
    storage: storage.raw(),
    keys: { stackexchange: String(settings.stackKey || (CONFIG.keys?.stackexchange ?? "")).trim() },
  };
  const onUpdate = (snapshot) => receive(snapshot, runId);
  search(parsed, options, onUpdate)
    .then(onUpdate)
    .catch(() => {
      if (runId === view.run) {
        renderFailure();
      }
    });
}

function receive(snapshot, runId) {
  if (runId !== view.run) {
    return;
  }
  view.latest = snapshot;
  if (snapshot.done) {
    view.elapsedMs = performance.now() - view.startedAt;
    clearTimeout(view.paintTimer);
  }
  renderLedger(snapshot);
  const settled = snapshot.planned.every((id) => snapshot.status[id].state !== "loading");
  if (!view.painted) {
    const waitedLongEnough = performance.now() - view.startedAt >= FIRST_PAINT_MS && snapshot.results.length > 0;
    if (snapshot.done || settled || waitedLongEnough) {
      paint(snapshot);
    } else {
      renderSummary(snapshot);
    }
    return;
  }
  if (isReading() && !sameOrder(snapshot, view.shown)) {
    view.pending = snapshot;
    renderSummary(snapshot);
    renderUpdateButton();
    return;
  }
  paint(snapshot);
}

function sameOrder(first, second) {
  if (!first || !second || first.results.length !== second.results.length) {
    return false;
  }
  return first.results.every((doc, index) => doc.id === second.results[index].id);
}

/** True once the person has started using the list; from then on it never moves under them. */
function isReading() {
  if (window.scrollY > 150 || view.open.size > 0) {
    return true;
  }
  return byId("results").contains(document.activeElement);
}

function paint(snapshot) {
  view.painted = true;
  view.shown = snapshot;
  view.pending = null;
  renderSummary(snapshot);
  renderNotice(snapshot);
  renderUpdateButton();
  renderPassages(snapshot);
  renderResults(snapshot);
  renderEmpty(snapshot);
  renderElsewhere(snapshot);
}

function clearResults() {
  byId("ledger-list").replaceChildren();
  byId("ledger-notes").hidden = true;
  byId("results").replaceChildren();
  byId("passage-list").replaceChildren();
  byId("passages").hidden = true;
  byId("notice").hidden = true;
  byId("empty").hidden = true;
  byId("elsewhere").hidden = true;
  byId("more-button").hidden = true;
  byId("update-button").hidden = true;
  byId("summary").textContent = "Asking the sources…";
}

function renderFailure() {
  byId("summary").textContent = "Something went wrong while ranking. Please try the search again.";
}

// ------------------------------------------------------------------------------------ ledger

function renderLedger(snapshot) {
  const list = byId("ledger-list");
  const notes = byId("ledger-notes");
  list.replaceChildren();
  notes.replaceChildren();
  const notesByMessage = new Map();
  for (const id of snapshot.planned) {
    const status = snapshot.status[id];
    const label = sourceLabel(id, status);
    const stateWord = status.state === "ok" ? String(status.count) : STATE_WORDS[status.state] ?? status.state;
    const stateClass = `ledger-state state-${status.state}`;
    const content = [el("span", { class: "ledger-name", text: label }), el("span", { class: stateClass, text: stateWord })];
    if (status.stale) {
      content.push(el("span", { class: "ledger-saved", text: "saved copy" }));
    }
    let item;
    if (status.state === "ok" && status.count > 0) {
      item = el(
        "button",
        {
          type: "button",
          class: "ledger-item",
          "data-source": id,
          "aria-pressed": String(view.filter === id),
          title: `Show only ${label}`,
        },
        ...content,
      );
    } else {
      item = el("span", { class: "ledger-item is-static", "data-source": id }, ...content);
    }
    list.append(el("li", {}, item));
    if (status.note) {
      const labels = notesByMessage.get(status.note) ?? [];
      labels.push(label);
      notesByMessage.set(status.note, labels);
    }
    const quotaNote = quotaWords(status.quota);
    if (quotaNote) {
      notesByMessage.set(quotaNote, [label]);
    }
  }
  for (const [message, labels] of notesByMessage) {
    const everySource = labels.length === snapshot.planned.length && labels.length > 2;
    const who = everySource ? `All ${labels.length} sources` : labels.join(", ");
    notes.append(el("li", { text: `${who}: ${message}` }));
  }
  notes.hidden = notes.children.length === 0;
  byId("ledger-count").textContent = ledgerCount(snapshot);
}

/** "12 of 300 free requests left today", said only when the free quota of a source is nearly used up. */
function quotaWords(quota) {
  if (!quota || !(quota.max > 0) || quota.remaining > quota.max * QUOTA_LOW_SHARE) {
    return "";
  }
  const period = { day: "today", hour: "this hour", minute: "this minute" }[quota.per] ?? "for now";
  return `${quota.remaining} of ${quota.max} free requests left ${period}; answers are kept in this browser to save them.`;
}

/** One-line state of the ledger for the phone toggle: "Asking 10" or "9 of 10 answered". */
function ledgerCount(snapshot) {
  const states = snapshot.planned.map((id) => snapshot.status[id].state);
  if (states.includes("loading")) {
    return `Asking ${states.length}`;
  }
  const answered = states.filter((state) => state === "ok" || state === "empty").length;
  return `${answered} of ${states.length} answered`;
}

function setLedgerOpen(open) {
  byId("ledger").classList.toggle("is-open", open);
  byId("ledger-toggle").setAttribute("aria-expanded", String(open));
  byId("ledger-toggle-word").textContent = open ? "Hide" : "Show";
}

// ------------------------------------------------------------------------------- summary etc.

function renderSummary(snapshot) {
  const target = byId("summary");
  const total = snapshot.planned.length;
  const states = snapshot.planned.map((id) => snapshot.status[id].state);
  const loading = states.filter((state) => state === "loading").length;
  if (!snapshot.done && loading > 0) {
    const answered = total - loading;
    target.textContent = `Asking ${total} ${total === 1 ? "source" : "sources"}… ${answered} answered so far.`;
    return;
  }
  const answered = states.filter((state) => state === "ok" || state === "empty").length;
  const failed = total - answered;
  const count = snapshot.results.length;
  const parts = [`${count} ${count === 1 ? "result" : "results"} from ${answered} of ${total} ${total === 1 ? "source" : "sources"}`];
  const allCached = snapshot.planned.every((id) => snapshot.status[id].cached);
  const staleAges = snapshot.planned.map((id) => snapshot.status[id]).filter((status) => status.stale);
  if (allCached && total > 0) {
    parts.push("answered from the copy kept in this browser");
  } else if (view.elapsedMs !== null) {
    parts.push(`${(view.elapsedMs / 1000).toFixed(1)} s`);
  }
  let text = `${parts.join(", ")}.`;
  if (failed > 0) {
    text += ` ${failed} did not answer.`;
  }
  if (staleAges.length > 0) {
    const oldest = Math.max(...staleAges.map((status) => status.ageMs ?? 0));
    const which = staleAges.length === 1 ? "1 source is" : `${staleAges.length} sources are`;
    text += ` ${which} shown from a saved copy, up to ${ageWords(oldest)} old.`;
  }
  if (!navigator.onLine) {
    text += " You appear to be offline.";
  }
  target.textContent = text;
}

function renderNotice(snapshot) {
  const target = byId("notice");
  target.replaceChildren();
  const { parsed, window: dates } = snapshot;
  const sentences = [];
  if (dates.before && dates.after) {
    sentences.push(`Only items dated ${longDate(dates.after)} to ${longDate(dates.before)}.`);
  } else if (dates.before) {
    sentences.push(`Only items dated on or before ${longDate(dates.before)}.`);
  } else if (dates.after) {
    sentences.push(`Only items dated on or after ${longDate(dates.after)}.`);
  }
  if (dates.before) {
    sentences.push("Undated items are hidden, and Wikipedia titles open the archived copy from that date.");
  }
  if (parsed.sources.length) {
    const names = parsed.sources.map((id) => sourceLabel(id, snapshot.status[id])).join(", ");
    sentences.push(`Asking only ${names} because of in:.`);
  }
  if (parsed.excluded.length) {
    sentences.push(`Leaving out results that mention ${parsed.excluded.join(", ")}.`);
  }
  if (snapshot.suggestion) {
    const params = new URLSearchParams({ q: snapshot.suggestion });
    if (view.lens !== "all") {
      params.set("lens", view.lens);
    }
    if (view.beforeAI) {
      params.set("before_ai", "1");
    }
    target.append(
      "Did you mean ",
      el("a", { class: "suggestion", href: `#${params}`, text: snapshot.suggestion }),
      "? Wikipedia suggests this spelling. ",
    );
  }
  if (sentences.length) {
    target.append(sentences.join(" "));
  }
  if (view.filter) {
    const label = sourceLabel(view.filter, snapshot.status[view.filter]);
    target.append(sentences.length ? " " : "", `Showing ${label} only. `);
    target.append(el("button", { type: "button", class: "text-button", "data-action": "clear-filter", text: "Show all sources" }));
  }
  target.hidden = target.childNodes.length === 0;
}

function renderUpdateButton() {
  const button = byId("update-button");
  if (!view.pending || !view.shown) {
    button.hidden = true;
    return;
  }
  const extra = view.pending.results.length - view.shown.results.length;
  button.textContent =
    extra > 0
      ? `${extra} more ${extra === 1 ? "result" : "results"} arrived from slower sources. Show them`
      : "Slower sources changed the order. Update the list";
  button.hidden = false;
}

// ---------------------------------------------------------------------------------- passages

function renderPassages(snapshot) {
  const box = byId("passages");
  const list = byId("passage-list");
  list.replaceChildren();
  if (view.filter || !snapshot.passages.length) {
    box.hidden = true;
    return;
  }
  for (const passage of snapshot.passages) {
    const doc = snapshot.results[passage.resultIndex];
    if (!doc) {
      continue;
    }
    const number = passage.resultIndex + 1;
    const year = doc.living ? "" : describeDate(doc).slice(0, 4);
    const quote = el(
      "blockquote",
      { cite: safeLink(doc.url) || null },
      el("p", {}, `“${passage.text}”`, el("sup", { class: "ref", "aria-hidden": "true", text: String(number) })),
    );
    const attribution = el(
      "button",
      { type: "button", class: "tap attribution", "data-jump": String(number), title: `Go to result ${number}` },
      el("span", { class: "attribution-number", text: `${number}` }),
      el(
        "span",
        {},
        `${sourceLabel(doc.source, snapshot.status[doc.source])}, `,
        el("cite", { text: truncate(doc.title, 80) }),
        /^\d{4}$/.test(year) ? `, ${year}` : "",
      ),
    );
    list.append(el("li", { class: "passage" }, quote, attribution));
  }
  box.hidden = list.children.length === 0;
}

// ----------------------------------------------------------------------------------- results

function renderResults(snapshot) {
  const list = byId("results");
  list.replaceChildren();
  const numbered = snapshot.results.map((doc, index) => ({ doc, number: index + 1 }));
  const visible = numbered.filter((entry) => !view.filter || entry.doc.source === view.filter);
  for (const entry of visible.slice(0, view.limit)) {
    list.append(resultItem(entry.doc, entry.number, snapshot));
  }
  const more = byId("more-button");
  const left = visible.length - view.limit;
  if (left > 0) {
    more.textContent = `Show ${Math.min(PAGE_SIZE, left)} more (${left} left)`;
    more.hidden = false;
  } else {
    more.hidden = true;
  }
}

function resultItem(doc, number, snapshot) {
  const status = snapshot.status[doc.source];
  const dates = snapshot.window;
  const label = sourceLabel(doc.source, status);
  const original = safeLink(doc.url);
  const useSnapshot = Boolean(doc.living && dates.before && original);
  const href = useSnapshot ? snapshotUrl(original, dates.before) : original;

  const kicker = el("p", { class: "kicker" });
  kicker.append(el("span", { class: "kind", text: KIND_LABELS[doc.kind] ?? "Page" }));
  kicker.append(el("span", { class: "kicker-source", text: label }));
  const date = describeDate(doc);
  if (useSnapshot) {
    kicker.append(el("span", { text: `archived copy of ${longDate(dates.before)}` }));
  } else if (doc.living) {
    kicker.append(el("span", { text: "living page" }));
  } else if (date) {
    kicker.append(el("span", { text: doc.dateIsYear ? date : longDate(date) }));
  } else {
    kicker.append(el("span", { text: "undated" }));
  }

  const titleNode = href
    ? el("a", { ...linkProps(href, "title-link"), text: doc.title })
    : el("span", { class: "title-link", text: doc.title });
  const item = el(
    "li",
    { class: "result", id: `result-${number}`, "data-source": doc.source, "data-doc": doc.id },
    el("span", { class: "result-number", "aria-hidden": "true", text: String(number) }),
    kicker,
    el("h3", { class: "result-title" }, titleNode),
  );

  const shownUrl = displayUrl(original);
  if (shownUrl) {
    item.append(el("p", { class: "result-url", text: shownUrl }));
  }
  const byline = [doc.author, doc.venue].filter(Boolean).join(" · ");
  if (byline) {
    item.append(el("p", { class: "byline", text: truncate(byline, 140) }));
  }
  if (doc.snippet) {
    const terms = snapshot.parsed.terms;
    const snippetClass = doc.snippetIsMeta ? "snippet is-meta" : "snippet";
    item.append(el("p", { class: snippetClass, html: highlight(truncate(doc.snippet, 320), terms) }));
  }
  if (doc.extra && doc.kind === "discussion") {
    item.append(el("p", { class: "byline", text: truncate(doc.extra, 140) }));
  }

  const badges = [...doc.why.evidenceNotes];
  for (const other of doc.alsoIn ?? []) {
    badges.push(`also in ${sourceLabel(other, snapshot.status[other])}`);
  }
  if (badges.length) {
    const badgeList = el("ul", { class: "badges", "aria-label": "What the source reports" });
    for (const badge of badges) {
      badgeList.append(el("li", { text: readableDates(badge) }));
    }
    item.append(badgeList);
  }
  item.append(el("p", { class: "why-line", text: whyLine(doc, number, snapshot) }));

  const actions = el("div", { class: "actions" });
  const openPanel = view.open.get(doc.id);
  actions.append(
    el("button", {
      type: "button",
      class: "action",
      "data-action": "why",
      "aria-expanded": String(openPanel === "why"),
      text: `Why ${ordinal(number)}`,
    }),
    el("button", {
      type: "button",
      class: "action",
      "data-action": "cite",
      "aria-expanded": String(openPanel === "cite"),
      text: "Cite",
    }),
  );
  if (original) {
    actions.append(el("a", { ...linkProps(snapshotUrl(original), "action tap"), text: "Archived copy" }));
  }
  if (useSnapshot) {
    actions.append(el("a", { ...linkProps(original, "action tap"), text: "Current page" }));
  }
  const pdf = safeLink(doc.links?.pdf);
  if (pdf && pdf !== original) {
    actions.append(el("a", { ...linkProps(pdf, "action tap"), text: "Free full text" }));
  }
  const article = safeLink(doc.links?.article);
  if (article && article !== original) {
    actions.append(el("a", { ...linkProps(article, "action tap"), text: "Linked page" }));
  }
  item.append(actions);

  const panel = el("div", { class: "panel", hidden: !openPanel });
  if (openPanel === "why") {
    panel.append(whyPanel(doc, number, snapshot));
  } else if (openPanel === "cite") {
    panel.append(citePanel(doc));
  }
  item.append(panel);
  return item;
}

function whyLine(doc, number, snapshot) {
  const why = doc.why;
  const label = sourceLabel(doc.source, snapshot.status[doc.source]);
  const totalTerms = why.matched.length + why.missing.length;
  const reasons = [];
  if (why.titleIsQuery) {
    reasons.push("its title is your query");
  } else if (why.titleIsCore) {
    reasons.push(`its title is your query without "${why.intentWords.join(" ")}"`);
  } else if (why.titleHasAll) {
    reasons.push("every query word is in its title");
  } else if (totalTerms > 0) {
    reasons.push(`${why.matched.length} of ${totalTerms} query words were found in it`);
  }
  if (why.phraseRun >= 1 && !why.titleIsQuery) {
    reasons.push("it repeats your query word for word");
  }
  reasons.push(`${label} itself listed it ${ordinal(why.upstreamPosition)}`);
  const lead = number === 1 ? "First" : ordinal(number);
  return `${lead} because ${reasons.join(" and ")}.`;
}

function whyRow(label, detail, sum) {
  const term = el("dt", {}, label);
  if (detail) {
    term.append(el("span", { class: "why-detail", text: detail }));
  }
  return el("div", { class: "why-row" }, term, el("dd", { text: sum }));
}

function whyPanel(doc, number, snapshot) {
  const why = doc.why;
  const label = sourceLabel(doc.source, snapshot.status[doc.source]);
  const box = el("div", { class: "why" });
  const list = el("dl", { class: "why-list" });
  const totalTerms = why.matched.length + why.missing.length;
  const textNotes = [`${why.matched.length} of ${totalTerms} query words found`];
  if (why.titleIsQuery) {
    textNotes.push("the title is your query");
  } else if (why.titleIsCore) {
    textNotes.push(`the title is your query without "${why.intentWords.join(" ")}"`);
  } else if (why.titleHasAll) {
    textNotes.push("all of them in the title");
  }
  if (why.alias) {
    textNotes.push(`${label} also files this page under "${why.alias}"`);
  }
  if (why.phraseNote) {
    textNotes.push(why.phraseNote);
  }
  list.append(
    whyRow("Words", textNotes.join("; "), `${fixed(why.text)} × ${WEIGHTS.text} = ${fixed(why.text * WEIGHTS.text)}`),
    whyRow(
      "Evidence the source reports",
      readableDates(why.evidenceNotes.join(", ")) || "none beyond the kind of page",
      `${fixed(why.evidence)} × ${WEIGHTS.evidence} = ${fixed(why.evidence * WEIGHTS.evidence)}`,
    ),
    whyRow(
      `${label}'s own order`,
      `it listed this ${ordinal(why.upstreamPosition)}`,
      `${fixed(why.upstream)} × ${WEIGHTS.upstream} = ${fixed(why.upstream * WEIGHTS.upstream)}`,
    ),
  );
  // The two bonuses do not add up: the larger one counts.
  const titleBonus = why.titleIsQuery || why.titleIsCore ? 0.08 : 0;
  const runBonus = TUNING.runBonus * (why.phraseRun ?? 0);
  if (titleBonus > 0 && titleBonus >= runBonus) {
    list.append(whyRow("Exact title", "", "+ 0.08"));
  } else if (runBonus > 0) {
    const share = Math.round(why.phraseRun * 100);
    list.append(
      whyRow("Your words in order", `${share}% of your query is in it word for word`, `+ ${fixed(runBonus)}`),
    );
  }
  if (why.recency > 0) {
    list.append(whyRow("Recent", "you asked for something new", `+ ${fixed(why.recency)}`));
  }
  const intentBoost = why.intentBoost ?? 1;
  const lensOnly = why.lens / intentBoost;
  if (Math.abs(lensOnly - 1) > 1e-9) {
    const lensName = LENSES[view.lens]?.label ?? "All";
    list.append(whyRow(`${lensName} lens`, `weight for ${label}`, `× ${fixed(lensOnly)}`));
  }
  if (intentBoost !== 1) {
    list.append(
      whyRow("Kind of page you asked for", `your query says "${why.intentWords.join(" ")}"`, `× ${fixed(intentBoost)}`),
    );
  }
  if (why.diversity !== 1) {
    list.append(whyRow("Variety", `not the first ${label} result on the page`, `× ${fixed(why.diversity)}`));
  }
  list.append(whyRow("Score", `${ordinal(number)} of ${snapshot.results.length}`, fixed(doc.finalScore ?? doc.score)));
  box.append(list);
  if (why.missing.length) {
    box.append(el("p", { class: "fine", text: `Not found in the title or excerpt (word stems): ${why.missing.join(", ")}.` }));
  }
  const foot = el("p", { class: "fine" }, "No payment, click count or personal profile is part of this. ");
  foot.append(el("a", { href: "about.html#ranking", text: "The full formula" }));
  box.append(foot);
  return box;
}

function citePanel(doc) {
  const text = formatCitation(doc, today());
  return el(
    "div",
    { class: "cite" },
    el("p", { class: "citation", text }),
    el("button", { type: "button", class: "plain-button", "data-action": "copy", text: "Copy citation" }),
    el("span", { class: "copy-status fine", role: "status", "aria-live": "polite" }),
  );
}

// --------------------------------------------------------------------------- empty, elsewhere

function renderEmpty(snapshot) {
  const box = byId("empty");
  box.replaceChildren();
  if (snapshot.results.length > 0 || !snapshot.done) {
    box.hidden = true;
    return;
  }
  const states = snapshot.planned.map((id) => snapshot.status[id].state);
  const anyAnswer = states.some((state) => state === "ok" || state === "empty");
  if (!anyAnswer) {
    box.append(
      el("h2", { text: "None of the sources answered" }),
      el("p", {
        text: navigator.onLine
          ? "This network may be blocking them, or they are slow right now. Nothing is wrong with your query."
          : "You appear to be offline. Searches you ran before still open from the copy kept in this browser.",
      }),
      el("button", { type: "button", class: "plain-button", "data-action": "retry", text: "Try again" }),
    );
  } else {
    box.append(el("h2", { text: "No source had a match" }));
    const tips = el("ul", { class: "tips" });
    tips.append(el("li", { text: "Telisik matches words, not meaning. Try the plain terms a title would use." }));
    if (snapshot.parsed.phrases.length || snapshot.parsed.excluded.length || snapshot.parsed.sources.length) {
      tips.append(el("li", { text: "Remove the quotes, minus words or in: to widen the search." }));
    }
    box.append(tips);
    const buttons = el("div", { class: "empty-actions" });
    if (view.beforeAI) {
      buttons.append(el("button", { type: "button", class: "plain-button", "data-action": "all-dates", text: "Turn off Before AI" }));
    }
    if (view.lens !== "all") {
      buttons.append(el("button", { type: "button", class: "plain-button", "data-action": "all-lens", text: "Ask every source" }));
    }
    if (buttons.children.length) {
      box.append(buttons);
    }
  }
  box.hidden = false;
}

function renderElsewhere(snapshot) {
  const list = byId("elsewhere-list");
  list.replaceChildren();
  for (const key of ELSEWHERE) {
    const bang = BANGS[key];
    const url = bangUrl(key, snapshot.parsed.text);
    list.append(el("li", {}, el("a", { ...linkProps(url, "tap"), text: bang.name }), el("code", { text: `!${key}` })));
  }
  byId("report-link").href = reportUrl(snapshot);
  byId("elsewhere").hidden = !snapshot.done && snapshot.results.length === 0;
}

/**
 * A prefilled public issue. Nothing is sent unless the person follows the link and presses
 * submit on GitHub themselves, and the page says the query becomes public there.
 */
function reportUrl(snapshot) {
  const ledger = snapshot.planned
    .map((id) => {
      const status = snapshot.status[id];
      const word = status.state === "ok" ? `${status.count} shown` : STATE_WORDS[status.state] ?? status.state;
      return `- ${sourceLabel(id, status)}: ${word}${status.stale ? " (saved copy)" : ""}`;
    })
    .join("\n");
  const top = snapshot.results
    .slice(0, 3)
    .map((doc, index) => `${index + 1}. ${truncate(doc.title, 90)} (${sourceLabel(doc.source, snapshot.status[doc.source])})`)
    .join("\n");
  const body = [
    `Query: ${view.query}`,
    `Lens: ${LENSES[view.lens]?.label ?? "All"}${view.beforeAI ? ", Before AI on" : ""}`,
    "",
    "What I expected to find:",
    "",
    "",
    "Sources asked:",
    ledger,
    "",
    "Top results:",
    top || "(none)",
  ].join("\n");
  const params = new URLSearchParams({ title: `Search report: ${truncate(view.query, 80)}`, body });
  return `${REPORT_URL}?${params}`;
}

// ---------------------------------------------------------------------------------- settings

function applyTheme() {
  document.documentElement.setAttribute("data-theme", settings.theme);
}

function saveSettings() {
  storage.write(SETTINGS_KEY, settings);
}

function setupSettings() {
  const dialog = byId("settings");
  const theme = byId("set-theme");
  const wiki = byId("set-wiki");
  const keep = byId("set-history");
  const newTab = byId("set-newtab");
  const stackKey = byId("set-stackkey");
  const status = byId("settings-status");
  for (const [code, name] of WIKI_LANGUAGES) {
    wiki.append(el("option", { value: code, text: name }));
  }
  if (!WIKI_LANGUAGES.some(([code]) => code === settings.wikiLang)) {
    settings.wikiLang = "en";
  }

  byId("open-settings").addEventListener("click", () => {
    theme.value = settings.theme;
    wiki.value = settings.wikiLang;
    keep.checked = settings.keepHistory;
    newTab.checked = settings.newTab;
    stackKey.value = settings.stackKey;
    status.textContent = "";
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  theme.addEventListener("change", () => {
    settings.theme = theme.value;
    applyTheme();
    saveSettings();
  });
  wiki.addEventListener("change", () => {
    settings.wikiLang = wiki.value;
    saveSettings();
    if (view.query) {
      startSearch({ push: false });
    }
  });
  keep.addEventListener("change", () => {
    settings.keepHistory = keep.checked;
    if (!keep.checked) {
      storage.remove(HISTORY_KEY);
    }
    saveSettings();
    renderHistory();
  });
  newTab.addEventListener("change", () => {
    settings.newTab = newTab.checked;
    saveSettings();
    if (view.shown) {
      paint(view.shown);
    }
  });
  stackKey.addEventListener("change", () => {
    const value = stackKey.value.trim();
    // The same shape the Stack Exchange adapter accepts before it adds the key to a request.
    if (value && !/^[A-Za-z0-9()*]{8,40}$/.test(value)) {
      status.textContent = "That does not look like a Stack Exchange key, so it was not saved.";
      return;
    }
    settings.stackKey = value;
    saveSettings();
    status.textContent = value ? "Key saved in this browser." : "Key removed.";
  });
  byId("clear-data").addEventListener("click", () => {
    storage.remove(HISTORY_KEY);
    cache.clear();
    renderHistory();
    status.textContent = "Cleared. Nothing about your searches is stored in this browser now.";
  });
}

function setupMoney() {
  const sponsorUrl = safeHttpsUrl(CONFIG.sponsor?.url);
  const sponsorText = String(CONFIG.sponsor?.text ?? "").trim();
  if (sponsorUrl && sponsorText) {
    const box = byId("sponsor");
    box.append(
      el("span", { class: "sponsor-label", text: "Sponsor" }),
      el("a", { href: sponsorUrl, rel: "noopener noreferrer sponsored", text: truncate(sponsorText, 120) }),
      el("span", { class: "fine", text: " Sponsors never change the ranking." }),
    );
    box.hidden = false;
  }
  const supportUrl = safeHttpsUrl(CONFIG.support?.url);
  if (supportUrl) {
    const item = byId("support");
    item.append(el("a", { class: "tap", href: supportUrl, rel: "noopener noreferrer", text: CONFIG.support.label || "Support Telisik" }));
    item.hidden = false;
  }
}

/**
 * Chromium browsers announce that the page can be installed with an event, and only then is the
 * button shown. Firefox and Safari install from their own menus and never fire it.
 */
function setupInstall() {
  const item = byId("install");
  let offer = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    offer = event;
    item.hidden = false;
  });
  byId("install-button").addEventListener("click", () => {
    offer?.prompt();
    offer = null;
    item.hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    item.hidden = true;
  });
}

// ------------------------------------------------------------------------------------ events

function togglePanel(item, kind) {
  const docId = item.dataset.doc;
  if (view.open.get(docId) === kind) {
    view.open.delete(docId);
  } else {
    view.open.set(docId, kind);
  }
  const number = Number(item.id.replace("result-", ""));
  const doc = view.shown.results[number - 1];
  const fresh = resultItem(doc, number, view.shown);
  item.replaceWith(fresh);
  fresh.querySelector(`[data-action="${kind}"]`)?.focus();
}

async function copyCitation(button) {
  const box = button.closest(".cite");
  const text = box.querySelector(".citation").textContent;
  const status = box.querySelector(".copy-status");
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "Copied.";
  } catch {
    const range = document.createRange();
    range.selectNodeContents(box.querySelector(".citation"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    status.textContent = "Selected. Press Ctrl+C or Cmd+C to copy.";
  }
}

function jumpToResult(number) {
  const reveal = () => {
    const target = byId(`result-${number}`);
    if (!target) {
      return;
    }
    target.scrollIntoView({ block: "start" });
    target.querySelector(".title-link")?.focus({ preventScroll: true });
  };
  if (view.limit < number) {
    view.limit = Math.ceil(number / PAGE_SIZE) * PAGE_SIZE;
    renderResults(view.shown);
  }
  reveal();
}

function moveCursor(step) {
  const links = [...document.querySelectorAll("#results .result .title-link")];
  if (!links.length) {
    return;
  }
  const current = links.findIndex((link) => link.closest(".result").contains(document.activeElement));
  const next = Math.min(links.length - 1, Math.max(0, current + step));
  links[next].focus();
  links[next].closest(".result").scrollIntoView({ block: "nearest" });
}

function setupEvents() {
  byId("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    view.query = byId("q").value.trim();
    startSearch();
    if (view.query) {
      byId("q").blur();
    }
  });

  byId("home-link").addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    history.pushState(null, "", location.pathname);
    showHome();
    window.scrollTo(0, 0);
  });

  for (const button of document.querySelectorAll(".lens")) {
    button.addEventListener("click", () => {
      view.lens = button.dataset.lens;
      syncControlsKeepingInput();
      if (view.query) {
        startSearch();
      }
    });
  }

  byId("before-ai").addEventListener("click", () => {
    view.beforeAI = !view.beforeAI;
    syncControlsKeepingInput();
    if (view.query) {
      startSearch();
    }
  });

  byId("home-view").addEventListener("click", (event) => {
    const link = event.target.closest("a[href^='#q=']");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    const params = new URLSearchParams(link.getAttribute("href").slice(1));
    view.query = (params.get("q") ?? "").trim();
    view.lens = LENSES[params.get("lens")] ? params.get("lens") : "all";
    view.beforeAI = params.get("before_ai") === "1";
    startSearch();
  });

  byId("clear-history").addEventListener("click", () => {
    storage.remove(HISTORY_KEY);
    renderHistory();
  });

  byId("ledger-toggle").addEventListener("click", () => {
    setLedgerOpen(!byId("ledger").classList.contains("is-open"));
  });

  byId("ledger-list").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-source]");
    if (!button || !view.shown) {
      return;
    }
    view.filter = view.filter === button.dataset.source ? null : button.dataset.source;
    view.limit = PAGE_SIZE;
    renderLedger(view.latest ?? view.shown);
    paint(view.pending ?? view.shown);
    byId("ledger-list").querySelector(`button[data-source="${button.dataset.source}"]`)?.focus();
  });

  byId("update-button").addEventListener("click", () => {
    if (view.pending) {
      paint(view.pending);
    }
  });

  byId("more-button").addEventListener("click", () => {
    const firstNew = view.limit;
    view.limit += PAGE_SIZE;
    renderResults(view.shown);
    document.querySelectorAll("#results .result .title-link")[firstNew]?.focus();
  });

  byId("results-view").addEventListener("click", (event) => {
    const jump = event.target.closest("[data-jump]");
    if (jump) {
      event.preventDefault();
      jumpToResult(Number(jump.dataset.jump));
      return;
    }
    const control = event.target.closest("[data-action]");
    if (!control) {
      return;
    }
    const action = control.dataset.action;
    if (action === "why" || action === "cite") {
      togglePanel(control.closest(".result"), action);
    } else if (action === "copy") {
      copyCitation(control);
    } else if (action === "clear-filter") {
      view.filter = null;
      renderLedger(view.latest ?? view.shown);
      paint(view.pending ?? view.shown);
    } else if (action === "retry") {
      startSearch({ push: false });
    } else if (action === "all-dates") {
      view.beforeAI = false;
      startSearch();
    } else if (action === "all-lens") {
      view.lens = "all";
      startSearch();
    }
  });

  // Back, forward and hand-edited addresses. pushState never fires these, so there is no loop.
  const followLocation = () => {
    const next = readLocation();
    if (next.query === view.query && next.lens === view.lens && next.beforeAI === view.beforeAI) {
      return;
    }
    Object.assign(view, next);
    if (view.query) {
      startSearch({ push: false });
    } else {
      showHome();
    }
  };
  window.addEventListener("popstate", followLocation);
  window.addEventListener("hashchange", followLocation);

  document.querySelector(".skip-link").addEventListener("click", (event) => {
    event.preventDefault();
    byId("main").focus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const target = event.target;
    const typing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if (typing) {
      if (event.key === "Escape" && target.id === "q") {
        target.blur();
      }
      return;
    }
    if (byId("settings").open) {
      return;
    }
    if (event.key === "/") {
      event.preventDefault();
      byId("q").focus();
      byId("q").select();
    } else if (event.key === "j") {
      moveCursor(1);
    } else if (event.key === "k") {
      moveCursor(-1);
    }
  });
}

/** Lens and Before-AI clicks must not wipe what the person is still typing. */
function syncControlsKeepingInput() {
  const typed = byId("q").value;
  syncControls();
  byId("q").value = typed;
  view.query = typed.trim();
}

function registerServiceWorker() {
  if (location.protocol === "https:" && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // Offline shell is a convenience; the page works without it.
    });
  }
}

function start() {
  applyTheme();
  setupSettings();
  setupMoney();
  setupInstall();
  setupEvents();
  Object.assign(view, readLocation());
  if (location.search) {
    history.replaceState(null, "", buildSearchString());
  }
  if (view.query) {
    startSearch({ push: false });
  } else {
    showHome();
    if (window.matchMedia("(pointer: fine)").matches) {
      byId("q").focus();
    }
  }
  registerServiceWorker();
}

start();
