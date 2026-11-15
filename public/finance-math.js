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

  return Object.freeze({
    NW_GROUPS, NW_TRIGGERS, daysApart, periodStart, nwChange, nwPrevChange, nwGroups, nwMovers, recordChanges, nwStats,
    nextMilestone, coWindow, coPrevWindow, coTotals, pctChange, coChange, breakEven, productSeries, chartDays,
  });
});
