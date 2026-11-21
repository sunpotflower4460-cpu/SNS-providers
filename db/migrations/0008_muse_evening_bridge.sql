-- Worker-owned candidate evidence and drafts, independent of PWA backups.
ALTER TABLE candidates ADD COLUMN platform_user_id TEXT;
ALTER TABLE candidates ADD COLUMN engagement_url TEXT;
ALTER TABLE candidates ADD COLUMN activity_text TEXT;
ALTER TABLE candidates ADD COLUMN strategy TEXT;
ALTER TABLE candidates ADD COLUMN greeting_draft TEXT;

CREATE TABLE IF NOT EXISTS muse_reply_drafts (
  user_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  draft TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, action_id),
  FOREIGN KEY (action_id) REFERENCES social_actions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS muse_refreshes (
  user_id TEXT NOT NULL,
  evening_date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  intake_finished_at TEXT,
  preparation_started_at TEXT,
  finished_at TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, evening_date)
);
