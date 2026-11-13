const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createHttpServer } = require('../../premium/server');
const { readConfig } = require('../../premium/config');
const { validateParams, analyze } = require('../../premium/insights');
const catalog = require('../../public/feature-catalog');
const { tripMetrics } = require('../../public/travel-math');
const NOW = 1794331965;
async function fixture(t, filename = ':memory:') {
  const clock = { now: NOW }, secret = crypto.randomBytes(32).toString('hex');
  const { server, service } = createHttpServer(readConfig({ PREMIUM_MODE: 'test', PREMIUM_DB_PATH: filename, PREMIUM_TEST_AUTH_TOKEN: secret }), { now: () => clock.now, fetchImpl: async () => { throw Error('No external API calls in feature analysis'); } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise((r) => server.close(r)); await service.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function call(route, body, token) { const res = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), 'X-Premium-Test-Token': secret }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: res.status, data: await res.json() }; }
  async function login(id) { const r = await call('/v1/auth/test', { tornId: id }); assert.equal(r.status, 200); return r.data.token; }
  const admin = await login(4037017), user = await login(123456), other = await login(222222);
  const enable = async (token = user, tornId = 123456) => { assert.equal((await call('/v1/admin/subscription', { torn_id: tornId, days: 30, reason: 'Synthetic feature scenario' }, admin)).status, 200); assert.equal((await call('/v1/features/consent', { accepted: true }, token)).status, 200); };
  return { clock, service, call, login, admin, user, other, enable };
}
const travelInput = (at = NOW) => ({ items: [{ key: 'mex:1', name: 'Flower', country: 'Mexico', code: 'mex', minutes: 30, cost: 100, market: 500, qty: 100, at, source: 'YATA' }, { key: 'uk:2', name: 'Plushie', country: 'UK', code: 'uk', minutes: 60, cost: 200, market: 1500, qty: 10, at, source: 'Prometheus' }] });
const meritInput = (at = NOW) => ({ tracks: [{ id: 'a', name: 'Education Length', level: 0, description: '' }, { id: 'b', name: 'Bank Interest', level: 0, description: '' }], available: 5, awards: 10, observedAt: at, source: 'desktop-api-snapshot' });
const eventInput = (at = NOW, exact = true) => ({ events: [{ key: 'easter:123', title: 'Easter', start: NOW + 1800, end: NOW + 86400, exact, progress: null, at }] });

test('every existing feature switch and all five themes remain Free in the shared registry', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/features.js'), 'utf8').split('const FEATURE_DEF_MAP')[0];
  const keys = [...source.matchAll(/key: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 50);
  for (const key of keys) assert.equal(catalog.byId[key]?.tier, 'free', key);
  assert.equal(new Set(catalog.definitions.map((d) => d.id)).size, catalog.definitions.length);
  const themeSource = fs.readFileSync(path.join(__dirname, '../../public/workspace.js'), 'utf8');
  for (const theme of ['obsidian', 'ocean', 'forest', 'amethyst', 'light']) assert.ok(themeSource.includes("['" + theme + "'"));
  assert.equal(catalog.premium.length, 6);
  assert.deepEqual({ ...catalog.byId.overview_widgets }, {
    id: 'overview_widgets', tier: 'premium', module: 'overview',
    title: ["Genel Bakış widget'ları", 'Overview widgets'],
    description: ["Diğer sayfalardan widget'lar, S/M/L boyut ve kayıtlı düzenler.", 'Widgets from other pages, S/M/L sizes and saved layouts.'],
  });
});

test('HTTP denies all paid operations to Free users, ignores forged flags, and rejects unknown features', async (t) => {
  const f = await fixture(t);
  for (const d of catalog.premium) for (const action of ['save', 'select', 'run']) {
    const r = await f.call('/v1/features/' + action, { featureId: d.id, premium: true, admin: true, tornId: 4037017 }, f.user);
    assert.equal(r.status, 403, action + ':' + d.id); assert.equal(r.data.code, 'PREMIUM_REQUIRED');
  }
  for (const id of ['missing', '__proto__', 'constructor']) assert.equal((await f.call('/v1/features/run', { featureId: id }, f.admin)).status, 404);
  assert.equal((await f.call('/v1/features/run', { featureId: 'travel_advanced' })).status, 401);
  const status = (await f.call('/v1/me', undefined, f.user)).data;
  for (const d of catalog.definitions.filter((d) => d.tier === 'free')) assert.equal(status.featureAccess.permissions[d.id], true);
  assert.equal(status.freeApiAccess, true); assert.equal(status.livePayments, false);
});

