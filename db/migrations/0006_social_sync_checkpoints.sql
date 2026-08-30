-- Durable inbound checkpoints. A single page is never treated as a completed sync.

CREATE TABLE IF NOT EXISTS social_sync_checkpoints (
  user_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN (
    'x_mentions',
    'x_dm',
    'instagram_comments_poll',
    'instagram_dm'
  )),
  newest_seen_id TEXT,
  continuation_cursor TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}',
  committed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, source)
);

CREATE INDEX IF NOT EXISTS idx_social_sync_checkpoints_updated
  ON social_sync_checkpoints(user_id, updated_at DESC);
