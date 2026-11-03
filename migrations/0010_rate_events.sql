-- Rate limits for requests that need no account, or that would otherwise have no ceiling: one row
-- per request counted, under a key naming what is limited and who for (worker/rate.ts). Rows go
-- once they are older than any limit looks back.
CREATE TABLE rate_events (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX rate_events_key_at ON rate_events (key, at);
CREATE INDEX rate_events_at ON rate_events (at);
