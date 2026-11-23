// Regression tests for the Shared Faction Hub review findings (premium/faction-hub.js and its wiring).
// Every Torn / Discord call is stubbed: the hub must never reach the real network from tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createFactionHub, FATAL_TORN_CODES } = require('../../premium/faction-hub');
const { createHttpServer } = require('../../premium/server');
const { createPremiumService } = require('../../premium/service');
const { readConfig, TEST_FACTION_KEY_SECRET } = require('../../premium/config');
const { createStore } = require('../../premium/store');
const { createTornClient } = require('../../premium/torn-client');

const DAY = 86400;
const T0 = 1800000000;
const ADMIN = { tornId: 4037017, admin: true };
const LEADER_KEY = 'LeaderKey0000001';
const MEMBER_KEY = 'MemberKey0000002';
const FOREIGN_KEY = 'ForeignKy0000003';
const UNKNOWN_KEY = 'UnknownKy0000009';

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

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function rosterMember(id, name, position, { activity = 'Online', state = 'Okay', desc = 'Okay' } = {}) {
  return { id, name, level: 10, position, is_in_oc: false, last_action: { status: activity, relative: '1 minute ago' }, status: { state, description: desc } };
}

// A tiny synthetic Torn: keys map to an owner, faction and position; factions map to member lists.
function tornWorld() {
  const world = { keys: new Map(), factions: new Map(), errors: new Map(), calls: [], override: null };
  world.fetchImpl = async (url, options = {}) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://api.torn.com', 'the faction hub may only call the Torn API');
    assert.equal(options.redirect, 'error');
    const key = String(options.headers?.Authorization || '').replace(/^ApiKey /, '');
    world.calls.push({ path: u.pathname, key });
    if (world.override) {
      const overridden = await world.override(u, key);
      if (overridden) return overridden;
    }
    if (world.errors.has(key)) return json({ error: { code: world.errors.get(key), error: 'Synthetic Torn error' } });
    const owner = world.keys.get(key);
    if (!owner) return json({ error: { code: 2, error: 'Incorrect key' } });
    if (u.pathname === '/v2/key/info') return json({ info: { user: { id: owner.owner, faction_id: owner.factionId }, selections: { user: ['basic', 'faction'] }, access: { level: 1 } } });
    if (u.pathname === '/v2/user/faction') return json({ faction: owner.factionId ? { id: owner.factionId, name: 'Synthetic', tag: 'SYN', position: owner.position, days_in_faction: 10 } : null });
    const m = /^\/v2\/faction\/(\d+)\/members$/.exec(u.pathname);
    if (m) return json({ members: world.factions.get(Number(m[1])) || [] });
    return json({ error: { code: 4, error: 'Wrong fields' } });
  };
  world.memberCalls = () => world.calls.filter((c) => /\/members$/.test(c.path)).length;
  return world;
}

function leaderWorld() {
  const world = tornWorld();
  world.keys.set(LEADER_KEY, { owner: 555, factionId: 700, position: 'Leader' });
  world.keys.set(MEMBER_KEY, { owner: 556, factionId: 700, position: 'Member' });
  world.keys.set(FOREIGN_KEY, { owner: 557, factionId: 700, position: 'Co-leader' });
  world.factions.set(700, [rosterMember(555, 'Boss', 'Leader'), rosterMember(556, 'Grunt', 'Member', { activity: 'Idle' })]);
  return world;
}

function officerVerifier(officers = [100], members = []) {
  return async (tornId, factionId) => {
    if (officers.includes(tornId)) return { inFaction: true, factionId, role: 'officer', officer: true, position: 'Leader' };
    if (members.includes(tornId)) return { inFaction: true, factionId, role: 'member', officer: false, position: 'Member' };
    return { inFaction: false, factionId, role: 'none', officer: false };
  };
}

function snapshot(hub, factionId, at, members) {
  const lease = hub.acquireLease(factionId);
  assert.equal(lease.acquired, true);
  try {
    return hub.ingestRosterSnapshot({ factionId, leaseToken: lease.token, slotAt: Math.floor(at / 300) * 300, observedAt: at, receivedAt: at, members });
  } finally {
    hub.releaseLease(factionId, lease.token);
  }
}

function insertOutbox(hub, key, factionId, status = 'pending', createdAt = T0) {
  hub.db.prepare(
    "INSERT INTO notification_outbox(idempotency_key, faction_id, event_id, destination, rule_id, scope, payload_json, status, next_try_at, created_at, updated_at) VALUES(?,?,?,?,'travel','member',?,?,0,?,?)",
  ).run(key, factionId, 'ev-' + key, 'https://discord.test/api/webhooks/1/tok', JSON.stringify({ displayName: 'Jet', toState: 'inbound', playerId: 1 }), status, createdAt, createdAt);
}
const outboxStatus = (hub, key) => hub.db.prepare('SELECT status FROM notification_outbox WHERE idempotency_key=?').get(key)?.status;
const rosterIds = (hub, factionId) => hub.db.prepare('SELECT player_id FROM roster_latest WHERE faction_id=? ORDER BY player_id').all(factionId).map((r) => r.player_id);

