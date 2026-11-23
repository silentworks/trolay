-- Price tag photos kept in the cloud, for an account that turned on "Keep price tag photos in the
-- cloud". The bytes are in R2 under users/<user>/photos/<photo>; a row says whose each one is and
-- which trip it was taken on, so a trip's count can be capped. A kept photo outlives its trip (it
-- is never deleted with one), and goes only when its account is deleted.
CREATE TABLE kept_photos (
  user_id TEXT NOT NULL REFERENCES users (id),
  photo_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, photo_id)
);

CREATE INDEX kept_photos_trip ON kept_photos (user_id, trip_id);
