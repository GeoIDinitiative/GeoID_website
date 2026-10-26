-- 0009: what makes the Network worth coming back to.
--   event rooms        a room for each significant earthquake, eruption, flood, cyclone, wildfire, drought
--   profile import     ORCID + OpenAlex: works, topics, co-authors
--   saved searches     personal job filters with alerts; deadline reminders
--   feedback rounds    abstract, CV and cover-letter review against real deadlines; mock-interview pairs
--   conferences        who's going, sessions and posters, meet-ups
--   reach              per-post views and shares, for the author
--   trust              held opportunities, conduct

-- ── Event rooms ──────────────────────────────────────────────────────────
-- Opened by the cron (rooms.js) from the USGS significant-earthquake feed and
-- GDACS orange/red alerts, or by an admin. A room's thread is the posts that
-- name it (posts.room_id).
CREATE TABLE rooms (
  id           TEXT PRIMARY KEY,
  source       TEXT NOT NULL,                  -- usgs | gdacs | manual
  source_id    TEXT NOT NULL,                  -- the feed's own id
  kind         TEXT NOT NULL,                  -- earthquake | cyclone | flood | volcano | wildfire | drought
  title        TEXT NOT NULL,
  place        TEXT NOT NULL DEFAULT '',
  lat          REAL,
  lon          REAL,
  severity     TEXT NOT NULL DEFAULT '',       -- "M 6.9", "194 km/h", "Red alert"
  alert        TEXT NOT NULL DEFAULT '',       -- green | yellow | orange | red
  source_url   TEXT NOT NULL DEFAULT '',
  data_json    TEXT NOT NULL DEFAULT '{}',     -- what the feed said, for the facts panel
  papers_json  TEXT NOT NULL DEFAULT '[]',     -- OpenAlex works about the place and hazard
  papers_at    INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'active', -- active | archived
  started_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX rooms_source ON rooms(source, source_id);
CREATE INDEX rooms_status ON rooms(status, started_at);
ALTER TABLE posts ADD COLUMN room_id TEXT;
CREATE INDEX posts_room ON posts(room_id, created_at);

-- ── Profile import (scholar.js) ───────────────────────────────────────────
-- OpenAlex's author record behind a member's ORCID iD: works, citations,
-- h-index and topics, read on the member's request. Imported works become
-- profile items (source = 'openalex'); verified only when the ORCID iD is.
ALTER TABLE users ADD COLUMN openalex_id TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN scholar_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE profile_items ADD COLUMN source TEXT NOT NULL DEFAULT '';
CREATE INDEX users_orcid ON users(orcid);
