# Competitors

Checked by web search on 2026-11-13. Prices and features change, so follow the links before relying
on any line here.

| Name | What it is | Where it differs from Sumber |
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

- Coverage. Every engine with a crawler finds pages Sumber cannot see.
- Meaning. Engines with language models handle vague or conversational questions; Sumber needs the
  right words.
- Speed at scale. Sumber is limited by the public quotas of the sources it asks.

## What Sumber can defend

- Cost of zero, so it never needs to sell placement to stay online.
- A promise that is checkable: the tests fail if a remote script, an undeclared host or a money
  setting touches the page or the ranking.
- A position that gets more useful as more of the web is machine-written: dated, attributed,
  human-written sources.
