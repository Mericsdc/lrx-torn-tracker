const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStore, DAY } = require('../../premium/store');
const { parseEvent } = require('../../premium/parser');
const { parseItemLog, collectItemLogs } = require('../../premium/payment-logs');
const { createWorker } = require('../../premium/worker');
const { createTornClient } = require('../../premium/torn-client');
const ADMIN = { tornId: 4037017, admin: true }, NOW = 1794423669;
const notification = { id: 'incoming_notification', timestamp: NOW, event: 'You were sent some Xanax from <a href="https://www.torn.com/profiles.php?XID=123456">Player</a>' };
const log = (id = 'verified_log', qty = 1) => ({ id, timestamp: NOW, details: { id: 4103 }, data: { sender: 123456, items: [{ id: 206, qty }], message: '' } });
function fixture(t) {
  const clock = { now: NOW + 5 }, store = createStore(':memory:', { now: () => clock.now, mode: 'live' }); t.after(() => store.close());
  store.acquireLease('setup'); store.checkpointUpdate('setup', { baseline_at: NOW - 100 }); store.releaseLease('setup');
  store.registerVerifiedUser(123456); return { store, clock };
}
test('some Xanax notification never invents a quantity; outgoing transfers are ignored', () => {
  const parsed = parseEvent(notification, NOW);
  assert.equal(parsed.senderId, 123456); assert.equal(parsed.quantity, null); assert.equal(parsed.verified, false); assert.equal(parsed.reason, 'quantity_missing');
  assert.equal(parseEvent({ ...notification, event: 'You sent some Xanax to <a href="profiles.php?XID=1">Player</a>' }, NOW).status, 'ignored');
});
test('official item log repairs the existing pending event automatically and preserves a manual day', (t) => {
  const { store } = fixture(t); store.adjustSubscription(ADMIN, { torn_id: 123456, days: 1, reason: 'Existing trial day' });
  const waiting = store.ingest(parseEvent(notification, NOW));
  store.db.prepare("UPDATE premium_transactions SET torn_sender_id=NULL,reason='unrecognized_transfer' WHERE id=?").run(waiting.id);
  const parsed = parseItemLog(log(), NOW);
  assert.equal(store.ingestItemLog(parsed).status, 'applied');
  assert.equal(store.entitlement(123456).remainingDays, 16);
  const row = store.historyFor(123456)[0]; assert.equal(row.eventId, notification.id); assert.equal(row.quantity, 1); assert.equal(row.premiumDays, 15);
  const expiry = store.entitlement(123456).expiresAt;
  assert.equal(store.ingestItemLog(parsed).status, 'duplicate'); assert.equal(store.entitlement(123456).expiresAt, expiry);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM premium_transactions').get().n, 1);
});
test('an event already credited is linked to its log without awarding again', (t) => {
  const { store } = fixture(t);
  store.ingest(parseEvent({ ...notification, event: notification.event.replace('some Xanax', '2x Xanax') }, NOW));
  assert.equal(store.ingestItemLog(parseItemLog(log('first', 2), NOW)).status, 'duplicate');
  assert.equal(store.entitlement(123456).remainingDays, 30);
  assert.equal(store.ingestItemLog(parseItemLog(log('second', 2), NOW)).status, 'applied');
  assert.equal(store.entitlement(123456).remainingDays, 60, 'a separate real log in the same second is a separate transfer');
  assert.equal(store.balance(123456).total_received, 4);
});
test('log parser sums only Xanax; malformed quantities, wrong types and missing senders cannot credit', () => {
  const mixed = log(); mixed.data.items.push({ id: 206, qty: 2 }, { id: 366, qty: 10 });
  assert.equal(parseItemLog(mixed, NOW).quantity, 3);
  assert.equal(parseItemLog({ ...log(), data: { sender: 123456, items: [{ id: 366, qty: 2 }] } }, NOW), null);
  for (const bad of [{ ...log(), details: { id: 6733 } }, { ...log(), data: { items: [{ id: 206, qty: 1 }] } }, { ...log(), data: { sender: 123456, items: [{ id: 206, qty: 1.5 }] } }]) assert.throws(() => parseItemLog(bad, NOW));
});
test('log reconciliation is fenced and detects changed data under the same log ID', (t) => {
  const { store } = fixture(t); const parsed = parseItemLog(log(), NOW);
  assert.throws(() => store.ingestItemLog(parsed, 'unowned'), error => error.code === 'LEASE_LOST');
  store.ingestItemLog(parsed); const expiry = store.entitlement(123456).expiresAt;
  assert.equal(store.ingestItemLog(parseItemLog(log('verified_log', 2), NOW)).status, 'conflict');
  assert.equal(store.entitlement(123456).expiresAt, expiry);
});
test('custom Item receive keys collect without events access and replay is idempotent across workers', async (t) => {
  const { store, clock } = fixture(t); store.updateSettings(ADMIN, { revision: 1, enabled: true, reason: 'Enable structured logs' });
  const cfg = { mode: 'live', livePaymentsAllowed: true, formatVerified: true, receiverKey: 'AbCdEfGh12345678', controllerName: 'Test', privacyContact: 'test', publicUrl: 'https://test.invalid', recordRetentionPolicy: 'Fixture' };
  const client = { identity: async () => ({ tornId: 4037017, selections: [], itemLogAccess: true }), timestamp: async () => clock.now, itemLogs: async () => ({ log: [log('two', 2)], _metadata: { links: { prev: null } } }) };
  assert.equal((await createWorker(store, client, cfg).tick()).applied, 1); assert.equal(store.entitlement(123456).remainingDays, 30);
  clock.now += 61; assert.equal((await createWorker(store, client, cfg).tick()).applied, 0);
  assert.equal(store.balance(123456).total_received, 2);
});
test('nanosecond pagination remains exact and rejects foreign cursor URLs', async (t) => {
  const { store } = fixture(t); store.acquireLease('reader'); const seen = [];
  const client = { itemLogs: async (_key, params) => { seen.push(params); return params.nanostamp ? { log: [], _metadata: { links: { prev: null } } } : { log: [log()], _metadata: { links: { prev: 'https://api.torn.com/v2/user/log?nanostamp=1794423669123456789' } } }; } };
  assert.equal((await collectItemLogs(store, client, 'key', store.checkpoint(), NOW, 'reader')).length, 1);
  assert.equal(seen[1].nanostamp, '1794423669123456789');
  client.itemLogs = async () => ({ log: [log()], _metadata: { links: { prev: 'https://evil.invalid/v2/user/log?nanostamp=1794423669123456789' } } });
  await assert.rejects(collectItemLogs(store, client, 'key', store.checkpoint(), NOW, 'reader'), error => error.code === 'ITEM_LOG_PAGINATION');
});
test('player names come from the official matching profile, are searchable and use the shared cache', async (t) => {
  const { store } = fixture(t); let calls = 0;
  const client = createTornClient(store, { fetchImpl: async url => { calls++; assert.equal(new URL(url).pathname, '/v2/user/123456/basic'); return new Response(JSON.stringify({ profile: { id: 123456, name: 'ExamplePlayer' } })); } });
  await client.profile('AbCdEfGh12345678', 123456); await client.profile('AbCdEfGh12345678', 123456);
  assert.equal(calls, 1); assert.equal(store.members({ search: 'ExamplePlayer' }).members[0].name, 'ExamplePlayer'); assert.equal(store.exportData(123456).account.name, 'ExamplePlayer');
});
