# Receipt fixtures

Photos of till receipts with the total that was paid, used by `pnpm test:receipts`
(`scripts/receipt-accuracy.ts`). It runs every photo through the same OCR engine and parser as
the app (`src/lib/capture/receipt/parse.ts`) and scores the total strictly, like the label check:

- **right**: the total filled in is exactly right, to the penny; or, when the photo shows no
  total, nothing was filled in.
- **empty**: the reader was not sure, so it left the total for the shopper.
- **wrong**: a wrong total, or any total when the photo shows none. This must stay at zero; the
  check fails otherwise. A wrong total would invent a receipt mismatch, or hide a real one.

It also prints the 95% upper bound on the wrong-fill rate and how many right totals the payment
lines confirmed.

## Sets

| Folder  | What                                                                   | In git           |
| ------- | ---------------------------------------------------------------------- | ---------------- |
| `real/` | Real receipt photos, openly licensed (`real/ATTRIBUTION.md`)           | Photos + answers |
| `dev/`  | 120 generated photo-realistic UK receipts, used to tune the reader     | Answers only     |
| `test/` | 240 generated receipts with different products, scored once at the end | Answers only     |

`pnpm fixtures:receipts` (`scripts/make-receipt-photos.ts`, needs `rsvg-convert` and
ImageMagick) draws them in nine UK house styles, with subtotals, multibuy and loyalty savings,
coupons, "TOTAL SAVINGS", VAT summaries, points balances, a product called "FAGE TOTAL", cash
with change, split payments, cashback and gift cards. Each is photographed like the bottom of a
receipt in the camera guide: thermal fade, curl, creases, perspective, tilt, uneven light, blur,
noise and JPEG compression. About one in twelve is framed too high to include the total.

## Adding a real photo

1. Photograph the bottom of the receipt as you would in the app.
2. Save it in `real/` and add `"name.jpg": { "totalMinor": 2345 }` to `real/expected.json`
   (`null` if the photo shows no total).
3. Run `pnpm test:receipts real --verbose`.
