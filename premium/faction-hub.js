const crypto = require('node:crypto');
const { openFactionDatabase } = require('./faction-db');
const { fail, positiveId, DAY } = require('./store');
const { TEST_FACTION_KEY_SECRET } = require('./config');
const travelRadar = require('../public/travel-radar');

// Torn error codes that mean the key itself can no longer be used. This is the set premium/torn-client.js treats as
// fatal (1 empty key, 2 incorrect key, 10 owner in federal jail, 13 key disabled for owner inactivity, 16 access level
// too low, 18 key paused by its owner); a test keeps the two in step.
const FATAL_TORN_CODES = new Set([1, 2, 10, 13, 16, 18]);
const TRANSIENT_TORN_CODES = new Set([5, 8, 9, 17]);
const TORN_BODY_LIMIT = 1024 * 1024;
const MIN_SECRET_LENGTH = 32;
const OFFICER_POSITION_RE = /^(?:leader|co-leader)$/i;
const STALE_AFTER_INTERVALS = 2.5;
// Retention windows advertised in /terms, /v1/info and premium/PRIVACY.md.
const RETENTION = Object.freeze({ rawDays: 30, rollupDays: 180, outboxDays: 30, auditDays: 180 });
const IN_PROGRESS_JOB = '{"inProgress":true}';
const VALID_ACTIONS = new Set(['pause', 'resume', 'queue_refresh', 'prune', 'retry_outbox', 'preview_notification', 'grant_plan', 'synthetic_plan_event']);
const DISCORD_WEBHOOK_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{10,25}\/[A-Za-z0-9_-]{20,120}$/;
const METRIC_VALUE = {
  activity: (o) => {
    const s = String(o.activity || '').toLowerCase();
    return s === 'online' ? 1 : s === 'idle' ? 0.5 : 0;
  },
  // 1 while the member is away from Torn (flying either way, abroad, or an unparsed travel status)
  travel: (o) => (o.travel_state && o.travel_state !== 'none_observed' ? 1 : 0),
};

const noRole = () => ({ inFaction: false, role: 'none', officer: false, position: '' });
const hubError = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });

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

// Every mode needs a real secret: a random per-process secret would make stored keys unreadable after a restart.
// Test installations get a fixed secret from premium/config.js, which live mode refuses.
function deriveSecretKey(secret, mode) {
  const raw = String(secret || '').trim();
  if (raw.length < MIN_SECRET_LENGTH || /replace|change.?me/i.test(raw)) return null;
  if (mode !== 'test' && raw === TEST_FACTION_KEY_SECRET) return null;
  return crypto.createHash('sha256').update(raw).digest();
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
    rawRetentionDays: RETENTION.rawDays,
    rollupRetentionDays: RETENTION.rollupDays,
  };
}

// Reads a Torn response with the same 1 MiB cap premium/torn-client.js applies.
async function readCappedJson(res, limit = TORN_BODY_LIMIT) {
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    try { await res.body?.cancel?.(); } catch {}
    throw hubError('UPSTREAM_BODY_LIMIT', { transient: true });
  }
  let text;
  if (res.body?.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > limit) {
          await reader.cancel().catch(() => {});
          throw hubError('UPSTREAM_BODY_LIMIT', { transient: true });
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    text = Buffer.concat(chunks).toString('utf8');
  } else {
    text = await res.text();
    if (Buffer.byteLength(text) > limit) throw hubError('UPSTREAM_BODY_LIMIT', { transient: true });
  }
  try { return JSON.parse(text); } catch { throw hubError('UPSTREAM_JSON', { transient: true }); }
}

// In-memory stand-in for store.apiBudget when the hub runs without the premium store (unit tests).
function createLocalBudget(now) {
  const windows = new Map();
  return (key, maximum = 30) => {
    const ts = now();
    const id = crypto.createHash('sha256').update(String(key)).digest('hex');
    let w = windows.get(id);
    if (!w || w.start + 60 <= ts) {
      w = { start: ts, count: 0 };
      windows.set(id, w);
    }
    if (w.count >= maximum) return w.start + 60 - ts;
    w.count++;
    if (windows.size > 10_000) for (const [k, v] of windows) if (v.start + 60 <= ts) windows.delete(k);
    return 0;
  };
}

// Stand-in used when the hub cannot start (missing secret, unreadable database): login, payments and the rest of the
// premium service keep working and every hub route answers 503 FACTION_HUB_UNAVAILABLE.
function createUnavailableFactionHub(reason = 'FACTION_HUB_UNAVAILABLE') {
  const unavailable = () => fail('FACTION_HUB_UNAVAILABLE', 503);
  const rejecting = async () => unavailable();
  return {
    available: false,
    reason,
    verifyFactionRole: rejecting,
    getSettings: rejecting,
    updateSettings: rejecting,
    tickFaction: rejecting,
    dispatchOutbox: rejecting,
    getStatus: rejecting,
    getHistory: rejecting,
    getSharedReport: rejecting,
    getMemberSeries: rejecting,
    operatorJob: rejecting,
    runCycle: rejecting,
    getPlan: unavailable,
    grantPlan: unavailable,
    applySyntheticPlanEvent: unavailable,
    acquireLease: unavailable,
    releaseLease: unavailable,
    ingestRosterSnapshot: unavailable,
    pruneRetention: unavailable,
    runDailyMaintenance: unavailable,
    operatorSummary: unavailable,
    exportUserData: () => ({ available: false, code: 'FACTION_HUB_UNAVAILABLE' }),
    eraseUserData: () => ({ available: false, erased: false, code: 'FACTION_HUB_UNAVAILABLE' }),
    start() {},
    stop: async () => {},
    close: async () => {},
  };
}

