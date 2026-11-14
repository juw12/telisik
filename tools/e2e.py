"""End-to-end check of Telisik in a real Chromium (Playwright).

    python tools/e2e.py                 hermetic run: every API call is answered from tests/fixtures
    python tools/e2e.py --shots DIR     also save screenshots
    python tools/e2e.py --live          add one search against the real sources
    python tools/e2e.py --base URL      check a deployed copy instead of the local folder

Gates: no console or page errors, no CSP violation, no request outside the declared sources,
no horizontal overflow at 320/390/768/1024/1440 px, WCAG AA contrast for every piece of text,
44 px tap targets on phones, no text under 12 px, one h1, a title, alt text on images.
Exit code 1 when any gate fails.
"""

import argparse
import functools
import http.server
import json
import os
import re
import socketserver
import sys
import threading
import time
from pathlib import Path
from urllib.parse import unquote_plus, urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures"
WIDTHS = [320, 390, 768, 1024, 1440]
SCHEMES = ["light", "dark"]
QUERY = "binary search tree"
PROXY = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or ""

# Same routing as tools/fixture-names.mjs, which the unit tests use.
FIXTURE_HOSTS = {
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
    "data.europa.eu": "eudata",
    "open.canada.ca": "canadadata",
    "data.gov.au": "ausdata",
}
WIKI_PROJECTS = ["wikipedia", "wikibooks", "wiktionary", "wikinews", "wikiquote", "wikivoyage", "wikisource"]

