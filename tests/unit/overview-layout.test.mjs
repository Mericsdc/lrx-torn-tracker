import { describe, expect, it } from 'vitest';
import layout from '../../public/overview-layout.js';

const { defaultSet, normalize, view, move, remove, add, resize, select, duplicate, rename, removeLayout, reset } = layout;

const DEFAULT_IDS = ['profile', 'drug', 'edu', 'day', 'bars', 'chips', 'battle', 'company'];
const PREMIUM_IDS = ['gym', 'networth', 'travel', 'job', 'crimes', 'jail', 'awards', 'oc', 'war', 'events', 'orders'];
const ids = (widgets) => widgets.map((w) => w.id);
const find = (widgets, id) => widgets.find((w) => w.id === id);
const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

// A member's saved set: "Daily" has bars and gym at L, "War" is the chosen layout.
function memberSet() {
  return normalize({
    v: 1,
    active: 1,
    layouts: [
      { name: 'Daily', widgets: [{ id: 'bars', size: 'L' }, { id: 'gym', size: 'L' }, { id: 'drug', size: 'S' }] },
      { name: 'War', widgets: [{ id: 'war', size: 'L' }, { id: 'gym', size: 'L' }, { id: 'battle', size: 'M' }] },
    ],
  });
}

describe('defaults and the widget catalogue', () => {
  it("default set is today's Overview with the tall profile first", () => {
    const set = defaultSet();
    expect(ids(set.layouts[0].widgets)).toEqual(DEFAULT_IDS);
    expect(set.layouts[0].widgets.map((w) => w.size)).toEqual(['P', 'S', 'S', 'S', 'M', 'S', 'L', 'W']);
    expect(set.active).toBe(0);
    expect(set.v).toBe(1);
    expect(set.layouts).toHaveLength(1);
    expect(set.layouts[0].name).toBe('');
    // At 4 columns the cards between the profile and the full-width company fill 3 rows x 3 columns beside it.
    const beside = set.layouts[0].widgets.slice(1, -1).reduce((cells, w) => cells + layout.SPAN[w.size], 0);
    expect(beside).toBe(9);
    // Each call is a fresh copy, so editing one never changes the next default.
    expect(defaultSet().layouts[0].widgets[0]).not.toBe(set.layouts[0].widgets[0]);
  });

  it('the widget catalogue matches the plan table and is frozen', () => {
    expect(ids(layout.WIDGETS)).toEqual([...DEFAULT_IDS, ...PREMIUM_IDS]);
    expect(layout.WIDGETS.filter((w) => w.tier === 'premium').map((w) => w.id)).toEqual(PREMIUM_IDS);
    const row = (id) => ({ tier: layout.byId[id].tier, sizes: layout.byId[id].sizes, size: layout.byId[id].size });
    expect(row('profile')).toEqual({ tier: 'free', sizes: ['P'], size: 'P' });
    for (const id of ['drug', 'edu', 'day']) expect(row(id)).toEqual({ tier: 'free', sizes: ['S'], size: 'S' });
    expect(row('bars')).toEqual({ tier: 'free', sizes: ['M', 'L'], size: 'M' });
    expect(row('chips')).toEqual({ tier: 'free', sizes: ['S', 'M', 'L'], size: 'S' });
    expect(row('battle')).toEqual({ tier: 'free', sizes: ['M', 'L'], size: 'L' });
    expect(row('company')).toEqual({ tier: 'free', sizes: ['W'], size: 'W' });
    for (const id of ['gym', 'travel', 'crimes', 'war']) expect(row(id)).toEqual({ tier: 'premium', sizes: ['S', 'M', 'L'], size: 'M' });
    for (const id of ['networth', 'job', 'jail', 'awards', 'oc', 'events']) expect(row(id)).toEqual({ tier: 'premium', sizes: ['S', 'M'], size: 'S' });
    expect(row('orders')).toEqual({ tier: 'premium', sizes: ['M', 'L'], size: 'M' });
    expect(layout.SPAN).toEqual({ S: 1, M: 2, L: 3, W: 4, P: 1 });
    expect(layout.MAX_LAYOUTS).toBe(5);
    expect(layout.MAX_NAME).toBe(24);
    for (const value of [layout, layout.WIDGETS, layout.WIDGETS[0], layout.WIDGETS[0].sizes, layout.byId, layout.SPAN]) expect(Object.isFrozen(value)).toBe(true);
  });
});