function createFactionHub(config, dependencies = {}) {
  const now = dependencies.now || (() => Math.floor(Date.now() / 1000));
  // Validate the secret before opening the database so a refused start-up leaves no open handle behind.
  const keyBuf = deriveSecretKey(dependencies.factionKeySecret ?? config.factionKeySecret, config.mode);
  if (!keyBuf) fail('FACTION_KEY_SECRET_NOT_CONFIGURED', 503);
  const dbPath = dependencies.factionDbPath || config.factionDbPath || ':memory:';
  const handle = openFactionDatabase(dbPath, { mode: config.mode, now });
  const { db, transaction } = handle;
  const fetchImpl = dependencies.fetchImpl || global.fetch;
  const apiBudget = dependencies.apiBudget || createLocalBudget(now);
  const notifyProvider = dependencies.notifyProvider || null;
  // Test seams. Production: roles come from the collected roster and the connect-time Torn check below.
  const roleVerifier = dependencies.roleVerifier || null;
  const rosterFetcher = dependencies.rosterFetcher || null;
  // Unique per process (and per hub instance), so processes sharing the database never mistake each other's lease.
  const processOwner = `collector:${process.pid}:${crypto.randomBytes(6).toString('hex')}`;

  const inflight = new Set();
  const inflightTicks = new Map();
  let timer = null;
  let stopped = false;
  let closed = false;
  let closing = null;
  let cycleRunning = null;
  let dispatchRunning = null;

  // A delivery interrupted by a crash or restart may already have reached Discord: park it for review, never resend it.
  db.prepare("UPDATE notification_outbox SET status='needs_review', last_error='DELIVERY_INTERRUPTED', updated_at=? WHERE status='sending'").run(now());

  function audit(actor, factionId, action, reason = '', result = 'ok', meta = null) {
    db.prepare(
      'INSERT INTO faction_audit(actor_torn_id, faction_id, action, reason, result, meta_json, created_at) VALUES(?,?,?,?,?,?,?)',
    ).run(actor?.tornId ?? null, Number(factionId) || 0, String(action), String(reason || ''), String(result), meta ? JSON.stringify(meta) : null, now());
  }

  function tryDecrypt(cipher) {
    try { return decryptKey(cipher, keyBuf); } catch { return ''; }
  }

  /* ---------- Torn access (connect-time verification and the collector only) ---------- */
  async function tornGet(pathname, apiKey) {
    if (!/^[A-Za-z0-9]{16}$/.test(apiKey || '')) throw hubError('TORN_KEY_INVALID', { fatal: true });
    // Shares the per-key and service-wide budgets premium/torn-client.js uses when the premium store is wired in.
    for (const [bucket, maximum] of [[apiKey, 20], ['service:all-keys', 2000]]) {
      const wait = apiBudget(bucket, maximum);
      if (wait) throw hubError('LOCAL_API_BUDGET', { transient: true, retryAfter: wait });
    }
    const url = new URL(pathname, 'https://api.torn.com');
    url.searchParams.set('comment', 'LRXFactionHub');
    let res;
    try {
      res = await fetchImpl(url.toString(), {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: { Authorization: 'ApiKey ' + apiKey, 'User-Agent': 'LRX-TornTracker-Premium/1.0' },
      });
    } catch {
      throw hubError('UPSTREAM_NETWORK', { transient: true });
    }
    if (res.status === 429) throw hubError('TORN_429', { transient: true });
    if (!res.ok) throw hubError('UPSTREAM_HTTP_' + res.status, { transient: true });
    const data = await readCappedJson(res);
    if (data?.error) {
      const code = Number(data.error.code);
      const known = Number.isSafeInteger(code);
      throw hubError('TORN_' + (known ? code : 'ERROR'), { tornCode: known ? code : null, fatal: known && FATAL_TORN_CODES.has(code), transient: known && TRANSIENT_TORN_CODES.has(code) });
    }
    return data;
  }

  // Connecting a collector key is the only moment the hub asks Torn about a person: the submitted key must belong to
  // the caller, the caller must be in this faction, and their position must be Leader or Co-leader.
  async function verifyConnectKey(actor, factionId, rawKey) {
    if (apiBudget('faction-connect:' + actor.tornId, 6)) fail('FACTION_CONNECT_RATE_LIMIT', 429);
    let faction;
    try {
      const info = await tornGet('/v2/key/info', rawKey);
      const owner = Number(info?.info?.user?.id);
      if (!positiveId(owner)) fail('UPSTREAM_SCHEMA', 503);
      if (owner !== Number(actor.tornId)) fail('FACTION_KEY_OWNER_MISMATCH', 403);
      const fac = await tornGet('/v2/user/faction', rawKey);
      faction = fac?.faction ?? null;
    } catch (error) {
      if (error?.fatal) fail(error.code, 400); // Torn refused the key itself (wrong, paused, too little access …)
      throw error;
    }
    if (!faction || Number(faction.id) !== Number(factionId)) fail('FACTION_KEY_FACTION_MISMATCH', 403);
    const position = String(faction.position || '');
    if (!OFFICER_POSITION_RE.test(position)) fail('FACTION_OFFICER_REQUIRED', 403);
    return { inFaction: true, role: 'officer', officer: true, position, source: 'torn' };
  }

  /* ---------- Role & Membership (no Torn request per hub read) ---------- */
  function rosterRole(tornId, factionId) {
    const col = db.prepare('SELECT linked_by_torn_id, key_cipher FROM faction_collectors WHERE faction_id=?').get(factionId);
    const keyOwner = Boolean(col && col.key_cipher && Number(col.linked_by_torn_id) === Number(tornId));
    const row = db.prepare('SELECT position FROM roster_latest WHERE faction_id=? AND player_id=?').get(factionId, tornId);
    if (row) {
      const position = String(row.position || '');
      const officer = OFFICER_POSITION_RE.test(position) || keyOwner;
      return { inFaction: true, role: officer ? 'officer' : 'member', officer, position, source: 'roster' };
    }
    // Before the first snapshot only the officer whose key was verified at connect time has access.
    if (keyOwner && !db.prepare('SELECT 1 FROM roster_latest WHERE faction_id=? LIMIT 1').get(factionId)) {
      return { inFaction: true, role: 'officer', officer: true, position: '', source: 'connect' };
    }
    return noRole();
  }

  async function verifyFactionRole(actor, factionId) {
    if (!actor || !positiveId(actor.tornId)) fail('AUTH_REQUIRED', 401);
    if (!positiveId(factionId)) fail('INVALID_FACTION_ID', 400);
    if (roleVerifier) {
      const res = await roleVerifier(actor.tornId, factionId);
      if (!res || !res.inFaction || Number(res.factionId) !== Number(factionId)) return noRole();
      const officer = Boolean(res.officer || res.role === 'leader' || res.role === 'co-leader' || res.role === 'officer');
      return { inFaction: true, role: officer ? 'officer' : 'member', officer, position: String(res.position || '') };
    }
    return rosterRole(actor.tornId, factionId);
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
      return { active: false, tier: 'none', version: 0, status: 'none', startsAt: null, endsAt: null, remainingDays: 0, quotaAlertsPerDay: 0, rawRetentionDays: RETENTION.rawDays, rollupRetentionDays: RETENTION.rollupDays };
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

  function grantPlan(actor, { factionId, tier = 'pilot', days = 30, quotaAlertsPerDay = 100, rawRetentionDays = RETENTION.rawDays, rollupRetentionDays = RETENTION.rollupDays, reason }) {
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
    if (!actor || !positiveId(actor.tornId)) fail('AUTH_REQUIRED', 401);
    if (!positiveId(factionId)) fail('INVALID_FACTION_ID', 400);
    const why = cleanReason(body.reason || 'Settings update');
    const connecting = body.disconnectKey !== true && typeof body.connectKey === 'string' && body.connectKey.trim() !== '';
    let rawKey = '';
    if (connecting) {
      if (body.consent !== true) fail('CONSENT_REQUIRED', 400);
      rawKey = body.connectKey.trim();
      if (!/^[A-Za-z0-9]{16}$/.test(rawKey)) fail('INVALID_API_KEY', 400);
      // The submitted key itself proves the caller leads this faction; no stored key is used for the check.
      if (roleVerifier) await requireOfficer(actor, factionId);
      else await verifyConnectKey(actor, factionId, rawKey);
    } else {
      await requireOfficer(actor, factionId);
    }
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
      let linkedBy = col ? col.linked_by_torn_id : actor.tornId;

      if (body.disconnectKey === true) {
        keyRef = '';
        keyCipher = '';
        paused = 1;
        audit(actor, factionId, 'collector.disconnect', why, 'ok', null);
      } else if (connecting) {
        keyRef = maskApiKey(rawKey);
        keyCipher = encryptKey(rawKey, keyBuf);
        paused = 0;
        linkedBy = actor.tornId;
        // Connecting a key is an explicit opt-in, so it lifts an earlier erasure of this player.
        db.prepare('DELETE FROM faction_hub_erasures WHERE torn_id=?').run(actor.tornId);
        audit(actor, factionId, 'collector.connect', why, 'ok', { keyRef });
      }
      if (typeof body.paused === 'boolean' && !body.disconnectKey) {
        paused = body.paused ? 1 : 0;
      }

      if (col) {
        db.prepare(
          'UPDATE faction_collectors SET linked_by_torn_id=?, key_ref=?, key_cipher=?, paused=?, version=version+1, settings_json=?, updated_at=? WHERE faction_id=?',
        ).run(linkedBy, keyRef, keyCipher, paused, JSON.stringify(curSettings), ts, factionId);
        if (connecting) {
          db.prepare('UPDATE faction_collectors SET consecutive_failures=0, backoff_sec=0, next_run_at=0, last_error_code=NULL WHERE faction_id=?').run(factionId);
        }
      } else {
        db.prepare(
          'INSERT INTO faction_collectors(faction_id, linked_by_torn_id, key_ref, key_cipher, mode, paused, interval_sec, next_run_at, version, settings_json, created_at, updated_at) VALUES(?,?,?,?,?,?,300,0,1,?,?,?)',
        ).run(factionId, linkedBy, keyRef, keyCipher, 'pilot', paused, JSON.stringify(curSettings), ts, ts);
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
  function acquireLease(factionId, owner = processOwner, ttlSec = 120) {
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

  // Rebuilds the radar's in-flight legs (departure window per player) so an ETA estimate survives later cycles.
  function activeTransitionsFor(factionId) {
    const rows = db.prepare(
      `SELECT t.player_id, t.to_state, t.origin, t.destination, t.seen_from, t.seen_to
         FROM travel_transitions t
         JOIN roster_latest r ON r.faction_id=t.faction_id AND r.player_id=t.player_id
        WHERE t.faction_id=? AND r.travel_state IN ('outbound','inbound') AND t.to_state=r.travel_state
          AND IFNULL(t.origin,'')=IFNULL(r.origin,'') AND IFNULL(t.destination,'')=IFNULL(r.destination,'')
        ORDER BY t.seen_to ASC`,
    ).all(factionId);
    const active = new Map();
    for (const t of rows) {
      active.set(Number(t.player_id), { leg: `${t.to_state}:${t.origin || ''}:${t.destination || ''}`, seenFromMs: t.seen_from * 1000, seenToMs: t.seen_to * 1000 });
    }
    return active;
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

      // Players who asked for erasure are never recorded again.
      const erased = new Set(db.prepare('SELECT torn_id FROM faction_hub_erasures').all().map((r) => Number(r.torn_id)));
      const kept = (Array.isArray(members) ? members : []).filter((m) => !erased.has(Math.floor(Number(m?.id ?? m?.playerId) || 0)));

      const prevRows = db.prepare('SELECT player_id, travel_state, origin, destination, observed_at FROM roster_latest WHERE faction_id=?').all(factionId);
      const prevByPlayer = new Map();
      let prevObservedSec = 0;
      for (const r of prevRows) {
        prevByPlayer.set(r.player_id, { travelState: r.travel_state, origin: r.origin, destination: r.destination });
        if (r.observed_at > prevObservedSec) prevObservedSec = r.observed_at;
      }
      // Only the newest snapshot may change roster_latest; an out-of-order older one only adds history.
      const newest = obsSec >= prevObservedSec;

      const radar = travelRadar.buildRadarPayload({
        factionId,
        members: kept,
        prevByPlayer,
        prevObservedAtMs: prevObservedSec * 1000,
        activeTransitions: activeTransitionsFor(factionId),
        observedAtMs: obsSec * 1000,
        receivedAtMs: recSec * 1000,
        nowMs: recSec * 1000,
      });

      const alreadySlot = db.prepare('SELECT 1 FROM faction_observed_slots WHERE faction_id=? AND slot_at=?').get(factionId, slot);
      let online = 0, idle = 0, offline = 0;
      const insObs = db.prepare(
        'INSERT OR IGNORE INTO roster_observations(faction_id, slot_at, player_id, observed_at, received_at, state, travel_state, destination, origin, activity, health, raw_desc) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      );
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
        if (newest) {
          upsertLatest.run(
            factionId, m.playerId, 1, obsSec, recSec, m.displayName, m.level, m.position, m.inOc ? 1 : 0, m.lastRel,
            m.healthStatus, m.travelState, m.destination, m.origin, m.activityStatus, m.healthStatus,
            m.etaKind, m.etaFrom, m.etaTo, m.etaAt, m.rawDescription,
          );
        }
      }
      // Members missing from the newest snapshot left the faction. An empty list is never read as "everyone left".
      let removedMembers = 0;
      if (newest && radar.allMembers.length > 0) {
        removedMembers = Number(db.prepare('DELETE FROM roster_latest WHERE faction_id=? AND player_id NOT IN (SELECT value FROM json_each(?))')
          .run(factionId, JSON.stringify(radar.allMembers.map((m) => m.playerId))).changes);
      }

      // Idempotent transitions & outbox enqueue. Alerts are queued only while the plan is active and within its daily quota.
      const plan = getPlan(factionId);
      const settings = { ...defaultSettings(), ...parseSettings(col.settings_json) };
      const watchedSet = new Set((settings.watchedPlayers || []).map(Number));
      const notifyEnabled = Boolean(plan.active && settings.notifications?.travel && settings.discordWebhook);
      const quota = Math.max(0, Math.floor(Number(plan.quotaAlertsPerDay) || 0));
      let queuedToday = notifyEnabled
        ? db.prepare('SELECT count(*) AS n FROM notification_outbox WHERE faction_id=? AND created_at>=?').get(factionId, Math.floor(recSec / DAY) * DAY).n
        : 0;
      const insTrans = db.prepare(
        'INSERT OR IGNORE INTO travel_transitions(faction_id, player_id, transition_id, from_state, to_state, destination, origin, seen_from, seen_to, eta_from, eta_to, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      );
      const insOutbox = db.prepare(
        'INSERT OR IGNORE INTO notification_outbox(idempotency_key, faction_id, event_id, destination, rule_id, scope, payload_json, status, attempts, next_try_at, created_at, updated_at) VALUES(?,?,?,?,?,?,?,\'pending\',0,?,?,?)',
      );

      let queuedAlerts = 0;
      let suppressedAlerts = 0;
      for (const tr of radar.transitions) {
        const curRow = radar.allMembers.find((x) => x.playerId === tr.playerId);
        insTrans.run(factionId, tr.playerId, tr.transitionId, tr.fromState, tr.toState, tr.destination, tr.origin, Math.floor(tr.seenFromMs / 1000), Math.floor(tr.seenToMs / 1000), curRow?.etaFrom || null, curRow?.etaTo || null, recSec);

        // Travel notification when enabled and (no watchlist filter OR player is watched)
        const wanted = notifyEnabled
          && (watchedSet.size === 0 || watchedSet.has(tr.playerId))
          && (tr.toState === 'outbound' || tr.toState === 'inbound' || tr.toState === 'abroad');
        if (!wanted) continue;
        if (queuedToday >= quota) {
          suppressedAlerts++;
          continue;
        }
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
        if (Number(res.changes) > 0) {
          queuedAlerts++;
          queuedToday++;
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
        removedMembers,
        travelCount: radar.travel.length,
        transitionsCount: radar.transitions.length,
        queuedAlerts,
        suppressedAlerts,
      };
    });
  }

  function pauseCollector(factionId, code, reason) {
    const ts = now();
    db.prepare('UPDATE faction_collectors SET paused=1, last_error_code=?, last_error_at=?, updated_at=? WHERE faction_id=?').run(code, ts, ts, factionId);
    audit(null, factionId, 'collector.auto_paused', reason, 'paused', { code });
  }

  /* ---------- Independent Collector Tick (P1.2 / P1.3) ---------- */
  async function tickFaction(factionId, { kind = 'planned' } = {}) {
    if (inflightTicks.has(factionId)) return inflightTicks.get(factionId);
    const run = (async () => {
      const col = db.prepare('SELECT * FROM faction_collectors WHERE faction_id=?').get(factionId);
      if (!col) return { status: 'not_found' };
      if (col.paused) return { status: 'paused' };
      if (!col.key_cipher && !rosterFetcher) return { status: 'no_key' };
      // Never spend Torn requests on a faction without an active plan (none, expired or cancelled).
      if (!getPlan(factionId).active) return { status: 'plan_inactive' };

      const ts = now();
      // Respect backoff/cooldown window (even on manual refresh!)
      if (col.next_run_at > ts && (kind === 'planned' || col.backoff_sec > 0)) {
        return { status: 'cooldown', nextRunAt: col.next_run_at };
      }

      let apiKey = '';
      if (!rosterFetcher) {
        apiKey = tryDecrypt(col.key_cipher);
        if (!apiKey) {
          pauseCollector(factionId, 'FACTION_KEY_DECRYPT_FAILED', 'Stored key cannot be read with the configured secret; reconnect the key');
          return { status: 'key_unreadable', code: 'FACTION_KEY_DECRYPT_FAILED' };
        }
      }

      const lease = acquireLease(factionId, processOwner, 120);
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
          // Ask for this faction by id: if the key owner moved to another faction, their key cannot silently start
          // filling this faction's history with someone else's roster.
          const data = await tornGet(`/v2/faction/${factionId}/members`, apiKey);
          if (!Array.isArray(data?.members) || data.members.length === 0) throw hubError('UPSTREAM_SCHEMA', { transient: true });
          if (!data.members.some((m) => Number(m?.id) === Number(col.linked_by_torn_id))) {
            pauseCollector(factionId, 'FACTION_KEY_OWNER_LEFT', 'The key owner is no longer in this faction');
            return { status: 'owner_left_paused', code: 'FACTION_KEY_OWNER_LEFT' };
          }
          members = data.members;
        }
        const latencyMs = Date.now() - started;
        const slotAt = Math.floor(observedAt / col.interval_sec) * col.interval_sec;
        const result = ingestRosterSnapshot({ factionId, leaseToken: lease.token, slotAt, observedAt, receivedAt: now(), members, latencyMs });
        return { status: 'ok', ...result };
      } catch (err) {
        const tsErr = now();
        const code = /^[A-Z0-9_]+$/.test(String(err?.code || '')) ? String(err.code) : 'UPSTREAM_ERROR';
        const revoked = Boolean(err?.fatal);
        const fails = col.consecutive_failures + 1;
        const backoff = revoked ? 0 : Math.min(3600, Math.max(60, col.interval_sec * Math.pow(2, Math.min(fails - 1, 4))));
        // Only ever set the pause here: an officer may have paused the collector while the request was in flight.
        db.prepare(
          'UPDATE faction_collectors SET paused=CASE WHEN ?=1 THEN 1 ELSE paused END, planned_slots=planned_slots+1, consecutive_failures=consecutive_failures+1, backoff_sec=?, next_run_at=?, last_error_code=?, last_error_at=?, updated_at=? WHERE faction_id=?',
        ).run(revoked ? 1 : 0, backoff, tsErr + backoff, code, tsErr, tsErr, factionId);
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
    const out = { deletedRaw: 0, deletedRollups: 0, deletedOutbox: 0, deletedAudit: 0, deletedJobs: 0 };
    transaction(() => {
      for (const c of cols) {
        const plan = getPlan(c.faction_id);
        const s = { ...defaultSettings(), ...parseSettings(c.settings_json) };
        const rawDays = plan.active ? plan.rawRetentionDays : (s.rawRetentionDays || RETENTION.rawDays);
        const rollupDays = plan.active ? plan.rollupRetentionDays : (s.rollupRetentionDays || RETENTION.rollupDays);
        const rawCut = ts - rawDays * DAY;
        const rollupCut = ts - rollupDays * DAY;
        out.deletedRaw += Number(db.prepare('DELETE FROM roster_observations WHERE faction_id=? AND observed_at<?').run(c.faction_id, rawCut).changes);
        db.prepare('DELETE FROM faction_observed_slots WHERE faction_id=? AND observed_at<?').run(c.faction_id, rawCut);
        db.prepare('DELETE FROM travel_transitions WHERE faction_id=? AND seen_to<?').run(c.faction_id, rawCut);
        out.deletedRollups += Number(db.prepare('DELETE FROM activity_rollups WHERE faction_id=? AND bucket_at<?').run(c.faction_id, rollupCut).changes);
      }
      const scope = factionId ? ' AND faction_id=?' : '';
      const args = factionId ? [factionId] : [];
      out.deletedOutbox = Number(db.prepare(`DELETE FROM notification_outbox WHERE created_at<? AND status<>'sending'${scope}`).run(ts - RETENTION.outboxDays * DAY, ...args).changes);
      out.deletedAudit = Number(db.prepare(`DELETE FROM faction_audit WHERE created_at<?${scope}`).run(ts - RETENTION.auditDays * DAY, ...args).changes);
      out.deletedJobs = Number(db.prepare(`DELETE FROM faction_operator_jobs WHERE created_at<?${scope}`).run(ts - RETENTION.auditDays * DAY, ...args).changes);
    });
    return out;
  }

  // Called by the background cycle; runs the full retention sweep at most once a day (tracked across restarts).
  function runDailyMaintenance() {
    const ts = now();
    const last = Number(db.prepare("SELECT value FROM faction_hub_metadata WHERE key='last_retention_at'").get()?.value || 0);
    if (last && ts >= last && ts - last < DAY) return { skipped: true, lastRunAt: last };
    const result = pruneRetention(null);
    db.prepare("INSERT INTO faction_hub_metadata(key, value) VALUES('last_retention_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(ts));
    return { skipped: false, ...result };
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

  // One dispatch at a time per process; rows are also claimed atomically, so a second process cannot send them either.
  async function dispatchOutbox(options = {}) {
    while (dispatchRunning) {
      try { await dispatchRunning; } catch {}
    }
    const run = runDispatch(options);
    dispatchRunning = run;
    try { return await run; }
    finally { if (dispatchRunning === run) dispatchRunning = null; }
  }

  async function runDispatch({ limit = 20, factionId = null } = {}) {
    const ts = now();
    const rows = factionId
      ? db.prepare("SELECT * FROM notification_outbox WHERE faction_id=? AND status='pending' AND next_try_at<=? ORDER BY id ASC LIMIT ?").all(factionId, ts, limit)
      : db.prepare("SELECT * FROM notification_outbox WHERE status='pending' AND next_try_at<=? ORDER BY id ASC LIMIT ?").all(ts, limit);
    const claim = db.prepare("UPDATE notification_outbox SET status='sending', updated_at=? WHERE id=? AND status='pending'");

    let processed = 0, sent = 0, failed = 0, needsReview = 0, blocked = 0;
    for (const row of rows) {
      if (stopped) break;
      if (!Number(claim.run(now(), row.id).changes)) continue; // someone else already took (or changed) this row
      processed++;
      const plan = getPlan(row.faction_id);
      if (!plan.active) {
        // Stale alerts are not sent late after a renewal; retention removes them after RETENTION.outboxDays.
        db.prepare("UPDATE notification_outbox SET status='blocked_plan', last_error='FACTION_PLAN_INACTIVE', updated_at=? WHERE id=? AND status='sending'").run(now(), row.id);
        blocked++;
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
        db.prepare("UPDATE notification_outbox SET status='sent', attempts=attempts+1, sent_at=?, last_error=NULL, updated_at=? WHERE id=? AND status='sending'")
          .run(now(), now(), row.id);
        sent++;
      } catch (err) {
        const uncertain = err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.uncertain === true;
        if (uncertain) {
          // Uncertain delivery: NEVER blindly retry — place in needs_review!
          db.prepare("UPDATE notification_outbox SET status='needs_review', attempts=attempts+1, last_error=?, updated_at=? WHERE id=? AND status='sending'")
            .run(String(err.message || 'UNCERTAIN_TIMEOUT'), now(), row.id);
          needsReview++;
        } else {
          const attempts = row.attempts + 1;
          const nextStatus = err?.permanent || attempts >= 3 ? 'failed' : 'pending';
          const nextTry = now() + Math.min(900, 60 * Math.pow(2, attempts - 1));
          db.prepare("UPDATE notification_outbox SET status=?, attempts=?, next_try_at=?, last_error=?, updated_at=? WHERE id=? AND status='sending'")
            .run(nextStatus, attempts, nextTry, String(err.message || 'DELIVERY_ERROR'), now(), row.id);
          failed++;
        }
      }
    }
    return { processed, sent, failed, needsReview, blocked };
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
    // A snapshot is only stale once more than one collection has clearly been missed.
    const staleAfterSec = Math.round((col.interval_sec || 300) * STALE_AFTER_INTERVALS);
    const freshState = !latestObs ? 'awaiting_first' : ageSec > staleAfterSec ? 'stale' : 'fresh';
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
        staleAfterSec,
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
    const metricName = String(metric);
    const allowedMetrics = new Set(['battlestats', 'activity', 'contribution', 'travel']);
    if (!allowedMetrics.has(metricName)) fail('INVALID_METRIC', 400);

    const ts = now();
    const toTs = to != null && to !== '' ? Math.floor(Number(to)) : ts;
    const fromTs = from != null && from !== '' ? Math.floor(Number(from)) : toTs - 30 * DAY;
    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs < 0 || toTs < fromTs) fail('INVALID_TIME_RANGE', 400);
    const plan = getPlan(factionId);
    if (toTs - fromTs > 7 * DAY && !plan.active) fail('FACTION_PLAN_REQUIRED', 403);

    const memberRow = db.prepare('SELECT player_id, display_name, level, position, in_oc, activity, health, travel_state, observed_at FROM roster_latest WHERE faction_id=? AND player_id=?').get(factionId, pid);
    if (!memberRow) fail('MEMBER_NOT_IN_FACTION', 404);

    // The hub only collects the member list: battle stats and contributions are not available from it.
    const valueOf = METRIC_VALUE[metricName] || null;
    const observations = valueOf
      ? db.prepare(
        'SELECT slot_at, observed_at, state, travel_state, destination, origin, activity, health FROM roster_observations WHERE faction_id=? AND player_id=? AND observed_at>=? AND observed_at<=? ORDER BY observed_at ASC LIMIT 2000',
      ).all(factionId, pid, fromTs, toTs)
      : [];

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
      value: valueOf(o),
    }));

    return {
      factionId,
      playerId: pid,
      displayName: memberRow.display_name,
      role: role.role,
      metric: metricName,
      available: Boolean(valueOf),
      ...(valueOf ? {} : { reason: 'METRIC_NOT_COLLECTED' }),
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

  /* ---------- Personal data: export & erasure ---------- */
  const payloadPlayer = "CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.playerId') END";

  function exportUserData(tornId) {
    const id = Number(tornId);
    if (!positiveId(id)) fail('IDENTITY_INVALID', 400);
    const collectorsLinked = db.prepare('SELECT faction_id, key_ref, key_cipher, paused, settings_json, created_at, updated_at FROM faction_collectors WHERE linked_by_torn_id=? ORDER BY faction_id').all(id).map((c) => {
      const s = { ...defaultSettings(), ...parseSettings(c.settings_json) };
      return {
        factionId: c.faction_id,
        keyConnected: Boolean(c.key_cipher),
        keyRef: c.key_ref,
        paused: Boolean(c.paused),
        settings: { ...s, discordWebhook: s.discordWebhook ? 'configured' : '' },
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      };
    });
    const watchedInFactions = db.prepare('SELECT faction_id, settings_json FROM faction_collectors ORDER BY faction_id').all()
      .filter((c) => (parseSettings(c.settings_json).watchedPlayers || []).map(Number).includes(id))
      .map((c) => c.faction_id);
    const rosterLatest = db.prepare('SELECT faction_id, observed_at, display_name, level, position, in_oc, last_rel, activity, health, travel_state, destination, origin, eta_kind, eta_from, eta_to FROM roster_latest WHERE player_id=? ORDER BY faction_id').all(id)
      .map((r) => ({ factionId: r.faction_id, observedAt: r.observed_at, displayName: r.display_name, level: r.level, position: r.position, inOc: Boolean(r.in_oc), lastAction: r.last_rel, activity: r.activity, health: r.health, travelState: r.travel_state, destination: r.destination, origin: r.origin, etaKind: r.eta_kind, etaFrom: r.eta_from, etaTo: r.eta_to }));
    const observations = db.prepare('SELECT faction_id, observed_at, activity, health, travel_state, destination, origin FROM roster_observations WHERE player_id=? ORDER BY observed_at, faction_id').all(id)
      .map((o) => ({ factionId: o.faction_id, observedAt: o.observed_at, activity: o.activity, health: o.health, travelState: o.travel_state, destination: o.destination, origin: o.origin }));
    const transitions = db.prepare('SELECT faction_id, from_state, to_state, destination, origin, seen_from, seen_to, eta_from, eta_to FROM travel_transitions WHERE player_id=? ORDER BY seen_to, faction_id').all(id)
      .map((t) => ({ factionId: t.faction_id, fromState: t.from_state, toState: t.to_state, destination: t.destination, origin: t.origin, seenFrom: t.seen_from, seenTo: t.seen_to, etaFrom: t.eta_from, etaTo: t.eta_to }));
    const notifications = db.prepare(`SELECT faction_id, rule_id, status, created_at, sent_at FROM notification_outbox WHERE ${payloadPlayer}=? ORDER BY id`).all(id)
      .map((n) => ({ factionId: n.faction_id, ruleId: n.rule_id, status: n.status, createdAt: n.created_at, sentAt: n.sent_at }));
    const audit = db.prepare('SELECT faction_id, action, reason, result, created_at FROM faction_audit WHERE actor_torn_id=? ORDER BY id').all(id)
      .map((a) => ({ factionId: a.faction_id, action: a.action, reason: a.reason, result: a.result, createdAt: a.created_at }));
    const erasure = db.prepare('SELECT erased_at FROM faction_hub_erasures WHERE torn_id=?').get(id);
    return { available: true, exportedAt: now(), collectorsLinked, watchedInFactions, rosterLatest, observations, transitions, notifications, audit, erasedAt: erasure?.erased_at || null };
  }

  // Hub data is not needed for payment disputes, so it is erased immediately: the player's roster rows and alerts go,
  // later snapshots skip them, and any collector key they connected is deleted (that collector pauses). Hub audit
  // records stay for their retention period, like the main service's audit trail.
  function eraseUserData(tornId) {
    const id = Number(tornId);
    if (!positiveId(id)) fail('IDENTITY_INVALID', 400);
    const ts = now();
    return transaction(() => {
      db.prepare('INSERT INTO faction_hub_erasures(torn_id, erased_at) VALUES(?,?) ON CONFLICT(torn_id) DO UPDATE SET erased_at=excluded.erased_at').run(id, ts);
      const disconnectedFactions = [];
      for (const c of db.prepare('SELECT faction_id, key_cipher FROM faction_collectors WHERE linked_by_torn_id=? ORDER BY faction_id').all(id)) {
        db.prepare(
          "UPDATE faction_collectors SET linked_by_torn_id=0, key_ref='', key_cipher='', paused=CASE WHEN key_cipher<>'' THEN 1 ELSE paused END, last_error_code=CASE WHEN key_cipher<>'' THEN 'KEY_OWNER_ERASED' ELSE last_error_code END, version=version+1, updated_at=? WHERE faction_id=?",
        ).run(ts, c.faction_id);
        if (c.key_cipher) {
          disconnectedFactions.push(c.faction_id);
          audit(null, c.faction_id, 'collector.erasure_disconnect', 'Key owner requested erasure', 'paused');
        }
      }
      for (const c of db.prepare('SELECT faction_id, settings_json FROM faction_collectors').all()) {
        const s = parseSettings(c.settings_json);
        if (Array.isArray(s.watchedPlayers) && s.watchedPlayers.map(Number).includes(id)) {
          s.watchedPlayers = s.watchedPlayers.filter((p) => Number(p) !== id);
          db.prepare('UPDATE faction_collectors SET settings_json=?, version=version+1, updated_at=? WHERE faction_id=?').run(JSON.stringify(s), ts, c.faction_id);
        }
      }
      const deleted = {
        rosterLatest: Number(db.prepare('DELETE FROM roster_latest WHERE player_id=?').run(id).changes),
        observations: Number(db.prepare('DELETE FROM roster_observations WHERE player_id=?').run(id).changes),
        transitions: Number(db.prepare('DELETE FROM travel_transitions WHERE player_id=?').run(id).changes),
        notifications: Number(db.prepare(`DELETE FROM notification_outbox WHERE status<>'sending' AND ${payloadPlayer}=?`).run(id).changes),
      };
      return { available: true, erased: true, erasedAt: ts, disconnectedFactions, deleted };
    });
  }

  /* ---------- Operator Control Screen & Idempotent Jobs (P1.3) ---------- */
  function operatorSummary() {
    const collectors = db.prepare('SELECT faction_id, linked_by_torn_id, key_ref, mode, paused, interval_sec, next_run_at, lease_owner, lease_until, backoff_sec, consecutive_failures, last_run_at, last_success_at, last_latency_ms, last_error_code, last_error_at, planned_slots, observed_slots, planned_calls, manual_calls, retry_calls, version, updated_at FROM faction_collectors ORDER BY faction_id ASC').all();
    const outboxCounts = Object.fromEntries(['pending', 'sending', 'sent', 'failed', 'needs_review', 'blocked_plan'].map((s) => [s, 0]));
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

  async function runOperatorAction(actor, action, body, factionId, why) {
    if (action === 'pause') {
      if (!positiveId(factionId)) fail('INVALID_FACTION_ID', 400);
      const r = db.prepare('UPDATE faction_collectors SET paused=1, updated_at=? WHERE faction_id=?').run(now(), factionId);
      if (!r.changes) fail('COLLECTOR_NOT_FOUND', 404);
      audit(actor, factionId, 'operator.pause', why, 'ok');
      return { factionId, paused: true };
    }
    if (action === 'resume') {
      if (!positiveId(factionId)) fail('INVALID_FACTION_ID', 400);
      const r = db.prepare('UPDATE faction_collectors SET paused=0, consecutive_failures=0, backoff_sec=0, updated_at=? WHERE faction_id=?').run(now(), factionId);
      if (!r.changes) fail('COLLECTOR_NOT_FOUND', 404);
      audit(actor, factionId, 'operator.resume', why, 'ok');
      return { factionId, paused: false };
    }
    if (action === 'queue_refresh') {
      if (!positiveId(factionId)) fail('INVALID_FACTION_ID', 400);
      const result = await tickFaction(factionId, { kind: 'manual' });
      audit(actor, factionId, 'operator.queue_refresh', why, result.status, result);
      return result;
    }
    if (action === 'prune') {
      const result = pruneRetention(factionId || null);
      audit(actor, factionId, 'operator.prune', why, 'ok', result);
      return result;
    }
    if (action === 'retry_outbox') {
      const id = positiveId(body.outboxId) ? Number(body.outboxId) : null;
      // A bulk retry must name its faction so it can never reset another faction's rows.
      if (!id && !positiveId(factionId)) fail('INVALID_FACTION_ID', 400);
      if (id) {
        db.prepare(`UPDATE notification_outbox SET status='pending', next_try_at=0, updated_at=? WHERE id=? AND status IN ('failed','needs_review')${factionId ? ' AND faction_id=?' : ''}`)
          .run(now(), id, ...(factionId ? [factionId] : []));
      } else {
        db.prepare("UPDATE notification_outbox SET status='pending', next_try_at=0, updated_at=? WHERE faction_id=? AND status='failed'").run(now(), factionId);
      }
      const result = await dispatchOutbox({ factionId: factionId || null });
      audit(actor, factionId, 'operator.retry_outbox', why, 'ok', result);
      return result;
    }
    if (action === 'preview_notification') {
      audit(actor, factionId, 'operator.preview_notification', why, 'ok');
      return {
        synthetic: true,
        scope: body.scope === 'officer' ? 'officer' : 'member',
        preview: { kind: 'travel', factionId, displayName: 'Sample player', fromState: 'abroad', toState: 'inbound', origin: 'mex', destination: 'torn', etaKind: 'estimate' },
      };
    }
    if (action === 'grant_plan') {
      return grantPlan(actor, { factionId, tier: body.tier || 'pilot', days: body.days || 30, quotaAlertsPerDay: body.quotaAlertsPerDay || 100, reason: why });
    }
    if (action === 'synthetic_plan_event') {
      return applySyntheticPlanEvent(actor, { factionId, eventId: body.eventId, days: body.days || 30, tier: body.tier || 'team', reason: why });
    }
    return null;
  }

  async function operatorJob(actor, body = {}) {
    if (!actor || !positiveId(actor.tornId)) fail('AUTH_REQUIRED', 401);
    const reqId = String(body.requestId || '').trim();
    if (reqId.length < 4 || reqId.length > 120) fail('REQUEST_ID_REQUIRED', 400);
    const action = String(body.action || '').trim();
    if (!VALID_ACTIONS.has(action)) fail('INVALID_JOB_ACTION', 400);
    const why = cleanReason(body.reason);
    const factionId = Number(body.factionId) || 0;

    // Claim the requestId atomically before running anything: the same requestId never executes twice, even when a
    // duplicate arrives while the first run is still in flight.
    const existing = transaction(() => {
      const row = db.prepare('SELECT result_json FROM faction_operator_jobs WHERE request_id=?').get(reqId);
      if (row) return row;
      db.prepare('INSERT INTO faction_operator_jobs(request_id, actor_torn_id, faction_id, action, reason, result_json, created_at) VALUES(?,?,?,?,?,?,?)')
        .run(reqId, actor.tornId, factionId, action, why, IN_PROGRESS_JOB, now());
      return null;
    });
    if (existing) {
      if (existing.result_json === IN_PROGRESS_JOB) return { idempotentReplay: true, inProgress: true, requestId: reqId, result: null };
      return { idempotentReplay: true, requestId: reqId, result: JSON.parse(existing.result_json) };
    }

    let result;
    try {
      result = await runOperatorAction(actor, action, body, factionId, why);
    } catch (error) {
      // A refused job leaves no record, so it can be corrected and retried with the same requestId.
      db.prepare('DELETE FROM faction_operator_jobs WHERE request_id=? AND result_json=?').run(reqId, IN_PROGRESS_JOB);
      throw error;
    }
    db.prepare('UPDATE faction_operator_jobs SET result_json=? WHERE request_id=?').run(JSON.stringify(result ?? null), reqId);
    return { idempotentReplay: false, requestId: reqId, result };
  }

  /* ---------- Independent Background Loop ---------- */
  async function runCycle() {
    const out = { ticks: 0, dispatch: null, retention: null };
    try {
      const ts = now();
      // Only factions with an active plan are polled at all.
      const due = db.prepare(
        `SELECT c.faction_id FROM faction_collectors c JOIN faction_plans p ON p.faction_id=c.faction_id
          WHERE c.paused=0 AND c.next_run_at<=? AND p.status='active' AND p.ends_at>? ORDER BY c.next_run_at ASC`,
      ).all(ts, ts);
      for (const row of due) {
        if (stopped) break;
        await tickFaction(row.faction_id, { kind: 'planned' });
        out.ticks++;
      }
      if (!stopped) out.dispatch = await dispatchOutbox({ limit: 10 });
      if (!stopped) out.retention = runDailyMaintenance();
    } catch (error) {
      out.error = /^[A-Z0-9_]+$/.test(String(error?.code || '')) ? error.code : 'FACTION_CYCLE_FAILED'; // per-faction errors are tracked on each collector
    }
    return out;
  }

  function start(pollMs = 30_000) {
    if (timer || stopped || closed) return;
    timer = setInterval(() => {
      if (stopped || cycleRunning) return; // never overlap two cycles
      cycleRunning = runCycle().finally(() => { cycleRunning = null; });
    }, pollMs);
    timer.unref?.();
  }

  async function stop() {
    stopped = true;
    if (timer) { clearInterval(timer); timer = null; }
    for (;;) {
      const pending = [...inflight, ...inflightTicks.values(), cycleRunning, dispatchRunning].filter(Boolean);
      if (!pending.length) break;
      await Promise.allSettled(pending);
    }
  }

  function close() {
    if (!closing) {
      closing = (async () => {
        await stop();
        closed = true;
        handle.close();
      })();
    }
    return closing;
  }

  // Public async calls are tracked so close() waits for them before the database handle goes away.
  function tracked(fn) {
    return async (...args) => {
      if (closed) fail('FACTION_HUB_UNAVAILABLE', 503);
      const p = fn(...args);
      inflight.add(p);
      try { return await p; }
      finally { inflight.delete(p); }
    };
  }
  function guarded(fn) {
    return (...args) => {
      if (closed) fail('FACTION_HUB_UNAVAILABLE', 503);
      return fn(...args);
    };
  }

  return {
    available: true,
    db,
    transaction,
    now,
    processOwner,
    verifyFactionRole: tracked(verifyFactionRole),
    getPlan: guarded(getPlan),
    grantPlan: guarded(grantPlan),
    applySyntheticPlanEvent: guarded(applySyntheticPlanEvent),
    getSettings: tracked(getSettings),
    updateSettings: tracked(updateSettings),
    acquireLease: guarded(acquireLease),
    releaseLease: guarded(releaseLease),
    ingestRosterSnapshot: guarded(ingestRosterSnapshot),
    tickFaction: tracked(tickFaction),
    pruneRetention: guarded(pruneRetention),
    runDailyMaintenance: guarded(runDailyMaintenance),
    dispatchOutbox: tracked(dispatchOutbox),
    getStatus: tracked(getStatus),
    getHistory: tracked(getHistory),
    getSharedReport: tracked(getSharedReport),
    getMemberSeries: tracked(getMemberSeries),
    exportUserData: guarded(exportUserData),
    eraseUserData: guarded(eraseUserData),
    operatorSummary: guarded(operatorSummary),
    operatorJob: tracked(operatorJob),
    runCycle: tracked(runCycle),
    start,
    stop,
    close,
  };
}

module.exports = { createFactionHub, createUnavailableFactionHub, maskApiKey, encryptKey, decryptKey, FATAL_TORN_CODES, RETENTION };
