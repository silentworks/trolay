# Trolay

A shopping trolley PWA (SvelteKit) with a Cloudflare Worker API in `worker/`. The README covers setup.

## Every PR a shopper would notice needs a changelog line

If a change is something a shopper would see, add a line to `src/lib/changelog.ts` **in the same PR**. That covers anything new, anything that works differently, anything removed, and any bug they may have hit. These lines are what "What's new" shows after an update. Follow [docs/changelog.md](docs/changelog.md) exactly:

- Never add lines to an entry that's already on `main`: it has shipped, so phones won't show them. Add a new entry at the top, newer than the top one: today's UTC date (`date -u +%Y.%m.%d`), or, if that's taken (or the top entry is later), the top entry's date with the next number, `-2`, `-3`.
- Write it for shoppers, in one plain sentence. No issue numbers or component names.

The **Changelog** check fails any PR that changes `src/` or `static/` without touching `src/lib/changelog.ts`. If a change is internal only (a refactor, tests, tooling), label the PR `no-changelog` instead.

## Before opening a PR

- `pnpm check`: types
- `pnpm lint`: Prettier and ESLint
- `pnpm test`: unit tests
- `pnpm test:e2e`: Playwright, for anything a shopper uses
