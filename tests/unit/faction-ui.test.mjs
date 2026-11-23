import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FACTION_JS = fs.readFileSync(path.join(ROOT, 'public/faction.js'), 'utf8');
const WAR_PAYOUT_UI_JS = fs.readFileSync(path.join(ROOT, 'public/war-payout-ui.js'), 'utf8');
const fw = require('../../public/faction-workspace.js');
const travelRadar = require('../../public/travel-radar.js');

const NOW = Date.now();
const ago = (ms) => new Date(NOW - ms).toISOString();
const ahead = (ms) => new Date(NOW + ms).toISOString();
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- fixtures shaped like src/server/server.js returns them ---------- */
const ROSTER = [
  {
    id: 10, name: 'Hero', level: 80, position: 'Leader', days: 400, inOc: true, last: 300, lastRel: '1 minute ago', lastStatus: 'Online',
    state: 'Traveling', statusDesc: 'Traveling to Japan', travelState: 'outbound', destination: 'jap', origin: 'torn',
    battleStats: { source: 'ffscouter', verified: false, total: 500_000_000 },
    activity7d: 36_000, xanax7d: 12, gym7d: 9000, crimes7d: 40, oc7d: 1, activity30d: 90_000, xanax30d: 30, gym30d: 25_000,
  },
  {
    id: 11, name: 'Returner', level: 60, position: 'Member', days: 20, inOc: false, last: 200, lastRel: '2 hours ago', lastStatus: 'Idle',
    state: 'Okay', statusDesc: 'Okay', battleStats: { source: 'rank_estimate', verified: false, total: 2_500_000 },
    activity7d: 7200, xanax7d: 4, gym7d: 1000, activity30d: 20_000, xanax30d: 9, gym30d: 3000,
  },
  {
    id: 1001, name: 'Me', level: 70, position: 'Co-leader', days: 150, inOc: true, last: 100, lastRel: '5 minutes ago', lastStatus: 'Offline',
    state: 'Okay', statusDesc: 'Okay', battleStats: { source: 'torn_self', verified: true, total: 900_000_000, str: 200_000_000, spd: 250_000_000, dex: 200_000_000, def: 250_000_000 },
    activity7d: 18_000, xanax7d: 7, gym7d: 4000,
  },
];

function workspace() {
  return {
    factionId: 500,
    access: { inFaction: true, allowed: true },
    freshness: { source: 'torn_roster', observedAt: ago(90_000), receivedAt: ago(90_000), ageSec: 5, state: 'fresh' },
    coverage: { d7: { actualDays: 7, complete: true }, d30: { actualDays: 12, complete: false } },
    membersTable: fw.buildMembersTable({ members: ROSTER, hasOfficerAccess: true }),
    statsView: fw.buildFactionStatsView({
      members: ROSTER,
      reportRows: ROSTER.map((m) => ({ id: m.id, activity: m.activity30d ?? null, xanax: m.xanax30d ?? null, gym: m.gym30d ?? null, crimes: 10, oc: 1 })),
      windowDays: 30,
      tenureFilter: true,
      range: { from: '2026-11-10', to: '2026-11-22', complete: true, actualDays: 12 },
    }),
    gymView: fw.buildFactionGymView({ members: ROSTER, gymSnaps: { '2026-11-15': { 10: 1000, 11: 500 }, '2026-11-22': { 10: 5000, 11: 900 } }, windowDays: 7 }),
    bank: { allowed: true, status: 'ok', rows: [{ id: 10, name: 'Hero', inFaction: true, position: 'Leader', money: 1000, points: 5 }], totals: { money: 1000, points: 5, debtors: 0 } },
    recruitment: {
      allowed: true, status: 'error', error: 'Torn API is temporarily down', applications: [],
      watchlist: [
        { id: 'wl_1', playerId: 1, name: 'Legacy', tag: 'Takip', note: '', authorName: 'Officer', updatedAt: ago(3 * 86_400_000) },
        { id: 'wl_2', playerId: 2, name: 'Fresh', tag: '', note: 'maybe', authorName: '', updatedAt: ago(60_000) },
      ],
    },
    transfers: {
      entries: [{ id: 't1', type: 'joined', playerId: 3, name: 'Joiner', level: 20, position: 'Recruit', observation_interval: { seenFrom: ago(3 * 86_400_000 + 300_000), seenTo: ago(3 * 86_400_000) } }],
    },
    alliance: {
      alliances: [{ id: 'al_1', name: 'Friends', tag: 'FR', relation: 'ally', note: '', authorName: '', updatedAt: ago(60_000) }],
      graffiti: [
        { id: 'gf_1', text: 'Chain at 18:00', category: 'Genel', authorName: 'Officer', createdAt: ago(60_000) },
        { id: 'gf_2', text: 'Hold', category: '', authorName: '', createdAt: ago(60_000) },
      ],
    },
    at: NOW,
  };
}

