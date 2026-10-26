-- 0011: place pages (places.js) -- a shared page for a location many members
-- study (Etna, the Bárðarbunga system, the Thames estuary), whose storyboard
-- they build together: papers, posts, links and milestones, each weighed by
-- how strong the evidence is and who stands behind it.
CREATE TABLE places (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  world        TEXT NOT NULL DEFAULT 'earth',
  lat          REAL NOT NULL,
  lon          REAL NOT NULL,
  radius_km    INTEGER NOT NULL DEFAULT 50,
  created_by   TEXT NOT NULL REFERENCES users(id),
  commons_json TEXT NOT NULL DEFAULT '[]',     -- Wikimedia Commons photos near it (linked, not stored)
  commons_at   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX places_geo ON places(world, lat, lon);

-- One item on a place's storyboard.
-- kind: paper (a DOI, resolved through Crossref) | post (a Network post) |
--       link (a report, dataset or page) | milestone (a dated note: "2021: 66 lava fountains")
CREATE TABLE place_entries (
  id            TEXT PRIMARY KEY,
  place_id      TEXT NOT NULL REFERENCES places(id),
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  doi           TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL DEFAULT '',
  post_id       TEXT,
  happened_on   TEXT NOT NULL DEFAULT '',      -- "2021", "2021-03", "2021-03-16": where it sits in the story
  peer_reviewed INTEGER NOT NULL DEFAULT 0,    -- Crossref says journal article or proceedings
  venue         TEXT NOT NULL DEFAULT '',
  authors       TEXT NOT NULL DEFAULT '',
  added_by      TEXT NOT NULL REFERENCES users(id),
  removed_at    INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX place_entries_place ON place_entries(place_id, happened_on);
CREATE UNIQUE INDEX place_entries_doi ON place_entries(place_id, doi) WHERE doi != '' AND removed_at IS NULL;

CREATE TABLE place_endorsements (
  entry_id    TEXT NOT NULL REFERENCES place_entries(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (entry_id, user_id)
);
