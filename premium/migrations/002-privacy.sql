CREATE TABLE IF NOT EXISTS premium_privacy_requests (
  id INTEGER PRIMARY KEY, torn_id INTEGER NOT NULL, requested_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','declined')),
  updated_at INTEGER NOT NULL, resolution TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS premium_privacy_pending ON premium_privacy_requests(torn_id) WHERE status='pending';
