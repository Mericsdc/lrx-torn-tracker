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
