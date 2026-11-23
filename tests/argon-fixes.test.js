/* Regression tests for the Argon review fixes (server routes, roster cache, Stocks alerts, Ops panel).
   The server runs against a temporary data folder with a stubbed fetch: no real Torn, YATA, FFScouter or
   Premium request is ever made. Tests in this file share one server and run in order. */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');

const stocksMath = require('../public/stocks-math');
const { createRosterCache } = require('../src/server/roster-cache');

const ROOT = path.join(__dirname, '..');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* =========================================================
   Renderer: Stocks price alerts (finding 1)
   ========================================================= */
function stocksSandbox({ notify }) {
  const body = { innerHTML: '', addEventListener() {}, querySelector: () => null };
  const store = new Map();
  const state = { lang: 'en', view: 'stocks' };
  const rules = [{ id: 'r1', assetKind: 'stock', assetId: '1', label: 'SYM', direction: 'above', threshold: 700, enabled: true }];
  const evaluated = stocksMath.evaluatePriceAlerts(rules, { 'stock:1': 710 }, { 'stock:1': 690 }, '2026-11-23T10:05:00Z');
  const data = {
    stocks: { 1: { stock_id: 1, acronym: 'SYM', name: 'Symbiotic Ltd.', current_price: 710, benefit: { type: 'active', frequency: 7, requirement: 500000, description: '1x Drug Pack' } } },
    userStocks: {},
    itemPriceByName: {},
    pointsPrice: 0,
    bankAprs: null,
    priceHistory: {},
    priceAlerts: { rules, triggered: evaluated.events },
  };
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, Math, Date, Number, String, Array, Object, Set, Map, JSON, RegExp, Error, Promise, Boolean,
    I18N: {}, VIEW_META: {}, EXTRA_LOADERS: {}, FEATURE_HOOKS: [],
    state,
    LRXStocksMath: stocksMath,
    $: (sel) => (sel === '#stocks-body' ? body : null),
    document: { activeElement: null, getElementById: () => null },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    setTimeout: () => 0,
    tr: (t, e) => (state.lang === 'en' ? e : t),
    esc,
    n0: (n) => String(Math.round(Number(n) || 0)),
    money: (n) => '$' + Math.round(Number(n) || 0),
    cmoney: (n) => '$' + Math.round(Number(n) || 0),
    compact: (n) => String(n),
    signed: (v) => String(v),
    deltaCls: () => '',
    kpi: (l, v, h = '') => `<div class="kpi">${l}:${v}:${h}</div>`,
    emptyBox: (t, x) => `<div class="empty">${t}:${x}</div>`,
    loadingBox: () => '<div>Loading</div>',
    errorBox: (e) => `<div class="err">${esc(e?.message || e)}</div>`,
    lsGet: (_k, d) => d,
    lsSet() {},
    feat: () => true,
    notify,
    toast() {},
    showView() {},
    applyLang() {},
    api: async () => data,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/stocks.js'), 'utf8'), ctx, { filename: 'stocks.js' });
  return { ctx, body, store };
}

test('finding 1: a triggered price alert renders and notifies with the current price instead of crashing the Stocks page', async () => {
  const sent = [];
  const { ctx, body } = stocksSandbox({ notify: (key, title, text) => sent.push({ key, title, text }) });
  await ctx.EXTRA_LOADERS.stocks(true);
  assert.equal(sent.length, 1, 'one notification for the crossing');
  assert.match(sent[0].text, /\$710\.00 crossed above \$700\.00/);
  assert.ok(body.innerHTML.includes('stk-alert-fired'), 'the fired alert banner is rendered');
  assert.ok(body.innerHTML.includes('$710.00'), 'banner shows the current price');
  assert.equal(body.innerHTML.includes('class="err"'), false, 'no error box from a crashed alert check');
});

test('finding 1: the alert dedupe key is written only after the notification went out', async () => {
  let attempts = 0;
  const { ctx, store } = stocksSandbox({ notify: () => { attempts++; if (attempts === 1) throw new Error('notification failed'); } });
  await ctx.EXTRA_LOADERS.stocks(true);
  assert.equal(attempts, 1);
  assert.equal([...store.keys()].some((k) => k.startsWith('lrx.priceAlert.')), false, 'a failed notification is not marked as sent');
  await ctx.EXTRA_LOADERS.stocks(true);
  assert.equal(attempts, 2, 'the alert is tried again on the next refresh');
  assert.equal([...store.keys()].some((k) => k.startsWith('lrx.priceAlert.')), true, 'a sent notification is remembered');
  await ctx.EXTRA_LOADERS.stocks(true);
  assert.equal(attempts, 2, 'a sent alert is not repeated');
});

