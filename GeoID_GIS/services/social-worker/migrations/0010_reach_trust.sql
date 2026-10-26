-- 0010: reach (visibility.js) and trust (trust.js).

-- ── Reach ─────────────────────────────────────────────────────────────────
-- Per post, per day: views in the app (signed-in readers other than the
-- author, once per reader per day), visits to its share page from outside
-- (link previews excluded), and shares. Only the author sees these.
CREATE TABLE post_stats (
  post_id      TEXT NOT NULL,
  day          INTEGER NOT NULL,              -- unix day number
  views        INTEGER NOT NULL DEFAULT 0,
  link_visits  INTEGER NOT NULL DEFAULT 0,
  shares       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, day)
);
-- Which reader already counted today: a hash, so the table does not record who read what.
CREATE TABLE post_seen (
  key   TEXT PRIMARY KEY,                      -- sha256(post_id|user_id|day), truncated
  day   INTEGER NOT NULL
);
CREATE INDEX post_seen_day ON post_seen(day);

-- ── Trust ─────────────────────────────────────────────────────────────────
-- Opportunities from new or unverified accounts that look like recruitment
-- scams wait for a moderator (posts.held_at); the reasons are kept for them.
ALTER TABLE posts ADD COLUMN held_at INTEGER;
ALTER TABLE posts ADD COLUMN held_reasons TEXT NOT NULL DEFAULT '';
