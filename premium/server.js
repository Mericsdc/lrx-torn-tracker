const http = require('node:http');
const { readConfig } = require('./config');
const { createPremiumService } = require('./service');
const { fail } = require('./store');
const { serveSite } = require('./site');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let length = 0, failed = false;
    const chunks = [];
    req.on('data', (chunk) => {
      length += chunk.length;
      if (length > 100_000) { failed = true; reject(Object.assign(new Error('BODY_LIMIT'), { status: 413, code: 'BODY_LIMIT' })); }
      else if (!failed) chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); resolve(value); }
      catch { reject(Object.assign(new Error('INVALID_JSON'), { status: 400, code: 'INVALID_JSON' })); }
    });
    req.on('error', () => reject(Object.assign(new Error('REQUEST_ABORTED'), { status: 400, code: 'REQUEST_ABORTED' })));
  });
}
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function clientAddress(req, config) {
  const socket = req.socket.remoteAddress || '';
  const forwarded = String(req.headers['cf-connecting-ip'] || '').trim();
  if (config.trustProxy && LOOPBACK.has(socket) && /^[0-9a-fA-F:.]{2,45}$/.test(forwarded)) return forwarded;
  return socket;
}
function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
  res.end(JSON.stringify(value));
}
function createHttpServer(config, dependencies = {}) {
  const service = createPremiumService(config, dependencies);
  const attempts = new Map(); const globalAttempts = { until: 0, count: 0 };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.length > 2048) fail('REQUEST_URL_LIMIT', 414);
      const url = new URL(req.url, 'http://premium.local');
      if (url.search) fail('QUERY_NOT_ALLOWED');
      const prefix = config.publicUrl ? new URL(config.publicUrl).pathname.replace(/\/$/, '') : '';
      if (prefix && url.pathname === prefix) url.pathname = '/';
      else if (prefix && url.pathname.startsWith(prefix + '/')) url.pathname = url.pathname.slice(prefix.length);
      if (req.headers.origin) {
        const expected = config.publicUrl ? new URL(config.publicUrl).origin : 'http://' + req.headers.host;
        if (req.headers.origin !== expected) fail('ORIGIN_DENIED', 403);
      }
      if (req.method === 'POST' && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) fail('JSON_REQUIRED', 415);
      if (serveSite(req, res, url.pathname)) return;
      if (url.pathname === '/health' && req.method === 'GET') return send(res, 200, { ok: true, mode: config.mode });
      if (url.pathname === '/v1/info' && req.method === 'GET') return send(res, 200, service.info());
      if (url.pathname === '/terms' && req.method === 'GET') return send(res, 200, {
        service: 'LRX Torn Tracker application premium', ...service.info().privacy,
        freeAccess: 'Access to Torn API data and existing features remains free. Remuneration concerns additional application-produced insights, when such benefits are offered.',
        data: ['Verified Torn ID', 'Xanax transfer ID, sender, quantity and timestamp', 'Subscription period and administrator audit records', 'Opt-in analysis profiles and selected observations (at most 1000 per module, up to two years)'],
        keyUsage: 'A submitted login key is sent only to Torn to verify its owner and is not stored. The receiver key is an operator-managed server secret.',
        rights: 'Authenticated users can export their account data and request an erasure assessment. Payment disputes and duplicate-prevention retention must be assessed before erasing records.',
      });
      if (['/v1/auth/torn', '/v1/auth/test'].includes(url.pathname) && req.method === 'POST') {
        if (url.pathname.endsWith('/test') && config.mode === 'live') fail('TEST_LOGIN_DISABLED', 403);
        const remote = clientAddress(req, config);
        // Global ceiling so many distinct addresses cannot flood Torn verification
        if (!globalAttempts.until || globalAttempts.until <= service.store.now()) { globalAttempts.until = service.store.now() + 60; globalAttempts.count = 0; }
        if (++globalAttempts.count > 300) fail('AUTH_RATE_LIMIT', 429);
        const bucket = attempts.get(remote);
        if (!bucket && attempts.size >= 1000) {
          for (const [key, entry] of attempts) if (entry.until <= service.store.now()) attempts.delete(key);
          if (attempts.size >= 1000) fail('AUTH_RATE_LIMIT', 429);
        }
        if (bucket && bucket.until > service.store.now() && bucket.count >= 10) fail('AUTH_RATE_LIMIT', 429);
        if (!bucket || bucket.until <= service.store.now()) attempts.set(remote, { until: service.store.now() + 60, count: 1 });
        else bucket.count++;
        const body = await readBody(req);
        if (url.pathname.endsWith('/test')) return send(res, 200, service.auth.loginTest(req.headers['x-premium-test-token'], body.tornId));
        return send(res, 200, await service.auth.login(body.apiKey));
      }
      const actor = service.auth.authenticate(req.headers.authorization);
      if (url.pathname === '/v1/auth/logout' && req.method === 'POST') { service.auth.logout(req.headers.authorization); return send(res, 200, { ok: true }); }
      if (url.pathname === '/v1/me' && req.method === 'GET') return send(res, 200, service.me(actor));
      if (url.pathname === '/v1/me/data' && req.method === 'GET') return send(res, 200, { ...service.store.exportData(actor.tornId), advancedFeatures: service.features.exportData(actor) });
      if (url.pathname === '/v1/features' && req.method === 'GET') return send(res, 200, { access: service.features.access(actor) });
      if (url.pathname.startsWith('/v1/features/') && req.method === 'POST') {
        const action = url.pathname.slice('/v1/features/'.length), body = await readBody(req);
        if (action === 'workspace') return send(res, 200, service.features.workspace(actor, body.featureId));
        if (['save', 'select', 'remove', 'run', 'consent'].includes(action)) return send(res, 200, service.features[action](actor, body));
        fail('NOT_FOUND', 404);
      }
      if (url.pathname === '/v1/me/erasure-request' && req.method === 'POST') return send(res, 200, service.store.requestErasure(actor));
      if (url.pathname === '/v1/premium/receipt-export' && req.method === 'GET') return send(res, 200, service.exportReceipts(actor));
      if (url.pathname === '/v1/premium/access-check' && req.method === 'GET') { service.requirePremium(actor); return send(res, 200, { entitled: true }); }
      if (url.pathname.startsWith('/v1/admin')) {
        service.store.assertAdmin(actor);
        if (url.pathname === '/v1/admin' && req.method === 'GET') { service.store.audit(actor, 'admin.read', 'premium', 'Administrator viewed billing records', null, null); return send(res, 200, { ...service.info(), ...service.store.adminData(), featureOverrides: service.store.db.prepare('SELECT torn_id,feature_id,allowed,updated_at FROM premium_feature_overrides ORDER BY updated_at DESC LIMIT 100').all() }); }
        if (req.method === 'POST') return send(res, 200, await service.adminAction(actor, url.pathname.slice('/v1/admin/'.length), await readBody(req)));
      }
      fail('NOT_FOUND', 404);
    } catch (error) {
      const code = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'SERVICE_ERROR';
      const status = error.status || (code.startsWith('TORN_') || code.startsWith('UPSTREAM_') || code === 'LOCAL_API_BUDGET' ? 503 : 500);
      if (!res.headersSent) send(res, status, { error: code, code });
      else res.end();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return { server, service };
}
if (require.main === module) {
  try {
    const config = readConfig();
    const { server, service } = createHttpServer(config);
    server.listen(config.port, config.host, () => { service.worker.start(); console.log('Premium service listening; mode=' + config.mode + '; port=' + server.address().port); });
    let stopping = false;
    const stop = () => { if (stopping) return; stopping = true; server.close(async () => { try { await service.close(); } finally { process.exit(0); } }); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  } catch { console.error('Premium service configuration or database initialization failed. Check the documented environment variables.'); process.exitCode = 1; }
}
module.exports = { createHttpServer, readBody };