describe('repairing a saved set', () => {
  it('unreadable input falls back to the default set', () => {
    for (const raw of [undefined, null, 'x', 42, [], { layouts: 'x' }, { layouts: [] }]) expect(normalize(raw)).toEqual(defaultSet());
  });

  it('unknown and duplicate ids are dropped and bad sizes repaired', () => {
    const widgets = [{ id: 'drug', size: 'S' }, { id: 'drug' }, { id: '__proto__' }, { id: 'nope' }, { id: 'bars', size: 'XL' }, { id: 'gym', size: 'L' }];
    expect(normalize({ layouts: [{ name: 'x', widgets }] }).layouts[0].widgets).toEqual([{ id: 'drug', size: 'S' }, { id: 'bars', size: 'M' }, { id: 'gym', size: 'L' }]);
    const junk = [null, 'drug', { id: 'constructor' }, { id: 'toString' }, { id: 42 }, { id: 'edu', size: 'S' }];
    expect(normalize({ layouts: [{ name: 'x', widgets: junk }] }).layouts[0].widgets).toEqual([{ id: 'edu', size: 'S' }]);
  });

  it('at most five layouts, 24-character names, active index reset', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ name: 'L' + i, widgets: [] }));
    expect(normalize({ layouts: seven }).layouts).toHaveLength(5);
    const named = (name) => normalize({ layouts: [{ name, widgets: [] }] }).layouts[0].name;
    expect(named('x'.repeat(40))).toHaveLength(24);
    expect(named('a\u0000b')).toBe('ab');
    expect(named('  Daily\u007f\u001f ')).toBe('Daily');
    expect(named(42)).toBe('');
    expect(normalize({ active: 9, layouts: [{ name: 'A', widgets: [] }] }).active).toBe(0);
    expect(normalize({ active: 1, layouts: [{ name: 'A', widgets: [] }, { name: 'B', widgets: [] }] }).active).toBe(1);
  });

  it('a layout whose widgets are not a list gets the default widgets; an empty list stays empty', () => {
    const set = normalize({ layouts: [{ name: 'A', widgets: 'x' }, { name: 'B', widgets: [] }, { name: 'C' }] });
    expect(set.layouts[0]).toEqual({ name: 'A', widgets: defaultSet().layouts[0].widgets });
    expect(set.layouts[1]).toEqual({ name: 'B', widgets: [] });
    expect(set.layouts[2]).toEqual({ name: 'C', widgets: defaultSet().layouts[0].widgets });
  });
});

describe('what each Premium access state shows', () => {
  it('a member sees the chosen layout at its saved sizes', () => {
    const shown = view(memberSet(), 'active');
    expect(shown.index).toBe(1);
    expect(shown.name).toBe('War');
    expect(find(shown.widgets, 'gym')).toEqual({ id: 'gym', size: 'L', locked: null });
    expect(shown.widgets.every((w) => w.locked === null)).toBe(true);
  });

  it('after Premium ends the first layout shows at default sizes with Premium widgets locked', () => {
    const set = memberSet();
    const before = structuredClone(set);
    const shown = view(set, 'lapsed');
    expect(shown.index).toBe(0);
    expect(shown.name).toBe('Daily');
    expect(find(shown.widgets, 'bars')).toEqual({ id: 'bars', size: 'M', locked: null });
    expect(find(shown.widgets, 'gym')).toEqual({ id: 'gym', size: 'M', locked: 'premium' });
    expect(set).toEqual(before);
  });

  it('unknown access keeps the saved layout and sizes and marks Premium widgets as checking', () => {
    const shown = view(memberSet(), 'unknown');
    expect(shown.index).toBe(1);
    expect(shown.widgets).toEqual([
      { id: 'war', size: 'L', locked: 'checking' },
      { id: 'gym', size: 'L', locked: 'checking' },
      { id: 'battle', size: 'M', locked: null },
    ]);
  });

  it('Premium switched off marks Premium widgets as not available', () => {
    const shown = view(memberSet(), 'off');
    expect(shown.index).toBe(1);
    expect(shown.widgets).toEqual([
      { id: 'war', size: 'L', locked: 'unavailable' },
      { id: 'gym', size: 'L', locked: 'unavailable' },
      { id: 'battle', size: 'M', locked: null },
    ]);
  });

  it('a hand-edited set gives a free user no working Premium widget', () => {
    const everything = layout.WIDGETS.map((w) => ({ id: w.id, size: w.sizes[w.sizes.length - 1] }));
    const set = { v: 1, active: 0, layouts: [{ name: '', widgets: everything }] };
    for (const access of ['lapsed', 'unknown']) {
      const locked = view(set, access).widgets.filter((w) => w.locked !== null);
      expect(ids(locked)).toEqual(PREMIUM_IDS);
    }
  });
});

