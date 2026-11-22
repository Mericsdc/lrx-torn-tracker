CREATE TABLE IF NOT EXISTS faction_hub_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS faction_collectors (
  faction_id INTEGER PRIMARY KEY,
  linked_by_torn_id INTEGER NOT NULL,
  key_ref TEXT NOT NULL DEFAULT '',
  key_cipher TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'pilot',
  paused INTEGER NOT NULL DEFAULT 0,
  interval_sec INTEGER NOT NULL DEFAULT 300,
  next_run_at INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  backoff_sec INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER NOT NULL DEFAULT 0,
  last_success_at INTEGER NOT NULL DEFAULT 0,
  last_latency_ms INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_at INTEGER NOT NULL DEFAULT 0,
  planned_slots INTEGER NOT NULL DEFAULT 0,
  observed_slots INTEGER NOT NULL DEFAULT 0,
  planned_calls INTEGER NOT NULL DEFAULT 0,
  manual_calls INTEGER NOT NULL DEFAULT 0,
  retry_calls INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS faction_observed_slots (
  faction_id INTEGER NOT NULL,
  slot_at INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  online_count INTEGER NOT NULL DEFAULT 0,
  idle_count INTEGER NOT NULL DEFAULT 0,
  offline_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (faction_id, slot_at)
);

CREATE TABLE IF NOT EXISTS roster_observations (
  faction_id INTEGER NOT NULL,
  slot_at INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  travel_state TEXT NOT NULL,
  destination TEXT,
  origin TEXT,
  activity TEXT NOT NULL,
  health TEXT NOT NULL,
  raw_desc TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (faction_id, slot_at, player_id)
);
CREATE INDEX IF NOT EXISTS idx_roster_obs_time ON roster_observations(faction_id, observed_at);

CREATE TABLE IF NOT EXISTS roster_latest (
  faction_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  observed_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  position TEXT NOT NULL DEFAULT '',
  in_oc INTEGER NOT NULL DEFAULT 0,
  last_rel TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  travel_state TEXT NOT NULL DEFAULT 'none_observed',
  destination TEXT,
  origin TEXT,
  activity TEXT NOT NULL DEFAULT 'Offline',
  health TEXT NOT NULL DEFAULT 'unknown',
  eta_kind TEXT NOT NULL DEFAULT 'unknown',
  eta_from TEXT,
  eta_to TEXT,
  eta_at TEXT,
  raw_desc TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (faction_id, player_id)
);

CREATE TABLE IF NOT EXISTS travel_transitions (
  faction_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  transition_id TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  destination TEXT,
  origin TEXT,
  seen_from INTEGER NOT NULL,
  seen_to INTEGER NOT NULL,
  eta_from TEXT,
  eta_to TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (faction_id, player_id, transition_id)
);
CREATE INDEX IF NOT EXISTS idx_travel_trans_time ON travel_transitions(faction_id, seen_to DESC);

CREATE TABLE IF NOT EXISTS activity_rollups (
  faction_id INTEGER NOT NULL,
  grain TEXT NOT NULL,
  bucket_at INTEGER NOT NULL,
  online_sum INTEGER NOT NULL DEFAULT 0,
  idle_sum INTEGER NOT NULL DEFAULT 0,
  offline_sum INTEGER NOT NULL DEFAULT 0,
  total_sum INTEGER NOT NULL DEFAULT 0,
  observed_slots INTEGER NOT NULL DEFAULT 0,
  planned_slots INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (faction_id, grain, bucket_at)
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  faction_id INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  destination TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'member',
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_try_at INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON notification_outbox(status, next_try_at);
CREATE INDEX IF NOT EXISTS idx_outbox_faction ON notification_outbox(faction_id, created_at DESC);

CREATE TABLE IF NOT EXISTS faction_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_torn_id INTEGER,
  faction_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'ok',
  meta_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_faction_audit_time ON faction_audit(faction_id, created_at DESC);

CREATE TABLE IF NOT EXISTS faction_plans (
  faction_id INTEGER PRIMARY KEY,
  plan_tier TEXT NOT NULL DEFAULT 'pilot',
  plan_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  quota_alerts_per_day INTEGER NOT NULL DEFAULT 100,
  raw_retention_days INTEGER NOT NULL DEFAULT 30,
  rollup_retention_days INTEGER NOT NULL DEFAULT 180,
  updated_by INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS faction_plan_events (
  event_id TEXT PRIMARY KEY,
  faction_id INTEGER NOT NULL,
  actor_torn_id INTEGER,
  added_seconds INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS faction_operator_jobs (
  request_id TEXT PRIMARY KEY,
  actor_torn_id INTEGER NOT NULL,
  faction_id INTEGER NOT NULL DEFAULT 0,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
