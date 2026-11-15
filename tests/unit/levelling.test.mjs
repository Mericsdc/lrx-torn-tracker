import { describe, expect, it } from 'vitest';
import lv from '../../public/levelling.js';

const NOW = 1_800_000_000; // seconds
const row = (id, lvl, total, stats = {}) => ({ id, name: 'p' + id, lvl, total, str: 10, def: 10, spd: 10, dex: 10, ...stats });
const okay = { state: 'Okay', until: 0 };
const with_ = (t, status) => ({ ...t, status, checkedAt: status ? 1 : 0 });
const MINE = { str: 300, def: 300, spd: 300, dex: 300 };

describe('which targets cannot be attacked now', () => {
  it('hospital and jail until release, and travel, abroad, federal and fallen', () => {
    expect(lv.blocked({ state: 'Hospital', until: NOW + 60 }, NOW)).toBe(true);
    expect(lv.blocked({ state: 'Jail', until: NOW + 1 }, NOW)).toBe(true);
    for (const state of ['Traveling', 'Abroad', 'Federal', 'Fallen']) expect(lv.blocked({ state, until: 0 }, NOW)).toBe(true);
  });
  it('okay, unknown, not checked, or a hospital stay that is over (waiting for a new check) are shown', () => {
    expect(lv.blocked(okay, NOW)).toBe(false);
    expect(lv.blocked(null, NOW)).toBe(false);
    expect(lv.blocked({ state: 'Unknown', until: 0 }, NOW)).toBe(false);
    expect(lv.blocked({ state: 'Hospital', until: NOW - 1 }, NOW)).toBe(false);
    expect(lv.blocked({ state: 'Hospital', until: NOW }, NOW)).toBe(false);
  });
});

describe('a target whose stats match or beat yours', () => {
  it('names each of its stats at or above the one of yours it faces', () => {
    expect(lv.stronger(row(1, 50, 100, { def: 300, dex: 299 }), MINE)).toEqual(['def']);
    expect(lv.stronger(row(1, 50, 100, { str: 400, spd: 500 }), MINE)).toEqual(['str', 'spd']);
    expect(lv.stronger(row(1, 50, 100), MINE)).toEqual([]);
  });
  it('says nothing when your stats are not known', () => {
    expect(lv.stronger(row(1, 50, 100, { def: 9e9 }), null)).toEqual([]);
  });
  it('reads your effective stats from the overview battle stats', () => {
    const battle = { stats: { strength: { current: 310 }, defense: { current: 320 }, speed: { current: 330 }, dexterity: { current: 340 } } };
    expect(lv.mineFrom(battle)).toEqual({ str: 310, def: 320, spd: 330, dex: 340 });
    expect(lv.mineFrom(null)).toBe(null);
    expect(lv.mineFrom({ stats: { strength: { current: 0 }, defense: { current: 1 }, speed: { current: 1 }, dexterity: { current: 1 } } })).toBe(null);
  });
});

describe('what the page shows', () => {
  const targets = [
    with_(row(1, 40, 90), okay),
    with_(row(2, 80, 120), { state: 'Hospital', until: NOW + 600 }),
    with_(row(3, 70, 100, { def: 500 }), okay), // stronger than you
    with_(row(4, 60, 80), okay),
    with_(row(5, 90, 70), null), // not checked yet
    with_(row(6, 55, 60), okay),
    with_(row(7, 50, 50), okay),
    with_(row(8, 65, 95), { state: 'Traveling', until: 0 }),
    with_(row(9, 85, 75), { state: 'Hospital', until: NOW - 5 }), // out: checked again soon
  ];
  it('hides those that cannot be attacked and counts them', () => {
    const r = lv.order(targets, MINE, NOW);
    expect(r.rows.map((t) => t.id)).not.toContain(2);
    expect(r.rows.map((t) => t.id)).not.toContain(8);
    expect(r.blocked).toBe(2);
  });
  it('attackable ones you can beat first by level, then the stronger ones, then those waiting for a check', () => {
    expect(lv.order(targets, MINE, NOW).rows.map((t) => t.id)).toEqual([4, 6, 7, 1, 3, 5, 9]);
  });
  it('best EXP: the three highest-level attackable targets that are not stronger than you', () => {
    expect(lv.order(targets, MINE, NOW).best).toEqual([4, 6, 7]);
  });
  it('without your stats every attackable target counts, highest level first', () => {
    const r = lv.order(targets, null, NOW);
    expect(r.best).toEqual([3, 4, 6]);
    expect(r.rows.slice(0, 5).map((t) => t.id)).toEqual([3, 4, 6, 7, 1]);
  });
  it('a level tie goes to the lower total stats', () => {
    const r = lv.order([with_(row(1, 50, 300), okay), with_(row(2, 50, 100), okay)], MINE, NOW);
    expect(r.rows.map((t) => t.id)).toEqual([2, 1]);
  });
});