/* =========================================================
   Renderer: Ops panel (findings 11, 16, 17)
   ========================================================= */
function opsSandbox({ features = {}, view = 'settings', panelActive = true, status = null, job = null } = {}) {
  const panel = { classList: { contains: (c) => c === 'active' && panelActive } };
  const box = {
    innerHTML: '', hidden: false, listeners: {},
    addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
    closest: (sel) => (sel === '.set-panel' ? panel : null), querySelector: () => null,
  };
  const calls = [];
  const toasts = [];
  const state = { lang: 'en', view, overview: { player: { faction: { faction_id: 500 } } } };
  const ctx = {
    console, Math, Date, Number, String, Array, Object, Set, Map, JSON, RegExp, Error, Promise, Boolean,
    state,
    $: (sel) => (sel === '#ops-control-panel' ? box : null),
    document: { activeElement: null },
    addEventListener() {},
    esc,
    tr: (t, e) => (state.lang === 'en' ? e : t),
    feat: (k) => (k in features ? features[k] : true),
    n0: (x) => String(Math.round(Number(x) || 0)),
    loadingBox: () => '<div class="loading"></div>',
    errorBox: (e) => `<div class="err">${esc(e?.message || e)}</div>`,
    toast: (m) => toasts.push(m),
    api: async (url, opts) => {
      calls.push(url);
      if (url.startsWith('/api/ops/status')) {
        return status || {
          at: Date.now(), factionId: 500, maskedKey: '****ABCD', tornPausedUntil: 0,
          sources: { torn: { ok: true, calls: 1 }, yata: { ok: null }, prometheus: { ok: null } },
          localRoster: null,
          hub: { connected: true, admin: true, collector: { collectors: [{ factionId: 500, paused: false, coveragePct: 80 }], outbox: { counts: { pending: 0, sent: 0, failed: 0, needs_review: 0 } } } },
        };
      }
      if (url === '/api/ops/faction-collector/jobs') {
        if (job) throw job;
        return { ok: true };
      }
      throw new Error('Unmocked ' + url + ' ' + JSON.stringify(opts || {}));
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/ops-ui.js'), 'utf8'), ctx, { filename: 'ops-ui.js' });
  return { ctx, box, calls, toasts, state };
}

test('finding 16: the team plan end date is read as Unix seconds', async () => {
  const endsAt = Date.UTC(2026, 11, 24, 12, 30, 0) / 1000;
  const { ctx, box } = opsSandbox({
    status: {
      at: Date.now(), factionId: 500, maskedKey: '****ABCD', tornPausedUntil: 0, sources: {}, localRoster: null,
      hub: { connected: true, admin: false, factionSettings: { role: 'leader', plan: { active: true, endsAt }, audit: [] } },
    },
  });
  await ctx.loadOpsPanel();
  assert.ok(box.innerHTML.includes('24 Dec'), `plan end shows 24 Dec, got: ${box.innerHTML.match(/Team Plan Active[^<]*/)?.[0]}`);
  assert.equal(box.innerHTML.includes('Jan'), false, 'never a January 1970 date');
});

test('finding 17: the Ops panel asks the server only when app.ops is on and Settings → General is on screen', async () => {
  const hidden = opsSandbox({ view: 'overview' });
  await hidden.ctx.loadOpsPanel();
  assert.deepEqual(hidden.calls, [], 'no /api/ops/status while another page is shown');

  const otherTab = opsSandbox({ view: 'settings', panelActive: false });
  await otherTab.ctx.loadOpsPanel();
  assert.deepEqual(otherTab.calls, [], 'no /api/ops/status while another Settings tab is shown');

  const off = opsSandbox({ features: { 'app.ops': false } });
  await off.ctx.loadOpsPanel();
  assert.deepEqual(off.calls, [], 'no /api/ops/status when the feature is off');
  assert.equal(off.box.innerHTML, '', 'the panel stays empty when the feature is off');

  const shown = opsSandbox();
  await shown.ctx.loadOpsPanel();
  assert.deepEqual(shown.calls, ['/api/ops/status'], 'loads once when shown');

  // Opening Settings with General active loads it; other pages do not.
  const viaView = opsSandbox({ view: 'overview' });
  viaView.ctx.onViewShown?.('overview');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(viaView.calls, []);
  viaView.state.view = 'settings';
  viaView.ctx.onViewShown?.('settings');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(viaView.calls, ['/api/ops/status'], 'Settings → General shown loads the panel');
});

test('finding 11: an operator action error is shown as text, never as a raw bridge code', async () => {
  const err = Object.assign(new Error('PREMIUM_CONNECT_REQUIRED'), { code: 'PREMIUM_CONNECT_REQUIRED', status: 401 });
  const { ctx, box, toasts } = opsSandbox({ job: err });
  await ctx.loadOpsPanel();
  const click = box.listeners.click?.[0];
  assert.equal(typeof click, 'function');
  click({ target: { closest: (sel) => (sel === '[data-ops-job]' ? { dataset: { opsJob: 'pause' } } : null) } });
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  assert.equal(toasts.length, 1);
  assert.equal(/PREMIUM_CONNECT_REQUIRED/.test(toasts[0]), false, `toast must not show the raw code: ${toasts[0]}`);
  assert.match(toasts[0], /Premium/);
});

/* =========================================================
   Roster cache (finding 5)
   ========================================================= */
test('finding 5: a stale reply of the previous key never wipes the new key\'s roster cache', async () => {
  let keyGen = 1;
  const resolvers = [];
  const rc = createRosterCache({
    getFactionId: () => 500,
    getKeyGen: () => keyGen,
    fetchMembers: () => new Promise((resolve, reject) => resolvers.push({ resolve, reject, gen: keyGen })),
  });
  const oldLoad = rc.load({ force: true });
  keyGen = 2;
  const newLoad = rc.load({ force: true });
  resolvers[1].resolve({ faction_id: 500, members: [{ id: 7, name: 'NewKeyMember', status: { state: 'Okay', description: 'Okay' } }] });
  const snap = await newLoad;
  assert.deepEqual(snap.members.map((m) => m.name), ['NewKeyMember']);

  resolvers[0].resolve({ faction_id: 500, members: [{ id: 99, name: 'OldKeyMember' }] });
  await assert.rejects(() => oldLoad, (e) => e.code === 'KEY_CHANGED');
  assert.equal(rc.peek()?.membersCount, 1, 'the new key\'s cache survives the stale reply');

  // An auth error of the old key that lands late does not wipe the new key's cache either.
  keyGen = 3;
  const gen3 = rc.load({ force: true });
  keyGen = 4;
  const gen4 = rc.load({ force: true });
  resolvers[3].resolve({ faction_id: 500, members: [{ id: 8, name: 'Gen4' }] });
  await gen4;
  resolvers[2].reject(Object.assign(new Error('Incorrect key'), { code: 2 }));
  await assert.rejects(() => gen3, /Incorrect key/);
  assert.equal(rc.peek()?.membersCount, 1, 'a late auth error of an old key leaves the current cache alone');
});

/* =========================================================
   Server (findings 2-4, 6-15 and the unconfirmed items)
   ========================================================= */
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-argon-tests-'));
const PREMIUM_URL = 'https://premium.argon.invalid/torn-premium';
process.env.TORN_DATA_DIR = temp;
process.env.TORN_API_KEY = 'ArgonKey12345678';
process.env.TORN_PREMIUM_SERVICE_URL = PREMIUM_URL;

const nowSec = Math.floor(Date.now() / 1000);
const dayAgo = (n) => new Date((nowSec - n * 86400) * 1000).toISOString().slice(0, 10);
const snap = (tp) => ({ timeplayed: tp, xantaken: 10, criminaloffenses: 100, bloodwithdrawn: 1, organizedcrimes: 2 });
const legacyBs = [];
for (let i = 0; i < 405; i++) {
  const at = (nowSec - (900 - i) * 86400) * 1000;
  legacyBs.push({ at, observedAt: new Date(at).toISOString(), source: 'ffscouter', verified: false, total: 1000 + i });
}
legacyBs.push({ at: Date.now() - 86400_000, observedAt: new Date(Date.now() - 86400_000).toISOString(), source: 'rank_estimate', verified: false, total: 7e6 });
fs.writeFileSync(path.join(temp, 'history.json'), JSON.stringify({
  ownerId: 1,
  days: [], addiction: {}, user: {}, stockOrders: {}, stockDeliveries: { at: 0, items: [] },
  lastOverview: { player: { id: 1, name: 'Alpha', faction: { faction_id: 9001 } } },
  eduNames: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, { name: `Course ${i + 1}`, code: `C${i}`, duration: 1 }])),
  purchases: {
    258: [{ ts: Date.now() - 3600_000, qty: 10, each: 10, src: 'abroad' }, { ts: Date.now() - 7200_000, qty: 5, each: 15000, src: 'market' }],
    206: [{ ts: Date.now() - 1800_000, qty: 3, each: 750000, src: 'abroad' }],
  },
  manualCosts: {},
  faction: {
    snaps: { [dayAgo(0)]: { 1: snap(9000), 2: snap(5000) }, [dayAgo(7)]: { 1: snap(8000), 2: snap(4000) }, [dayAgo(10)]: { 1: snap(7000), 2: snap(3000) }, [dayAgo(100)]: { 1: snap(10), 2: snap(10) } },
    gym: { [dayAgo(1)]: { 1: 4000, 2: 2500 }, [dayAgo(60)]: { 1: 1000, 2: 500 }, [dayAgo(100)]: { 1: 10, 2: 10 } },
    activity: {
      factionId: 9001, lastAt: 0, lastTimelineAt: 0, lastTrafficAt: 0, buckets: {}, timeline: [], traffic: [], transfers: [], lastMembers: null, lastMembersAt: null,
      memberTravel: {
        2: [{ fromState: 'none_observed', toState: 'outbound', countryCode: 'jap', country: 'Japan' }],
        999: [{ id: '999:abroad->inbound:torn:1', fromState: 'abroad', toState: 'inbound', destination: 'torn', origin: 'mex', seenFrom: null, seenTo: null }],
      },
    },
    memberBs: { 2: legacyBs, 999: [{ at: Date.now(), observedAt: new Date().toISOString(), source: 'ffscouter', verified: false, total: 5 }] },
  },
}));
// 60 hours of YATA readings, one every 3 minutes, for Jaguar Plushie in Mexico
const lastStockAt = nowSec - 600;
const stockRows = [];
for (let t = lastStockAt - 60 * 3600; t <= lastStockAt; t += 180) stockRows.push([t, 100, 10, 'YATA']);
fs.writeFileSync(path.join(temp, 'travel-stock.json'), JSON.stringify({
  'mex:258': { q: 100, t: lastStockAt, restocks: [], empties: [], samples: [[lastStockAt, 100]], history: stockRows },
}));

