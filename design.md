# Sumber design notes

## The idea

A reference work, not an app. The page should feel like the index and footnotes of a well-set book:
you look something up, you see who said it and where, you leave. Everything on screen is either a
source's words or a label telling you whose words they are.

## Tokens

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#fbfbf8` | `#111318` | Paper |
| `--surface` | `#f2f1ea` | `#1a1d24` | Why and Cite panels, code |
| `--ink` | `#16181d` | `#e6e4de` | Text |
| `--muted` | `#555a66` | `#a3a7b2` | Labels, dates, fine print |
| `--rule` | `#d6d4ca` | `#353a45` | Hairlines |
| `--link` | `#1a3fb0` | `#9db4ff` | Titles and links |
| `--visited` | `#5b2a86` | `#c7a5e6` | Visited links, kept on purpose |
| `--accent` | `#c8321f` | `#ff7a66` | Footnote numbers, the quote rule, the active lens |
| `--mark-bg` | `#fbe7b5` | `#4d3d0f` | Query words inside excerpts |

One accent only. Vermilion is the colour of a rubric in a printed book, so it is spent on the things
that work like footnote marks: result numbers, the numbers after quotes, and the rule beside a quote.

## Type

- Serif (`Iowan Old Style`, Palatino, Georgia) for what the sources wrote: titles and quotes.
- System sans for what Sumber says: labels, controls, counts.
- Monospace for the ranking arithmetic, so the columns line up.
- No web fonts. Nothing is fetched from another host, which the content security policy enforces.
- Body 16 px, smallest text 12 px, reading measure 44 rem.

## Layout

- One column of results with a narrow margin column for the "Sources asked" ledger on wide screens.
  The ledger uses dot leaders like a printed index.
- On phones the ledger folds to one line ("8 of 8 answered") with a Show button, so the first quote
  stays on the first screen. Opening it lists every source and its count.
- Controls are 44 px tall on phones. Inline links in running text are left as text.
- Light and dark follow the system and can be set by hand. Both pass WCAG AA for every text node; the
  browser run in `tools/e2e.py` measures it.

## What was left out on purpose

- No cards, shadows, gradients, rounded pills or icons. Hairlines and white space do the grouping.
- No logo mark beyond the word and its footnote number.
- No spinner theatre: sources fill in as they answer and the ledger says which ones did not.
- No avatars, no chat bubble, no "ask anything" box. It is a search field.
- No favicons from the result sites, since fetching them would tell a third party what you searched.

## Words

Short and literal. Every limit is stated where it applies: the results page says it is not the whole
web, the Before AI switch says it is a date filter, the Why panel says that nothing else goes into the
order.
