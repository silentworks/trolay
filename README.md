# Shopping Trolley

A personal, installable web app (PWA) that keeps a running total of a shop as you go. Pick the
store, add each item, and the trolley shows the total with and without VAT at all times. It works
fully offline once installed.

Product spec: [Shopping Trolley — Product Spec](https://claude.ai/artifact/NnJxkYQHyYv1pEWaPDxRjz)
· Work tracked in the Linear project **My Shopping Trolley**.

## Decisions

- **UI framework: SvelteKit 3 in SPA mode** (`ssr = false`, `@sveltejs/adapter-static` with an
  `index.html` fallback). All data lives in the browser, so nothing renders on a server.
- **Service worker: SvelteKit's built-in support** (`src/service-worker/`), not Workbox.
  `@vite-pwa/sveltekit` does not support SvelteKit 3. The worker precaches every build file and
  serves the app shell for all navigations, so the app works with no signal.
- **Local data: Dexie over IndexedDB** (`src/lib/data/`). Records carry `updatedAt`, `updatedBy`
  and `deletedAt` (tombstones) from day one, ready for sync in phase 4.
- **Money: integer pence, VAT in basis points** (2000 = 20%), see `src/lib/money.ts`. Each line
  is rounded to the nearest penny (half up), then lines are summed.

## Develop

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm dev            # http://localhost:5173
```

Imports from `src/lib` use the `#lib/*` alias with the file extension, e.g.
`import { formatGBP } from '#lib/money.ts'`.

## Test

```sh
pnpm check          # svelte-check (types and a11y)
pnpm lint           # prettier + eslint
pnpm test           # unit tests: VAT maths, data layer (fake-indexeddb)
pnpm test:e2e       # Playwright against a production build, including offline
pnpm check:all      # all of the above
```

First run of the end-to-end tests: `pnpm exec playwright install chromium`.

## Deploy (Cloudflare Pages)

The build output in `build/` is a static site.

1. Buy the domain and move its DNS to Cloudflare.
2. Create a Pages project connected to this repository: build command `pnpm build`, output
   directory `build`.
3. Add the domain as a custom domain on the Pages project. HTTPS is required for the camera and
   the service worker.

`static/_headers` stops browsers caching the service worker and app shell, so new versions are
picked up. Cloudflare Pages serves `index.html` for any path without a file of its own, which is
what the SPA needs. `/api` is reserved for the phase 4 sync API.
