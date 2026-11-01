-- A discount off the whole trolley: discount_value is pence or basis points, by discount_kind.
ALTER TABLE trips ADD COLUMN discount_kind TEXT;
ALTER TABLE trips ADD COLUMN discount_value INTEGER;