describe('editing a layout', () => {
  it('add refuses Premium widgets unless active and refuses ids already present', () => {
    const set = defaultSet();
    expect(add(set, 0, 'gym', 'lapsed')).toEqual(set);
    expect(add(set, 0, 'gym', 'unknown')).toEqual(set);
    expect(add(set, 0, 'gym', 'off')).toEqual(set);
    const added = add(set, 0, 'gym', 'active');
    expect(added.layouts[0].widgets).toEqual([...set.layouts[0].widgets, { id: 'gym', size: 'M' }]);
    expect(add(added, 0, 'gym', 'active')).toEqual(added);
    expect(add(set, 0, 'drug', 'active')).toEqual(set);
    expect(add(set, 0, 'nope', 'active')).toEqual(set);
    // A hidden free card can be re-added whatever the access.
    const hidden = remove(set, 0, 'chips');
    expect(ids(add(hidden, 0, 'chips', 'lapsed').layouts[0].widgets)).toEqual([...DEFAULT_IDS.filter((id) => id !== 'chips'), 'chips']);
  });

  it('resize needs an active member and a size the widget has', () => {
    const set = defaultSet();
    expect(resize(set, 0, 'bars', 'L', 'lapsed')).toEqual(set);
    expect(find(resize(set, 0, 'bars', 'L', 'active').layouts[0].widgets, 'bars').size).toBe('L');
    expect(resize(set, 0, 'bars', 'S', 'active')).toEqual(set);
    expect(resize(set, 0, 'gym', 'L', 'active')).toEqual(set);
  });

  it('move places a widget and keeps the others in order', () => {
    const others = DEFAULT_IDS.filter((id) => id !== 'battle');
    expect(ids(move(defaultSet(), 0, 'battle', 0).layouts[0].widgets)).toEqual(['battle', ...others]);
    expect(ids(move(defaultSet(), 0, 'battle', 99).layouts[0].widgets)).toEqual([...others, 'battle']);
    expect(ids(move(defaultSet(), 0, 'battle', -3).layouts[0].widgets)).toEqual(['battle', ...others]);
    expect(move(defaultSet(), 0, 'gym', 0)).toEqual(defaultSet());
  });

  it('remove, move and reset keep Premium widgets and saved sizes under unknown access', () => {
    const set = memberSet();
    const { index } = view(set, 'unknown');
    expect(index).toBe(1);
    const removed = remove(set, index, 'battle');
    expect(removed.layouts[1].widgets).toEqual([{ id: 'war', size: 'L' }, { id: 'gym', size: 'L' }]);
    expect(removed.layouts[0]).toEqual(set.layouts[0]);
    const moved = move(set, index, 'battle', 0);
    expect(moved.layouts[1].widgets).toEqual([{ id: 'battle', size: 'M' }, { id: 'war', size: 'L' }, { id: 'gym', size: 'L' }]);
    expect(moved.layouts[0]).toEqual(set.layouts[0]);
    const restored = reset(set, index);
    expect(restored.layouts[1]).toEqual({ name: 'War', widgets: defaultSet().layouts[0].widgets });
    expect(restored.layouts[0]).toEqual(set.layouts[0]);
    expect(restored.active).toBe(1);
  });

  it('layouts: duplicate, rename, select and delete are for active members; the last layout stays', () => {
    const set = memberSet();
    for (const access of ['lapsed', 'unknown', 'off']) {
      expect(duplicate(set, 0, 'Copy', access)).toEqual(set);
      expect(rename(set, 0, 'New', access)).toEqual(set);
      expect(select(set, 0, access)).toEqual(set);
      expect(removeLayout(set, 0, access)).toEqual(set);
    }
    const copied = duplicate(set, 0, 'Copy', 'active');
    expect(copied.layouts).toHaveLength(3);
    expect(copied.layouts[2]).toEqual({ name: 'Copy', widgets: set.layouts[0].widgets });
    expect(copied.active).toBe(2);
    let full = set;
    while (full.layouts.length < layout.MAX_LAYOUTS) full = duplicate(full, 0, 'More', 'active');
    expect(duplicate(full, 0, 'One too many', 'active')).toEqual(full);
    expect(rename(set, 1, '  Raid  ', 'active').layouts[1].name).toBe('Raid');
    expect(select(set, 0, 'active').active).toBe(0);
    expect(select(set, 7, 'active')).toEqual(set);
    // Deleting the active layout leaves a remaining one active; deleting an earlier one keeps the same layout active.
    const single = removeLayout(set, 1, 'active');
    expect(single.layouts.map((l) => l.name)).toEqual(['Daily']);
    expect(single.active).toBe(0);
    expect(removeLayout(single, 0, 'active')).toEqual(single);
    expect(removeLayout(defaultSet(), 0, 'active')).toEqual(defaultSet());
    const shifted = removeLayout(copied, 0, 'active');
    expect(shifted.layouts[shifted.active].name).toBe('Copy');
  });

  it('operations never mutate a deeply frozen input', () => {
    const set = deepFreeze(memberSet());
    const before = structuredClone(set);
    const results = [
      move(set, 1, 'battle', 0),
      remove(set, 1, 'gym'),
      add(set, 1, 'drug', 'active'),
      resize(set, 1, 'gym', 'S', 'active'),
      select(set, 0, 'active'),
      duplicate(set, 1, 'Copy', 'active'),
      rename(set, 1, 'Raid', 'active'),
      removeLayout(set, 1, 'active'),
      reset(set, 1),
    ];
    for (const result of results) {
      expect(result).not.toBe(set);
      expect(result).not.toEqual(before);
    }
    expect(normalize(set)).toEqual(before);
    view(set, 'lapsed');
    expect(set).toEqual(before);
  });
});