async function httpFixture(t, { world = null, deps = {}, env = {} } = {}) {
  const secret = crypto.randomBytes(32).toString('hex');
  const clock = { now: T0 };
  const { server, service } = createHttpServer(makeConfig({ PREMIUM_TEST_AUTH_TOKEN: secret, ...env }), {
    now: () => clock.now,
    fetchImpl: world ? world.fetchImpl : async () => { throw new Error('No external calls expected'); },
    ...deps,
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
  const job = (admin, body) => req('POST', '/v1/admin/faction-collector/jobs', body, admin);
  return { service, clock, req, login, job };
}

/* ---------- Findings 1, 2, 5 and the production HTTP path of 12 ---------- */
test('finding 1/2/5/12: without a roleVerifier an officer connects a Torn-verified key, roles then come from the collected roster with no Torn call per request, and leavers lose access', async (t) => {
  const world = leaderWorld();
  const f = await httpFixture(t, { world });
  const admin = await f.login(4037017);
  const officer = await f.login(555);
  const member = await f.login(556);
  const outsider = await f.login(999);

  let r = await f.req('PATCH', '/v1/factions/700/settings', { sharedReports: true }, outsider);
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'FACTION_OFFICER_REQUIRED');

  r = await f.req('PATCH', '/v1/factions/700/settings', { connectKey: FOREIGN_KEY, consent: true }, officer);
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'FACTION_KEY_OWNER_MISMATCH', 'the submitted key must belong to the caller');

  r = await f.req('PATCH', '/v1/factions/800/settings', { connectKey: LEADER_KEY, consent: true }, officer);
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'FACTION_KEY_FACTION_MISMATCH', 'the key owner must be in the faction being connected');

  r = await f.req('PATCH', '/v1/factions/700/settings', { connectKey: MEMBER_KEY, consent: true }, member);
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'FACTION_OFFICER_REQUIRED', 'only a leader or co-leader may connect a collector key');

  r = await f.req('PATCH', '/v1/factions/700/settings', { connectKey: UNKNOWN_KEY, consent: true }, officer);
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'TORN_2', 'a key Torn rejects is reported as a client error');

  r = await f.req('PATCH', '/v1/factions/700/settings', { connectKey: LEADER_KEY, consent: true, sharedReports: true }, officer);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.connected, true);
  assert.equal(r.data.keyRef, '****0001');

  // Before the first collection only the connecting officer has access
  assert.equal((await f.req('GET', '/v1/factions/700/settings', undefined, officer)).status, 200);
  r = await f.req('GET', '/v1/factions/700/status', undefined, member);
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'FACTION_ACCESS_DENIED');

  assert.equal((await f.job(admin, { requestId: 'plan-700', action: 'synthetic_plan_event', factionId: 700, eventId: 'evt-700-1', days: 30, reason: 'pilot plan' })).status, 200);
  r = await f.job(admin, { requestId: 'tick-700-1', action: 'queue_refresh', factionId: 700, reason: 'first snapshot' });
  assert.equal(r.status, 200);
  assert.equal(r.data.result.status, 'ok', JSON.stringify(r.data));
  assert.ok(world.calls.some((c) => c.path === '/v2/faction/700/members' && c.key === LEADER_KEY), 'the collector reads the connected faction by id');

  r = await f.req('GET', '/v1/factions/700/status', undefined, member);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.role.officer, false);
  assert.equal(r.data.members.length, 2);
  r = await f.req('GET', '/v1/factions/700/status', undefined, officer);
  assert.equal(r.data.role.officer, true);
  assert.equal((await f.req('GET', '/v1/factions/700/settings', undefined, member)).data.code, 'FACTION_OFFICER_REQUIRED');
  assert.equal((await f.req('GET', '/v1/factions/700/status', undefined, outsider)).status, 403);

  // Finding 2: reading the hub never calls Torn with the faction's stored key
  const callsBefore = world.calls.length;
  for (let i = 0; i < 3; i++) {
    assert.equal((await f.req('GET', '/v1/factions/700/status', undefined, member)).status, 200);
    assert.equal((await f.req('GET', '/v1/factions/700/history', undefined, member)).status, 200);
    assert.equal((await f.req('GET', '/v1/factions/700/report', undefined, member)).status, 200);
    assert.equal((await f.req('GET', '/v1/factions/700/members/556/series', undefined, member)).status, 200);
    assert.equal((await f.req('GET', '/v1/factions/700/settings', undefined, officer)).status, 200);
    assert.equal((await f.req('GET', '/v1/factions/700/status', undefined, outsider)).status, 403);
  }
  assert.equal(world.calls.length, callsBefore, 'hub reads must not trigger Torn requests');

  // Finding 5: a member who left disappears from the roster and loses access
  world.factions.set(700, [rosterMember(555, 'Boss', 'Leader')]);
  f.clock.now += 301;
  r = await f.job(admin, { requestId: 'tick-700-2', action: 'queue_refresh', factionId: 700, reason: 'second snapshot' });
  assert.equal(r.data.result.status, 'ok');
  assert.equal((await f.req('GET', '/v1/factions/700/status', undefined, member)).status, 403);
  r = await f.req('GET', '/v1/factions/700/status', undefined, officer);
  assert.deepEqual(r.data.members.map((m) => m.id), [555]);
  assert.equal(r.data.counts.total, 1);
});

