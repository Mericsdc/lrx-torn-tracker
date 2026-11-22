import { describe, expect, it } from 'vitest';
import fm from '../../public/finance-math.js';

// Daily networth records 2026-10-01 .. 2026-11-30, total 1000 + 10 per day.
const day = (start, i) => new Date(Date.parse(start + 'T00:00:00Z') + i * 86400_000).toISOString().slice(0, 10);
const DENSE = Array.from({ length: 61 }, (_, i) => ({ date: day('2026-10-01', i), total: 1000 + 10 * i }));
// The app was not run every day.
const SPARSE = [
  { date: '2026-10-01', total: 1000 }, { date: '2026-11-01', total: 1500 }, { date: '2026-11-02', total: 1400 },
  { date: '2026-11-09', total: 1700 }, { date: '2026-11-29', total: 1950 }, { date: '2026-11-30', total: 2000 },
];
const GAPPY = [{ date: '2026-11-01', total: 100 }, { date: '2026-11-02', total: 90 }, { date: '2026-11-09', total: 400 }, { date: '2026-11-30', total: 50 }];
const ONE = [{ date: '2026-11-30', total: 2000 }];

describe('periodStart', () => {
  it('1D is the record dated exactly one day before the last', () => {
    expect(fm.periodStart(SPARSE, 1).date).toBe('2026-11-29');
    expect(fm.periodStart(GAPPY, 1)).toBeNull();
  });
  it('other periods start at the oldest record inside the window', () => {
    expect(fm.periodStart(SPARSE, 7).date).toBe('2026-11-29');
    expect(fm.periodStart(SPARSE, 30).date).toBe('2026-11-01');
    expect(fm.periodStart(SPARSE, 90).date).toBe('2026-10-01');
    expect(fm.periodStart(SPARSE, 365).date).toBe('2026-10-01');
    expect(fm.periodStart(GAPPY, 7)).toBeNull();
  });
  it('a single record or none has no start', () => {
    expect(fm.periodStart(ONE, 30)).toBeNull();
    expect(fm.periodStart([], 30)).toBeNull();
  });
});

describe('nwChange and nwPrevChange', () => {
  it('measures the change over the period against the current total', () => {
    const c = fm.nwChange(SPARSE, 2000, 30);
    expect(c.start.date).toBe('2026-11-01');
    expect(c.change).toBe(500);
    expect(c.pct).toBeCloseTo(1 / 3);
    expect(c.covered).toBe(29);
    expect(c.perDay).toBeCloseTo(500 / 29);
  });
  it('is null without a start record', () => {
    expect(fm.nwChange(ONE, 2000, 30)).toBeNull();
    expect(fm.nwChange(GAPPY, 50, 1)).toBeNull();
  });
  it('compares with the same-length window right before the period', () => {
    expect(fm.nwChange(DENSE, 1600, 7).change).toBe(70);
    expect(fm.nwPrevChange(DENSE, 7)).toBe(70); // 11-23 (1530) minus 11-16 (1460)
    expect(fm.nwPrevChange(DENSE, 1)).toBe(10); // 11-29 minus 11-28
  });
  it('has no previous period for 1Y or when records do not reach back', () => {
    expect(fm.nwPrevChange(DENSE, 365)).toBeNull();
    expect(fm.nwPrevChange(DENSE, 90)).toBeNull();
    expect(fm.nwPrevChange(ONE, 7)).toBeNull();
  });
  it('partial previous window: no comparison when its records cover fewer days than the period does', () => {
    // 7D runs 11-08 → 11-15 (7 days); the record before it, 11-07, covers 1 day only.
    const hist = [{ date: '2026-11-07', total: 1000 }, { date: '2026-11-08', total: 1010 }, { date: '2026-11-15', total: 2000 }];
    expect(fm.nwPrevChange(hist, 7)).toBeNull();
    // The same gaps on both sides compare like with like.
    const even = [{ date: '2026-11-01', total: 900 }, { date: '2026-11-08', total: 1010 }, { date: '2026-11-15', total: 2000 }];
    expect(fm.nwPrevChange(even, 7)).toBe(110);
  });
});

