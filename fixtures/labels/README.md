# Shelf-label fixtures

Test images for the label reader, with the values it should read in `expected.json`.
`pnpm test:labels` runs each one through the same two OCR passes and parser as the app, and
reports per field how often the value was right, left empty for the shopper, or wrong.
It fails if any price is read confidently wrong.

## Synthetic labels

`synthetic-*.png` are drawn by `pnpm fixtures:labels` (`scripts/make-label-fixtures.js`, needs
`rsvg-convert`): 30 UK-style labels in four layouts (classic, coloured band, trade ex-VAT,
offer), some rotated or blurred, with unit prices, "was" prices and multi-buy lines that
must be ignored.

## Real photos

Synthetic labels are cleaner than the real thing. Add photos taken in stores:

1. Take the photo with the phone as you would in the app, label filling most of the frame.
2. Save it here, e.g. `tesco-milk-01.jpg` (JPEG or PNG, any size).
3. Add an entry to `expected.json`:

   ```json
   "tesco-milk-01.jpg": {
   	"description": "Semi Skimmed Milk 2.272L",
   	"unitPriceMinor": 145,
   	"priceIncludesTax": true
   }
   ```

   `description` only needs the words on the label; it counts as right when most of what was
   read appears in it. `unitPriceMinor` is the item price in pence. `priceIncludesTax` is
   `false` only for labels that show an ex-VAT price.

4. Run `pnpm test:labels` (or `pnpm test:labels tesco` for just those files).

Regenerating the synthetic labels keeps any other entries in `expected.json`.
