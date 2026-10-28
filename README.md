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
  serves the app shell for all navigations, so the app works with no signal. A new version
  installs in the background and waits: the app shows "Refresh to update" and reloads only when
  tapped, never mid-shop on its own. Dismissed, it takes over the next time the app is opened.
- **Local data: Dexie over IndexedDB** (`src/lib/data/`). Records carry `updatedAt`, `updatedBy`
  and `deletedAt` (tombstones) from day one, ready for sync in phase 4.
- **Money: integer pence, VAT in basis points** (2000 = 20%), see `src/lib/money.ts`. Each line
  is rounded to the nearest penny (half up), then lines are summed.
- **Label reading: PaddleOCR's PP-OCRv5 models on ONNX Runtime Web, on the device**
  (`src/lib/capture/ocr/`, `src/lib/capture/label/`), no cloud service. Tesseract.js was tried
  first and could not read real shelf-label photos: it is built for scanned documents. PP-OCRv5
  (Apache-2.0, `models/ocr/`) is built for text in photos. The models and the WebAssembly runtime
  (~24 MB) are copied to `static/ocr/<content hash>/` by `scripts/copy-ocr-assets.js`, run in a
  Web Worker and are kept by the service worker in a cache that survives app updates.
  - Detection runs at two scales (fine print, and very large glyphs such as a price's "1");
    big short text (the price) is read in several crops that vote.
  - `label/parse.ts` reads the layout, not just the text: captions ("SELL PRICE", "PRICE PER
    LITRE"), raised pence, was-prices, multi-buys, loyalty prices and unit prices; the price is
    cross-checked against the unit price and pack size, ex VAT against inc VAT.
  - A field is filled only above a confidence threshold, otherwise left for the shopper.
    `pnpm test:labels` measures this on real and generated photos (`fixtures/labels/README.md`).
- **Receipt totals: the same on-device OCR, read by what the lines say**
  (`src/lib/capture/receipt/parse.ts`). The total is the amount beside a line that is nothing
  but a total caption ("TOTAL", "BALANCE DUE", "AMOUNT TO PAY"…), so subtotals, savings, VAT
  totals and a product called "FAGE TOTAL" never count. The payment lines (card, gift card,
  cash less change, cashback) must add up to it; a curled or angled receipt is paired every
  plausible way and the arithmetic decides. Without that confirmation a total is only filled
  when it is read with high confidence and every pairing agrees. The shopper always sees it
  before finishing. `pnpm test:receipts` measures it (`fixtures/receipts/README.md`).
- **Finishing a trip** snapshots its totals, so editing a store's VAT rate later does not
  rewrite history. Photos are deleted on finish unless the receipt total differs from the app's
  by a penny or more, when they are kept as evidence.
- **Barcodes: the browser's `BarcodeDetector` where it reads retail formats (Android Chrome),
  otherwise ZXing in WebAssembly** (`barcode-detector` ponyfill), bundled with the app so it
  works offline.
- **Product names: the shopper's own earlier items first, then Open Food Facts.** Only the
  barcode is sent; answers are cached on the device and lookups made with no signal are retried
  later.

## Develop

Requires Node 22+ and pnpm 10 (pinned in `package.json` under `packageManager`).

```sh
pnpm install
pnpm dev            # http://localhost:5173
```

Requires `rsvg-convert` and ImageMagick to generate the label and receipt fixtures
(`pnpm fixtures:labels`, `pnpm fixtures:receipts`) and to run `pnpm test:labels` and
`pnpm test:receipts`, and `ffmpeg` for the camera end-to-end tests (it turns a label
photo into the fake camera's video).

Imports from `src/lib` use the `#lib/*` alias with the file extension, e.g.
`import { formatGBP } from '#lib/money.ts'`.

## Test

```sh
pnpm check          # svelte-check (types and a11y)
pnpm lint           # prettier + eslint
pnpm test           # unit tests: VAT maths, data layer (fake-indexeddb)
pnpm test:e2e       # Playwright against a production build, including offline and a fake camera
pnpm fixtures:labels  # generate the dev/test label photos (once; not committed)
pnpm test:labels    # label reader accuracy over fixtures/labels (see its README)
pnpm fixtures:receipts  # generate the dev/test receipt photos (once; not committed)
pnpm test:receipts  # receipt reader accuracy over fixtures/receipts (see its README)
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
