-- A multi-buy offer on an item ("2 for £3.00"): offer_quantity items cost offer_price_minor in all.
ALTER TABLE items ADD COLUMN offer_quantity INTEGER;
ALTER TABLE items ADD COLUMN offer_price_minor INTEGER;
