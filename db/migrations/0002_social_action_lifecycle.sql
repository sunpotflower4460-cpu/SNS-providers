-- Server-canonical snooze/dismiss plus execution reservation binding.
-- The runner applies ADD COLUMN idempotently (duplicate-column is success).

ALTER TABLE social_actions ADD COLUMN snoozed_until TEXT;
ALTER TABLE social_actions ADD COLUMN result_metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE social_executions ADD COLUMN reservation_id TEXT;
ALTER TABLE social_executions ADD COLUMN result_metadata_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_social_actions_status ON social_actions(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_executions_reservation ON social_executions(user_id, reservation_id);
