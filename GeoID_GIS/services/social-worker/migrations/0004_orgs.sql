-- Identity and institutions: organisations, verified affiliations, checked
-- publications, mentoring and the first-run welcome.
--
-- THE EMAIL STAYS PRIVATE. An affiliation is "verified" when the member's
-- sign-in address ends in one of a verified organisation's domains. That test
-- runs in orgs.js against users.email and its only output is the 0/1 below:
-- neither the address nor its domain is stored anywhere else or returned.

-- kind: university | survey | company | agency | nonprofit | other
-- An organisation starts unverified (anybody signed in may propose one) and a
-- site admin verifies it. Once verified, its name and domains are locked to
-- site admins, because the domains are what make affiliations verified.
CREATE TABLE orgs (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'other',
  description  TEXT NOT NULL DEFAULT '',
  website      TEXT NOT NULL DEFAULT '',
  logo_key     TEXT NOT NULL DEFAULT '',           -- public media key
  domains_json TEXT NOT NULL DEFAULT '[]',         -- ["leeds.ac.uk"]; subdomains count
  location     TEXT NOT NULL DEFAULT '',           -- free text, never coordinates
  verified     INTEGER NOT NULL DEFAULT 0,
  verified_by  TEXT,
  verified_at  INTEGER,
  created_by   TEXT REFERENCES users(id),
  member_count INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  removed_at   INTEGER
);
CREATE INDEX orgs_name ON orgs(verified DESC, name);

-- The domains again as rows, so "which verified orgs own this address" is an
-- index hit over the address's suffixes rather than a scan of every org.
CREATE TABLE org_domains (
  domain  TEXT NOT NULL,
  org_id  TEXT NOT NULL REFERENCES orgs(id),
  PRIMARY KEY (domain, org_id)
);

-- A member's affiliation. role: admin | member. `verified` is computed (the
-- domain test above, and only while the org is verified), never sent.
CREATE TABLE org_members (
  org_id     TEXT NOT NULL REFERENCES orgs(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL DEFAULT 'member',
  verified   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX org_members_user ON org_members(user_id);

-- The affiliation a member shows on cards, copied onto the users row so
-- publicUser() can draw it without a join on every list. orgs.js keeps the
-- copy in step (join, leave, rename, verify, removal, erasure).
ALTER TABLE users ADD COLUMN aff_org_id TEXT;
ALTER TABLE users ADD COLUMN aff_slug TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN aff_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN aff_verified INTEGER NOT NULL DEFAULT 0;

-- Mentoring: an opt-in flag and the topics a member will mentor on.
ALTER TABLE users ADD COLUMN mentoring_open INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mentoring_topics_json TEXT NOT NULL DEFAULT '[]';

-- The welcome wizard: when it was finished or skipped (0 = never). Kept on
-- the server so dismissing it on one device dismisses it everywhere.
ALTER TABLE users ADD COLUMN onboarding_done INTEGER NOT NULL DEFAULT 0;

-- An opportunity posted "as" an organisation by one of its admins. Slug and
-- name are copied for the card; only orgs.js writes these three, so a post's
-- author cannot attach an organisation by editing the post.
ALTER TABLE posts ADD COLUMN org_id TEXT;
ALTER TABLE posts ADD COLUMN org_slug TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN org_name TEXT NOT NULL DEFAULT '';
CREATE INDEX posts_org ON posts(org_id, created_at DESC);

-- What was checked when a portfolio item was verified, so the evidence can be
-- shown and re-read. One row per check; the newest is the item's evidence.
-- outcome: verified | not-found | name-mismatch | error
CREATE TABLE item_verifications (
  id             TEXT PRIMARY KEY,
  item_id        TEXT NOT NULL,
  user_id        TEXT NOT NULL REFERENCES users(id),
  source         TEXT NOT NULL DEFAULT 'crossref',
  doi            TEXT NOT NULL,
  name_checked   TEXT NOT NULL DEFAULT '',       -- the member's name as compared
  resolved       INTEGER NOT NULL DEFAULT 0,
  matched        INTEGER NOT NULL DEFAULT 0,
  matched_author TEXT NOT NULL DEFAULT '',       -- "Smith, J." as the record has it
  work_title     TEXT NOT NULL DEFAULT '',
  container      TEXT NOT NULL DEFAULT '',       -- journal
  year           INTEGER,
  authors_json   TEXT NOT NULL DEFAULT '[]',     -- first authors on the record
  outcome        TEXT NOT NULL,
  checked_at     INTEGER NOT NULL
);
CREATE INDEX item_verifications_item ON item_verifications(item_id, checked_at DESC);

-- Mentoring requests. status: requested | active | declined | withdrawn | ended
-- An accepted request opens a conversation between the two.
CREATE TABLE mentoring_requests (
  id              TEXT PRIMARY KEY,
  mentee_id       TEXT NOT NULL REFERENCES users(id),
  mentor_id       TEXT NOT NULL REFERENCES users(id),
  topic           TEXT NOT NULL DEFAULT '',
  message         TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'requested',
  conversation_id TEXT,
  created_at      INTEGER NOT NULL,
  responded_at    INTEGER,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX mentoring_mentor ON mentoring_requests(mentor_id, status);
CREATE INDEX mentoring_mentee ON mentoring_requests(mentee_id, status);