test('analysis needs no acceptance checkbox; pausing preserves profiles', async (t) => {
  const f = await fixture(t);
  const direct = await f.call('/v1/features/run', { featureId: 'appearance_custom_themes' }, f.admin);
  assert.equal(direct.status, 200);
  assert.equal((await f.call('/v1/me', undefined, f.admin)).data.featureAccess.analysisEnabled, true);
  await f.enable();
  const saved = await f.call('/v1/features/save', { featureId: 'appearance_custom_themes', revision: 0, name: 'Aurora', params: { preset: 'aurora' } }, f.user);
  assert.equal(saved.status, 200);
  await f.call('/v1/features/consent', { accepted: false }, f.user);
  assert.equal((await f.call('/v1/features/run', { featureId: 'appearance_custom_themes', profileId: saved.data.savedId }, f.user)).data.code, 'FEATURE_ANALYSIS_PAUSED');
  const exported = (await f.call('/v1/me/data', undefined, f.user)).data.advancedFeatures;
  assert.equal(exported.modules.appearance_custom_themes.workspace.profiles.length, 1);
  assert.equal(exported.consent, null);
});

test('expiry closes access exactly at server expiry and renewal restores preserved profiles', async (t) => {
  const f = await fixture(t); await f.enable();
  const saved = (await f.call('/v1/features/save', { featureId: 'travel_advanced', revision: 0, name: 'Island strategy', params: { capacity: 25, waitMinutes: 10 } }, f.user)).data;
  f.service.store.db.prepare('UPDATE premium_subscriptions SET expires_at=? WHERE torn_id=123456').run(f.clock.now + 5);
  const run = () => f.call('/v1/features/run', { featureId: 'travel_advanced', profileId: saved.savedId, input: travelInput() }, f.user);
  assert.equal((await run()).status, 200);
  f.clock.now += 5;
  assert.equal((await run()).status, 403);
  const inactive = (await f.call('/v1/me', undefined, f.user)).data;
  assert.equal(inactive.featureAccess.permissions.travel_advanced, false); assert.equal(inactive.featureAccess.permissions.travel_basic, true);
  const w = (await f.call('/v1/features/workspace', { featureId: 'travel_advanced' }, f.user)).data;
  assert.equal(w.profiles[0].params.capacity, 25);
  await f.enable(); assert.equal((await run()).status, 200);
  assert.equal((await f.call('/v1/features/workspace', { featureId: 'travel_advanced' }, f.user)).data.activeProfile, saved.savedId);
});

test('feature overrides require an audited administrator and never grant an expired membership', async (t) => {
  const f = await fixture(t); await f.enable();
  const body = { tornId: 123456, featureId: 'travel_advanced', allowed: false, reason: 'Synthetic module exception' };
  assert.equal((await f.call('/v1/admin/feature-permission', body, f.user)).status, 403);
  assert.equal((await f.call('/v1/admin/feature-permission', body, f.admin)).status, 200);
  assert.equal((await f.call('/v1/features/run', { featureId: 'travel_advanced', input: travelInput() }, f.user)).data.code, 'FEATURE_NOT_GRANTED');
  assert.equal((await f.call('/v1/features/run', { featureId: 'appearance_custom_themes' }, f.user)).status, 200);
  f.service.store.db.prepare('UPDATE premium_subscriptions SET expires_at=? WHERE torn_id=123456').run(f.clock.now);
  await f.call('/v1/admin/feature-permission', { ...body, allowed: true }, f.admin);
  assert.equal((await f.call('/v1/features/run', { featureId: 'travel_advanced', input: travelInput() }, f.user)).data.code, 'PREMIUM_REQUIRED');
  assert.equal((await f.call('/v1/admin/feature-permission', { ...body, tornId: 4037017 }, f.admin)).status, 409);
  assert.equal((await f.call('/v1/admin/feature-permission', { ...body, featureId: 'travel_basic' }, f.admin)).status, 400);
  assert.equal(f.service.store.db.prepare("SELECT count(*) n FROM premium_audit_log WHERE action='features.permission'").get().n, 2);
});

