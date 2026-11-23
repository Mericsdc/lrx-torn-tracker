const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const travelRadar = require('../public/travel-radar');
const { createRosterCache } = require('../src/server/roster-cache');
const companyAdvisor = require('../public/company-advisor');
const stocksMath = require('../public/stocks-math');

const ROOT = path.join(__dirname, '..');

/* =========================================================
   1. P0.2 — Travel Radar State & Transition Engine
   ========================================================= */
test('P0.2: parses outbound, abroad, inbound, abroad-hospital, unknown, and none_observed with separate activity/health axes', () => {
  const cases = [
    {
      raw: { id: 1, name: 'Alpha', last_action: { status: 'Online' }, status: { state: 'Traveling', description: 'Traveling to Japan', until: 1999999999 } },
      expect: { travelState: 'outbound', origin: 'torn', destination: 'jap', activityStatus: 'Online', healthStatus: 'unknown', etaKind: 'unknown', etaAt: null, etaFrom: null, etaTo: null },
    },
    {
      raw: { id: 2, name: 'Bravo', last_action: { status: 'Idle' }, status: { state: 'Traveling', description: 'Returning to Torn from Mexico', until: 1999999999 } },
      expect: { travelState: 'inbound', origin: 'mex', destination: 'torn', activityStatus: 'Idle', healthStatus: 'unknown', etaKind: 'unknown', etaAt: null },
    },
    {
      raw: { id: 3, name: 'Charlie', last_action: { status: 'Offline' }, status: { state: 'Abroad', description: 'In Switzerland' } },
      expect: { travelState: 'abroad', origin: null, destination: 'swi', activityStatus: 'Offline', healthStatus: 'unknown', etaKind: 'unknown' },
    },
    {
      raw: { id: 4, name: 'Delta', last_action: { status: 'Online' }, status: { state: 'Hospital', description: 'In a Cayman Islands hospital', until: 1800000100 } },
      expect: { travelState: 'abroad', origin: null, destination: 'cay', activityStatus: 'Online', healthStatus: 'hospital', etaKind: 'unknown', etaAt: null },
    },
    {
      raw: { id: 5, name: 'Echo', last_action: { status: 'Online' }, status: { state: 'Hospital', description: 'In hospital in South Africa', until: 1800000200 } },
      expect: { travelState: 'abroad', origin: null, destination: 'sou', activityStatus: 'Online', healthStatus: 'hospital' },
    },
    {
      raw: { id: 6, name: 'Foxtrot', last_action: { status: 'Offline' }, status: { state: 'Traveling', description: 'Flying to Mysterious Island' } },
      expect: { travelState: 'unknown', origin: null, destination: null, rawDescription: 'Flying to Mysterious Island', etaKind: 'unknown', etaAt: null },
    },
    {
      raw: { id: 7, name: 'Golf', last_action: { status: 'Online' }, status: { state: 'Okay', description: 'Okay' } },
      expect: { travelState: 'none_observed', origin: null, destination: null, activityStatus: 'Online', healthStatus: 'okay' },
    },
  ];

  for (const c of cases) {
    const out = travelRadar.parseMemberTravel(c.raw);
    for (const [k, v] of Object.entries(c.expect)) {
      assert.equal(out[k], v, `${c.raw.name}.${k}`);
    }
  }
});

test('P0.2: status.until is NEVER treated as flight ETA; exact ETA only from verified flightArrivalAt; estimate ETA only from observed transition', () => {
  const t0 = Date.UTC(2026, 10, 23, 10, 0, 0);
  const t1 = Date.UTC(2026, 10, 23, 10, 5, 0);
  const t2 = Date.UTC(2026, 10, 23, 10, 10, 0);

  // Snapshot 1: Player 10 already flying (no prior snapshot -> unknown ETA); Player 11 Okay in Torn; Player 12 has verified flightArrivalAt
  const snap1 = travelRadar.buildRadarPayload({
    factionId: 42,
    observedAtMs: t0,
    nowMs: t0,
    members: [
      { id: 10, name: 'AlreadyFlying', status: { state: 'Traveling', description: 'Traveling to Mexico', until: Math.floor((t0 + 600_000) / 1000) } },
      { id: 11, name: 'AboutToFly', status: { state: 'Okay', description: 'Okay' } },
      { id: 12, name: 'ExactFlight', status: { state: 'Traveling', description: 'Traveling to Canada' }, flightArrivalAt: Math.floor((t0 + 1800_000) / 1000) },
    ],
  });
  const p10s1 = snap1.travel.find((r) => r.playerId === 10);
  assert.equal(p10s1.etaKind, 'unknown', 'member already flying on first snapshot must not fabricate ETA');
  assert.equal(p10s1.etaAt, null);
  assert.equal(p10s1.etaFrom, null);
  assert.equal(p10s1.etaTo, null);

  const p12s1 = snap1.travel.find((r) => r.playerId === 12);
  assert.equal(p12s1.etaKind, 'exact');
  assert.equal(p12s1.etaAt, travelRadar.isoUtc(t0 + 1800_000));

  // Snapshot 2: Player 11 transitions Okay -> Traveling to Japan (67.5 min Business .. 225 min Standard; ticket unknown)
  const snap2 = travelRadar.buildRadarPayload({
    factionId: 42,
    observedAtMs: t1,
    nowMs: t1,
    prevByPlayer: snap1.nextByPlayer,
    prevObservedAtMs: t0,
    activeTransitions: snap1.nextActiveTransitions,
    members: [
      { id: 10, name: 'AlreadyFlying', status: { state: 'Traveling', description: 'Traveling to Mexico' } },
      { id: 11, name: 'AboutToFly', status: { state: 'Traveling', description: 'Traveling to Japan' } },
    ],
  });
  assert.equal(snap2.transitions.length, 1);
  assert.equal(snap2.transitions[0].fromState, 'none_observed');
  assert.equal(snap2.transitions[0].toState, 'outbound');
  const p11s2 = snap2.travel.find((r) => r.playerId === 11);
  assert.equal(p11s2.etaKind, 'estimate');
  assert.equal(p11s2.etaFrom, travelRadar.isoUtc(t0 + Math.round(225 * 0.3 * 60_000)));
  assert.equal(p11s2.etaTo, travelRadar.isoUtc(t1 + 225 * 60_000));
  assert.equal(p11s2.etaAt, null);

  // Snapshot 3: Player 11 still on same outbound Japan leg -> retains original estimate window
  const snap3 = travelRadar.buildRadarPayload({
    factionId: 42,
    observedAtMs: t2,
    nowMs: t2,
    prevByPlayer: snap2.nextByPlayer,
    prevObservedAtMs: t1,
    activeTransitions: snap2.nextActiveTransitions,
    members: [
      { id: 11, name: 'AboutToFly', status: { state: 'Traveling', description: 'Traveling to Japan' } },
    ],
  });
  assert.equal(snap3.transitions.length, 0);
  const p11s3 = snap3.travel.find((r) => r.playerId === 11);
  assert.equal(p11s3.etaKind, 'estimate');
  assert.equal(p11s3.etaFrom, p11s2.etaFrom);
  assert.equal(p11s3.etaTo, p11s2.etaTo);
});

