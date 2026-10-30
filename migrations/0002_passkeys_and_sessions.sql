-- Sign-in: passkeys (WebAuthn credentials), sessions, and the one-time challenges that make a
-- passkey ceremony safe to replay-check. There are no passwords anywhere.

CREATE TABLE passkeys (
  -- The credential id the authenticator made, base64url.
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  -- The credential's public key, base64url. The private key never leaves the device.
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  -- How the authenticator can be reached (internal, hybrid, usb...), as a JSON array.
  transports TEXT,
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE INDEX passkeys_user ON passkeys (user_id);

-- Only a hash of the session token is kept, so a copy of this table signs nobody in.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_user ON sessions (user_id);

-- Each ceremony starts by saving a random challenge, and finishes by using it up exactly once.
CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  -- Registration: the user the new passkey will belong to (a new id for a new account).
  user_id TEXT,
  expires_at INTEGER NOT NULL
);