const fetchLog = [];
const flags = { failUserFaction: true, overviewFactionId: 9001 };
let member2Status = { state: 'Okay', description: 'Okay' };
let membersFetches = 0;
const realFetch = global.fetch;
const reply = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
global.fetch = async (url) => {
  const s = String(url);
  fetchLog.push(s);
  if (s.startsWith(PREMIUM_URL)) throw new TypeError('fetch failed');
  if (s.startsWith('https://yata.yt/')) {
    return reply({
      stocks: {
        mex: { update: nowSec - 60, stocks: [{ id: 258, name: 'Jaguar Plushie', quantity: 90, cost: 10 }, { id: 206, name: 'Xanax', quantity: 40, cost: 750000 }] },
        sou: { update: nowSec - 60, stocks: [{ id: 206, name: 'Xanax', quantity: 300, cost: 750000 }] },
      },
    });
  }
  if (s.startsWith('https://api.prombot.co.uk/')) return reply({});
  if (s.startsWith('https://ffscouter.com/')) return reply([{ player_id: 2, bs_estimate: 5_000_000, bs_estimate_human: '5m', fair_fight: 2.1, last_updated: nowSec - 3600 }]);
  if (!s.startsWith('https://api.torn.com/')) throw new Error('Unexpected fetch: ' + s);
  const q = s.slice('https://api.torn.com/'.length);
  if (q.startsWith('v2/faction/members')) {
    membersFetches++;
    return reply({
      members: [
        { id: 1, name: 'Alpha', level: 70, position: 'Leader', days_in_faction: 200, is_in_oc: true, last_action: { status: 'Online', timestamp: nowSec - 30, relative: '0m ago' }, status: { state: 'Okay', description: 'Okay' } },
        { id: 2, name: 'Beta', level: 55, position: 'Member', days_in_faction: 50, is_in_oc: false, last_action: { status: 'Idle', timestamp: nowSec - 900, relative: '15m ago' }, status: member2Status },
      ],
    });
  }
  if (q.startsWith('v2/user/faction')) {
    if (flags.failUserFaction) throw new TypeError('fetch failed');
    return reply({ faction: { id: 9001, name: 'Test Fac', tag: 'TST', position: 'Leader' } });
  }
  if (q.startsWith('v2/faction/basic')) return reply({ basic: { id: 9001, leader_id: 1, co_leader_id: 0, members: 2 } });
  if (q.startsWith('v2/faction/contributors')) return reply({ contributors: [{ id: 1, value: 5000 }, { id: 2, value: 3000 }] });
  if (q.startsWith('v2/faction/news')) return reply({ error: { code: 7, error: 'Incorrect ID-entity relation' } });
  if (q.startsWith('user/77?')) return reply({ error: { code: 9, error: 'API disabled' } });
  if (q.startsWith('v2/user/log')) return reply({ error: { code: 16, error: 'Access level of this key is not high enough' } });
  if (q.startsWith('torn/?selections=items')) return reply({ items: { 258: { name: 'Jaguar Plushie', type: 'Plushie', market_value: 18000, sell_price: 10 }, 206: { name: 'Xanax', type: 'Drug', market_value: 840000, sell_price: 0 } } });
  if (q.startsWith('user/?selections=travel,money,perks')) return reply({ money_onhand: 1_000_000, travel: { destination: 'Torn', time_left: 0, method: 'Airstrip' } });
  if (q.startsWith('faction/9001?selections=basic')) return reply({ ID: 9001, name: 'Test Fac', tag: 'TST', members: { 2: { name: 'Beta', level: 55, position: 'Member', days_in_faction: 50, status: { state: 'Okay' }, last_action: {} } } });
  if (q.startsWith('user/?selections=profile,cooldowns')) {
    return reply({
      player_id: 1, name: 'Alpha', level: 70, rank: 'Champion', server_time: nowSec,
      faction: { faction_id: flags.overviewFactionId, position: flags.overviewFactionId ? 'Leader' : 'None' },
      strength: 1e6, defense: 1e6, speed: 1e6, dexterity: 1e6, personalstats: {}, cooldowns: {}, icons: {},
    });
  }
  return reply({});
};

