const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPremiumClient } = require('../../src/server/premium-client');
const token = 'a'.repeat(43), key = 'AbCdEfGh12345678';
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
function fixture(extra = {}) {
  const calls = [];
  const options = { env: {}, defaultServiceUrl: 'https://premium.example', fetchImpl: async (url, init) => {
    calls.push({ path: url.pathname, body: init.body, token: init.headers.Authorization });
    if (url.pathname.endsWith('/v1/auth/torn')) return reply({ mode: 'live', token, tornId: 123456 });
    return reply({ mode: 'live', account: url.pathname.endsWith('/v1/me') ? { tornId: 123456 } : undefined });
  }, ...extra };
  return { options, calls };
}
test('automatic connection only sends keys to a configured secure service after checking its mode', async () => {
  let calls = 0;
  const disabled = createPremiumClient(() => key, { env: {}, fetchImpl: async () => { calls++; } });
  assert.equal((await disabled.status()).configured, false);
  for (const url of ['http://evil.example', ...['/a/../b', '/a%2fb', '//b', '/a?key=x', '/a#x'].map(s => 'https://lrxe8.com' + s)]) {
    assert.equal((await createPremiumClient(() => key, { env: { TORN_PREMIUM_SERVICE_URL: url } }).status()).code, 'PREMIUM_SERVICE_URL_INVALID');
  }
  const mismatch = createPremiumClient(() => key, { env: {}, defaultServiceUrl: 'https://premium.example', fetchImpl: async () => { calls++; return reply({ mode: 'test' }); } });
  await assert.rejects(mismatch.status(), e => e.code === 'PREMIUM_MODE_MISMATCH');
  assert.equal(calls, 2, 'only public info, never auth or a key, is sent on a mode mismatch');
  await assert.rejects(disabled.proxy('https://evil.example', 'GET'), e => e.code === 'NOT_FOUND');
});
test('first app status automatically connects with no consent, remember flag or previous binding', async () => {
  let remembered = null;
  const { options, calls } = fixture({ getRemembered: () => remembered, setRemembered: v => { remembered = v; } });
  const bridge = createPremiumClient(() => key, options);
  const values = await Promise.all([bridge.status(), bridge.status(), bridge.status()]);
  assert.ok(values.every(v => v.connected && v.account.tornId === 123456));
  assert.equal(calls.filter(c => c.path.endsWith('/auth/torn')).length, 1);
  assert.ok(!JSON.stringify(values).includes(token));
  assert.ok(!JSON.stringify(remembered).includes(key)); assert.ok(!JSON.stringify(remembered).includes(token));
  assert.equal(remembered.baseUrl, 'https://premium.example');
  assert.equal((await createPremiumClient(() => key, options).status()).connected, true);
  assert.equal(calls.filter(c => c.path.endsWith('/auth/torn')).length, 2, 'a restart obtains a fresh server session');
});
test('test mode connects automatically without transmitting a Torn key', async () => {
  const bodies = [];
  const bridge = createPremiumClient(() => key, { env: { TORN_PREMIUM_SERVICE_URL: 'http://127.0.0.1:3740', TORN_PREMIUM_TEST_MODE: '1', TORN_PREMIUM_TEST_TOKEN: 'x'.repeat(40), TORN_PREMIUM_TEST_TORN_ID: '123456' }, fetchImpl: async (url, init) => {
    bodies.push(init.body || '');
    return reply(url.pathname === '/v1/auth/test' ? { mode: 'test', token, tornId: 123456 } : { mode: 'test' });
  } });
  assert.equal((await bridge.status()).connected, true);
  assert.ok(bodies.includes('{"tornId":123456}')); assert.ok(!bodies.join().includes(key));
});
test('no saved identity means no automatic auth; adding a key starts automatic membership', async () => {
  let currentKey = ''; const { options, calls } = fixture();
  const bridge = createPremiumClient(() => currentKey, options);
  assert.equal((await bridge.status()).connected, false); assert.equal(calls.length, 1);
  currentKey = key; bridge.reset(); assert.equal((await bridge.status()).connected, true);
  currentKey = ''; bridge.reset(); assert.equal((await bridge.status()).connected, false);
  assert.equal(calls.filter(c => c.path.endsWith('/auth/torn')).length, 1);
});
test('a delayed login cannot attach the previous identity after logout or a key change', async () => {
  let currentKey = key, release, started;
  const entered = new Promise(r => { started = r; });
  const { options } = fixture({ fetchImpl: async url => {
    if (url.pathname === '/v1/auth/torn') { started(); await new Promise(r => { release = r; }); return reply({ mode: 'live', token, tornId: 123456 }); }
    return reply({ mode: 'live' });
  } });
  const bridge = createPremiumClient(() => currentKey, options), pending = bridge.status(); await entered;
  currentKey = ''; bridge.reset(); release();
  await assert.rejects(pending, e => e.code === 'PREMIUM_IDENTITY_CHANGED');
  assert.equal((await bridge.status()).connected, false);
});
test('an expired server session refreshes automatically without another connection screen', async () => {
  let logins = 0, expired = false;
  const { options } = fixture({ fetchImpl: async url => {
    if (url.pathname === '/v1/auth/torn') { logins++; expired = false; return reply({ mode: 'live', token, tornId: 123456 }); }
    if (url.pathname === '/v1/me' && expired) return reply({ code: 'SESSION_EXPIRED' }, 401);
    return reply({ mode: 'live' });
  } });
  const bridge = createPremiumClient(() => key, options); await bridge.status(); expired = true;
  assert.equal((await bridge.status()).connected, true); assert.equal(logins, 2);
});
test('a session that expired while the app stayed open is renewed inside the request, exactly once', async () => {
  let logins = 0, alwaysExpired = false; const feature = [];
  const { options } = fixture({ fetchImpl: async (url, init) => {
    if (url.pathname === '/v1/auth/torn') { logins++; return reply({ mode: 'live', token: String(logins).repeat(43), tornId: 123456 }); }
    if (url.pathname === '/v1/features/save') {
      feature.push(init.headers.Authorization);
      return alwaysExpired || init.headers.Authorization === 'Bearer ' + '1'.repeat(43) ? reply({ code: 'SESSION_EXPIRED' }, 401) : reply({ saved: JSON.parse(init.body).name });
    }
    return reply({ mode: 'live' });
  } });
  const bridge = createPremiumClient(() => key, options);
  assert.equal((await bridge.status()).connected, true);
  // The first token is now rejected by the service: the same request succeeds after one silent sign-in.
  assert.deepEqual(await bridge.proxy('feature-save', 'POST', { name: 'Plan' }), { saved: 'Plan' });
  assert.equal(logins, 2); assert.deepEqual(feature, ['Bearer ' + '1'.repeat(43), 'Bearer ' + '2'.repeat(43)]);
  // A service that keeps answering 401 is asked twice, never in a loop.
  alwaysExpired = true; feature.length = 0;
  await assert.rejects(bridge.proxy('feature-save', 'POST', { name: 'Plan' }), e => e.code === 'SESSION_EXPIRED' && e.status === 401);
  assert.equal(feature.length, 2); assert.equal(logins, 3);
});
test('a reply that is not a JSON object is a service error, not a crash', async () => {
  for (const body of ['null', '"text"', '[1]']) {
    const bridge = createPremiumClient(() => key, { env: {}, defaultServiceUrl: 'https://premium.example', fetchImpl: async () => new Response(body) });
    await assert.rejects(bridge.status(), e => e.code === 'PREMIUM_SERVICE_RESPONSE', body);
    await assert.rejects(createPremiumClient(() => key, { env: {}, defaultServiceUrl: 'https://premium.example', fetchImpl: async () => new Response(body, { status: 500 }) }).status(), e => e.code === 'PREMIUM_SERVICE_RESPONSE', body);
  }
});
test('failed automatic login backs off and recovers while free status stays available', async t => {
  let now = Date.now(), logins = 0, down = true; t.mock.method(Date, 'now', () => now);
  const { options } = fixture({ fetchImpl: async url => {
    if (url.pathname === '/v1/auth/torn') { logins++; return down ? reply({ code: 'TORN_UNAVAILABLE' }, 503) : reply({ mode: 'live', token, tornId: 123456 }); }
    return reply({ mode: 'live', freeApiAccess: true });
  } });
  const bridge = createPremiumClient(() => key, options);
  assert.equal((await bridge.status()).connectionError, 'TORN_UNAVAILABLE');
  assert.equal((await bridge.status()).freeApiAccess, true); assert.equal(logins, 1);
  down = false; now += 60001;
  assert.equal((await bridge.status()).connected, true); assert.equal(logins, 2);
});
test('legacy connection calls stay compatible; proxy auto-connects and preserves HTTPS paths', async () => {
  const { options, calls } = fixture({ defaultServiceUrl: 'https://lrxe8.com/torn-premium', getRemembered: () => ({ fingerprint: 'old', origin: 'https://other.example', premium: true }) });
  const bridge = createPremiumClient(() => key, options); await bridge.proxy('feature-access', 'GET');
  assert.deepEqual(calls.map(c => c.path), ['/torn-premium/v1/info', '/torn-premium/v1/auth/torn', '/torn-premium/v1/me', '/torn-premium/v1/features']);
  assert.equal((await bridge.connect({ consent: false, remember: false })).connected, true);
  assert.equal(calls.filter(c => c.path.endsWith('/auth/torn')).length, 1);
});