const RADAR_ROWS = [
  { playerId: 10, displayName: 'Hero', level: 80, position: 'Leader', travelState: 'outbound', origin: 'torn', destination: 'jap', activityStatus: 'Online', healthStatus: 'okay', etaKind: 'estimate', etaFrom: ahead(40 * 60_000), etaTo: ahead(45 * 60_000), etaAt: null },
];

function activity(extra = {}) {
  return {
    factionId: 500,
    sourceMode: 'local',
    freshness: { source: 'torn_roster', observedAt: ago(30_000), receivedAt: ago(30_000), ageSec: 30, state: 'fresh' },
    travel: RADAR_ROWS,
    travelSummary: { outbound: 1, abroad: 0, inbound: 0, unknown: 0, totalTravel: 1 },
    transitions: [],
    members: ROSTER.map(({ id, name, level, position, days, inOc, last, lastRel, lastStatus, state }) => ({ id, name, level, position, days, inOc, last, lastRel, lastStatus, state })),
    counts: { total: 3, online: 1, idle: 1, offline: 1, okay: 2, hospital: 0, traveling: 1, abroad: 0, jail: 0, inOc: 2 },
    heatmap: { grid: [], maxAvg: 0, totalSamples: 0 },
    timeline: [],
    ...extra,
  };
}

// The hub /status reply: travel rows and a thin member list without days/last, partial counts.
const SHARED = {
  factionId: 500,
  sourceMode: 'shared',
  freshness: { source: 'shared_hub', observedAt: ago(60_000), receivedAt: ago(60_000), ageSec: 60, state: 'fresh' },
  travel: [{ playerId: 11, displayName: 'Returner', travelState: 'inbound', origin: 'mex', destination: 'torn', activityStatus: 'Idle', healthStatus: 'okay', etaKind: 'unknown' }],
  travelSummary: { outbound: 0, abroad: 0, inbound: 1, unknown: 0, totalTravel: 1 },
  members: [{ id: 11, name: 'Returner', level: 60, position: 'Member', lastStatus: 'Idle', state: 'Traveling' }],
  counts: { total: 3, online: 1 },
  heatmap: { grid: [], maxAvg: 0, totalSamples: 0 },
  timeline: [],
};

const TRAVEL_SERIES = {
  playerId: 10,
  metric: 'travel',
  transitions: [
    { id: 'd', fromState: 'inbound', toState: 'none_observed', destination: null, origin: null, seenFrom: ago(65 * 60_000), seenTo: ago(60 * 60_000) },
    { id: 'c', fromState: 'abroad', toState: 'inbound', destination: 'torn', origin: 'jap', seenFrom: ago(4 * 3600_000), seenTo: ago(4 * 3600_000 - 300_000) },
    { id: 'b', fromState: 'outbound', toState: 'abroad', destination: 'jap', origin: null, seenFrom: ago(8 * 3600_000), seenTo: ago(8 * 3600_000 - 300_000) },
    { id: 'a', fromState: 'none_observed', toState: 'outbound', destination: 'jap', origin: 'torn', seenFrom: ago(12 * 3600_000), seenTo: ago(12 * 3600_000 - 300_000) },
  ],
};

const BS_SERIES = {
  playerId: 10,
  ...fw.buildMemberSeries([
    { at: NOW - 10 * 86_400_000, source: 'ffscouter', total: 400_000_000 },
    { at: NOW, source: 'ffscouter', total: 500_000_000 },
  ], { metric: 'battlestats', statKey: 'total', rangeKey: '30d', nowMs: NOW }),
};

/* ---------- a fake DOM target for the delegated listeners ---------- */
function matches(el, sel) {
  return sel.split(',').some((part) => {
    const s = part.trim();
    let m = /^#([\w-]+)$/.exec(s);
    if (m) return el.id === m[1];
    m = /^(\w+)?\[data-([\w-]+)\]$/.exec(s);
    if (m) {
      const key = m[2].replace(/-(\w)/g, (_, c) => c.toUpperCase());
      return (!m[1] || el.tagName === m[1].toUpperCase()) && Object.prototype.hasOwnProperty.call(el.dataset, key);
    }
    return false;
  });
}
function target(props = {}) {
  const el = { id: '', value: '', tagName: 'BUTTON', dataset: {}, ...props };
  el.closest = (sel) => (matches(el, sel) ? el : null);
  return el;
}

