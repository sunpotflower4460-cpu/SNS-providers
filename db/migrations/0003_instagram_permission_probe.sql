-- Cached Instagram permission probe results. Tokens are never stored here.

CREATE TABLE IF NOT EXISTS instagram_permission_probes (
  user_id TEXT PRIMARY KEY,
  checked_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  permissions_verified INTEGER NOT NULL DEFAULT 0 CHECK(permissions_verified IN (0,1))
);