/* ---------- Finding 3 ---------- */
test('finding 3: the faction DB defaults beside the premium DB, and memory stays memory', () => {
  const stateDir = path.resolve(os.tmpdir(), 'lrx-state-example');
  const live = readConfig({ PREMIUM_MODE: 'live', PREMIUM_DB_PATH: path.join(stateDir, 'premium-live.sqlite') });
  assert.equal(live.factionDbPath, path.join(stateDir, 'faction-hub-live.sqlite'));
  assert.equal(readConfig({ PREMIUM_MODE: 'test', PREMIUM_DB_PATH: ':memory:' }).factionDbPath, ':memory:');
  const explicit = path.join(stateDir, 'custom-hub.sqlite');
  assert.equal(readConfig({ PREMIUM_MODE: 'live', PREMIUM_DB_PATH: path.join(stateDir, 'p.sqlite'), PREMIUM_FACTION_DB_PATH: explicit }).factionDbPath, explicit);
  const defaults = readConfig({ PREMIUM_MODE: 'test' });
  assert.equal(path.dirname(defaults.factionDbPath), path.dirname(defaults.dbPath));
});

test('finding 3: a file-backed service writes its faction DB beside its own DB, not into the repository data folder', async (t) => {
  const dir = tempDir(t, 'lrx-hub-path-');
  const service = createPremiumService(readConfig({ PREMIUM_MODE: 'test', PREMIUM_DB_PATH: path.join(dir, 'premium.sqlite') }), { now: () => T0 });
  assert.equal(service.factionHub.available, true);
  await service.close();
  assert.ok(fs.existsSync(path.join(dir, 'faction-hub-test.sqlite')));
});

test('finding 3: a faction hub that cannot open its DB leaves login working and answers 503 FACTION_HUB_UNAVAILABLE', async (t) => {
  const dir = tempDir(t, 'lrx-hub-broken-');
  const blocker = path.join(dir, 'not-a-directory');
  fs.writeFileSync(blocker, 'x');
  const f = await httpFixture(t, { deps: { factionDbPath: path.join(blocker, 'faction.sqlite') } });
  assert.equal(f.service.factionHub.available, false);
  const user = await f.login(123456);
  assert.equal((await f.req('GET', '/v1/me', undefined, user)).status, 200);
  let r = await f.req('GET', '/v1/factions/700/status', undefined, user);
  assert.equal(r.status, 503);
  assert.equal(r.data.code, 'FACTION_HUB_UNAVAILABLE');
  r = await f.req('PATCH', '/v1/factions/700/settings', { sharedReports: true }, user);
  assert.equal(r.data.code, 'FACTION_HUB_UNAVAILABLE');
  r = await f.req('GET', '/v1/me/data', undefined, user);
  assert.equal(r.status, 200);
  assert.equal(r.data.factionHub.available, false);
  const admin = await f.login(4037017);
  assert.equal((await f.req('GET', '/v1/admin/faction-collector', undefined, admin)).status, 503);
  assert.equal((await f.req('GET', '/v1/admin', undefined, admin)).status, 200);
});