/* ---------- loads public/faction.js with the app.js globals it uses ---------- */
function harness(lang = 'en', opts = {}) {
  const listeners = {};
  const body = {
    innerHTML: '',
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    contains: () => false,
    querySelector: () => null,
  };
  const store = new Map(Object.entries(opts.storage || {}));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  const intervals = [];
  const calls = [];
  const toasts = [];
  const notes = [];
  const data = { ws: workspace(), activity: activity(), shared: clone(SHARED), series: TRAVEL_SERIES, ...(opts.data || {}) };
  const api = async (url, o = {}) => {
    const body = o.body ? JSON.parse(o.body) : null;
    calls.push({ url, method: o.method || 'GET', body });
    if (opts.api) {
      const r = await opts.api(url, o, body, calls);
      if (r !== undefined) return r;
    }
    if (url.startsWith('/api/faction/activity')) return clone(url.includes('source=shared') ? data.shared : data.activity);
    if (url.startsWith('/api/faction/workspace')) {
      if (o.method === 'POST') {
        const ws = data.ws;
        if (body.action.startsWith('watchlist')) return { ok: true, watchlist: ws.recruitment.watchlist };
        if (body.action.startsWith('alliance')) return { ok: true, alliances: ws.alliance.alliances };
        return { ok: true, graffiti: ws.alliance.graffiti };
      }
      return clone(data.ws);
    }
    if (url.startsWith('/api/faction/members/')) return clone(data.series);
    if (url.startsWith('/api/faction/report')) return { job: { running: false }, rows: [], boards: {} };
    if (url.startsWith('/api/faction')) {
      return {
        access: { inFaction: true, allowed: false, role: 'co-leader', faction: { name: 'LRX', tag: 'LRX' }, position: 'Co-leader', members: 3 },
        myOc: { inOc: false },
      };
    }
    return {};
  };
  const ctx = {
    console, Date, Math, Number, String, Array, Object, Map, Set, JSON, Promise, Boolean, Intl, isNaN,
    document: { activeElement: null, hidden: false, querySelectorAll: () => [], getElementById: () => null },
    localStorage,
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    setTimeout: () => 0,
    clearTimeout() {},
    I18N: {}, VIEW_META: {}, EXTRA_LOADERS: {}, FEATURE_HOOKS: [],
    state: { view: 'faction', lang, skew: 0, overview: { player: { id: 1001, name: 'Me', faction: { faction_id: 500 } } } },
    $: (sel) => (sel === '#faction-body' ? body : null),
    esc,
    tr: (a, b) => (lang === 'en' ? b : a),
    feat: () => true,
    viewHidden: () => false,
    lsGet: (_k, d) => d,
    lsSet() {},
    lsList: () => [],
    nowTct: () => NOW,
    n0: (v) => (v == null || Number.isNaN(Number(v)) ? '—' : Math.round(v).toLocaleString('en-US')),
    money: (v) => `$${v}`,
    compact: (x) => String(x),
    human: (s) => `${Math.max(0, Math.floor(s / 60))}m`,
    kpi: (l, v, h = '') => `<div class="kpi">${l}:${v}:${h}</div>`,
    loadingBox: () => '<div class="loading"></div>',
    errorBox: (e) => `<div class="err">${esc(e?.message || e)}</div>`,
    emptyBox: (t, b) => `<div class="empty">${t}|${b}</div>`,
    trackerVisible: () => true,
    applyLang() {},
    applyFeatures() {},
    notify: (key, title, body) => { notes.push({ key, title, body }); },
    toast: (msg) => { toasts.push(msg); },
    showView() {},
    openInTab() {},
    api,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.LRXTravelRadar = travelRadar;
  ctx.LRXFactionTools = require('../../public/faction-tools.js');
  ctx.LRXFactionWorkspace = fw;
  vm.createContext(ctx);
  vm.runInContext(FACTION_JS, ctx);

  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
  const fac = ctx.lrxFaction;
  return {
    ctx, fac, calls, toasts, notes, store, data,
    html: () => body.innerHTML,
    load: async (tab) => { if (tab) fac.tab = tab; await ctx.EXTRA_LOADERS.faction(); await flush(); },
    fire: async (type, t) => {
      for (const fn of listeners[type] || []) await fn({ type, target: t, key: t.key, preventDefault() {}, stopPropagation() {} });
      await flush();
    },
    tick: async (ms) => { for (const it of intervals.filter((x) => x.ms === ms)) it.fn(); await flush(); },
    count: (prefix) => calls.filter((c) => c.url.startsWith(prefix)).length,
  };
}

/* =========================================================
   #1 Member drawer: Travel Transitions
   ========================================================= */
describe('member drawer travel transitions', () => {
  it('shows the real route and translated states in English', async () => {
    const h = harness('en');
    h.fac.openMemberId = 10;
    h.fac.memMetric = 'travel';
    await h.load('members');
    const html = h.html();
    expect(html).toContain('Torn → Japan');
    expect(html).toContain('Japan → Torn');
    expect(html).toMatch(/Outbound → Abroad|Abroad → Inbound/);
    expect(html).toContain('In Torn');
    expect(html).not.toContain('none_observed');
    expect(html).not.toMatch(/>\s*outbound\s*→/);
  });

  it('shows Turkish state names in Turkish', async () => {
    const h = harness('tr');
    h.fac.openMemberId = 10;
    h.fac.memMetric = 'travel';
    await h.load('members');
    const html = h.html();
    expect(html).toContain('Gidiş');
    expect(html).toContain('Dönüş');
    expect(html).not.toContain('none_observed');
    expect(html).not.toMatch(/Outbound|Inbound|In Torn/);
  });
});

/* =========================================================
   #3 Radar auto-refresh on the 2-minute loop
   ========================================================= */
describe('radar refresh loop', () => {
  it('refetches the radar every 2 minutes while the Faction page is shown', async () => {
    const h = harness('en');
    await h.load('radar');
    const before = h.count('/api/faction/activity');
    expect(before).toBe(1);
    await h.tick(120_000);
    expect(h.count('/api/faction/activity')).toBe(2);
  });

  it('fires the travel radar notification from a periodic refresh', async () => {
    let n = 0;
    const h = harness('en', {
      api: (url) => {
        if (!url.startsWith('/api/faction/activity')) return undefined;
        n++;
        return n === 1 ? activity() : activity({
          transitions: [{ transitionId: '11:abroad->inbound:mex:1', playerId: 11, fromState: 'abroad', toState: 'inbound', origin: 'mex', destination: 'torn', seenFrom: ago(120_000), seenTo: ago(0) }],
        });
      },
    });
    await h.load('radar');
    expect(h.notes).toHaveLength(0);
    await h.tick(120_000);
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0].body).toContain('Mexico');
  });

  it('also refreshes the Activity tab on the loop', async () => {
    const h = harness('en');
    await h.load('activity');
    await h.tick(120_000);
    expect(h.count('/api/faction/activity')).toBe(2);
  });

  it('prunes old radar notification keys when writing a new one', async () => {
    const h = harness('en', {
      storage: { 'lrx.radar.old': String(NOW - 3 * 86_400_000), 'lrx.radar.recent': String(NOW - 3600_000), 'lrx.oc.prev': 'none' },
      data: { activity: activity({ transitions: [{ transitionId: 'x1', playerId: 11, fromState: 'abroad', toState: 'inbound', origin: 'mex', destination: 'torn' }] }) },
    });
    await h.load('radar');
    expect(h.store.has('lrx.radar.x1')).toBe(true);
    expect(h.store.has('lrx.radar.old')).toBe(false);
    expect(h.store.has('lrx.radar.recent')).toBe(true);
    expect(h.store.get('lrx.oc.prev')).toBe('none');
  });
});

