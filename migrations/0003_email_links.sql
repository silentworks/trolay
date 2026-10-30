-- Emailed sign-in links. A link carries a random token; only its hash is kept here, so a copy of
-- this table signs nobody in. A token is used up by its first (and only) successful use.

CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  -- Set when a signed-in user is adding this email to their account, rather than signing in.
  user_id TEXT REFERENCES users (id),
  -- A hash of the requester's address, only to limit how many links one source can ask for.
  requester TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX login_tokens_email ON login_tokens (email, created_at);
CREATE INDEX login_tokens_requester ON login_tokens (requester, created_at);
