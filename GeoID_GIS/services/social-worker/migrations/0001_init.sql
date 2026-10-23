-- GeoHUB Social, the first schema.
--
-- Apply with:  npx wrangler d1 migrations apply geoid-social --remote
-- (and --local for `wrangler dev`). The tests load this same file into
-- node:sqlite, so what is tested is what is deployed.
--
-- CONVENTIONS
--   * ids are TEXT with a type prefix (u_, p_, c_ ...) minted by lib.js id().
--   * times are INTEGER epoch SECONDS.
--   * JSON columns are TEXT holding JSON, named *_json, parsed in lib.js.
--   * Nothing is hard-deleted by a user action: `removed_at` hides a row, so a
--     moderator can see what was reported after the author deletes it.
--   * An email address is stored to join the session to a user and is NEVER
--     returned by any route. The public key of a person is their handle.

PRAGMA foreign_keys = ON;

-- ── People ──────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,          -- private: join key only
  handle        TEXT NOT NULL UNIQUE,          -- public: a-z0-9_ 3..30
  name          TEXT NOT NULL DEFAULT '',
  headline      TEXT NOT NULL DEFAULT '',      -- "Volcanologist · GIS developer"
  bio           TEXT NOT NULL DEFAULT '',
  institution   TEXT NOT NULL DEFAULT '',
  location      TEXT NOT NULL DEFAULT '',      -- free text, never coordinates
  website       TEXT NOT NULL DEFAULT '',
  orcid         TEXT NOT NULL DEFAULT '',      -- 0000-0000-0000-0000
  orcid_verified INTEGER NOT NULL DEFAULT 0,   -- 1 only after ORCID OAuth
  avatar_key    TEXT NOT NULL DEFAULT '',      -- R2 key in MEDIA
  skills_json   TEXT NOT NULL DEFAULT '[]',    -- self-declared, ["insar","python"]
  interests_json TEXT NOT NULL DEFAULT '[]',   -- topic tags
  regions_json  TEXT NOT NULL DEFAULT '[]',    -- regions of expertise, free text
  availability  TEXT NOT NULL DEFAULT 'closed',-- open | limited | closed (collaboration)
  job_status    TEXT NOT NULL DEFAULT '',      -- '' | seeking | hiring | consulting
  contact_pref  TEXT NOT NULL DEFAULT 'followers', -- anyone | followers | nobody
  match_opt_in  INTEGER NOT NULL DEFAULT 0,    -- collaboration matcher is opt-in
  plan          TEXT NOT NULL DEFAULT 'explorer', -- copied from the token, display only
  role          TEXT NOT NULL DEFAULT 'user',  -- user | admin (admins also from env.ADMINS)
  suspended_until INTEGER NOT NULL DEFAULT 0,
  notify_json   TEXT NOT NULL DEFAULT '{}',    -- per-kind notification prefs
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Portfolio entries: publication | dataset | education | experience |
-- credential | repository | award. `verified` is set only by a process that
-- checked it (DOI resolution, ORCID import, an admin) and is shown apart from
-- self-declared entries, as the blueprint asks.
CREATE TABLE profile_items (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  doi         TEXT NOT NULL DEFAULT '',
  year        INTEGER,
  verified    INTEGER NOT NULL DEFAULT 0,
  visibility  TEXT NOT NULL DEFAULT 'public', -- public | unlisted | private
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX profile_items_user ON profile_items(user_id, sort);

-- Follow anything: a person, project, topic tag, place, dataset or community.
-- target_type: user | project | tag | place | community | post
-- A place is "lat,lon,radius_km" rounded, so following Etna is one row.
CREATE TABLE follows (
  follower_id  TEXT NOT NULL REFERENCES users(id),
  target_type  TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (follower_id, target_type, target_id)
);
CREATE INDEX follows_target ON follows(target_type, target_id);

CREATE TABLE blocks (
  user_id     TEXT NOT NULL REFERENCES users(id),
  blocked_id  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, blocked_id)
);

-- ── Content ────────────────────────────────────────────────────────────────

