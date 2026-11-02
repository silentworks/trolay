-- The currency amounts at a store are shown in, as an ISO 4217 code ("EUR"); NULL shows pounds.
ALTER TABLE stores ADD COLUMN currency TEXT;