describe('nwGroups and nwMovers', () => {
  const current = { total: 2000, wallet: 100, bank: 900, items: 300, stockmarket: 500, loan: -500, points: 0, newthing: 7, company: 0, parsetime: 1.2, timestamp: 123, at: 5 };
  const start = { date: '2026-11-01', total: 1500, wallet: 150, bank: 900, items: 200, stockmarket: 400, loan: -500, points: 0, company: 50, at: 4 };
  it('sums the four groups, keeps signs and puts unknown parts in other', () => {
    const g = fm.nwGroups(current, start);
    expect(g.map((x) => x.key)).toEqual(['cash', 'market', 'invest', 'other']);
    expect(g[0]).toEqual({ key: 'cash', total: 1000, change: -50, parts: [{ key: 'bank', value: 900, change: 0 }, { key: 'wallet', value: 100, change: -50 }] });
    expect(g[1]).toEqual({ key: 'market', total: 300, change: 100, parts: [{ key: 'items', value: 300, change: 100 }] });
    expect(g[2]).toEqual({ key: 'invest', total: 500, change: 50, parts: [{ key: 'stockmarket', value: 500, change: 100 }, { key: 'company', value: 0, change: -50 }] });
    expect(g[3]).toEqual({ key: 'other', total: -493, change: 7, parts: [{ key: 'loan', value: -500, change: 0 }, { key: 'newthing', value: 7, change: 7 }] });
  });
  it('has no changes without a start record', () => {
    const g = fm.nwGroups(current, null);
    expect(g[0].change).toBeNull();
    expect(g[0].parts[0]).toEqual({ key: 'bank', value: 900, change: null });
  });
  it('lists the parts that moved most', () => {
    expect(fm.nwMovers(current, start, 3)).toEqual([{ key: 'items', change: 100 }, { key: 'stockmarket', change: 100 }, { key: 'wallet', change: -50 }]);
    expect(fm.nwMovers(current, start).length).toBe(5);
    expect(fm.nwMovers(current, null)).toEqual([]);
  });
});

describe('recordChanges and nwStats', () => {
  const hist = [
    { date: '2026-11-01', total: 100, bank: 50, items: 50 },
    { date: '2026-11-02', total: 130, bank: 50, items: 80 },
    { date: '2026-11-03', total: 90, bank: 20, items: 70 },
  ];
  it('gives each record its change and the part that moved most', () => {
    expect(fm.recordChanges(hist)).toEqual([
      { date: '2026-11-02', total: 130, change: 30, span: 1, mover: { key: 'items', change: 30 } },
      { date: '2026-11-03', total: 90, change: -40, span: 1, mover: { key: 'bank', change: -30 } },
    ]);
    expect(fm.recordChanges(ONE)).toEqual([]);
  });
  it('finds the best and worst day after the start', () => {
    expect(fm.nwStats(hist, hist[0])).toEqual({ best: { date: '2026-11-02', change: 30 }, worst: { date: '2026-11-03', change: -40 }, up: 1, count: 2 });
    expect(fm.nwStats(hist, hist[1])).toEqual({ best: null, worst: { date: '2026-11-03', change: -40 }, up: 0, count: 1 });
    expect(fm.nwStats(hist, null)).toEqual({ best: null, worst: null, up: 0, count: 0 });
  });
  it('gappy history: only one-day steps count as days', () => {
    const s = fm.nwStats(GAPPY, GAPPY[0]);
    expect(s).toEqual({ best: null, worst: { date: '2026-11-02', change: -10 }, up: 0, count: 1 });
    expect(fm.recordChanges(GAPPY)[1]).toMatchObject({ date: '2026-11-09', change: 310, span: 7, mover: null });
  });
});

