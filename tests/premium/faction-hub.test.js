const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openFactionDatabase, LATEST_VERSION } = require('../../premium/faction-db');
const { createFactionHub } = require('../../premium/faction-hub');
const { createHttpServer } = require('../../premium/server');
const { readConfig } = require('../../premium/config');

const DAY = 86400;

function makeConfig(overrides = {}) {
  return readConfig({
    PREMIUM_MODE: 'test',
    PREMIUM_DB_PATH: ':memory:',
    PREMIUM_FACTION_DB_PATH: ':memory:',
    PREMIUM_TEST_AUTH_TOKEN: 't'.repeat(40),
    PREMIUM_FACTION_KEY_SECRET: 's'.repeat(48),
    PREMIUM_CONTROLLER_NAME: 'Test Operator',
    PREMIUM_PRIVACY_CONTACT: 'ops@example.invalid',
    PREMIUM_PUBLIC_URL: 'https://premium.example.invalid',
    PREMIUM_RECORD_RETENTION_POLICY: 'Test only',
    ...overrides,
  });
}

/* =========================================================
   1. P1.2 — Separate SQLite DB, Schema Tables & Mode Isolation
   ========================================================= */
test('P1.2: separate Faction Hub DB creates all 7 DOCX tables, uses FULL durability, and enforces mode isolation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-fac-db-'));
  const dbPath = path.join(dir, 'faction-hub.sqlite');
  try {
    const h = openFactionDatabase(dbPath, { mode: 'test' });
    const tables = new Set(h.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    for (const required of [
      'faction_collectors',
      'roster_observations',
      'roster_latest',
      'travel_transitions',
      'activity_rollups',
      'notification_outbox',
      'faction_audit',
      'faction_plans',
      'faction_plan_events',
      'faction_operator_jobs',
    ]) {
      assert.ok(tables.has(required), `missing required table ${required}`);
    }
    const sync = h.db.prepare('PRAGMA synchronous').get().synchronous;
    assert.equal(sync, 2, 'SQLite synchronous durability must be FULL (2)');
    assert.equal(h.db.prepare('SELECT max(version) AS v FROM faction_hub_migrations').get().v, LATEST_VERSION);
    h.close();

    // Opening a test DB in live mode MUST fail closed
    assert.throws(() => openFactionDatabase(dbPath, { mode: 'live' }), /separate/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* =========================================================
   2. P1.1 & P1.2 — Auth, Encrypted Key, Lease Fencing, Idempotent Ingest & Retention
   ========================================================= */
test('P1.1/P1.2: officer verification, encrypted key never stored raw, optimistic version conflict, lease fencing, idempotency, and retention prune', async () => {
  let clock = 1800000000;
  const roles = new Map([
    ['100:500', { inFaction: true, factionId: 500, role: 'officer', officer: true, position: 'Leader' }],
    ['101:500', { inFaction: true, factionId: 500, role: 'member', officer: false, position: 'Member' }],
    ['202:600', { inFaction: true, factionId: 600, role: 'officer', officer: true, position: 'Leader' }],
  ]);

  const hub = createFactionHub(makeConfig(), {
    now: () => clock,
    roleVerifier: async (tornId, factionId) => roles.get(`${tornId}:${factionId}`) || { inFaction: false, factionId, role: 'none', officer: false },
  });

  try {
    const officer = { tornId: 100, admin: false };
    const member = { tornId: 101, admin: false };
    const outsider = { tornId: 202, admin: false };
    const admin = { tornId: 4037017, admin: true };

    // Member & outsider cannot update officer settings
    await assert.rejects(() => hub.updateSettings(member, 500, { sharedReports: true }), (e) => e.status === 403);
    await assert.rejects(() => hub.updateSettings(outsider, 500, { sharedReports: true }), (e) => e.status === 403);

    // Connecting collector key requires explicit consent
    await assert.rejects(() => hub.updateSettings(officer, 500, { connectKey: 'AbCdEfGh12345678', consent: false }), (e) => e.code === 'CONSENT_REQUIRED');

    // Valid connect stores encrypted key only (raw key never in DB or response)
    const saved = await hub.updateSettings(officer, 500, {
      connectKey: 'AbCdEfGh12345678',
      consent: true,
      discordWebhook: 'https://discord.test/api/webhooks/1/tok',
      notifications: { travel: true },
    });
    assert.equal(saved.connected, true);
    assert.equal(saved.keyRef, '****5678');
    assert.equal(saved.version, 1);
    const rawRow = hub.db.prepare('SELECT key_ref, key_cipher FROM faction_collectors WHERE faction_id=500').get();
    assert.equal(rawRow.key_ref, '****5678');
    assert.equal(rawRow.key_cipher.includes('AbCdEfGh12345678'), false, 'raw API key must never be stored in plaintext');

    // Stale version conflict -> 409
    await assert.rejects(
      () => hub.updateSettings(officer, 500, { version: 0, sharedReports: false }),
      (e) => e.status === 409 && e.code === 'VERSION_CONFLICT',
    );

    // Activate faction team plan
    hub.grantPlan(admin, { factionId: 500, tier: 'team', days: 30, reason: 'test setup' });

    // Lease fencing: stale lease rejected (409)
    const l1 = hub.acquireLease(500, 'worker-a', 120);
    assert.equal(l1.acquired, true);
    assert.throws(
      () => hub.ingestRosterSnapshot({ factionId: 500, leaseToken: 'stale-token', slotAt: clock, observedAt: clock, receivedAt: clock, members: [] }),
      (e) => e.code === 'LEASE_MISMATCH',
    );

    // Snapshot 1: player 1 Okay
    const slot1 = Math.floor(clock / 300) * 300;
    const ing1 = hub.ingestRosterSnapshot({
      factionId: 500,
      leaseToken: l1.token,
      slotAt: slot1,
      observedAt: clock,
      receivedAt: clock,
      members: [{ id: 1, name: 'Runner', last_action: { status: 'Online' }, status: { state: 'Okay', description: 'Okay' } }],
    });
    assert.equal(ing1.duplicateSlot, false);

    // Replay same slot -> idempotent, does not duplicate
    const ing1Dup = hub.ingestRosterSnapshot({
      factionId: 500,
      leaseToken: l1.token,
      slotAt: slot1,
      observedAt: clock,
      receivedAt: clock,
      members: [{ id: 1, name: 'Runner', last_action: { status: 'Online' }, status: { state: 'Okay', description: 'Okay' } }],
    });
    assert.equal(ing1Dup.duplicateSlot, true);

    // Advance +5 min: expired lease l1 must be rejected, fresh lease l2 succeeds!
    clock += 300;
    assert.throws(
      () => hub.ingestRosterSnapshot({ factionId: 500, leaseToken: l1.token, slotAt: clock, observedAt: clock, receivedAt: clock, members: [] }),
      (e) => e.code === 'LEASE_MISMATCH',
    );
    const l2 = hub.acquireLease(500, 'worker-a', 120);
    assert.equal(l2.acquired, true);

    const slot2 = Math.floor(clock / 300) * 300;
    const ing2 = hub.ingestRosterSnapshot({
      factionId: 500,
      leaseToken: l2.token,
      slotAt: slot2,
      observedAt: clock,
      receivedAt: clock,
      members: [{ id: 1, name: 'Runner', last_action: { status: 'Online' }, status: { state: 'Traveling', description: 'Traveling to Japan' } }],
    });
    assert.equal(ing2.transitionsCount, 1);

    // Older observed_at snapshot MUST NOT overwrite newer roster_latest
    hub.ingestRosterSnapshot({
      factionId: 500,
      leaseToken: l2.token,
      slotAt: slot1 - 300,
      observedAt: clock - 600,
      receivedAt: clock,
      members: [{ id: 1, name: 'Runner', last_action: { status: 'Offline' }, status: { state: 'Okay', description: 'Okay' } }],
    });
    const latest = hub.db.prepare('SELECT travel_state, destination, observed_at FROM roster_latest WHERE faction_id=500 AND player_id=1').get();
    assert.equal(latest.travel_state, 'outbound', 'older observation must never overwrite newer roster_latest');
    assert.equal(latest.destination, 'jap');
    assert.equal(latest.observed_at, clock);
    hub.releaseLease(500, l2.token);

    // Retention prune: move clock +40 days -> raw observations (>30d) deleted, rollups (<180d) preserved; +200 days -> rollups deleted
    clock += 40 * DAY;
    const p1 = hub.pruneRetention(500);
    assert.ok(p1.deletedRaw > 0, 'raw observations older than 30d pruned');
    assert.equal(p1.deletedRollups, 0, 'rollups younger than 180d preserved');

    clock += 160 * DAY;
    const p2 = hub.pruneRetention(500);
    assert.ok(p2.deletedRollups > 0, 'activity rollups older than 180d pruned');

    // Disconnect wipes key immediately and pauses collector
    const disc = await hub.updateSettings(officer, 500, { disconnectKey: true, version: 1 });
    assert.equal(disc.connected, false);
    assert.equal(disc.paused, true);
    assert.equal(disc.keyRef, '');
  } finally {
    await hub.close();
  }
});

/* =========================================================
   3. P1.2 & P2.3 — Collector Backoff/Auto-Pause, Discord Outbox Permission Cap & Uncertain Timeout
   ========================================================= */
test('P1.2/P2.3: collector backs off on 429, auto-pauses on revoked key; outbox strips officer details and marks uncertain timeout as needs_review without blind retry', async () => {
  let clock = 1800000000;
  let tornMode = '429';
  let notifyCalls = 0;
  const deliveredPayloads = [];
  let notifyMode = 'timeout';

  const hub = createFactionHub(makeConfig(), {
    now: () => clock,
    roleVerifier: async (tornId, factionId) => ({ inFaction: true, factionId, role: 'officer', officer: true }),
    fetchImpl: async () => {
      if (tornMode === '429') return new Response('rate limited', { status: 429 });
      if (tornMode === 'revoked') return new Response(JSON.stringify({ error: { code: 2, error: 'Incorrect key' } }), { status: 200 });
      return new Response(JSON.stringify({ members: [{ id: 1, name: 'Jet', status: { state: 'Traveling', description: 'Returning to Torn from Mexico' }, last_action: { status: 'Online' } }] }), { status: 200 });
    },
    notifyProvider: async (msg) => {
      notifyCalls++;
      if (notifyMode === 'timeout') {
        const err = new Error('Timeout');
        err.name = 'TimeoutError';
        throw err;
      }
      deliveredPayloads.push(msg);
    },
  });

  try {
    const officer = { tornId: 100 };
    const admin = { tornId: 4037017, admin: true };
    await hub.updateSettings(officer, 500, {
      connectKey: 'AbCdEfGh12345678',
      consent: true,
      discordWebhook: 'https://discord.test/api/webhooks/1/tok',
      discordScope: 'member',
      notifications: { travel: true },
    });
    hub.grantPlan(admin, { factionId: 500, tier: 'team', days: 30, reason: 'test plan' });

    // 429 rate limit -> backoff scheduled, immediate retry blocked by cooldown
    const r429 = await hub.tickFaction(500);
    assert.equal(r429.status, 'error');
    assert.equal(r429.code, 'TORN_429');
    assert.ok(r429.backoffSec >= 60);
    assert.equal((await hub.tickFaction(500)).status, 'cooldown', 'must respect backoff cooldown');

    // Advance past backoff window -> revoked key (Torn code 2) auto-pauses immediately
    clock += r429.backoffSec + 1;
    tornMode = 'revoked';
    const rRev = await hub.tickFaction(500);
    assert.equal(rRev.status, 'revoked_paused');
    assert.equal(hub.db.prepare('SELECT paused FROM faction_collectors WHERE faction_id=500').get().paused, 1);

    // Outbox: insert a member-scoped message containing sensitive officerDetails -> must be stripped & uncertain timeout -> needs_review
    hub.db.prepare(
      "INSERT INTO notification_outbox(idempotency_key, faction_id, event_id, destination, rule_id, scope, payload_json, status, next_try_at, created_at, updated_at) VALUES(?,?,?,?,?,?,?,'pending',0,?,?)",
    ).run('k1', 500, 'ev1', 'https://discord.test/api/webhooks/1/tok', 'travel', 'member', JSON.stringify({ displayName: 'Jet', toState: 'inbound', officerDetails: { secretOc: 999 } }), clock, clock);

    const d1 = await hub.dispatchOutbox({ factionId: 500 });
    assert.equal(d1.needsReview, 1);
    assert.equal(notifyCalls, 1);
    assert.equal(hub.db.prepare("SELECT status FROM notification_outbox WHERE idempotency_key='k1'").get().status, 'needs_review');

    // Subsequent automatic dispatch MUST NOT blindly retry needs_review!
    notifyMode = 'ok';
    const d2 = await hub.dispatchOutbox({ factionId: 500 });
    assert.equal(d2.sent, 0);
    assert.equal(notifyCalls, 1, 'uncertain timeout (needs_review) must never be blindly retried');

    // Explicit operator retry with outboxId delivers cleanly AND strips officerDetails from member scope
    const rowId = hub.db.prepare("SELECT id FROM notification_outbox WHERE idempotency_key='k1'").get().id;
    const opRes = await hub.operatorJob(admin, { requestId: 'req-retry-1', action: 'retry_outbox', factionId: 500, outboxId: rowId, reason: 'verified not delivered' });
    assert.equal(opRes.idempotentReplay, false);
    assert.equal(opRes.result.sent, 1);
    assert.equal(deliveredPayloads.length, 1);
    assert.equal('officerDetails' in deliveredPayloads[0].payload, false, 'member-scoped Discord payload must never include officerDetails');

    // Same operator requestId is strictly idempotent (executes once, does not re-send)
    const opReplay = await hub.operatorJob(admin, { requestId: 'req-retry-1', action: 'retry_outbox', factionId: 500, outboxId: rowId, reason: 'verified not delivered' });
    assert.equal(opReplay.idempotentReplay, true);
    assert.equal(deliveredPayloads.length, 1);
  } finally {
    await hub.close();
  }
});

/* =========================================================
   4. P3.1 & P1.3 — Faction Team Plan Lifecycle & HTTP Route Integration
   ========================================================= */
test('P3.1 & P1.3 HTTP: faction team plan enforces faction scope, extends max(now, endsAt), dedupes event_id, closes on expiry, and preserves QUERY_NOT_ALLOWED on /v1/me', async (t) => {
  const secret = crypto.randomBytes(32).toString('hex');
  const clock = { now: 1800000000 };
  const roles = new Map([
    ['555:700', { inFaction: true, factionId: 700, role: 'officer', officer: true, position: 'Leader' }],
    ['556:700', { inFaction: true, factionId: 700, role: 'member', officer: false, position: 'Member' }],
    ['555:800', { inFaction: true, factionId: 800, role: 'officer', officer: true, position: 'Leader' }],
  ]);

  const config = makeConfig({ PREMIUM_TEST_AUTH_TOKEN: secret });
  const { server, service } = createHttpServer(config, {
    now: () => clock.now,
    roleVerifier: async (tornId, factionId) => roles.get(`${tornId}:${factionId}`) || { inFaction: false, factionId, role: 'none', officer: false },
    rosterFetcher: async () => ({
      observedAt: clock.now,
      members: [{ id: 1, name: 'Jet', last_action: { status: 'Online' }, status: { state: 'Traveling', description: 'Traveling to Japan' } }],
    }),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise((r) => server.close(r)); await service.close(); });

  const base = 'http://127.0.0.1:' + server.address().port;
  const req = async (method, urlPath, body, token, headers = {}) => {
    const res = await fetch(base + urlPath, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, data: await res.json() };
  };
  const login = async (tornId) => {
    const r = await req('POST', '/v1/auth/test', { tornId }, null, { 'X-Premium-Test-Token': secret });
    assert.equal(r.status, 200);
    return r.data.token;
  };

  let adminTok = await login(4037017);
  let officerTok = await login(555);
  let memberTok = await login(556);

  // Existing query guard on /v1/me MUST remain strictly intact
  assert.equal((await req('GET', '/v1/me?foo=1', undefined, memberTok)).status, 400);

  // Without team plan, shared status & report return 403 FACTION_PLAN_EXPIRED
  assert.equal((await req('GET', '/v1/factions/700/status', undefined, memberTok)).status, 403);
  assert.equal((await req('GET', '/v1/factions/700/report', undefined, memberTok)).status, 403);

  // Connect collector as officer of faction 700
  const setRes = await req('PATCH', '/v1/factions/700/settings', { connectKey: 'AbCdEfGh12345678', consent: true, sharedReports: true }, officerTok);
  assert.equal(setRes.status, 200);

  // Synthetic team plan event adds 30 days; replay of SAME event_id adds 0 days!
  const ev1 = await req('POST', '/v1/admin/faction-collector/jobs', {
    requestId: 'plan-ev-1', action: 'synthetic_plan_event', factionId: 700, eventId: 'evt-team-001', days: 30, tier: 'team', reason: 'initial',
  }, adminTok);
  assert.equal(ev1.status, 200);
  const firstEndsAt = ev1.data.result.plan.endsAt;
  assert.equal(firstEndsAt, clock.now + 30 * DAY);

  const ev1Dup = await req('POST', '/v1/admin/faction-collector/jobs', {
    requestId: 'plan-ev-1-dup', action: 'synthetic_plan_event', factionId: 700, eventId: 'evt-team-001', days: 30, tier: 'team', reason: 'replay',
  }, adminTok);
  assert.equal(ev1Dup.status, 200);
  assert.equal(ev1Dup.data.result.duplicate, true);
  assert.equal(ev1Dup.data.result.addedDays, 0);
  assert.equal(ev1Dup.data.result.plan.endsAt, firstEndsAt, 'duplicate event_id must add 0 days');

  // New event 5 days later extends from max(now, endsAt) -> adds another 30 days on top
  clock.now += 5 * DAY;
  adminTok = await login(4037017);
  officerTok = await login(555);
  memberTok = await login(556);
  const ev2 = await req('POST', '/v1/admin/faction-collector/jobs', {
    requestId: 'plan-ev-2', action: 'synthetic_plan_event', factionId: 700, eventId: 'evt-team-002', days: 30, tier: 'team', reason: 'extend',
  }, adminTok);
  assert.equal(ev2.status, 200);
  assert.equal(ev2.data.result.plan.endsAt, firstEndsAt + 30 * DAY, 'renewal must extend from max(now, endsAt)');

  // Trigger manual collector refresh via operator endpoint
  const qRef = await req('POST', '/v1/admin/faction-collector/jobs', {
    requestId: 'tick-700-1', action: 'queue_refresh', factionId: 700, reason: 'initial snapshot',
  }, adminTok);
  assert.equal(qRef.status, 200);

  // Member of faction 700 can now read status, history (with allowlisted query params!), and shared report (member scope)
  const stRes = await req('GET', '/v1/factions/700/status', undefined, memberTok);
  assert.equal(stRes.status, 200);
  assert.equal(stRes.data.travel.length, 1);

  const histRes = await req('GET', `/v1/factions/700/history?from=${clock.now - 3600}&to=${clock.now + 3600}&grain=hour`, undefined, memberTok);
  assert.equal(histRes.status, 200);
  assert.ok(Array.isArray(histRes.data.series));

  // N3 Hub Member Series endpoint works for faction member 1 and returns 404 for non-member 777
  const memSer = await req('GET', `/v1/factions/700/members/1/series?metric=activity&from=${clock.now - 3600}&to=${clock.now + 3600}`, undefined, memberTok);
  assert.equal(memSer.status, 200);
  assert.equal(memSer.data.playerId, 1);
  assert.ok(Array.isArray(memSer.data.points));

  const memTrSer = await req('GET', '/v1/factions/700/members/1/series?metric=travel', undefined, memberTok);
  assert.equal(memTrSer.status, 200);
  assert.equal(memTrSer.data.metric, 'travel');

  assert.equal((await req('GET', '/v1/factions/700/members/777/series?metric=activity', undefined, memberTok)).status, 404);

  // Unrecognized query param on history still rejected
  assert.equal((await req('GET', '/v1/factions/700/history?evil=1', undefined, memberTok)).status, 400);

  const repMember = await req('GET', '/v1/factions/700/report', undefined, memberTok);
  assert.equal(repMember.status, 200);
  assert.equal(repMember.data.scope, 'member');
  assert.equal('notInOcCount' in repMember.data, false, 'member shared report must not expose officer-only OC count');

  const repOfficer = await req('GET', '/v1/factions/700/report', undefined, officerTok);
  assert.equal(repOfficer.status, 200);
  assert.equal(repOfficer.data.scope, 'officer');

  // Moving to faction 800 does NOT transfer faction 700's team plan!
  assert.equal((await req('GET', '/v1/factions/800/status', undefined, officerTok)).status, 403);

  // If member leaves faction 700, shared report is denied immediately even while plan is active
  roles.delete('556:700');
  assert.equal((await req('GET', '/v1/factions/700/report', undefined, memberTok)).status, 403);

  // When team plan expires, paid shared status closes (403 FACTION_PLAN_EXPIRED) while personal /v1/me remains 200
  clock.now = ev2.data.result.plan.endsAt + 10;
  adminTok = await login(4037017);
  officerTok = await login(555);
  const expiredSt = await req('GET', '/v1/factions/700/status', undefined, officerTok);
  assert.equal(expiredSt.status, 403);
  assert.equal(expiredSt.data.code, 'FACTION_PLAN_EXPIRED');
  assert.equal((await req('GET', '/v1/me', undefined, officerTok)).status, 200);

  // Admin collector summary endpoint works and never leaks raw key
  const opSum = await req('GET', '/v1/admin/faction-collector', undefined, adminTok);
  assert.equal(opSum.status, 200);
  assert.equal(JSON.stringify(opSum.data).includes('AbCdEfGh12345678'), false);
});
