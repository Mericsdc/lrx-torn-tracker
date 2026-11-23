-- Players who requested erasure: their rows were deleted and later roster snapshots skip them.
CREATE TABLE IF NOT EXISTS faction_hub_erasures (
  torn_id INTEGER PRIMARY KEY,
  erased_at INTEGER NOT NULL
);

-- Per-player lookups for export / erasure.
CREATE INDEX IF NOT EXISTS idx_roster_latest_player ON roster_latest(player_id);
CREATE INDEX IF NOT EXISTS idx_roster_obs_player ON roster_observations(player_id);
CREATE INDEX IF NOT EXISTS idx_travel_trans_player ON travel_transitions(player_id);
CREATE INDEX IF NOT EXISTS idx_collectors_linked_by ON faction_collectors(linked_by_torn_id);
CREATE INDEX IF NOT EXISTS idx_faction_audit_actor ON faction_audit(actor_torn_id);

-- Time-based retention sweeps.
CREATE INDEX IF NOT EXISTS idx_outbox_created ON notification_outbox(created_at);
CREATE INDEX IF NOT EXISTS idx_faction_audit_created ON faction_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_operator_jobs_created ON faction_operator_jobs(created_at);
