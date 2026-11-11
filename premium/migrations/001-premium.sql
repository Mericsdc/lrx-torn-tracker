CREATE TABLE IF NOT EXISTS premium_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS premium_users (
  id INTEGER PRIMARY KEY, torn_id INTEGER NOT NULL UNIQUE CHECK(torn_id > 0),
  verified_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS premium_subscriptions (
  user_id INTEGER PRIMARY KEY REFERENCES premium_users(id), torn_id INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('active','expired','inactive')),
  started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS premium_price_versions (
  id INTEGER PRIMARY KEY, effective_at INTEGER NOT NULL,
  xanax_price INTEGER NOT NULL CHECK(xanax_price BETWEEN 1 AND 1000),
  days_per_xanax INTEGER NOT NULL CHECK(days_per_xanax BETWEEN 1 AND 3650),
  created_by INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS premium_settings (
  id INTEGER PRIMARY KEY CHECK(id=1), xanax_price INTEGER NOT NULL DEFAULT 1,
  days_per_xanax INTEGER NOT NULL DEFAULT 15, payment_receiver_torn_id INTEGER NOT NULL,
  check_interval INTEGER NOT NULL DEFAULT 60 CHECK(check_interval BETWEEN 60 AND 3600),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS premium_transactions (
  id INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, source TEXT NOT NULL,
  receiver_torn_id INTEGER NOT NULL, torn_sender_id INTEGER, item_id INTEGER, item_name TEXT,
  quantity INTEGER CHECK(quantity IS NULL OR quantity > 0), premium_days REAL NOT NULL DEFAULT 0,
  awarded_seconds INTEGER NOT NULL DEFAULT 0, price_version_id INTEGER REFERENCES premium_price_versions(id),
  status TEXT NOT NULL CHECK(status IN ('applied','pending_identity','review','ignored','baseline','rejected')),
  reason TEXT, event_timestamp INTEGER NOT NULL, processed_at INTEGER, observed_at INTEGER NOT NULL,
  payload_hash TEXT NOT NULL, event_text TEXT NOT NULL, parsed_verified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS premium_tx_sender ON premium_transactions(torn_sender_id, id DESC);
CREATE INDEX IF NOT EXISTS premium_tx_status ON premium_transactions(status, id DESC);
CREATE TABLE IF NOT EXISTS premium_payment_balances (
  torn_id INTEGER PRIMARY KEY, available_xanax INTEGER NOT NULL DEFAULT 0 CHECK(available_xanax >= 0),
  total_received INTEGER NOT NULL DEFAULT 0 CHECK(total_received >= 0), updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS premium_sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES premium_users(id),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS premium_checkpoint (
  id INTEGER PRIMARY KEY CHECK(id=1), baseline_at INTEGER, watermark_at INTEGER,
  anchor_event_id TEXT, last_checked_at INTEGER, last_success_at INTEGER, next_check_at INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0, last_error_code TEXT,
  gap_detected INTEGER NOT NULL DEFAULT 0 CHECK(gap_detected IN (0,1))
);
CREATE TABLE IF NOT EXISTS premium_worker_leases (
  name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS premium_api_budget (
  key_hash TEXT PRIMARY KEY, window_start INTEGER NOT NULL, requests INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS premium_audit_log (
  id INTEGER PRIMARY KEY, actor_torn_id INTEGER, action TEXT NOT NULL, target TEXT NOT NULL,
  reason TEXT NOT NULL, before_json TEXT, after_json TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS premium_system_errors (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS premium_test_batches (
  id INTEGER PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL, consumed_at INTEGER
);