describe('which target the scan checks next', () => {
  const MS = NOW * 1000;
  const list = [row(1, 90, 10), row(2, 80, 10), row(3, 70, 10), row(4, 60, 10)];
  const statuses = (entries) => { const m = new Map(entries); return (id) => m.get(id); };
  const rec = (state, ageMs, until = 0) => ({ state, until, at: MS - ageMs, level: 0 });

  it('targets never checked go first, highest level first', () => {
    expect(lv.nextToCheck(list, statuses([[1, rec('Okay', 1000)]]), { mine: MINE, nowMs: MS })).toBe(2);
  });
  it('the top attackable targets are checked again after 45 s, the others after 3 min', () => {
    const all = [[1, rec('Okay', 46_000)], [2, rec('Okay', 44_000)], [3, rec('Okay', 1000)], [4, rec('Okay', 1000)]];
    expect(lv.nextToCheck(list, statuses(all), { mine: MINE, nowMs: MS })).toBe(1);
    const fresh = [[1, rec('Okay', 1000)], [2, rec('Okay', 44_000)], [3, rec('Okay', 1000)], [4, rec('Okay', 1000)]];
    expect(lv.nextToCheck(list, statuses(fresh), { mine: MINE, nowMs: MS })).toBe(null);
  });
  it('a target past the top ten waits 3 minutes', () => {
    const many = Array.from({ length: 12 }, (_, i) => row(i + 1, 100 - i, 10));
    const ages = many.map((t, i) => [t.id, rec('Okay', i === 11 ? 100_000 : 1000)]);
    expect(lv.nextToCheck(many, statuses(ages), { mine: MINE, nowMs: MS })).toBe(null);
    ages[11] = [12, rec('Okay', 181_000)];
    expect(lv.nextToCheck(many, statuses(ages), { mine: MINE, nowMs: MS })).toBe(12);
  });
  it('a target you just attacked is checked every 15 s for two minutes, before the others', () => {
    const all = [[1, rec('Okay', 50_000)], [2, rec('Okay', 1000)], [3, rec('Okay', 1000)], [4, rec('Okay', 16_000)]];
    expect(lv.nextToCheck(list, statuses(all), { mine: MINE, nowMs: MS, hot: new Map([[4, MS + 60_000]]) })).toBe(4);
    expect(lv.nextToCheck(list, statuses(all), { mine: MINE, nowMs: MS, hot: new Map([[4, MS - 1]]) })).toBe(1);
  });
  it('a hospital stay is not checked again before its release', () => {
    const all = [[1, rec('Hospital', 999_000, NOW + 30)], [2, rec('Okay', 1000)], [3, rec('Okay', 1000)], [4, rec('Okay', 1000)]];
    expect(lv.nextToCheck(list, statuses(all), { mine: MINE, nowMs: MS })).toBe(null);
    all[0] = [1, rec('Hospital', 999_000, NOW - 1)];
    expect(lv.nextToCheck(list, statuses(all), { mine: MINE, nowMs: MS })).toBe(1);
  });
  it('the scan never asks again faster than a check can come back fresh', () => {
    expect(lv.HOT_MS).toBeGreaterThan(lv.FRESH_TTL_MS);
    expect(lv.TOP_MS).toBeGreaterThan(lv.FRESH_TTL_MS);
  });
});
