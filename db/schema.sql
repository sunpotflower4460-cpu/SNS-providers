PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  primary_goal TEXT NOT NULL,
  secondary_goals_json TEXT NOT NULL DEFAULT '[]',
  communication_dna TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS social_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('x','instagram')),
  username TEXT NOT NULL,
  profile_url TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, platform, username)
);

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('x','instagram')),
  username TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  profile_url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  mission_match INTEGER NOT NULL DEFAULT 0 CHECK(mission_match BETWEEN 0 AND 100),
  relationship_score INTEGER NOT NULL DEFAULT 0 CHECK(relationship_score BETWEEN 0 AND 100),
  stage TEXT NOT NULL DEFAULT 'discovered',
  reason TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  recommended_action TEXT NOT NULL DEFAULT 'review',
  followed_at TEXT,
  follow_back INTEGER CHECK(follow_back IS NULL OR follow_back IN (0,1)),
  last_interaction_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  source_fingerprint TEXT,
  skipped INTEGER NOT NULL DEFAULT 0 CHECK(skipped IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, platform, username)
);

CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS self_insights (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  priority TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS daily_queue (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  queue_date TEXT NOT NULL,
  candidate_id TEXT,
  action TEXT NOT NULL,
  rank INTEGER NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS budget_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0 CHECK(cost_usd >= 0),
  input_units INTEGER NOT NULL DEFAULT 0 CHECK(input_units >= 0),
  output_units INTEGER NOT NULL DEFAULT 0 CHECK(output_units >= 0),
  cache_hit INTEGER NOT NULL DEFAULT 0 CHECK(cache_hit IN (0,1)),
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS state_snapshots (
  user_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS x_oauth_sessions (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS x_oauth_tokens (
  user_id TEXT PRIMARY KEY,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  expires_at TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS x_owned_snapshots (
  user_id TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS x_owned_paging (
  user_id TEXT PRIMARY KEY,
  followers_cursor TEXT,
  following_cursor TEXT,
  followers_cycle INTEGER NOT NULL DEFAULT 0 CHECK(followers_cycle >= 0),
  following_cycle INTEGER NOT NULL DEFAULT 0 CHECK(following_cycle >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS x_follow_cycle_targets (
  user_id TEXT NOT NULL,
  cycle INTEGER NOT NULL CHECK(cycle >= 0),
  target_key TEXT NOT NULL,
  platform_user_id TEXT,
  username TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0 CHECK(seen IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, cycle, target_key)
);

CREATE TABLE IF NOT EXISTS instagram_engager_snapshots (
  user_id TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS social_executions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('x','instagram')),
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  external_result_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','succeeded','failed')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS social_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('x','instagram')),
  event_type TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  external_user_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE(user_id, platform, event_type, external_event_id)
);

CREATE TABLE IF NOT EXISTS social_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('x','instagram')),
  candidate_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','ready','snoozed','executing','completed','dismissed','failed','expired')),
  execution_mode TEXT NOT NULL CHECK(execution_mode IN ('in_app','handoff')),
  source TEXT NOT NULL,
  external_event_id TEXT,
  conversation_id TEXT,
  parent_content_id TEXT,
  target_url TEXT,
  draft_hash TEXT,
  observed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  platform_user_id TEXT,
  username TEXT,
  identity_conflict INTEGER NOT NULL DEFAULT 0 CHECK(identity_conflict IN (0,1)),
  retryable INTEGER NOT NULL DEFAULT 1 CHECK(retryable IN (0,1)),
  UNIQUE(user_id, platform, source, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_candidates_user_match ON candidates(user_id, mission_match DESC);
CREATE INDEX IF NOT EXISTS idx_candidates_stage ON candidates(user_id, stage);
CREATE INDEX IF NOT EXISTS idx_interactions_candidate ON interactions(candidate_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_queue_date ON daily_queue(user_id, queue_date, rank);
CREATE INDEX IF NOT EXISTS idx_budget_month ON budget_ledger(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_x_oauth_sessions_created ON x_oauth_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_x_follow_cycle_targets_seen ON x_follow_cycle_targets(user_id, cycle, seen);
CREATE INDEX IF NOT EXISTS idx_social_executions_user ON social_executions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_executions_action ON social_executions(user_id, action_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_events_user ON social_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_actions_user ON social_actions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_actions_event ON social_actions(user_id, platform, external_event_id);