const { server, flushData, factionDataAccess, isTornSourceError } = require('../src/server/server');
const ready = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
async function call(route, { method = 'GET', body } = {}) {
  await ready;
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: server.address().port, path: route, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text || '{}') }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const readHistory = () => { flushData(); return JSON.parse(fs.readFileSync(path.join(temp, 'history.json'), 'utf8')); };

after(async () => {
  global.fetch = realFetch;
  flushData();
  await new Promise((resolve) => server.close(resolve));
  const resolved = path.resolve(temp), rootTmp = path.resolve(os.tmpdir()) + path.sep;
  if (resolved.startsWith(rootTmp) && path.basename(resolved).startsWith('lrx-argon-tests-')) fs.rmSync(resolved, { recursive: true, force: true });
});

test('finding 6: a failed faction access check is an error for bank and recruitment, not "permission required"', async () => {
  const ws = await call('/api/faction/workspace?section=all');
  assert.equal(ws.status, 200);
  assert.equal(ws.data.bank.status, 'error');
  assert.equal(ws.data.recruitment.status, 'error');
  assert.equal(typeof ws.data.bank.error, 'string');
  assert.ok(ws.data.bank.error.length > 10 && !/^[A-Z_]+$/.test(ws.data.bank.error), `bank.error is a sentence: ${ws.data.bank.error}`);
  assert.equal(ws.data.access.inFaction, null, 'an unknown access state is not "not in a faction"');
  flags.failUserFaction = false;
});

