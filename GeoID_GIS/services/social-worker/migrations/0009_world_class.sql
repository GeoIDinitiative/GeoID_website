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

-- ── Saved searches and deadline reminders (jobs.js) ───────────────────────
-- A member's own filters over the external board, with an alert.
CREATE TABLE saved_searches (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,
  query_json   TEXT NOT NULL DEFAULT '{}',    -- {q, field, stage, region, remote, closing}
  alert        TEXT NOT NULL DEFAULT 'daily', -- daily | weekly | off
  last_sent_at INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX saved_searches_user ON saved_searches(user_id);
-- One reminder per saved opportunity before it closes.
CREATE TABLE deadline_reminders (
  user_id  TEXT NOT NULL,
  post_id  TEXT NOT NULL,
  sent_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

-- ── Feedback rounds (rounds.js) ───────────────────────────────────────────
-- Review timed to a real deadline: abstracts before EGU/AGU, CVs and cover
-- letters in studentship season, mock interviews. Authors bring a draft;
-- volunteers are matched to it.
CREATE TABLE feedback_rounds (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,                  -- abstract | cv | cover_letter | mock_interview
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL DEFAULT '',       -- the call it is timed to
  deadline_at INTEGER,                        -- the real deadline (an abstract deadline, a closing date)
  closes_at   INTEGER,                        -- last day to bring a draft
  status      TEXT NOT NULL DEFAULT 'open',   -- open | closed
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE round_volunteers (
  round_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  capacity    INTEGER NOT NULL DEFAULT 2,
  assigned    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (round_id, user_id)
);
CREATE TABLE round_pairs (
  id          TEXT PRIMARY KEY,
  round_id    TEXT NOT NULL,
  mentee_id   TEXT NOT NULL,
  mentor_id   TEXT,                           -- null while waiting for a volunteer
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'waiting',-- waiting | paired | done
  created_at  INTEGER NOT NULL
);
CREATE INDEX round_pairs_round ON round_pairs(round_id, status);
ALTER TABLE reviews ADD COLUMN round_id TEXT;