AUDIT_JS = r"""
(phone) => {
  const report = { overflow: 0, protruding: [], small: [], contrast: [], taps: [], images: [], unparsed: [] };
  const root = document.documentElement;
  const pageWidth = root.clientWidth;
  report.overflow = Math.max(root.scrollWidth, document.body.scrollWidth) - pageWidth;
  report.h1 = document.querySelectorAll("h1").length;
  report.title = document.title;
  report.viewport = Boolean(document.querySelector('meta[name="viewport"][content*="width=device-width"]'));

  const describe = (node) => {
    const id = node.id ? "#" + node.id : "";
    const cls = typeof node.className === "string" && node.className ? "." + node.className.trim().split(/\s+/).join(".") : "";
    const text = (node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${node.tagName.toLowerCase()}${id}${cls} "${text}"`;
  };
  const parse = (value) => {
    const match = /^rgba?\(([^)]+)\)$/.exec(value);
    if (!match) {
      return null;
    }
    const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const luminance = (color) => {
    const channel = (value) => {
      const unit = value / 255;
      return unit <= 0.03928 ? unit / 12.92 : Math.pow((unit + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  };
  const ratio = (first, second) => {
    const a = luminance(first);
    const b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const backgroundOf = (node) => {
    const layers = [];
    let opacity = 1;
    for (let cursor = node; cursor && cursor.nodeType === 1; cursor = cursor.parentElement) {
      const style = getComputedStyle(cursor);
      const color = parse(style.backgroundColor);
      if (color === null) {
        report.unparsed.push(`${describe(cursor)} background ${style.backgroundColor}`);
        continue;
      }
      if (color.a > 0) {
        layers.push(color);
        if (color.a === 1) {
          break;
        }
      }
    }
    let result = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers.reverse()) {
      result = over(layer, result);
    }
    return result;
  };
  const opacityOf = (node) => {
    let opacity = 1;
    for (let cursor = node; cursor && cursor.nodeType === 1; cursor = cursor.parentElement) {
      opacity *= Number(getComputedStyle(cursor).opacity);
    }
    return opacity;
  };
  const visible = (node) => {
    if (node.getClientRects().length === 0) {
      return false;
    }
    const style = getComputedStyle(node);
    if (style.visibility !== "visible") {
      return false;
    }
    const box = node.getBoundingClientRect();
    return box.width > 1.5 && box.height > 1.5;
  };
  const clipped = (node) => {
    for (let cursor = node; cursor && cursor.nodeType === 1; cursor = cursor.parentElement) {
      if (cursor.classList.contains("visually-hidden") || cursor.classList.contains("skip-link")) {
        return true;
      }
    }
    return false;
  };
  const scrolls = (node) => {
    for (let cursor = node.parentElement; cursor && cursor !== document.body; cursor = cursor.parentElement) {
      const overflowX = getComputedStyle(cursor).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") {
        return true;
      }
    }
    return false;
  };

  for (const node of document.body.querySelectorAll("*")) {
    if (["SCRIPT", "STYLE", "NOSCRIPT", "OPTION"].includes(node.tagName) || !visible(node) || clipped(node)) {
      continue;
    }
    const box = node.getBoundingClientRect();
    if ((box.right > pageWidth + 1 || box.left < -1) && !scrolls(node)) {
      report.protruding.push(`${describe(node)} left ${box.left.toFixed(0)} right ${box.right.toFixed(0)} of ${pageWidth}`);
    }
    const ownText = [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim().length > 0);
    const isField = node.tagName === "INPUT" || node.tagName === "SELECT";
    if (!ownText && !isField) {
      continue;
    }
    if (node.tagName === "INPUT" && (node.type === "checkbox" || !node.value)) {
      continue;
    }
    const style = getComputedStyle(node);
    const size = parseFloat(style.fontSize);
    if (size < 12) {
      report.small.push(`${describe(node)} ${size}px`);
    }
    const ink = parse(style.color);
    if (ink === null) {
      report.unparsed.push(`${describe(node)} color ${style.color}`);
      continue;
    }
    const paper = backgroundOf(node);
    ink.a *= opacityOf(node);
    const shown = over(ink, paper);
    const value = ratio(shown, paper);
    const bold = Number(style.fontWeight) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const needed = large ? 3 : 4.5;
    if (value < needed) {
      report.contrast.push(`${describe(node)} ${value.toFixed(2)} < ${needed} (${style.color} on rgb(${paper.r.toFixed(0)}, ${paper.g.toFixed(0)}, ${paper.b.toFixed(0)}))`);
    }
  }

  if (phone) {
    for (const node of document.body.querySelectorAll("button, select, input, a, label.check, summary")) {
      if (!visible(node) || clipped(node)) {
        continue;
      }
      if (node.tagName === "INPUT" && node.type === "checkbox" && node.closest("label.check")) {
        continue;
      }
      if (node.tagName === "A") {
        const display = getComputedStyle(node).display;
        const marked = node.classList.contains("tap") || node.classList.contains("action");
        if (display === "inline" && !marked) {
          continue;
        }
      }
      const box = node.getBoundingClientRect();
      if (box.width < 43.5 || box.height < 43.5) {
        report.taps.push(`${describe(node)} ${box.width.toFixed(0)}x${box.height.toFixed(0)}`);
      }
    }
  }

  for (const image of document.images) {
    if (!image.hasAttribute("alt")) {
      report.images.push(describe(image));
    }
  }
  return report;
}
"""

INIT_JS = """
window.__csp = [];
document.addEventListener("securitypolicyviolation", (event) => {
  window.__csp.push(`${event.violatedDirective} ${event.blockedURI}`);
});
"""


class Results:
    def __init__(self):
        self.rows = []

    def check(self, name, passed, detail=""):
        self.rows.append((name, bool(passed), detail))
        mark = "PASS" if passed else "FAIL"
        line = f"{mark}  {name}"
        if detail and not passed:
            line += f"\n      {detail}"
        print(line, flush=True)

    @property
    def failed(self):
        return [row for row in self.rows if not row[1]]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve_folder():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{server.server_address[1]}/"


