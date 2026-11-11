const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createHttpServer } = require('../../premium/server');
const { readConfig } = require('../../premium/config');
const { DAY } = require('../../premium/store');

async function fixture(t, live = false, publicUrl = 'https://premium.example.invalid') {
  const secret = crypto.randomBytes(32).toString('hex'), clock = { now: 1794331965 };
  const config = readConfig({ PREMIUM_MODE: live ? 'live' : 'test', PREMIUM_DB_PATH: ':memory:', PREMIUM_TEST_AUTH_TOKEN: secret,
    PREMIUM_CONTROLLER_NAME: 'Fixture operator', PREMIUM_PRIVACY_CONTACT: 'fixture@example.invalid', PREMIUM_PUBLIC_URL: publicUrl, PREMIUM_RECORD_RETENTION_POLICY: 'Fixture only; deleted after tests' });
  let upstreamCalls = 0;
  const { server, service } = createHttpServer(config, { now: () => clock.now, fetchImpl: async (url, options) => {
    upstreamCalls++;
    assert.equal(new URL(url).origin, 'https://api.torn.com');
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ info: { user: { id: 123456 }, selections: { user: ['events'] } } }));
  } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise((r) => server.close(r)); await service.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (path, body, token, headers = {}) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const login = async (id) => { const result = await call('/v1/auth/test', { tornId: id }, null, { 'X-Premium-Test-Token': secret }); assert.equal(result.status, 200); return result.data.token; };
  return { service, config, clock, call, login, base, upstreamCalls: () => upstreamCalls };
}

test('public landing serves static files safely while API routes keep authentication', async (t) => {
  const { base, upstreamCalls } = await fixture(t, true, 'https://lrxe8.com/torn-premium');
  const page = await fetch(base + '/torn-premium');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await page.text(), /One click/);
  const head = await fetch(base + '/torn-premium', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  for (const [asset, type] of [['styles/site.css', 'text/css'], ['site.js', 'text/javascript'], ['assets/overview.png', 'image/png'], ['assets/mona-sans.woff2', 'font/woff2']]) {
    const response = await fetch(base + '/torn-premium/site/' + asset);
    assert.equal(response.status, 200, asset); assert.ok(response.headers.get('content-type').startsWith(type));
    await response.arrayBuffer();
  }
  for (const asset of ['.openai/hosting.json', '../package.json', 'assets/missing.png', 'build.mjs', 'assets/%2e%2e%2fpackage.json']) {
    const response = await fetch(base + '/torn-premium/site/' + asset);
    assert.ok([401,404].includes(response.status), asset); await response.text();
  }
  const download = await fetch(base + '/torn-premium/download/windows', {redirect:'manual'});
  assert.equal(download.status, 302);
  assert.equal(download.headers.get('location'), 'https://github.com/Mericsdc/lrx-torn-tracker/releases/latest/download/LRX-Torn-Tracker-Windows-x64.zip');
  assert.equal((await fetch(base + '/torn-premium/v1/admin')).status, 401);
  assert.equal((await fetch(base + '/torn-premium/v1/me')).status, 401);
  assert.equal(upstreamCalls(), 0);
});

test('public website prefix serves health, disclosure and authenticated routes without synthetic login', async (t) => {
  const { call, upstreamCalls } = await fixture(t, true, 'https://lrxe8.com/torn-premium/');
  assert.equal((await call('/torn-premium/health')).data.ok, true);
  const info = await call('/torn-premium/v1/info');
  assert.equal(info.status, 200); assert.equal(info.data.livePayments, false);
  assert.equal(info.data.privacy.termsUrl, 'https://lrxe8.com/torn-premium/terms');
  assert.equal((await call('/torn-premium/terms')).status, 200);
  assert.equal((await call('/torn-premium/v1/auth/test', { tornId: 4037017 }, null, { 'X-Premium-Test-Token': 'x'.repeat(40) })).status, 403);
  const auth = await call('/torn-premium/v1/auth/torn', { apiKey: 'AbCdEfGh12345678' });
  assert.equal(auth.status, 200);
  assert.equal((await call('/torn-premium/v1/me', undefined, auth.data.token)).data.account.tornId, 123456);
  assert.equal((await call('/torn-premium/v1/admin', undefined, auth.data.token)).status, 403);
  assert.equal((await call('/torn-premium-x/v1/info')).status, 401);
  assert.equal(upstreamCalls(), 1);
});

