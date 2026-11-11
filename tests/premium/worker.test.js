const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../../premium/store');
const { createWorker } = require('../../premium/worker');
const { createTornClient } = require('../../premium/torn-client');
const { parseEvent } = require('../../premium/parser');
const ADMIN = { tornId: 4037017, admin: true };
const cfg = { mode: 'live', receiverKey: 'AbCdEfGh12345678', livePaymentsAllowed: true, formatVerified: true, controllerName: 'Fixture', privacyContact: 'test@example.invalid', publicUrl: 'https://example.invalid', recordRetentionPolicy: 'Fixture only' };
function fixture(t) {
  const store = createStore(':memory:', { now: () => 2000 }); t.after(() => store.close());
  store.registerVerifiedUser(123456); store.updateSettings(ADMIN, { revision: 1, enabled: true, reason: 'Enable fixture adapter' });
  store.acquireLease('setup'); store.checkpointUpdate('setup', { baseline_at: 900, anchor_event_id: 'anchor' }); store.releaseLease('setup');
  return store;
}
const event = (id, timestamp, pay = false) => ({ id, timestamp, event: pay ? 'You were sent 1x Xanax from <a href="profiles.php?XID=123456">Player</a>' : 'You won a race.' });
const envelope = (events) => ({ events, _metadata: { links: { prev: null, next: null } } });

test('live activation baselines old events, awards two new Xanax as 30 days, and ignores replay', async (t) => {
  let now = 2000;
  const store = createStore(':memory:', { mode: 'live', now: () => now }); t.after(() => store.close());
  store.registerVerifiedUser(123456);
  store.updateSettings(ADMIN, { revision: 1, enabled: true, reason: 'Operator enables verified receiver' });
  const old = event('historical', 1999, true);
  let events = [old];
  const client = { identity: async () => ({ tornId: 4037017, selections: ['events'] }), timestamp: async () => now,
    page: async () => envelope(events), previousParams: () => null };
  const worker = createWorker(store, client, cfg);
  assert.equal((await worker.tick()).applied, 0);
  assert.equal(store.entitlement(123456).active, false);
  now += 61;
  events = [{ ...event('incoming_two_xanax', now, true), event: 'You were sent 2x Xanax from <a href="profiles.php?XID=123456">Player</a>' }, old];
  assert.equal((await worker.tick()).applied, 1);
  const expiry = store.entitlement(123456).expiresAt;
  assert.equal(store.entitlement(123456).remainingDays, 30);
  now += 61;
  assert.equal((await worker.tick()).applied, 0);
  assert.equal(store.entitlement(123456).expiresAt, expiry);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM premium_transactions').get().n, 1);
});

test('inclusive pagination recovers other transfers sharing the oldest second', async (t) => {
  const store = fixture(t), requested = [];
  const first = Array.from({ length: 99 }, (_, i) => event('activity_' + i, 1999 - i)); first.push(event('boundary_A', 1500, true));
  const second = [event('boundary_A', 1500, true), event('boundary_B', 1500, true), event('anchor', 1000)];
  const client = { identity: async () => ({ tornId: 4037017, selections: ['events'] }), timestamp: async () => 2000,
    page: async (_key, params) => { requested.push(params); return envelope(requested.length === 1 ? first : second); }, previousParams: () => ({ to: 1499 }) };
  const worker = createWorker(store, client, cfg);
  assert.equal((await worker.tick()).status, 'ok'); assert.deepEqual(requested, [{}, { to: 1500 }]);
  assert.equal(store.balance(123456).total_received, 2); assert.equal(store.entitlement(123456).remainingDays, 30);
});

test('saturated same-second pages and lost worker leases cannot award uncertain payments', async (t) => {
  const store = fixture(t);
  const client = { identity: async () => ({ tornId: 4037017, selections: ['events'] }), timestamp: async () => 2000,
    page: async () => envelope(Array.from({ length: 100 }, (_, i) => event(i === 99 ? 'anchor' : 'payment_' + i, 1500, true))), previousParams: () => null };
  const worker = createWorker(store, client, cfg);
  assert.equal((await worker.tick()).code, 'EVENT_BOUNDARY_SATURATED'); assert.equal(store.entitlement(123456).active, false);
  store.acquireLease('first'); store.releaseLease('first'); store.acquireLease('second');
  assert.throws(() => store.ingest(parseEvent(event('lease_payment', 1500, true), 2000), 'fixture', 'first'), (e) => e.code === 'LEASE_LOST');
  assert.equal(store.balance(123456).total_received, 0);
});

test('API budgets combine different known keys for the same Torn owner', async (t) => {
  const store = fixture(t); let calls = 0;
  const client = createTornClient(store, { fetchImpl: async () => { calls++; return new Response(JSON.stringify({ info: { user: { id: 123456 }, selections: { user: ['events'] } } })); } });
  await client.identity('AbCdEfGh12345678'); await client.identity('QrStUvWx12345678');
  for (let i = 0; i < 18; i++) await client.request('/v2/user/timestamp', 'AbCdEfGh12345678');
  await assert.rejects(client.request('/v2/user/timestamp', 'QrStUvWx12345678'), (e) => e.code === 'LOCAL_API_BUDGET');
  assert.equal(calls, 20);
});

test('review text expires without losing duplicate prevention or payment amounts', (t) => {
  const store = fixture(t);
  const parsed = parseEvent({ id: 'review_text', timestamp: 1500, event: 'You were sent 1x Xanax from a broken link' }, 2000);
  store.ingest(parsed);
  store.db.prepare('UPDATE premium_transactions SET observed_at=?').run(1);
  store.maintenance(1);
  // The current fixture is under a day old, so retain it until the configured deadline.
  assert.ok(store.db.prepare('SELECT event_text FROM premium_transactions').get().event_text);
  store.db.prepare('UPDATE premium_transactions SET observed_at=?').run(-100000);
  store.maintenance(1);
  assert.equal(store.db.prepare('SELECT event_text FROM premium_transactions').get().event_text, '');
  assert.equal(store.ingest(parsed).status, 'duplicate');
});

test('temporary API outage preserves subscription and uses persisted retry state on a new worker', async (t) => {
  const store = fixture(t);
  store.ingest(parseEvent(event('prior_payment', 1500, true), 2000));
  const expiry = store.entitlement(123456).expiresAt;
  let requests = 0;
  const client = createTornClient(store, { fetchImpl: async () => { requests++; return new Response('{}', { status: 503 }); } });
  assert.equal((await createWorker(store, client, cfg, { random: () => 0 }).tick()).code, 'UPSTREAM_HTTP_503');
  assert.equal(store.checkpoint().next_check_at, 2060);
  assert.equal((await createWorker(store, client, cfg).tick({ force: true })).status, 'waiting');
  assert.equal(requests, 1); assert.equal(store.entitlement(123456).expiresAt, expiry);
});

test('first synthetic batch is not lost when its first scheduled check is delayed', async (t) => {
  const store = fixture(t); store.rebaseline(ADMIN, 'Initialize delayed synthetic fixture');
  store.db.prepare('INSERT INTO premium_test_batches(payload,created_at) VALUES(?,?)').run(JSON.stringify({ events: [event('delayed_first_test', 1500, true)] }), 1500);
  const worker = createWorker(store, {}, { mode: 'test' });
  assert.equal((await worker.tick()).applied, 1);
  assert.equal(store.entitlement(123456).remainingDays, 15);
});
