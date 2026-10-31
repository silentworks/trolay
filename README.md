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
- **Sync API: one Cloudflare Worker on `/api`, with a D1 (SQLite) database** (`worker/`,
  `migrations/`). The app and API share one origin, so there is no CORS. Only `/api/*` runs the
  Worker (`run_worker_first` in `wrangler.jsonc`); the app itself is still served straight from
  static assets and works without it. The tables (`users`, `stores`, `trips`, `trip_members`,
  `items`) carry the same `updated_at`, `updated_by` and `deleted_at` columns as the app's local
  records. The app stays fully usable without an account; sync only adds to it.
- **Sign-in: passkeys only, no passwords** (`worker/auth/`, `src/lib/auth/`, SimpleWebAuthn).
  Signed out you can create an account or sign in; signed in you can add a passkey on another
  device. A passkey belongs to the site it was made on, which the Worker takes from the request
  (the app and API share an origin), so it works on `localhost` in development and on your
  domain in production, but a passkey made in one place is not valid in the other. The session is
  an `HttpOnly`, `Secure`, `SameSite=Lax` cookie (`__Host-session` over HTTPS); only a hash of its
  token is stored, it lasts 30 days, and signing out ends it on that device only. Each ceremony's
  challenge is single-use and expires in 5 minutes. State-changing requests must be JSON and
  must not come from another origin. Account screen: `/account`. The app is fully usable
  without an account.
- **Sign-in by emailed link, for when a passkey isn't to hand** (`worker/auth/link.ts`,
  `worker/mail.ts`). A link works once and expires after 15 minutes. It points at
  `/account/link#token=…`: the token is in the fragment, which browsers never send to a server,
  so it stays out of logs, and a mail scanner that opens the link without running the app cannot
  use it up. Only a hash of the token is stored. Asking for a link answers the same whether or
  not the address has an account, and is rate-limited (one a minute and five an hour per
  address, ten an hour per source). An address with no account gets one when its link is opened;
  a signed-in user can add an address to their account, and that link signs nobody in. After
  signing in by link, the app offers to add a passkey on that device. Email goes through
  Cloudflare Email Service (`send_email` binding `EMAIL`); set `MAIL_FROM` in `wrangler.jsonc` to
  an address on a domain you have set up there. In development, emails are captured and printed
  by the API instead of sent (`MAIL_MODE=capture`, set by `pnpm dev:api`); never set it in
  production, because it exposes the captured emails at `/api/dev/outbox`.
- **Sync across your own devices** (`src/lib/sync/`, `worker/sync/`). Stores, trips and items
  sync; label photos stay on the phone that took them. The app works the same without it.
  - _Outbox:_ a hook on the local tables records, on each record itself, every field that changed
    and when (`pending`). It is written in the same IndexedDB transaction as the change, so a
    change and its entry can never be separated or lost, and nothing needs a table of its own.
    `pendingAt` is indexed, so finding what to send is one query. Records made before sync
    existed are marked by the upgrade to schema 3, so signing in uploads them.
  - _Sending and receiving:_ when signed in, the app sends what is pending (stores, then trips,
    then items), then pulls what changed on the server since the position it last saw. It runs
    shortly after a change, when the signal returns, when the app is opened and now and then.
    Sent fields are cleared only if they have not changed again since, so an edit made while a
    request is in flight is not lost. A record whose store or trip has not arrived yet waits.
  - _Conflicts:_ settled by the server **per field**: the change with the newest time wins
    (`field_times` on every row), so two phones editing different fields of one item both keep
    their edits, and a tie goes to the larger value, so every device and server picks the same
    winner in any order. A delete is the field `deletedAt` and an undo a newer change that unsets
    it. A pulled value never overwrites a field with an edit still waiting to be sent: that edit
    goes to the server, which decides, and the next pull brings the winner back.
  - _Order:_ pulls follow a server-side sequence (`changes`), not the devices' clocks, so an edit
    from a phone that was offline for days still reaches every other phone. A change dated more
    than a day ahead of the server is refused, so one wrong clock cannot win every conflict.
  - _Who sees what:_ your stores, and trips (and their items) you are a member of; the owner is a
    member of their own trips.
  - _Shows:_ "✓ Synced", "N changes waiting to sync", "Syncing…" (with a count for a big
    upload) or "Offline" on the Home and Account screens.
  - _Known limits:_ clocks on your devices are trusted (to a day); if two phones each start a trip
    while apart, both are open after syncing and the app shows one; a restore from a backup
    merges with, and does not replace, what is already in your account; signing out leaves the
    data on the phone. A different account signing in there gets the data that was never sent
    to the first one (a new store made while signed out), and the rest, which the first account
    owns, stays on the phone only: a record belongs to one account.
