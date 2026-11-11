CREATE TABLE IF NOT EXISTS premium_permanent_members (
  torn_id INTEGER PRIMARY KEY CHECK(torn_id > 0), reason TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS premium_test_scenarios (
  event_id TEXT PRIMARY KEY, torn_id INTEGER NOT NULL, quantity INTEGER NOT NULL,
  event_timestamp INTEGER NOT NULL, created_by INTEGER NOT NULL, created_at INTEGER NOT NULL
);
