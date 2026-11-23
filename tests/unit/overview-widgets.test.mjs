import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'public/overview-widgets.js'), 'utf8');

// Loads overview-widgets.js the way index.html does, with the app.js helpers it reads at call time.
function load(lang = 'en', { playerId = 1001, api } = {}) {
  const listeners = {};
  const calls = [];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ctx = {
    console, Date, Math, Number, String, Array, Object, Map, Set, JSON, Promise, Boolean,
    state: { lang, overview: { player: { id: playerId } } },
    tr: (a, b) => (lang === 'en' ? b : a),
    esc,
    n0: (v) => (v == null || Number.isNaN(Number(v)) ? '—' : String(Math.round(v))),
    human: (s) => `${Math.max(0, Math.floor(s / 60))}m`,
    feat: () => true,
    api: api || (async (url) => { calls.push(url); return { url }; }),
  };
  ctx.window = ctx;
  ctx.addEventListener = (type, fn) => { (listeners[type] ||= []).push(fn); };
  ctx.dispatch = (type) => (listeners[type] || []).forEach((fn) => fn({ type }));
  ctx.LRXTravelRadar = require('../../public/travel-radar.js');
  ctx.LRXFactionWorkspace = require('../../public/faction-workspace.js');
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  return { ctx, W: ctx.LRXOverviewWidgets, calls };
}

const iso = (ms) => new Date(ms).toISOString();

describe('Faction Travel Radar widget', () => {
  const now = Date.now();
  const radar = {
    travelSummary: { outbound: 1, abroad: 1, inbound: 1, unknown: 1, totalTravel: 4 },
    travel: [
      { playerId: 1, displayName: 'Hero', travelState: 'outbound', origin: 'torn', destination: 'jap', etaKind: 'estimate', etaFrom: iso(now + 40 * 60_000), etaTo: iso(now + 45 * 60_000), etaAt: null },
      { playerId: 2, displayName: 'Sitter', travelState: 'abroad', origin: null, destination: 'swi', etaKind: 'unknown', etaFrom: null, etaTo: null, etaAt: null },
      { playerId: 3, displayName: 'Returner', travelState: 'inbound', origin: 'mex', destination: 'torn', etaKind: 'exact', etaAt: iso(now + 10 * 60_000), etaFrom: null, etaTo: null },
      { playerId: 4, displayName: 'Lost', travelState: 'unknown', origin: null, destination: null, rawDescription: 'Somewhere', etaKind: 'unknown' },
    ],
  };

  it('names the country of every traveller from the radar fields', () => {
    const { W } = load('en');
    const html = W.premium.faction_radar.html(radar, 'L');
    expect(html).toContain('Returner (Mexico)');
    expect(html).toContain('Hero (Japan)');
    expect(html).toContain('Sitter (Switzerland)');
    expect(html).not.toContain('(?)');
  });

  it('sorts by the real ETA and shows it', () => {
    const { W } = load('en');
    const html = W.premium.faction_radar.html(radar, 'M');
    expect(html.indexOf('Returner')).toBeLessThan(html.indexOf('Hero'));
    expect(html).toMatch(/Returner \(Mexico\)<\/span><span class="mono">(9|10)m</);
    expect(html).toMatch(/Hero \(Japan\)<\/span><span class="mono">~(39|40)m</);
  });

  it('breaks travellers down by country instead of Unknown for everyone', () => {
    const { W } = load('en');
    const html = W.premium.faction_radar.html(radar, 'L');
    for (const name of ['Mexico', 'Japan', 'Switzerland']) expect(html).toContain(`<span>${name}</span>`);
    expect(html).not.toContain('<span>Unknown</span><span class="mono">4');
  });

  it('translates the state when there is no country (Turkish)', () => {
    const { W } = load('tr');
    const html = W.premium.faction_radar.html({ ...radar, travel: [radar.travel[3], radar.travel[0]] }, 'L');
    expect(html).toContain('Lost (Bilinmiyor)');
    expect(html).toContain('Hero (Japan)');
    expect(html).not.toContain('Unknown');
  });
});

