# Telisik

Search the sources. Nothing generated, nothing sponsored.

**Live:** https://juw12.github.io/telisik/ · **How it works:** https://juw12.github.io/telisik/about.html

Telisik (Indonesian for "to look into closely") is a search page for questions where the source matters. One query goes
from your browser to up to 23 public libraries of human-written material at the same time. The results are
pooled, ranked with a formula printed on the page, and shown with the exact passage, the date and the
reason each one sits where it does. Telisik never writes a sentence of its own.

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
| Your own Stack Exchange key | Optional field in Settings. A key raises that source's daily quota; it stays in this browser and goes only to Stack Exchange |
| Works offline as a shell | The page opens with no connection and says which sources did not answer |

## What it cannot do

- It is a web page, not a browser. It runs inside Chrome, Edge, Firefox or Safari and cannot replace
  them.
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

## Check it

```
node --test tests/                 # 145 unit tests: parser, adapters, ranking, text, promises
node tools/eval.mjs --misses       # ranking quality on the saved answers, with every miss listed
python tools/e2e.py                # real Chromium, API answers from tests/fixtures
python tools/e2e.py --only functional --browser firefox   # the same behaviour checks in Firefox
python tools/e2e.py --only live    # one search against the real sources
python tools/e2e.py --base https://juw12.github.io/telisik/ --only live
```

The browser run needs Python with Playwright (`pip install playwright`, `playwright install chromium
firefox`).
It fails on any console error, any request outside the declared sources, horizontal overflow at 320,
390, 768, 1024 or 1440 px, text contrast below WCAG AA, tap targets under 44 px on phones and text
under 12 px, in light and dark.

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
| `tools/eval.mjs`, `tests/eval/` | The ranking check: two question sets (`queries.json`, `queries2.json`), the saved answers (`pools.json`, `pools2.json`), the tuning search |
| `tools/compare.mjs`, `tests/eval/wiby.json` | The same questions asked of each source alone and of the Wiby index |
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
