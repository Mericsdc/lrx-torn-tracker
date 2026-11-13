(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXOverviewLayout = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  // Overview widget rules. A set is { v: 1, active, layouts: [{ name, widgets: [{ id, size }] }] }; '' is the default
  // layout's name. Access is 'active' | 'lapsed' | 'unknown' | 'off'. Every edit returns a new, normalized set.
  const row = (id, tier, sizes, size) => Object.freeze({ id, tier, sizes: Object.freeze(sizes.split('')), size });
  const WIDGETS = Object.freeze([ // catalogue order
    row('profile', 'free', 'P', 'P'), row('drug', 'free', 'S', 'S'), row('edu', 'free', 'S', 'S'), row('day', 'free', 'S', 'S'),
    row('bars', 'free', 'ML', 'M'), row('chips', 'free', 'SML', 'S'), row('battle', 'free', 'ML', 'L'), row('company', 'free', 'W', 'W'),
    row('gym', 'premium', 'SML', 'M'), row('networth', 'premium', 'SM', 'S'), row('travel', 'premium', 'SML', 'M'),
    row('job', 'premium', 'SM', 'S'), row('crimes', 'premium', 'SML', 'M'), row('jail', 'premium', 'SM', 'S'),
    row('awards', 'premium', 'SM', 'S'), row('oc', 'premium', 'SM', 'S'), row('war', 'premium', 'SML', 'M'),
    row('events', 'premium', 'SM', 'S'), row('orders', 'premium', 'ML', 'M'),
  ]);
  const byId = Object.freeze(Object.fromEntries(WIDGETS.map((w) => [w.id, w])));
  const SPAN = Object.freeze({ S: 1, M: 2, L: 3, W: 4, P: 1 }); // columns; P (the profile) is also 3 rows tall
  const MAX_LAYOUTS = 5, MAX_NAME = 24;
  const DEFAULT_IDS = ['profile', 'drug', 'edu', 'day', 'bars', 'chips', 'battle', 'company'];
  // How a Premium widget shows per access; an unrecognised access is treated as still checking, never as unlocked.
  const LOCKS = Object.freeze({ active: null, lapsed: 'premium', unknown: 'checking', off: 'unavailable' });

  const widget = (id) => (typeof id === 'string' && Object.hasOwn(byId, id) ? byId[id] : null);
  const defaultWidgets = () => DEFAULT_IDS.map((id) => ({ id, size: byId[id].size }));
  const defaultSet = () => ({ v: 1, active: 0, layouts: [{ name: '', widgets: defaultWidgets() }] });
  // The trailing trimEnd keeps the cap from leaving a space at the end, so cleaning twice changes nothing.
  const cleanName = (name) => (typeof name === 'string' ? name.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, MAX_NAME).trimEnd() : '');
  function cleanWidgets(list) {
    const seen = new Set();
    return list.flatMap((entry) => {
      const w = widget(entry?.id);
      if (!w || seen.has(w.id)) return [];
      seen.add(w.id);
      return [{ id: w.id, size: w.sizes.includes(entry.size) ? entry.size : w.size }];
    });
  }
  // A saved set, possibly old, corrupt or hand-edited. Never throws and never gives a blank set for unreadable input;
  // an empty widget list stays empty because the player removed everything on purpose.
  function normalize(raw) {
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.layouts) || !raw.layouts.length) return defaultSet();
      const layouts = raw.layouts.slice(0, MAX_LAYOUTS).map((l) => ({
        name: cleanName(l?.name),
        widgets: Array.isArray(l?.widgets) ? cleanWidgets(l.widgets) : defaultWidgets(),
      }));
      const active = Number.isInteger(raw.active) && raw.active >= 0 && raw.active < layouts.length ? raw.active : 0;
      return { v: 1, active, layouts };
    } catch {
      return defaultSet();
    }
  }
  // What the Overview shows. After a lapse the first layout shows at default sizes; this is display only.
  function view(set, access) {
    const s = normalize(set), lapsed = access === 'lapsed', index = lapsed ? 0 : s.active, layout = s.layouts[index];
    const lock = Object.hasOwn(LOCKS, access) ? LOCKS[access] : 'checking';
    return {
      index,
      name: layout.name,
      widgets: layout.widgets.map(({ id, size }) => ({ id, size: lapsed ? byId[id].size : size, locked: byId[id].tier === 'premium' ? lock : null })),
    };
  }

  // Applies `change` to a normalized copy when `index` is a layout. A refusal simply changes nothing; the copy is
  // normalized again, which also cleans new names and gives every layout its own widget entries.
  function edit(set, index, change) {
    const s = normalize(set);
    if (Number.isInteger(index) && index >= 0 && index < s.layouts.length) change(s, s.layouts[index]);
    return normalize(s);
  }
  const position = (list, id) => list.findIndex((w) => w.id === id);
  const move = (set, index, id, to) => edit(set, index, (s, l) => {
    const from = position(l.widgets, id);
    if (from < 0 || typeof to !== 'number' || Number.isNaN(to)) return;
    const [moved] = l.widgets.splice(from, 1);
    l.widgets.splice(Math.max(0, Math.min(l.widgets.length, Math.trunc(to))), 0, moved);
  });
  const remove = (set, index, id) => edit(set, index, (s, l) => { l.widgets = l.widgets.filter((w) => w.id !== id); });
  const add = (set, index, id, access) => edit(set, index, (s, l) => {
    const w = widget(id);
    if (w && position(l.widgets, id) < 0 && (w.tier === 'free' || access === 'active')) l.widgets.push({ id, size: w.size });
  });
  const resize = (set, index, id, size, access) => edit(set, index, (s, l) => {
    const entry = l.widgets.find((w) => w.id === id);
    if (access === 'active' && entry && byId[id].sizes.includes(size)) entry.size = size;
  });
  const select = (set, index, access) => edit(set, index, (s) => { if (access === 'active') s.active = index; });
  const duplicate = (set, index, name, access) => edit(set, index, (s, l) => {
    if (access !== 'active' || s.layouts.length >= MAX_LAYOUTS) return;
    s.layouts.push({ name, widgets: l.widgets });
    s.active = s.layouts.length - 1;
  });
  const rename = (set, index, name, access) => edit(set, index, (s, l) => { if (access === 'active') l.name = name; });
  const removeLayout = (set, index, access) => edit(set, index, (s) => {
    if (access !== 'active' || s.layouts.length < 2) return;
    s.layouts.splice(index, 1);
    if (s.active > index || s.active >= s.layouts.length) s.active -= 1;
  });
  const reset = (set, index) => edit(set, index, (s, l) => { l.widgets = defaultWidgets(); });

  return Object.freeze({
    WIDGETS, byId, SPAN, MAX_LAYOUTS, MAX_NAME,
    defaultSet, normalize, view, move, remove, add, resize, select, duplicate, rename, removeLayout, reset,
  });
});
