CREATE TABLE premium_feature_consents (
  torn_id INTEGER PRIMARY KEY REFERENCES premium_users(torn_id),
  accepted_at INTEGER NOT NULL,
  version INTEGER NOT NULL
);
CREATE TABLE premium_feature_overrides (
  torn_id INTEGER NOT NULL REFERENCES premium_users(torn_id),
  feature_id TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(torn_id,feature_id)
);
CREATE TABLE premium_feature_workspaces (
  torn_id INTEGER NOT NULL REFERENCES premium_users(torn_id),
  feature_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  content_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(torn_id,feature_id)
);
CREATE TABLE premium_feature_observations (
  id INTEGER PRIMARY KEY,
  torn_id INTEGER NOT NULL REFERENCES premium_users(torn_id),
  feature_id TEXT NOT NULL,
  series_key TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  UNIQUE(torn_id,feature_id,series_key,observed_at)
);
CREATE INDEX premium_feature_observations_owner ON premium_feature_observations(torn_id,feature_id,recorded_at);
