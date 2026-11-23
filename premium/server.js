const http = require('node:http');
const { readConfig } = require('./config');
const { createPremiumService } = require('./service');
const { fail } = require('./store');

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
      const prefix = config.publicUrl ? new URL(config.publicUrl).pathname.replace(/\/$/, '') : '';
      if (prefix && url.pathname === prefix) url.pathname = '/';
      else if (prefix && url.pathname.startsWith(prefix + '/')) url.pathname = url.pathname.slice(prefix.length);
      const isFactionHistory = /^\/v1\/factions\/\d+\/history$/.test(url.pathname);
      const isMemberSeries = /^\/v1\/factions\/\d+\/members\/\d+\/series$/.test(url.pathname);
      if (url.search && !isFactionHistory && !isMemberSeries) fail('QUERY_NOT_ALLOWED');
      if (isFactionHistory && url.search) {
        for (const k of url.searchParams.keys()) if (!['from', 'to', 'grain'].includes(k)) fail('QUERY_NOT_ALLOWED');
      }
      if (isMemberSeries && url.search) {
        for (const k of url.searchParams.keys()) if (!['metric', 'from', 'to'].includes(k)) fail('QUERY_NOT_ALLOWED');
      }
      if (req.headers.origin) {
        const expected = config.publicUrl ? new URL(config.publicUrl).origin : 'http://' + req.headers.host;
        if (req.headers.origin !== expected) fail('ORIGIN_DENIED', 403);
      }
      if ((req.method === 'POST' || req.method === 'PATCH') && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) fail('JSON_REQUIRED', 415);
      if (url.pathname === '/health' && req.method === 'GET') return send(res, 200, { ok: true, mode: config.mode });
      if (url.pathname === '/v1/info' && req.method === 'GET') return send(res, 200, service.info());
      if (url.pathname === '/terms' && req.method === 'GET') return send(res, 200, {
        service: 'LRX Torn Tracker application premium', ...service.info().privacy,
        freeAccess: 'Access to Torn API data and existing features remains free. Remuneration concerns additional application-produced insights, when such benefits are offered.',
        data: ['Verified Torn ID', 'Xanax transfer ID, sender, quantity and timestamp', 'Subscription period and administrator audit records', 'Opt-in analysis profiles and selected observations (at most 1000 per module, up to two years)',
          'Shared Faction Hub, only for factions whose leader or co-leader connects a collector key: the encrypted collector key and its masked reference, hub settings including Discord webhook URLs, member names, levels, positions, activity, status and travel observations about every 5 minutes and travel changes (kept 30 days), hourly and daily activity counts (kept 180 days), Discord alert delivery records (kept 30 days) and hub audit records (kept 180 days)'],
        keyUsage: "A submitted login key is sent only to Torn to verify its owner and is not stored. A faction collector key is stored only after a faction leader or co-leader connects it with explicit consent; it is encrypted at rest (AES-256-GCM), used only to read that faction's member list while the faction has an active plan, never shown again, and deleted when it is disconnected or its owner requests erasure. The receiver key is an operator-managed server secret.",
        rights: 'Authenticated users can export their account data and request an erasure assessment. Payment disputes and duplicate-prevention retention must be assessed before erasing records. Faction hub records about the requesting player, and any collector key they connected, are included in the export; an erasure request deletes them at once, stops the faction hub from recording that player again and pauses any collector that used their key.',
      });
      if (['/v1/auth/torn', '/v1/auth/test'].includes(url.pathname) && req.method === 'POST') {
        if (url.pathname.endsWith('/test') && config.mode === 'live') fail('TEST_LOGIN_DISABLED', 403);
        const remote = clientAddress(req, config);
        // Per-address limit first: requests it refuses must not use up the shared budget below,
        // or one address could block every login.
        const bucket = attempts.get(remote);
        if (bucket && bucket.until > service.store.now() && bucket.count >= 10) fail('AUTH_RATE_LIMIT', 429);
        // Global ceiling so many distinct addresses cannot flood Torn verification
        if (!globalAttempts.until || globalAttempts.until <= service.store.now()) { globalAttempts.until = service.store.now() + 60; globalAttempts.count = 0; }
        if (++globalAttempts.count > 300) fail('AUTH_RATE_LIMIT', 429);
        if (!bucket && attempts.size >= 1000) {
          for (const [key, entry] of attempts) if (entry.until <= service.store.now()) attempts.delete(key);
          if (attempts.size >= 1000) fail('AUTH_RATE_LIMIT', 429);
        }
        if (!bucket || bucket.until <= service.store.now()) attempts.set(remote, { until: service.store.now() + 60, count: 1 });
        else bucket.count++;
        const body = await readBody(req);
        if (url.pathname.endsWith('/test')) return send(res, 200, service.auth.loginTest(req.headers['x-premium-test-token'], body.tornId));
        return send(res, 200, await service.auth.login(body.apiKey));
      }
      const actor = service.auth.authenticate(req.headers.authorization);
      if (url.pathname === '/v1/auth/logout' && req.method === 'POST') { service.auth.logout(req.headers.authorization); return send(res, 200, { ok: true }); }
      if (url.pathname === '/v1/me' && req.method === 'GET') return send(res, 200, service.me(actor));
      if (url.pathname === '/v1/me/data' && req.method === 'GET') return send(res, 200, service.exportData(actor));
      if (url.pathname === '/v1/features' && req.method === 'GET') return send(res, 200, { access: service.features.access(actor) });
      if (url.pathname.startsWith('/v1/features/') && req.method === 'POST') {
        const action = url.pathname.slice('/v1/features/'.length), body = await readBody(req);
        if (action === 'workspace') return send(res, 200, service.features.workspace(actor, body.featureId));
        if (['save', 'select', 'remove', 'run', 'consent'].includes(action)) return send(res, 200, service.features[action](actor, body));
        fail('NOT_FOUND', 404);
      }
      if (url.pathname === '/v1/me/erasure-request' && req.method === 'POST') return send(res, 200, service.requestErasure(actor));
      if (url.pathname === '/v1/premium/receipt-export' && req.method === 'GET') return send(res, 200, service.exportReceipts(actor));
      if (url.pathname === '/v1/premium/access-check' && req.method === 'GET') { service.requirePremium(actor); return send(res, 200, { entitled: true }); }
      // Shared Faction Hub endpoints (P1.3 / P3.1 / N3) — verified session; faction role from the collected roster
      // (connecting a key is verified against Torn with that key). No Torn request is made per hub read.
      const memSeriesMatch = /^\/v1\/factions\/(\d+)\/members\/(\d+)\/series$/.exec(url.pathname);
      if (memSeriesMatch) {
        if (req.method !== 'GET') fail('METHOD_NOT_ALLOWED', 405);
        return send(res, 200, await service.factionHub.getMemberSeries(actor, Number(memSeriesMatch[1]), Number(memSeriesMatch[2]), {
          metric: url.searchParams.get('metric') || 'activity',
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
        }));
      }
      const facMatch = /^\/v1\/factions\/(\d+)\/(status|history|settings|report)$/.exec(url.pathname);
      if (facMatch) {
        const fid = Number(facMatch[1]);
        const sub = facMatch[2];
        if (sub === 'status' && req.method === 'GET') return send(res, 200, await service.factionHub.getStatus(actor, fid));
        if (sub === 'history' && req.method === 'GET') {
          return send(res, 200, await service.factionHub.getHistory(actor, fid, {
            from: url.searchParams.get('from'),
            to: url.searchParams.get('to'),
            grain: url.searchParams.get('grain') || 'hour',
          }));
        }
        if (sub === 'settings' && req.method === 'GET') return send(res, 200, await service.factionHub.getSettings(actor, fid));
        if (sub === 'settings' && req.method === 'PATCH') return send(res, 200, await service.factionHub.updateSettings(actor, fid, await readBody(req)));
        if (sub === 'report' && req.method === 'GET') return send(res, 200, await service.factionHub.getSharedReport(actor, fid));
        fail('METHOD_NOT_ALLOWED', 405);
      }
      if (url.pathname.startsWith('/v1/admin')) {
        service.store.assertAdmin(actor);
        if (url.pathname === '/v1/admin/faction-collector' && req.method === 'GET') {
          return send(res, 200, service.factionHub.operatorSummary());
        }
        if (url.pathname === '/v1/admin/faction-collector/jobs' && req.method === 'POST') {
          return send(res, 200, await service.factionHub.operatorJob(actor, await readBody(req)));
        }
        if (url.pathname === '/v1/admin' && req.method === 'GET') {
          // The admin page reloads itself every 15 seconds. A viewing is recorded once per administrator per ten
          // minutes, so the audit trail (its last 100 entries are shown) is not buried under "viewed" rows.
          const viewed = service.store.db.prepare("SELECT created_at FROM premium_audit_log WHERE actor_torn_id=? AND action='admin.read' ORDER BY id DESC LIMIT 1").get(actor.tornId);
          if (!viewed || service.store.now() - viewed.created_at >= 600) service.store.audit(actor, 'admin.read', 'premium', 'Administrator viewed billing records', null, null);
          return send(res, 200, { ...service.info(), ...service.store.adminData(), featureOverrides: service.store.db.prepare('SELECT torn_id,feature_id,allowed,updated_at FROM premium_feature_overrides ORDER BY updated_at DESC LIMIT 100').all() });
        }
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
    server.listen(config.port, config.host, () => { service.worker.start(); service.factionHub.start(); console.log('Premium service listening; mode=' + config.mode + '; port=' + server.address().port); });
    let stopping = false;
    const stop = () => { if (stopping) return; stopping = true; server.close(async () => { try { await service.close(); } finally { process.exit(0); } }); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  } catch { console.error('Premium service configuration or database initialization failed. Check the documented environment variables.'); process.exitCode = 1; }
}
module.exports = { createHttpServer, readBody };
