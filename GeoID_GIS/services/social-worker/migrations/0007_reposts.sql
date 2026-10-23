-- Reshares: one member passing another's public post to their own followers,
-- with an optional line of their own (a "quote"). One live reshare per
-- member per post; un-resharing sets removed_at so a re-reshare is a fresh
-- row with a fresh time, which is what moves it up their followers' feeds.
CREATE TABLE reposts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  post_id     TEXT NOT NULL REFERENCES posts(id),
  note        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  removed_at  INTEGER
);
CREATE INDEX reposts_user ON reposts(user_id, created_at DESC);
CREATE INDEX reposts_post ON reposts(post_id);
CREATE UNIQUE INDEX reposts_live ON reposts(user_id, post_id) WHERE removed_at IS NULL;

ALTER TABLE posts ADD COLUMN repost_count INTEGER NOT NULL DEFAULT 0;