-- One table for every kind of post, because the feed, map, search, comments,
-- reactions and moderation are the same for all of them and differ only in
-- `meta_json`. kind:
--   text | scene | analysis | monitor | observation | workflow | dataset |
--   paper | question | discussion | event | opportunity | challenge
CREATE TABLE posts (
  id            TEXT PRIMARY KEY,
  author_id     TEXT NOT NULL REFERENCES users(id),
  kind          TEXT NOT NULL DEFAULT 'text',
  title         TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL DEFAULT '',
  tags_json     TEXT NOT NULL DEFAULT '[]',
  -- Location as STORED is already what the author chose to reveal: lib.js
  -- snaps it before insert (approx 0.1 deg, region 1 deg, hidden NULL), so no
  -- route can leak a precision the author did not publish.
  lat           REAL,
  lon           REAL,
  loc_precision TEXT NOT NULL DEFAULT 'hidden', -- exact | approx | region | hidden
  place_name    TEXT NOT NULL DEFAULT '',
  world         TEXT NOT NULL DEFAULT 'earth', -- earth | moon | mars | ...
  scene_json    TEXT,                          -- {world, camera, layers, annotations, time}
  media_json    TEXT NOT NULL DEFAULT '[]',    -- [{key, type, alt}]
  links_json    TEXT NOT NULL DEFAULT '[]',    -- [{url, label}]
  licence       TEXT NOT NULL DEFAULT 'CC-BY-4.0', -- SPDX id, or 'all-rights-reserved'
  provenance    TEXT NOT NULL DEFAULT 'observed', -- observed | derived | modelled | forecast | ai | unverified
  sources_json  TEXT NOT NULL DEFAULT '[]',    -- [{label, url, doi, licence}]
  method_json   TEXT NOT NULL DEFAULT '{}',    -- {software, version, params, steps}
  limitations   TEXT NOT NULL DEFAULT '',
  meta_json     TEXT NOT NULL DEFAULT '{}',    -- kind-specific, see CONTRACT.md
  visibility    TEXT NOT NULL DEFAULT 'public', -- public | unlisted | followers | team | community | private
  team_id       TEXT,                          -- when visibility = team
  community_id  TEXT,                          -- the community it was posted in
  project_id    TEXT,                          -- the project it belongs to
  allow_fork    INTEGER NOT NULL DEFAULT 1,
  forked_from   TEXT,                          -- post id
  sponsored_by  TEXT NOT NULL DEFAULT '',      -- challenges: shown as a label, always
  accepted_comment_id TEXT,                    -- questions
  pinned        INTEGER NOT NULL DEFAULT 0,    -- pinned in its community
  reaction_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  fork_count    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  removed_at    INTEGER,
  removed_by    TEXT
);
CREATE INDEX posts_created ON posts(created_at DESC);
CREATE INDEX posts_author ON posts(author_id, created_at DESC);
CREATE INDEX posts_community ON posts(community_id, created_at DESC);
CREATE INDEX posts_project ON posts(project_id, created_at DESC);
CREATE INDEX posts_kind ON posts(kind, created_at DESC);
CREATE INDEX posts_geo ON posts(world, lat, lon);