/* =========================================================
   #4 Drafts survive re-renders
   ========================================================= */
describe('form drafts', () => {
  it('keeps the watchlist draft through the 60 s tick and the 2-minute reload, then sends it', async () => {
    const h = harness('en');
    await h.load('recruitment');
    await h.fire('input', target({ id: 'fac-wl-id', tagName: 'INPUT', value: '42' }));
    await h.fire('input', target({ id: 'fac-wl-name', tagName: 'INPUT', value: 'Bob "the" <b>' }));
    await h.fire('input', target({ id: 'fac-wl-note', tagName: 'INPUT', value: 'Good hitter' }));
    await h.tick(60_000);
    await h.tick(120_000);
    const html = h.html();
    expect(html).toContain('value="42"');
    expect(html).toContain(`value="${esc('Bob "the" <b>')}"`);
    expect(html).toContain('value="Good hitter"');
    await h.fire('click', target({ id: 'fac-wl-add' }));
    const post = h.calls.find((c) => c.body?.action === 'watchlist_add');
    expect(post.body).toMatchObject({ playerId: 42, name: 'Bob "the" <b>', tag: '', note: 'Good hitter' });
    expect(h.html()).not.toContain('value="Good hitter"');
  });

  it('keeps the alliance and graffiti drafts, including the relation', async () => {
    const h = harness('en');
    await h.load('alliance');
    await h.fire('input', target({ id: 'fac-al-name', tagName: 'INPUT', value: 'Allies' }));
    await h.fire('change', target({ id: 'fac-al-rel', tagName: 'SELECT', value: 'rival' }));
    await h.fire('input', target({ id: 'fac-gf-text', tagName: 'INPUT', value: 'Hold the line' }));
    await h.tick(60_000);
    await h.tick(120_000);
    const html = h.html();
    expect(html).toContain('value="Allies"');
    expect(html).toMatch(/<option value="rival" selected/);
    expect(html).toContain('value="Hold the line"');
    await h.fire('click', target({ id: 'fac-gf-add' }));
    const post = h.calls.find((c) => c.body?.action === 'graffiti_add');
    expect(post.body).toMatchObject({ category: '', text: 'Hold the line' });
  });
});

