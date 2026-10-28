# Trolay

A personal, installable web app (PWA) that keeps a running total of a shop as you go. Pick the
store, add each item, and the trolley shows the total with and without VAT at all times. It works
fully offline once installed.

Work is tracked in the Linear project **Trolay**.

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

Requires Node 22+ and pnpm 10 (pinned in `package.json` under `packageManager`).

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

## Deploy (Cloudflare Workers)

The app is served as Workers static assets, configured in `wrangler.jsonc`. The build output in
`build/` is uploaded as assets; there is no Worker script yet.

1. Create a Worker connected to this repository (Workers Builds) with:
   - Build command: `pnpm build`
   - Deploy command: `pnpm exec wrangler deploy`
   - Non-production branch deploy command: `pnpm exec wrangler preview` (needs the `previews`
     block in `wrangler.jsonc`)
   - The Worker's name must match `name` in `wrangler.jsonc` (`trolay`).
2. Buy the domain, move its DNS to Cloudflare, and add it as a custom domain on the Worker.
   HTTPS is required for the camera and the service worker.

To deploy by hand: `pnpm build && pnpm exec wrangler deploy` (after `pnpm exec wrangler login`).

`not_found_handling: "single-page-application"` serves `index.html` for any path without a file
of its own, which is what the SPA needs. `static/_headers` stops browsers caching the service
worker and app shell, so new versions are picked up. `/api` is reserved for the phase 4 sync API.