test('profiles and histories are account-scoped, conflicts are atomic, and unsafe inputs are rejected', async (t) => {
  const f = await fixture(t); await f.enable(); await f.enable(f.other, 222222);
  const body = { featureId: 'travel_advanced', revision: 0, name: '<script>not executable</script>', params: { capacity: 25 } };
  const results = await Promise.all([f.call('/v1/features/save', body, f.user), f.call('/v1/features/save', body, f.user)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const saved = results.find((r) => r.status === 200).data;
  assert.equal((await f.call('/v1/features/run', { featureId: 'travel_advanced', profileId: saved.savedId, input: travelInput() }, f.other)).status, 404);
  assert.equal((await f.call('/v1/features/workspace', { featureId: 'travel_advanced', tornId: 123456 }, f.other)).data.profiles.length, 0);
  const bad = await f.call('/v1/features/save', { ...body, revision: 1, params: { capacity: -1 } }, f.user);
  assert.equal(bad.status, 400);
  assert.equal((await f.call('/v1/features/workspace', { featureId: 'travel_advanced' }, f.user)).data.revision, 1);
});

test('travel shares basic profit arithmetic and applies fees, delay and costs only to the scenario', () => {
  const params = validateParams('travel_advanced', { capacity: 10, waitMinutes: 30, feePercent: 10, sellChangePercent: -20, fixedCosts: 100 });
  const out = analyze('travel_advanced', params, travelInput(), NOW).result, r = out.routes.find((r) => r.key === 'mex:1');
  assert.deepEqual(r.baseline, tripMetrics(400, 10, 100, 30));
  assert.equal(r.scenario.trip, 2500); assert.equal(r.scenario.round, 90); assert.equal(r.scenario.perHour, 2500 / 1.5);
  assert.equal(out.countries.length, 2);
  const unknown = travelInput(); unknown.items.forEach((r) => r.market = null);
  assert.equal(analyze('travel_advanced', params, unknown, NOW).result.routes.length, 0);
});

test('price history deduplicates cache samples and records another observed point after five minutes', async (t) => {
  const f = await fixture(t); await f.enable();
  const body = { featureId: 'travel_advanced', params: { watchKey: 'mex:1' }, input: travelInput(), record: true };
  assert.equal((await f.call('/v1/features/run', body, f.user)).data.result.history.length, 1);
  assert.equal((await f.call('/v1/features/run', body, f.user)).data.result.history.length, 1);
  f.clock.now += 300; body.input = travelInput(f.clock.now); body.input.items[0].cost = 120;
  const r = (await f.call('/v1/features/run', body, f.user)).data.result;
  assert.deepEqual(r.history.map((h) => h.cost), [100, 120]);
  assert.equal((await f.call('/v1/me/data', undefined, f.other)).data.advancedFeatures.modules.travel_advanced.history.length, 0);
});

test('combined player filters, unknown values, comparisons and stale alerts are explicit', () => {
  const p = validateParams('helpers_advanced', { minLevel: 20, maxLevel: 40, minStats: 100, maxStats: 1000, minFF: 2, status: 'Okay', includeUnknown: false, compare: [1, 2], rule: { enabled: true, metric: 'matchingPlayers', threshold: 1 } });
  const input = { observedAt: NOW, ownStats: 1000, players: [{ id: 1, name: 'A', level: 30, stats: 500, ff: 2.5, status: 'Okay' }, { id: 2, name: 'B', level: 25, stats: 700, ff: 1.5, status: 'Okay' }, { id: 3, name: 'C', level: 22, stats: null, ff: null, status: 'Okay' }] };
  const r = analyze('helpers_advanced', p, input, NOW).result;
  assert.deepEqual(r.matches.map((p) => p.id), [1]); assert.equal(r.comparison.length, 2); assert.equal(r.comparison[0].ratio, .5); assert.equal(r.alerts.length, 1);
  assert.equal(analyze('helpers_advanced', p, input, NOW + 121).result.alerts.length, 0);
  const energy = { ...p, rule: { enabled: true, metric: 'energyPercent', operator: 'gte', threshold: 80 } };
  assert.equal(analyze('helpers_advanced', energy, { ...input, metrics: { energyPercent: 100 }, metricsObservedAt: NOW - 121 }, NOW).result.alerts.length, 0, 'fresh roster does not refresh old bars');
  assert.equal(analyze('helpers_advanced', energy, { ...input, observedAt: NOW - 121, metrics: { energyPercent: 100 }, metricsObservedAt: NOW }, NOW).result.alerts.length, 1, 'fresh bars work independently of an old roster');
  assert.equal(analyze('helpers_advanced', energy, { ...input, metrics: { energyPercent: 100 }, metricsObservedAt: null }, NOW).result.alerts.length, 0, 'unknown bar timestamp cannot trigger an alert');
});

test('event goals preserve unknown API progress, mark manual data and skip uncertain start reminders', () => {
  const p = validateParams('events_advanced', { eventKey: 'easter:123', notifications: true });
  const unknown = analyze('events_advanced', p, eventInput(NOW, false), NOW).result;
  assert.equal(unknown.current, null); assert.equal(unknown.remaining, null); assert.equal(unknown.pct, null); assert.equal(unknown.alerts.length, 0);
  assert.equal(analyze('events_advanced', p, eventInput(), NOW).result.alerts.length, 1);
  const manual = analyze('events_advanced', { ...p, useManual: true, manualProgress: 30 }, eventInput(), NOW + 3600, [{ seriesKey: 'easter:123', at: NOW, data: { current: 10, source: 'manual' } }]).result;
  assert.equal(manual.source, 'manual'); assert.equal(manual.perHour, 20); assert.equal(manual.remaining, 70); assert.equal(manual.estimatedHours, 3.5);
});

test('merit optimizer respects incremental costs and priorities, compares plans, and never changes game data', () => {
  const input = meritInput(), original = JSON.stringify(input);
  const p = validateParams('merits_optimizer', { budget: 5, priorities: { a: 3, b: 1 }, targets: { a: 10 }, comparison: { b: 2 } });
  const r = analyze('merits_optimizer', p, input, NOW).result;
  assert.deepEqual(r.recommended.rows.map((r) => r.target), [2, 1]); assert.equal(r.spent, 4); assert.equal(r.score, 7);
  assert.equal(r.planned.cost, 55); assert.equal(r.planned.missing, 50); assert.equal(r.comparison.cost, 3); assert.equal(JSON.stringify(input), original);
  const capped = analyze('merits_optimizer', validateParams('merits_optimizer', { budget: 110 }), input, NOW).result;
  assert.deepEqual(capped.recommended.rows.map((r) => r.target), [10, 10]); assert.equal(capped.spent, 110);
  assert.throws(() => validateParams('merits_optimizer', { targets: { a: 11 } }), /INVALID_FEATURE_INPUT/);
});

test('theme profiles accept readable presets and reject CSS payloads and unreadable colors', () => {
  for (const preset of ['eclipse', 'aurora', 'rose']) assert.equal(validateParams('appearance_custom_themes', { preset }).preset, preset);
  const p = validateParams('appearance_custom_themes'); p.preset = 'custom'; p.palette.bg = 'url(https://example.invalid)';
  assert.throws(() => validateParams('appearance_custom_themes', p), /INVALID_FEATURE_INPUT/);
  p.palette = { bg: '#000000', panel: '#000000', text: '#000000', muted: '#000000', accent: '#000000' };
  assert.throws(() => validateParams('appearance_custom_themes', p), /PALETTE_CONTRAST/);
});

test('saved profiles survive service restart and Ezlira remains permanently entitled', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-feature-restart-')), filename = path.join(folder, 'test.sqlite');
  t.after(() => { const resolved = path.resolve(folder); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); assert.ok(path.basename(resolved).startsWith('lrx-feature-restart-')); fs.rmSync(resolved, { recursive: true, force: true }); });
  const { createPremiumService } = require('../../premium/service');
  const config = readConfig({ PREMIUM_MODE: 'test', PREMIUM_DB_PATH: filename, PREMIUM_TEST_AUTH_TOKEN: crypto.randomBytes(32).toString('hex') });
  let s = createPremiumService(config, { now: () => NOW }); s.store.registerVerifiedUser(4037017);
  const actor = { tornId: 4037017, admin: true }; s.features.consent(actor, { accepted: true });
  const saved = s.features.save(actor, { featureId: 'appearance_custom_themes', revision: 0, name: 'Persistent', params: { preset: 'aurora' } });
  await s.close(); s = createPremiumService(config, { now: () => NOW + 86400 });
  assert.equal(s.features.workspace(actor, 'appearance_custom_themes').activeProfile, saved.savedId);
  assert.equal(s.features.access(actor).permissions.appearance_custom_themes, true); assert.equal(s.store.entitlement(4037017).permanent, true);
  assert.equal(s.store.db.prepare('SELECT max(version) v FROM premium_migrations').get().v, 4); await s.close();
});

