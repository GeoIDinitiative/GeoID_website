-- Study areas: where a member works, declared on their profile, so the map
-- can show the distribution of interest -- where scientists cluster, and
-- what is gaining attention -- and not only where somebody happened to post.
--
-- Stored already rounded (approx 0.1 deg, region 1 deg; lib.js snapLocation),
-- like post locations: the precision a member chose is the only one that
-- exists. on_map = 0 keeps an area on the profile and off the map.
CREATE TABLE study_areas (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  world       TEXT NOT NULL DEFAULT 'earth',
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  loc_precision TEXT NOT NULL DEFAULT 'approx', -- approx | region
  radius_km   INTEGER NOT NULL DEFAULT 50,
  tags_json   TEXT NOT NULL DEFAULT '[]',
  on_map      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);
CREATE INDEX study_areas_user ON study_areas(user_id);
CREATE INDEX study_areas_geo ON study_areas(world, lat, lon);