/* ---------- Finding 4 ---------- */
test('finding 4: published privacy statements describe stored collector keys, webhooks and hub retention', async (t) => {
  const f = await httpFixture(t);
  const info = (await f.req('GET', '/v1/info')).data;
  assert.equal(info.privacy.storesApiKeys, true);
  assert.match(info.privacy.apiKeyStorage, /faction collector key/i);
  assert.match(info.privacy.apiKeyStorage, /encrypted/i);
  assert.match(info.privacy.purpose, /Shared Faction Hub/);
  const terms = (await f.req('GET', '/terms')).data;
  assert.equal(terms.storesApiKeys, true);
  assert.match(terms.keyUsage, /faction collector key/i);
  assert.match(terms.keyUsage, /encrypted/i);
  const hubLine = terms.data.find((line) => /Shared Faction Hub/.test(line));
  assert.ok(hubLine, 'terms list the faction hub data category');
  assert.match(hubLine, /30 days/);
  assert.match(hubLine, /180 days/);
  assert.match(terms.data.join(' '), /Discord webhook/i);
  assert.match(terms.rights, /faction hub/i);

  const doc = fs.readFileSync(path.join(__dirname, '../../premium/PRIVACY.md'), 'utf8');
  assert.match(doc, /Shared Faction Hub/);
  assert.match(doc, /encrypted/i);
  assert.match(doc, /Discord webhook/i);
  assert.match(doc, /30 days/);
  assert.match(doc, /180 days/);
  assert.doesNotMatch(doc, /Full target rosters are processed transiently, not stored as historical player lists\./);
  assert.doesNotMatch(doc, /Ordinary users' login keys remain transient and are not stored by the membership service\.(?! The)/);
});

test('finding 4: /v1/me/data exports and the erasure request erases the caller’s own faction-hub records', async (t) => {
  const world = leaderWorld();
  const f = await httpFixture(t, { world });
  const admin = await f.login(4037017);
  const officer = await f.login(555);
  const member = await f.login(556);
  assert.equal((await f.req('PATCH', '/v1/factions/700/settings', { connectKey: LEADER_KEY, consent: true, discordWebhook: 'https://discord.test/api/webhooks/1/tok' }, officer)).status, 200);
  await f.job(admin, { requestId: 'plan-e', action: 'synthetic_plan_event', factionId: 700, eventId: 'evt-e-1', days: 30, reason: 'pilot plan' });
  assert.equal((await f.job(admin, { requestId: 'tick-e-1', action: 'queue_refresh', factionId: 700, reason: 'first snapshot' })).data.result.status, 'ok');

  let r = await f.req('GET', '/v1/me/data', undefined, member);
  assert.equal(r.status, 200);
  assert.equal(r.data.factionHub.available, true);
  assert.deepEqual(r.data.factionHub.rosterLatest.map((row) => row.factionId), [700]);
  assert.ok(r.data.factionHub.observations.length >= 1);
  assert.deepEqual(r.data.factionHub.collectorsLinked, []);

  r = await f.req('GET', '/v1/me/data', undefined, officer);
  const linked = r.data.factionHub.collectorsLinked;
  assert.equal(linked.length, 1);
  assert.equal(linked[0].factionId, 700);
  assert.equal(linked[0].keyRef, '****0001');
  assert.equal(linked[0].keyConnected, true);
  const text = JSON.stringify(r.data);
  assert.equal(text.includes(LEADER_KEY), false, 'exports never contain the raw key');
  assert.equal(/key_?cipher/i.test(text), false, 'exports never contain the encrypted key');
  assert.equal(text.includes('discord.test/api/webhooks'), false, 'exports never echo the webhook secret');

  // Member erasure: rows about the member go, and later collections no longer record them
  r = await f.req('POST', '/v1/me/erasure-request', {}, member);
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'pending');
  assert.equal(r.data.factionHub.erased, true);
  const count = (sql) => f.service.factionHub.db.prepare(sql).get().n;
  assert.equal(count('SELECT count(*) n FROM roster_latest WHERE player_id=556'), 0);
  assert.equal(count('SELECT count(*) n FROM roster_observations WHERE player_id=556'), 0);
  f.clock.now += 301;
  assert.equal((await f.job(admin, { requestId: 'tick-e-2', action: 'queue_refresh', factionId: 700, reason: 'after erasure' })).data.result.status, 'ok');
  assert.equal(count('SELECT count(*) n FROM roster_latest WHERE player_id=556'), 0);
  assert.equal(count('SELECT count(*) n FROM roster_observations WHERE player_id=556'), 0);
  r = await f.req('GET', '/v1/me/data', undefined, member);
  assert.deepEqual(r.data.factionHub.rosterLatest, []);
  assert.deepEqual(r.data.factionHub.observations, []);
  assert.ok(r.data.factionHub.erasedAt);

  // Officer erasure removes the key they connected and pauses that collector
  r = await f.req('POST', '/v1/me/erasure-request', {}, officer);
  assert.equal(r.data.factionHub.erased, true);
  assert.deepEqual(r.data.factionHub.disconnectedFactions, [700]);
  const col = f.service.factionHub.db.prepare('SELECT key_ref, key_cipher, paused, linked_by_torn_id FROM faction_collectors WHERE faction_id=700').get();
  assert.equal(col.key_cipher, '');
  assert.equal(col.key_ref, '');
  assert.equal(col.paused, 1);
  assert.notEqual(col.linked_by_torn_id, 555);
});

/* ---------- Finding 5 ---------- */
test('finding 5: members missing from a newer snapshot are removed; older or empty snapshots never re-add or wipe them', async () => {
  let clock = T0;
  const hub = createFactionHub(makeConfig(), { now: () => clock, roleVerifier: officerVerifier([100]) });
  try {
    await hub.updateSettings({ tornId: 100 }, 500, { sharedReports: true });
    hub.grantPlan(ADMIN, { factionId: 500, days: 30, reason: 'leaver test' });
    snapshot(hub, 500, clock, [rosterMember(1, 'Stay', 'Member'), rosterMember(2, 'Leaver', 'Member')]);
    assert.deepEqual(rosterIds(hub, 500), [1, 2]);
    clock += 300;
    snapshot(hub, 500, clock, [rosterMember(1, 'Stay', 'Member')]);
    assert.deepEqual(rosterIds(hub, 500), [1]);
    const status = await hub.getStatus({ tornId: 100 }, 500);
    assert.deepEqual(status.members.map((m) => m.id), [1]);
    assert.equal(status.counts.total, 1);
    snapshot(hub, 500, T0 - 300, [rosterMember(1, 'Stay', 'Member'), rosterMember(2, 'Leaver', 'Member'), rosterMember(3, 'Old', 'Member')]);
    assert.deepEqual(rosterIds(hub, 500), [1], 'an out-of-order older snapshot must not re-add departed members');
    clock += 300;
    snapshot(hub, 500, clock, []);
    assert.deepEqual(rosterIds(hub, 500), [1], 'an empty member list is never treated as everyone leaving');
  } finally {
    await hub.close();
  }
});

/* ---------- Finding 6 ---------- */
test('finding 6: the shared ETA estimate survives later collector cycles', async () => {
  let clock = T0;
  const hub = createFactionHub(makeConfig(), { now: () => clock, roleVerifier: officerVerifier([100]) });
  try {
    await hub.updateSettings({ tornId: 100 }, 500, { sharedReports: true });
    hub.grantPlan(ADMIN, { factionId: 500, days: 30, reason: 'eta test' });
    const flying = [rosterMember(1, 'Jet', 'Member', { state: 'Traveling', desc: 'Traveling to Japan' })];
    snapshot(hub, 500, clock, [rosterMember(1, 'Jet', 'Member')]);
    clock += 300;
    snapshot(hub, 500, clock, flying);
    const eta = () => hub.db.prepare('SELECT eta_kind, eta_from, eta_to FROM roster_latest WHERE faction_id=500 AND player_id=1').get();
    const first = { ...eta() };
    assert.equal(first.eta_kind, 'estimate');
    for (let i = 0; i < 3; i++) {
      clock += 300;
      snapshot(hub, 500, clock, flying);
      assert.deepEqual({ ...eta() }, first, 'later cycles keep the estimate from the observed departure window');
    }
    const status = await hub.getStatus({ tornId: 100 }, 500);
    assert.equal(status.travel[0].etaKind, 'estimate');
    assert.equal(status.travel[0].etaFrom, first.eta_from);
  } finally {
    await hub.close();
  }
});

