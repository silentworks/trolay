-- The sync database: one account's stores, trips and items, as the app's own records.
-- Every synced table carries the same sync columns as the app's IndexedDB records:
-- updated_at (ms since the epoch), updated_by (a user id) and deleted_at (a tombstone, so a
-- delete reaches the other devices instead of vanishing). Booleans are 0 or 1; amounts are
-- integer pence; ids are the UUIDs the app makes on the device.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER
);

CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id),
  name TEXT NOT NULL,
  branch TEXT,
  tax_rate_bps INTEGER NOT NULL,
  prices_include_tax INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER
);

CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id),
  store_id TEXT NOT NULL REFERENCES stores (id),
  status TEXT NOT NULL CHECK (status IN ('open', 'finished')),
  budget_minor INTEGER,
  receipt_total_minor INTEGER,
  photos_kept INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  -- The totals snapshot taken at finish, as JSON.
  totals TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER
);

-- Who may see a trip. The owner has a row too, so access is one lookup.
CREATE TABLE trip_members (
  trip_id TEXT NOT NULL REFERENCES trips (id),
  user_id TEXT NOT NULL REFERENCES users (id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'partner')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  PRIMARY KEY (trip_id, user_id)
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips (id),
  description TEXT NOT NULL,
  barcode TEXT,
  unit_price_minor INTEGER NOT NULL,
  price_includes_tax INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  photo_id TEXT,
  -- What the label reader extracted, as JSON, so an edited item can be reverted.
  extracted TEXT,
  edited INTEGER NOT NULL DEFAULT 0,
  added_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER
);

-- Pulling changes asks for rows changed after a point in time.
CREATE INDEX stores_owner_updated ON stores (owner_id, updated_at);
CREATE INDEX trips_owner_updated ON trips (owner_id, updated_at);
CREATE INDEX trips_store ON trips (store_id);
CREATE INDEX trip_members_user ON trip_members (user_id, updated_at);
CREATE INDEX items_trip_updated ON items (trip_id, updated_at);
