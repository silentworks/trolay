-- Signing in by emailed code replaces the emailed link. A code is six digits typed into the app;
-- only a hash of it is kept (with the row's id as salt), it works once, expires, and is locked
-- after a few wrong tries, since six digits can be guessed far more easily than a link's token.

CREATE TABLE login_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  -- Set when a signed-in user is adding this email to their account, rather than signing in.
  user_id TEXT REFERENCES users (id),
  -- A hash of the requester's address, only to limit how many codes one source can ask for.
  requester TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  -- Wrong guesses so far; the code is dead once it reaches the limit.
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER
);

CREATE INDEX login_codes_email ON login_codes (email, created_at);
CREATE INDEX login_codes_requester ON login_codes (requester, created_at);

-- The emailed links are gone, and so is what they were kept in.
DROP TABLE login_tokens;