- **Testing sync** (`src/lib/sync/harness.ts`, `harness.spec.ts`). Simulated phones, each with its
  own IndexedDB, go offline, edit and reconnect against the real Worker and a real local D1, all
  in-process: no browser, no network, part of `pnpm test`. A virtual clock gives every edit a
  known moment, so a test can say which edit must win. The documented outcomes, each tested:
  - a field settles on the newest edit made to it anywhere; edits to different fields of one
    item are all kept; edits at the very same moment settle the same on every device;
  - a delete is the field `deletedAt`: it is not undone by an edit to another field (even a newer
    one), and that edit is kept for if the delete is undone; only a newer undo or delete changes
    it;
  - however many phones, and whatever order they reconnect in, they end with the same data;
  - random histories (several phones making random edits, deletes, undos and new items, losing
    and regaining signal, syncing at random) are checked against an answer worked out separately:
    for every field, the value of the newest edit made to it anywhere.
- **Inviting a partner to a trip** (`worker/trips/invite.ts`, `src/lib/sharing/`, the shopping
  screen's ⋮ menu → "Invite a partner", and `/join`). The owner makes a link for an open trip;
  the trip is synced first so the server knows it. The link is `/join#token=…`, with the token in
  the fragment like the sign-in link, and only its hash is stored. It works once, for one person,
  for a day, and making another replaces it. Whoever opens it signs in (the invite waits in this
  tab's session storage meanwhile) and taps Join, which makes them the trip's `partner` in
  `trip_members`. A trip has at most one partner, enforced by a unique index, so two people
  accepting at once cannot both get in; others are told the trip is full. You cannot accept your
  own invite, and a finished trip cannot be shared. Joining also moves the trip and its items to
  the end of the change log, so the partner's phone picks them up whatever position it is at.
  **What a partner can reach** (`worker/sync/pull.ts`, `push.ts`, `worker/partner.spec.ts`): the
  trip, its items and the store it is at, and nothing else of the owner's. They can add, edit and
  delete items, set the budget, and finish the trip; they cannot move it to another store, delete
  it, or change the store. Every write checks membership of the trip the record is in now as well
  as the one it is going to, so knowing an item's id is not enough to take it.
- **Live trip updates** (`worker/trips/room.ts`, `live.ts`, `src/lib/sync/live.ts`). While signed
  in with a trip open, a phone keeps a WebSocket to that trip's `TripRoom`, a Durable Object (one
  per trip, found by the trip's id; SQLite-backed, with hibernating sockets, so an idle trip costs
  nothing). The room holds a version that goes up on every change and the connected sockets. When
  a push changes a trip or its items, the Worker tells the room, which sends every phone on the
  trip a nudge; a nudge only makes the phone sync, so the change arrives the way every change does
  and the socket never carries data. A phone that connects syncs straight away, so one that was
  offline or dropped catches up on reconnecting (with a growing pause, 1 s to 30 s). Opening a
  socket is checked like a sync (signed in, a member, the trip open, and the handshake from this
  site, since cookies go with it); when the trip finishes the room lets the phones go. Changes
  are sent 0.4 s after the last tap, so a change reaches the other phone within a couple of
  seconds. The room runs only under a real Worker, so the end-to-end tests cover it (`pnpm
test:e2e`); the Worker tests cover the door. Deploying creates the class through the
  `migrations` entry in `wrangler.jsonc`.
- **Photos on a shared trip** (`worker/trips/photos.ts`, `src/lib/sync/photos.ts`, R2). Photo
  bytes never sync as records; an item carries its photo's `photoId` (a synced field), and while a
  trip is open and has a partner, each phone uploads the photos it took to R2
  (`PUT /api/trips/<trip>/photos/<photo>`, under `trips/<trip>/`) and fetches the other's, after
  each sync round. The upload tells the partner's phone, through the trip's live connection. A
  trip with no partner uploads nothing; a phone asks the server whether there is one each round
  until it says yes. An upload that fails for lack of signal is retried when the signal returns;
  it is sent once (marked `uploaded`). Only members can read or write a trip's photos; an upload
  must be an image of at most 2 MB and only while the trip is open. When the trip finishes the
  Worker deletes the trip's photos from R2, unless they were kept as receipt evidence, in which
  case deleting the evidence later (which syncs as `photosKept = false`) deletes them too. The
  partner's phone drops its copies once the items lose their `photoId`. R2 needs a bucket named
  `trolay-photos` (`wrangler r2 bucket create trolay-photos`).
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
pnpm dev            # the app alone, http://localhost:5173
pnpm dev:all        # the app and the API together; the app reaches /api through a proxy
pnpm dev:api        # the API alone, http://localhost:8787 (creates its local database)
pnpm db:migrate     # apply new migrations to the local database
```

The local database lives in `.wrangler/` (ignored by git). To add a table or column, add the next
numbered file to `migrations/`; never edit one that has been deployed.

Requires `rsvg-convert` and ImageMagick to generate the label and receipt fixtures
(`pnpm fixtures:labels`, `pnpm fixtures:receipts`) and to run `pnpm test:labels` and
`pnpm test:receipts`, and `ffmpeg` for the camera end-to-end tests (it turns a label
photo into the fake camera's video).

Imports from `src/lib` use the `#lib/*` alias with the file extension, e.g.
`import { formatGBP } from '#lib/money.ts'`.

## Test

```sh
pnpm check          # svelte-check (types and a11y) and the Worker's types
pnpm lint           # prettier + eslint
pnpm test           # unit tests: VAT maths, data layer (fake-indexeddb), the Worker (a real local D1)
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
`build/` is uploaded as assets, and the Worker in `worker/` answers `/api/*`.

1. Create a Worker connected to this repository (Workers Builds) with:
   - Build command: `pnpm build`
   - Deploy command: `pnpm db:migrate:remote && pnpm exec wrangler deploy` (migrations are
     applied before the new code goes live)
   - Non-production branch deploy command: `pnpm exec wrangler preview` (needs the `previews`
     block in `wrangler.jsonc`)
   - The Worker's name must match `name` in `wrangler.jsonc` (`trolay`).
2. The sync database was created once with `pnpm exec wrangler d1 create trolay`, and its
   `database_id` is in `wrangler.jsonc` under the binding `DB`, the name the Worker reads. A
   different Cloudflare account needs its own: create one and replace the id.
3. Buy the domain, move its DNS to Cloudflare, and add it as a custom domain on the Worker.
   HTTPS is required for the camera and the service worker.

To deploy by hand: `pnpm build && pnpm db:migrate:remote && pnpm exec wrangler deploy` (after `pnpm exec wrangler login`).

`not_found_handling: "single-page-application"` serves `index.html` for any path without a file
of its own, which is what the SPA needs. `static/_headers` stops browsers caching the service
worker and app shell, so new versions are picked up. `/api/*` runs the Worker instead of looking
for a file.
