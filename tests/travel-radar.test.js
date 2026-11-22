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

  // Snapshot 2: Player 11 transitions Okay -> Traveling to Japan (225 min standard)
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
  assert.equal(p11s2.etaFrom, travelRadar.isoUtc(t0 + 225 * 60_000));
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

    // Ops Control Panel renders all 4 panels with masked key
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
