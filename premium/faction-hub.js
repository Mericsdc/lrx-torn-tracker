const crypto = require('node:crypto');
const { openFactionDatabase } = require('./faction-db');
const { fail, positiveId, DAY } = require('./store');
const travelRadar = require('../public/travel-radar');

const REVOKED_TORN_CODES = new Set([2, 7, 16, 18]);
const VALID_ACTIONS = new Set(['pause', 'resume', 'queue_refresh', 'prune', 'retry_outbox', 'preview_notification', 'grant_plan', 'synthetic_plan_event']);
const DISCORD_WEBHOOK_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{10,25}\/[A-Za-z0-9_-]{20,120}$/;

function cleanReason(raw, max = 240) {
  const s = String(raw || '').trim();
  if (s.length < 3 || s.length > max) fail('REASON_REQUIRED', 400);
  return s;
}

function maskApiKey(key) {
  const s = String(key || '').trim();
  if (s.length < 8) return '****';
  return '****' + s.slice(-4);
}

function deriveSecretKey(secret, mode) {
  const raw = String(secret || '').trim();
  if (raw) return crypto.createHash('sha256').update(raw).digest();
  if (mode === 'test') return crypto.randomBytes(32);
  return null;
}

function encryptKey(plain, keyBuf) {
  if (!keyBuf) fail('FACTION_KEY_SECRET_NOT_CONFIGURED', 503);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptKey(encoded, keyBuf) {
  if (!encoded || !keyBuf) return '';
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < 29) return '';
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function parseSettings(raw) {
  try {
    const obj = JSON.parse(raw || '{}');
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

function defaultSettings() {
  return {
    sharedReports: true,
    notifications: { travel: true, war: true, chain: true, oc: false },
    discordWebhook: '',
    discordScope: 'member', // 'member' | 'officer'
    watchedPlayers: [],
    rawRetentionDays: 30,
    rollupRetentionDays: 180,
  };
}

function createFactionHub(config, dependencies = {}) {
  const now = dependencies.now || (() => Math.floor(Date.now() / 1000));
  const dbPath = dependencies.factionDbPath || config.factionDbPath || ':memory:';
  const handle = openFactionDatabase(dbPath, { mode: config.mode, now });
  const { db, transaction } = handle;
  const keyBuf = deriveSecretKey(dependencies.factionKeySecret ?? config.factionKeySecret, config.mode);
  const fetchImpl = dependencies.fetchImpl || global.fetch;
  const notifyProvider = dependencies.notifyProvider || null;
  const roleVerifier = dependencies.roleVerifier || null;
  const rosterFetcher = dependencies.rosterFetcher || null;

  const inflightTicks = new Map();
  let timer = null;
  let stopped = false;

  function audit(actor, factionId, action, reason = '', result = 'ok', meta = null) {
    db.prepare(
      'INSERT INTO faction_audit(actor_torn_id, faction_id, action, reason, result, meta_json, created_at) VALUES(?,?,?,?,?,?,?)',
    ).run(actor?.tornId ?? null, Number(factionId) || 0, String(action), String(reason || ''), String(result), meta ? JSON.stringify(meta) : null, now());
  }

  /* ---------- Role & Membership Verification (P1.1) ---------- */
  async function verifyFactionRole(actor, factionId) {
    if (!actor || !positiveId(actor.tornId)) fail('AUTH_REQUIRED', 401);
    if (!positiveId(factionId)) fail('INVALID_FACTION_ID', 400);
    if (roleVerifier) {
      const res = await roleVerifier(actor.tornId, factionId);
      if (!res || !res.inFaction || Number(res.factionId) !== Number(factionId)) {
        return { inFaction: false, role: 'none', officer: false, position: '' };
      }
      const officer = Boolean(res.officer || res.role === 'leader' || res.role === 'co-leader' || res.role === 'officer');
      return { inFaction: true, role: officer ? 'officer' : 'member', officer, position: String(res.position || '') };
    }
    // Live verification via collector key if present for this faction
    const col = db.prepare('SELECT key_cipher, linked_by_torn_id FROM faction_collectors WHERE faction_id=?').get(factionId);
    if (!col || !col.key_cipher) return { inFaction: false, role: 'none', officer: false, position: '' };
    const apiKey = decryptKey(col.key_cipher, keyBuf);
    if (!apiKey) return { inFaction: false, role: 'none', officer: false, position: '' };
    try {
      const res = await fetchImpl('https://api.torn.com/v2/faction/members', {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: { Authorization: 'ApiKey ' + apiKey },
      });
      const json = await res.json();
      if (json.error) {
        if (REVOKED_TORN_CODES.has(Number(json.error.code))) {
          db.prepare('UPDATE faction_collectors SET paused=1, last_error_code=?, last_error_at=?, updated_at=? WHERE faction_id=?')
            .run(`TORN_${json.error.code}`, now(), now(), factionId);
        }
        return { inFaction: false, role: 'none', officer: false, position: '' };
      }
      const member = (json.members || []).find((m) => Number(m.id) === Number(actor.tornId));
      if (!member) return { inFaction: false, role: 'none', officer: false, position: '' };
      const pos = String(member.position || '');
      const officer = /^(leader|co-leader)$/i.test(pos) || Number(col.linked_by_torn_id) === Number(actor.tornId);
      return { inFaction: true, role: officer ? 'officer' : 'member', officer, position: pos };
    } catch {
      return { inFaction: false, role: 'none', officer: false, position: '' };
    }
  }

  async function requireMember(actor, factionId) {
    const r = await verifyFactionRole(actor, factionId);
    if (!r.inFaction) fail('FACTION_ACCESS_DENIED', 403);
    return r;
  }

  async function requireOfficer(actor, factionId) {
    const r = await verifyFactionRole(actor, factionId);
    if (!r.inFaction || !r.officer) fail('FACTION_OFFICER_REQUIRED', 403);
    return r;
  }

  /* ---------- Faction Team Plan (P3.1) ---------- */
  function getPlan(factionId) {
    const row = db.prepare('SELECT * FROM faction_plans WHERE faction_id=?').get(factionId);
    const ts = now();
    if (!row) {
      return { active: false, tier: 'none', version: 0, status: 'none', startsAt: null, endsAt: null, remainingDays: 0, quotaAlertsPerDay: 0, rawRetentionDays: 30, rollupRetentionDays: 180 };
    }
    const active = row.status === 'active' && row.ends_at > ts;
    const status = row.status === 'active' && row.ends_at <= ts ? 'expired' : row.status;
    return {
      active,
      tier: row.plan_tier,
      version: row.plan_version,
      status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      remainingDays: active ? Math.ceil((row.ends_at - ts) / DAY) : 0,
      quotaAlertsPerDay: row.quota_alerts_per_day,
      rawRetentionDays: row.raw_retention_days,
      rollupRetentionDays: row.rollup_retention_days,
    };
  }

  function grantPlan(actor, { factionId, tier = 'pilot', days = 30, quotaAlertsPerDay = 100, rawRetentionDays = 30, rollupRetentionDays = 180, reason }) {
    if (!positiveId(factionId)) fail('INVALID_FACTION_ID', 400);
    if (!['pilot', 'team'].includes(tier)) fail('INVALID_PLAN_TIER', 400);
    const d = Math.floor(Number(days));
    if (!Number.isSafeInteger(d) || d < 1 || d > 365) fail('INVALID_PLAN_DAYS', 400);
    const why = cleanReason(reason);
    const ts = now();
    return transaction(() => {
      const cur = db.prepare('SELECT * FROM faction_plans WHERE faction_id=?').get(factionId);
      const baseEnd = cur && cur.ends_at > ts ? cur.ends_at : ts;
      const newEnd = baseEnd + d * DAY;
      if (cur) {
        db.prepare(
          'UPDATE faction_plans SET plan_tier=?, plan_version=plan_version+1, status=\'active\', ends_at=?, quota_alerts_per_day=?, raw_retention_days=?, rollup_retention_days=?, updated_by=?, updated_at=? WHERE faction_id=?',
        ).run(tier, newEnd, quotaAlertsPerDay, rawRetentionDays, rollupRetentionDays, actor?.tornId ?? null, ts, factionId);
      } else {
        db.prepare(
          'INSERT INTO faction_plans(faction_id, plan_tier, plan_version, status, starts_at, ends_at, quota_alerts_per_day, raw_retention_days, rollup_retention_days, updated_by, updated_at) VALUES(?,?,1,\'active\',?,?,?,?,?,?,?)',
        ).run(factionId, tier, ts, newEnd, quotaAlertsPerDay, rawRetentionDays, rollupRetentionDays, actor?.tornId ?? null, ts);
      }
      audit(actor, factionId, 'plan.grant', why, 'ok', { tier, days: d, endsAt: newEnd });
      return getPlan(factionId);
    });
  }

  function applySyntheticPlanEvent(actor, { factionId, eventId, days = 30, tier = 'team', reason = 'Synthetic team plan event' }) {
    if (config.mode !== 'test') fail('TEST_ENDPOINT_DISABLED', 403);
    if (!positiveId(factionId)) fail('INVALID_FACTION_ID', 400);
    const eid = String(eventId || '').trim();
    if (eid.length < 3 || eid.length > 120) fail('INVALID_EVENT_ID', 400);
    const d = Math.floor(Number(days));
    if (!Number.isSafeInteger(d) || d < 1 || d > 365) fail('INVALID_PLAN_DAYS', 400);
    const why = cleanReason(reason);
    const ts = now();
    return transaction(() => {
      const existing = db.prepare('SELECT event_id FROM faction_plan_events WHERE event_id=?').get(eid);
      if (existing) {
        audit(actor, factionId, 'plan.event_replay', why, 'duplicate_ignored', { eventId: eid });
        return { applied: false, duplicate: true, addedDays: 0, plan: getPlan(factionId) };
      }
      const addSec = d * DAY;
      db.prepare('INSERT INTO faction_plan_events(event_id, faction_id, actor_torn_id, added_seconds, reason, created_at) VALUES(?,?,?,?,?,?)')
        .run(eid, factionId, actor?.tornId ?? null, addSec, why, ts);
      const cur = db.prepare('SELECT * FROM faction_plans WHERE faction_id=?').get(factionId);
      const baseEnd = cur && cur.ends_at > ts ? cur.ends_at : ts;
      const newEnd = baseEnd + addSec;
      if (cur) {
        db.prepare('UPDATE faction_plans SET plan_tier=?, plan_version=plan_version+1, status=\'active\', ends_at=?, updated_by=?, updated_at=? WHERE faction_id=?')
          .run(tier, newEnd, actor?.tornId ?? null, ts, factionId);
      } else {
        db.prepare('INSERT INTO faction_plans(faction_id, plan_tier, plan_version, status, starts_at, ends_at, updated_by, updated_at) VALUES(?,?,1,\'active\',?,?,?,?)')
          .run(factionId, tier, ts, newEnd, actor?.tornId ?? null, ts);
      }
      audit(actor, factionId, 'plan.event_applied', why, 'ok', { eventId: eid, days: d, endsAt: newEnd });
      return { applied: true, duplicate: false, addedDays: d, plan: getPlan(factionId) };
    });
  }

  /* ---------- Settings & Collector Key Connection (P1.1 / P1.3) ---------- */
  async function getSettings(actor, factionId) {
    const role = await requireOfficer(actor, factionId);
    const col = db.prepare('SELECT * FROM faction_collectors WHERE faction_id=?').get(factionId);
    const merged = { ...defaultSettings(), ...parseSettings(col?.settings_json) };
    return {
      factionId,
      role,
      connected: Boolean(col && col.key_cipher),
      keyRef: col?.key_ref || '',
      paused: Boolean(col?.paused),
      mode: col?.mode || 'pilot',
      intervalSec: col?.interval_sec || 300,
      version: col?.version || 0,
      lastSuccessAt: col?.last_success_at || 0,
      lastErrorCode: col?.last_error_code || null,
      settings: { ...merged, discordWebhook: merged.discordWebhook ? 'configured' : '' },
      plan: getPlan(factionId),
    };
  }

  async function updateSettings(actor, factionId, body = {}) {
    await requireOfficer(actor, factionId);
    const why = cleanReason(body.reason || 'Settings update');
    const ts = now();

    return transaction(() => {
      const col = db.prepare('SELECT * FROM faction_collectors WHERE faction_id=?').get(factionId);
      const expectedVersion = body.version != null ? Number(body.version) : null;
      if (col && expectedVersion !== null && expectedVersion !== col.version) {
        fail('VERSION_CONFLICT', 409);
      }

      const curSettings = { ...defaultSettings(), ...parseSettings(col?.settings_json) };
      if (typeof body.sharedReports === 'boolean') curSettings.sharedReports = body.sharedReports;
      if (body.notifications && typeof body.notifications === 'object') {
        for (const k of ['travel', 'war', 'chain', 'oc']) {
          if (typeof body.notifications[k] === 'boolean') curSettings.notifications[k] = body.notifications[k];
        }
      }
      if (typeof body.discordScope === 'string' && ['member', 'officer'].includes(body.discordScope)) {
        curSettings.discordScope = body.discordScope;
      }
      if (body.discordWebhook !== undefined) {
        const hook = String(body.discordWebhook || '').trim();
        if (hook && !DISCORD_WEBHOOK_RE.test(hook) && !(config.mode === 'test' && hook.startsWith('https://discord.test/'))) {
          fail('INVALID_DISCORD_WEBHOOK', 400);
        }
        curSettings.discordWebhook = hook;
      }
      if (Array.isArray(body.watchedPlayers)) {
        curSettings.watchedPlayers = [...new Set(body.watchedPlayers.map(Number).filter((n) => positiveId(n)))].slice(0, 100);
      }

      let keyRef = col?.key_ref || '';
      let keyCipher = col?.key_cipher || '';
      let paused = col ? col.paused : 0;

      if (body.disconnectKey === true) {
        keyRef = '';
        keyCipher = '';
        paused = 1;
        audit(actor, factionId, 'collector.disconnect', why, 'ok', null);
      } else if (typeof body.connectKey === 'string' && body.connectKey.trim()) {
        if (body.consent !== true) fail('CONSENT_REQUIRED', 400);
        const rawKey = body.connectKey.trim();
        if (!/^[A-Za-z0-9]{16}$/.test(rawKey)) fail('INVALID_API_KEY', 400);
        keyRef = maskApiKey(rawKey);
        keyCipher = encryptKey(rawKey, keyBuf);
        paused = 0;
        audit(actor, factionId, 'collector.connect', why, 'ok', { keyRef });
      }
      if (typeof body.paused === 'boolean' && !body.disconnectKey) {
        paused = body.paused ? 1 : 0;
      }

      if (col) {
        db.prepare(
          'UPDATE faction_collectors SET key_ref=?, key_cipher=?, paused=?, version=version+1, settings_json=?, updated_at=? WHERE faction_id=?',
        ).run(keyRef, keyCipher, paused, JSON.stringify(curSettings), ts, factionId);
      } else {
        db.prepare(
          'INSERT INTO faction_collectors(faction_id, linked_by_torn_id, key_ref, key_cipher, mode, paused, interval_sec, next_run_at, version, settings_json, created_at, updated_at) VALUES(?,?,?,?,?,?,300,0,1,?,?,?)',
        ).run(factionId, actor.tornId, keyRef, keyCipher, 'pilot', paused, JSON.stringify(curSettings), ts, ts);
      }
      audit(actor, factionId, 'settings.update', why, 'ok', { paused: Boolean(paused), sharedReports: curSettings.sharedReports });

      const updated = db.prepare('SELECT * FROM faction_collectors WHERE faction_id=?').get(factionId);
      return {
        factionId,
        connected: Boolean(updated.key_cipher),
        keyRef: updated.key_ref,
        paused: Boolean(updated.paused),
        version: updated.version,
        settings: { ...curSettings, discordWebhook: curSettings.discordWebhook ? 'configured' : '' },
      };
    });
  }

  /* ---------- Lease + Fenced Single-Transaction Ingest (P1.2) ---------- */
  function acquireLease(factionId, owner = 'worker', ttlSec = 120) {
    const ts = now();
    const token = crypto.randomBytes(16).toString('hex');
    return transaction(() => {
      const col = db.prepare('SELECT lease_owner, lease_until FROM faction_collectors WHERE faction_id=?').get(factionId);
      if (!col) fail('COLLECTOR_NOT_FOUND', 404);
      if (col.lease_until > ts && col.lease_owner && col.lease_owner !== owner) {
        return { acquired: false, token: null };
      }
      db.prepare('UPDATE faction_collectors SET lease_owner=?, lease_token=?, lease_until=?, updated_at=? WHERE faction_id=?')
        .run(owner, token, ts + ttlSec, ts, factionId);
      return { acquired: true, token };
    });
  }

  function releaseLease(factionId, leaseToken) {
    db.prepare('UPDATE faction_collectors SET lease_owner=NULL, lease_token=NULL, lease_until=0 WHERE faction_id=? AND lease_token=?')
      .run(factionId, leaseToken);
  }

  function ingestRosterSnapshot({ factionId, leaseToken, slotAt, observedAt, receivedAt, members = [], latencyMs = 0 }) {
    if (!positiveId(factionId)) fail('INVALID_FACTION_ID', 400);
    const slot = Math.floor(Number(slotAt) || now());
    const obsSec = Math.floor(Number(observedAt) || slot);
    const recSec = Math.floor(Number(receivedAt) || now());

    return transaction(() => {
      const col = db.prepare('SELECT * FROM faction_collectors WHERE faction_id=?').get(factionId);
      if (!col) fail('COLLECTOR_NOT_FOUND', 404);
      if (!leaseToken || col.lease_token !== leaseToken || col.lease_until < now()) {
        fail('LEASE_MISMATCH', 409);
      }

      const prevRows = db.prepare('SELECT player_id, travel_state, origin, destination, observed_at, eta_from, eta_to FROM roster_latest WHERE faction_id=?').all(factionId);
      const prevByPlayer = new Map();
      let prevObservedSec = 0;
      for (const r of prevRows) {
        prevByPlayer.set(r.player_id, { travelState: r.travel_state, origin: r.origin, destination: r.destination });
        if (r.observed_at > prevObservedSec) prevObservedSec = r.observed_at;
      }

      const radar = travelRadar.buildRadarPayload({
        factionId,
        members,
        prevByPlayer,
        prevObservedAtMs: prevObservedSec * 1000,
        observedAtMs: obsSec * 1000,
        receivedAtMs: recSec * 1000,
        nowMs: recSec * 1000,
      });

      const alreadySlot = db.prepare('SELECT 1 FROM faction_observed_slots WHERE faction_id=? AND slot_at=?').get(factionId, slot);
      let online = 0, idle = 0, offline = 0;
      const insObs = db.prepare(
        'INSERT OR IGNORE INTO roster_observations(faction_id, slot_at, player_id, observed_at, received_at, state, travel_state, destination, origin, activity, health, raw_desc) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      );
      const getLatest = db.prepare('SELECT observed_at, version FROM roster_latest WHERE faction_id=? AND player_id=?');
      const upsertLatest = db.prepare(
        `INSERT INTO roster_latest(faction_id, player_id, version, observed_at, received_at, display_name, level, position, in_oc, last_rel, state, travel_state, destination, origin, activity, health, eta_kind, eta_from, eta_to, eta_at, raw_desc)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(faction_id, player_id) DO UPDATE SET
           version=roster_latest.version+1, observed_at=excluded.observed_at, received_at=excluded.received_at,
           display_name=excluded.display_name, level=excluded.level, position=excluded.position, in_oc=excluded.in_oc,
           last_rel=excluded.last_rel, state=excluded.state, travel_state=excluded.travel_state, destination=excluded.destination,
           origin=excluded.origin, activity=excluded.activity, health=excluded.health, eta_kind=excluded.eta_kind,
           eta_from=excluded.eta_from, eta_to=excluded.eta_to, eta_at=excluded.eta_at, raw_desc=excluded.raw_desc
         WHERE excluded.observed_at >= roster_latest.observed_at`,
      );

      for (const m of radar.allMembers) {
        if (m.activityStatus === 'Online') online++;
        else if (m.activityStatus === 'Idle') idle++;
        else offline++;
        insObs.run(factionId, slot, m.playerId, obsSec, recSec, m.healthStatus, m.travelState, m.destination, m.origin, m.activityStatus, m.healthStatus, m.rawDescription);
        const prevL = getLatest.get(factionId, m.playerId);
        if (!prevL || obsSec >= prevL.observed_at) {
          upsertLatest.run(
            factionId, m.playerId, 1, obsSec, recSec, m.displayName, m.level, m.position, m.inOc ? 1 : 0, m.lastRel,
            m.healthStatus, m.travelState, m.destination, m.origin, m.activityStatus, m.healthStatus,
            m.etaKind, m.etaFrom, m.etaTo, m.etaAt, m.rawDescription,
          );
        }
      }

      // Idempotent transitions & outbox enqueue
      const settings = { ...defaultSettings(), ...parseSettings(col.settings_json) };
      const watchedSet = new Set((settings.watchedPlayers || []).map(Number));
      const insTrans = db.prepare(
        'INSERT OR IGNORE INTO travel_transitions(faction_id, player_id, transition_id, from_state, to_state, destination, origin, seen_from, seen_to, eta_from, eta_to, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      );
      const insOutbox = db.prepare(
        'INSERT OR IGNORE INTO notification_outbox(idempotency_key, faction_id, event_id, destination, rule_id, scope, payload_json, status, attempts, next_try_at, created_at, updated_at) VALUES(?,?,?,?,?,?,?,\'pending\',0,?,?,?)',
      );

      let queuedAlerts = 0;
      for (const tr of radar.transitions) {
        const curRow = radar.allMembers.find((x) => x.playerId === tr.playerId);
        insTrans.run(factionId, tr.playerId, tr.transitionId, tr.fromState, tr.toState, tr.destination, tr.origin, Math.floor(tr.seenFromMs / 1000), Math.floor(tr.seenToMs / 1000), curRow?.etaFrom || null, curRow?.etaTo || null, recSec);

        // Enqueue travel notification when enabled and (no watchlist filter OR player is watched)
        const shouldNotify = settings.notifications?.travel && settings.discordWebhook
          && (watchedSet.size === 0 || watchedSet.has(tr.playerId))
          && (tr.toState === 'outbound' || tr.toState === 'inbound' || tr.toState === 'abroad');
        if (shouldNotify) {
          const idem = `travel:${factionId}:${tr.transitionId}:discord`;
          const payload = {
            kind: 'travel',
            factionId,
            playerId: tr.playerId,
            displayName: curRow?.displayName || `#${tr.playerId}`,
            fromState: tr.fromState,
            toState: tr.toState,
            destination: tr.destination,
            origin: tr.origin,
            etaKind: curRow?.etaKind || 'unknown',
            etaFrom: curRow?.etaFrom || null,
            etaTo: curRow?.etaTo || null,
            observedAt: travelRadar.isoUtc(obsSec * 1000),
          };
          const res = insOutbox.run(idem, factionId, tr.transitionId, settings.discordWebhook, 'travel_transition', settings.discordScope || 'member', JSON.stringify(payload), recSec, recSec, recSec);
          if (Number(res.changes) > 0) queuedAlerts++;
        }
      }

      // Idempotent rollup aggregation (only once per slot_at!)
      if (!alreadySlot) {
        db.prepare('INSERT INTO faction_observed_slots(faction_id, slot_at, observed_at, received_at, online_count, idle_count, offline_count, total_count) VALUES(?,?,?,?,?,?,?,?)')
          .run(factionId, slot, obsSec, recSec, online, idle, offline, radar.allMembers.length);

        const hourBucket = Math.floor(obsSec / 3600) * 3600;
        const dayBucket = Math.floor(obsSec / 86400) * 86400;
        const upsertRollup = db.prepare(
          `INSERT INTO activity_rollups(faction_id, grain, bucket_at, online_sum, idle_sum, offline_sum, total_sum, observed_slots, planned_slots)
           VALUES(?,?,?,?,?,?,?,1,1)
           ON CONFLICT(faction_id, grain, bucket_at) DO UPDATE SET
             online_sum=activity_rollups.online_sum+excluded.online_sum,
             idle_sum=activity_rollups.idle_sum+excluded.idle_sum,
             offline_sum=activity_rollups.offline_sum+excluded.offline_sum,
             total_sum=activity_rollups.total_sum+excluded.total_sum,
             observed_slots=activity_rollups.observed_slots+1,
             planned_slots=activity_rollups.planned_slots+1`,
        );
        upsertRollup.run(factionId, 'hour', hourBucket, online, idle, offline, radar.allMembers.length);
        upsertRollup.run(factionId, 'day', dayBucket, online, idle, offline, radar.allMembers.length);

        db.prepare(
          'UPDATE faction_collectors SET observed_slots=observed_slots+1, planned_slots=planned_slots+1, last_run_at=?, last_success_at=?, last_latency_ms=?, last_error_code=NULL, consecutive_failures=0, backoff_sec=0, next_run_at=?, updated_at=? WHERE faction_id=?',
        ).run(recSec, obsSec, Math.max(0, Math.round(latencyMs)), recSec + col.interval_sec, recSec, factionId);
      }

      return {
        slotAt: slot,
        duplicateSlot: Boolean(alreadySlot),
        membersCount: radar.allMembers.length,
        travelCount: radar.travel.length,
        transitionsCount: radar.transitions.length,
        queuedAlerts,
      };
    });
  }

  /* ---------- Independent Collector Tick (P1.2 / P1.3) ---------- */
  async function tickFaction(factionId, { kind = 'planned' } = {}) {
    if (inflightTicks.has(factionId)) return inflightTicks.get(factionId);
    const run = (async () => {
      const col = db.prepare('SELECT * FROM faction_collectors WHERE faction_id=?').get(factionId);
      if (!col) return { status: 'not_found' };
      if (col.paused) return { status: 'paused' };
      if (!col.key_cipher && !rosterFetcher) return { status: 'no_key' };

      const ts = now();
      // Respect backoff/cooldown window (even on manual refresh!)
      if (col.next_run_at > ts && (kind === 'planned' || col.backoff_sec > 0)) {
        return { status: 'cooldown', nextRunAt: col.next_run_at };
      }

      const lease = acquireLease(factionId, 'collector', 120);
      if (!lease.acquired) return { status: 'leased' };

      const callCol = kind === 'manual' ? 'manual_calls' : kind === 'retry' ? 'retry_calls' : 'planned_calls';
      db.prepare(`UPDATE faction_collectors SET ${callCol}=${callCol}+1, last_run_at=?, updated_at=? WHERE faction_id=?`).run(ts, ts, factionId);

      const started = Date.now();
      try {
        let members;
        let observedAt = now();
        if (rosterFetcher) {
          const r = await rosterFetcher(factionId);
          members = r.members || [];
          if (r.observedAt) observedAt = r.observedAt;
        } else {
          const apiKey = decryptKey(col.key_cipher, keyBuf);
          const res = await fetchImpl('https://api.torn.com/v2/faction/members', {
            method: 'GET',
            redirect: 'error',
            signal: AbortSignal.timeout(15_000),
            headers: { Authorization: 'ApiKey ' + apiKey },
          });
          if (res.status === 429) throw Object.assign(new Error('RATE_LIMIT'), { code: 'TORN_429', transient: true });
          if (res.status >= 500) throw Object.assign(new Error('UPSTREAM_5XX'), { code: `HTTP_${res.status}`, transient: true });
          const json = await res.json();
          if (json.error) {
            const ec = Number(json.error.code);
            throw Object.assign(new Error(json.error.error || 'Torn error'), { code: `TORN_${ec}`, tornCode: ec, transient: ec === 5 || ec === 8 || ec === 9 || ec === 17 });
          }
          members = json.members || [];
        }
        const latencyMs = Date.now() - started;
        const slotAt = Math.floor(observedAt / col.interval_sec) * col.interval_sec;
        const result = ingestRosterSnapshot({ factionId, leaseToken: lease.token, slotAt, observedAt, receivedAt: now(), members, latencyMs });
        return { status: 'ok', ...result };
      } catch (err) {
        const tsErr = now();
        const code = String(err.code || 'UPSTREAM_ERROR');
        const revoked = REVOKED_TORN_CODES.has(Number(err.tornCode));
        const fails = col.consecutive_failures + 1;
        const backoff = revoked ? 0 : Math.min(3600, Math.max(60, col.interval_sec * Math.pow(2, Math.min(fails - 1, 4))));
        db.prepare(
          'UPDATE faction_collectors SET paused=?, planned_slots=planned_slots+1, consecutive_failures=?, backoff_sec=?, next_run_at=?, last_error_code=?, last_error_at=?, updated_at=? WHERE faction_id=?',
        ).run(revoked ? 1 : col.paused, fails, backoff, tsErr + backoff, code, tsErr, tsErr, factionId);
        if (revoked) audit(null, factionId, 'collector.auto_paused', `Revoked or insufficient key (${code})`, 'paused', { code });
        return { status: revoked ? 'revoked_paused' : 'error', code, backoffSec: backoff };
      } finally {
        releaseLease(factionId, lease.token);
      }
    })();
    inflightTicks.set(factionId, run);
    try { return await run; }
    finally { if (inflightTicks.get(factionId) === run) inflightTicks.delete(factionId); }
  }

  function pruneRetention(factionId = null) {
    const ts = now();
    const cols = factionId
      ? db.prepare('SELECT faction_id, settings_json FROM faction_collectors WHERE faction_id=?').all(factionId)
      : db.prepare('SELECT faction_id, settings_json FROM faction_collectors').all();
    let deletedRaw = 0, deletedRollups = 0;
    transaction(() => {
      for (const c of cols) {
        const plan = getPlan(c.faction_id);
        const s = { ...defaultSettings(), ...parseSettings(c.settings_json) };
        const rawDays = plan.active ? plan.rawRetentionDays : (s.rawRetentionDays || 30);
        const rollupDays = plan.active ? plan.rollupRetentionDays : (s.rollupRetentionDays || 180);
        const rawCut = ts - rawDays * DAY;
        const rollupCut = ts - rollupDays * DAY;
        deletedRaw += Number(db.prepare('DELETE FROM roster_observations WHERE faction_id=? AND observed_at<?').run(c.faction_id, rawCut).changes);
        db.prepare('DELETE FROM faction_observed_slots WHERE faction_id=? AND observed_at<?').run(c.faction_id, rawCut);
        db.prepare('DELETE FROM travel_transitions WHERE faction_id=? AND seen_to<?').run(c.faction_id, rawCut);
        deletedRollups += Number(db.prepare('DELETE FROM activity_rollups WHERE faction_id=? AND bucket_at<?').run(c.faction_id, rollupCut).changes);
      }
    });
    return { deletedRaw, deletedRollups };
  }

  /* ---------- Outbox & Discord Delivery Worker (P2.3) ---------- */
  function formatNotificationPayload(row) {
    const p = parseSettings(row.payload_json);
    // Permission cap: member-scoped Discord channel never receives officer-only OC internals
    if (row.scope !== 'officer' && p.officerDetails) {
      const { officerDetails, ...safe } = p;
      return safe;
    }
    return p;
  }

  async function dispatchOutbox({ limit = 20, factionId = null } = {}) {
    const ts = now();
    const rows = factionId
      ? db.prepare("SELECT * FROM notification_outbox WHERE faction_id=? AND status='pending' AND next_try_at<=? ORDER BY id ASC LIMIT ?").all(factionId, ts, limit)
      : db.prepare("SELECT * FROM notification_outbox WHERE status='pending' AND next_try_at<=? ORDER BY id ASC LIMIT ?").all(ts, limit);

    let sent = 0, failed = 0, needsReview = 0;
    for (const row of rows) {
      const plan = getPlan(row.faction_id);
      if (!plan.active) {
        db.prepare("UPDATE notification_outbox SET status='blocked_plan', last_error='FACTION_PLAN_INACTIVE', updated_at=? WHERE id=?").run(now(), row.id);
        continue;
      }
      const payload = formatNotificationPayload(row);
      try {
        if (notifyProvider) {
          await notifyProvider({ destination: row.destination, idempotencyKey: row.idempotency_key, ruleId: row.rule_id, scope: row.scope, payload });
        } else {
          if (!DISCORD_WEBHOOK_RE.test(row.destination)) throw Object.assign(new Error('INVALID_WEBHOOK'), { permanent: true });
          const content = `[LRX] ${payload.displayName || 'Update'}: ${payload.toState || payload.kind}${payload.destination ? ` → ${payload.destination.toUpperCase()}` : ''}`;
          const res = await fetchImpl(row.destination, {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(10_000),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
          });
          if (!res.ok) throw Object.assign(new Error(`HTTP_${res.status}`), { status: res.status });
        }
        db.prepare("UPDATE notification_outbox SET status='sent', attempts=attempts+1, sent_at=?, last_error=NULL, updated_at=? WHERE id=?")
          .run(now(), now(), row.id);
        sent++;
      } catch (err) {
        const uncertain = err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.uncertain === true;
        if (uncertain) {
          // Uncertain delivery: NEVER blindly retry — place in needs_review!
          db.prepare("UPDATE notification_outbox SET status='needs_review', attempts=attempts+1, last_error=?, updated_at=? WHERE id=?")
            .run(String(err.message || 'UNCERTAIN_TIMEOUT'), now(), row.id);
          needsReview++;
        } else {
          const attempts = row.attempts + 1;
          const nextStatus = err?.permanent || attempts >= 3 ? 'failed' : 'pending';
          const nextTry = now() + Math.min(900, 60 * Math.pow(2, attempts - 1));
          db.prepare('UPDATE notification_outbox SET status=?, attempts=?, next_try_at=?, last_error=?, updated_at=? WHERE id=?')
            .run(nextStatus, attempts, nextTry, String(err.message || 'DELIVERY_ERROR'), now(), row.id);
          failed++;
        }
      }
    }
    return { processed: rows.length, sent, failed, needsReview };
  }

  /* ---------- Read Endpoints (P1.3 & P3.1) ---------- */
  async function getStatus(actor, factionId) {
    const role = await requireMember(actor, factionId);
    const plan = getPlan(factionId);
    if (!plan.active) fail('FACTION_PLAN_EXPIRED', 403);
    const col = db.prepare('SELECT * FROM faction_collectors WHERE faction_id=?').get(factionId);
    if (!col) fail('FACTION_NOT_TRACKED', 404);
    const rows = db.prepare('SELECT * FROM roster_latest WHERE faction_id=?').all(factionId);
    let latestObs = col.last_success_at || 0;
    let latestRec = latestObs;
    const travel = [];
    const summary = { outbound: 0, abroad: 0, inbound: 0, unknown: 0, totalTravel: 0 };
    const counts = { total: rows.length, online: 0, idle: 0, offline: 0, okay: 0, hospital: 0, traveling: 0, abroad: 0, jail: 0, inOc: 0 };
    const members = [];

    for (const r of rows) {
      if (r.observed_at > latestObs) latestObs = r.observed_at;
      if (r.received_at > latestRec) latestRec = r.received_at;
      if (r.activity === 'Online') counts.online++;
      else if (r.activity === 'Idle') counts.idle++;
      else counts.offline++;
      if (r.in_oc) counts.inOc++;
      if (r.health === 'hospital') counts.hospital++;
      else if (r.health === 'jail' || r.health === 'federal') counts.jail++;
      else if (r.travel_state === 'outbound' || r.travel_state === 'inbound') counts.traveling++;
      else if (r.travel_state === 'abroad') counts.abroad++;
      else counts.okay++;

      members.push({
        id: r.player_id,
        name: r.display_name,
        level: r.level,
        position: r.position,
        inOc: Boolean(r.in_oc),
        lastStatus: r.activity,
        lastRel: r.last_rel,
        state: r.health === 'hospital' ? 'Hospital' : r.health === 'jail' ? 'Jail' : r.travel_state === 'abroad' ? 'Abroad' : (r.travel_state === 'outbound' || r.travel_state === 'inbound') ? 'Traveling' : 'Okay',
        statusDesc: r.raw_desc,
      });

      if (r.travel_state !== 'none_observed') {
        travel.push({
          playerId: r.player_id,
          displayName: r.display_name,
          level: r.level,
          position: r.position,
          inOc: Boolean(r.in_oc),
          lastRel: r.last_rel,
          travelState: r.travel_state,
          destination: r.destination,
          origin: r.origin,
          rawDescription: r.raw_desc,
          activityStatus: r.activity,
          healthStatus: r.health,
          etaKind: r.eta_kind,
          etaFrom: r.eta_from,
          etaTo: r.eta_to,
          etaAt: r.eta_at,
        });
        summary.totalTravel++;
        if (summary[r.travel_state] != null) summary[r.travel_state]++;
        else summary.unknown++;
      }
    }

    const ts = now();
    const ageSec = latestObs > 0 ? Math.max(0, ts - latestObs) : null;
    const freshState = !latestObs ? 'awaiting_first' : ageSec > 300 ? 'stale' : 'fresh';
    const coveragePct = col.planned_slots > 0 ? Math.round((col.observed_slots / col.planned_slots) * 1000) / 10 : null;

    return {
      factionId,
      role,
      freshness: {
        source: 'shared_hub',
        originLabel: 'shared',
        observedAt: latestObs ? travelRadar.isoUtc(latestObs * 1000) : null,
        receivedAt: latestRec ? travelRadar.isoUtc(latestRec * 1000) : null,
        ageSec,
        state: freshState,
      },
      travel,
      travelSummary: summary,
      members,
      counts,
      collector: { paused: Boolean(col.paused), coveragePct, observedSlots: col.observed_slots, plannedSlots: col.planned_slots, lastErrorCode: col.last_error_code },
      plan: getPlan(factionId),
    };
  }

  async function getHistory(actor, factionId, { from, to, grain = 'hour' } = {}) {
    await requireMember(actor, factionId);
    if (!['hour', 'day'].includes(grain)) fail('INVALID_GRAIN', 400);
    const ts = now();
    const toTs = to != null && to !== '' ? Math.floor(Number(to)) : ts;
    const fromTs = from != null && from !== '' ? Math.floor(Number(from)) : toTs - 7 * DAY;
    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs < 0 || toTs < fromTs) fail('INVALID_TIME_RANGE', 400);
    const maxSpan = grain === 'hour' ? 31 * DAY : 185 * DAY;
    if (toTs - fromTs > maxSpan) fail('RANGE_TOO_LARGE', 400);

    // Extended shared history (> 7 days) requires active faction team/pilot plan
    const plan = getPlan(factionId);
    if (toTs - fromTs > 7 * DAY && !plan.active) fail('FACTION_PLAN_REQUIRED', 403);

    const rows = db.prepare('SELECT bucket_at, online_sum, idle_sum, offline_sum, total_sum, observed_slots, planned_slots FROM activity_rollups WHERE faction_id=? AND grain=? AND bucket_at>=? AND bucket_at<=? ORDER BY bucket_at ASC')
      .all(factionId, grain, fromTs, toTs);
    let obsSum = 0, planSum = 0;
    const series = rows.map((r) => {
      obsSum += r.observed_slots;
      planSum += r.planned_slots;
      return {
        bucketAt: travelRadar.isoUtc(r.bucket_at * 1000),
        bucketTs: r.bucket_at,
        avgOnline: r.observed_slots ? r.online_sum / r.observed_slots : 0,
        avgIdle: r.observed_slots ? r.idle_sum / r.observed_slots : 0,
        avgOffline: r.observed_slots ? r.offline_sum / r.observed_slots : 0,
        avgTotal: r.observed_slots ? r.total_sum / r.observed_slots : 0,
        observedSlots: r.observed_slots,
        plannedSlots: r.planned_slots,
      };
    });
    return {
      factionId,
      grain,
      from: travelRadar.isoUtc(fromTs * 1000),
      to: travelRadar.isoUtc(toTs * 1000),
      coveragePct: planSum > 0 ? Math.round((obsSum / planSum) * 1000) / 10 : null,
      series,
      plan,
    };
  }

  async function getSharedReport(actor, factionId) {
    const role = await requireMember(actor, factionId);
    const plan = getPlan(factionId);
    if (!plan.active) fail('FACTION_PLAN_EXPIRED', 403);
    const col = db.prepare('SELECT settings_json, observed_slots, planned_slots FROM faction_collectors WHERE faction_id=?').get(factionId);
    const settings = { ...defaultSettings(), ...parseSettings(col?.settings_json) };
    if (!settings.sharedReports && !role.officer) fail('SHARED_REPORTS_DISABLED', 403);
    const transitions = db.prepare('SELECT player_id, from_state, to_state, destination, origin, seen_from, seen_to FROM travel_transitions WHERE faction_id=? ORDER BY seen_to DESC LIMIT 50').all(factionId);
    const latest = db.prepare('SELECT player_id, display_name, activity, travel_state, in_oc FROM roster_latest WHERE faction_id=?').all(factionId);
    return {
      factionId,
      scope: role.officer ? 'officer' : 'member',
      plan,
      coveragePct: col?.planned_slots > 0 ? Math.round((col.observed_slots / col.planned_slots) * 1000) / 10 : null,
      membersCount: latest.length,
      recentTransitions: transitions.length,
      // Officer-only detail never returned to member scope
      ...(role.officer ? { notInOcCount: latest.filter((m) => !m.in_oc).length, transitions } : {}),
    };
  }

  async function getMemberSeries(actor, factionId, playerId, { metric = 'activity', from = null, to = null } = {}) {
    const role = await requireMember(actor, factionId);
    const pid = Number(playerId);
    if (!positiveId(pid)) fail('INVALID_PLAYER_ID', 400);
    const allowedMetrics = new Set(['battlestats', 'activity', 'contribution', 'travel']);
    if (!allowedMetrics.has(String(metric))) fail('INVALID_METRIC', 400);

    const ts = now();
    const toTs = to != null && to !== '' ? Math.floor(Number(to)) : ts;
    const fromTs = from != null && from !== '' ? Math.floor(Number(from)) : toTs - 30 * DAY;
    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs < 0 || toTs < fromTs) fail('INVALID_TIME_RANGE', 400);
    const plan = getPlan(factionId);
    if (toTs - fromTs > 7 * DAY && !plan.active) fail('FACTION_PLAN_REQUIRED', 403);

    const memberRow = db.prepare('SELECT player_id, display_name, level, position, in_oc, activity, health, travel_state, observed_at FROM roster_latest WHERE faction_id=? AND player_id=?').get(factionId, pid);
    if (!memberRow) fail('MEMBER_NOT_IN_FACTION', 404);

    const observations = db.prepare(
      'SELECT slot_at, observed_at, state, travel_state, destination, origin, activity, health FROM roster_observations WHERE faction_id=? AND player_id=? AND observed_at>=? AND observed_at<=? ORDER BY observed_at ASC LIMIT 2000',
    ).all(factionId, pid, fromTs, toTs);

    const transitions = db.prepare(
      'SELECT transition_id, from_state, to_state, destination, origin, seen_from, seen_to, eta_from, eta_to FROM travel_transitions WHERE faction_id=? AND player_id=? AND seen_to>=? AND seen_to<=? ORDER BY seen_to DESC LIMIT 200',
    ).all(factionId, pid, fromTs, toTs);

    const obsList = observations.map((o) => ({
      ts: o.observed_at,
      at: o.observed_at * 1000,
      observedAt: travelRadar.isoUtc(o.observed_at * 1000),
      source: 'shared_hub',
      activity: o.activity,
      health: o.health,
      travelState: o.travel_state,
      destination: o.destination,
      origin: o.origin,
      value: o.activity === 'online' ? 1 : o.activity === 'idle' ? 0.5 : 0,
    }));

    return {
      factionId,
      playerId: pid,
      displayName: memberRow.display_name,
      role: role.role,
      metric,
      source: 'shared_hub',
      from: travelRadar.isoUtc(fromTs * 1000),
      to: travelRadar.isoUtc(toTs * 1000),
      points: obsList,
      observations: obsList,
      transitions: transitions.map((t) => ({
        transitionId: t.transition_id,
        fromState: t.from_state,
        toState: t.to_state,
        destination: t.destination,
        origin: t.origin,
        seenFrom: travelRadar.isoUtc(t.seen_from * 1000),
        seenTo: travelRadar.isoUtc(t.seen_to * 1000),
        seenToSec: t.seen_to,
        etaFrom: t.eta_from,
        etaTo: t.eta_to,
      })),
    };
  }

  /* ---------- Operator Control Screen & Idempotent Jobs (P1.3) ---------- */
  function operatorSummary() {
    const collectors = db.prepare('SELECT faction_id, linked_by_torn_id, key_ref, mode, paused, interval_sec, next_run_at, lease_owner, lease_until, backoff_sec, consecutive_failures, last_run_at, last_success_at, last_latency_ms, last_error_code, last_error_at, planned_slots, observed_slots, planned_calls, manual_calls, retry_calls, version, updated_at FROM faction_collectors ORDER BY faction_id ASC').all();
    const outboxCounts = Object.fromEntries(['pending', 'sent', 'failed', 'needs_review', 'blocked_plan'].map((s) => [s, 0]));
    for (const row of db.prepare('SELECT status, count(*) AS n FROM notification_outbox GROUP BY status').all()) {
      outboxCounts[row.status] = row.n;
    }
    const recentOutbox = db.prepare('SELECT id, idempotency_key, faction_id, event_id, rule_id, scope, status, attempts, last_error, sent_at, created_at FROM notification_outbox ORDER BY id DESC LIMIT 25').all();
    const recentAudit = db.prepare('SELECT id, actor_torn_id, faction_id, action, reason, result, created_at FROM faction_audit ORDER BY id DESC LIMIT 50').all();

    return {
      collectors: collectors.map((c) => ({
        factionId: c.faction_id,
        linkedByTornId: c.linked_by_torn_id,
        keyRef: c.key_ref,
        mode: c.mode,
        paused: Boolean(c.paused),
        intervalSec: c.interval_sec,
        nextRunAt: c.next_run_at,
        backoffSec: c.backoff_sec,
        consecutiveFailures: c.consecutive_failures,
        lastRunAt: c.last_run_at,
        lastSuccessAt: c.last_success_at,
        lastLatencyMs: c.last_latency_ms,
        lastErrorCode: c.last_error_code,
        coveragePct: c.planned_slots > 0 ? Math.round((c.observed_slots / c.planned_slots) * 1000) / 10 : null,
        observedSlots: c.observed_slots,
        plannedSlots: c.planned_slots,
        calls: { planned: c.planned_calls, manual: c.manual_calls, retry: c.retry_calls },
        plan: getPlan(c.faction_id),
      })),
      outbox: { counts: outboxCounts, recent: recentOutbox },
      audit: recentAudit,
    };
  }

  async function operatorJob(actor, body = {}) {
    const reqId = String(body.requestId || '').trim();
    if (reqId.length < 4 || reqId.length > 120) fail('REQUEST_ID_REQUIRED', 400);
    const action = String(body.action || '').trim();
    if (!VALID_ACTIONS.has(action)) fail('INVALID_JOB_ACTION', 400);
    const why = cleanReason(body.reason);
    const factionId = Number(body.factionId) || 0;

    // Idempotency check: same requestId never executes twice!
    const existing = db.prepare('SELECT result_json FROM faction_operator_jobs WHERE request_id=?').get(reqId);
    if (existing) {
      return { idempotentReplay: true, requestId: reqId, result: JSON.parse(existing.result_json) };
    }

    let result;
    if (action === 'pause') {
      if (!positiveId(factionId)) fail('INVALID_FACTION_ID', 400);
      const r = db.prepare('UPDATE faction_collectors SET paused=1, updated_at=? WHERE faction_id=?').run(now(), factionId);
      if (!r.changes) fail('COLLECTOR_NOT_FOUND', 404);
      audit(actor, factionId, 'operator.pause', why, 'ok');
      result = { factionId, paused: true };
    } else if (action === 'resume') {
      if (!positiveId(factionId)) fail('INVALID_FACTION_ID', 400);
      const r = db.prepare('UPDATE faction_collectors SET paused=0, consecutive_failures=0, backoff_sec=0, updated_at=? WHERE faction_id=?').run(now(), factionId);
      if (!r.changes) fail('COLLECTOR_NOT_FOUND', 404);
      audit(actor, factionId, 'operator.resume', why, 'ok');
      result = { factionId, paused: false };
    } else if (action === 'queue_refresh') {
      if (!positiveId(factionId)) fail('INVALID_FACTION_ID', 400);
      result = await tickFaction(factionId, { kind: 'manual' });
      audit(actor, factionId, 'operator.queue_refresh', why, result.status, result);
    } else if (action === 'prune') {
      result = pruneRetention(factionId || null);
      audit(actor, factionId, 'operator.prune', why, 'ok', result);
    } else if (action === 'retry_outbox') {
      const id = positiveId(body.outboxId) ? Number(body.outboxId) : null;
      if (id) {
        db.prepare("UPDATE notification_outbox SET status='pending', next_try_at=0, updated_at=? WHERE id=? AND status IN ('failed','needs_review')").run(now(), id);
      } else {
        db.prepare("UPDATE notification_outbox SET status='pending', next_try_at=0, updated_at=? WHERE status='failed'").run(now());
      }
      result = await dispatchOutbox({ factionId: factionId || null });
      audit(actor, factionId, 'operator.retry_outbox', why, 'ok', result);
    } else if (action === 'preview_notification') {
      result = {
        synthetic: true,
        scope: body.scope === 'officer' ? 'officer' : 'member',
        preview: { kind: 'travel', factionId, displayName: 'Sample player', fromState: 'abroad', toState: 'inbound', origin: 'mex', destination: 'torn', etaKind: 'estimate' },
      };
      audit(actor, factionId, 'operator.preview_notification', why, 'ok');
    } else if (action === 'grant_plan') {
      result = grantPlan(actor, { factionId, tier: body.tier || 'pilot', days: body.days || 30, quotaAlertsPerDay: body.quotaAlertsPerDay || 100, reason: why });
    } else if (action === 'synthetic_plan_event') {
      result = applySyntheticPlanEvent(actor, { factionId, eventId: body.eventId, days: body.days || 30, tier: body.tier || 'team', reason: why });
    }

    db.prepare('INSERT OR IGNORE INTO faction_operator_jobs(request_id, actor_torn_id, faction_id, action, reason, result_json, created_at) VALUES(?,?,?,?,?,?,?)')
      .run(reqId, actor.tornId, factionId, action, why, JSON.stringify(result), now());

    return { idempotentReplay: false, requestId: reqId, result };
  }

  /* ---------- Independent Background Loop ---------- */
  function start(pollMs = 30_000) {
    if (timer || stopped) return;
    timer = setInterval(async () => {
      if (stopped) return;
      try {
        const due = db.prepare('SELECT faction_id FROM faction_collectors WHERE paused=0 AND next_run_at<=?').all(now());
        for (const row of due) await tickFaction(row.faction_id, { kind: 'planned' });
        await dispatchOutbox({ limit: 10 });
      } catch { /* collector errors are tracked per-faction */ }
    }, pollMs);
    timer.unref?.();
  }

  async function stop() {
    stopped = true;
    if (timer) { clearInterval(timer); timer = null; }
    await Promise.allSettled([...inflightTicks.values()]);
  }

  return {
    db,
    transaction,
    now,
    verifyFactionRole,
    getPlan,
    grantPlan,
    applySyntheticPlanEvent,
    getSettings,
    updateSettings,
    acquireLease,
    releaseLease,
    ingestRosterSnapshot,
    tickFaction,
    pruneRetention,
    dispatchOutbox,
    getStatus,
    getHistory,
    getSharedReport,
    getMemberSeries,
    operatorSummary,
    operatorJob,
    start,
    stop,
    close: async () => { await stop(); handle.close(); },
  };
}

module.exports = { createFactionHub, maskApiKey, encryptKey, decryptKey };
