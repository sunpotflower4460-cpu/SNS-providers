-- Immutable execution fingerprint stored separately from provider result metadata.
-- UNKNOWN reconciliation matches this snapshot, never guessed text/target.

ALTER TABLE social_executions ADD COLUMN fingerprint_json TEXT NOT NULL DEFAULT '{}';
