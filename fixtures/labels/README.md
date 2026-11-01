# Shelf-label fixtures

Photos of shelf labels with the values the label reader must find, used by
`pnpm test:labels` (`scripts/label-accuracy.ts`). It runs every photo through the same OCR
engine and parser as the app and scores each field strictly:

- **right**: the value filled in is exactly right. Prices to the penny; descriptions word for
  word, ignoring only case and spacing.
- **empty**: the reader was not sure, so it left the field for the shopper.
- **wrong**: filled in with a wrong value. This must stay at zero; the check fails otherwise.

For each set it also prints a 95% upper bound on the wrong-fill rate (Wilson score interval),
so a clean run states how rare mistakes must be, not only that none happened.

## Sets

| Folder     | What                                                                  | In git           |
| ---------- | --------------------------------------------------------------------- | ---------------- |
| `real/`    | Real photos: the owner's, and openly licensed ones (`ATTRIBUTION.md`) | Photos + answers |
| `dev/`     | 160 generated photo-realistic labels, used to tune the reader         | Answers only     |
| `test/`    | 320 generated labels with different products, held out to measure it  | Answers only     |
| `holdout/` | 320 more of the test products from new seeds, scored once at the end  | Answers only     |

`dev/` and `test/` are drawn by `pnpm fixtures:labels` (`scripts/make-label-photos.ts`, needs
`rsvg-convert` and ImageMagick): eight UK label layouts (classic, coloured band, discounter
with raised pence, warehouse, trade inc/ex VAT, offers, electronic shelf label, pence-only),
photographed with perspective, tilt, uneven light, sleeve glare, blur, noise and JPEG
compression, sometimes with the neighbouring label's edge and price in frame. The two sets share
no products. Generation is deterministic, so only `expected.json` is committed.

`test/` was scored once and its few failures were then looked at and fixed, so it no longer
counts as unseen. `holdout/` (`node scripts/make-label-photos.ts holdout 0 320`) is a fresh
draw of the same products that nothing was tuned on.

Generated labels are a stand-in for scale; real photos are the proof. Add your own.

## Adding a real photo

1. Photograph the label as you would in the app, filling most of the frame.
2. Save it in `real/` (JPEG or PNG, any size).
3. Add an entry to `real/expected.json`:

   ```json
   "tesco-milk.jpg": {
   	"description": ["Semi Skimmed Milk 2.272L"],
   	"unitPriceMinor": 145,
   	"vat": null
   }
   ```

   A label with a multi-buy offer ("2 for £3.00") also gets `"offer": { "quantity": 2, "totalMinor": 300 }`.
   Labels without one are scored on finding none: an offer read from a label that has none counts as wrong.

   - `description`: every acceptable wording, as printed (a brand line may be in or out).
   - `unitPriceMinor`: the price you pay, in pence (the regular price on loyalty-card labels).
   - `vat`: `"inc"` or `"ex"` if the label prints a VAT marker by the price, otherwise `null`.

4. Run `pnpm test:labels real`, or `pnpm test:labels real --filter tesco --verbose` to see what
   was read.

## Tools

- `pnpm test:labels [real|dev|test] [--filter text] [--verbose]`: the accuracy check.
- `node scripts/label-calibration.ts [set]`: what the parser picked before thresholds, right or
  wrong, with its confidence; used to set the thresholds in `label/parse.ts`, on `dev` only.
- `node scripts/label-debug.ts <photo>`: the rows the parser sees and its reading.
- `node scripts/ocr-regions.ts <photo>`: every region the detector finds and what each reads.
- `node scripts/ocr-crop-probe.ts <photo> <cx> <cy> <w> <h> <angles…>`: one region read in many crops.

OCR results are cached in `.cache/ocr/` by photo and engine version, so changes to the parser
re-score in seconds.