test('finding 6: bank and applications follow Faction API Access, real permission codes stay permission_required', () => {
  assert.equal(typeof factionDataAccess, 'function');
  assert.deepEqual(factionDataAccess({ inFaction: true, allowed: false, apiAccess: true, ocAbility: false }), { allowed: true, status: 'idle' });
  assert.deepEqual(factionDataAccess({ inFaction: true, allowed: true, apiAccess: true, ocAbility: true }), { allowed: true, status: 'idle' });
  assert.deepEqual(factionDataAccess({ inFaction: true, allowed: false, apiAccess: false }), { allowed: false, status: 'permission_required' });
  assert.deepEqual(factionDataAccess({ allowed: false, error: 'x', errorCode: 16 }), { allowed: false, status: 'permission_required' });
  const transient = factionDataAccess({ allowed: false, error: 'x', errorCode: 5 });
  assert.equal(transient.status, 'error');
  assert.equal(transient.allowed, false);
  assert.match(transient.error, /faction/i);
});

test('findings 8 & 4: the weekly report reuses the roster cache and keeps 95 days of snapshots and gym records', async () => {
  flags.failUserFaction = false;
  await call('/api/faction/workspace?section=members'); // roster loaded (and cached) just before the report starts
  const before = membersFetches;
  const started = await call('/api/faction/report?days=7', { method: 'POST' });
  assert.equal(started.status, 200);
  for (let i = 0; i < 50; i++) {
    const r = await call('/api/faction/report?days=7');
    if (!r.data.job?.running) break;
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.equal(membersFetches, before, 'no second v2/faction/members request right after the roster was loaded');
  const ws = await call('/api/faction/workspace?section=members&days=90');
  assert.equal(ws.status, 200);
  assert.equal(ws.data.gymView.actualDays, 60, '60-day-old gym record kept, 100-day-old one pruned');
});

test('finding 4: 7d and 30d columns carry their real coverage; a shorter span is never reported as complete', async () => {
  const ws = await call('/api/faction/workspace?section=members&days=30');
  assert.equal(ws.status, 200);
  assert.deepEqual(
    { d7: { actualDays: ws.data.coverage?.d7?.actualDays, complete: ws.data.coverage?.d7?.complete }, d30: { actualDays: ws.data.coverage?.d30?.actualDays, complete: ws.data.coverage?.d30?.complete } },
    { d7: { actualDays: 7, complete: true }, d30: { actualDays: 10, complete: false } },
  );
  assert.equal(ws.data.statsView.range.actualDays, 10);
  assert.equal(ws.data.statsView.range.complete, false, 'a 10-day delta under the 30d label is incomplete');
});

test('findings 2 & 14: every travel transition is logged per member, and the members table reads the radar fields', async () => {
  member2Status = { state: 'Okay', description: 'Okay' };
  await call('/api/faction/activity?force=1');

  member2Status = { state: 'Traveling', description: 'Traveling to Japan' };
  await call('/api/faction/activity?force=1');
  let ws = await call('/api/faction/workspace?section=members');
  let row = ws.data.membersTable.rows.find((r) => r.playerId === 2);
  assert.equal(row.travel?.state, 'outbound');
  assert.equal(row.travel?.countryCode, 'jap');
  assert.equal(row.travel?.country, 'Japan');
  assert.equal(row.travel?.etaSource, 'estimate');
  assert.ok(row.travel?.etaSec > 13300 && row.travel?.etaSec <= 13500, `etaSec from the radar estimate window, got ${row.travel?.etaSec}`);

  member2Status = { state: 'Abroad', description: 'In Japan' };
  await call('/api/faction/activity?force=1');
  ws = await call('/api/faction/workspace?section=members');
  row = ws.data.membersTable.rows.find((r) => r.playerId === 2);
  // etaAt is the Members tab's fallback for Shared Hub rows that carry no etaSec; abroad has neither.
  assert.deepEqual(row.travel, { state: 'abroad', countryCode: 'jap', country: 'Japan', etaSec: null, etaAt: null, etaSource: 'none' });

  member2Status = { state: 'Traveling', description: 'Returning to Torn from Japan' };
  await call('/api/faction/activity?force=1');
  ws = await call('/api/faction/workspace?section=members');
  row = ws.data.membersTable.rows.find((r) => r.playerId === 2);
  assert.equal(row.travel?.state, 'inbound');
  assert.equal(row.travel?.countryCode, 'jap', 'inbound shows the country the member flies back from');

  const ser = await call('/api/faction/members/2/series?metric=travel');
  assert.equal(ser.status, 200);
  const list = ser.data.transitions;
  assert.equal(list.length, 3, 'three transitions logged, the legacy entry without an id dropped');
  assert.deepEqual(list.map((x) => `${x.fromState}->${x.toState}`), ['abroad->inbound', 'outbound->abroad', 'none_observed->outbound']);
  for (const x of list) {
    assert.deepEqual(Object.keys(x).sort(), ['destination', 'fromState', 'id', 'origin', 'seenFrom', 'seenTo', 'toState']);
    assert.match(x.id, /^2:/);
    assert.match(x.seenTo, /^\d{4}-\d\d-\d\dT/);
  }
  assert.equal(list[0].origin, 'jap');
  assert.equal(list[0].destination, 'torn');
  assert.equal(list[2].destination, 'jap');

  const gone = await call('/api/faction/members/999/series?metric=travel');
  assert.deepEqual(gone.data.transitions, [], 'the travel log of a member who left is pruned');
});

test('finding 15: FFScouter totals already in memory are kept as one daily point per member', async () => {
  const tg = await call('/api/targets?faction=9001');
  assert.equal(tg.status, 200);
  const ffCalls = fetchLog.filter((u) => u.startsWith('https://ffscouter.com/')).length;
  const tornCalls = fetchLog.filter((u) => u.startsWith('https://api.torn.com/')).length;
  await call('/api/faction/workspace?section=members');
  await call('/api/faction/workspace?section=members');
  assert.equal(fetchLog.filter((u) => u.startsWith('https://ffscouter.com/')).length, ffCalls, 'no new FFScouter request');
  assert.ok(fetchLog.filter((u) => u.startsWith('https://api.torn.com/')).length - tornCalls <= 0, 'no new Torn request (roster still cached)');
  const h = readHistory();
  const pts = h.faction.memberBs['2'];
  assert.ok(Array.isArray(pts));
  assert.ok(pts.length <= 400, `history capped, got ${pts.length}`);
  assert.equal(pts.some((p) => p.source === 'rank_estimate'), false, 'rank estimates are never stored');
  const last = pts[pts.length - 1];
  assert.equal(last.source, 'ffscouter');
  assert.equal(last.total, 5_000_000);
  assert.equal(last.verified, false);
  const days = pts.map((p) => new Date(p.at).toISOString().slice(0, 10));
  assert.equal(new Set(days).size, days.length, 'one point per UTC day');
  assert.equal(h.faction.memberBs['999'], undefined, 'members who left are dropped');
  assert.equal(h.faction.memberBs['1'], undefined, 'own stats come from the daily stat history, not FFScouter');

  const ser = await call('/api/faction/members/2/series?metric=battlestats&range=all');
  assert.equal(ser.status, 200);
});

test('findings 12, 13 & 9: travel history spans 48h in 30-minute steps; flight history only lists abroad buys; log access is tri-state', async () => {
  const tv = await call('/api/travel');
  assert.equal(tv.status, 200);
  const mex = tv.data.countries.find((c) => c.code === 'mex');
  const jag = mex.items.find((i) => i.id === 258);
  const hist = jag.history;
  assert.ok(hist.length <= 96, `no more rows than before, got ${hist.length}`);
  const span = hist[hist.length - 1][0] - hist[0][0];
  assert.ok(span >= 47 * 3600 && span <= 48 * 3600, `history spans 48h, got ${(span / 3600).toFixed(1)}h`);
  assert.deepEqual(hist[hist.length - 1], [nowSec - 60, 90, 10, 'YATA'], 'the latest raw reading is kept');
  const buckets = hist.map((r) => Math.floor(r[0] / 1800));
  assert.equal(new Set(buckets).size, buckets.length, 'one reading per 30-minute bucket');

  const fh = tv.data.flightHistory;
  assert.equal(fh.logAccess, null, 'log access is "not checked yet" after a restart');
  assert.equal(fh.entries.some((e) => e.source !== 'log_abroad' && e.source !== 'manual_cost'), false, 'market buys are not flights');
  const jagBuy = fh.entries.find((e) => e.itemId === 258);
  assert.equal(jagBuy.countryCode, 'mex');
  const xanBuy = fh.entries.find((e) => e.itemId === 206);
  assert.equal(xanBuy.countryCode, null, 'an item sold in several countries keeps an unknown country');
  assert.equal(fh.entries.length, 2);

  await call('/api/jail');
  const tv2 = await call('/api/travel');
  assert.equal(tv2.data.flightHistory.logAccess, false, 'a refused log read is "off"');
  assert.equal(tv2.data.flightHistory.logError, 'ACCESS');
});

test('findings 3 & 11: Faction Hub routes report text errors and send nothing to Premium while the connection is off', async () => {
  const on = await call('/api/faction/hub/report?factionId=9001');
  assert.equal(on.status, 503);
  assert.equal(on.data.code, 'PREMIUM_SERVICE_UNREACHABLE');
  assert.notEqual(on.data.error, on.data.code, 'the error is text, not the raw code');
  assert.match(on.data.error, /Premium/);

  const off = await call('/api/features', { method: 'POST', body: { features: { 'app.premium': false } } });
  assert.equal(off.status, 200);
  const premiumBefore = fetchLog.filter((u) => u.startsWith(PREMIUM_URL)).length;
  const routes = [
    ['/api/faction/hub/settings?factionId=9001', 'GET'],
    ['/api/faction/hub/settings?factionId=9001', 'PATCH', { notify: true }],
    ['/api/faction/hub/history?factionId=9001', 'GET'],
    ['/api/faction/hub/report?factionId=9001', 'GET'],
    ['/api/ops/faction-collector/jobs', 'POST', { action: 'pause', factionId: 9001 }],
  ];
  for (const [route, method, body] of routes) {
    const r = await call(route, { method, body });
    assert.equal(r.status, 403, `${method} ${route}`);
    assert.equal(r.data.code, 'PREMIUM_DISABLED');
    assert.notEqual(r.data.error, 'PREMIUM_DISABLED');
    assert.match(r.data.error, /Premium/);
  }
  assert.equal(fetchLog.filter((u) => u.startsWith(PREMIUM_URL)).length, premiumBefore, 'no request reached the Premium service');
});

test('finding 7: a permission error does not mark Torn as failing; outages and Torn codes 5/8/9 do', async () => {
  assert.equal(typeof isTornSourceError, 'function');
  const arm = await call('/api/faction/armory');
  assert.equal(arm.data.allowed, false);
  let ops = await call('/api/ops/status');
  assert.equal(ops.data.sources.torn.ok, true, 'Torn answered: it is reachable');
  assert.equal(ops.data.sources.torn.lastErrorClass, null);

  const p = await call('/api/player?id=77');
  assert.equal(p.status, 502);
  ops = await call('/api/ops/status');
  assert.equal(ops.data.sources.torn.ok, false);
  assert.equal(ops.data.sources.torn.lastErrorClass, '9');

  for (const code of [5, 8, 9, 'BAD_RESPONSE', 'HTTP_502']) assert.equal(isTornSourceError({ code }), true, String(code));
  assert.equal(isTornSourceError(Object.assign(new Error('t'), { name: 'TimeoutError' })), true);
  assert.equal(isTornSourceError(new TypeError('fetch failed')), true);
  for (const code of [1, 2, 6, 7, 10, 16, 'NO_KEY']) assert.equal(isTornSourceError({ code }), false, String(code));
});

test('finding 10: watchlist tags and graffiti categories default to empty, never to Turkish text', async () => {
  const wl = await call('/api/faction/workspace', { method: 'POST', body: { action: 'watchlist_add', playerId: 5, name: 'Gamma' } });
  assert.equal(wl.status, 200);
  assert.equal(wl.data.watchlist[0].tag, '');
  const gf = await call('/api/faction/workspace', { method: 'POST', body: { action: 'graffiti_add', text: 'Hello' } });
  assert.equal(gf.status, 200);
  assert.equal(gf.data.graffiti[0].category, '');
});

test('unconfirmed: a player without a faction gets a clean "not in a faction" reply from Activity and the workspace', async () => {
  flags.overviewFactionId = 0;
  const ov = await call('/api/overview?force=1');
  assert.equal(ov.status, 200);
  const before = membersFetches;
  const act = await call('/api/faction/activity?force=1');
  assert.equal(act.status, 200);
  assert.equal(act.data.notInFaction, true);
  assert.deepEqual(act.data.members, []);
  const ws = await call('/api/faction/workspace?section=members&force=1');
  assert.equal(ws.status, 200);
  assert.equal(ws.data.notInFaction, true);
  assert.equal(membersFetches, before, 'no roster request without a faction');
});
