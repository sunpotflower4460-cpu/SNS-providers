-- Cumulative X OAuth sessions bind intent + expected account identity.
-- Upgrade must not switch X accounts or drop previously granted scopes.

ALTER TABLE x_oauth_sessions ADD COLUMN intent TEXT NOT NULL DEFAULT 'read';
ALTER TABLE x_oauth_sessions ADD COLUMN expected_x_user_id TEXT;

ALTER TABLE x_oauth_tokens ADD COLUMN x_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_x_oauth_sessions_intent ON x_oauth_sessions(intent, created_at);
