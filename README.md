# Telisik

Search the sources. Nothing generated, nothing sponsored.

**Live:** https://juw12.github.io/telisik/ · **How it works:** https://juw12.github.io/telisik/about.html

Telisik (Indonesian for "to look into closely") is a search page for questions where the source matters. One query goes
from your browser to up to 23 public libraries of human-written material at the same time. The results are
pooled, ranked with a formula printed on the page, and shown with the exact passage, the date and the
reason each one sits where it does. Telisik never writes a sentence of its own.

## Get it on your device

- **Windows:** [`Telisik-Windows-Setup.exe`](https://github.com/juw12/telisik/releases/download/desktop/Telisik-Windows-Setup.exe) (no admin needed; if Windows says it protected your PC, choose *More info → Run anyway*), or without installing [`Telisik-Windows-Portable.zip`](https://github.com/juw12/telisik/releases/download/desktop/Telisik-Windows-Portable.zip).
- **Mac:** [`Telisik-macOS-AppleSilicon.dmg`](https://github.com/juw12/telisik/releases/download/desktop/Telisik-macOS-AppleSilicon.dmg) (M1 and newer) or [`Telisik-macOS-Intel.dmg`](https://github.com/juw12/telisik/releases/download/desktop/Telisik-macOS-Intel.dmg). The first time, macOS blocks it because it is not notarized: **System Settings → Privacy & Security → Open Anyway**.
- **Android:** [`Telisik-android.apk`](https://github.com/juw12/telisik/releases/download/android/Telisik-android.apk): open the file on the phone and allow your browser to install apps once.
- **iPhone:** open https://juw12.github.io/telisik/ in Safari, tap Share, then **Add to Home Screen**.

The Windows, Mac and Android apps are the web app in its own window ([`desktop/`](desktop/README.md), [`android/`](android/README.md)) and change with it. Each build is opened on GitHub's machines before it is published: on Windows and on a Mac the page loads, the app starts and can store data; on an Android emulator it installs, opens and stays up. They are not code-signed or notarised, and no real phone or PC has run them yet.

## Why it exists

Two things have made looking something up harder.

- Web results are crowded with pages written to rank and to sell. A study of 7,392 product-review
  queries found higher-ranked pages were on average more optimised, more monetised with affiliate
  links, and showed signs of lower text quality
  ([Bevendorff et al., ECIR 2024](https://doi.org/10.1007/978-3-031-56063-7_4)).
- Answer engines write confident text whose sources often do not check out. The Tow Center tested
  eight of them on 1,600 queries about news articles and more than 60 percent of the answers were wrong
  ([Columbia Journalism Review, March 2025](https://www.cjr.org/tow_center/we-compared-eight-ai-search-engines-theyre-all-bad-at-citing-news.php)).

Telisik takes the opposite position on both: it only asks places with no shop window to optimise for,
and it prints only what a source wrote.

## What you get

| | |
|---|---|
| 23 sources, one query | Ten every time: Wikipedia, Stack Exchange, Hacker News, GitHub (GitLab as fallback), OpenAlex (Crossref as fallback), Europe PMC, Internet Archive, Open Library, the Mwmbl web index, Wikibooks. Thirteen more when the query or lens calls for them: Wiktionary, Wikinews, Wikiquote, Wikivoyage, Wikisource, Zenodo, ClinicalTrials.gov, GOV.UK, the Federal Register, the open-data catalogues of the European Union, Canada and Australia, and full-text search inside scanned books |
| In the sources' own words | Up to three sentences copied character for character from the top results, each numbered to the result it came from |
| Why ranked | Every result says in one line why it is there and opens the arithmetic behind its position: text match, evidence the source reports, the source's own order |
| Before AI | One switch limits results to items dated up to 30 November 2022. It is a date filter, not a detector |
| Lenses | All, Learn, Research, Build, Discuss, Official choose and re-weight the sources for the job |
| Saved copies | If a source fails or runs out of quota, the last answer this browser got for the same search is shown, labelled with its age |
| Did you mean | Wikipedia's spelling suggestion is passed on when it differs from what was typed |
| Report this search | A link under the results opens a prefilled GitHub issue; nothing is sent unless you submit it |
| Cite | A ready citation for any result, one press to copy |
| Operators | `"exact phrase"`, `-word`, `in:papers`, `in:gov`, `in:dict`, `se:physics`, `before:2020`, `after:2019-06` |
| Bangs | `!g`, `!ddg`, `!maps`, `!yt` and others hand the query to another engine, so it can be your default search |
| Private by construction | No server, no account, no cookies, no analytics, and no key needed. The query stays behind the `#` in the address |
| In the browser | An install button where the browser offers one, address-bar search (the page declares itself with OpenSearch), and a place in the Android share sheet once installed. Tested in Chromium and Firefox |
| Browser extension | Optional, in `extension/`. Puts Telisik on the new tab page, behind the address-bar keyword `tk`, in the right-click menu for selected text and on a toolbar button (Alt+Shift+K). It asks for one permission, the right-click menu, and no access to any site |
| Your own Stack Exchange key | Optional field in Settings. A key raises that source's daily quota; it stays in this browser and goes only to Stack Exchange |
| Works offline as a shell | The page opens with no connection and says which sources did not answer |

## What it cannot do

- It is a web page, not a browser. It runs inside Chrome, Edge, Firefox or Safari and cannot replace
  them. The extension changes where a search starts (new tab, address bar, right-click, toolbar). It
  does not change how the browser loads or draws pages, and it is not faster or safer than the browser
  it sits in.
- It is not a crawl of the whole web. The Mwmbl index adds some ordinary web pages, but it is small.
  Shops, news sites, company pages and forums outside the sources are mostly not in it. Use a bang.
- It is not a news wire. News comes from Wikinews and the links posted to Hacker News only.
- The government sources cover a few places. Guidance and rules come from GOV.UK and the United
  States Federal Register only. Open data comes from the European Union, Canada and Australia. Other
  countries' records are not searched.
- It matches words, not meaning. There is no language model anywhere in it, so a plain description
  that shares few words with the right page can miss. Wikipedia's own search does better on those.
- It sees titles and short excerpts, not full pages.
- Word matching is weak for languages written without spaces.
- The sources set quotas per IP address (Stack Exchange about 300 requests a day, GitHub about 10
  searches a minute without an account). On a shared network they can run out. A saved copy of the same
  search is reused, GitLab stands in for GitHub, and the others still answer, but a new search on an
  exhausted source gets nothing from it until the quota resets. A short search, or one that mentions
  code, can send GitHub a second request and use its quota twice as fast.
- Votes, stars and citations show attention, not truth.

## Measured

`tools/eval.mjs` asks questions that each have one known right answer (a named Wikipedia article, a
repository, a paper, a book, a government page) and reports where that answer lands. The answers the
sources gave on 14 and 16 November 2026 are saved in `tests/eval/`, so every number below can be
reproduced without touching the network. MRR is the mean of 1 / position of the right answer.

There are three sets. Only the third was scored before anything was adjusted against it, and it is
the lowest.

### The set the formula was fitted to (72 questions)

| | In the pool | First | Top 3 | Top 10 | MRR |
|---|---|---|---|---|---|
| Two rounds ago | 90% | 74% | 78% | 88% | 0.777 |
| Last round | 93% | 79% | 86% | 92% | 0.836 |
| Now | 93% | 78% | 85% | 92% | 0.824 |

These figures flatter the formula: its numbers were chosen on this set. The latest changes cost it one
first place ("treaty of westphalia" fell from first to fifth), which was accepted because they helped
the second set more. "theory of plate tectonics", first before the in-order bonus was added, is now
ninth.

### A second set written afterwards (64 questions)

31 name a thing ("django web framework"), 33 are plain descriptions ("ship that sank after hitting an
iceberg in 1912"). A hash of each question decides its half. One half was used for changes from the
start. The other was run once on 14 November 2026 and has been used for changes since, so neither half
is unseen any more.

| | Queries | In the pool | First | Top 3 | Top 10 | MRR |
|---|---|---|---|---|---|---|
| Whole set, last round | 64 | | 56% | 67% | 78% | 0.639 |
| Whole set, now | 64 | 91% | 64% | 73% | 81% | 0.697 |
| First half, now | 32 | 88% | 56% | 66% | 75% | 0.623 |
| Second half, when it was run once | 32 | 94% | 63% | 81% | 88% | 0.724 |
| Second half, now | 32 | 94% | 72% | 81% | 88% | 0.771 |
| Second half, named things, now | 20 | 90% | 75% | 85% | 85% | 0.786 |
| Second half, plain descriptions, now | 12 | 100% | 67% | 75% | 92% | 0.746 |

The second half scores higher than the first because of its mix: it has 12 plain descriptions out of
32 and the first half has 21.

### A third set, scored once (50 questions)

Written on 16 November 2026 after the last change to the formula: 33 plain descriptions and 17 named
things. `tests/eval/pools3-first.json` holds what the sources answered the first time. GitHub refused
3 of those requests and failed 1, so `tests/eval/pools3.json` holds the same questions asked again
later that day with every source answering.

| | Queries | In the pool | First | Top 3 | Top 10 | MRR |
|---|---|---|---|---|---|---|
| As first scored | 50 | 86% | 50% | 62% | 72% | 0.586 |
| Asked again, every source answering | 50 | 90% | 52% | 66% | 76% | 0.616 |

```
node tools/eval.mjs --queries=queries3.json --pools=pools3-first.json
node tools/eval.mjs --queries=queries3.json --pools=pools3.json --misses
```

Two changes to the formula were tried after that and dropped. The larger one scored 17 settings over
all 186 questions: the right answer was first for between 114 and 124 of them against 122 as shipped,
and the best MRR was 0.730 against 0.716. Nothing in `js/rank.js` changed.

### Against each source alone

`tools/compare.mjs` scores the same saved answers as each source returned them, in the source's own
order. Third set as first scored, first ten results only:

| Asked of | Queries | First | Top 3 | Top 10 | MRR |
|---|---|---|---|---|---|
| Telisik, all sources | 50 | 50% | 62% | 72% | 0.579 |
| Wikipedia search alone | 50 | 36% | 56% | 64% | 0.468 |
| Mwmbl web index alone | 50 | 14% | 22% | 24% | 0.174 |
| Hacker News search alone | 50 | 6% | 10% | 10% | 0.073 |
| GitHub search alone | 50 | 0% | 0% | 0% | 0.000 |

Where Telisik loses: on plain descriptions Wikipedia's own search is better. Mixing in other sources
pushes some right articles down.

| Plain descriptions | Queries | First | Top 3 | Top 10 | MRR |
|---|---|---|---|---|---|
| Telisik | 33 | 42% | 52% | 67% | 0.498 |
| Wikipedia alone | 33 | 42% | 70% | 82% | 0.573 |

Where it wins: named things.

| Named things | Queries | First | Top 3 | Top 10 | MRR |
|---|---|---|---|---|---|
| Telisik | 17 | 65% | 82% | 82% | 0.735 |
| Mwmbl alone, the best single source | 17 | 35% | 53% | 59% | 0.433 |
| Telisik, asked again | 17 | 71% | 94% | 94% | 0.824 |

Asked again with every source answering, the whole-set row reads 52%, 66%, 76% and 0.609, GitHub alone
4% throughout, and the plain-description rows do not move.

```
node tools/compare.mjs --queries=queries3.json --pools=pools3-first.json
```

Read all of it with these limits in mind:

- All three sets and their right answers were written by an AI assistant, one answer per question,
  and 50 questions is a small sample.
- Every right answer is a page inside one of the libraries Telisik searches, mostly Wikipedia. The
  comparison therefore leans Telisik's way.
- Google, Bing, ChatGPT and Perplexity are not in the table because their terms forbid automated
  queries. Marginalia (502), Stract (404) and the DuckDuckGo instant-answer interface (timeout) were
  tried again on 16 November 2026 and did not answer from the network this ran on. GDELT, a news
  index, refused the request the same day (429) and was not added as a source.
- Saved pools are incomplete. First set: 23 of 72 are missing a source (Stack Exchange at its daily
  limit in 14, GitHub at its per-minute limit in 11). Second set: Stack Exchange did not answer for
  any of the 64, GitHub refused 11 and Europe PMC timed out once. Third set as first scored: GitHub
  refused 3 and failed 1.
- Descriptions that share few words with the right page still miss: "how do airplanes stay in the
  air" (Lift), "general rise in prices over time" (Inflation), "building blocks of proteins" (Amino
  acid), "tallest mountain on earth", "largest planet in the solar system", "the smallest unit of
  life". In the third set "the planet closest to the sun" has Mercury at 32 and "deepest part of the
  ocean" has the Mariana Trench at 12, although each is the first result of Wikipedia's own search.
  That needs matching on meaning, which Telisik does not have.
- Four labels are strict: for "kubernetes container orchestration", "django web framework", "numpy
  array library" and "curl command line tool source" only the GitHub repository counts as right, and
  Telisik either ranks other pages above it or does not have it.
- GitHub's search does not return the canonical repository for some plain descriptions ("rust
  programming language compiler", "redis source code"), so those miss whatever the formula does.
- Scoring the third set turned up a fault: when GitHub's second request failed, the page kept the
  first answer and said nothing, and the evaluation counted the pool as complete. The list of sources
  now says "showing its first answer only", and the evaluation counts such a pool as incomplete.
- An earlier run found another: addresses were compared without their query string, so every Hacker
  News thread (`item?id=...`) counted as the same page and only one survived. Fixed, with a test.

## Run it

No build step and no dependencies. Any static file server works.

```
git clone https://github.com/juw12/telisik
cd telisik
python -m http.server 8080
```

Then open http://localhost:8080/.

## Browser extension

The folder `extension/` is a small extension for Chrome, Edge and Firefox. It takes over the four
places where the browser decides where a search goes:

| Place | What happens |
|---|---|
| New tab | A Telisik search box. The page is stored inside the extension and asks nothing from the network until you search |
| Address bar | Type `tk`, a space, then the search. Enter opens it in the tab in front, Alt+Enter in a new one |
| Right-click | Select text on any page, right-click, "Search Telisik for ...". The results open in the tab next to it |
| Toolbar button | A small search box. Alt+Shift+K opens it |

It asks for one permission, `contextMenus`, and no access to any site: it cannot read the pages you
visit. It has no remote code, and its own pages may not make a network request at all: their content
security policy starts from `default-src 'none'` and allows only the extension's own scripts, styles
and images. All it ever does is open `https://juw12.github.io/telisik/#q=...`.

It is not in the Chrome Web Store or on addons.mozilla.org. Both need the owner's own developer
account (Chrome's has a one-time fee), and neither has been set up. Until then it is loaded by hand:

- **Chrome, Edge:** open `chrome://extensions` (Edge: `edge://extensions`), switch on Developer mode,
  press "Load unpacked" and choose the `extension` folder. Chrome says in its prompt that the extension
  changes the new tab page; that is the new tab override and it is listed next to `contextMenus`.
- **Firefox:** run `python tools/pack_extension.py`, open `about:debugging#/runtime/this-firefox`,
  press "Load Temporary Add-on" and choose `dist/telisik-firefox/manifest.json`. Firefox removes a
  temporary add-on when it closes. Staying installed needs a copy signed by Mozilla.

`python tools/pack_extension.py` also writes `dist/telisik-chrome.zip` and `dist/telisik-firefox.zip`,
the forms the two stores take. `dist/` is not in git.

What the browser itself adds, measured with real keys and a real mouse in Chrome 157, Edge 157,
Playwright's Firefox 150 and the Firefox 160 that Mozilla releases:

- **New tab.** After Ctrl+T the cursor is in the browser's address bar, not in the page's search box,
  in all four. The browser decides that and the extension does not fight it. Click in the box, or
  type `tk` and a space.
- **One question, once.** The first new tab asks whether to keep the new page: "Keep it" in Chrome,
  "Keep changes" in Edge, "Keep Changes" in Firefox. The test only ever chose to keep it.
- **Edge** sometimes shows "Turn off extensions in developer mode" for an extension loaded by hand
  (seen in 1 of 3 runs).
- **Right-click.** Firefox keeps its own "Search Google for ..." entry next to the Telisik one.
- **Firefox toolbar.** The button is not pinned by default. It sits in the Extensions menu as
  "Search Telisik".
- **Firefox bubble.** After Alt+Shift+K or a click on the button the bubble opens. In Playwright's
  Firefox 150 typing did not reach its box until one real click in it, in every run. In release
  Firefox 160 typing reached the box without a click, in both runs made there. Mozilla's bug tracker
  has reports that appear to describe the older behaviour (1512917, 1918031); that they are the cause,
  or that a fix landed between the two versions, is not confirmed. The bubble still says in Firefox:
  "In Firefox, click in the box first if typing does nothing." In Chrome and Edge the bubble takes
  typing right away.

### What it asks for, next to the search engines' own add-ons

`tools/compare_permissions.py` downloads the public package of each add-on that a search engine
publishes under its own name on addons.mozilla.org and reads the `manifest.json` inside. Nothing is
installed. On 16 November 2026 it looked for 28 engine names and found 18 add-ons from 13
publishers. No add-on from the engine itself turned up for Google, Yahoo, Perplexity, ChatGPT / OpenAI, You.com, Mojeek, Phind, SearXNG, Mullvad Leta, Presearch, Naver, Baidu.
The answers are saved in `founder/addon-permissions.json` with the SHA-256 of every package read.

| Add-on | From | Daily users | Browser permissions | Websites it can read or change | What it does |
| --- | --- | ---: | ---: | --- | --- |
| **Telisik** (not in the store) | juw12 |  | 1 | none | new tab page, toolbar button, address bar keyword, right click entry |
| Brave search - Private Search Engine | Brave Software | 16,365 | 0 | none | default search engine |
| Swisscows | Swisscows AG | 8,966 | 0 | none | default search engine |
| Seznam Doplněk – Vyhledávač | Seznam.cz, a.s. | 542 | 3 | none | default search engine, toolbar button |
| Qwant - Search engine | Qwant | 97,677 | 0 | 1 | default search engine, address bar keyword, scripts inside web pages |
| Ecosia — The search engine that plants trees 🌱 | Ecosia Dev Team | 238,602 | 2 | 1 | default search engine, toolbar button, right click entry, scripts inside web pages |
| Microsoft Bing Homepage and Search Engine | Microsoft Corporation | 723 | 2 | 1 | default search engine, home page, toolbar button |
| Startpage | Startpage | 205,028 | 4 | 1 | default search engine, toolbar button, scripts inside web pages |
| Kagi Search for Firefox | Kagi Inc. | 27,120 | 5 | 1 | default search engine, toolbar button, right click entry |
| Microsoft Bing Search Engine | Microsoft Corporation | 3,306 | 5 | 1 | default search engine, toolbar button |
| Lilo - Search engine | Lilo | 43,366 | 0 | 2 | default search engine, address bar keyword, scripts inside web pages |
| KARMA Search | KARMA Search, Yann | 249 | 2 | 2 | default search engine, new tab page, toolbar button, scripts inside web pages |
| DuckDuckGo No-AI Search | DuckDuckGo | 42,614 | 4 | 2 | default search engine, scripts inside web pages |
| Qwant - Search engine & tracker blocker | Qwant | 67,242 | 5 | 2 | default search engine, toolbar button, scripts inside web pages |
| MetaGer Search | SUMA-EV / MetaGer | 5,932 | 6 | 14 | default search engine, toolbar button, scripts inside web pages |
| Yandex — Homepage | Yandex | 16,891 | 3 | every site | home page, toolbar button |
| DuckDuckGo Search & Tracker Protection | DuckDuckGo | 1,101,603 | 8 | every site | default search engine, toolbar button, address bar keyword, right click entry, scripts inside web pages |
| Yandex.Bar | Yandex | 21,537 | 12 | every site | toolbar button, right click entry, scripts inside web pages |
| Startpage Privacy Protection | Startpage | 30,827 | 8 | every site | default search engine, toolbar button, scripts inside web pages |

Ordered by what you have to trust: access to every website first, then the number of website
patterns, then the number of browser permissions.

- Of the 18, 16 ask for more than Telisik, none for the same and 2 for less.
- The 2 that ask for less are Brave Search and Swisscows, with no permission at all. Each only sets
  the browser's default search engine. Neither adds a new tab page, a toolbar button, an address-bar
  keyword or a right-click entry.
- 15 of the 18 add at least one of those four places. Every one of them asks for more than Telisik.
- None of the 18 does all four. One, KARMA Search, replaces the new tab page.
- 15 can read or change at least one website, 4 of them every website, and 11 run scripts inside web
  pages. Telisik: no website, no script inside a page.
- None of the 18 bars its own pages from the network with its content security policy. Telisik's does.

That is the one comparison in this file where Telisik comes first against the engines people use:
among the add-ons that put search somewhere new in the browser, it is the one that asks for least.
Read it with these limits:

- One store on one day. The Chrome Web Store was not read.
- A permission is what an add-on may do, not what it does. Several of the larger ones use theirs to
  block trackers, which Telisik's does not do at all.
- It says nothing about which engine finds better results. For that see "Measured" above.
- Telisik's add-on is not in any store, so nobody outside this repository has reviewed it.

```
python tools/compare_permissions.py --saved    # the table and the counts from the saved data
python tools/compare_permissions.py            # read the store again
```

## Check it

```
node --test tests/                 # 160 unit tests: parser, adapters, ranking, text, promises, extension
node tools/eval.mjs --misses       # ranking quality on the saved answers, with every miss listed
python tools/e2e.py                # real Chromium, API answers from tests/fixtures
python tools/e2e.py --only functional --browser firefox   # the same behaviour checks in Firefox
python tools/e2e.py --only live    # one search against the real sources
python tools/e2e.py --base https://juw12.github.io/telisik/ --only live
python tools/extension_e2e.py --browser chromium   # the extension, loaded into a real browser
python tools/extension_e2e.py --browser chrome
python tools/extension_e2e.py --browser edge
python tools/extension_e2e.py --browser firefox --firefox-binary PATH
python tools/extension_real_input.py --browser chrome    # real keys and mouse, Windows only; also edge, firefox
python tools/extension_real_input.py --browser chrome --live   # the same against the live site and real sources
python tools/compare_permissions.py --saved    # the add-on next to the search engines' own add-ons
```

The browser run needs Python with Playwright (`pip install playwright`, `playwright install chromium
firefox`).
It fails on any console error, any request outside the declared sources, horizontal overflow at 320,
390, 768, 1024 or 1440 px, text contrast below WCAG AA, tap targets under 44 px on phones and text
under 12 px, in light and dark.

The extension run installs the extension into a fresh browser profile and checks what the browser
itself reports: that it is enabled with no manifest warning, which permissions it holds, that a new tab
opens its page, that the page loads nothing from outside the extension, and that a search typed there
arrives on the site. On 16 November 2026 it passed 28 of 28 checks in Playwright's Chromium 148, in
Chrome 157 and in Edge 157, and 25 of 25 in Playwright's Firefox 150 and in Firefox 160.0 as Mozilla
releases it. On a busy computer the first tries failed four times on waits that were too short. The
waits were lengthened, nothing else. Release Firefox refuses remote control of its own interface
unless `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` is set, so the run sets it for the test browser only.

That run cannot press keys in the browser's own address bar, open its right-click menu or press
Alt+Shift+K, so it checks those one step in: the browser has the keyword, the menu entry and the
shortcut registered, and the code they run opens the right tab.

`tools/extension_real_input.py` covers the rest with the keyboard and mouse of the whole computer:
Ctrl+T, `tk` typed in the real address bar, the real right-click menu, Alt+Shift+K and the real
toolbar button. It takes about half a minute of input in Chrome and Edge and about a minute in
Firefox. It starts only after 6 seconds without a key or mouse move, uses its own browser window on a
throwaway profile, checks before every key and click that this window has the keyboard, stops
sending if you take it back, and puts the pointer and your window back at the end. Without `--live`
the test browser gets a proxy that does not exist, so nothing reaches the network. On 16 November
2026 the last runs that way gave:

| Browser | Real-input checks passed |
|---|---|
| Chrome 157.0.8103.78 | 25 of 25 |
| Edge 157.0.4341.46 | 25 of 25 |
| Firefox 150.0.2, the build Playwright ships | 24 of 26 |
| Firefox 160.0, as Mozilla releases it | 26 of 26 |

The two Firefox 150 misses are the bubble not taking typing before a click (above). The two checks
"after one real click it works" pass. In Firefox the test cannot answer the site from the folder, so
without `--live` it checks the address each search opens, not the page behind it.

With `--live` the same keys and clicks end on the real site, https://juw12.github.io/telisik/, which
then asks the real sources. The test browser is put behind a small gate on this computer that lets
through only the site and the hosts its content security policy lists, and answers 403 to everything
else (`--proxy URL` if the gate itself needs one to get out). Each run makes two or three small
searches. Every run of 16 November 2026 is listed, not only the ones that passed:

| Browser | Last live run | Earlier live runs that day |
|---|---|---|
| Chrome 157.0.8103.78 | 29 of 29 | 29 of 29; stopped at 24 of 27; 25 of 27 |
| Edge 157.0.4341.46 | 27 of 27 | stopped before any input; 28 of 29; 28 of 29 |
| Firefox 150.0.2, the build Playwright ships | 30 of 32 | none |
| Firefox 160.0, as Mozilla releases it | 32 of 32 | none |

What went wrong in the runs that did not pass, none of it in the extension:

- **Chrome, stopped at 24 of 27.** Another program's window came to the front after Alt+Shift+K. The
  test held back its next four inputs and stopped, as it is built to. Nothing was typed elsewhere.
- **Chrome, 25 of 27.** After Ctrl+T the test read the new tab as `chrome://newtab/` and failed that
  check and the one that depends on it. A screenshot taken 0.8 seconds later shows the Telisik page
  in that tab. The read was wrong, why is not known, and it happened once in four runs. The test now
  asks the page in the tab for its own address before it fails. The run after that change did not
  need the second read.
- **Edge, stopped before any input.** The site took longer than the 8 seconds the test allowed. The
  limit was raised.
- **Edge, 28 of 29, twice.** Once the test typed before the bubble had the keyboard, so the test
  now waits for it. Once the results page was still empty after 20 seconds; a screenshot 13 seconds
  later shows the query and 20 results.
- **Firefox 150, 30 of 32.** The same two bubble checks as without `--live`.
- Edge's last run has two checks fewer because Edge did not ask its "Keep changes" question that time.

Eight of those runs kept their log (the first two Edge runs were overwritten), which is 16 live
searches. 13 of them came back in 0.9 to 1.9 seconds. The other three: one Edge search took 13.2
seconds, and Firefox 160 took 3.4 and 17.2 seconds. 13 searches listed 20 results, one listed 19,
and two listed only 6, both for "Krebs cycle steps" (Edge's last run and Firefox 160). Why those
two came back short was not looked into; the same question listed 19 or 20 in the other six runs.
All of it went through a company proxy, so these are not speed measurements of Telisik.

The gate also shows what each browser tried to reach by itself while the test ran, all refused:
Chrome five Google hosts in every run (among them `accounts.google.com` and `www.google.com`), Edge
four Microsoft hosts in one run and nine in the next (among them `www.bing.com`, `edge.microsoft.com`
and `graph.microsoft.com`), Firefox 160 `firefox.settings.services.mozilla.com`, Playwright's Firefox
150 nothing. The gate sees hosts, not who asked, so it cannot say which request came from the
extension. That the extension's own pages cannot reach the network is checked in the extension run
above, not here.

Still not tested:

- An extension installed from a store. That needs the owner's developer accounts (above).
- Mozilla's `web-ext lint`. The network this was built on refuses npm's registry, and it was not
  fetched another way. Firefox 150 and 160 themselves report no warning and no error for the manifest,
  which the extension run checks. To run the linter: `npx web-ext lint --source-dir dist/telisik-firefox`.
- Any computer other than one Windows machine. The real-input test is Windows only.

`tests/hygiene.test.js` holds the page to its own words: no remote scripts or fonts, no inline script,
a content security policy that lists exactly the source hosts, and ranking code that cannot read the
money settings.

## Layout

| Path | What it holds |
|---|---|
| `index.html`, `about.html` | The search page and the page that explains it |
| `js/query.js` | Query parser: phrases, exclusions, operators, bangs |
| `js/sources.js` | The 23 source adapters, the two fallbacks and the lens weights |
| `js/engine.js` | The only file that makes network requests; timeouts, cache, saved copies, back-off |
| `js/rank.js` | The whole ranking formula |
| `js/text.js`, `js/cite.js` | Stemming, highlighting, verbatim passages, citations |
| `js/app.js`, `js/theme.js` | The interface |
| `js/config.js` | The two optional money links and the optional Stack Apps key |
| `sw.js` | Offline shell, network first |
| `design.md` | Why it looks the way it does |
| `tools/eval.mjs`, `tests/eval/` | The ranking check: three question sets (`queries.json`, `queries2.json`, `queries3.json`), the saved answers (`pools.json`, `pools2.json`, `pools3-first.json`, `pools3.json`), the tuning search |
| `tools/compare.mjs`, `tests/eval/wiby.json` | The same questions asked of each source alone and of the Wiby index |
| `extension/` | The browser extension: `manifest.json`, `url.js` (builds the search address), `background.js` (address-bar keyword, right-click entry), `page.js`, `newtab.html`, `popup.html`, `page.css`, `icons/` |
| `tools/pack_extension.py` | Writes `dist/`: the Chrome zip and the Firefox folder and zip with Firefox's manifest |
| `tools/extension_e2e.py` | Loads the extension into Chromium, Chrome, Edge or Firefox and checks it there |
| `tools/extension_real_input.py` | Drives the extension with the real keyboard and mouse, closed off from the network or, with `--live`, against the live site behind a gate |
| `tools/compare_permissions.py`, `founder/addon-permissions.json` | Reads what the search engines' own Firefox add-ons ask for, and the answers of 16 November 2026 |
| `founder/` | Niche, competitors and money notes |

## Money

Running Telisik costs nothing: static files, no server, no index to pay for. It is free with no account.

`js/config.js` has room for two things, both empty by default and hidden while empty:

- `support`: a link to a page where people can chip in.
- `sponsor`: one text line in the footer that always starts with the word "Sponsor".

Only `https` addresses are accepted. Neither can change the results: the ranking code does not import
that file and a test fails if it ever does. Today both are empty, so income is zero. See
`founder/money.md` for the honest version.

## Licence

MIT. See `LICENSE`. Results belong to their sources and are shown under each source's own terms.