test('recorded observations expire by retention policy even when the user stops analyzing', async (t) => {
  const f = await fixture(t); await f.enable();
  await f.call('/v1/features/run', { featureId: 'travel_advanced', params: { watchKey: 'mex:1' }, input: travelInput(), record: true }, f.user);
  f.clock.now += 731 * 86400; f.service.store.maintenance();
  assert.equal(f.service.store.db.prepare('SELECT count(*) n FROM premium_feature_observations').get().n, 0);
});

test('only active, unpaused and granted saved notification profiles resume after reconnect', async (t) => {
  const f = await fixture(t); await f.enable();
  await f.call('/v1/features/save', { featureId: 'helpers_advanced', revision: 0, name: 'Energy alert', params: { rule: { enabled: true, metric: 'energyPercent', threshold: 80 } } }, f.user);
  let access = (await f.call('/v1/me', undefined, f.user)).data.featureAccess;
  assert.equal(access.automations.length, 1); assert.equal(access.automations[0].featureId, 'helpers_advanced');
  await f.call('/v1/features/consent', { accepted: false }, f.user);
  assert.equal((await f.call('/v1/me', undefined, f.user)).data.featureAccess.automations.length, 0);
  await f.call('/v1/features/consent', { accepted: true }, f.user);
  await f.call('/v1/admin/feature-permission', { featureId: 'helpers_advanced', tornId: 123456, allowed: false, reason: 'Suspend synthetic alert module' }, f.admin);
  assert.equal((await f.call('/v1/me', undefined, f.user)).data.featureAccess.automations.length, 0);
});

