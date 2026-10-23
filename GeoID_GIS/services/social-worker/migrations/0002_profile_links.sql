-- A LinkedIn link on a profile, optional. Kept in its own column rather than
-- in `website` so a profile can carry both, and so the page can label it.
ALTER TABLE users ADD COLUMN linkedin TEXT NOT NULL DEFAULT '';
