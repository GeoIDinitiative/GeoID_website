-- v1.3 engagement: email notifications (mail.js) and the scheduled jobs (cron.js).
--
-- A member with no mail_prefs row has the defaults: a daily digest of unread
-- notifications, and immediate mail for messages and invitations. The row is
-- written the first time they change anything, or when they unsubscribe.

CREATE TABLE mail_prefs (
  user_id        TEXT PRIMARY KEY REFERENCES users(id),
  digest         INTEGER NOT NULL DEFAULT 1,              -- daily digest of unread notifications
  immediate_json TEXT NOT NULL DEFAULT '["message","invite"]', -- kinds mailed as they happen
  last_digest_at INTEGER NOT NULL DEFAULT 0,
  unsubscribed_at INTEGER,                                -- set by the one-click link, cleared on any later choice
  updated_at     INTEGER NOT NULL
);

-- notify() puts every notification of a kind that may be mailed at once here;
-- the 15-minute cron decides against the member's preferences and sends.
-- Rows are bookkeeping only: what was mailed is recomposed from the
-- notification at send time, so nothing private is copied into this table.
CREATE TABLE mail_queue (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  kind            TEXT NOT NULL,                     -- the notification kind, or 'digest'
  notification_id TEXT,
  status          TEXT NOT NULL DEFAULT 'queued',    -- queued | sent | skipped | expired | failed
  attempts        INTEGER NOT NULL DEFAULT 0,
  error           TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  sent_at         INTEGER
);
CREATE INDEX mail_queue_status ON mail_queue(status, created_at);
CREATE INDEX mail_queue_user ON mail_queue(user_id, status);
CREATE INDEX mail_queue_notification ON mail_queue(notification_id);