def declared_hosts():
    """Hosts the page itself says it may talk to: connect-src of the CSP in index.html."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    policy = re.search(r'Content-Security-Policy" content="([^"]+)"', html).group(1)
    connect = re.search(r"connect-src ([^;]+)", policy).group(1).split()
    return [urlparse(entry).hostname for entry in connect if entry.startswith("https://")]


def host_allowed(host, allowed):
    for pattern in allowed:
        if pattern.startswith("*."):
            if host.endswith(pattern[1:]):
                return True
        elif host == pattern:
            return True
    return False


def fixture_for(url):
    """Name of the fixture that answers a request, or None when no fixture belongs to its host."""
    parts = urlparse(url)
    host = parts.hostname or ""
    if host == "openlibrary.org":
        return "bookstext" if parts.path.startswith("/search/inside") else "openlibrary"
    if host in FIXTURE_HOSTS:
        return FIXTURE_HOSTS[host]
    for project in WIKI_PROJECTS:
        if host.endswith(f".{project}.org"):
            return project
    return None


class Session:
    """One browser context with its own storage, network rules and error log."""

    def __init__(self, browser, base, allowed, width, scheme="light", mode="fixtures", height=900):
        self.base = base
        self.own_host = urlparse(base).hostname
        self.allowed = allowed
        self.mode = mode
        self.errors = []
        self.outside = []
        self.api_calls = []
        self.left_for = []
        self.context = browser.new_context(
            viewport={"width": width, "height": height},
            color_scheme=scheme,
            permissions=["clipboard-read", "clipboard-write"],
            is_mobile=width <= 390,
            has_touch=width <= 390,
        )
        self.context.add_init_script(INIT_JS)
        self.context.route("**/*", self.route)
        self.page = self.context.new_page()
        self.page.on("console", self.on_console)
        self.page.on("pageerror", lambda error: self.errors.append(f"pageerror: {error}"))

    def on_console(self, message):
        if message.type != "error":
            return
        text = message.text
        if self.mode == "dead" and "net::ERR_FAILED" in text:
            return
        self.errors.append(f"console: {text}")

    def route(self, route):
        request = route.request
        host = urlparse(request.url).hostname or ""
        if host == self.own_host:
            route.continue_()
            return
        if request.is_navigation_request():
            # A bang hands the query to another engine. Answer with a stub so nothing leaves.
            self.left_for.append(request.url)
            route.fulfill(status=200, content_type="text/html", body="<title>stub</title>stub")
            return
        if not host_allowed(host, self.allowed):
            self.outside.append(request.url)
            route.abort()
            return
        self.api_calls.append(request.url)
        if self.mode == "dead":
            route.abort()
        elif self.mode == "live":
            route.continue_()
        else:
            name = fixture_for(request.url)
            if name is None:
                # A declared host without a fixture would make the hermetic run depend on the network.
                self.outside.append(f"no fixture for {request.url}")
                route.abort()
                return
            body = (FIXTURES / f"{name}.json").read_text(encoding="utf-8")
            route.fulfill(
                status=200,
                content_type="application/json",
                headers={"Access-Control-Allow-Origin": "*"},
                body=body,
            )

    def open(self, path=""):
        self.page.goto(self.base + path, wait_until="load")
        self.page.wait_for_timeout(150)
        return self.page

    def wait_done(self, timeout=15000):
        self.page.wait_for_function(
            """() => /\\d+ results? from \\d+ of \\d+/.test(document.getElementById("summary").textContent)""",
            timeout=timeout,
        )
        self.page.wait_for_timeout(120)

    def csp(self):
        try:
            return self.page.evaluate("window.__csp || []")
        except Exception:
            return []

    def close(self):
        self.context.close()


def run_audit(results, session, label, phone):
    report = session.page.evaluate(AUDIT_JS, phone)
    results.check(f"{label}: no horizontal overflow", report["overflow"] <= 0 and not report["protruding"],
                  f"overflow {report['overflow']}px; " + "; ".join(report["protruding"][:6]))
    results.check(f"{label}: contrast AA", not report["contrast"] and not report["unparsed"],
                  "; ".join((report["contrast"] + report["unparsed"])[:8]))
    results.check(f"{label}: no text under 12 px", not report["small"], "; ".join(report["small"][:8]))
    if phone:
        results.check(f"{label}: tap targets 44 px", not report["taps"], "; ".join(report["taps"][:10]))
    results.check(f"{label}: one h1, title, viewport, alt text",
                  report["h1"] == 1 and report["title"] and report["viewport"] and not report["images"],
                  json.dumps({key: report[key] for key in ("h1", "title", "viewport", "images")}))
    results.check(f"{label}: no errors, CSP clean, no outside requests",
                  not session.errors and not session.csp() and not session.outside,
                  "; ".join(session.errors[:4] + session.csp()[:4] + session.outside[:4]))


def open_ledger(page):
    """On phones the source ledger is one line until its toggle is pressed."""
    toggle = page.locator("#ledger-toggle")
    if toggle.is_visible() and toggle.get_attribute("aria-expanded") == "false":
        toggle.click()


def shot(session, folder, name, full=True):
    if folder:
        folder.mkdir(parents=True, exist_ok=True)
        if full:
            session.page.evaluate("window.scrollTo(0, 0)")
        session.page.screenshot(path=str(folder / f"{name}.png"), full_page=full)


def visual_matrix(results, browser, base, allowed, shots):
    """Every page state at every width in both themes."""
    query = QUERY.replace(" ", "+")
    for width in WIDTHS:
        phone = width <= 390
        for scheme in SCHEMES:
            tag = f"{width}-{scheme}"
            keep = shots if width in (390, 1440) else None

            session = Session(browser, base, allowed, width, scheme)
            session.open()
            run_audit(results, session, f"home {tag}", phone)
            shot(session, keep, f"home-{tag}")
            session.page.click("#open-settings")
            session.page.wait_for_timeout(150)
            run_audit(results, session, f"settings {tag}", phone)
            shot(session, keep, f"settings-{tag}", full=False)
            session.close()

            session = Session(browser, base, allowed, width, scheme)
            session.open(f"#q={query}")
            session.wait_done()
            shot(session, keep, f"results-{tag}")
            shot(session, keep, f"results-fold-{tag}", full=False)
            session.page.click('#result-1 [data-action="why"]')
            session.page.click('#result-2 [data-action="cite"]')
            session.page.wait_for_timeout(120)
            run_audit(results, session, f"results {tag}", phone)
            shot(session, keep, f"results-panels-{tag}")
            session.close()

            session = Session(browser, base, allowed, width, scheme)
            session.open(f"#q={query}&lens=research&before_ai=1")
            session.wait_done()
            open_ledger(session.page)
            session.page.click("#ledger-list button[data-source]")
            session.page.wait_for_timeout(120)
            run_audit(results, session, f"before-ai filtered {tag}", phone)
            shot(session, keep, f"before-ai-{tag}")
            session.close()

            session = Session(browser, base, allowed, width, scheme)
            session.open(f"#q={query}+-binary+-tree+-search&lens=discuss")
            session.wait_done()
            run_audit(results, session, f"no match {tag}", phone)
            shot(session, keep, f"no-match-{tag}")
            session.close()

            session = Session(browser, base, allowed, width, scheme, mode="dead")
            session.open(f"#q={query}")
            session.wait_done(timeout=30000)
            run_audit(results, session, f"sources down {tag}", phone)
            shot(session, keep, f"sources-down-{tag}")
            session.close()

            session = Session(browser, base, allowed, width, scheme)
            session.open("about.html")
            run_audit(results, session, f"about {tag}", phone)
            shot(session, keep, f"about-{tag}")
            session.close()


def functional(results, browser, base, allowed):
    query = QUERY.replace(" ", "+")
    session = Session(browser, base, allowed, 1280)
    page = session.open()

    results.check("home: search box is focused on a desktop", page.evaluate("document.activeElement.id") == "q")
    page.fill("#q", QUERY)
    page.keyboard.press("Enter")
    session.wait_done()
    count = page.locator("#results > li.result").count()
    results.check("search: results render", count >= 10, f"{count} results")
    results.check("search: address uses the fragment", page.url.endswith(f"#q={query}"), page.url)
    results.check("search: title carries the query", page.title().startswith(QUERY), page.title())
    ledger = page.locator("#ledger-list li").count()
    results.check("search: ledger lists every source asked", ledger >= 10, f"{ledger} rows")
    asked = {fixture_for(url) for url in session.api_calls}
    results.check("search: ten sources were asked", len(asked) >= 10, ", ".join(sorted(asked)))
    report = page.get_attribute("#report-link", "href") or ""
    report_text = unquote_plus(report)
    results.check("report: the link opens a prefilled issue with the query and the sources asked",
                  report.startswith("https://github.com/juw12/telisik/issues/new?")
                  and f"Query: {QUERY}" in report_text and "Sources asked:" in report_text
                  and "Top results:\n1. " in report_text,
                  report_text[:300])
    results.check("report: following the link is the only way anything is sent",
                  not any("github.com/juw12" in url for url in session.api_calls + session.outside))
    carries_query = [url for url in session.api_calls if "binary" in url.lower()]
    results.check("search: every API call carries the query", len(carries_query) == len(session.api_calls))

    passages = page.locator("#passage-list li.passage").count()
    results.check("passages: verbatim quotes shown", passages >= 1, f"{passages} quotes")
    verbatim = page.evaluate(
        """() => {
          const texts = [...document.querySelectorAll("#results .snippet")].map((node) => node.textContent);
          const norm = (value) => value.replace(/\\s+/g, " ").trim();
          return [...document.querySelectorAll("#passage-list blockquote p")].map((node) => {
            const quote = norm(node.firstChild.textContent).replace(/^\\u201c|\\u201d$/g, "");
            return { quote, found: texts.some((text) => norm(text).includes(quote.replace(/\\u2026$/, "").trim())) };
          });
        }"""
    )
    missing = [entry["quote"][:60] for entry in verbatim if not entry["found"]]
    results.check("passages: each quote appears word for word in a result excerpt", not missing, "; ".join(missing))

    page.click("#passage-list [data-jump]")
    page.wait_for_timeout(500)
    results.check("passages: the number jumps to its result",
                  page.evaluate("document.activeElement.closest('.result') !== null"))

    page.click('#result-1 [data-action="why"]')
    why = page.inner_text("#result-1 .panel")
    results.check("why: panel shows the three weighted parts and a score",
                  all(word in why for word in ["Words", "Evidence", "own order", "Score"]), why[:200])
    numbers = page.evaluate(
        """() => [...document.querySelectorAll("#result-1 .why-row dd")].map((node) => node.textContent)"""
    )
    products = [float(text.split("=")[1]) for text in numbers if "=" in text]
    score = float(numbers[-1])
    results.check("why: the shown parts are consistent with the shown score",
                  len(products) == 3 and score > 0, f"{numbers}")
    page.click('#result-1 [data-action="why"]')
    results.check("why: panel closes again", page.locator("#result-1 .panel").is_hidden())

    page.click('#result-2 [data-action="cite"]')
    citation = page.inner_text("#result-2 .citation")
    page.click('#result-2 [data-action="copy"]')
    page.wait_for_timeout(200)
    clipboard = page.evaluate("navigator.clipboard.readText()")
    results.check("cite: citation is copied to the clipboard", clipboard == citation and "http" in citation, citation[:120])
    page.click('#result-2 [data-action="cite"]')

    first_source = page.get_attribute("#ledger-list button[data-source]", "data-source")
    page.click("#ledger-list button[data-source]")
    page.wait_for_timeout(120)
    shown_sources = set(page.evaluate("[...document.querySelectorAll('#results > li')].map((node) => node.dataset.source)"))
    results.check("ledger: clicking a source shows only that source", shown_sources == {first_source}, str(shown_sources))
    page.click('[data-action="clear-filter"]')
    page.wait_for_timeout(120)
    shown_sources = set(page.evaluate("[...document.querySelectorAll('#results > li')].map((node) => node.dataset.source)"))
    results.check("ledger: show all sources restores the list", len(shown_sources) > 1)

    more = page.locator("#more-button")
    if more.is_visible():
        before = page.locator("#results > li").count()
        more.click()
        after = page.locator("#results > li").count()
        results.check("more: the button adds results", after > before, f"{before} -> {after}")

    page.click("#before-ai")
    session.wait_done()
    results.check("before AI: address records the filter", "before_ai=1" in page.url, page.url)
    dates = page.evaluate(
        """() => [...document.querySelectorAll("#results .kicker span:last-child")].map((node) => node.textContent)"""
    )
    late = [text for text in dates if re.search(r"\b(202[3-9])\b", text) and "archived copy" not in text]
    results.check("before AI: nothing dated after November 2022 is listed", len(dates) > 0 and not late, f"{late[:5]} of {len(dates)}")
    results.check("before AI: the notice explains the cut-off", "30 Nov 2022" in page.inner_text("#notice"))
    page.click("#before-ai")
    session.wait_done()

    page.click('.lens[data-lens="research"]')
    session.wait_done()
    results.check("lens: address records the lens", "lens=research" in page.url, page.url)
    research_sources = set(page.evaluate("[...document.querySelectorAll('#ledger-list [data-source]')].map((node) => node.dataset.source)"))
    results.check("lens: research asks papers and archives only",
                  "hackernews" not in research_sources and "openalex" in research_sources, str(research_sources))

    page.click('.lens[data-lens="official"]')
    session.wait_done()
    official_calls = {fixture_for(url) for url in session.api_calls}
    official_rows = page.locator("#ledger-list li").count()
    results.check("lens: official records itself in the address", "lens=official" in page.url, page.url)
    official_expected = {"govuk", "federalregister", "eudata", "canadadata", "ausdata", "clinicaltrials", "wikisource"}
    results.check("lens: official asks government, law, open data and trial sources",
                  official_expected <= official_calls and official_rows == 8,
                  f"{sorted(name for name in official_calls if name)}; {official_rows} ledger rows")
    page.go_back()
    page.wait_for_timeout(400)
    results.check("history: back returns to the research lens", "lens=research" in page.url, page.url)

    page.go_back()
    page.wait_for_timeout(400)
    results.check("history: back returns to the previous lens", "lens=" not in page.url, page.url)
    results.check("history: the All lens is pressed again",
                  page.get_attribute('.lens[data-lens="all"]', "aria-pressed") == "true")

    page.keyboard.press("Escape")
    page.evaluate("document.activeElement.blur()")
    page.keyboard.press("/")
    results.check("keyboard: / focuses the search box", page.evaluate("document.activeElement.id") == "q")
    page.keyboard.press("Escape")
    page.keyboard.press("j")
    page.keyboard.press("j")
    page.keyboard.press("k")
    focused = page.evaluate("document.activeElement.closest('.result')?.id || ''")
    results.check("keyboard: j and k move through results", focused == "result-1", focused)

    page.click("#home-link")
    page.wait_for_timeout(200)
    results.check("home link: returns to the start page", page.locator("#home-view").is_visible() and "#" not in page.url, page.url)
    recent = page.locator("#recent-list li").count()
    results.check("recent: the search is remembered in this browser", recent >= 1, f"{recent}")
    page.click("#clear-history")
    results.check("recent: clear removes it", page.locator("#recent").is_hidden())

    page.click("#open-settings")
    page.select_option("#set-theme", "dark")
    page.wait_for_timeout(150)
    dark = page.evaluate("getComputedStyle(document.body).backgroundColor")
    results.check("settings: dark theme applies", page.get_attribute("html", "data-theme") == "dark", dark)
    page.select_option("#set-theme", "light")
    page.wait_for_timeout(150)
    light = page.evaluate("getComputedStyle(document.body).backgroundColor")
    results.check("settings: light theme differs from dark", light != dark, f"{light} vs {dark}")
    page.click("#clear-data")
    results.check("settings: clear reports what it did", "Cleared" in page.inner_text("#settings-status"))
    page.click("#close-settings")
    results.check("settings: dialog closes", not page.evaluate("document.getElementById('settings').open"))
    page.reload()
    page.wait_for_timeout(200)
    results.check("settings: the theme survives a reload", page.get_attribute("html", "data-theme") == "light")

    page.click(".example-list a")
    session.wait_done()
    results.check("examples: a click runs the search", page.locator("#results > li").count() > 0)

    page.fill("#q", "!g mechanical keyboards")
    page.keyboard.press("Enter")
    page.wait_for_timeout(700)
    results.check("bang: !g hands the query to Google",
                  any(url.startswith("https://www.google.com/search?q=mechanical") for url in session.left_for),
                  str(session.left_for))
    results.check("functional run: no errors, CSP clean, no outside requests",
                  not session.errors and not session.outside,
                  "; ".join(session.errors[:5] + session.outside[:5]))
    session.close()

    session = Session(browser, base, allowed, 1280)
    page = session.open(f"?q={query}&lens=build")
    session.wait_done()
    results.check("old links: ?q= is rewritten to #q=", "?" not in page.url and f"#q={query}&lens=build" in page.url, page.url)
    results.check("old links: no errors", not session.errors and not session.csp(), "; ".join(session.errors[:4]))
    session.close()

    session = Session(browser, base, allowed, 1280)
    page = session.open("#q=%3Cimg+src%3Dx+onerror%3Dalert(1)%3E+binary+tree")
    session.wait_done()
    injected = page.evaluate("document.querySelectorAll('main img, main script').length")
    results.check("safety: markup in a query is shown as text", injected == 0 and not session.errors, f"{injected}")
    session.close()

    session = Session(browser, base, allowed, 1280, mode="dead")
    page = session.open(f"#q={query}")
    session.wait_done(timeout=30000)
    results.check("sources down: the page says so and offers a retry",
                  "None of the sources answered" in page.inner_text("#empty")
                  and page.locator('[data-action="retry"]').is_visible())
    results.check("sources down: other engines are still offered", page.locator("#elsewhere-list a").count() >= 6)
    session.close()

    session = Session(browser, base, allowed, 390)
    page = session.open(f"#q={query}")
    session.wait_done()
    toggle = page.locator("#ledger-toggle")
    results.check("phone ledger: starts as one line with the count",
                  toggle.is_visible() and page.locator("#ledger-list").is_hidden()
                  and re.search(r"\d+ of \d+ answered", toggle.inner_text()) is not None,
                  toggle.inner_text())
    open_ledger(page)
    visible_rows = page.locator("#ledger-list li:visible").count()
    results.check("phone ledger: the toggle opens every source",
                  visible_rows >= 10 and toggle.get_attribute("aria-expanded") == "true", f"{visible_rows} rows")
    page.click("#ledger-list button[data-source]")
    page.wait_for_timeout(120)
    phone_sources = set(page.evaluate("[...document.querySelectorAll('#results > li')].map((node) => node.dataset.source)"))
    results.check("phone ledger: stays open and filters after a tap",
                  len(phone_sources) == 1 and page.locator("#ledger-list").is_visible(), str(phone_sources))
    session.close()

    for width in (320, 390):
        session = Session(browser, base, allowed, width)
        page = session.open(f"#q={query}")
        session.wait_done()
        boxes = page.evaluate(
            """() => [...document.querySelectorAll(".lens, .switch")].map((node) => {
              const box = node.getBoundingClientRect();
              return { left: box.left, right: box.right, top: Math.round(box.top), height: box.height };
            })"""
        )
        rows = sorted({box["top"] for box in boxes})
        inside = all(box["left"] >= 0 and box["right"] <= width + 0.5 and box["height"] >= 43.5 for box in boxes)
        results.check(f"phone controls {width}: six lenses and the switch fit in at most two rows",
                      len(boxes) == 7 and inside and len(rows) <= 2, f"{len(boxes)} controls, rows at {rows}")
        session.close()

    session = Session(browser, base, allowed, 1280)
    page = session.open(f"#q={query}")
    session.wait_done()
    fresh_count = page.locator("#results > li.result").count()
    aged = page.evaluate(
        """() => {
          const key = "telisik.cache.v1";
          const saved = JSON.parse(localStorage.getItem(key) || "{}");
          for (const entry of Object.values(saved)) {
            entry.t -= 2 * 24 * 60 * 60 * 1000;
          }
          localStorage.setItem(key, JSON.stringify(saved));
          return Object.keys(saved).length;
        }"""
    )
    session.mode = "dead"
    page.reload()
    session.wait_done(timeout=30000)
    saved_labels = page.locator("#ledger-list .ledger-saved").count()
    saved_count = page.locator("#results > li.result").count()
    summary_text = page.inner_text("#summary")
    results.check("saved copy: answers survive when every source is down",
                  aged >= 10 and saved_count == fresh_count and saved_count >= 10,
                  f"{aged} saved answers, {saved_count} results against {fresh_count} fresh")
    results.check("saved copy: the ledger and the summary say the answers are saved copies",
                  saved_labels >= 10 and "saved copy" in summary_text,
                  f"{saved_labels} labels; {summary_text}")
    session.close()

    session = Session(browser, base, allowed, 1280)
    page = session.open(f"#q={query}")
    session.wait_done()
    results.check("desktop ledger: always open, no toggle",
                  page.locator("#ledger-toggle").is_hidden() and page.locator("#ledger-list").is_visible())
    session.close()

    for name, needle in [("opensearch.xml", "#q={searchTerms}"), ("manifest.webmanifest", '"name"'), ("sw.js", "fetch")]:
        session = Session(browser, base, allowed, 1280)
        response = session.page.request.get(base + name)
        results.check(f"static: {name} is served", response.status == 200 and needle in response.text(), str(response.status))
        session.close()


def live(results, browser, base, allowed):
    session = Session(browser, base, allowed, 1280, mode="live")
    page = session.open("#q=binary+search+tree")
    started = time.time()
    try:
        page.wait_for_function(
            """() => [...document.querySelectorAll("#ledger-list .ledger-state")].length > 0
              && ![...document.querySelectorAll("#ledger-list .ledger-state")].some((node) => node.textContent === "asking")""",
            timeout=40000,
        )
    except Exception as error:
        print(f"live: sources still pending after 40 s ({error.__class__.__name__})", flush=True)
    page.wait_for_timeout(500)
    elapsed = time.time() - started
    ledger = page.evaluate(
        """() => [...document.querySelectorAll("#ledger-list li")].map((node) => node.textContent.replace(/\\s+/g, " "))"""
    )
    answered = [row for row in ledger if re.search(r"\d+$", row)]
    count = page.locator("#results > li.result").count()
    print(f"live: {count} results in {elapsed:.1f} s; ledger: {ledger}", flush=True)
    print(f"live: summary: {page.inner_text('#summary')}", flush=True)
    results.check("live: at least five real sources answered", len(answered) >= 5, str(ledger))
    results.check("live: real results render", count >= 10, f"{count}")
    results.check("live: no CSP violation and no outside request", not session.csp() and not session.outside,
                  "; ".join(session.csp()[:4] + session.outside[:4]))
    return session


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--shots", default="")
    parser.add_argument("--base", default="")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--only", default="", help="visual, functional or live")
    args = parser.parse_args()

    base = args.base or serve_folder()
    if not base.endswith("/"):
        base += "/"
    allowed = declared_hosts()
    shots = Path(args.shots).resolve() if args.shots else None
    results = Results()
    print(f"base {base}", flush=True)

    with sync_playwright() as playwright:
        launch_args = []
        if PROXY:
            launch_args = [f"--proxy-server={PROXY}", "--proxy-bypass-list=127.0.0.1;localhost"]
        try:
            browser = playwright.chromium.launch(args=launch_args)
        except Exception as launch_error:
            # A Playwright upgrade can leave its bundled Chromium missing; fall back to installed Chrome.
            print(f"bundled Chromium unavailable ({str(launch_error).splitlines()[0]}); using system Chrome", flush=True)
            browser = playwright.chromium.launch(channel="chrome", args=launch_args)
        if args.only in ("", "functional"):
            functional(results, browser, base, allowed)
        if args.only in ("", "visual"):
            visual_matrix(results, browser, base, allowed, shots)
        if args.live or args.only == "live":
            session = live(results, browser, base, allowed)
            shot(session, shots, "live-1280")

        total = len(results.rows)
        failed = results.failed
        print(f"\n{total - len(failed)}/{total} checks passed", flush=True)
        for name, _, detail in failed:
            print(f"FAILED: {name}\n   {detail}", flush=True)
        sys.stdout.flush()
        os._exit(1 if failed else 0)


if __name__ == "__main__":
    main()
