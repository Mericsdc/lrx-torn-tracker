const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createPremiumService } = require('../../premium/service');
const { createStore } = require('../../premium/store');
const { readConfig } = require('../../premium/config');
const ADMIN = { tornId: 4037017, admin: true };

test('concurrent synthetic requests each finish processing their own batch', async (t) => {
  const config = readConfig({ PREMIUM_MODE: 'test', PREMIUM_DB_PATH: ':memory:' });
  const service = createPremiumService(config); t.after(() => service.close());
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => service.adminAction(ADMIN, 'test-payment', { torn_id: 9500000000 + i, quantity: 2 })));
  for (const result of results) { assert.equal(result.processing.status, 'ok'); assert.equal(result.addedDays, 30); assert.equal(result.recordCount, 1); }
  assert.equal(service.store.db.prepare('SELECT count(*) AS n FROM premium_test_batches WHERE consumed_at IS NULL').get().n, 0);
  const replays = await Promise.all(results.map((r) => service.adminAction(ADMIN, 'test-replay', { event_id: r.eventId })));
  for (const result of replays) { assert.equal(result.addedDays, 0); assert.equal(result.subscription.remainingDays, 30); assert.equal(result.recordCount, 1); }
});
test('a baseline cannot be reset during a leased payment check', (t) => {
  const store = createStore(':memory:'); t.after(() => store.close());
  store.acquireLease('running-worker'); const before = { ...store.checkpoint() };
  assert.throws(() => store.rebaseline(ADMIN, 'Attempt overlapping baseline reset'), (e) => e.code === 'PAYMENT_CHECK_IN_PROGRESS');
  assert.deepEqual({ ...store.checkpoint() }, before);
  store.releaseLease('running-worker'); store.rebaseline(ADMIN, 'Safe baseline after worker completed');
});
test('payment database explicitly uses FULL synchronous durability', (t) => {
  const store = createStore(':memory:'); t.after(() => store.close());
  assert.equal(store.db.prepare('PRAGMA synchronous').get().synchronous, 2);
});
test('older service refuses a future schema and releases the database handle', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-schema-test-'));
  t.after(() => { const resolved = path.resolve(dir); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); assert.ok(path.basename(resolved).startsWith('lrx-schema-test-')); fs.rmSync(resolved, { recursive: true, force: true }); });
  const file = path.join(dir, 'future.sqlite');
  const store = createStore(file); store.db.prepare('INSERT INTO premium_migrations VALUES(999,0)').run(); store.close();
  assert.throws(() => createStore(file), /newer service version/);
});