-- Tags as rows as well as JSON, so "posts tagged volcanology" is an index hit.
CREATE TABLE post_tags (
  post_id  TEXT NOT NULL REFERENCES posts(id),
  tag      TEXT NOT NULL,
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX post_tags_tag ON post_tags(tag);

CREATE TABLE comments (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES posts(id),
  author_id   TEXT NOT NULL REFERENCES users(id),
  parent_id   TEXT,
  body        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'comment', -- comment | correction | suggestion
  lat         REAL,                            -- comment on a place in a scene
  lon         REAL,
  created_at  INTEGER NOT NULL,
  removed_at  INTEGER
);
CREATE INDEX comments_post ON comments(post_id, created_at);

-- kind: like | insightful | reproduced | useful
CREATE TABLE reactions (
  post_id     TEXT NOT NULL REFERENCES posts(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL DEFAULT 'like',
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id, kind)
);

CREATE TABLE bookmarks (
  user_id     TEXT NOT NULL REFERENCES users(id),
  post_id     TEXT NOT NULL REFERENCES posts(id),
  collection  TEXT NOT NULL DEFAULT 'Saved',
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

-- Field observations: other people confirm or dispute. A post is shown as
-- "community-verified" when confirms >= 2 and confirms > disputes.
CREATE TABLE verifications (
  post_id     TEXT NOT NULL REFERENCES posts(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  verdict     TEXT NOT NULL,                   -- confirm | dispute
  note        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

-- Uploaded files. The bytes are in R2 (MEDIA); this row is who may read them.
-- scope: public (anyone) | owner | review:<id> | team:<id> | conversation:<id>
CREATE TABLE media (
  key         TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  scope       TEXT NOT NULL DEFAULT 'public',
  created_at  INTEGER NOT NULL
);

-- ── Groups ─────────────────────────────────────────────────────────────────

-- visibility: open (anyone joins) | approval (request) | private (invite, hidden)
CREATE TABLE communities (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rules       TEXT NOT NULL DEFAULT '',
  faq_json    TEXT NOT NULL DEFAULT '[]',      -- [{q, a}]
  resources_json TEXT NOT NULL DEFAULT '[]',   -- pinned links [{label, url}]
  tags_json   TEXT NOT NULL DEFAULT '[]',
  visibility  TEXT NOT NULL DEFAULT 'open',
  parent_id   TEXT,                            -- a private channel inside a community
  created_by  TEXT REFERENCES users(id),
  member_count INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

-- role: owner | moderator | member ; status: active | requested | invited | banned
CREATE TABLE community_members (
  community_id TEXT NOT NULL REFERENCES communities(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  role         TEXT NOT NULL DEFAULT 'member',
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX community_members_user ON community_members(user_id);

-- Research teams: a shared space with roles, tasks and a team conversation.
CREATE TABLE teams (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  visibility  TEXT NOT NULL DEFAULT 'private', -- public (listed) | private
  conversation_id TEXT,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL
);

-- role: lead | editor | member | viewer ; status: active | invited | requested
CREATE TABLE team_members (
  team_id     TEXT NOT NULL REFERENCES teams(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL DEFAULT 'member',
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user ON team_members(user_id);

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams(id),
  project_id  TEXT,
  title       TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'todo',    -- todo | doing | done
  assignee_id TEXT,
  due_at      INTEGER,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX tasks_team ON tasks(team_id, status);

-- ── Projects: the shareable scientific object ──────────────────────────────
--
-- A project starts as a post and can grow into an analysis, a team workspace
-- and a twin without moving. Its WORKSPACE is the GeoHUB project manifest
-- (layers by reference, camera, AOI, parameters) -- never the datasets
-- themselves, which stay at their source or on the owner's disk.
-- stage: idea | analysis | workspace | twin
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  team_id     TEXT,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  stage       TEXT NOT NULL DEFAULT 'idea',
  world       TEXT NOT NULL DEFAULT 'earth',
  lat         REAL,
  lon         REAL,
  loc_precision TEXT NOT NULL DEFAULT 'approx',
  tags_json   TEXT NOT NULL DEFAULT '[]',
  licence     TEXT NOT NULL DEFAULT 'CC-BY-4.0',
  visibility  TEXT NOT NULL DEFAULT 'private', -- public | unlisted | team | private
  allow_fork  INTEGER NOT NULL DEFAULT 0,
  forked_from TEXT,
  needs_skills_json TEXT NOT NULL DEFAULT '[]',-- for the collaboration matcher
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  removed_at  INTEGER
);
CREATE INDEX projects_owner ON projects(owner_id);

CREATE TABLE project_versions (
  project_id  TEXT NOT NULL REFERENCES projects(id),
  version     INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,                 -- the GeoHUB workspace, by reference
  note        TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (project_id, version)
);

-- A professor shares a workspace with a student, a team, or a reviewer.
-- grantee_type: user | team ; role: viewer | commenter | editor | forker
CREATE TABLE grants (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id),
  grantee_type TEXT NOT NULL,
  grantee_id   TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'viewer',
  granted_by   TEXT NOT NULL,
  expires_at   INTEGER,                        -- NULL = until revoked
  created_at   INTEGER NOT NULL
);
CREATE INDEX grants_project ON grants(project_id);
CREATE INDEX grants_grantee ON grants(grantee_type, grantee_id);

-- ── Peer review of drafts ──────────────────────────────────────────────────
-- visibility: private (invited reviewers only) | team | community | open
-- status: open | closed
CREATE TABLE reviews (
  id          TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  abstract    TEXT NOT NULL DEFAULT '',
  doc_key     TEXT NOT NULL DEFAULT '',        -- media key (PDF), scope review:<id>
  doc_url     TEXT NOT NULL DEFAULT '',        -- or a link (Overleaf, preprint)
  expertise_json TEXT NOT NULL DEFAULT '[]',
  visibility  TEXT NOT NULL DEFAULT 'private',
  team_id     TEXT,
  community_id TEXT,
  project_id  TEXT,
  due_at      INTEGER,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- status: invited | accepted | declined | submitted | volunteered
CREATE TABLE reviewers (
  review_id   TEXT NOT NULL REFERENCES reviews(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL DEFAULT 'invited',
  recommendation TEXT NOT NULL DEFAULT '',     -- accept | minor | major | reject | ''
  summary     TEXT NOT NULL DEFAULT '',
  submitted_at INTEGER,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (review_id, user_id)
);

-- severity: general | major | minor | typo ; anchor: "p3 l120" / "Sec 2.1"
CREATE TABLE review_comments (
  id          TEXT PRIMARY KEY,
  review_id   TEXT NOT NULL REFERENCES reviews(id),
  author_id   TEXT NOT NULL REFERENCES users(id),
  parent_id   TEXT,
  anchor      TEXT NOT NULL DEFAULT '',
  severity    TEXT NOT NULL DEFAULT 'general',
  body        TEXT NOT NULL,
  resolved    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX review_comments_review ON review_comments(review_id, created_at);

-- ── Messages ───────────────────────────────────────────────────────────────
-- kind: dm | group | team ; a dm to somebody whose contact_pref does not admit
-- the sender starts as status 'request' for the recipient.
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL DEFAULT 'dm',
  title       TEXT NOT NULL DEFAULT '',
  team_id     TEXT,
  project_id  TEXT,
  created_by  TEXT NOT NULL,
  last_at     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

-- status: active | request | left ; last_read = epoch of last read message
CREATE TABLE conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL DEFAULT 'active',
  last_read   INTEGER NOT NULL DEFAULT 0,
  muted       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user ON conversation_members(user_id);

CREATE TABLE messages (
  id          TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  sender_id   TEXT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  media_json  TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  removed_at  INTEGER
);
CREATE INDEX messages_conv ON messages(conversation_id, created_at);

-- ── Reach and safety ───────────────────────────────────────────────────────

CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,                   -- follow | comment | reaction | mention | invite | grant | review | message | fork | verify | moderation | badge | project_update
  actor_id    TEXT,
  ref_type    TEXT NOT NULL DEFAULT '',
  ref_id      TEXT NOT NULL DEFAULT '',
  text        TEXT NOT NULL DEFAULT '',
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX notifications_user ON notifications(user_id, read, created_at DESC);

-- target_type: post | comment | user | message | community | review | badge
-- kind: report | appeal ; status: open | actioned | dismissed
CREATE TABLE reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL DEFAULT 'report',
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  reason      TEXT NOT NULL,                   -- spam | harassment | misinformation | privacy | copyright | unsafe-location | other
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',
  resolution  TEXT NOT NULL DEFAULT '',
  handled_by  TEXT,
  created_at  INTEGER NOT NULL,
  handled_at  INTEGER
);
CREATE INDEX reports_status ON reports(status, created_at);

-- Audit trail of every moderator action and every grant change.
CREATE TABLE audit (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  ref_type    TEXT NOT NULL,
  ref_id      TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);

-- Awarded badges. Criteria live in code (reputation.js BADGES) so they are
-- published, and an award records the evidence it was given for.
CREATE TABLE badges (
  user_id     TEXT NOT NULL REFERENCES users(id),
  badge       TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  awarded_at  INTEGER NOT NULL,
  revoked_at  INTEGER,
  PRIMARY KEY (user_id, badge)
);

-- Writes per user per minute. Pruned opportunistically.
CREATE TABLE rate (
  user_id  TEXT NOT NULL,
  minute   INTEGER NOT NULL,
  n        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, minute)
);

-- ── Seed: the nine communities the blueprint names ─────────────────────────
INSERT INTO communities (id, slug, name, description, tags_json, visibility, created_at) VALUES
 ('cm_volcanology','volcanology','Volcanology','Monitoring data, deformation, eruptions and numerical models.','["volcanology","deformation","insar"]','open',0),
 ('cm_landslides','landslides','Landslides and slope processes','Field observations, inventories, susceptibility models and runout simulations.','["landslides","slope-stability","susceptibility"]','open',0),
 ('cm_floods','floods','Floods and hydrology','Rainfall-runoff models, flood maps and catchment studies.','["floods","hydrology","rainfall"]','open',0),
 ('cm_eo','earth-observation','Earth observation','Satellite workflows, change detection and image interpretation.','["earth-observation","sentinel","landsat","sar"]','open',0),
 ('cm_climate','climate-risk','Climate risk','Exposure, vulnerability, scenarios and adaptation.','["climate","risk","adaptation"]','open',0),
 ('cm_geoai','gis-geoai','GIS and GeoAI','Code, automation, spatial agents and data pipelines.','["gis","geoai","python"]','open',0),
 ('cm_planetary','planetary','Planetary science','Planetary datasets, mission observations and geological mapping.','["planetary","mars","moon"]','open',0),
 ('cm_twins','digital-twins','Digital twins','Twin templates, simulation methods and real-world applications.','["digital-twin","simulation"]','open',0),
 ('cm_careers','careers','Career and education','Jobs, research opportunities, training and mentoring.','["careers","education","mentoring"]','open',0);
