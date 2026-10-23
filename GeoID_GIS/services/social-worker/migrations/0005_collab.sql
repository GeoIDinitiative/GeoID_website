-- Collaboration depth (v1.3): asking for help, crediting accepted changes,
-- and events people can say they are coming to.
--
-- Apply with:  npx wrangler d1 migrations apply geoid-social --remote
-- (and --local for `wrangler dev`). The tests load this file too.

-- ── Collaboration requests ─────────────────────────────────────────────────
-- "Invite specialists to join a project, review a method, contribute a
-- dataset or validate a model." A member asks -- optionally on behalf of a
-- team -- either named people (audience 'member': only they and the requester
-- can open it) or a community / everybody with the skills listed, in which
-- case it is discoverable at #/requests while it is open.
--
-- kind:     join_project | review_method | contribute_dataset | validate_model | other
-- audience: member | community | everyone
-- status:   open -> accepted | declined -> in_progress -> completed | withdrawn
CREATE TABLE collab_requests (
  id            TEXT PRIMARY KEY,
  requester_id  TEXT NOT NULL REFERENCES users(id),
  kind          TEXT NOT NULL DEFAULT 'other',
  title         TEXT NOT NULL,
  detail        TEXT NOT NULL DEFAULT '',
  skills_json   TEXT NOT NULL DEFAULT '[]',
  audience      TEXT NOT NULL DEFAULT 'member',
  community_id  TEXT,                          -- audience = community
  team_id       TEXT,                          -- asked on behalf of this team
  project_id    TEXT,                          -- the project it is about
  post_id       TEXT,                          -- the post it is about
  due_at        INTEGER,
  status        TEXT NOT NULL DEFAULT 'open',
  conversation_id TEXT,                        -- made (or reused) on the first acceptance
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX collab_requests_open ON collab_requests(status, audience, created_at DESC);
CREATE INDEX collab_requests_requester ON collab_requests(requester_id, created_at DESC);

-- The people on a request. invited = asked by name; offered = volunteered on
-- an open request and waiting for the requester; accepted = helping.
-- acknowledged_at is set when the requester credits the finished work, which
-- also writes a contributions row.
CREATE TABLE collab_participants (
  request_id    TEXT NOT NULL REFERENCES collab_requests(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'invited', -- invited | offered | accepted | declined
  acknowledged_at INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (request_id, user_id)
);
CREATE INDEX collab_participants_user ON collab_participants(user_id, status);

-- What was said on a request: offers, acceptances, notes, progress.
-- kind: message | offer | accept | decline | status
CREATE TABLE collab_responses (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL REFERENCES collab_requests(id),
  author_id     TEXT NOT NULL REFERENCES users(id),
  kind          TEXT NOT NULL DEFAULT 'message',
  body          TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);
CREATE INDEX collab_responses_request ON collab_responses(request_id, created_at);

-- ── Credited contributions ─────────────────────────────────────────────────
-- "Submit corrections and track accepted changes to shared work." One row per
-- piece of credited work: a correction/suggestion comment the post's author
-- accepted (ref_type comment), or a finished request the requester
-- acknowledged (ref_type request). Reputation counts these; the evidence row
-- must still be live for a row to count, so deleting the comment takes the
-- credit with it.
CREATE TABLE contributions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),   -- who is credited
  credited_by   TEXT NOT NULL,                        -- who accepted / acknowledged
  kind          TEXT NOT NULL,                        -- correction | suggestion | request
  ref_type      TEXT NOT NULL,                        -- comment | request
  ref_id        TEXT NOT NULL,
  post_id       TEXT,                                 -- the shared work, when it is a post
  note          TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  UNIQUE (ref_type, ref_id, user_id)
);
CREATE INDEX contributions_user ON contributions(user_id, created_at DESC);
CREATE INDEX contributions_post ON contributions(post_id);

-- A correction or suggestion the post's author has decided on.
-- status: '' (undecided) | accepted | declined
ALTER TABLE comments ADD COLUMN status TEXT NOT NULL DEFAULT '';
ALTER TABLE comments ADD COLUMN status_note TEXT NOT NULL DEFAULT '';
ALTER TABLE comments ADD COLUMN status_at INTEGER;

-- ── Events ─────────────────────────────────────────────────────────────────
-- An RSVP to an event post. status: going | interested | not_going | waitlist
-- (waitlist = asked to go when meta.capacity was full; promoted oldest first).
-- show_me = 1 lets everybody who can see the event see that this person is
-- coming; otherwise only the organiser sees them. reminded_at is set by the
-- reminder pass (events.js dueReminders/markReminded) so each RSVP is
-- reminded once.
CREATE TABLE event_rsvps (
  post_id       TEXT NOT NULL REFERENCES posts(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  status        TEXT NOT NULL,
  show_me       INTEGER NOT NULL DEFAULT 0,
  reminded_at   INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX event_rsvps_user ON event_rsvps(user_id, status);
CREATE INDEX event_rsvps_status ON event_rsvps(post_id, status, created_at);

-- Virtual poster sessions: an attendee submits one of their own posts as a
-- poster on an event whose meta.format is poster-session; the organiser
-- approves it into the gallery. Discussion is the poster post's own comments.
-- status: pending | approved | rejected
CREATE TABLE event_posters (
  event_id      TEXT NOT NULL REFERENCES posts(id),
  post_id       TEXT NOT NULL REFERENCES posts(id),
  submitted_by  TEXT NOT NULL REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'pending',
  note          TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  decided_at    INTEGER,
  PRIMARY KEY (event_id, post_id)
);
CREATE INDEX event_posters_user ON event_posters(submitted_by);
