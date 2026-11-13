const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPremiumService } = require('../../premium/service');
const { readConfig } = require('../../premium/config');
const { DAY } = require('../../premium/store');
const ADMIN = { tornId: 4037017, admin: true };
function fixture(t, mode = 'test') {
  const clock = { now: 1794331965 };
  const config = readConfig({ PREMIUM_MODE: mode, PREMIUM_DB_PATH: ':memory:', PREMIUM_TEST_AUTH_TOKEN: crypto.randomBytes(32).toString('hex') });
  const service = createPremiumService(config, { now: () => clock.now, fetchImpl: async () => { throw Error('No external calls allowed'); } });
  t.after(() => service.close()); return { service, clock };
}
test('Ezlira has a server-enforced permanent membership after identity verification', async (t) => {
  const { service, clock } = fixture(t);
  assert.equal(service.store.entitlement(4037017).active, false, 'unverified IDs are not identities');
  service.auth.loginTest(service.config.testAuthToken, 4037017);
  let e = service.store.entitlement(4037017);
  assert.equal(e.active, true); assert.equal(e.permanent, true); assert.equal(e.expiresAt, null); assert.equal(e.remainingDays, null);
  clock.now += 200 * 365 * DAY; service.store.expire();
  e = service.requirePremium(ADMIN); assert.equal(e.active, true); assert.equal(e.permanent, true);
  await assert.rejects(service.adminAction(ADMIN, 'subscription', { torn_id: 4037017, days: -1000, reason: 'Attempt to remove protected founder access' }), (e) => e.code === 'PERMANENT_MEMBERSHIP_PROTECTED');
  service.store.registerVerifiedUser(123456); assert.equal(service.store.entitlement(123456).permanent, false);
});
test('in-app synthetic two-Xanax action awards 30 days and replay adds zero days without enabling collection', async (t) => {
  const { service } = fixture(t); service.store.registerVerifiedUser(4037017);
  const paid = await service.adminAction(ADMIN, 'test-payment', { quantity: 2 });
  assert.equal(paid.addedDays, 30); assert.equal(paid.subscription.remainingDays, 30); assert.equal(paid.recordCount, 1);
  const replay = await service.adminAction(ADMIN, 'test-replay', { event_id: paid.eventId });
  assert.equal(replay.addedDays, 0); assert.equal(replay.subscription.expiresAt, paid.subscription.expiresAt); assert.equal(replay.recordCount, 1);
  assert.equal(service.store.settings().enabled, 0); assert.equal(service.info().livePayments, false);
  assert.equal(service.store.entitlement(4037017).permanent, true);
});
test('admin snapshot carries the Xanax received from every member; a member snapshot does not', async (t) => {
  const { service } = fixture(t); service.store.registerVerifiedUser(4037017);
  assert.equal(service.me(ADMIN).receivedTotal, 0);
  await service.adminAction(ADMIN, 'test-payment', { quantity: 2 });
  const second = await service.adminAction(ADMIN, 'test-payment', { quantity: 4 });
  assert.equal(service.me(ADMIN).receivedTotal, 6);
  const member = service.me({ tornId: second.tornId, admin: false });
  assert.equal('receivedTotal' in member, false, 'members never see the owner total');
  assert.equal(member.balance.total_received, 4);
});
test('member directory exposes remaining days and lifetime state with filters, search and pagination', async (t) => {
  const { service } = fixture(t); service.store.registerVerifiedUser(4037017);
  const paid = await service.adminAction(ADMIN, 'test-payment', { quantity: 2 });
  for (let i = 1; i <= 26; i++) service.store.registerVerifiedUser(100000 + i);
  const all = await service.adminAction(ADMIN, 'members', {});
  assert.equal(all.total, 28); assert.equal(all.members.length, 25); assert.equal(all.members[0].name, 'Ezlira'); assert.equal(all.counts.active, 2);
  const second = await service.adminAction(ADMIN, 'members', { page: 2 }); assert.equal(second.members.length, 3);
  const active = await service.adminAction(ADMIN, 'members', { filter: 'active' }); assert.equal(active.total, 2);
  const found = await service.adminAction(ADMIN, 'members', { search: String(paid.tornId) }); assert.equal(found.members[0].remainingDays, 30);
  const founder = await service.adminAction(ADMIN, 'members', { search: 'Ezlira', filter: 'permanent' }); assert.equal(founder.members[0].permanent, true);
  await assert.rejects(service.adminAction({ tornId: 123456, admin: false }, 'members', {}), (e) => e.code === 'ADMIN_REQUIRED');
});
test('synthetic test actions cannot target real IDs or run in live mode', async (t) => {
  const { service } = fixture(t);
  await assert.rejects(service.adminAction(ADMIN, 'test-payment', { torn_id: 4037017 }), (e) => e.code === 'INVALID_SYNTHETIC_PAYMENT');
  await assert.rejects(service.adminAction({ tornId: 123456, admin: false }, 'test-payment', {}), (e) => e.code === 'ADMIN_REQUIRED');
  const live = fixture(t, 'live').service;
  await assert.rejects(live.adminAction(ADMIN, 'test-payment', {}), (e) => e.code === 'TEST_ENDPOINT_DISABLED');
  await assert.rejects(live.adminAction(ADMIN, 'test-replay', { event_id: 'test_bad' }), (e) => e.code === 'TEST_ENDPOINT_DISABLED');
});