/* =========================================================
   2. P0.1 — Shared Roster Cache, Dedupe, Staleness & Isolation
   ========================================================= */
test('P0.1: concurrent Activity + Travel Radar + OC share 1 Torn API call; cache hit never advances observedAt; stale after 5m', async () => {
  let clock = Date.UTC(2026, 10, 23, 12, 0, 0);
  let calls = 0;
  let release;
  const rc = createRosterCache({
    now: () => clock,
    getFactionId: () => 500,
    getKeyGen: () => 1,
    fetchMembers: () => {
      calls++;
      return new Promise((resolve) => {
        release = () => resolve({
          faction_id: 500,
          members: [
            { id: 1, name: 'Alice', status: { state: 'Traveling', description: 'Traveling to UAE' }, last_action: { status: 'Online', timestamp: 1700000000 } },
          ],
        });
      });
    },
  });

  const p1 = rc.load();
  const p2 = rc.load();
  const p3 = rc.load();
  assert.equal(calls, 1, 'concurrent callers must deduplicate into 1 Torn API call');
  release();
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.equal(r1.freshness.observedAt, r2.freshness.observedAt);
  assert.equal(r2.freshness.observedAt, r3.freshness.observedAt);
  assert.equal(r1.freshness.state, 'fresh');

  // 90 seconds later: within 2-min TTL -> cache hit, observedAt MUST NOT advance, ageSec increases
  clock += 90_000;
  const cachedRes = await rc.load();
  assert.equal(calls, 1, 'second call within 2m TTL must serve from shared cache');
  assert.equal(cachedRes.fromCache, true);
  assert.equal(cachedRes.freshness.observedAt, r1.freshness.observedAt, 'cache hit must never advance observedAt');
  assert.equal(cachedRes.freshness.ageSec, 90);
  assert.equal(cachedRes.freshness.state, 'fresh');

  // 6 minutes later (> 5m stale threshold) with transient 429 error -> falls back to stale cache explicitly
  clock += 270_000; // total 360s = 6 min
  let failTransient = true;
  const rc2 = createRosterCache({
    now: () => clock,
    getFactionId: () => 500,
    getKeyGen: () => 1,
    fetchMembers: async () => {
      if (failTransient) {
        const err = new Error('Too many requests');
        err.code = 5;
        throw err;
      }
      return { faction_id: 500, members: [{ id: 1, name: 'Alice', status: { state: 'Abroad', description: 'In UAE' } }] };
    },
  });
  failTransient = false;
  const first = await rc2.load();
  assert.equal(first.freshness.state, 'fresh');

  clock += 6 * 60_000;
  failTransient = true;
  const fallback = await rc2.load();
  assert.equal(fallback.freshness.state, 'stale', 'data older than 5m must be marked stale');
  assert.equal(fallback.freshness.staleFallback, true);
  assert.equal(fallback.freshness.staleReason, '5');
  assert.equal(fallback.freshness.observedAt, first.freshness.observedAt);
});

test('P0.1: 401/403 or revoked key wipes private roster cache immediately; account & faction switch never leak or mix state', async () => {
  let clock = Date.UTC(2026, 10, 23, 14, 0, 0);
  let keyGen = 1;
  let factionId = 100;
  let mode = 'ok';

  const rc = createRosterCache({
    now: () => clock,
    getFactionId: () => factionId,
    getKeyGen: () => keyGen,
    fetchMembers: async () => {
      if (mode === '403') {
        const e = new Error('Incorrect key');
        e.status = 403;
        e.code = 2;
        throw e;
      }
      return {
        faction_id: factionId,
        members: [{ id: factionId * 10 + 1, name: `Fac${factionId}Member`, status: { state: 'Traveling', description: 'Traveling to China' } }],
      };
    },
  });

  const snapA = await rc.load();
  assert.equal(snapA.factionId, 100);
  assert.equal(rc.peek().factionId, 100);

  // Auth revocation: MUST wipe cache and throw (never serve stale private data)
  clock += 3 * 60_000;
  mode = '403';
  await assert.rejects(() => rc.load(), /Incorrect key/);
  assert.equal(rc.peek(), null, '401/403 must wipe cached private faction data');

  // Re-load faction 100, then switch to faction 200 -> state isolated, zero mixed members
  mode = 'ok';
  await rc.load();
  factionId = 200;
  const snapB = await rc.load();
  assert.equal(snapB.factionId, 200);
  assert.deepEqual(snapB.members.map((m) => m.name), ['Fac200Member']);

  // Account switch during in-flight fetch discards stale response
  let resolveSlow;
  const rcSlow = createRosterCache({
    now: () => clock,
    getFactionId: () => factionId,
    getKeyGen: () => keyGen,
    fetchMembers: () => new Promise((r) => { resolveSlow = r; }),
  });
  const pending = rcSlow.load();
  keyGen = 2;
  resolveSlow({ faction_id: 200, members: [{ id: 99, name: 'OldAccountMember' }] });
  await assert.rejects(() => pending, (err) => err.code === 'KEY_CHANGED');
  assert.equal(rcSlow.peek(), null, 'discarded in-flight fetch from old key must not populate cache');
});

/* =========================================================
   3. P2.2 — Company 18:00 TCT Stock Order & Price Threshold Alerts
   ========================================================= */
test('P2.2: companyStockOrder calculates exact target order and returns justified empty state when sales history is insufficient', () => {
  const empty = companyAdvisor.companyStockOrder({ avgDailySales: 0, salesSamples: 0, availableStock: 500, targetDays: 3 });
  assert.equal(empty.insufficientHistory, true);
  assert.equal(empty.reason, 'insufficient_sales_history');
  assert.equal(empty.recommended, 0);

  const calc = companyAdvisor.companyStockOrder({ avgDailySales: 120, salesSamples: 5, availableStock: 100, verifiedInTransit: 50, targetDays: 3 });
  assert.equal(calc.insufficientHistory, false);
  assert.equal(calc.targetStock, 360);
  assert.equal(calc.recommended, 210); // max(0, 360 - 100 - 50)
});

