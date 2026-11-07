# The in-app changelog

Trolay tells shoppers what changed after an update: a **What's new** sheet opens once, and the full list is in **Settings › About › What's new**. The entries live in [`src/lib/changelog.ts`](../src/lib/changelog.ts).

## When to add an entry

Add or extend an entry in the same PR as any change a shopper would notice: something new, something that works differently, something taken away, or a bug they may have hit. Internal changes (refactors, tests, tooling, security hardening with no visible effect) don't need one.

## How

- **One entry per release day**, keyed by the short version About shows: the build's date in UTC, `YYYY.MM.DD`. If today's entry already exists, add your lines to it. Otherwise add a new entry at the **top** (the list is newest first).
- Put each line under `added`, `changed`, `removed` or `fixed`. Leave out sections you don't need.
- Write for shoppers, not developers: one short sentence, in plain words, saying what they'll see or can do. No issue numbers, component names or jargon.
  - Good: "Undo after deleting a store or a trip."
  - Not: "Add undo toast to deleteStore (SIL-300)."
- A phone shows every entry newer than the last one it saw, so lines added to an entry after that day's release has reached phones won't be shown to them as new. Put late additions in the next day's entry.

`src/lib/changelog.spec.ts` checks the list is newest first, with one entry per version and no empty entries.

## How it's shown

- **After an update**, the first time the app opens: the entries newer than the last one this phone saw. A first install shows nothing (it gets the getting started guide instead).
- **In the update banner**: the waiting version is asked for its changelog (a `CHANGELOG` message to the service worker). If it has newer entries, the banner offers **See what's new** before the shopper refreshes.