/* =========================================================
   #5 Failed applications call
   ========================================================= */
describe('recruitment errors', () => {
  it('shows the error instead of "no pending applications"', async () => {
    const h = harness('en');
    await h.load('recruitment');
    expect(h.html()).toContain('Torn API is temporarily down');
    expect(h.html()).not.toContain('No pending faction applications');
  });

  it('escapes the error text', async () => {
    const ws = workspace();
    ws.recruitment.error = '<img src=x>';
    const h = harness('tr', { data: { ws } });
    await h.load('recruitment');
    expect(h.html()).not.toContain('<img src=x>');
    expect(h.html()).toContain('&lt;img src=x&gt;');
  });
});

/* =========================================================
   #6 Shared source never leaks into Activity
   ========================================================= */
describe('shared radar source', () => {
  it('keeps the Activity tab on local data with no "undefined"', async () => {
    const h = harness('en');
    await h.load('radar');
    await h.fire('click', target({ dataset: { facRadSrc: 'shared' } }));
    expect(h.calls.some((c) => c.url.includes('source=shared'))).toBe(true);
    expect(h.html()).toContain('Returner');
    await h.fire('click', target({ dataset: { facTab: 'activity' } }));
    const html = h.html();
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
    expect(html).toContain('Hero');
  });

  it('never prints undefined even for a thin member list', async () => {
    const h = harness('tr', { data: { activity: { ...clone(SHARED), sourceMode: 'local' } } });
    await h.load('activity');
    expect(h.html()).not.toContain('undefined');
    expect(h.html()).not.toContain('NaN');
  });
});

/* =========================================================
   #7 Battle stat provenance in the table and drawer
   ========================================================= */
describe('battle stat provenance', () => {
  it('labels the rank estimate as a rough estimate', async () => {
    const h = harness('en');
    h.fac.openMemberId = 11;
    h.fac.memMetric = 'battlestats';
    await h.load('members');
    expect(h.html()).toContain('Rough estimate (from rank)');
    expect(h.html()).toContain('Estimate (FFScouter)');
  });
});

/* =========================================================
   #8 Window coverage
   ========================================================= */
describe('window coverage', () => {
  it('labels the members 30-day columns with the real days', async () => {
    const h = harness('en');
    h.fac.memCols.add('xanax30d');
    await h.load('members');
    expect(h.html()).toContain('30d (12d data)');
  });

  it('labels the Stats tab with the real days in both languages', async () => {
    const en = harness('en');
    await en.load('stats');
    expect(en.html()).toContain('30d (12d data)');
    const trh = harness('tr');
    await trh.load('stats');
    expect(trh.html()).toContain('30g (12g veri)');
  });
});

/* =========================================================
   #9 Bilingual
   ========================================================= */
describe('bilingual labels', () => {
  it('uses English column headers in English', async () => {
    const h = harness('en');
    await h.load('members');
    const html = h.html();
    expect(html).toContain('7d Xanax');
    expect(html).toContain('7d Gym E');
    expect(html).not.toMatch(/>7g /);
  });

  it('uses a per-day suffix that fits the language', async () => {
    const en = harness('en', { data: { series: BS_SERIES } });
    en.fac.openMemberId = 10;
    en.fac.memMetric = 'battlestats';
    await en.load('members');
    expect(en.html()).toMatch(/\/day</);
    expect(en.html()).not.toMatch(/\d\/g</);
    const trh = harness('tr', { data: { series: BS_SERIES } });
    trh.fac.openMemberId = 10;
    trh.fac.memMetric = 'battlestats';
    await trh.load('members');
    expect(trh.html()).toMatch(/\/gün</);
  });

  it('translates default and legacy watchlist, category and author labels', async () => {
    const en = harness('en');
    await en.load('recruitment');
    expect(en.html()).toContain('Watching');
    expect(en.html()).not.toContain('Takip');
    expect(en.html()).not.toContain('>Officer<'.replace('Officer', 'Yetkili'));
    await en.load('alliance');
    expect(en.html()).toContain('General');
    expect(en.html()).not.toContain('Genel');
    expect(en.html()).toContain('Officer');

    const trh = harness('tr');
    await trh.load('recruitment');
    expect(trh.html()).toContain('Takip');
    await trh.load('alliance');
    expect(trh.html()).toContain('Genel');
    expect(trh.html()).toContain('Yetkili');
    expect(trh.html()).not.toContain('Officer');
  });

  it('keeps the Activity sort and header suffix in Turkish', async () => {
    const h = harness('tr');
    h.fac.rep = { rows: [{ id: 10, activity: 100, xanax: 1, gym: 2 }], job: {}, boards: {} };
    await h.load('activity');
    expect(h.html()).not.toMatch(/\(7d\)/);
  });
});