test('P2.2: evaluatePriceAlerts treats first sample as baseline, fires on crossing, ignores source outages', () => {
  const rules = [
    { id: 'r1', assetKind: 'stock', assetId: '25', label: 'SYM', direction: 'below', threshold: 700, enabled: true },
    { id: 'r2', assetKind: 'stock', assetId: '15', label: 'FHG', direction: 'above', threshold: 500, enabled: true },
  ];

  // Sample 1: first observation = baseline, emits 0 alerts even if already past threshold
  const s1 = stocksMath.evaluatePriceAlerts(rules, { 'stock:25': 690, 'stock:15': 490 }, {}, '2026-11-23T10:00:00Z');
  assert.equal(s1.events.length, 0, 'first sample must set baseline without firing');
  assert.equal(s1.nextPrev['stock:25'], 690);

  // Sample 2: stock 15 crosses above 500 -> fires once; stock 25 already below 700 -> no duplicate fire
  const s2 = stocksMath.evaluatePriceAlerts(rules, { 'stock:25': 680, 'stock:15': 510 }, s1.nextPrev, '2026-11-23T10:05:00Z');
  assert.equal(s2.events.length, 1);
  assert.equal(s2.events[0].ruleId, 'r2');
  assert.equal(s2.events[0].assetId, '15');

  // Sample 3: source outage (empty prices) -> emits 0 alerts and preserves previous baseline
  const s3 = stocksMath.evaluatePriceAlerts(rules, {}, s2.nextPrev, '2026-11-23T10:10:00Z');
  assert.equal(s3.events.length, 0, 'source loss must never emit false alerts');
  assert.equal(s3.nextPrev['stock:15'], 510, 'baseline preserved across outage');
});

/* =========================================================
   4. P0.3 & P1.3 — UI Smoke Tests (TR/EN, XSS Escape, Outage Gaps, Masked Key)
   ========================================================= */