test('HTTP enforces sessions, owner isolation, administrator roles and origins', async (t) => {
  const { call, login, upstreamCalls } = await fixture(t);
  assert.equal((await call('/v1/me')).status, 401);
  const user = await login(123456), admin = await login(4037017);
  assert.equal((await call('/v1/admin', undefined, user)).status, 403);
  assert.equal((await call('/v1/admin/subscription', { torn_id: 123456, days: 999, admin: true, reason: 'Spoof administrator flag' }, user)).status, 403);
  const own = await call('/v1/me', undefined, user);
  assert.equal(own.data.account.tornId, 123456); assert.equal(own.data.account.admin, false);
  assert.equal((await call('/v1/me?tornId=4037017', undefined, user)).status, 400);
  assert.equal((await call('/v1/admin', undefined, admin)).status, 200);
  assert.equal((await call('/v1/admin/check', {}, admin, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/v1/auth/test', { tornId: 4037017 })).status, 403);
  assert.equal(upstreamCalls(), 0, 'test mode never contacts Torn');
});

test('synthetic HTTP payment activates automatically; expiry leaves free API and data exports available', async (t) => {
  const { call, login, clock, upstreamCalls } = await fixture(t);
  const admin = await login(4037017), user = await login(123456);
  assert.equal((await call('/v1/admin/settings', { revision: 1, enabled: true, reason: 'Enable synthetic polling' }, admin)).status, 200);
  const payment = { id: 'http_payment', timestamp: clock.now, event: 'You were sent 2x Xanax from <a href="profiles.php?XID=123456">Player</a>' };
  await call('/v1/admin/test-events', { events: [payment] }, admin);
  const checked = await call('/v1/admin/check', {}, admin); assert.equal(checked.data.applied, 1);
  let own = (await call('/v1/me', undefined, user)).data;
  assert.equal(own.subscription.remainingDays, 30); assert.equal(own.transactions.length, 1);
  assert.equal((await call('/v1/premium/access-check', undefined, user)).status, 200);
  await call('/v1/admin/test-events', { events: [payment] }, admin);
  await call('/v1/admin/check', {}, admin);
  assert.equal((await call('/v1/me', undefined, user)).data.subscription.remainingDays, 30);
  clock.now += 31 * DAY;
  const renewed = await login(123456);
  own = (await call('/v1/me', undefined, renewed)).data;
  assert.equal(own.subscription.active, false); assert.equal(own.freeApiAccess, true);
  assert.equal((await call('/v1/premium/access-check', undefined, renewed)).status, 403);
  const exported = await call('/v1/me/data', undefined, renewed);
  assert.equal(exported.status, 200); assert.equal(exported.data.transactions.length, 1);
  assert.equal(JSON.stringify(exported.data).includes('token_hash'), false);
  assert.equal((await call('/v1/premium/receipt-export', undefined, renewed)).status, 200);
  assert.equal((await call('/v1/me/erasure-request', {}, renewed)).data.status, 'pending');
  assert.equal(upstreamCalls(), 0);
});

test('live identity is derived from Torn key ownership, never the submitted ID or role', async (t) => {
  const { call, upstreamCalls } = await fixture(t, true);
  const login = await call('/v1/auth/torn', { apiKey: 'AbCdEfGh12345678', tornId: 4037017, admin: true });
  assert.equal(login.status, 200); assert.equal(login.data.tornId, 123456); assert.equal(login.data.admin, false);
  const status = await call('/v1/me', undefined, login.data.token);
  assert.equal(status.data.livePayments, false); assert.equal(status.data.freeApiAccess, true);
  assert.equal(JSON.stringify(status.data).includes('AbCdEfGh12345678'), false);
  assert.equal((await call('/v1/auth/test', { tornId: 4037017 })).status, 403);
  assert.equal((await call('/v1/admin/test-events', { events: [] }, login.data.token)).status, 403);
  assert.equal(upstreamCalls(), 1);
});

test('logout and elapsed sessions revoke access; privacy configuration is required for live identity', async (t) => {
  const { call, login, clock } = await fixture(t);
  let user = await login(123456);
  assert.equal((await call('/v1/auth/logout', {}, user)).status, 200);
  assert.equal((await call('/v1/me', undefined, user)).status, 401);
  user = await login(123456); clock.now += 86400;
  assert.equal((await call('/v1/me', undefined, user)).status, 401);
  const live = await fixture(t, true); live.config.recordRetentionPolicy = '';
  assert.equal((await live.call('/v1/auth/torn', { apiKey: 'AbCdEfGh12345678' })).data.code, 'PRIVACY_NOTICE_NOT_CONFIGURED');
  assert.equal(live.upstreamCalls(), 0);
});
