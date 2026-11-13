# The in-app changelog

Trolay tells shoppers what changed after an update: a **What's new** sheet opens once, and the full list is in **Settings › About › What's new**. The entries live in [`src/lib/changelog.ts`](../src/lib/changelog.ts).

## When to add an entry

Add or extend an entry in the same PR as any change a shopper would notice: something new, something that works differently, something taken away, or a bug they may have hit. Internal changes (refactors, tests, tooling, security hardening with no visible effect) don't need one.

The **Changelog** check on each PR ([`.github/workflows/changelog.yml`](../.github/workflows/changelog.yml)) fails when the PR changes `src/` or `static/` (unit tests aside) without touching `src/lib/changelog.ts`. For an internal change, label the PR `no-changelog` and the check passes.

## How

- **One entry per release**, keyed by the short version About shows: the build's date in UTC, `YYYY.MM.DD`. Each merge to `main` is a release.
- **Never add lines to an entry that's already on `main`.** It has reached phones, and a phone only shows entries newer than the last one it saw, so the lines would never show as new. Add a new entry at the **top** instead (the list is newest first), newer than every entry already there:
  - today's UTC date (`date -u +%Y.%m.%d`), if no entry has it yet;
  - otherwise, the top entry's date with the next number: `2026.11.13` is followed by `2026.11.13-2`, then `2026.11.13-3`. What's new shows the date alone, "13 November 2026".
  - If the top entry is dated later than today, as `2026.11.14` was on 13 November, number on from it (`2026.11.14-2`). An entry dated today would sort below it and never show.
- Lines for an entry that isn't on `main` yet, such as one in your own open PR, can still go in it.
- Put each line under `added`, `changed`, `removed` or `fixed`. Leave out sections you don't need.
- Write for shoppers, not developers: one short sentence, in plain words, saying what they'll see or can do. No issue numbers, component names or jargon.
  - Good: "Undo after deleting a store or a trip."
  - Not: "Add undo toast to deleteStore (SIL-300)."
    `src/lib/changelog.spec.ts` checks the list is newest first (`compareVersions`: by date, then number), with one entry per version, versions shaped `YYYY.MM.DD` or `YYYY.MM.DD-N`, and no empty entries.

## How it's shown

- **After an update**, the first time the app opens: the entries newer than the last one this phone saw. A first install shows nothing (it gets the getting started guide instead).
- **In the update banner**: the waiting version is asked for its changelog (a `CHANGELOG` message to the service worker). If it has newer entries, the banner offers **See what's new** before the shopper refreshes.
