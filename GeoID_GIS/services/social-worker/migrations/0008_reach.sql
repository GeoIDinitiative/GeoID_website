-- v1.4 reach: shareable files, public pages, Zenodo, office hours, page
-- comments on drafts, and imported opportunities and events.

-- ── Files ────────────────────────────────────────────────────────────────
-- Link cards: what a shared URL is (Dropbox, Drive, OSF, Zenodo...), read once
-- by unfurl and kept a week so a feed does not refetch every card.
CREATE TABLE link_cache (
  url         TEXT PRIMARY KEY,
  card_json   TEXT NOT NULL,
  fetched_at  INTEGER NOT NULL
);

-- ── Public pages ─────────────────────────────────────────────────────────
-- A member's profile is readable by signed-in members; on the open web (a
-- share page Google can index) only if they opt in.
ALTER TABLE users ADD COLUMN public_profile INTEGER NOT NULL DEFAULT 0;

-- ── Weekly email ─────────────────────────────────────────────────────────
-- "New for you this week": opportunities and events in the member's topics,
-- the week's most-saved posts, people working near their study areas. On by
-- default, one click off (the same unsubscribe link as the digest).
ALTER TABLE mail_prefs ADD COLUMN weekly INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mail_prefs ADD COLUMN last_weekly_at INTEGER NOT NULL DEFAULT 0;

-- ── Zenodo ───────────────────────────────────────────────────────────────
-- A member's own Zenodo account, connected by OAuth. The tokens are stored
-- encrypted (AES-GCM, key ZENODO_TOKEN_KEY); the DOI a post was published
-- under is kept on the post's provenance as well as here.
CREATE TABLE zenodo_links (
  user_id        TEXT PRIMARY KEY REFERENCES users(id),
  token_enc      TEXT NOT NULL,
  refresh_enc    TEXT NOT NULL DEFAULT '',
  expires_at     INTEGER NOT NULL DEFAULT 0,
  scope          TEXT NOT NULL DEFAULT '',
  connected_at   INTEGER NOT NULL
);
CREATE TABLE zenodo_deposits (
  id             TEXT PRIMARY KEY,                 -- Zenodo's deposition id
  post_id        TEXT NOT NULL REFERENCES posts(id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL DEFAULT 'draft',    -- draft | published
  doi            TEXT NOT NULL DEFAULT '',
  url            TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX zenodo_deposits_post ON zenodo_deposits(post_id);

-- ── Office hours ─────────────────────────────────────────────────────────
-- A mentor's bookable slots; one mentee per slot.
CREATE TABLE mentor_slots (
  id          TEXT PRIMARY KEY,
  mentor_id   TEXT NOT NULL REFERENCES users(id),
  starts_at   INTEGER NOT NULL,
  minutes     INTEGER NOT NULL DEFAULT 30,
  topic       TEXT NOT NULL DEFAULT '',
  where_text  TEXT NOT NULL DEFAULT '',            -- a video link, or "message me"
  booked_by   TEXT REFERENCES users(id),
  booked_at   INTEGER,
  note        TEXT NOT NULL DEFAULT '',            -- the mentee's line on what they want
  status      TEXT NOT NULL DEFAULT 'open',        -- open | booked | cancelled
  created_at  INTEGER NOT NULL
);
CREATE INDEX mentor_slots_mentor ON mentor_slots(mentor_id, starts_at);
CREATE INDEX mentor_slots_booked ON mentor_slots(booked_by, starts_at);
-- The 30-day check-in on an accepted mentoring pair, sent once.
ALTER TABLE mentoring_requests ADD COLUMN checkin_sent_at INTEGER;

-- ── Page comments on drafts ──────────────────────────────────────────────
-- A comment pinned to a place on the draft PDF: the page, a point on it
-- (0..1 of its width and height) and, if text was selected, the quote.
ALTER TABLE review_comments ADD COLUMN page INTEGER;
ALTER TABLE review_comments ADD COLUMN x REAL;
ALTER TABLE review_comments ADD COLUMN y REAL;
ALTER TABLE review_comments ADD COLUMN quote TEXT NOT NULL DEFAULT '';

-- ── Imported opportunities and events ────────────────────────────────────
-- The Atlas Career Scanner's model, run on the Worker: each source is a
-- careers page or a calendar, read on a rota by the 15-minute cron; every
-- posting it lists is scored against geoscience keywords, and what passes is
-- posted under the Network's own account with the source credited and linked.
CREATE TABLE import_sources (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,                   -- jobs | events
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  grp             TEXT NOT NULL DEFAULT '',
  platform        TEXT NOT NULL DEFAULT '',        -- the adapter that last answered
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_run_at     INTEGER NOT NULL DEFAULT 0,
  last_count      INTEGER NOT NULL DEFAULT 0,      -- postings the source listed
  last_new        INTEGER NOT NULL DEFAULT 0,      -- of those, posted for the first time
  ever_yielded    INTEGER NOT NULL DEFAULT 0,
  consecutive_empty INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT NOT NULL DEFAULT ''
);
CREATE TABLE imported (
  url_key       TEXT PRIMARY KEY,                  -- the posting's canonical URL
  source_id     TEXT NOT NULL REFERENCES import_sources(id),
  post_id       TEXT REFERENCES posts(id),         -- null when it scored too low to post
  score         INTEGER NOT NULL DEFAULT 0,
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL,
  gone_at       INTEGER                            -- the source stopped listing it
);
CREATE INDEX imported_source ON imported(source_id, last_seen);