/* ---------- Finding 7 ---------- */
test('finding 7: collectors without an active plan are never polled', async () => {
  const world = leaderWorld();
  let clock = T0;
  const hub = createFactionHub(makeConfig(), { now: () => clock, fetchImpl: world.fetchImpl });
  try {
    await hub.updateSettings({ tornId: 555 }, 700, { connectKey: LEADER_KEY, consent: true });
    assert.equal((await hub.tickFaction(700)).status, 'plan_inactive');
    assert.equal((await hub.tickFaction(700, { kind: 'manual' })).status, 'plan_inactive');
    await hub.runCycle();
    assert.equal(world.memberCalls(), 0);
    hub.grantPlan(ADMIN, { factionId: 700, days: 1, reason: 'short plan' });
    await hub.runCycle();
    assert.equal(world.memberCalls(), 1);
    clock += 2 * DAY;
    await hub.runCycle();
    assert.equal((await hub.tickFaction(700, { kind: 'manual' })).status, 'plan_inactive');
    assert.equal(world.memberCalls(), 1, 'an expired plan stops collection');
  } finally {
    await hub.close();
  }
});

/* ---------- Finding 8 ---------- */
test('finding 8: the background cycle prunes raw history, rollups, outbox, audit and operator jobs at most once a day', async () => {
  let clock = T0;
  const hub = createFactionHub(makeConfig(), { now: () => clock, roleVerifier: officerVerifier([100]) });
  try {
    await hub.updateSettings({ tornId: 100 }, 500, { sharedReports: true });
    const seedOld = () => {
      const old = clock - 200 * DAY;
      hub.db.prepare("INSERT INTO roster_observations(faction_id, slot_at, player_id, observed_at, received_at, state, travel_state, activity, health) VALUES(500,?,1,?,?,'okay','none_observed','Online','okay')").run(old, old, old);
      hub.db.prepare("INSERT INTO activity_rollups(faction_id, grain, bucket_at) VALUES(500,'day',?)").run(old);
      insertOutbox(hub, 'old-' + old, 500, 'sent', old);
      hub.db.prepare("INSERT INTO faction_audit(actor_torn_id, faction_id, action, created_at) VALUES(100,500,'old.action',?)").run(old);
      hub.db.prepare("INSERT INTO faction_operator_jobs(request_id, actor_torn_id, faction_id, action, result_json, created_at) VALUES(?,4037017,500,'prune','{}',?)").run('job-' + old, old);
    };
    const n = (sql) => hub.db.prepare(sql).get().n;
    const counts = () => ({
      raw: n('SELECT count(*) n FROM roster_observations'),
      rollups: n('SELECT count(*) n FROM activity_rollups'),
      outbox: n('SELECT count(*) n FROM notification_outbox'),
      audit: n("SELECT count(*) n FROM faction_audit WHERE action='old.action'"),
      jobs: n('SELECT count(*) n FROM faction_operator_jobs'),
    });
    const none = { raw: 0, rollups: 0, outbox: 0, audit: 0, jobs: 0 };
    seedOld();
    await hub.runCycle();
    assert.deepEqual(counts(), none);
    seedOld();
    clock += 3600;
    await hub.runCycle();
    assert.deepEqual(counts(), { raw: 1, rollups: 1, outbox: 1, audit: 1, jobs: 1 }, 'retention runs at most once a day');
    clock += DAY;
    await hub.runCycle();
    assert.deepEqual(counts(), none);
  } finally {
    await hub.close();
  }
});

