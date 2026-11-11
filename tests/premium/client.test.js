const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPremiumClient } = require('../../premium-client');
const token = 'a'.repeat(43);
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('desktop refuses arbitrary insecure destinations and does not transmit keys without the visible connection notice', async () => {
  let calls = 0;
  const disabled = createPremiumClient(() => 'AbCdEfGh12345678', { env: {}, fetchImpl: async () => { calls++; } });
  assert.equal((await disabled.status()).configured, false);
  const bad = createPremiumClient(() => 'AbCdEfGh12345678', { env: { TORN_PREMIUM_SERVICE_URL: 'http://evil.example' } });
  assert.equal((await bad.status()).code, 'PREMIUM_SERVICE_URL_INVALID');
  for (const suffix of ['/a/../b', '/a%2fb', '//b', '/a?key=x', '/a#x']) {
    const invalidPath = createPremiumClient(() => '', { env: { TORN_PREMIUM_SERVICE_URL: 'https://lrxe8.com' + suffix } });
    assert.equal((await invalidPath.status()).code, 'PREMIUM_SERVICE_URL_INVALID');
  }
  const bridge = createPremiumClient(() => 'AbCdEfGh12345678', { env: { TORN_PREMIUM_SERVICE_URL: 'https://premium.example' }, fetchImpl: async () => { calls++; return reply({ mode: 'live' }); } });
  await assert.rejects(bridge.connect({ consent: false }), (e) => e.code === 'PREMIUM_NOTICE_REQUIRED');
  await bridge.status(); assert.equal(calls, 1);
  await assert.rejects(bridge.proxy('https://evil.example', 'GET'), (e) => e.code === 'NOT_FOUND');
});

test('test bridge never sends saved Torn keys; session secrets stay out of renderer status', async () => {
  const bodies = [];
  const bridge = createPremiumClient(() => 'AbCdEfGh12345678', { env: { TORN_PREMIUM_SERVICE_URL: 'http://127.0.0.1:3740', TORN_PREMIUM_TEST_MODE: '1', TORN_PREMIUM_TEST_TOKEN: 'x'.repeat(40), TORN_PREMIUM_TEST_TORN_ID: '123456' }, fetchImpl: async (url, options) => {
    bodies.push(options.body || '');
    if (url.pathname === '/v1/auth/test') return reply({ mode: 'test', token, tornId: 123456 });
    return reply({ mode: 'test', account: { tornId: 123456, admin: false } });
  } });
  const status = await bridge.connect({ noticeVersion: 1 });
  assert.equal(status.connected, true); assert.equal(JSON.stringify(status).includes(token), false);
  assert.equal(bodies.join().includes('AbCdEfGh12345678'), false); assert.ok(bodies.includes('{"tornId":123456}'));
});

test('a delayed login cannot attach an old identity after the desktop key changes', async () => {
  let key = 'AbCdEfGh12345678', release, loginStarted;
  const started = new Promise((r) => { loginStarted = r; });
  const bridge = createPremiumClient(() => key, { env: { TORN_PREMIUM_SERVICE_URL: 'https://premium.example' }, fetchImpl: async (url) => {
    if (url.pathname === '/v1/auth/torn') { loginStarted(); await new Promise((r) => { release = r; }); return reply({ mode: 'live', token, tornId: 123456 }); }
    return reply({ mode: 'live' });
  } });
  const connecting = bridge.connect({ consent: true }); await started;
  key = 'QrStUvWx12345678'; bridge.reset(); release();
  await assert.rejects(connecting, (e) => e.code === 'PREMIUM_IDENTITY_CHANGED');
  assert.equal((await bridge.status()).connected, false);
});

test('remembered connection re-verifies identity after restart, coalesces requests, and forgets on disconnect', async () => {
  let remembered = null, key = 'AbCdEfGh12345678', logins = 0;
  const options = { env: { TORN_PREMIUM_SERVICE_URL: 'https://premium.example' }, getRemembered: () => remembered, setRemembered: (value) => { remembered = value; }, fetchImpl: async (url) => {
    if (url.pathname === '/v1/auth/torn') { logins++; return reply({ mode: 'live', token, tornId: 123456 }); }
    return reply({ mode: 'live', account: { tornId: 123456 } });
  } };
  let bridge = createPremiumClient(() => key, options);
  assert.equal((await bridge.status()).connected, false); assert.equal(logins, 0);
  await bridge.connect({ consent: true, remember: true });
  assert.equal(JSON.stringify(remembered).includes(key), false); assert.equal(JSON.stringify(remembered).includes(token), false);
  bridge = createPremiumClient(() => key, options);
  const statuses = await Promise.all([bridge.status(), bridge.status(), bridge.status()]);
  assert.ok(statuses.every((s) => s.connected)); assert.equal(logins, 2, 'one fresh verification for the restarted bridge');
  bridge.reset(); assert.equal(remembered, null); assert.equal((await bridge.status()).connected, false);
  await bridge.connect({ consent: true, remember: true }); key = 'QrStUvWx12345678';
  bridge = createPremiumClient(() => key, options);
  assert.equal((await bridge.status()).connected, false); assert.equal(remembered, null);
});

test('remember permission is bound to the configured service and never trusts a saved entitlement', async () => {
  let remembered = null, calls = 0;
  const options = { env: { TORN_PREMIUM_SERVICE_URL: 'https://premium.example' }, getRemembered: () => remembered, setRemembered: (v) => { remembered = v; }, fetchImpl: async (url) => {
    if (url.pathname === '/v1/auth/torn') { calls++; return reply({ mode: 'live', token, tornId: 123456 }); }
    return reply({ mode: 'live' });
  } };
  const first = createPremiumClient(() => 'AbCdEfGh12345678', options); await first.connect({ consent: true, remember: true });
  const changed = createPremiumClient(() => 'AbCdEfGh12345678', { ...options, env: { TORN_PREMIUM_SERVICE_URL: 'https://another.example' } });
  assert.equal((await changed.status()).connected, false); assert.equal(calls, 1); assert.equal(remembered, null);
});

test('HTTPS service paths preserve all routes and scope remembered consent to that path', async () => {
  const paths = []; let remembered = null, logins = 0;
  const options = { env: {}, defaultServiceUrl: 'https://lrxe8.com/torn-premium', getRemembered: () => remembered, setRemembered: (v) => { remembered = v; }, fetchImpl: async (url) => {
    assert.equal(url.origin, 'https://lrxe8.com'); paths.push(url.pathname);
    if (url.pathname.endsWith('/v1/auth/torn')) { logins++; return reply({ mode: 'live', token, tornId: 123456 }); }
    return reply({ mode: 'live' });
  } };
  const bridge = createPremiumClient(() => 'AbCdEfGh12345678', options);
  assert.equal((await bridge.connect({ consent: true, remember: true })).serviceUrl, 'https://lrxe8.com/torn-premium');
  await bridge.proxy('feature-access', 'GET');
  assert.deepEqual(paths, ['/torn-premium/v1/info', '/torn-premium/v1/auth/torn', '/torn-premium/v1/me', '/torn-premium/v1/features']);
  const moved = createPremiumClient(() => 'AbCdEfGh12345678', { ...options, env: { TORN_PREMIUM_SERVICE_URL: 'https://lrxe8.com/another-service' } });
  assert.equal((await moved.status()).connected, false); assert.equal(remembered, null); assert.equal(logins, 1);
  const disabled = createPremiumClient(() => 'AbCdEfGh12345678', { ...options, env: { TORN_PREMIUM_SERVICE_URL: '' } });
  assert.equal((await disabled.status()).configured, false);
});
