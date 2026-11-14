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
| Private by construction | No server, no account, no key, no cookies, no analytics. The query stays behind the `#` in the address |
| Works offline as a shell | Installable; the page opens with no connection and says which sources did not answer |

## What it cannot do

- It is not a crawl of the whole web. The Mwmbl index adds some ordinary web pages, but it is small.
  Shops, news sites, company pages and forums outside the sources are mostly not in it. Use a bang.
- It is not a news wire. The only news source is Wikinews.
- The government sources cover a few places. Guidance and rules come from GOV.UK and the United
  States Federal Register only. Open data comes from the European Union, Canada and Australia. Other
  countries' records are not searched.
- It matches words, not meaning. There is no language model anywhere in it.
- It sees titles and short excerpts, not full pages.
- Word matching is weak for languages written without spaces.
- The sources set quotas per IP address (Stack Exchange about 300 requests a day, GitHub about 10
  searches a minute without an account). On a shared network they can run out. A saved copy of the same
  search is reused, GitLab stands in for GitHub, and the others still answer, but a new search on an
  exhausted source gets nothing from it until the quota resets.
- Votes, stars and citations show attention, not truth.

## Measured

`tools/eval.mjs` asks questions that each have one known right answer (a named Wikipedia article, a
repository, a paper, a book, a government page) and reports where that answer lands. The answers the
sources gave on 14 November 2026 are saved in `tests/eval/`, so every number below can be reproduced
without touching the network. MRR is the mean of 1 / position of the right answer.

### The set the formula was fitted to (72 questions)

| | In the pool | First | Top 3 | Top 10 | MRR |
|---|---|---|---|---|---|
| Before this round | 90% | 74% | 78% | 88% | 0.777 |
| Now | 93% | 79% | 86% | 92% | 0.836 |

These figures flatter the formula: its numbers were chosen on this set and its held-back half has been
looked at more than once. One question got worse: "theory of plate tectonics" fell from first to fifth
when the in-order bonus was added.

### A second set written afterwards (64 questions)

31 name a thing ("django web framework"), 33 are plain descriptions ("ship that sank after hitting an
iceberg in 1912"). A hash of each question decides its half. Changes were made while watching one half
only; the other was run once, after the last change.

| | Queries | In the pool | First | Top 3 | Top 10 | MRR |
|---|---|---|---|---|---|---|
| Half used for changes, before | 32 | | 41% | 53% | 66% | 0.493 |
| Half used for changes, now | 32 | 75% | 50% | 53% | 69% | 0.555 |
| Half held back, run once | 32 | 94% | 63% | 81% | 88% | 0.724 |
| Held back, named things | 20 | 90% | 70% | 85% | 85% | 0.761 |
| Held back, plain descriptions | 12 | 100% | 50% | 75% | 92% | 0.662 |

The held-back half scores higher than the other because of its mix, not because of the changes: it has
12 plain descriptions out of 32 and the other half has 21.

### Against each source alone

`tools/compare.mjs` scores the same saved answers as each source returned them, in the source's own
order, and adds the live Wiby index. Held-back half of the second set, first ten results only:

| Asked of | Queries | First | Top 3 | Top 10 | MRR |
|---|---|---|---|---|---|
| Telisik, all sources | 32 | 63% | 81% | 88% | 0.720 |
| Wikipedia search alone | 32 | 47% | 53% | 59% | 0.514 |
| Hacker News search alone | 32 | 22% | 25% | 25% | 0.229 |
| Mwmbl web index alone | 32 | 9% | 16% | 25% | 0.135 |
| Wiby web index | 32 | 6% | 9% | 9% | 0.073 |
| GitHub search alone | 32 | 0% | 0% | 0% | 0.000 |

Where Telisik loses: on plain descriptions Wikipedia's own search is as good or better.

| Plain descriptions | Queries | First | Top 3 | Top 10 | MRR |
|---|---|---|---|---|---|
| Telisik, held back | 12 | 50% | 75% | 92% | 0.656 |
| Wikipedia alone, held back | 12 | 67% | 83% | 100% | 0.787 |
| Telisik, whole set | 33 | 45% | 55% | 73% | 0.538 |
| Wikipedia alone, whole set | 33 | 45% | 64% | 82% | 0.578 |

On the 31 named things in the whole set Telisik is first for 68% and the best single source for 35%.

Read all of it with these limits in mind:

- Both sets and their right answers were written by an AI assistant, one answer per question, and 32
  questions is a small sample.
- Every right answer is a page inside one of the libraries Telisik searches, mostly Wikipedia. The
  comparison therefore leans Telisik's way, and an index of small personal sites such as Wiby could
  hardly score. Its row says nothing about how good Wiby is at what it is for.
- Google, Bing, ChatGPT and Perplexity are not in the table because their terms forbid automated
  queries. Marginalia (502), Stract (404) and the DuckDuckGo instant-answer interface (timeout) did not
  answer from the network this ran on. Wiby answered 133 of 136 queries.
- Saved pools are incomplete. First set: 23 of 72 are missing a source (Stack Exchange at its daily
  limit in 14, GitHub at its per-minute limit in 11). Second set: Stack Exchange was at its limit for
  all 64, GitHub refused 11 and Europe PMC timed out once.
- Descriptions that share no word with the right page still miss: "how do airplanes stay in the air"
  (Lift), "general rise in prices over time" (Inflation), "building blocks of proteins" (Amino acid),
  "tallest mountain on earth", "largest planet in the solar system", "the smallest unit of life".
  That needs matching on meaning, which Telisik does not have.
- Four labels are strict: for "kubernetes container orchestration", "django web framework", "numpy
  array library" and "curl command line tool source" only the GitHub repository counts as right, and
  Telisik shows the Wikipedia article first.
- GitHub's search does not return the canonical repository for some plain descriptions ("rust
  programming language compiler"), so those miss whatever the formula does.
- An earlier run found a real fault: addresses were compared without their query string, so every
  Hacker News thread (`item?id=...`) counted as the same page and only one survived. Fixed, with a test.

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
node --test tests/                 # 139 unit tests: parser, adapters, ranking, text, promises
node tools/eval.mjs --misses       # ranking quality on the saved answers, with every miss listed
python tools/e2e.py                # real Chromium, API answers from tests/fixtures
python tools/e2e.py --only live    # one search against the real sources
python tools/e2e.py --base https://juw12.github.io/telisik/ --only live
```

The browser run needs Python with Playwright (`pip install playwright`, `playwright install chromium`).
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