/* ---------- Finding 9 ---------- */
test('finding 9: secrets need a minimum length in every mode; test mode uses a fixed secret so stored keys survive a restart', async (t) => {
  const a = readConfig({ PREMIUM_MODE: 'test', PREMIUM_DB_PATH: ':memory:' });
  const b = readConfig({ PREMIUM_MODE: 'test', PREMIUM_DB_PATH: ':memory:' });
  assert.equal(a.factionKeySecret, TEST_FACTION_KEY_SECRET);
  assert.equal(a.factionKeySecret, b.factionKeySecret);
  assert.ok(a.factionKeySecret.length >= 32);
  assert.equal(readConfig({ PREMIUM_MODE: 'live', PREMIUM_DB_PATH: ':memory:' }).factionKeySecret, '');
  for (const secret of ['short', 'replace-me-'.repeat(4)]) {
    assert.throws(() => createFactionHub(makeConfig({ PREMIUM_FACTION_KEY_SECRET: secret })), (e) => e.code === 'FACTION_KEY_SECRET_NOT_CONFIGURED' && e.status === 503);
  }
  for (const secret of ['', TEST_FACTION_KEY_SECRET]) {
    assert.throws(() => createFactionHub(readConfig({ PREMIUM_MODE: 'live', PREMIUM_DB_PATH: ':memory:', PREMIUM_FACTION_KEY_SECRET: secret })), (e) => e.code === 'FACTION_KEY_SECRET_NOT_CONFIGURED');
  }

  const dir = tempDir(t, 'lrx-hub-secret-');
  const cfg = readConfig({ PREMIUM_MODE: 'test', PREMIUM_DB_PATH: path.join(dir, 'premium.sqlite') });
  const world = leaderWorld();
  let clock = T0;
  let hub = createFactionHub(cfg, { now: () => clock, fetchImpl: world.fetchImpl });
  await hub.updateSettings({ tornId: 555 }, 700, { connectKey: LEADER_KEY, consent: true });
  hub.grantPlan(ADMIN, { factionId: 700, days: 30, reason: 'restart test' });
  await hub.close();
  hub = createFactionHub(cfg, { now: () => clock, fetchImpl: world.fetchImpl });
  assert.equal((await hub.tickFaction(700)).status, 'ok', 'a key stored before a restart is still readable');
  await hub.close();

  // A changed secret pauses the collector with a clear code instead of failing every route
  hub = createFactionHub({ ...cfg, factionKeySecret: 'x'.repeat(40) }, { now: () => clock, fetchImpl: world.fetchImpl });
  try {
    clock += 600;
    const callsBefore = world.calls.length;
    const res = await hub.tickFaction(700);
    assert.equal(res.status, 'key_unreadable');
    assert.equal(world.calls.length, callsBefore);
    const col = hub.db.prepare('SELECT paused, last_error_code FROM faction_collectors WHERE faction_id=700').get();
    assert.equal(col.paused, 1);
    assert.equal(col.last_error_code, 'FACTION_KEY_DECRYPT_FAILED');
    const settings = await hub.getSettings({ tornId: 555 }, 700);
    assert.equal(settings.lastErrorCode, 'FACTION_KEY_DECRYPT_FAILED');
    assert.equal((await hub.getStatus({ tornId: 556 }, 700)).members.length, 2);
  } finally {
    await hub.close();
  }
});

test('finding 9: a live service without a faction key secret keeps login and payments up with only the hub disabled', async () => {
  const service = createPremiumService(readConfig({ PREMIUM_MODE: 'live', PREMIUM_DB_PATH: ':memory:' }), { now: () => T0, fetchImpl: async () => { throw new Error('No external calls expected'); } });
  try {
    assert.equal(service.factionHub.available, false);
    assert.equal(service.info().mode, 'live');
    await assert.rejects(() => service.factionHub.getStatus({ tornId: 1 }, 700), (e) => e.code === 'FACTION_HUB_UNAVAILABLE' && e.status === 503);
  } finally {
    await service.close();
  }
});

/* ---------- Finding 10 ---------- */
test('finding 10: an outbox row is claimed once, overlapping dispatches never resend it, and close() waits for the delivery', async () => {
  const gate = deferred();
  const sends = [];
  const hub = createFactionHub(makeConfig(), {
    now: () => T0,
    roleVerifier: officerVerifier([100]),
    notifyProvider: async (msg) => { sends.push(msg.idempotencyKey); await gate.promise; },
  });
  await hub.updateSettings({ tornId: 100 }, 500, { sharedReports: true });
  hub.grantPlan(ADMIN, { factionId: 500, days: 30, reason: 'outbox test' });
  insertOutbox(hub, 'k1', 500);
  const first = hub.dispatchOutbox({ factionId: 500 });
  const second = hub.dispatchOutbox({ factionId: 500 });
  const retry = hub.operatorJob(ADMIN, { requestId: 'retry-overlap', action: 'retry_outbox', factionId: 500, reason: 'overlap check' });
  await tick(); await tick();
  assert.equal(sends.length, 1);
  assert.equal(outboxStatus(hub, 'k1'), 'sending');
  let closed = false;
  const closing = hub.close().then(() => { closed = true; });
  await tick(); await tick();
  assert.equal(closed, false, 'close() must wait for the in-flight delivery');
  gate.resolve();
  const [r1] = await Promise.all([first, second, retry]);
  await closing;
  assert.equal(r1.sent, 1);
  assert.deepEqual(sends, ['k1']);
});

test('finding 10: a delivery interrupted by a restart is parked for review instead of being resent', async (t) => {
  const dir = tempDir(t, 'lrx-hub-sending-');
  const cfg = makeConfig({ PREMIUM_DB_PATH: path.join(dir, 'premium.sqlite'), PREMIUM_FACTION_DB_PATH: path.join(dir, 'hub.sqlite') });
  let hub = createFactionHub(cfg, { now: () => T0 });
  insertOutbox(hub, 'crashed', 500, 'sending');
  await hub.close();
  hub = createFactionHub(cfg, { now: () => T0 });
  try {
    assert.equal(outboxStatus(hub, 'crashed'), 'needs_review');
  } finally {
    await hub.close();
  }
});

