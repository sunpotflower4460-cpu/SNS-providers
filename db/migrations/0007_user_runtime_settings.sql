-- One canonical user budget ceiling. Client settings cannot raise the server HARD LIMIT.

CREATE TABLE IF NOT EXISTS user_runtime_settings (
  user_id TEXT PRIMARY KEY,
  monthly_budget_ceiling_usd REAL NOT NULL CHECK(monthly_budget_ceiling_usd >= 0),
  updated_at TEXT NOT NULL
);