/* =========================================================
   #11 Delete handlers
   ========================================================= */
describe('delete handlers', () => {
  for (const [tab, attr] of [['recruitment', 'facWlDel'], ['alliance', 'facAlDel'], ['alliance', 'facGfDel']]) {
    it(`toasts instead of an unhandled rejection (${attr})`, async () => {
      const h = harness('en', { api: (url, o, body) => (body?.action?.endsWith('_remove') ? Promise.reject(new Error('Server said no')) : undefined) });
      await h.load(tab);
      await expect(h.fire('click', target({ dataset: { [attr]: 'x1' } }))).resolves.toBeUndefined();
      expect(h.toasts).toContain('Server said no');
    });
  }
});

/* =========================================================
   #12 Local-only wording
   ========================================================= */
describe('alliance and graffiti wording', () => {
  it('says the notes stay on this computer', async () => {
    const en = harness('en');
    await en.load('alliance');
    expect(en.html()).toMatch(/only on this computer/);
    expect(en.html()).not.toMatch(/Shared Note Wall|team-managed|Team Record/i);
    const trh = harness('tr');
    await trh.load('alliance');
    expect(trh.html()).toMatch(/yalnızca bu bilgisayarda/);
    expect(trh.html()).not.toMatch(/Ortak Not Duvarı|Ekip Kaydı/);
  });
});

/* =========================================================
   Unconfirmed items
   ========================================================= */