/* ---------- Finding 11 ---------- */
test('finding 11: retry_outbox without an outboxId stays inside the requested faction', async () => {
  const sent = [];
  const hub = createFactionHub(makeConfig(), { now: () => T0, roleVerifier: officerVerifier([100]), notifyProvider: async (msg) => { sent.push(msg.idempotencyKey); } });
  try {
    hub.grantPlan(ADMIN, { factionId: 500, days: 30, reason: 'plan 500' });
    hub.grantPlan(ADMIN, { factionId: 600, days: 30, reason: 'plan 600' });
    insertOutbox(hub, 'f500', 500, 'failed');
    insertOutbox(hub, 'f600', 600, 'failed');
    const res = await hub.operatorJob(ADMIN, { requestId: 'retry-500', action: 'retry_outbox', factionId: 500, reason: 'retry faction 500' });
    assert.equal(res.result.sent, 1);
    assert.deepEqual(sent, ['f500']);
    assert.equal(outboxStatus(hub, 'f600'), 'failed', 'other factions are untouched');
    await assert.rejects(() => hub.operatorJob(ADMIN, { requestId: 'retry-all', action: 'retry_outbox', reason: 'unscoped retry' }), (e) => e.code === 'INVALID_FACTION_ID');
  } finally {
    await hub.close();
  }
});

test('finding 11 + quota: alerts are not queued while the plan is inactive, and quota_alerts_per_day caps them', async () => {
  let clock = T0;
  const hub = createFactionHub(makeConfig(), { now: () => clock, roleVerifier: officerVerifier([100]) });
  try {
    await hub.updateSettings({ tornId: 100 }, 500, { discordWebhook: 'https://discord.test/api/webhooks/1/tok', notifications: { travel: true } });
    const at = (desc) => [rosterMember(1, 'One', 'Member', { state: desc === 'Okay' ? 'Okay' : 'Traveling', desc }), rosterMember(2, 'Two', 'Member', { state: desc === 'Okay' ? 'Okay' : 'Traveling', desc })];
    snapshot(hub, 500, clock, at('Okay'));
    clock += 300;
    const noPlan = snapshot(hub, 500, clock, at('Traveling to Japan'));
    assert.equal(noPlan.transitionsCount, 2);
    assert.equal(noPlan.queuedAlerts, 0, 'no alert is queued without an active plan');
    assert.equal(hub.db.prepare('SELECT count(*) n FROM notification_outbox').get().n, 0);

    hub.grantPlan(ADMIN, { factionId: 500, days: 30, quotaAlertsPerDay: 1, reason: 'quota test' });
    clock += 300;
    const capped = snapshot(hub, 500, clock, at('In Japan'));
    assert.equal(capped.transitionsCount, 2);
    assert.equal(capped.queuedAlerts, 1);
    assert.equal(capped.suppressedAlerts, 1);
    assert.equal(hub.db.prepare('SELECT count(*) n FROM notification_outbox').get().n, 1);
  } finally {
    await hub.close();
  }
});

/* ---------- Finding 12 ---------- */
test('finding 12: the hub treats exactly the Torn error codes premium/torn-client.js treats as fatal as a dead key', async () => {
  const store = createStore(':memory:', { mode: 'test', receiverId: 4037017 });
  const fatal = [];
  try {
    for (let code = 0; code <= 30; code++) {
      const client = createTornClient(store, { fetchImpl: async () => json({ error: { code, error: 'Synthetic' } }) });
      const key = ('Code' + String(code).padStart(2, '0')).padEnd(16, 'a');
      try { await client.request('/v2/key/info', key); } catch (error) { if (error.retryable === false) fatal.push(code); }
    }
  } finally {
    store.close();
  }
  assert.deepEqual([...FATAL_TORN_CODES].sort((x, y) => x - y), fatal);
  for (const code of [1, 10, 13]) assert.ok(FATAL_TORN_CODES.has(code));
});

test('finding 12: Torn codes 13, 10 and 1 pause the collector, and an oversized Torn response is refused', async () => {
  const world = leaderWorld();
  let clock = T0;
  const hub = createFactionHub(makeConfig(), { now: () => clock, fetchImpl: world.fetchImpl });
  try {
    await hub.updateSettings({ tornId: 555 }, 700, { connectKey: LEADER_KEY, consent: true });
    hub.grantPlan(ADMIN, { factionId: 700, days: 30, reason: 'error test' });
    const col = () => hub.db.prepare('SELECT paused, last_error_code FROM faction_collectors WHERE faction_id=700').get();
    for (const code of [13, 10, 1]) {
      await hub.operatorJob(ADMIN, { requestId: 'resume-' + code, action: 'resume', factionId: 700, reason: 'resume for test' });
      world.errors.set(LEADER_KEY, code);
      const res = await hub.tickFaction(700, { kind: 'manual' });
      assert.equal(res.status, 'revoked_paused', 'code ' + code);
      assert.equal(col().paused, 1);
      assert.equal(col().last_error_code, 'TORN_' + code);
    }
    world.errors.delete(LEADER_KEY);
    await hub.operatorJob(ADMIN, { requestId: 'resume-big', action: 'resume', factionId: 700, reason: 'resume for test' });
    world.override = (u) => (/\/members$/.test(u.pathname) ? new Response('{"members":["' + 'x'.repeat(1024 * 1024 + 16) + '"]}') : null);
    const big = await hub.tickFaction(700, { kind: 'manual' });
    assert.equal(big.status, 'error');
    assert.equal(big.code, 'UPSTREAM_BODY_LIMIT');
    assert.equal(hub.db.prepare('SELECT count(*) n FROM roster_latest').get().n, 0);
  } finally {
    await hub.close();
  }
});