describe('shared widget cache', () => {
  it('reuses one response for two tiles of the same player', async () => {
    const { ctx, W, calls } = load('en');
    await W.premium.faction_activity.load();
    await W.premium.faction_radar.load();
    expect(calls.filter((u) => u.startsWith('/api/faction/activity'))).toHaveLength(1);
    expect(ctx).toBeTruthy();
  });

  it('never serves the previous account its tiles after a player switch', async () => {
    const { ctx, W, calls } = load('en');
    await W.premium.faction_activity.load();
    ctx.state.overview.player.id = 2002;
    await W.premium.faction_activity.load();
    expect(calls.filter((u) => u.startsWith('/api/faction/activity'))).toHaveLength(2);
  });

  it('drops everything on a Premium identity reset', async () => {
    const { ctx, W, calls } = load('en');
    await W.premium.faction_member.load();
    ctx.dispatch('lrx-premium-reset');
    await W.premium.faction_member.load();
    expect(calls.filter((u) => u.startsWith('/api/faction/workspace'))).toHaveLength(2);
  });

  it('can be cleared by the host', async () => {
    const { W, calls } = load('en');
    await W.premium.travel_routes.load();
    W.clearShared();
    await W.premium.travel_stock.load();
    expect(calls.filter((u) => u === '/api/travel')).toHaveLength(2);
  });

  it('does not store a reply that arrives after a reset', async () => {
    let release;
    const calls = [];
    const api = (url) => { calls.push(url); return calls.length === 1 ? new Promise((r) => { release = () => r({ old: true }); }) : Promise.resolve({ fresh: true }); };
    const { ctx, W } = load('en', { api });
    const first = W.premium.faction_activity.load();
    await Promise.resolve();
    ctx.dispatch('lrx-premium-reset');
    release();
    await first;
    const second = await W.premium.faction_activity.load();
    expect(second).toEqual({ fresh: true });
  });
});

describe('Faction member summary widget', () => {
  const rows = [{ playerId: 7, name: 'Someone Else', position: 'Leader', days: 300, battleStats: {} }];

  it('says your row was not found instead of showing another member', () => {
    const { W } = load('en', { playerId: 1001 });
    const html = W.premium.faction_member.html({ membersTable: { rows } }, 'L');
    expect(html).not.toContain('Someone Else');
    expect(html).toMatch(/not found yet/);
  });

  it('shows your own row when it is there', () => {
    const { W } = load('en', { playerId: 7 });
    const html = W.premium.faction_member.html({ membersTable: { rows } }, 'S');
    expect(html).toContain('Someone Else');
  });
});

describe('Faction stats widget coverage', () => {
  it('names the real days behind a short window', () => {
    const { W } = load('en');
    const html = W.premium.faction_stats.html({ statsView: { windowDays: 30, coverage: { requestedDays: 30, actualDays: 12, complete: false }, activeRate: { pct: 50, numerator: 1, denominator: 2 }, rows: [] } }, 'S');
    expect(html).toContain('30d (12d data)');
  });

  it('puts the percent sign where each language expects it', () => {
    const view = { statsView: { windowDays: 7, activeRate: { pct: 50, numerator: 1, denominator: 2 }, rows: [] } };
    expect(load('en').W.premium.faction_stats.html(view, 'S')).toContain('50% Active');
    expect(load('tr').W.premium.faction_stats.html(view, 'S')).toContain('%50 Aktiflik');
  });
});

describe('Faction widgets for a player without a faction', () => {
  const NOT_IN = { notInFaction: true, code: 'NOT_IN_FACTION', error: "Bir faction'da değilsin.", membersTable: { rows: [] }, statsView: { rows: [] }, travel: [], travelSummary: {}, counts: {}, heatmap: {} };

  it('shows the server message on every faction tile', () => {
    const { W } = load('tr');
    for (const id of ['faction_member', 'faction_stats', 'faction_activity', 'faction_radar']) {
      const html = W.premium[id].html(NOT_IN, 'M');
      expect(html, id).toContain('Bir faction&#39;da değilsin.');
      expect(html, id).not.toContain('undefined');
      expect(html, id).not.toContain('Üye verisi yok');
      expect(html, id).not.toContain('🟢 0');
    }
  });

  it('falls back to its own text when the server sends none', () => {
    const { W } = load('en');
    const html = W.premium.faction_radar.html({ notInFaction: true }, 'S');
    expect(html).toContain('You are not in a faction');
  });
});
