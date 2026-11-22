import { describe, expect, it } from 'vitest';
import hd from '../../src/server/holdings-days.js';

// A loadHoldings() reply: inventory and stocks loaded, the bazaar partial (too long), the display failed,
// the item market loaded with nothing listed.
const H = {
  at: 1_763_800_000_000,
  places: {
    inventory: { ok: true, total: 8_301_000, rows: [
      { id: 206, name: 'Xanax', type: 'Drug', qty: 10, unit: 830000, value: 8_300_000 },
      { id: 7, name: 'Box', type: 'Other', qty: 3, unit: 333.333, value: 1000 },
      { id: 1, name: 'Kitchen Knife', type: 'Melee', qty: 0, unit: 0, value: 0 },
    ] },
    bazaar: { ok: true, partial: true, total: 5, rows: [{ id: 186, name: 'Sheep Plushie', type: 'Plushie', qty: 1, unit: 5, value: 5 }] },
    display: { ok: false, error: 'Torn API: down', code: 9 },
    itemmarket: { ok: true, total: 0, rows: [] },
    stocks: { ok: true, total: 1_200_500, rows: [{ id: 's25', name: 'Torn City Investments (TCI)', type: 'Stock', qty: 1000, unit: 1200.5, value: 1_200_500 }] },
  },
};
const snapOf = (places, names = {}, at = 2) => ({ at, places, names });
const withDays = (days, names = {}) => ({ v: 1, ownerId: 1, names, days });

describe('snapshot', () => {
  const s = hd.snapshot(H);
  it('keeps loaded, complete places and the rows that have a quantity', () => {
    expect(s.places).toEqual({ inventory: { 206: [10, 830000], 7: [3, 333.33] }, itemmarket: {}, stocks: { s25: [1000, 1200.5] } });
  });
  it('names every stored id, stocks included', () => {
    expect(s.names).toEqual({ 206: ['Xanax', 'Drug'], 7: ['Box', 'Other'], s25: ['Torn City Investments (TCI)', 'Stock'] });
  });
  it('carries the load time', () => expect(s.at).toBe(H.at));
  it('a reply without places stores nothing', () => expect(hd.snapshot({ at: 1 }).places).toEqual({}));
});

describe('record', () => {
  const snap = hd.snapshot(H);
  it('adds a day with the networth of the moment', () => {
    expect(hd.record(hd.empty(1), '2026-11-22', snap, { nw: 5e9 }).days['2026-11-22']).toEqual({ at: snap.at, nw: 5e9, places: snap.places });
  });
  it('merges the same day: a place missing from the new load keeps its earlier list', () => {
    const f = withDays({ '2026-11-22': { at: 1, nw: 1, places: { display: { 500: [1, 150e6] }, inventory: { 206: [1, 1] } } } }, { 500: ['Rare Painting', 'Collectible'], 206: ['Xanax', 'Drug'] });
    const day = hd.record(f, '2026-11-22', snapOf({ inventory: snap.places.inventory }, snap.names)).days['2026-11-22'];
    expect(day.places.display).toEqual({ 500: [1, 150e6] });
    expect(day.places.inventory).toEqual(snap.places.inventory);
    expect(day.at).toBe(2);
    expect('nw' in day).toBe(false); // an old networth would not match the updated places
  });
  it('does not change the file it was given', () => {
    const f = withDays({ '2026-11-21': { at: 1, places: { inventory: { 206: [1, 1] } } } }, { 206: ['Xanax', 'Drug'] });
    const copy = structuredClone(f);
    hd.record(f, '2026-11-22', snap);
    expect(f).toEqual(copy);
  });
  it('returns the same file when nothing loaded', () => {
    const f = hd.empty(1);
    expect(hd.record(f, '2026-11-22', snapOf({}))).toBe(f);
  });
  it('prunes by date and the names only pruned days used', () => {
    const f = withDays({
      '2025-11-20': { at: 1, places: { inventory: { 999: [1, 1] } } },
      '2025-11-21': { at: 1, places: { inventory: { 206: [1, 1] } } },
    }, { 999: ['Old Thing', 'Other'], 206: ['Xanax', 'Drug'] });
    const out = hd.record(f, '2026-11-22', snapOf({ stocks: { s1: [1, 2] } }, { s1: ['TSB', 'Stock'] }));
    expect(Object.keys(out.days).sort()).toEqual(['2025-11-21', '2026-11-22']);
    expect(out.names).toEqual({ 206: ['Xanax', 'Drug'], s1: ['TSB', 'Stock'] });
  });
});

describe('starts', () => {
  const rec = (n) => ({ at: n, places: { inventory: { [n]: [1, 1] } } });
  const f = withDays({ '2026-10-01': rec(1), '2026-11-15': rec(2), '2026-11-21': rec(3), '2026-11-22': rec(4) },
    { 1: ['One', ''], 2: ['Two', ''], 3: ['Three', ''], 4: ['Four', ''] });
  it('picks each period start like the networth tab, deduplicated, oldest first, never today', () => {
    const out = hd.starts(f, '2026-11-22');
    expect(out.today).toBe('2026-11-22');
    expect(out.starts.map((r) => r.date)).toEqual(['2026-10-01', '2026-11-15', '2026-11-21']);
    expect(out.starts[0]).toEqual({ date: '2026-10-01', at: 1, places: { inventory: { 1: [1, 1] } } });
  });
  it('1D needs the record dated exactly the day before', () => {
    const out = hd.starts(withDays({ '2026-11-20': rec(1) }), '2026-11-22', [1]);
    expect(out.starts).toEqual([]);
    expect(hd.starts(withDays({ '2026-11-20': rec(1) }), '2026-11-22').starts.map((r) => r.date)).toEqual(['2026-11-20']); // from 7D
  });
  it('sends names only for the ids in the starts', () => {
    expect(Object.keys(hd.starts(f, '2026-11-22').names).sort()).toEqual(['1', '2', '3']);
  });
  it('an empty file has no starts', () => {
    expect(hd.starts(hd.empty(1), '2026-11-22')).toEqual({ today: '2026-11-22', starts: [], names: {} });
  });
});

describe('forOwner', () => {
  it('treats another owner, garbage and broken shapes as empty', () => {
    for (const bad of [null, undefined, [], 'x', { v: 1, ownerId: 2, days: {}, names: {} }, { v: 1, ownerId: 1, days: [], names: {} }, { v: 1, ownerId: 1, days: {} }, { v: 2, ownerId: 1, days: {}, names: {} }]) {
      expect(hd.forOwner(bad, 1)).toEqual(hd.empty(1));
    }
  });
  it("keeps the owner's own file", () => {
    const f = withDays({});
    expect(hd.forOwner(f, 1)).toBe(f);
  });
  it('empty() is a fresh file for that owner', () => expect(hd.empty(7)).toEqual({ v: 1, ownerId: 7, names: {}, days: {} }));
});