test('finding 12: member series returns real activity and travel values and honours the metric', async () => {
  let clock = T0;
  const hub = createFactionHub(makeConfig(), { now: () => clock, roleVerifier: officerVerifier([100]) });
  try {
    await hub.updateSettings({ tornId: 100 }, 500, { sharedReports: true });
    hub.grantPlan(ADMIN, { factionId: 500, days: 30, reason: 'series test' });
    snapshot(hub, 500, clock, [rosterMember(1, 'Jet', 'Member', { activity: 'Online' })]);
    clock += 300;
    snapshot(hub, 500, clock, [rosterMember(1, 'Jet', 'Member', { activity: 'Idle', state: 'Traveling', desc: 'Traveling to Japan' })]);
    clock += 300;
    snapshot(hub, 500, clock, [rosterMember(1, 'Jet', 'Member', { activity: 'Offline', state: 'Abroad', desc: 'In Japan' })]);
    const range = { from: T0 - 10, to: clock + 10 };
    const activity = await hub.getMemberSeries({ tornId: 100 }, 500, 1, { metric: 'activity', ...range });
    assert.deepEqual(activity.points.map((p) => p.value), [1, 0.5, 0]);
    const travel = await hub.getMemberSeries({ tornId: 100 }, 500, 1, { metric: 'travel', ...range });
    assert.equal(travel.metric, 'travel');
    assert.deepEqual(travel.points.map((p) => p.value), [0, 1, 1]);
    const stats = await hub.getMemberSeries({ tornId: 100 }, 500, 1, { metric: 'battlestats', ...range });
    assert.equal(stats.available, false);
    assert.deepEqual(stats.points, []);
  } finally {
    await hub.close();
  }
});

/* ---------- Lower-priority items ---------- */
test('lower priority: two processes sharing a DB use distinct lease owners', async (t) => {
  const dir = tempDir(t, 'lrx-hub-lease-');
  const cfg = makeConfig({ PREMIUM_DB_PATH: path.join(dir, 'premium.sqlite'), PREMIUM_FACTION_DB_PATH: path.join(dir, 'hub.sqlite') });
  const hubA = createFactionHub(cfg, { now: () => T0, roleVerifier: officerVerifier([100]) });
  const hubB = createFactionHub(cfg, { now: () => T0, roleVerifier: officerVerifier([100]) });
  try {
    await hubA.updateSettings({ tornId: 100 }, 500, { sharedReports: true });
    assert.notEqual(hubA.processOwner, hubB.processOwner);
    assert.equal(hubA.acquireLease(500).acquired, true);
    assert.equal(hubB.acquireLease(500).acquired, false, 'another process must not take a live lease');
  } finally {
    await hubA.close();
    await hubB.close();
  }
});

test('lower priority: a duplicate operator requestId cannot run twice while the first run is still in flight', async () => {
  const gate = deferred();
  let fetches = 0;
  const hub = createFactionHub(makeConfig(), {
    now: () => T0,
    roleVerifier: officerVerifier([100]),
    rosterFetcher: async () => { fetches++; await gate.promise; return { members: [rosterMember(100, 'Boss', 'Leader')] }; },
  });
  try {
    await hub.updateSettings({ tornId: 100 }, 500, { sharedReports: true });
    hub.grantPlan(ADMIN, { factionId: 500, days: 30, reason: 'dup test' });
    const first = hub.operatorJob(ADMIN, { requestId: 'dup-refresh', action: 'queue_refresh', factionId: 500, reason: 'first run' });
    await tick();
    const second = await hub.operatorJob(ADMIN, { requestId: 'dup-refresh', action: 'queue_refresh', factionId: 500, reason: 'second run' });
    assert.equal(second.idempotentReplay, true);
    gate.resolve();
    assert.equal((await first).result.status, 'ok');
    assert.equal(fetches, 1);
  } finally {
    await hub.close();
  }
});

test('lower priority: a failed collection never undoes an officer pause made while the request was in flight', async () => {
  const gate = deferred();
  const hub = createFactionHub(makeConfig(), {
    now: () => T0,
    roleVerifier: officerVerifier([100]),
    fetchImpl: async () => { await gate.promise; return new Response('rate limited', { status: 429 }); },
  });
  try {
    await hub.updateSettings({ tornId: 100 }, 500, { connectKey: LEADER_KEY, consent: true });
    hub.grantPlan(ADMIN, { factionId: 500, days: 30, reason: 'pause test' });
    const run = hub.tickFaction(500);
    await tick();
    await hub.updateSettings({ tornId: 100 }, 500, { paused: true });
    gate.resolve();
    assert.equal((await run).status, 'error');
    assert.equal(hub.db.prepare('SELECT paused FROM faction_collectors WHERE faction_id=500').get().paused, 1);
  } finally {
    await hub.close();
  }
});

test('lower priority: freshness turns stale only after 2.5 collector intervals', async () => {
  let clock = T0;
  const hub = createFactionHub(makeConfig(), { now: () => clock, roleVerifier: officerVerifier([100]) });
  try {
    await hub.updateSettings({ tornId: 100 }, 500, { sharedReports: true });
    hub.grantPlan(ADMIN, { factionId: 500, days: 30, reason: 'stale test' });
    snapshot(hub, 500, clock, [rosterMember(1, 'Jet', 'Member')]);
    clock += 400;
    assert.equal((await hub.getStatus({ tornId: 100 }, 500)).freshness.state, 'fresh');
    clock += 400;
    assert.equal((await hub.getStatus({ tornId: 100 }, 500)).freshness.state, 'stale');
  } finally {
    await hub.close();
  }
});