describe('status bar and dates', () => {
  it('counts data age from the observation time, not the fetch-time age', async () => {
    const h = harness('en');
    await h.load('stats');
    expect(h.html()).toMatch(/Data age:<\/b> 1m ago/);
  });

  it('adds the date to a transfer from another day', async () => {
    const h = harness('en');
    await h.load('transfers');
    const day = new Date(NOW - 3 * 86_400_000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    expect(h.html()).toContain(day);
  });

  it('uses styled controls in the members toolbar', async () => {
    const h = harness('en');
    await h.load('members');
    expect(h.html()).toContain('class="fac-toolbar"');
    expect(h.html()).not.toMatch(/class="btn sm ghost( active)?" data-fac-mf/);
  });
});

/* =========================================================
   #9 War payout chip in Turkish
   ========================================================= */
describe('war payout score chip', () => {
  function payoutHarness(lang) {
    const box = { innerHTML: '', hidden: false, addEventListener() {} };
    const api = async (url) => {
      if (url.startsWith('/api/war/rankedwars')) return { wars: [{ id: 77, oppName: 'Rivals', myScore: 10, oppScore: 5, start: 1_700_000_000 }] };
      if (url.startsWith('/api/war/payout')) {
        return { myFactionId: 1, factions: [
          { id: 1, name: 'Us', score: 10, attacks: 3, members: [{ id: 5, name: 'A', attacks: 3, score: 10 }] },
          { id: 2, name: 'Them', score: 5, attacks: 2, members: [] },
        ] };
      }
      return {};
    };
    const ctx = {
      console, Date, Math, Number, String, Array, Object, Map, Set, JSON, Promise, Boolean,
      state: { lang, view: 'war' }, FEATURE_HOOKS: [], document: { getElementById: () => null },
      $: (sel) => (sel === '#war-payout-card' ? box : null),
      lsGet: (_k, d) => d, lsSet() {}, feat: () => true, tr: (a, b) => (lang === 'en' ? b : a), esc,
      n0: (v) => String(v), money: (v) => `$${v}`, kpi: (l, v) => `${l}${v}`,
      loadingBox: () => '', errorBox: () => '', emptyBox: () => '', toast() {}, showView() {}, api,
      setTimeout: () => 0,
    };
    ctx.window = ctx;
    ctx.LRXWarPayout = require('../../public/war-payout.js');
    vm.createContext(ctx);
    vm.runInContext(WAR_PAYOUT_UI_JS, ctx);
    return { ctx, box };
  }

  it('says Savaş in Turkish and War in English', async () => {
    const t = payoutHarness('tr');
    await t.ctx.openWarPayout(77);
    expect(t.box.innerHTML).toContain('Savaş #77');
    expect(t.box.innerHTML).not.toContain('War #77');
    const e = payoutHarness('en');
    await e.ctx.openWarPayout(77);
    expect(e.box.innerHTML).toContain('War #77');
  });
});

/* =========================================================
   Final server contract: factionless player, access errors, travel ETA, gym coverage
   ========================================================= */
const EMPTY_RANGE = { from: null, to: null, complete: false, actualDays: 0 };
function notInFactionWorkspace(error = 'You are not in a faction.') {
  const notIn = { allowed: false, status: 'not_in_faction' };
  return {
    factionId: null, notInFaction: true, code: 'NOT_IN_FACTION', error,
    access: { inFaction: false, allowed: false }, freshness: null,
    coverage: { d7: { actualDays: 0, complete: false }, d30: { actualDays: 0, complete: false } },
    membersTable: fw.buildMembersTable({ members: [] }),
    statsView: fw.buildFactionStatsView({ members: [], reportRows: [], windowDays: 7, tenureFilter: true, range: EMPTY_RANGE }),
    gymView: fw.buildFactionGymView({ members: [], gymSnaps: {}, windowDays: 7 }),
    bank: { ...notIn, rows: [], totals: { money: 0, points: 0, debtors: 0 } },
    recruitment: { ...notIn, applications: [], watchlist: [] },
    transfers: { entries: [] },
    alliance: { alliances: [], graffiti: [] },
    at: NOW,
  };
}
function notInFactionActivity(error = 'You are not in a faction.') {
  return {
    factionId: null, notInFaction: true, code: 'NOT_IN_FACTION', error, sourceMode: 'local', freshness: null,
    travel: [], travelSummary: { outbound: 0, abroad: 0, inbound: 0, unknown: 0, totalTravel: 0 }, transitions: [],
    members: [], counts: { total: 0, online: 0, idle: 0, offline: 0 }, heatmap: { grid: [], maxAvg: 0, totalSamples: 0 }, timeline: [],
  };
}

describe('factionless player', () => {
  it('shows the server message on every workspace tab instead of empty tables', async () => {
    for (const tab of ['members', 'stats', 'gym', 'bank', 'recruitment', 'transfers', 'alliance']) {
      const h = harness('en', { data: { ws: notInFactionWorkspace() } });
      await h.load(tab);
      const html = h.html();
      expect(html, tab).toContain('You are not in a faction.');
      expect(html, tab).not.toContain('undefined');
      expect(html, tab).not.toContain('<table');
      expect(html, tab).not.toContain('Permission required');
    }
  });

  it('shows the server message on the Activity and Radar tabs', async () => {
    for (const tab of ['activity', 'radar']) {
      const h = harness('tr', { data: { activity: notInFactionActivity("Bir faction'da değilsin.") } });
      await h.load(tab);
      const html = h.html();
      expect(html, tab).toContain('Bir faction&#39;da değilsin.');
      expect(html, tab).not.toContain('undefined');
      expect(html, tab).not.toContain('NaN');
    }
  });

  it('escapes the server message', async () => {
    const h = harness('en', { data: { ws: notInFactionWorkspace('<b>x</b>') } });
    await h.load('members');
    expect(h.html()).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('bank and recruitment access states', () => {
  it('shows a failed permission check as an error, not as a missing permission', async () => {
    const ws = workspace();
    ws.bank = { allowed: false, status: 'error', error: 'Your faction permissions could not be checked right now.', rows: [], totals: {} };
    ws.recruitment = { ...ws.recruitment, allowed: false, status: 'error', error: 'Your faction permissions could not be checked right now.' };
    for (const tab of ['bank', 'recruitment']) {
      const h = harness('en', { data: { ws } });
      await h.load(tab);
      expect(h.html(), tab).toContain('could not be checked right now');
      expect(h.html(), tab).not.toContain('Permission required');
    }
  });

  it('keeps the permission notice for permission_required', async () => {
    const ws = workspace();
    ws.bank = { allowed: false, status: 'permission_required', rows: [], totals: {} };
    const h = harness('en', { data: { ws } });
    await h.load('bank');
    expect(h.html()).toContain('Permission required');
  });
});

describe('unknown faction membership', () => {
  const facReply = (access) => (url) => (url === '/api/faction' || url.startsWith('/api/faction?') ? { access, myOc: { inOc: false } } : undefined);

  it('shows the access error, never "not in a faction"', async () => {
    const h = harness('en', { api: facReply({ inFaction: null, allowed: false, apiAccess: null, error: 'The Torn connection timed out.', errorCode: null }) });
    await h.load('oc');
    expect(h.html()).toContain('The Torn connection timed out.');
    expect(h.html()).not.toContain('You are not in a faction');
  });

  it('says the membership could not be checked when there is no error text', async () => {
    const h = harness('en', { api: facReply({ inFaction: null, allowed: false, apiAccess: null }) });
    await h.load('oc');
    expect(h.html()).not.toContain('You are not in a faction');
    expect(h.html()).toContain('could not be checked');
  });
});

describe('members travel tag from server rows', () => {
  function wsWith(member) {
    const ws = workspace();
    ws.membersTable = fw.buildMembersTable({ members: [member], hasOfficerAccess: true });
    return ws;
  }
  const base = { id: 20, name: 'Flyer', level: 30, position: 'Member', days: 50, last: 100, lastStatus: 'Online', state: 'Traveling' };

  it('marks an estimated arrival with ~ and names the country', async () => {
    const h = harness('en', { data: { ws: wsWith({ ...base, travelState: 'inbound', countryCode: 'mex', country: 'Mexico', etaSec: 600, etaSource: 'estimate' }) } });
    await h.load('members');
    expect(h.html()).toMatch(/Mexico<\/span> \(~\d+m\)/);
  });

  it('shows an exact arrival without ~', async () => {
    const h = harness('en', { data: { ws: wsWith({ ...base, travelState: 'outbound', countryCode: 'jap', country: 'Japan', etaSec: 1200, etaSource: 'exact' }) } });
    await h.load('members');
    expect(h.html()).toMatch(/Japan<\/span> \(\d+m\)/);
  });

  it('shows a member abroad without an arrival time', async () => {
    const h = harness('tr', { data: { ws: wsWith({ ...base, state: 'Abroad', travelState: 'abroad', countryCode: 'uni', country: 'United Kingdom', etaSec: null, etaSource: 'none' }) } });
    await h.load('members');
    expect(h.html()).toMatch(/United Kingdom<\/span><\/span>/);
  });
});

describe('last seen in the UI language', () => {
  const tenMin = Math.floor(NOW / 1000) - 600;
  const member = { id: 30, name: 'Seen', level: 20, position: 'Member', days: 9, last: tenMin, lastRel: '10 minutes ago', lastStatus: 'Idle', state: 'Okay' };

  it('turns the Torn timestamp into Turkish text on the Members and Activity tabs', async () => {
    const ws = workspace();
    ws.membersTable = fw.buildMembersTable({ members: [member] });
    const h = harness('tr', { data: { ws, activity: activity({ members: [member] }) } });
    await h.load('members');
    expect(h.html()).toContain('10 dk önce');
    expect(h.html()).not.toContain('minutes ago');
    await h.fire('click', target({ dataset: { facTab: 'activity' } }));
    expect(h.html()).toContain('10 dk önce');
    expect(h.html()).not.toContain('minutes ago');
  });

  it('uses the radar member\'s timestamp from the roster', async () => {
    const row = { ...RADAR_ROWS[0], playerId: 30, displayName: 'Seen', lastRel: '10 minutes ago' };
    const h = harness('tr', { data: { activity: activity({ members: [member], travel: [row] }) } });
    await h.load('radar');
    expect(h.html()).toContain('10 dk önce');
    expect(h.html()).not.toContain('minutes ago');
  });

  it('keeps English wording in English', async () => {
    const ws = workspace();
    ws.membersTable = fw.buildMembersTable({ members: [member] });
    const h = harness('en', { data: { ws } });
    await h.load('members');
    expect(h.html()).toContain('10 minutes ago');
  });
});

describe('percent signs follow the language', () => {
  it('writes 50% in English and %50 in Turkish', async () => {
    const en = harness('en');
    await en.load('stats');
    expect(en.html()).not.toMatch(/>%\d/);
    expect(en.html()).toMatch(/\d%</);
    const trh = harness('tr');
    await trh.load('stats');
    expect(trh.html()).toMatch(/>%\d/);
  });
});

describe('gym column coverage', () => {
  it('labels the gym columns with the gym history days', async () => {
    const ws = workspace();
    ws.coverage = { d7: { actualDays: 7, complete: true, gymActualDays: 3, gymComplete: false }, d30: { actualDays: 12, complete: false, gymActualDays: 0, gymComplete: false } };
    const h = harness('en', { data: { ws } });
    for (const c of ['xanax7d', 'gym7d', 'gym30d']) h.fac.memCols.add(c);
    await h.load('members');
    const html = h.html();
    expect(html).toContain('>7d Xanax<');
    expect(html).toContain('>7d (3d data) Gym E<');
    expect(html).toContain('>30d (no data) Gym E<');
  });
});
