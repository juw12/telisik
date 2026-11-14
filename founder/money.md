# Money

The honest version.

## Today

| | |
|---|---|
| Cost to run | 0. Static files on GitHub Pages, no server, no index, no paid API |
| Income | 0. Both money links are empty |
| Users | Not measured. There are no analytics on the page, by design |

Nothing in this file is a forecast. No traffic or revenue number has been measured, so none is given.

## The two income hooks that are built

Both live in `js/config.js`, both are empty and hidden by default, and neither can influence results.
The ranking code does not import that file, and `tests/hygiene.test.js` fails if it ever does.

1. **Support link.** Set `CONFIG.support` to a label and an `https` address (GitHub Sponsors, Ko-fi,
   Buy Me a Coffee or similar). A link appears in the footer.
2. **Sponsor line.** Set `CONFIG.sponsor` to a short text and an `https` address. One line appears in
   the footer and always starts with the word "Sponsor". It is never placed among results.

Turning either on needs a payment account in Juwen's own name. That step was left alone on purpose:
an agent should not open payment accounts or handle money.

## Why this can be passive

- There is no server to keep alive and no bill that grows with use.
- The sources are public APIs maintained by other organisations.
- The whole thing is static files, so it keeps working without attention until a source changes its
  API. The live check (`python tools/e2e.py --only live`) shows which source broke.

## What decides whether it earns anything

- People have to find it and keep using it. That has not been tested.
- Donations to free tools are usually a small share of users, so income depends on audience size.
- A sponsor will only pay once there is an audience to show, and with no analytics the only public
  signals are GitHub stars and word of mouth.

## Things deliberately not done

- No ads, affiliate links or paid placement in results. That would undo the reason to use it.
- No tracking to prove traffic to sponsors.
- No paid tier. Every feature runs in the visitor's browser at no cost, so there is nothing to meter.

## If income matters more later

Options that keep the promise, in order of effort. None is built.

1. Turn on the support link.
2. Offer one clearly labelled footer sponsor to an organisation that fits (a library, a reference
   publisher, a privacy tool).
3. Sell a hosted version with extra private sources to teams. That needs a server and support, so it
   stops being passive.