test('feature sampling and profile limits are bounded and prototype keys are rejected', async (t) => {
  const f = await fixture(t); await f.enable();
  for (let i = 0; i < 12; i++) assert.equal((await f.call('/v1/features/save', { featureId: 'appearance_custom_themes', revision: i, name: 'Profile ' + i }, f.user)).status, 200);
  assert.equal((await f.call('/v1/features/save', { featureId: 'appearance_custom_themes', revision: 12, name: 'Overflow' }, f.user)).data.code, 'PROFILE_LIMIT');
  for (const reserved of ['__proto__', 'constructor', 'prototype']) assert.throws(() => validateParams('merits_optimizer', { priorities: JSON.parse('{"' + reserved + '":10}') }), /INVALID_FEATURE_INPUT/);
  for (let i = 0; i < 60; i++) await f.call('/v1/features/run', { featureId: 'appearance_custom_themes' }, f.user);
  assert.equal((await f.call('/v1/features/run', { featureId: 'appearance_custom_themes' }, f.user)).status, 429);
  assert.equal((await f.call('/v1/me', undefined, f.user)).data.featureAccess.permissions.travel_basic, true);
});

test('schema 3 upgrades to feature tables without changing subscriptions or payment settings', async (t) => {
  const { DatabaseSync } = require('node:sqlite'), { createPremiumService } = require('../../premium/service');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-feature-migration-')), filename = path.join(folder, 'test.sqlite');
  t.after(() => { const resolved = path.resolve(folder); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); assert.ok(path.basename(resolved).startsWith('lrx-feature-migration-')); fs.rmSync(resolved, { recursive: true, force: true }); });
  const config = readConfig({ PREMIUM_MODE: 'test', PREMIUM_DB_PATH: filename, PREMIUM_TEST_AUTH_TOKEN: crypto.randomBytes(32).toString('hex') });
  let s = createPremiumService(config, { now: () => NOW }); s.store.registerVerifiedUser(123456);
  s.store.adjustSubscription({ tornId: 4037017, admin: true }, { torn_id: 123456, days: 30, reason: 'Existing membership before migration' });
  const before = s.store.entitlement(123456), settings = s.store.settings(); await s.close();
  // Reconstruct the exact pre-feature schema in an isolated fixture only.
  const legacy = new DatabaseSync(filename);
  legacy.exec('DROP TABLE premium_feature_overrides; DROP TABLE premium_feature_workspaces; DROP TABLE premium_feature_observations; DROP TABLE premium_feature_consents; DELETE FROM premium_migrations WHERE version=4;'); legacy.close();
  s = createPremiumService(config, { now: () => NOW });
  assert.deepEqual(s.store.entitlement(123456), before); assert.deepEqual(s.store.settings(), settings);
  assert.equal(s.store.db.prepare('SELECT max(version) AS v FROM premium_migrations').get().v, 4);
  assert.deepEqual(s.features.workspace({ tornId: 123456 }, 'travel_advanced').profiles, []); await s.close();
});
