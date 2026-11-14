# Sumber

Search the sources. Nothing generated, nothing sponsored.

**Live:** https://juw12.github.io/sumber/ · **How it works:** https://juw12.github.io/sumber/about.html

Sumber ("source" in Indonesian) is a search page for questions where the source matters. One query goes
from your browser to eight public libraries of human-written material at the same time. The results are
pooled, ranked with a formula printed on the page, and shown with the exact passage, the date and the
reason each one sits where it does. Sumber never writes a sentence of its own.

## Why it exists

Two things have made looking something up harder.

- Web results are crowded with pages written to rank and to sell. A study of 7,392 product-review
  queries found higher-ranked pages were on average more optimised, more monetised with affiliate
  links, and showed signs of lower text quality
  ([Bevendorff et al., ECIR 2024](https://doi.org/10.1007/978-3-031-56063-7_4)).
- Answer engines write confident text whose sources often do not check out. The Tow Center tested
  eight of them on 1,600 queries about news articles and more than 60 percent of the answers were wrong
  ([Columbia Journalism Review, March 2025](https://www.cjr.org/tow_center/ai-search-has-a-citation-problem.php)).

Sumber takes the opposite position on both: it only asks places with no shop window to optimise for,
and it prints only what a source wrote.

## What you get

| | |
|---|---|
| Eight sources, one query | Wikipedia, Stack Exchange, Hacker News, GitHub, OpenAlex (Crossref as fallback), Europe PMC, Internet Archive, Open Library |
| In the sources' own words | Up to three sentences copied character for character from the top results, each numbered to the result it came from |
| Why ranked | Every result opens the arithmetic behind its position: text match, evidence the source reports, the source's own order |
| Before AI | One switch limits results to items dated up to 30 November 2022. It is a date filter, not a detector |
| Lenses | All, Learn, Research, Build, Discuss re-weight the sources for the job |
| Cite | A ready citation for any result, one press to copy |
| Operators | `"exact phrase"`, `-word`, `in:papers`, `se:physics`, `before:2020`, `after:2019-06` |
| Bangs | `!g`, `!ddg`, `!maps`, `!yt` and others hand the query to another engine, so it can be your default search |
| Private by construction | No server, no account, no key, no cookies, no analytics. The query stays behind the `#` in the address |
| Works offline as a shell | Installable; the page opens with no connection and says which sources did not answer |

## What it cannot do

- It is not a crawl of the web. Shops, news sites, company pages and forums outside the eight sources
  are not in it. Use a bang for those.
- It matches words, not meaning. There is no language model anywhere in it.
- It sees titles and short excerpts, not full pages.
- Word matching is weak for languages written without spaces.
- The sources set quotas per IP address (Stack Exchange about 300 requests a day, GitHub about 10
  searches a minute without an account). On a shared network they can run out; the source is then
  marked and the others still answer.
- Votes, stars and citations show attention, not truth.

## Run it

No build step and no dependencies. Any static file server works.

```
git clone https://github.com/juw12/sumber
cd sumber
python -m http.server 8080
```

Then open http://localhost:8080/.

## Check it

```
node --test tests/                 # 69 unit tests: parser, adapters, ranking, text, promises
python tools/e2e.py                # real Chromium, API answers from tests/fixtures
python tools/e2e.py --only live    # one search against the real sources
python tools/e2e.py --base https://juw12.github.io/sumber/ --only live
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
| `js/sources.js` | The eight source adapters and the lens weights |
| `js/engine.js` | The only file that makes network requests; timeouts, cache, back-off |
| `js/rank.js` | The whole ranking formula |
| `js/text.js`, `js/cite.js` | Stemming, highlighting, verbatim passages, citations |
| `js/app.js`, `js/theme.js` | The interface |
| `js/config.js` | The two optional money links |
| `sw.js` | Offline shell, network first |
| `design.md` | Why it looks the way it does |
| `founder/` | Niche, competitors and money notes |

## Money

Running Sumber costs nothing: static files, no server, no index to pay for. It is free with no account.

`js/config.js` has room for two things, both empty by default and hidden while empty:

- `support`: a link to a page where people can chip in.
- `sponsor`: one text line in the footer that always starts with the word "Sponsor".

Only `https` addresses are accepted. Neither can change the results: the ranking code does not import
that file and a test fails if it ever does. Today both are empty, so income is zero. See
`founder/money.md` for the honest version.

## Licence

MIT. See `LICENSE`. Results belong to their sources and are shown under each source's own terms.