describe('nextMilestone', () => {
  it('is the next networth rank trigger with progress and an ETA', () => {
    const m = fm.nextMilestone(2.61e9, 8.8e6);
    expect(m.target).toBe(5e9);
    expect(m.from).toBe(5e8);
    expect(m.progress).toBeCloseTo(0.4689, 4);
    expect(m.days).toBe(272);
  });
  it('starts from $0 and has no ETA without growth', () => {
    expect(fm.nextMilestone(1e6, 0)).toEqual({ target: 5e6, from: 0, progress: 0.2, days: null });
    expect(fm.nextMilestone(5e9, -1).target).toBe(5e10);
  });
  it('is done above the last trigger and null without a total', () => {
    expect(fm.nextMilestone(6e10, 1)).toEqual({ done: true });
    expect(fm.nextMilestone(null, 1)).toBeNull();
  });
});

describe('company windows and totals', () => {
  const E = Array.from({ length: 10 }, (_, i) => ({ date: day('2026-11-01', i), revenue: 100, cogs: 40, wages: 10, ads: 20, net: 30, customers: 5, cogsEstimated: i < 2 }));
  it('takes the last n days by date and the n days before them', () => {
    expect(fm.coWindow(E, 7).map((r) => r.date)).toEqual(['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
    expect(fm.coWindow(E, 1).map((r) => r.date)).toEqual(['2026-11-10']);
    expect(fm.coWindow(E, Infinity).length).toBe(10);
    expect(fm.coPrevWindow(E, 7).map((r) => r.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(fm.coPrevWindow(E, Infinity)).toEqual([]);
    expect(fm.coWindow([], 7)).toEqual([]);
  });
  it('sums a window and flags estimated cost of goods', () => {
    expect(fm.coTotals(fm.coWindow(E, 7))).toEqual({ days: 7, revenue: 700, cogs: 280, gross: 420, wages: 70, ads: 140, net: 210, customers: 35, estimated: false });
    expect(fm.coTotals(fm.coPrevWindow(E, 7)).estimated).toBe(true);
    expect(fm.coTotals([])).toEqual({ days: 0, revenue: 0, cogs: 0, gross: 0, wages: 0, ads: 0, net: 0, customers: 0, estimated: false });
  });
  it('compares percentages safely', () => {
    expect(fm.pctChange(110, 100)).toBeCloseTo(0.1);
    expect(fm.pctChange(-50, -100)).toBeCloseTo(0.5);
    expect(fm.pctChange(5, 0)).toBeNull();
    expect(fm.pctChange(null, 5)).toBeNull();
  });
  it('partial previous window: compares daily averages, not sums of a different number of days', () => {
    // 10 flat days on 7D: 7 days now, 3 recorded days before. Same revenue per day → no change.
    const now = fm.coTotals(fm.coWindow(E, 7)), prev = fm.coTotals(fm.coPrevWindow(E, 7));
    expect(fm.coChange(now, prev, 'revenue')).toBe(0);
    expect(fm.coChange(now, prev, 'cogs')).toBe(0);
    expect(fm.coChange({ days: 7, revenue: 770 }, { days: 7, revenue: 700 }, 'revenue')).toBeCloseTo(0.1);
    expect(fm.coChange({ days: 7, revenue: 770 }, null, 'revenue')).toBeNull();
    expect(fm.coChange({ days: 7, revenue: 770 }, { days: 0, revenue: 0 }, 'revenue')).toBeNull();
    expect(fm.coChange({ days: 7, net: -70 }, { days: 2, net: -40 }, 'net')).toBeCloseTo(0.5);
  });
  it('works out the break-even revenue per day', () => {
    const b = fm.breakEven({ days: 7, revenue: 14.3e6, cogs: 6.006e6, wages: 3.15e6, ads: 5.6e6 });
    expect(b.perDay).toBeCloseTo(1.25e6 / 0.58, 0);
    expect(b.avgRevenue).toBeCloseTo(14.3e6 / 7, 0);
    expect(b.gap).toBeCloseTo(14.3e6 / 7 - 1.25e6 / 0.58, 0);
    expect(fm.breakEven({ days: 7, revenue: 0, cogs: 0, wages: 1, ads: 1 })).toBeNull();
    expect(fm.breakEven({ days: 7, revenue: 10, cogs: 12, wages: 1, ads: 1 })).toBeNull();
    expect(fm.breakEven({ days: 0, revenue: 0, cogs: 0, wages: 0, ads: 0 })).toBeNull();
  });
  it('builds a product revenue series and the chart window', () => {
    const days = [
      { date: '2026-11-01', products: { Bra: { sold: 2, worth: 80 } } },
      { date: '2026-11-02', products: {} },
      { date: '2026-11-03', products: { Bra: { sold: 3, worth: 120 } } },
    ];
    expect(fm.productSeries(days, 'Bra')).toEqual([{ date: '2026-11-01', v: 80 }, { date: '2026-11-03', v: 120 }]);
    expect(fm.productSeries(days, 'Thong')).toEqual([]);
    const long = Array.from({ length: 120 }, (_, i) => ({ date: day('2026-07-01', i) }));
    expect(fm.chartDays(long, 1).length).toBe(7);
    expect(fm.chartDays(long, 30).length).toBe(30);
    expect(fm.chartDays(long, Infinity).length).toBe(90);
  });
});

describe('holdingsView and holdingsCompare', () => {
  const H = () => ({ at: 1, places: {
    inventory: { ok: true, total: 1500, rows: [
      { id: 206, name: 'Xanax', type: 'Drug', qty: 1, unit: 1000, value: 1000 },
      { id: 186, name: 'Sheep Plushie', type: 'Plushie', qty: 10, unit: 50, value: 500 },
      { id: 260, name: 'Dozen Roses', type: 'Flower', qty: 3, unit: 0, value: 0 },
    ] },
    bazaar: { ok: true, total: 4500, rows: [
      { id: 206, name: 'Xanax', type: 'Drug', qty: 4, unit: 1000, value: 4000, listed: 1100 },
      { id: 186, name: 'Sheep Plushie', type: 'Plushie', qty: 10, unit: 50, value: 500, listed: 60 },
    ] },
    display: { ok: true, total: 0, rows: [] },
    itemmarket: { ok: false, error: 'Torn API: Access level of this key is not high enough' },
    stocks: { ok: true, total: 2000, rows: [{ id: 's25', name: 'Torn City Investments (TCI)', type: 'Stock', qty: 10, unit: 200, value: 2000 }] },
  } });

  it('All merges one item across places with shares', () => {
    const v = fm.holdingsView(H(), 'all');
    expect(v.place).toBe('all');
    expect(v.total).toBe(8000);
    expect(v.rows.map((r) => [r.id, r.qty, r.value, r.places])).toEqual([
      [206, 5, 5000, ['inventory', 'bazaar']], ['s25', 10, 2000, ['stocks']], [186, 20, 1000, ['inventory', 'bazaar']],
    ]);
    expect(v.rows[0].unit).toBe(1000);
    expect(v.rows[0].share).toBeCloseTo(0.625);
    expect(v.rows[0].listed).toBeUndefined();
    expect(v.biggest.name).toBe('Xanax');
    expect(v.partial).toBe(false);
    expect(v.places.map((p) => [p.key, p.ok, p.total, p.count])).toEqual([
      ['inventory', true, 1500, 3], ['bazaar', true, 4500, 2], ['display', true, 0, 0], ['itemmarket', false, 0, 0], ['stocks', true, 2000, 1],
    ]);
    expect(v.places[3].error).toContain('Access level');
    expect(fm.holdingsView(H(), 'nowhere').place).toBe('all');
  });
  it('a single place keeps the listed price', () => {
    const v = fm.holdingsView(H(), 'bazaar');
    expect(v.total).toBe(4500);
    expect(v.rows[0]).toMatchObject({ id: 206, listed: 1100, places: ['bazaar'] });
    expect(v.rows[0].share).toBeCloseTo(4000 / 4500);
  });
  it('zero-value rows are counted, not listed', () => {
    const v = fm.holdingsView(H(), 'inventory');
    expect(v.rows.map((r) => r.id)).toEqual([206, 186]);
    expect(v.zero).toBe(1);
    expect(fm.holdingsView(H(), 'all').zero).toBe(1);
  });
  it('a failed place has its error and no rows; a partial place marks the view', () => {
    const v = fm.holdingsView(H(), 'itemmarket');
    expect(v).toMatchObject({ total: 0, rows: [], biggest: null, error: 'Torn API: Access level of this key is not high enough' });
    const h = H();
    h.places.inventory.partial = true;
    expect(fm.holdingsView(h, 'inventory').partial).toBe(true);
    expect(fm.holdingsView(h, 'all').partial).toBe(true);
    expect(fm.holdingsView(h, 'bazaar').partial).toBe(false);
  });
  it('holdingsCompare: off over 2 %, All uses the parts of the places that loaded, null when partial, failed or without networth', () => {
    const current = { items: 1500, bazaar: 4000, displaycase: 0, itemmarket: 100, stockmarket: 2000 };
    expect(fm.holdingsCompare(fm.holdingsView(H(), 'bazaar'), current)).toEqual({ torn: 4000, diff: 500, off: true });
    expect(fm.holdingsCompare(fm.holdingsView(H(), 'inventory'), current)).toEqual({ torn: 1500, diff: 0, off: false });
    expect(fm.holdingsCompare(fm.holdingsView(H(), 'all'), current)).toEqual({ torn: 7500, diff: 500, off: true });
    expect(fm.holdingsCompare(fm.holdingsView(H(), 'itemmarket'), current)).toBeNull();
    expect(fm.holdingsCompare(fm.holdingsView(H(), 'bazaar'), null)).toBeNull();
    const h = H();
    h.places.inventory.partial = true;
    expect(fm.holdingsCompare(fm.holdingsView(h, 'inventory'), current)).toBeNull();
  });
  it('holdingsMerge: a place that failed on a refresh keeps its last rows, marked stale with the new reason', () => {
    const prev = H();
    const next = H();
    next.at = 2;
    next.places.inventory = { ok: false, error: 'Torn API: Too many requests', code: 5 };
    next.places.bazaar.rows = next.places.bazaar.rows.slice(0, 1);
    const m = fm.holdingsMerge(prev, next);
    expect(m.at).toBe(2);
    expect(m.places.inventory).toEqual({ ...prev.places.inventory, stale: 'Torn API: Too many requests' });
    expect(m.places.bazaar).toEqual(next.places.bazaar);
    expect(m.places.itemmarket).toEqual(next.places.itemmarket);
    expect(fm.holdingsMerge(null, next)).toBe(next);
    const again = fm.holdingsMerge(m, { ...next, at: 3, places: { ...next.places, inventory: { ok: false, error: 'Torn API: still down' } } });
    expect(again.places.inventory.stale).toBe('Torn API: still down');
    expect(again.places.inventory.rows).toEqual(prev.places.inventory.rows);
    expect(fm.holdingsMerge(m, H()).places.inventory.stale).toBeUndefined();
  });
  it('a stale place still counts in the view, names its reason, and is not compared with Torn', () => {
    const next = H();
    next.places.bazaar = { ok: false, error: 'Torn API: down', code: 9 };
    const m = fm.holdingsMerge(H(), next);
    const all = fm.holdingsView(m, 'all');
    expect(all.total).toBe(8000);
    expect(all.places.find((p) => p.key === 'bazaar')).toMatchObject({ ok: true, count: 2, stale: 'Torn API: down' });
    expect(all.places.find((p) => p.key === 'inventory').stale).toBeNull();
    const current = { items: 1500, bazaar: 4500, displaycase: 0, itemmarket: 100, stockmarket: 2000 };
    expect(fm.holdingsCompare(all, current)).toBeNull();
    expect(fm.holdingsCompare(fm.holdingsView(m, 'bazaar'), current)).toBeNull();
    expect(fm.holdingsCompare(fm.holdingsView(m, 'inventory'), current)).toEqual({ torn: 1500, diff: 0, off: false });
  });
});

describe('holdingsChange and holdingsTie', () => {
  const cur = (places) => ({ at: 1, places });
  const ok = (rows, extra = {}) => ({ ok: true, total: rows.reduce((a, r) => a + r.value, 0), rows, ...extra });
  const row = (id, name, qty, unit) => ({ id, name, type: 'Drug', qty, unit, value: qty * unit });
  const byId = (c) => Object.fromEntries(c.rows.map((r) => [r.id, r]));

  it("the owner's Xanax example: price effect on what is held, bought / sold at the start price", () => {
    const c = fm.holdingsChange(cur({ bazaar: ok([row(206, 'Xanax', 4700, 830000)]) }), { date: '2026-11-15', places: { bazaar: { 206: [5000, 840000] } } }, {}, 'bazaar');
    expect(c.rows[0]).toMatchObject({ id: 206, name: 'Xanax', places: ['bazaar'], q0: 5000, q1: 4700, u0: 840000, u1: 830000, price: -47e6, trade: -252e6, total: -299e6 });
    expect([c.price, c.trade, c.total]).toEqual([-47e6, -252e6, -299e6]);
    expect(c.place).toBe('bazaar');
    expect(c.counted).toEqual(['bazaar']);
  });
  it('a new item is all bought; a sold-out item is named from the stored names', () => {
    const c = fm.holdingsChange(cur({ inventory: ok([row(186, 'Sheep Plushie', 10, 50)]) }), { places: { inventory: { s25: [1000, 1200.5] } } }, { s25: ['TCI', 'Stock'] });
    expect(byId(c)[186]).toMatchObject({ q0: 0, q1: 10, u0: null, u1: 50, price: 0, trade: 500, total: 500 });
    expect(byId(c).s25).toMatchObject({ name: 'TCI', type: 'Stock', q0: 1000, q1: 0, u0: 1200.5, u1: null, price: 0, trade: -1200500, total: -1200500 });
  });
  it('moving items from Items to the Bazaar nets to nothing in All', () => {
    const h = cur({ inventory: ok([]), bazaar: ok([row(206, 'Xanax', 100, 830000)]) });
    const all = fm.holdingsChange(h, { places: { inventory: { 206: [100, 830000] }, bazaar: {} } });
    expect(all.rows).toEqual([]);
    expect(all.unchanged).toBe(1);
    expect(all.byPlace).toEqual({ inventory: -83e6, bazaar: 83e6 });
    expect(all.counted).toEqual(['inventory', 'bazaar']);
  });
  it('an item moved to a place it was not in keeps its price effect (start unit from where it was)', () => {
    const h = cur({ inventory: ok([]), bazaar: ok([row(206, 'Xanax', 100, 830000)]) });
    const start = { places: { inventory: { 206: [100, 840000] }, bazaar: {} } };
    const all = fm.holdingsChange(h, start);
    expect(all.rows[0]).toMatchObject({ q0: 100, q1: 100, price: -1e6, trade: 0, total: -1e6 });
    expect(all.byPlace).toEqual({ inventory: -84e6, bazaar: 83e6 });
    expect(fm.holdingsChange(h, start, {}, 'bazaar').rows[0]).toMatchObject({ q0: 0, q1: 100, price: -1e6, trade: 84e6, total: 83e6 });
  });
  it('All sums one item across places', () => {
    const h = cur({ inventory: ok([row(206, 'Xanax', 10, 900)]), bazaar: ok([row(206, 'Xanax', 20, 1000)]) });
    const r = fm.holdingsChange(h, { places: { inventory: { 206: [10, 800] }, bazaar: { 206: [10, 1000] } } }).rows[0];
    expect(r).toMatchObject({ places: ['inventory', 'bazaar'], q0: 20, q1: 30, u0: 900, price: 1000, trade: 10000, total: 11000 });
    expect(r.u1).toBeCloseTo(966.67, 2);
  });
  it('excludes failed, stale, partial and unrecorded places, and then has no networth tie', () => {
    const h = cur({
      inventory: { ok: false, error: 'Torn API: down' },
      bazaar: ok([row(206, 'Xanax', 1, 1)], { stale: 'Torn API: Too many requests' }),
      display: ok([row(500, 'Rare Painting', 1, 9)], { partial: true }),
      itemmarket: ok([row(9, 'Thing', 1, 10)]),
      stocks: ok([row('s1', 'TSB', 2, 5)]),
    });
    const c = fm.holdingsChange(h, { places: { inventory: { 1: [1, 1] }, bazaar: { 206: [1, 1] }, display: {}, stocks: { s1: [2, 4] } } });
    expect(c.excluded).toEqual([{ key: 'inventory', why: 'failed' }, { key: 'bazaar', why: 'failed' }, { key: 'display', why: 'partial' }, { key: 'itemmarket', why: 'nostart' }]);
    expect(c.counted).toEqual(['stocks']);
    expect([c.price, c.trade, c.total]).toEqual([2, 0, 2]);
    expect(fm.holdingsTie(c, 10e9, 10.04e9)).toBeNull();
    expect(fm.holdingsChange(h, { places: { inventory: { 1: [1, 1] }, bazaar: { 206: [1, 1] }, display: {}, stocks: { s1: [2, 4] } } }, {}, 'bazaar').rows).toEqual([]);
  });
  it('a place that failed now is excluded even without a start record; one with nothing in either is skipped', () => {
    const c = fm.holdingsChange(cur({ itemmarket: { ok: false, error: 'x' }, display: ok([]), stocks: ok([row('s1', 'TSB', 1, 1)]) }), { places: { stocks: { s1: [1, 1] } } });
    expect(c.excluded).toEqual([{ key: 'itemmarket', why: 'failed' }]);
    expect(c.counted).toEqual(['stocks']);
  });
  it('ties to the networth: rest = networth change − price effect', () => {
    const all = fm.holdingsChange(cur({ bazaar: ok([row(206, 'Xanax', 4700, 830000)]) }), { places: { bazaar: { 206: [5000, 840000] } } });
    expect(fm.holdingsTie(all, 10e9, 10.04e9)).toEqual({ change: -40e6, price: -47e6, rest: 7e6 });
    expect(fm.holdingsTie(all, 10e9, undefined)).toBeNull();
    expect(fm.holdingsTie(all, NaN, 10.04e9)).toBeNull();
    expect(fm.holdingsTie({ ...all, place: 'bazaar' }, 10e9, 10.04e9)).toBeNull();
  });
  it('a zero market value at either side gives numbers, never NaN', () => {
    const c = fm.holdingsChange(cur({ inventory: ok([row(7, 'A', 5, 200), row(8, 'B', 2, 0)]) }), { places: { inventory: { 7: [5, 0], 8: [2, 50] } } });
    expect(byId(c)[7]).toMatchObject({ price: 1000, trade: 0, total: 1000 });
    expect(byId(c)[8]).toMatchObject({ u1: 0, price: -100, trade: 0, total: -100 });
    expect(c.rows.every((r) => [r.price, r.trade, r.total].every(Number.isFinite))).toBe(true);
  });
  it('sorts by the size of the change, then the size of the price effect', () => {
    const h = cur({ inventory: ok([row(1, 'One', 1, 100), row(2, 'Two', 1, 100), row(3, 'Three', 1, 300), row(4, 'Four', 2, 200)]) });
    const c = fm.holdingsChange(h, { places: { inventory: { 1: [1, 200], 4: [1, 100] } } });
    expect(c.rows.map((r) => r.id)).toEqual([4, 3, 1, 2]);
  });
});
