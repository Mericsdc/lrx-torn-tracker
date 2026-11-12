// Desktop bridge: no billing database or receiver key is loaded by the app.
// The service URL is publisher/operator configuration, never a request parameter.
const crypto = require('node:crypto');
const { serviceUrl } = require('./premium-url');

function bridgeError(code, status = 503) { return Object.assign(new Error(code), { code, status }); }
function createPremiumClient(getKey, { env = process.env, defaultServiceUrl = '', fetchImpl = global.fetch, getRemembered = () => null, setRemembered = () => {} } = {}) {
  const configured = env.TORN_PREMIUM_SERVICE_URL ?? defaultServiceUrl;
  const test = env.TORN_PREMIUM_TEST_MODE === '1';
  let base = null, invalid = false, session = null, generation = 0;
  let reconnecting = null, retryAt = 0, connectionError = null;
  if (configured) {
    try {
      base = serviceUrl(configured, { allowLoopbackHttp: test });
    } catch { invalid = true; base = null; }
  }
  const fingerprint = () => crypto.createHash('sha256').update(getKey() || '').digest('hex');
  async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
    if (!base) throw bridgeError(invalid ? 'PREMIUM_SERVICE_URL_INVALID' : 'PREMIUM_SERVICE_NOT_CONFIGURED');
    let response;
    try {
      response = await fetchImpl(new URL(path.replace(/^\//, ''), base), { method, redirect: 'error', signal: AbortSignal.timeout(25_000),
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw bridgeError('PREMIUM_SERVICE_UNREACHABLE'); }
    const reader = response.body?.getReader();
    let text = '', size = 0;
    if (!reader) throw bridgeError('PREMIUM_SERVICE_RESPONSE');
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 2_000_000) { await reader.cancel(); throw bridgeError('PREMIUM_RESPONSE_LIMIT'); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    let data;
    try { data = JSON.parse(text); } catch { throw bridgeError('PREMIUM_SERVICE_RESPONSE'); }
    if (!response.ok) {
      if (response.status === 401 && token && session?.token === token) { session = null; generation++; retryAt = 0; }
      throw bridgeError(/^[A-Z0-9_]{1,80}$/.test(data.code || '') ? data.code : 'PREMIUM_SERVICE_ERROR', response.status);
    }
    return data;
  }
  function reset({ forget = true } = {}) {
    const previous = session; session = null; generation++;
    reconnecting = null; retryAt = 0; connectionError = null;
    if (forget) setRemembered(null);
    if (previous) request('/v1/auth/logout', { method: 'POST', body: {}, token: previous.token }).catch(() => {});
  }
  function current() {
    if (session && session.fingerprint !== fingerprint()) reset();
    if (!session) throw bridgeError('PREMIUM_CONNECT_REQUIRED', 401);
    return session;
  }
  const hasIdentity = () => test ? Number.isSafeInteger(Number(env.TORN_PREMIUM_TEST_TORN_ID)) && Number(env.TORN_PREMIUM_TEST_TORN_ID) > 0 : !!getKey();
  async function status({ skipReconnect = false } = {}) {
    if (!base) return { configured: false, connected: false, code: invalid ? 'PREMIUM_SERVICE_URL_INVALID' : 'PREMIUM_SERVICE_NOT_CONFIGURED', freeApiAccess: true };
    if (session && session.fingerprint !== fingerprint()) reset();
    if (!session && !skipReconnect && hasIdentity() && Date.now() >= retryAt) {
      try { return await connect(); }
      catch (error) { if (error.code === 'PREMIUM_IDENTITY_CHANGED') throw error; /* Free tools remain available during an outage. */ }
    }
    const stamp = generation;
    let data;
    try { data = await request(session ? '/v1/me' : '/v1/info', { token: session?.token }); }
    catch (error) {
      if (!skipReconnect && error.status === 401 && hasIdentity()) return status();
      throw error;
    }
    if (stamp !== generation) throw bridgeError('PREMIUM_IDENTITY_CHANGED', 409);
    if ((data.mode === 'test') !== test) throw bridgeError('PREMIUM_MODE_MISMATCH');
    return { ...data, configured: true, connected: !!session, connectionError: session ? null : connectionError, serviceOrigin: base.origin, serviceUrl: base.href.replace(/\/$/, '') };
  }
  function connect() {
    if (session && session.fingerprint !== fingerprint()) reset();
    if (session) return status({ skipReconnect: true });
    if (reconnecting) return reconnecting;
    const stamp = generation;
    const pending = authenticate().catch((error) => {
      if (stamp === generation) { retryAt = Date.now() + 60000; connectionError = error.code; }
      throw error;
    }).finally(() => { if (reconnecting === pending) reconnecting = null; });
    reconnecting = pending;
    return pending;
  }
  async function authenticate() {
    // App login connects membership automatically. Never trust a renderer-supplied Torn ID.
    // Legacy notice/remember fields are accepted but are no longer prerequisites.
    const stamp = generation, keyFingerprint = fingerprint();
    const info = await request('/v1/info');
    if ((info.mode === 'test') !== test) throw bridgeError('PREMIUM_MODE_MISMATCH');
    if (!test && !getKey()) throw bridgeError('API_KEY_REQUIRED', 412);
    const result = await request(test ? '/v1/auth/test' : '/v1/auth/torn', { method: 'POST',
      headers: test ? { 'X-Premium-Test-Token': env.TORN_PREMIUM_TEST_TOKEN || '' } : {},
      body: test ? { tornId: Number(env.TORN_PREMIUM_TEST_TORN_ID) } : { apiKey: getKey() } });
    if (stamp !== generation || keyFingerprint !== fingerprint()) {
      request('/v1/auth/logout', { method: 'POST', body: {}, token: result.token }).catch(() => {});
      throw bridgeError('PREMIUM_IDENTITY_CHANGED', 409);
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(result.token || '') || !Number.isSafeInteger(result.tornId) || (result.mode === 'test') !== test) throw bridgeError('PREMIUM_SERVICE_RESPONSE');
    session = { token: result.token, fingerprint: keyFingerprint };
    const binding = { origin: base.origin, baseUrl: base.href.replace(/\/$/, ''), test, fingerprint: keyFingerprint, testId: test ? Number(env.TORN_PREMIUM_TEST_TORN_ID) : null };
    if (JSON.stringify(getRemembered()) !== JSON.stringify(binding)) setRemembered(binding);
    retryAt = 0; connectionError = null;
    return status({ skipReconnect: true });
  }
  async function proxy(action, method, body) {
    const routes = {
      admin: ['GET', '/v1/admin'], settings: ['POST', '/v1/admin/settings'], subscription: ['POST', '/v1/admin/subscription'],
      review: ['POST', '/v1/admin/review'], check: ['POST', '/v1/admin/check'], rebaseline: ['POST', '/v1/admin/rebaseline'],
      'test-events': ['POST', '/v1/admin/test-events'], data: ['GET', '/v1/me/data'],
      members: ['POST', '/v1/admin/members'], 'test-payment': ['POST', '/v1/admin/test-payment'], 'test-replay': ['POST', '/v1/admin/test-replay'],
      'erasure-request': ['POST', '/v1/me/erasure-request'], receipts: ['GET', '/v1/premium/receipt-export'],
      'access-check': ['GET', '/v1/premium/access-check'],
      'feature-access': ['GET', '/v1/features'], 'feature-workspace': ['POST', '/v1/features/workspace'],
      'feature-save': ['POST', '/v1/features/save'], 'feature-select': ['POST', '/v1/features/select'],
      'feature-remove': ['POST', '/v1/features/remove'], 'feature-run': ['POST', '/v1/features/run'],
      'feature-consent': ['POST', '/v1/features/consent'], 'feature-permission': ['POST', '/v1/admin/feature-permission'],
    };
    const route = routes[action];
    if (!route || route[0] !== method) throw bridgeError('NOT_FOUND', 404);
    if (!session || session.fingerprint !== fingerprint()) await status();
    const stamp = generation;
    const data = await request(route[1], { method, body: method === 'POST' ? body : undefined, token: current().token });
    if (stamp !== generation) throw bridgeError('PREMIUM_IDENTITY_CHANGED', 409);
    return data;
  }
  return { status, connect, proxy, reset };
}
module.exports = { createPremiumClient };
