// Regression tests for the 2026-11-12 review of the public Premium service.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHttpServer } = require('../../premium/server');
const { readConfig } = require('../../premium/config');
const { parseItemLog } = require('../../premium/payment-logs');

const liveEnv = { PREMIUM_MODE: 'live', PREMIUM_DB_PATH: ':memory:', PREMIUM_CONTROLLER_NAME: 'Fixture operator', PREMIUM_PRIVACY_CONTACT: 'fixture@example.invalid',
  PREMIUM_PUBLIC_URL: 'https://premium.example.invalid', PREMIUM_RECORD_RETENTION_POLICY: 'Fixture only' };

async function liveServer(t, fetchImpl, env = {}) {
  const { server, service } = createHttpServer(readConfig({ ...liveEnv, ...env }), { fetchImpl });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise((r) => server.close(r)); await service.close(); });
  return { service, base: 'http://127.0.0.1:' + server.address().port };
}
const post = (base, path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

test('login rate limit is per real client behind the local tunnel, not one shared bucket', async (t) => {
  let n = 0;
  const { base } = await liveServer(t, async () => { n++; return new Response(JSON.stringify({ info: { user: { id: 100 + n }, selections: { user: [] } } })); });
  // One client exhausts its own bucket with junk login requests
  for (let i = 0; i < 10; i++) assert.equal((await post(base, '/v1/auth/torn', '{', { 'CF-Connecting-IP': '203.0.113.9' })).status, 400);
  assert.equal((await post(base, '/v1/auth/torn', '{', { 'CF-Connecting-IP': '203.0.113.9' })).status, 429);
  // A different visitor still gets in
  const other = await post(base, '/v1/auth/torn', JSON.stringify({ apiKey: 'AbCdEfGh12345678' }), { 'CF-Connecting-IP': '198.51.100.7' });
  assert.equal(other.status, 200);
});

test('with proxy trust disabled every loopback request shares the socket address', async (t) => {
  const { base } = await liveServer(t, async () => new Response('{}'), { PREMIUM_TRUST_PROXY: '0' });
  for (let i = 0; i < 10; i++) await post(base, '/v1/auth/torn', '{', { 'CF-Connecting-IP': '203.0.113.' + i });
  assert.equal((await post(base, '/v1/auth/torn', '{', { 'CF-Connecting-IP': '198.51.100.7' })).status, 429);
});

test('synthetic test login is refused in live mode before it counts against anyone', async (t) => {
  const { base } = await liveServer(t, async () => new Response('{}'));
  for (let i = 0; i < 12; i++) assert.equal((await post(base, '/v1/auth/test', '{}', { 'CF-Connecting-IP': '203.0.113.9' })).status, 403);
  assert.equal((await post(base, '/v1/auth/torn', '{', { 'CF-Connecting-IP': '203.0.113.9' })).status, 400);
});

test('a malformed receipt without Xanax is skipped instead of blocking every credit', () => {
  const base = { id: 'abc', timestamp: 1794331965, details: { id: 4103 } };
  assert.equal(parseItemLog({ ...base, data: { items: [{ id: 180, qty: 1.5 }] } }, 1794331999), null);
  assert.equal(parseItemLog({ ...base, data: { items: [{ id: 180, qty: 2 }] } }, 1794331999), null);
  assert.throws(() => parseItemLog({ ...base, data: { items: [{ id: 206, qty: 1 }] } }, 1794331999), /ITEM_LOG_SCHEMA/); // Xanax without sender stays strict
  assert.equal(parseItemLog({ ...base, data: { sender: 7, items: [{ id: 206, qty: 2 }] } }, 1794331999).quantity, 2);
});

test('an ID error (Torn code 7) or an HTTP error page does not block the receiver key', async (t) => {
  const { createTornClient, TornError } = require('../../premium/torn-client');
  const { service } = await liveServer(t, async () => new Response('{}'));
  const store = service.store;
  const key = 'AbCdEfGh12345678';
  let reply = () => new Response(JSON.stringify({ error: { code: 7, error: 'Incorrect ID-entity relation' } }));
  const client = createTornClient(store, { fetchImpl: async () => reply() });
  await assert.rejects(client.profile(key, 4242), (e) => e instanceof TornError && e.code === 'TORN_7' && e.retryable === true);
  reply = () => new Response('<html>blocked</html>', { status: 403 });
  await assert.rejects(client.timestamp(key), (e) => e.code === 'UPSTREAM_HTTP_403' && e.retryable === true);
  reply = () => new Response(JSON.stringify({ timestamp: 1794331965 }));
  assert.equal(await client.timestamp(key), 1794331965); // not TORN_KEY_BLOCKED
});
