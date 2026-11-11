const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createStore, DAY } = require('../../premium/store');
const { parseEvent, normalizeEvents } = require('../../premium/parser');
const { createTornClient, TornError } = require('../../premium/torn-client');
const { createWorker, liveGate } = require('../../premium/worker');
const { createPremiumService } = require('../../premium/service');
const { readConfig } = require('../../premium/config');
const exec = promisify(execFile);
const ADMIN = { tornId: 4037017, admin: true };
const PRIVACY = { controllerName: 'Fixture operator', privacyContact: 'fixture@example.invalid', publicUrl: 'https://premium.example.invalid', recordRetentionPolicy: 'Fixture only; deleted after tests' };
function fixture(t, filename = ':memory:') {
  const clock = { now: 1794331965 };
  const store = createStore(filename, { now: () => clock.now, mode: 'test' });
  store.acquireLease('setup'); store.checkpointUpdate('setup', { baseline_at: clock.now - 10, watermark_at: clock.now - 10 }); store.releaseLease('setup');
  t.after(() => store.close());
  return { store, clock };
}
const event = (id, quantity = 1, sender = 123456, timestamp = 1794331965) => ({ id, timestamp, event: `You were sent ${quantity}x Xanax from <a href="profiles.php?XID=${sender}">Player</a>` });
const apply = (store, id, quantity, sender) => store.ingest(parseEvent(event(id, quantity, sender), store.now()));
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-premium-tests-'));
  t.after(() => { const resolved = path.resolve(root); if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('lrx-premium-tests-')) throw new Error('Unsafe cleanup path'); fs.rmSync(resolved, { recursive: true, force: true }); });
  return root;
}
test('one transfer activates premium; API-derived sender maps to a verified account', (t) => {
  const { store, clock } = fixture(t); store.registerVerifiedUser(123456);
  assert.equal(apply(store, 'payment_A', 2).status, 'applied');
  assert.equal(store.entitlement(123456).expiresAt, clock.now + 30 * DAY);
  assert.deepEqual({ available: store.balance(123456).available_xanax, received: store.balance(123456).total_received }, { available: 0, received: 2 });
});
test('separate partial transfers aggregate and extend an existing subscription', (t) => {
  const { store, clock } = fixture(t); store.registerVerifiedUser(123456);
  store.adjustSubscription(ADMIN, { torn_id: 123456, days: 12, reason: 'Test existing subscription' });
  apply(store, 'partial_A', 1); apply(store, 'partial_B', 1);
  assert.equal(store.entitlement(123456).expiresAt, clock.now + 42 * DAY);
  assert.equal(store.historyFor(123456).length, 2);
});
test('duplicate IDs never add premium or balances twice, including after a price change', (t) => {
  const { store, clock } = fixture(t); store.registerVerifiedUser(123456);
  apply(store, 'same_event', 2);
  store.updateSettings(ADMIN, { revision: store.settings().revision, days_per_xanax: 20, reason: 'Change future pricing' });
  clock.now += 2;
  assert.equal(apply(store, 'same_event', 2).status, 'duplicate');
  assert.equal(store.historyFor(123456)[0].premiumDays, 30);
  assert.equal(store.balance(123456).total_received, 2);
  assert.equal(apply(store, 'same_event', 3).status, 'conflict');
  assert.equal(store.balance(123456).total_received, 2);
  assert.equal(store.entitlement(123456).remainingDays, 30);
});
test('malformed HTML, missing sender, duplicate href and foreign origins enter review without credit', (t) => {
  const { store } = fixture(t); store.registerVerifiedUser(123456);
  const cases = ['You were sent 2x Xanax', 'You were sent 2x Xanax from <a href="profiles.php?XID=123456>Player</a>', 'You were sent 2x Xanax from <a href="https://evil.invalid/profiles.php?XID=123456">Player</a>', 'You were sent 2x Xanax from <a href="profiles.php?XID=123456" href="profiles.php?XID=999">Player</a>'];
  for (const [i, text] of cases.entries()) {
    const parsed = parseEvent({ ...event('invalid_' + i), event: text });
    assert.equal(parsed.verified, false); assert.equal(store.ingest(parsed).status, 'review');
  }
  assert.equal(store.entitlement(123456).active, false);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM premium_transactions').get().n, cases.length);
});
test('non-Xanax transfers and unrelated activity are not retained or credited', (t) => {
  const { store } = fixture(t); store.registerVerifiedUser(123456);
  const other = { ...event('other'), event: event('other').event.replace('Xanax', 'Lollipop') };
  assert.equal(store.ingest(parseEvent(other)).status, 'ignored');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM premium_transactions').get().n, 0);
  assert.equal(store.entitlement(123456).active, false);
});
test('unknown sender stays pending and only that verified Torn identity can claim it', (t) => {
  const { store, clock } = fixture(t);
  assert.equal(apply(store, 'pending_A', 1).status, 'pending_identity');
  assert.equal(apply(store, 'pending_B', 1).status, 'pending_identity');
  store.registerVerifiedUser(888888);
  assert.equal(store.entitlement(888888).active, false);
  store.registerVerifiedUser(123456);
  assert.equal(store.entitlement(123456).expiresAt, clock.now + 30 * DAY);
  assert.equal(store.balance(123456).available_xanax, 0);
});
test('rate snapshots use transfer time, including delayed discovery and pending identity', (t) => {
  const { store, clock } = fixture(t);
  apply(store, 'old_price', 1);
  store.updateSettings(ADMIN, { revision: store.settings().revision, days_per_xanax: 20, reason: 'Publish a new price' });
  clock.now += 5;
  store.ingest(parseEvent(event('delayed_old_price', 1, 123456, clock.now - 5), clock.now));
  store.ingest(parseEvent(event('new_price', 1, 123456, clock.now), clock.now));
  store.registerVerifiedUser(123456);
  assert.equal(store.entitlement(123456).expiresAt, clock.now + 50 * DAY);
  assert.equal(store.db.prepare("SELECT event_text FROM premium_transactions WHERE event_id='old_price'").get().event_text, '');
});
test('database survives restart; test records cannot be reused as live billing data', (t) => {
  const filename = path.join(temp(t), 'premium.sqlite');
  let store = createStore(filename, { now: () => 1794331965, mode: 'test' });
  store.acquireLease('setup'); store.checkpointUpdate('setup', { baseline_at: 1794331960 }); store.releaseLease('setup');
  store.registerVerifiedUser(123456); apply(store, 'restart_A', 2); store.close();
  store = createStore(filename, { now: () => 1794331965, mode: 'test' });
  assert.equal(store.entitlement(123456).remainingDays, 30);
  assert.equal(apply(store, 'restart_A', 2).status, 'duplicate'); store.close();
  assert.throws(() => createStore(filename, { mode: 'live' }), /separate/);
});
test('two separate processes cannot credit one event twice', async (t) => {
  const root = temp(t), filename = path.join(root, 'concurrent.sqlite');
  const store = createStore(filename, { now: () => 1794331965, mode: 'test' });
  store.acquireLease('setup'); store.checkpointUpdate('setup', { baseline_at: 1794331960 }); store.releaseLease('setup'); store.registerVerifiedUser(123456);
  const modulePath = path.resolve(__dirname, '../../premium/store');
  const parserPath = path.resolve(__dirname, '../../premium/parser');
  const program = `const {createStore}=require(${JSON.stringify(modulePath)}); const {parseEvent}=require(${JSON.stringify(parserPath)}); const s=createStore(process.argv[1],{mode:'test',now:()=>1794331965}); console.log(JSON.stringify(s.ingest(parseEvent(${JSON.stringify(event('concurrent_event', 2))},1794331965))));s.close();`;
  const env = { SystemRoot: process.env.SystemRoot, TEMP: root, TMP: root };
  const results = await Promise.all([exec(process.execPath, ['-e', program, filename], { env, timeout: 15000 }), exec(process.execPath, ['-e', program, filename], { env, timeout: 15000 })]);
  assert.deepEqual(results.map((r) => JSON.parse(r.stdout).status).sort(), ['applied', 'duplicate']);
  assert.equal(store.entitlement(123456).remainingDays, 30); assert.equal(store.balance(123456).total_received, 2); store.close();
});
test('expiration and unauthorized administrator actions never rely on frontend flags', (t) => {
  const { store, clock } = fixture(t); store.registerVerifiedUser(123456); apply(store, 'expires', 1);
  clock.now += 15 * DAY;
  assert.equal(store.entitlement(123456).active, false);
  assert.throws(() => store.adjustSubscription({ tornId: 123456, admin: false }, { torn_id: 123456, days: 100, reason: 'Unauthorized extension' }), (e) => e.code === 'ADMIN_REQUIRED');
  assert.throws(() => store.updateSettings({ tornId: 123456 }, { enabled: true }), (e) => e.code === 'ADMIN_REQUIRED');
  store.expire(); assert.equal(store.db.prepare('SELECT status FROM premium_subscriptions').get().status, 'expired');
});
test('Torn 429 and temporary failures back off durably without altering premium', async (t) => {
  const { store, clock } = fixture(t); store.registerVerifiedUser(123456); apply(store, 'already_paid', 1);
  const expires = store.entitlement(123456).expiresAt;
  store.updateSettings(ADMIN, { revision: 1, enabled: true, reason: 'Enable test polling' });
  const client = createTornClient(store, { fetchImpl: async () => new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }) });
  await assert.rejects(client.identity('AbCdEfGh12345678'), (e) => e.code === 'UPSTREAM_RATE_LIMIT' && e.retryAfter === 120);
  let calls = 0;
  const cfg = { ...PRIVACY, mode: 'live', receiverKey: 'AbCdEfGh12345678', livePaymentsAllowed: true, approvalReference: 'Fixture approval only', formatVerified: true };
  const worker = createWorker(store, { identity: async () => { calls++; throw new TornError('UPSTREAM_RATE_LIMIT', { retryAfter: 120 }); } }, cfg, { random: () => 0 });
  assert.equal((await worker.tick()).code, 'UPSTREAM_RATE_LIMIT');
  assert.equal(store.checkpoint().next_check_at, clock.now + 120);
  assert.equal((await worker.tick({ force: true })).status, 'waiting');
  assert.equal(calls, 1); assert.equal(store.entitlement(123456).expiresAt, expires);
});
test('initial live baseline ignores old transfers; missing history anchor pauses safely', async (t) => {
  const { store, clock } = fixture(t); store.registerVerifiedUser(123456);
  store.rebaseline(ADMIN, 'Start first receiver baseline');
  store.updateSettings(ADMIN, { revision: 1, enabled: true, reason: 'Enable fixture live adapter' });
  let page = [event('old_transfer', 2, 123456, clock.now - 1)];
  const client = { identity: async () => ({ tornId: 4037017, selections: ['events'] }), timestamp: async () => clock.now, page: async () => ({ events: page, _metadata: { links: { prev: null, next: null } } }), previousParams: () => null };
  const config = { ...PRIVACY, mode: 'live', receiverKey: 'AbCdEfGh12345678', livePaymentsAllowed: true, approvalReference: 'Fixture approval only', formatVerified: true };
  const worker = createWorker(store, client, config, { random: () => 0 });
  assert.equal((await worker.tick()).status, 'ok'); assert.equal(store.entitlement(123456).active, false);
  clock.now += 61;
  page = [event('new_transfer', 2, 123456, clock.now)];
  assert.equal((await worker.tick()).code, 'EVENT_HISTORY_GAP');
  assert.equal(store.checkpoint().gap_detected, 1); assert.equal(store.entitlement(123456).active, false);
});
test('live acceptance is closed by default and cannot be enabled through administrator settings alone', async (t) => {
  const config = readConfig({ PREMIUM_MODE: 'live', PREMIUM_DB_PATH: ':memory:' });
  config.dbPath = ':memory:';
  const service = createPremiumService(config, { filename: ':memory:', now: () => 1794331965, fetchImpl: async () => { throw new Error('No external calls expected'); } });
  t.after(() => service.close());
  assert.equal(liveGate(config).allowed, false);
  await assert.rejects(service.adminAction(ADMIN, 'settings', { revision: 1, enabled: true, reason: 'Attempt to enable without approval' }), (e) => e.code === 'LIVE_PAYMENTS_DISABLED');
  assert.equal(service.store.settings().enabled, 0);
});
test('v1 normalization preserves event IDs; unverified inputs cannot be manually reassigned', (t) => {
  const { store } = fixture(t);
  const value = event('v1_event', 1);
  assert.equal(normalizeEvents({ events: { v1_event: { timestamp: value.timestamp, event: value.event } } }, 'torn-v1-events')[0].id, 'v1_event');
  const parsed = parseEvent({ ...value, event: 'You were sent 1x Xanax' });
  const row = store.ingest(parsed);
  assert.throws(() => store.review(ADMIN, row.id, 'retry', 'Cannot invent a sender'), (e) => e.code === 'TRANSFER_NOT_VERIFIED');
});