function runUiSmoke(lang) {
  const containers = {
    '#faction-body': { innerHTML: '', addEventListener() {}, contains: () => false, querySelector: () => null },
    '#ops-control-panel': { innerHTML: '', addEventListener() {}, contains: () => false, querySelector: () => null },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ctx = {
    window: {},
    addEventListener() {},
    document: { activeElement: null, querySelectorAll: () => [], getElementById: () => null },
    localStorage: { getItem: () => null, setItem() {} },
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout() {},
    console,
    Date, Math, Number, String, Array, Object, Map, Set, JSON, Promise, Boolean,
    I18N: {}, VIEW_META: {}, EXTRA_LOADERS: {}, FEATURE_HOOKS: [],
    state: { view: 'faction', lang, overview: { player: { id: 1001, faction: { faction_id: 500 } } } },
    $: (sel) => containers[sel] || null,
    esc,
    tr: (a, b) => (lang === 'en' ? b : a),
    feat: () => true,
    viewHidden: () => false,
    lsGet: (_k, d) => d,
    lsSet() {},
    nowTct: () => Date.UTC(2026, 10, 23, 12, 0, 0),
    n0: (x) => String(Math.round(Number(x) || 0)),
    compact: (x) => String(x),
    human: (s) => `${Math.max(0, Math.round(s))}s`,
    kpi: (l, v) => `<div class="kpi">${l}:${v}</div>`,
    loadingBox: () => '<div class="loading"></div>',
    errorBox: (e) => `<div class="err">${esc(e?.message || e)}</div>`,
    emptyBox: (t, b) => `<div class="empty">${t}|${b}</div>`,
    trackerVisible: () => true,
    applyLang() {},
    applyFeatures() {},
    notify() {},
    toast() {},
    showView() {},
    openInTab() {},
    api: async (url) => {
      if (url.startsWith('/api/faction/activity')) {
        const now = Date.UTC(2026, 10, 23, 12, 0, 0);
        return {
          factionId: 500,
          sourceMode: 'local',
          freshness: { source: 'torn_roster', observedAt: '2026-11-23T11:58:00Z', receivedAt: '2026-11-23T11:58:00Z', ageSec: 120, state: 'fresh' },
          travelSummary: { outbound: 1, abroad: 0, inbound: 1, unknown: 1, totalTravel: 3 },
          travel: [
            { playerId: 10, displayName: 'Hero<img src=x onerror=alert(1)>', level: 80, position: 'Member', travelState: 'outbound', origin: 'torn', destination: 'jap', activityStatus: 'Online', healthStatus: 'okay', etaKind: 'estimate', etaFrom: '2026-11-23T15:30:00Z', etaTo: '2026-11-23T15:35:00Z', etaAt: null },
            { playerId: 11, displayName: 'Returner', level: 70, position: 'Member', travelState: 'inbound', origin: 'mex', destination: 'torn', activityStatus: 'Idle', healthStatus: 'okay', etaKind: 'unknown', etaFrom: null, etaTo: null, etaAt: null },
            { playerId: 12, displayName: 'UnknownFlyer', level: 55, position: 'Member', travelState: 'unknown', origin: null, destination: null, rawDescription: '<script>evil()</script>', activityStatus: 'Offline', healthStatus: 'unknown', etaKind: 'unknown' },
          ],
          members: [{ id: 10, name: 'Hero', level: 80, position: 'Member', lastStatus: 'Online', state: 'Traveling', days: 50, inOc: true, lastRel: '1m ago', last: 100 }],
          counts: { total: 10, online: 4, idle: 2, offline: 4, okay: 7, hospital: 1, traveling: 2, abroad: 0, jail: 0, inOc: 8 },
          heatmap: { grid: [], maxAvg: 0, totalSamples: 0 },
          timeline: [
            { at: now - 3 * 3600_000, observedAt: '2026-11-23T09:00:00Z', online: 3, idle: 1, offline: 6, total: 10 },
            { at: now - 2 * 3600_000, observedAt: '2026-11-23T10:00:00Z', online: 4, idle: 2, offline: 4, total: 10 }, // 60m gap -> outage band!
            { at: now - 110 * 60_000, observedAt: '2026-11-23T10:10:00Z', online: 5, idle: 1, offline: 4, total: 10 },
          ],
        };
      }
      if (url.startsWith('/api/faction')) {
        return { access: { inFaction: true, allowed: false, faction: { name: 'LRX', tag: 'LRX' }, position: 'Member', members: 10 }, myOc: { inOc: false } };
      }
      if (url.startsWith('/api/ops/status')) {
        return {
          at: Date.now(), factionId: 500, maskedKey: '****ABCD', tornPausedUntil: 0,
          sources: { torn: { ok: true, latencyMs: 120, calls: 5, lastSuccessAt: Date.now() }, yata: { ok: true, latencyMs: 90, calls: 2 }, prometheus: { ok: false, lastErrorClass: 'TIMEOUT', latencyMs: 5000, calls: 1 } },
          localRoster: { factionId: 500, observedAt: '2026-11-23T11:58:00Z', ageSec: 120, state: 'fresh', membersCount: 10, travelCount: 3 },
          hub: { connected: false, admin: false },
        };
      }
      return {};
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.LRXTravelRadar = travelRadar;
  ctx.LRXFactionTools = require('../public/faction-tools');
  ctx.LRXTravelWorkspace = require('../public/travel-workspace');
  ctx.LRXFactionWorkspace = require('../public/faction-workspace');
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/faction.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/ops-ui.js'), 'utf8'), ctx);
  return { ctx, containers };
}

test('P0.3 & P1.3 UI smoke: Travel Radar, 24h step-line outage gap, XSS escaping, and Ops panel render cleanly in TR and EN', async () => {
  for (const lang of ['tr', 'en']) {
    const { ctx, containers } = runUiSmoke(lang);
    ctx.lrxFaction.tab = 'radar';
    await ctx.EXTRA_LOADERS.faction();
    const radarHtml = containers['#faction-body'].innerHTML;
    assert.ok(radarHtml.includes('data-fac-rad-state="outbound"'), `${lang}: outbound summary card`);
    assert.ok(radarHtml.includes('data-fac-rad-state="inbound"'), `${lang}: inbound summary card`);
    assert.ok(radarHtml.includes('data-travel-country="jap"'), `${lang}: Travel Profit cross-link for Japan`);
    assert.ok(radarHtml.includes('15:30–15:35 TCT'), `${lang}: transition estimate window rendered`);
    assert.equal(radarHtml.includes('<img src=x'), false, `${lang}: member name must be HTML-escaped`);
    assert.equal(radarHtml.includes('<script>evil()'), false, `${lang}: rawDescription must be HTML-escaped`);

    // Activity tab renders 24h TCT step-line SVG with explicit outage gap rect
    ctx.lrxFaction.tab = 'activity';
    await ctx.EXTRA_LOADERS.faction();
    const actHtml = containers['#faction-body'].innerHTML;
    assert.ok(actHtml.includes('class="fac-step-svg"'), `${lang}: 24h step-line SVG rendered`);
    assert.ok(actHtml.includes('class="fac-step-gap"'), `${lang}: outage gap rendered visibly`);

    // Ops Control Panel renders all 4 panels with masked key (it loads only while Settings is shown)
    ctx.state.view = 'settings';
    await ctx.loadOpsPanel();
    const opsHtml = containers['#ops-control-panel'].innerHTML;
    assert.ok(opsHtml.includes('****ABCD'), `${lang}: masked API key shown`);
    assert.ok(opsHtml.includes('Torn API') && opsHtml.includes('YATA') && opsHtml.includes('Prometheus'), `${lang}: all 3 sources shown`);
    assert.ok(opsHtml.includes('ops-check-sources'), `${lang}: check sources button rendered`);
  }
});

/* =========================================================
   5. N1 & N2 — Travel Workspace, Traffic Deduplication & 24h Clock Dial Tests
   ========================================================= */
test('N1: channelBreakdown, buildCountryCards, and buildHistorySeries enforce reference fees, sold_out vs unknown stock, and source switch markers', () => {
  const tw = require('../public/travel-workspace');

  // Channel fees: Market -5%, Bazaar 0%, NPC only when sellPrice > 0
  const chNoNpc = tw.channelBreakdown(1000, 10000, 0);
  assert.equal(chNoNpc.length, 2);
  assert.equal(chNoNpc[0].id, 'market_tax');
  assert.equal(chNoNpc[0].feeAmount, 500);
  assert.equal(chNoNpc[0].netProfit, 8500);
  assert.equal(chNoNpc[1].id, 'bazaar');
  assert.equal(chNoNpc[1].netProfit, 9000);

  const chWithNpc = tw.channelBreakdown(1000, 10000, 1200);
  assert.equal(chWithNpc.length, 3);
  assert.equal(chWithNpc[2].id, 'npc');
  assert.equal(chWithNpc[2].netProfit, 200);

  // Country cards: verified 0 -> sold_out, >30m -> stale, missing -> unknown
  const nowSec = 1800000000;
  const cards = tw.buildCountryCards([
    { code: 'mex', name: 'Mexico', minutes: 26, update: nowSec - 120, source: 'YATA', items: [{ id: 258, name: 'Jaguar Plushie', type: 'Plushie', cost: 10000, market: 18000, profit: 8000, qty: 0, nextRestock: nowSec + 1800 }] },
    { code: 'jap', name: 'Japan', minutes: 225, update: nowSec - 2400, source: 'Prometheus', items: [{ id: 206, name: 'Xanax', type: 'Drug', cost: 700000, market: 840000, profit: 140000, qty: 45 }] },
  ], { nowSec, capacity: 10 });
  const mex = cards.find((c) => c.code === 'mex');
  const jap = cards.find((c) => c.code === 'jap');
  const arg = cards.find((c) => c.code === 'arg');
  assert.equal(mex.stockState, 'sold_out', 'verified 0 stock must be sold_out');
  assert.equal(mex.stale, false);
  assert.equal(jap.stockState, 'in_stock');
  assert.equal(jap.stale, true, 'observation older than 30 min must be marked stale');
  assert.equal(arg.stockState, 'unknown', 'unobserved country must be unknown');

  // History series: restock events + source switch detection
  const hist = tw.buildHistorySeries({
    id: 206, name: 'Xanax', cost: 700000, market: 840000, profit: 140000, qty: 120, rate: 4, emptyAt: nowSec + 1800,
    history: [
      [nowSec - 3600, 10, 700000, 'YATA'],
      [nowSec - 1800, 0, 700000, 'YATA'],
      [nowSec - 900, 200, 700000, 'Prometheus'], // restock + source switch!
      [nowSec - 300, 120, 700000, 'Prometheus'],
    ],
  }, { countryCode: 'jap', metric: 'forecast', windowHours: 6, nowSec });
  assert.equal(hist.restockEvents.length, 1);
  assert.equal(hist.sourceChanges.length, 1);
  assert.equal(hist.sourceChanges[0].from, 'YATA');
  assert.equal(hist.sourceChanges[0].to, 'Prometheus');
  assert.ok(hist.forecastPoints.length >= 2);
});

test('N2: buildTrafficSnapshot deduplicates players, separates unknown route, and buildClockDial/evaluatePinnedPlan flag missed windows', () => {
  const tw = require('../public/travel-workspace');
  const t0 = 1800000000000;

  // Duplicate entries for playerId 7 in the same snapshot must be counted only once
  const snap1 = tw.buildTrafficSnapshot([
    { playerId: 7, travelState: 'outbound', countryCode: 'jap' },
    { playerId: 7, travelState: 'abroad', countryCode: 'jap' }, // duplicate player in same snapshot
    { playerId: 8, travelState: 'abroad', countryCode: 'jap' },
    { playerId: 9, travelState: 'unknown', countryCode: null },
  ], t0 - 3600_000);
  assert.equal(snap1.total.outbound, 1);
  assert.equal(snap1.total.abroad, 1);
  assert.equal(snap1.total.unknown, 1, 'unknown route counted separately');
  assert.equal(snap1.byCountry.jap.outbound + snap1.byCountry.jap.abroad, 2);

  // Single sample: periodDelta must be null
  const sum1 = tw.summarizeTraffic([snap1], { countryCode: 'jap', windowHours: 6, nowMs: t0 });
  assert.equal(sum1.periodDelta, null, 'periodDelta must be null when < 2 samples');

  const snap2 = tw.buildTrafficSnapshot([
    { playerId: 7, travelState: 'inbound', countryCode: 'jap' },
    { playerId: 8, travelState: 'abroad', countryCode: 'jap' },
    { playerId: 10, travelState: 'outbound', countryCode: 'jap' },
  ], t0);
  const sum2 = tw.summarizeTraffic([snap1, snap2], {
    countryCode: 'jap',
    windowHours: 6,
    nowMs: t0,
    restockEvents: [
      { t: Math.floor((t0 - 1800_000) / 1000), source: 'YATA' },
      { t: Math.floor((t0 - 1750_000) / 1000), source: 'YATA' }, // same 15m slot & source -> deduplicated!
    ],
  });
  assert.equal(sum2.periodDelta, 1); // from 2 active to 3 active
  assert.equal(sum2.restockCount, 1, 'duplicate restock in same quarter slot from same source must be counted once');

  // 24h Clock Dial & Pinned Plan evaluation
  const nowSec = Math.floor(1800000000 / 86400) * 86400 + 12 * 3600; // exact 12:00 TCT
  const plan = {
    nowSec,
    stops: [
      { key: 'mex:258', countryCode: 'mex', countryName: 'Mexico', itemId: 258, itemName: 'Jaguar Plushie', departAt: nowSec - 600, arriveAt: nowSec + 900, returnAt: nowSec + 2400, profit: 150000, carry: 100000, units: 15 },
    ],
  };
  const dial = tw.buildClockDial(plan, { nowSec, selectedIndex: 0 });
  assert.equal(dial.nowDeg, 180, '12:00 TCT must map to 180 deg on 24h dial');
  assert.equal(dial.arcs.length, 1);
  assert.equal(dial.arcs[0].selected, true);

  const pinEval = tw.evaluatePinnedPlan(plan, [
    { code: 'mex', update: nowSec - 60, items: [{ id: 258, qty: 0, nextRestock: null }] },
  ], { nowSec });
  assert.equal(pinEval.hasWarnings, true);
  assert.ok(pinEval.stops[0].warnings.some((w) => w.code === 'missed_departure'));
  assert.ok(pinEval.stops[0].warnings.some((w) => w.code === 'stock_depleted'));
});

/* =========================================================
   6. N3 & N4 — Faction Member Series, No Synthetic Sub-Stat Split, Tenure Filter & Transfer Observation Windows
   ========================================================= */
test('N3 & N4: LRXFactionWorkspace never splits FFScouter total estimate into sub-stats, enforces same-source daily average, filters stats by tenure, and labels transfer observation intervals', () => {
  const fw = require('../public/faction-workspace');
  const nowMs = Date.UTC(2026, 10, 23, 12, 0, 0);

  // Strict Rule: FFScouter total estimate must NEVER be synthetically split into STR/SPD/DEX/DEF
  const ffSeriesSub = fw.buildMemberSeries([
    { at: nowMs - 5 * 86400_000, source: 'ffscouter', verified: false, total: 50_000_000 },
    { at: nowMs, source: 'ffscouter', verified: false, total: 52_000_000 },
  ], { metric: 'battlestats', statKey: 'str', rangeKey: '30d', nowMs });
  assert.equal(ffSeriesSub.totalOnlyRestricted, true, 'requesting STR on total-only estimate must return totalOnlyRestricted');
  assert.equal(ffSeriesSub.points.length, 0, 'must never fabricate synthetic STR points from total estimate');

  // Single-point series: no trend line, no daily average
  const singlePt = fw.buildMemberSeries([
    { at: nowMs, source: 'ffscouter', verified: false, total: 52_000_000 },
  ], { metric: 'battlestats', statKey: 'total', rangeKey: '30d', nowMs });
  assert.equal(singlePt.singlePoint, true);
  assert.equal(singlePt.dailyAverage, null);

  // Mixed-source series: dailyAverage is null and segments are split when source changes
  const mixedSrc = fw.buildMemberSeries([
    { at: nowMs - 3 * 86400_000, source: 'rank_estimate', verified: false, total: 40_000_000 },
    { at: nowMs, source: 'ffscouter', verified: false, total: 52_000_000 },
  ], { metric: 'battlestats', statKey: 'total', rangeKey: '30d', nowMs });
  assert.equal(mixedSrc.dailyAverage, null, 'daily average must not be computed across different sources');
  assert.equal(mixedSrc.segments.length, 2, 'source switch must split chart segments');

  // N4 Tenure filter: new member (days=2 < 7d window) excluded from faction 7d totals and active rate denominator
  const statsView = fw.buildFactionStatsView({
    members: [
      { id: 1, name: 'Veteran', level: 80, position: 'Member', days: 100 },
      { id: 2, name: 'Newcomer', level: 60, position: 'Recruit', days: 2 },
    ],
    reportRows: [
      { id: 1, activity: 3600, xanax: 14, gym: 8000, crimes: 100, oc: 2 },
      { id: 2, activity: 7200, xanax: 20, gym: 12000, crimes: 200, oc: 1 },
    ],
    windowDays: 7,
    tenureFilter: true,
  });
  assert.equal(statsView.activeRate.totalMembers, 2);
  assert.equal(statsView.activeRate.excludedNewMembers, 1);
  assert.equal(statsView.activeRate.denominator, 1);
  assert.equal(statsView.totals.xanax, 14, 'new member prior-faction window stats must not inflate tenure-filtered faction total');

  // N4 Transfers: observation interval [seenFrom, seenTo] explicitly recorded
  const transfers = fw.detectRosterTransfers(
    [{ id: 1, name: 'Stay' }, { id: 2, name: 'Leaver', level: 45, position: 'Member', days: 12 }],
    [{ id: 1, name: 'Stay' }, { id: 3, name: 'Joiner', level: 50, position: 'Recruit', days: 0 }],
    { prevObservedAt: '2026-11-23T11:50:00.000Z', currObservedAt: '2026-11-23T11:55:00.000Z', factionId: 500 },
  );
  assert.equal(transfers.length, 2);
  const joined = transfers.find((t) => t.type === 'joined');
  const left = transfers.find((t) => t.type === 'left');
  assert.equal(joined.playerId, 3);
  assert.deepEqual(joined.observation_interval, { seenFrom: '2026-11-23T11:50:00.000Z', seenTo: '2026-11-23T11:55:00.000Z' });
  assert.equal(left.playerId, 2);
});

/* =========================================================
   7. Travel Profit review fixes (TCT times, planner route, ETA window, country cards, traffic, history, pins)
   ========================================================= */
const tw = require('../public/travel-workspace');
const planner = require('../public/travel-planner');

test('Fix 1: formatTct prints UTC (TCT) time and adds the date when the moment is not today', () => {
  const nowSec = Date.UTC(2026, 10, 23, 1, 30, 0) / 1000; // 01:30 TCT on 23 Nov
  assert.equal(tw.formatTct(Date.UTC(2026, 10, 23, 0, 5, 0) / 1000, { nowSec, lang: 'en' }), '00:05');
  assert.equal(tw.formatTct(Date.UTC(2026, 10, 23, 23, 59, 0) / 1000, { nowSec, lang: 'tr' }), '23:59');
  // Yesterday in TCT (would be "today" in a UTC+3 local clock) and an old flight-history row
  assert.equal(tw.formatTct(Date.UTC(2026, 10, 22, 22, 15, 0) / 1000, { nowSec, lang: 'en' }), '22 Nov 22:15');
  assert.equal(tw.formatTct(Date.UTC(2026, 8, 30, 8, 0, 0) / 1000, { nowSec, lang: 'tr' }), '30 Eyl 08:00');
  assert.equal(tw.formatTct(Date.UTC(2026, 10, 24, 6, 0, 0) / 1000, { nowSec, lang: 'en' }), '24 Nov 06:00');
  assert.equal(tw.formatTct(0, { nowSec }), '—');
  assert.equal(tw.formatTct(null, { nowSec }), '—');
});

test('Fix 2: buildDeparturePlan puts a chosen route first as the next feasible stop and reports when it cannot', () => {
  const nowSec = Date.UTC(2026, 10, 23, 10, 0, 0) / 1000;
  const countries = [
    { code: 'mex', name: 'Mexico', minutes: 26, items: [{ id: 1, name: 'Dahlia', type: 'Flower', cost: 300, market: 2600, qty: 5000 }] },
    { code: 'jap', name: 'Japan', minutes: 225, items: [{ id: 2, name: 'Cherry Blossom', type: 'Flower', cost: 500, market: 1800, qty: 0, nextRestock: nowSec + 5 * 3600, interval: 3600 }] },
    { code: 'can', name: 'Canada', minutes: 41, items: [{ id: 3, name: 'Junk', type: 'Other', cost: 900, market: 500, qty: 100 }] },
  ];
  const base = { countries, nowSec, cap: 10, method: 'Standard', optimizeFor: 'short_flights', category: 'Flower' };
  const plain = planner.buildDeparturePlan(base);
  assert.equal(plain.stops[0].key, 'mex:1');
  assert.equal(plain.preferred, null);

  // Japan is long (short_flights skips it) and waits > 95 min for its restock: chosen anyway, as the first stop
  const withJap = planner.buildDeparturePlan({ ...base, preferredKey: 'jap:2' });
  assert.equal(withJap.stops[0].key, 'jap:2');
  assert.equal(withJap.stops[0].preferred, true);
  assert.equal(withJap.stops[0].departAt, nowSec + 5 * 3600 - 225 * 60);
  assert.deepEqual({ key: withJap.preferred.key, status: withJap.preferred.status, stopIndex: withJap.preferred.stopIndex }, { key: 'jap:2', status: 'planned', stopIndex: 0 });
  assert.equal(withJap.nextFlight.key, 'jap:2');

  // A loss-making or unknown route is never forced into the plan
  const junk = planner.buildDeparturePlan({ ...base, category: 'all', preferredKey: 'can:3' });
  assert.equal(junk.preferred.status, 'unprofitable');
  assert.notEqual(junk.stops[0]?.key, 'can:3');
  assert.equal(planner.buildDeparturePlan({ ...base, preferredKey: 'uae:99' }).preferred.status, 'missing');

  // Sold out with no restock estimate: no window in the next 24 h
  const noWindow = planner.buildDeparturePlan({ ...base, preferredKey: 'jap:2', countries: [countries[0], { ...countries[1], items: [{ ...countries[1].items[0], nextRestock: null, interval: null }] }] });
  assert.equal(noWindow.preferred.status, 'no_window');
  assert.equal(noWindow.stops[0].key, 'mex:1');
});

test('Fix 2b: the planner knows the Private ticket (Torn and the Travel page call it Private, not WLT)', () => {
  const nowSec = Date.UTC(2026, 10, 23, 10, 0, 0) / 1000;
  const plan = planner.buildDeparturePlan({ countries: [{ code: 'mex', name: 'Mexico', minutes: 26, items: [{ id: 1, name: 'Dahlia', cost: 300, market: 2600, qty: 5000 }] }], nowSec, method: 'Private' });
  assert.equal(plan.stops[0].oneWaySec, 13 * 60);
});

test('Fix 3: an estimated flight ETA spans the fastest to the slowest ticket, an explicit ticket narrows it, and a window that is too wide is dropped', () => {
  const t0 = Date.UTC(2026, 10, 23, 10, 0, 0);
  const t1 = t0 + 5 * 60_000;
  const transition = { seenFromMs: t0, seenToMs: t1 };
  const mex = travelRadar.parseMemberTravel({ id: 1, status: { state: 'Traveling', description: 'Traveling to Mexico' } }, { transition });
  assert.equal(mex.etaKind, 'estimate');
  assert.equal(mex.etaFrom, travelRadar.isoUtc(t0 + Math.round(26 * 0.3 * 60_000)));
  assert.equal(mex.etaTo, travelRadar.isoUtc(t1 + 26 * 60_000));

  const exact = travelRadar.parseMemberTravel({ id: 1, status: { state: 'Traveling', description: 'Traveling to Mexico' } }, { transition, flightMultiplier: 0.7 });
  assert.equal(exact.etaFrom, travelRadar.isoUtc(t0 + Math.round(26 * 0.7 * 60_000)));
  assert.equal(exact.etaTo, travelRadar.isoUtc(t1 + Math.round(26 * 0.7 * 60_000)));

  // South Africa: 89 min (Business) .. 297 min (Standard) is wider than 3 h -> no window at all
  const sou = travelRadar.parseMemberTravel({ id: 2, status: { state: 'Traveling', description: 'Returning to Torn from South Africa' } }, { transition });
  assert.equal(sou.etaKind, 'unknown');
  assert.equal(sou.etaFrom, null);
  assert.equal(sou.etaTo, null);

  // The roster path (no ticket known) must not assume Standard either
  const snap1 = travelRadar.buildRadarPayload({ observedAtMs: t0, nowMs: t0, members: [{ id: 5, status: { state: 'Okay', description: 'Okay' } }] });
  const snap2 = travelRadar.buildRadarPayload({ observedAtMs: t1, nowMs: t1, prevByPlayer: snap1.nextByPlayer, prevObservedAtMs: t0, members: [{ id: 5, status: { state: 'Traveling', description: 'Traveling to Canada' } }] });
  const p5 = snap2.travel.find((r) => r.playerId === 5);
  assert.equal(p5.etaFrom, travelRadar.isoUtc(t0 + Math.round(41 * 0.3 * 60_000)));
  assert.equal(p5.etaTo, travelRadar.isoUtc(t1 + 41 * 60_000));
});

test('Fix 4: a country card shows the restock of its own item, is labelled by profitable stock, and an unobserved country is only Unknown', () => {
  const nowSec = 1800000000;
  const cards = tw.buildCountryCards([
    { code: 'can', name: 'Canada', minutes: 41, update: nowSec - 120, items: [
      { id: 206, name: 'Xanax', type: 'Drug', cost: 769000, market: 842000, qty: 0, nextRestock: nowSec + 5400 },
      { id: 263, name: 'Dahlia', type: 'Flower', cost: 300, market: 2600, qty: 2000, nextRestock: null },
    ] },
    { code: 'mex', name: 'Mexico', minutes: 26, update: nowSec - 120, items: [
      { id: 258, name: 'Jaguar Plushie', type: 'Plushie', cost: 10000, market: 18000, qty: 0, nextRestock: nowSec + 1800 },
      { id: 999, name: 'Old Junk', type: 'Other', cost: 900, market: 500, qty: 40, nextRestock: null },
    ] },
    { code: 'haw', name: 'Hawaii', minutes: 134, update: nowSec - 120, items: [
      { id: 1, name: 'Junk', type: 'Other', cost: 900, market: 500, qty: 40 },
    ] },
  ], { nowSec, capacity: 10 });
  const can = cards.find((c) => c.code === 'can');
  assert.equal(can.stockState, 'in_stock', 'another profitable item is in stock');
  assert.equal(can.bestItem.name, 'Dahlia', 'the card shows an item you can buy now');
  assert.equal(can.nextRestockSec, null, "never another item's restock");

  const mex = cards.find((c) => c.code === 'mex');
  assert.equal(mex.stockState, 'sold_out', 'the only stock left is loss-making');
  assert.equal(mex.bestItem.name, 'Jaguar Plushie');
  assert.equal(mex.nextRestockSec, nowSec + 1800);

  assert.equal(cards.find((c) => c.code === 'haw').stockState, 'no_profit');

  const arg = cards.find((c) => c.code === 'arg');
  assert.equal(arg.stockState, 'unknown');
  assert.equal(arg.stale, false, 'no observation is Unknown, never also Stale');

  // A focused item is judged on its own stock, profitable or not
  const focused = tw.buildCountryCards([{ code: 'can', name: 'Canada', minutes: 41, update: nowSec - 60, items: [
    { id: 206, name: 'Xanax', cost: 769000, market: 842000, qty: 0, nextRestock: nowSec + 5400 },
    { id: 263, name: 'Dahlia', cost: 300, market: 2600, qty: 2000 },
  ] }], { nowSec, itemId: 206 }).find((c) => c.code === 'can');
  assert.equal(focused.stockState, 'sold_out');
  assert.equal(focused.nextRestockSec, nowSec + 5400);
});

test('Fix 4b: destinations never call an unobserved country stale and never say fly now for sold-out stock with no known restock', () => {
  const nowSec = 1800000000;
  const rows = tw.buildDestinationsTable([
    { code: 'jap', name: 'Japan', minutes: 225, update: 0, items: [{ id: 277, name: 'Cherry Blossom', cost: 500, market: 5000, qty: 0 }] },
    { code: 'sou', name: 'South Africa', minutes: 297, update: nowSec - 4 * 3600, items: [{ id: 1, name: 'Elephant Statue', cost: 500, market: 9000, qty: 0 }] },
    { code: 'can', name: 'Canada', minutes: 41, update: nowSec - 60, items: [{ id: 263, name: 'Dahlia', cost: 300, market: 2600, qty: 2000 }] },
  ], { nowSec, capacity: 10 });
  const jap = rows.find((r) => r.countryCode === 'jap');
  assert.equal(jap.observed, false);
  assert.equal(jap.stale, false, 'never observed is not "stale"');
  assert.equal(jap.bestDepartureSec, null, 'sold out and no restock known: no departure time');
  const sou = rows.find((r) => r.countryCode === 'sou');
  assert.equal(sou.observed, true);
  assert.equal(sou.stale, true);
  assert.equal(sou.bestDepartureSec, null);
  assert.equal(rows.find((r) => r.countryCode === 'can').bestDepartureSec, nowSec, 'in stock: fly now');
});

test('Fix 5: block selection keeps an explicit empty choice and falls back to all blocks only when nothing was saved', () => {
  const all = ['summary', 'countries', 'traffic', 'history', 'planner', 'destinations'];
  assert.deepEqual([...tw.parseBlockPrefs(null, all)], all);
  assert.deepEqual([...tw.parseBlockPrefs('not json', all)], all);
  assert.deepEqual([...tw.parseBlockPrefs('[]', all)], []);
  assert.deepEqual([...tw.parseBlockPrefs('["history","bogus"]', all)], ['history']);
});

test('Fix 7: a pinned plan expires once its last return time has passed', () => {
  const nowSec = 1800000000;
  assert.equal(tw.pinnedPlanExpired(null, nowSec), false);
  assert.equal(tw.pinnedPlanExpired({ stops: [] }, nowSec), true);
  assert.equal(tw.pinnedPlanExpired({ stops: [{ returnAt: nowSec - 7200 }, { returnAt: nowSec - 60 }] }, nowSec), true);
  assert.equal(tw.pinnedPlanExpired({ stops: [{ returnAt: nowSec - 7200 }, { returnAt: nowSec + 60 }] }, nowSec), false);
});

test('Fix 8: the traffic chart draws a dot for a sample that has no neighbour', () => {
  const nowMs = 1800000000000;
  const snaps = [
    tw.buildTrafficSnapshot([{ playerId: 1, travelState: 'abroad', countryCode: 'mex' }], nowMs - 5 * 3600_000), // alone: gap > 25 min on both sides
    tw.buildTrafficSnapshot([{ playerId: 1, travelState: 'abroad', countryCode: 'mex' }], nowMs - 60 * 60_000),
    tw.buildTrafficSnapshot([{ playerId: 2, travelState: 'outbound', countryCode: 'mex' }, { playerId: 1, travelState: 'abroad', countryCode: 'mex' }], nowMs - 55 * 60_000),
  ];
  const tf = tw.summarizeTraffic(snaps, { windowHours: 6, nowMs });
  const chart = tw.buildTrafficChart(tf, { W: 680, H: 140, padL: 34, padR: 12, padT: 12, padB: 22 });
  assert.equal(chart.paths.length, 1, 'only the two-sample segment is a line');
  assert.equal(chart.dots.length, 1, 'the lone sample is a dot');
  assert.ok(chart.paths[0].startsWith('M') && chart.paths[0].includes('L'));
});

test('Fix 12: hospital and jail abroad are read from Torn demonyms and count as abroad', () => {
  const cases = [
    ['In a Swiss hospital for 20 mins', 'swi'],
    ['In a Caymanian hospital for 3 hrs', 'cay'],
    ['In an Emirati hospital for 1 hr 4 mins', 'uae'],
    ['In a Mexican hospital', 'mex'],
    ['In a Canadian hospital for 12 mins', 'can'],
    ['In a Hawaiian hospital for 2 mins', 'haw'],
    ['In a British hospital for 7 mins', 'uni'],
    ['In an Argentinian hospital for 9 mins', 'arg'],
    ['In a Japanese hospital for 44 mins', 'jap'],
    ['In a Chinese hospital for 1 min', 'chi'],
    ['In a South African hospital for 15 mins', 'sou'],
    ['In a Cayman Islands hospital', 'cay'],
    ['In hospital in South Africa', 'sou'],
  ];
  for (const [description, code] of cases) {
    const r = travelRadar.parseMemberTravel({ id: 1, status: { state: 'Hospital', description } });
    assert.equal(r.travelState, 'abroad', description);
    assert.equal(r.destination, code, description);
    assert.equal(r.healthStatus, 'hospital', description);
  }
  const jail = travelRadar.parseMemberTravel({ id: 1, status: { state: 'Jail', description: 'In a Mexican jail for 10 mins' } });
  assert.equal(jail.destination, 'mex');
  assert.equal(jail.healthStatus, 'jail');
  const home = travelRadar.parseMemberTravel({ id: 1, status: { state: 'Hospital', description: 'In hospital for 20 mins' } });
  assert.equal(home.travelState, 'none_observed', 'a hospital stay in Torn is not abroad');
  const payload = travelRadar.buildRadarPayload({ members: [{ id: 9, status: { state: 'Hospital', description: 'In an Emirati hospital for 5 mins' } }] });
  assert.equal(payload.summary.abroad, 1);
});

test('Fix 13: traffic counts an inbound member with an unknown origin once, and a single-country view has no global Unknown count', () => {
  const nowMs = 1800000000000;
  const snap = tw.buildTrafficSnapshot([
    { playerId: 1, travelState: 'inbound', origin: null, destination: 'torn' },
    { playerId: 2, travelState: 'unknown' },
    { playerId: 3, travelState: 'inbound', origin: 'mex', destination: 'torn' },
  ], nowMs);
  assert.equal(snap.total.inbound, 2);
  assert.equal(snap.total.unknown, 1, 'an inbound member is not also an unknown route');
  assert.equal(snap.byCountry.mex.inbound, 1);
  const all = tw.summarizeTraffic([snap], { countryCode: '*', windowHours: 6, nowMs });
  assert.equal(all.latest.unknown, 1);
  const mex = tw.summarizeTraffic([snap], { countryCode: 'mex', windowHours: 6, nowMs });
  assert.equal(mex.latest.unknown, null, 'unknown routes cannot be attributed to one country');
  // A snapshot saved by the old version (no v) counted that member twice; the summary takes it back out
  const old = { at: nowMs, total: { outbound: 0, abroad: 0, inbound: 2, unknown: 2 }, byCountry: { mex: { outbound: 0, abroad: 0, inbound: 1 } } };
  assert.equal(tw.summarizeTraffic([old], { countryCode: '*', windowHours: 6, nowMs }).latest.unknown, 1);
});

test('Fix 13b: history never invents a restock quantity and the stock view has no off-chart forecast', () => {
  const nowSec = 1800000000;
  const soldOut = { id: 2, name: 'Cherry', cost: 500, market: 1800, qty: 0, nextRestock: nowSec + 3600 };
  const noObs = tw.buildHistorySeries({ ...soldOut, history: [[nowSec - 1800, 0, 500, 'YATA']] }, { metric: 'forecast', windowHours: 6, nowSec });
  assert.equal(noObs.forecastPoints.length, 0, 'no observed restock size -> no forecast');
  const withObs = tw.buildHistorySeries({ ...soldOut, history: [
    [nowSec - 5 * 3600, 0, 500, 'YATA'], [nowSec - 4.5 * 3600, 37, 500, 'YATA'], [nowSec - 3600, 0, 500, 'YATA'],
  ] }, { metric: 'forecast', windowHours: 6, nowSec });
  assert.equal(withObs.forecastPoints.at(-1).v, 37, 'last observed restock size');
  assert.equal(withObs.forecastPoints.at(-1).t, nowSec + 3600);
  const stock = tw.buildHistorySeries({ ...soldOut, qty: 40, rate: 2, emptyAt: nowSec + 1200, history: [[nowSec - 600, 40, 500, 'YATA']] }, { metric: 'stock', windowHours: 6, nowSec });
  assert.equal(stock.forecastPoints.length, 0, 'the stock view ends at now');
});

test('Fix 9: groupRowsByCountry builds the By Country view in flight-time order and keeps the chosen sort inside a country', () => {
  const rows = [ // already sorted by the page (e.g. restock time)
    { c: { code: 'jap', name: 'Japan' }, oneWay: 225, perHour: 900 },
    { c: { code: 'mex', name: 'Mexico' }, oneWay: 26, perHour: 100 },
    { c: { code: 'jap', name: 'Japan' }, oneWay: 225, perHour: 500 },
    { c: { code: 'mex', name: 'Mexico' }, oneWay: 26, perHour: 300 },
  ];
  const groups = tw.groupRowsByCountry(rows);
  assert.deepEqual(groups.map((g) => g.code), ['mex', 'jap']);
  assert.deepEqual(groups[0].rows.map((r) => r.perHour), [100, 300]);
  assert.equal(groups[0].bestPerHour, 300);
  assert.equal(groups[1].bestPerHour, 900);
});

test('Country Cards: all 11 Torn travel destinations have valid SVG flag backdrops and CSS mappings', () => {
  const tw = require('../public/travel-workspace');
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
  assert.equal(tw.COUNTRY_ORDER.length, 11);
  for (const code of tw.COUNTRY_ORDER) {
    const svgPath = path.join(ROOT, 'public', 'flags', `${code}.svg`);
    assert.ok(fs.existsSync(svgPath), `Missing flag SVG for ${code}: ${svgPath}`);
    const svg = fs.readFileSync(svgPath, 'utf8');
    assert.ok(svg.includes('<svg') && svg.includes('</svg>'), `Invalid SVG content for ${code}`);
    assert.equal(/<script|onload=|onerror=/i.test(svg), false, `Flag SVG for ${code} must be static and script-free`);
    assert.ok(css.includes(`.tv-ccard[data-country="${code}"]`), `Missing CSS flag mapping for ${code}`);
    assert.ok(css.includes(`/flags/${code}.svg`), `Missing CSS URL for /flags/${code}.svg`);
  }
});
