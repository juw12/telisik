# Competitors

Checked by web search on 2026-11-13. Prices and features change, so follow the links before relying
on any line here.

| Name | What it is | Where it differs from Telisik |
|---|---|---|
| [Kagi](https://kagi.com/) | Paid, ad-free web search with its own ranking controls | Whole-web results and paid plans; needs an account |
| [Marginalia](https://marginalia-search.com/) | Independent index that favours small, text-heavy sites | Own crawler and server; no cross-source evidence or citations |
| [Brave Search Goggles](https://search.brave.com/goggles) | User-written re-ranking rules on top of Brave's index | Ranking is adjustable but sits on a commercial index with ads |
| [Mojeek](https://www.mojeek.com/) | Independent crawler-based web search | Whole-web index; funded by ads and an API |
| [SearXNG](https://docs.searxng.org/) | Open-source metasearch that queries other engines | Closest in idea, but someone has to run a server |
| [Wiby](https://wiby.me/) | Hand-curated index of simple, old-style pages | Small curated set; no papers, code or Q&A |
| [Perplexity](https://www.perplexity.ai/) | Answer engine that writes a summary with citations | The opposite approach: generated text first, sources second |

## The gap

I found none that is all of these at once: free, no account, no server, runs entirely in the browser,
asks several non-commercial sources in one query, prints only the sources' own words, and shows the
ranking arithmetic. That is a statement about what one day of searching turned up, not proof that no
such tool exists.

## Where the others are stronger

- Coverage. Every engine with a crawler finds pages Telisik cannot see.
- Meaning. Engines with language models handle vague or conversational questions; Telisik needs the
  right words.
- Speed at scale. Telisik is limited by the public quotas of the sources it asks.

## What Telisik can defend

- Cost of zero, so it never needs to sell placement to stay online.
- A promise that is checkable: the tests fail if a remote script, an undeclared host or a money
  setting touches the page or the ranking.
- A position that gets more useful as more of the web is machine-written: dated, attributed,
  human-written sources.

## Measured head to head (16 November 2026)

50 questions with one known right answer each, written after the last change to the ranking formula
and scored once, first ten results, `node tools/compare.mjs --queries=queries3.json
--pools=pools3-first.json`:

| Asked of | First | Top 10 | MRR |
|---|---|---|---|
| Telisik, all sources | 50% | 72% | 0.579 |
| Wikipedia search alone | 36% | 64% | 0.468 |
| Mwmbl web index alone | 14% | 24% | 0.174 |
| Hacker News search alone | 6% | 10% | 0.073 |
| GitHub search alone | 0% | 0% | 0.000 |

- Loss: on the 33 plain-description questions Wikipedia's own search beats Telisik (first 42% each,
  top 3 70% against 52%, top 10 82% against 67%, MRR 0.573 against 0.498).
- Win: on the 17 named things Telisik is first for 65% and the best single source (Mwmbl) for 35%.
- Bias: every right answer is a page inside the libraries Telisik searches, so the table leans
  Telisik's way. GitHub refused or failed 4 of the 50 requests; asked again with every source
  answering, Telisik reads 52%, 76% and 0.609.
- Not measured: Google, Bing, ChatGPT, Perplexity (terms forbid automated queries); Marginalia, Stract
  and the DuckDuckGo instant-answer interface (tried again 16 November 2026, no answer from this
  network).
- Not a competitor at all: Chromium and Firefox. Telisik is a page that runs inside a browser. It
  installs as an app in them and plugs into the address bar and the share sheet; it does not replace
  them.

## Verdict

Telisik is not the best search engine overall and the data does not support saying so. It is the best
tool found for one job: checking a claim against dated, attributed, human-written sources in one free
query, with only verbatim quotes and the ranking arithmetic on show. For the open web, today's news,
shopping and conversational questions the general engines and assistants are stronger.
