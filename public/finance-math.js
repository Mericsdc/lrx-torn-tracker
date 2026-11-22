/* Finance page calculations (public/finance.js). Pure functions, no DOM.
   Records are { date: 'YYYY-MM-DD', ... }, oldest first: one networth record per day the app ran
   (/api/networth history) and one company record per 18:00 TCT day (/api/company days). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXFinanceMath = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const DAY = 86400_000;
  // Torn's networth parts in four groups; any numeric part Torn adds later lands in "other".
  const NW_GROUPS = Object.freeze([
    ['cash', ['wallet', 'bank', 'cayman', 'vault', 'piggybank']],
    ['market', ['items', 'displaycase', 'bazaar', 'itemmarket', 'trade', 'auctionhouse', 'points']],
    ['invest', ['stockmarket', 'properties', 'company', 'enlistedcars', 'bookie']],
    ['other', ['pending', 'loan', 'unpaidfees']],
  ]);
  // Torn's networth rank triggers (the same list rankEstimate() uses in src/server/server.js).
  const NW_TRIGGERS = Object.freeze([5e6, 5e7, 5e8, 5e9, 5e10]);
  const NOT_PARTS = new Set(['total', 'date', 'at', 'parsetime', 'timestamp']);
  const KNOWN = new Set(NW_GROUPS.flatMap(([, keys]) => keys));

  const dayMs = (date) => Date.parse(`${date}T00:00:00Z`);
  const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
  const daysApart = (a, b) => Math.round((dayMs(b.date) - dayMs(a.date)) / DAY);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  // 1 day: the record dated exactly one day before the last; otherwise the oldest record inside the last n days.
  function periodStart(hist, days) {
    const last = hist?.[hist.length - 1];
    if (!last) return null;
    const from = isoDay(dayMs(last.date) - days * DAY);
    return (days === 1 ? hist.find((r) => r.date === from) : hist.find((r) => r.date >= from && r !== last)) || null;
  }
  function nwChange(hist, total, days) {
    const start = periodStart(hist, days);
    if (!start || !Number.isFinite(Number(total))) return null;
    const change = Number(total) - num(start.total);
    const covered = daysApart(start, hist[hist.length - 1]);
    return { start, change, pct: start.total ? change / Math.abs(start.total) : null, perDay: covered > 0 ? change / covered : null, covered };
  }
  // The change over the same-length window that ends where the period starts. Not for 1Y: no older year is kept.
  // Null unless those records cover at least as many days as the period's own change does (like with like).
  function nwPrevChange(hist, days) {
    if (days >= 365) return null;
    const start = periodStart(hist, days);
    if (!start) return null;
    const from = isoDay(dayMs(start.date) - days * DAY);
    const prev = days === 1 ? hist.find((r) => r.date === from) : hist.find((r) => r.date >= from && r.date < start.date);
    if (!prev || daysApart(prev, start) < daysApart(start, hist[hist.length - 1])) return null;
    return num(start.total) - num(prev.total);
  }

  // Every part key in either record, known groups first (in list order), unknown numeric keys after.
  function partKeys(...recs) {
    const extra = [];
    for (const r of recs) for (const [k, v] of Object.entries(r || {})) {
      if (!NOT_PARTS.has(k) && !KNOWN.has(k) && typeof v === 'number' && !extra.includes(k)) extra.push(k);
    }
    return extra;
  }
  function nwGroups(current, start) {
    const extra = partKeys(current, start);
    return NW_GROUPS.map(([key, keys]) => {
      const all = key === 'other' ? [...keys, ...extra] : keys;
      const rows = all.map((k) => ({ key: k, value: num(current?.[k]), change: start ? num(current?.[k]) - num(start[k]) : null }));
      return {
        key,
        total: rows.reduce((a, r) => a + r.value, 0),
        change: start ? rows.reduce((a, r) => a + r.change, 0) : null,
        parts: rows.filter((r) => r.value !== 0 || r.change).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
      };
    });
  }
  function moversBetween(a, b) {
    const keys = [...KNOWN, ...partKeys(a, b)];
    return keys.map((k) => ({ key: k, change: num(b?.[k]) - num(a?.[k]) })).filter((m) => m.change !== 0)
      .sort((x, y) => Math.abs(y.change) - Math.abs(x.change));
  }
  function nwMovers(current, start, limit = 5) {
    return start ? moversBetween(start, current).slice(0, limit) : [];
  }
  function recordChanges(hist) {
    return (hist || []).slice(1).map((r, i) => {
      const prev = hist[i];
      return { date: r.date, total: num(r.total), change: num(r.total) - num(prev.total), span: daysApart(prev, r), mover: moversBetween(prev, r)[0] || null };
    });
  }
  // Best / worst day after the start: only one-day steps count as days.
  function nwStats(hist, start) {
    const steps = start ? recordChanges(hist).filter((c) => c.date > start.date && c.span === 1) : [];
    let best = null, worst = null;
    for (const c of steps) {
      if (c.change > 0 && (!best || c.change > best.change)) best = { date: c.date, change: c.change };
      if (c.change < 0 && (!worst || c.change < worst.change)) worst = { date: c.date, change: c.change };
    }
    return { best, worst, up: steps.filter((c) => c.change > 0).length, count: steps.length };
  }
  function nextMilestone(total, perDay) {
    if (total == null || !Number.isFinite(Number(total))) return null;
    const t = Number(total);
    const i = NW_TRIGGERS.findIndex((x) => x > t);
    if (i < 0) return { done: true };
    const target = NW_TRIGGERS[i], from = i ? NW_TRIGGERS[i - 1] : 0;
    return { target, from, progress: Math.min(1, Math.max(0, (t - from) / (target - from))), days: perDay > 0 ? Math.ceil((target - t) / perDay) : null };
  }

  // Company day records dated within the last n days of the latest one (n = Infinity: all of them).
  function coWindow(days, n) {
    const last = days?.[days.length - 1];
    if (!last) return [];
    if (n === Infinity) return days.slice();
    const after = isoDay(dayMs(last.date) - n * DAY);
    return days.filter((r) => r.date > after);
  }
  function coPrevWindow(days, n) {
    const last = days?.[days.length - 1];
    if (!last || n === Infinity) return [];
    const end = isoDay(dayMs(last.date) - n * DAY), after = isoDay(dayMs(last.date) - 2 * n * DAY);
    return days.filter((r) => r.date > after && r.date <= end);
  }
  function coTotals(rows) {
    const t = { days: rows.length, revenue: 0, cogs: 0, gross: 0, wages: 0, ads: 0, net: 0, customers: 0, estimated: false };
    for (const r of rows) {
      t.revenue += num(r.revenue); t.cogs += num(r.cogs); t.wages += num(r.wages); t.ads += num(r.ads);
      t.net += num(r.net); t.customers += num(r.customers); t.estimated ||= !!r.cogsEstimated;
    }
    t.gross = t.revenue - t.cogs;
    return t;
  }
  const pctChange = (now, before) => (now == null || before == null || !before ? null : (now - before) / Math.abs(before));
  // Change of one coTotals() field between two windows, per recorded day: a previous window with fewer
  // day records (a new company, days the app was off) is compared fairly instead of as a smaller sum.
  const coChange = (now, prev, key) => (!now?.days || !prev?.days ? null : pctChange(num(now[key]) / now.days, num(prev[key]) / prev.days));
  // Revenue per day that covers wages and ads after the cost of goods share.
  function breakEven(t) {
    if (!t?.days || !(t.revenue > 0)) return null;
    const share = t.cogs / t.revenue;
    if (share >= 1) return null;
    const perDay = ((t.wages + t.ads) / t.days) / (1 - share), avgRevenue = t.revenue / t.days;
    return { perDay, avgRevenue, gap: avgRevenue - perDay };
  }
  function productSeries(days, name, n = 30) {
    return coWindow(days, n).filter((r) => r.products?.[name]).map((r) => ({ date: r.date, v: num(r.products[name].worth) }));
  }
  const chartDays = (days, n) => coWindow(days, Math.min(90, Math.max(7, n)));

  // Holdings card (/api/holdings, src/server/holdings.js): places and the networth part each one makes up.
  const HOLD_PLACES = Object.freeze(['inventory', 'bazaar', 'display', 'itemmarket', 'stocks']);
  const HOLD_PART = Object.freeze({ inventory: 'items', bazaar: 'bazaar', display: 'displaycase', itemmarket: 'itemmarket', stocks: 'stockmarket' });
  // One place, or 'all' with one item merged across places. Rows worth nothing are counted (zero), not listed.
  function holdingsView(h, place = 'all') {
    const key = HOLD_PLACES.includes(place) ? place : 'all';
    const P = h?.places || {};
    const places = HOLD_PLACES.filter((k) => P[k]).map((k) => {
      const p = P[k];
      return { key: k, ok: !!p.ok, total: p.ok ? num(p.total) : 0, count: p.ok ? (p.rows || []).length : 0, partial: !!p.partial, error: p.ok ? null : String(p.error || ''), code: p.code || null, stale: p.ok && p.stale != null ? String(p.stale) : null };
    });
    const view = (rows, partial, extra = {}) => {
      const priced = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name)));
      const total = priced.reduce((a, r) => a + r.value, 0);
      for (const r of priced) r.share = total > 0 ? r.value / total : 0;
      return { place: key, total, rows: priced, biggest: priced[0] || null, partial, zero: rows.length - priced.length, places, ...extra };
    };
    if (key !== 'all') {
      const p = P[key];
      if (!p?.ok) return view([], false, { error: p ? String(p.error || '') : '', code: p?.code || null });
      return view((p.rows || []).map((r) => ({ ...r, value: num(r.value), places: [key] })), !!p.partial);
    }
    const by = new Map();
    let partial = false;
    for (const k of HOLD_PLACES) {
      const p = P[k];
      if (!p?.ok) continue;
      partial ||= !!p.partial;
      for (const r of p.rows || []) {
        const m = by.get(r.id) || by.set(r.id, { id: r.id, name: r.name, type: r.type, qty: 0, value: 0, places: [] }).get(r.id);
        m.qty += num(r.qty);
        m.value += num(r.value);
        if (!m.places.includes(k)) m.places.push(k);
      }
    }
    return view([...by.values()].map((r) => ({ ...r, unit: r.qty ? r.value / r.qty : 0 })), partial);
  }
  // The view's total against Torn's own networth figure for the same place(s); null when it can't be compared
  // (a failed, partial or stale place, or no networth).
  function holdingsCompare(view, current) {
    if (!view || view.error != null || view.partial || !current) return null;
    if (view.places.some((p) => p.stale != null && (view.place === 'all' || p.key === view.place))) return null;
    const keys = view.place === 'all' ? view.places.filter((p) => p.ok).map((p) => HOLD_PART[p.key]) : [HOLD_PART[view.place]];
    const torn = keys.reduce((a, k) => a + num(current[k]), 0);
    const diff = view.total - torn;
    return { torn, diff, off: Math.abs(diff) > 0.02 * Math.abs(torn) };
  }
  // A new reply over the last one: a place that failed now but had rows before keeps those rows, marked
  // stale with the new reason (a rate limit or a Torn outage on Refresh does not empty the card).
  function holdingsMerge(prev, next) {
    if (!prev?.places || !next?.places) return next;
    const places = {};
    for (const [k, n] of Object.entries(next.places)) {
      const p = prev.places[k];
      places[k] = !n?.ok && p?.ok ? { ...p, stale: String(n?.error || '') } : n;
    }
    return { ...next, places };
  }
  // Price effect vs trading (Holdings › Change): each item's value change since a start record
  // ({ places: { place: { id: [qty, unit] } } }, src/server/holdings-days.js), split with no remainder into
  //   price = qty now × (unit now − unit then)   Torn's prices moving, on what is still held
  //   trade = (qty now − qty then) × unit then   buying, selling, listing, moving between places
  // An item new to a place takes its start unit from where it was at the start (moved Items → Bazaar: still price
  // effect); only an item held nowhere at the start counts at today's unit (all of it bought). Only places that loaded
  // in full now and have a start record count; the others are listed in `excluded` (a stale place: 'failed').
  function holdingsChange(h, start, names = {}, place = 'all') {
    const P = h?.places || {}, S = start?.places || {};
    const counted = [], excluded = [], byPlace = {}, perPlace = {};
    const startQ = new Map(), startV = new Map(); // per id over every place in the start record
    for (const s of Object.values(S)) for (const [key, then] of Object.entries(s && typeof s === 'object' ? s : {})) {
      if (!Array.isArray(then) || !(num(then[0]) > 0)) continue;
      startQ.set(key, (startQ.get(key) || 0) + num(then[0]));
      startV.set(key, (startV.get(key) || 0) + num(then[0]) * num(then[1]));
    }
    for (const k of HOLD_PLACES) {
      const p = P[k], s = S[k] && typeof S[k] === 'object' ? S[k] : null;
      if (!p) { if (s && Object.keys(s).length) excluded.push({ key: k, why: 'failed' }); continue; }
      if (!p.ok || p.stale != null) { excluded.push({ key: k, why: 'failed' }); continue; }
      if (p.partial) { excluded.push({ key: k, why: 'partial' }); continue; }
      if (!s) { if ((p.rows || []).length) excluded.push({ key: k, why: 'nostart' }); continue; }
      counted.push(k);
      const cur = new Map((p.rows || []).map((r) => [String(r.id), r]));
      perPlace[k] = [...new Set([...Object.keys(s), ...cur.keys()])].map((key) => {
        const r = cur.get(key), then = Array.isArray(s[key]) ? s[key] : [0, 0];
        const q0 = num(then[0]), q1 = num(r?.qty), v1 = num(r?.value);
        const u1 = q1 ? v1 / q1 : null, u0 = q0 > 0 ? num(then[1]) : startQ.has(key) ? startV.get(key) / startQ.get(key) : (u1 ?? 0);
        return {
          key, id: r ? r.id : key, name: r?.name || names[key]?.[0] || `#${key}`, type: r?.type || names[key]?.[1] || '', places: [k],
          q0, q1, V0: q0 * u0, V1: v1, price: q1 ? q1 * (u1 - u0) : 0, trade: (q1 - q0) * u0, total: v1 - q0 * u0,
        };
      });
      byPlace[k] = perPlace[k].reduce((a, r) => a + r.total, 0);
    }
    let rows;
    if (place !== 'all') rows = perPlace[place] || [];
    else {
      const by = new Map();
      for (const k of counted) for (const r of perPlace[k]) {
        const m = by.get(r.key);
        if (!m) { by.set(r.key, { ...r, places: [k] }); continue; }
        for (const f of ['q0', 'q1', 'V0', 'V1', 'price', 'trade', 'total']) m[f] += r[f];
        m.places.push(k);
      }
      rows = [...by.values()];
    }
    const sum = (f) => rows.reduce((a, r) => a + r[f], 0);
    const out = rows.map(({ key, V0, V1, ...r }) => ({ ...r, u0: r.q0 ? V0 / r.q0 : null, u1: r.q1 ? V1 / r.q1 : null }));
    const moved = out.filter((r) => Math.abs(r.price) >= 0.5 || Math.abs(r.trade) >= 0.5 || Math.abs(r.total) >= 0.5)
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total) || Math.abs(b.price) - Math.abs(a.price) || String(a.name).localeCompare(String(b.name)));
    return { place, rows: moved, price: sum('price'), trade: sum('trade'), total: sum('total'), byPlace, counted, excluded, unchanged: out.length - moved.length };
  }
  // The networth change since the start record = the price effect on everything held + the rest (trading profit,
  // income, spending). Only for All with every place counted: an excluded place's change would land in the rest.
  function holdingsTie(chg, nwNow, nwStart) {
    if (!chg || chg.place !== 'all' || chg.excluded?.length || !Number.isFinite(nwNow) || !Number.isFinite(nwStart)) return null;
    const change = nwNow - nwStart;
    return { change, price: chg.price, rest: change - chg.price };
  }

  return Object.freeze({
    NW_GROUPS, NW_TRIGGERS, daysApart, periodStart, nwChange, nwPrevChange, nwGroups, nwMovers, recordChanges, nwStats,
    nextMilestone, coWindow, coPrevWindow, coTotals, pctChange, coChange, breakEven, productSeries, chartDays,
    HOLD_PLACES, HOLD_PART, holdingsView, holdingsCompare, holdingsMerge, holdingsChange, holdingsTie,
  });
});
