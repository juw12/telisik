# Ambition

## The goal behind the goal

The request was a search engine that beats current search and AI. Nobody beats a whole-web index with
static files, so the useful version of that goal is narrower: be the page a person opens when the
source matters more than the summary, and be honest enough that they can set it as their default.

## The weakness being covered

| What people run into today | What Sumber does instead |
|---|---|
| Result pages crowded with pages written to rank and to sell | Asks public libraries and records that have no shop window to optimise for, plus one small non-profit web index |
| Answer engines that write confident text with citations that do not check out | Writes nothing. Every sentence is copied from a source and linked to it |
| No way to see why a result is first | Prints the arithmetic behind every position |
| Hard to tell human writing from machine writing | One switch limits results to items dated up to 30 November 2022 |
| Tracking, accounts, paid tiers | No server, no account, no key, no cookies |

Evidence for the first two rows:

- Bevendorff et al., "Is Google Getting Worse? A Longitudinal Investigation of SEO Spam in Search
  Engines", ECIR 2024, https://doi.org/10.1007/978-3-031-56063-7_4. 7,392 product-review queries;
  higher-ranked pages were on average more optimised and more monetised with affiliate links, and
  showed signs of lower text quality.
- Tow Center for Digital Journalism, Columbia Journalism Review, March 2025,
  https://www.cjr.org/tow_center/ai-search-has-a-citation-problem.php. Eight AI search tools, 1,600
  queries about news articles, more than 60 percent of the answers wrong.

- European Broadcasting Union and BBC, "News Integrity in AI Assistants", October 2025,
  https://www.bbc.co.uk/mediacentre/2025/new-ebu-research-ai-assistants-news-content/ (report:
  https://www.ebu.ch/Report/MIS-BBC/NI_AI_2025.pdf). Journalists at 22 public broadcasters in 18
  countries and 14 languages judged more than 3,000 answers from four assistants: 45 percent had at
  least one significant issue and 31 percent had serious sourcing problems.
- Pew Research Center, 22 July 2025,
  https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/.
  68,879 Google searches by 900 US adults in March 2025: people clicked a normal result on 8 percent
  of visits that showed an AI summary and on 15 percent of visits that did not, and clicked a link
  inside the summary on 1 percent.

The last two were read on the publishers' own pages on 14 November 2026 and the figures above were
found there word for word. They say why the niche exists. They do not say Sumber is better than
anything.

## Who it is for

- Students and researchers who need a citable source, not a paraphrase.
- Developers who want the Stack Exchange answer, the repository and the discussion in one list.
- Anyone who has stopped trusting the first screen of a web search for a factual question.

## What it is not

- Not a crawl of the web. Shopping, news, maps and local results are handed to other engines by bangs.
- Not a meaning search. It matches words.
- Not a claim to have beaten Google or any answer engine. No comparison test was run, so none is claimed.

## What would make it grow

These are levers that need no money and no server. None of them has been tried yet, so there are no
results to report.

- It can be set as the browser's default search (OpenSearch file and bangs are in place).
- Every search is a plain link, so results can be shared and bookmarked.
- The code is small and readable, which suits Hacker News, privacy forums and library or teaching
  communities where "no generated text" is the selling point.
