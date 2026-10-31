-- Inviting a partner to a trip. A link carries a random token; only its hash is kept here, so a
-- copy of this table lets nobody in. A token is used up by the one person who accepts it.

CREATE TABLE trip_invites (
  token_hash TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips (id),
  inviter_id TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  accepted_by TEXT REFERENCES users (id)
);

CREATE INDEX trip_invites_trip ON trip_invites (trip_id);
CREATE INDEX trip_invites_inviter ON trip_invites (inviter_id, created_at);

-- A trip has at most one partner (the owner is the other member). The database holds the line, so
-- two people accepting at once cannot both get in.
CREATE UNIQUE INDEX trip_members_one_partner ON trip_members (trip_id)
  WHERE role = 'partner' AND deleted_at IS NULL;
