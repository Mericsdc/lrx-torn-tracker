// Pure, bounded analysis. No keys, network requests or game actions in this module.
const { tripMetrics } = require('../public/travel-math');
const fail = (code = 'INVALID_FEATURE_INPUT') => { throw Object.assign(new Error(code), { code, status: 400 }); };
const object = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : fail();
const number = (v, min, max, fallback) => v == null && fallback != null ? fallback : typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail();
const integer = (v, min, max, fallback) => { const n = number(v, min, max, fallback); return Number.isSafeInteger(n) ? n : fail(); };
const text = (v, max = 100, fallback = '') => v == null ? fallback : typeof v === 'string' && v.length <= max && !/[\u0000-\u001f]/.test(v) ? v.trim() : fail();
const choice = (v, values, fallback) => v == null ? fallback : values.includes(v) ? v : fail();
const list = (v, max) => Array.isArray(v) && v.length <= max ? v : fail();
const bool = (v, fallback = false) => v == null ? fallback : typeof v === 'boolean' ? v : fail();
const id = (v) => { const s = text(String(v), 100); return /^[a-zA-Z0-9:_-]+$/.test(s) && !['__proto__', 'prototype', 'constructor'].includes(s) ? s : fail(); };
const stamp = (v, now) => integer(v, 1, now + 60);
const THEMES = ['obsidian', 'ocean', 'forest', 'amethyst', 'light'];
const PRESETS = Object.freeze({
  eclipse: { bg: '#101019', panel: '#1c1c2a', text: '#f1efff', muted: '#b3b0ce', accent: '#b5a0ff' },
  aurora: { bg: '#071c20', panel: '#0f2b30', text: '#e2fff5', muted: '#9bc6c4', accent: '#68e0c2' },
  rose: { bg: '#1d1017', panel: '#301c26', text: '#ffeef4', muted: '#d4acbc', accent: '#ffacc9' },
});
function luminance(hex) { const c = hex.slice(1).match(/../g).map((s) => parseInt(s, 16) / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4); return c[0] * .2126 + c[1] * .7152 + c[2] * .0722; }
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
function numericMap(value, max, limit = 40) {
  const out = {};
  for (const [k, v] of Object.entries(object(value || {}))) { if (Object.keys(out).length >= limit || !/^[a-zA-Z0-9_-]{1,50}$/.test(k)) fail(); id(k); out[k] = integer(v, 0, max); }
  return out;
}
function rule(v, metrics) {
  v = object(v || {});
  return { enabled: bool(v.enabled), metric: choice(v.metric, metrics, metrics[0]), operator: choice(v.operator, ['gte', 'lte'], 'gte'), threshold: number(v.threshold, 0, 1e12, 80) };
}
function validateParams(feature, value = {}) {
  const p = object(value);
  if (feature === 'appearance_custom_themes') {
    const preset = choice(p.preset, ['custom', ...Object.keys(PRESETS)], 'eclipse');
    const palette = preset === 'custom' ? object(p.palette) : PRESETS[preset], colors = {};
    for (const k of ['bg', 'panel', 'text', 'muted', 'accent']) { if (!/^#[0-9a-f]{6}$/i.test(palette[k])) fail(); colors[k] = palette[k].toLowerCase(); }
    if (['bg', 'panel'].some((k) => contrast(colors.text, colors[k]) < 4.5 || contrast(colors.muted, colors[k]) < 3 || contrast(colors.accent, colors[k]) < 3)) fail('PALETTE_CONTRAST');
    return { preset, palette: colors, baseTheme: choice(p.baseTheme, THEMES, 'obsidian'), density: choice(p.density, ['comfortable', 'compact', 'spacious'], 'comfortable'), cards: choice(p.cards, ['glass', 'flat', 'outlined'], 'glass'), radius: integer(p.radius, 0, 24, 16) };
  }
  if (feature === 'travel_advanced') return {
    capacity: integer(p.capacity, 1, 100, 15), method: choice(p.method, ['Standard', 'Airstrip', 'Private', 'Business'], 'Standard'),
    waitMinutes: number(p.waitMinutes, 0, 1440, 0), feePercent: number(p.feePercent, 0, 100, 0), sellChangePercent: number(p.sellChangePercent, -100, 100, 0), fixedCosts: number(p.fixedCosts, 0, 1e10, 0),
    countries: list(p.countries || [], 30).map((s) => text(s, 10)), maxFlight: number(p.maxFlight, 0, 1000, 0), minProfit: number(p.minProfit, 0, 1e12, 0), onlyInStock: bool(p.onlyInStock, true),
    watchKey: text(p.watchKey, 100), rule: rule(p.rule, ['buyPrice', 'sellPrice', 'hourlyProfit']),
  };
  if (feature === 'helpers_advanced') {
    const out = { minLevel: integer(p.minLevel, 0, 100, 0), maxLevel: integer(p.maxLevel, 1, 100, 100), minStats: number(p.minStats, 0, 1e18, 0), maxStats: number(p.maxStats, 0, 1e18, 1e18), minFF: number(p.minFF, 0, 100, 0), maxFF: number(p.maxFF, 0, 100, 100), status: choice(p.status, ['all', 'Okay', 'Hospital', 'Traveling', 'Abroad', 'Jail'], 'all'), group: text(p.group, 60), sort: choice(p.sort, ['stats', 'level', 'ff'], 'stats'), includeUnknown: bool(p.includeUnknown, true), compare: list(p.compare || [], 4).map((n) => integer(n, 1, Number.MAX_SAFE_INTEGER)), columns: list(p.columns || ['level', 'stats', 'ff', 'status'], 6).map((s) => choice(s, ['level', 'stats', 'ff', 'status', 'ratio', 'lastAction'])), rule: rule(p.rule, ['energyPercent', 'lifePercent', 'drugSeconds', 'matchingPlayers']) };
    if (out.minLevel > out.maxLevel || out.minStats > out.maxStats || out.minFF > out.maxFF) fail(); return out;
  }
  if (feature === 'events_advanced') return { eventKey: text(p.eventKey, 100), goal: number(p.goal, 1, 1e10, 100), manualProgress: number(p.manualProgress, 0, 1e10, 0), useManual: bool(p.useManual), reminderMinutes: integer(p.reminderMinutes, 0, 10080, 60), notifyPercent: number(p.notifyPercent, 1, 100, 90), notifications: bool(p.notifications) };
  if (feature === 'merits_optimizer') return { budget: integer(p.budget, 0, 1000, 20), goal: choice(p.goal, ['balanced', 'education', 'income', 'combat', 'crime', 'work'], 'balanced'), priorities: numericMap(p.priorities, 10), targets: numericMap(p.targets, 10), comparison: numericMap(p.comparison, 10), manual: bool(p.manual), manualLevels: numericMap(p.manualLevels, 10) };
  fail('UNKNOWN_FEATURE');
}
function threshold(rule, metrics, key) {
  const n = metrics[rule.metric];
  if (!rule.enabled || !Number.isFinite(n) || !(rule.operator === 'gte' ? n >= rule.threshold : n <= rule.threshold)) return [];
  return [{ key, metric: rule.metric, value: n, threshold: rule.threshold, cooldown: 3600 }];
}
function travel(p, input, now, history) {
  const rows = list(input.items, 500).map((v) => {
    const r = object(v), market = r.market == null ? null : number(r.market, 0, 1e12), cost = number(r.cost, 0, 1e12);
    return { key: id(r.key), name: text(r.name), country: text(r.country, 60), code: text(r.code, 10), cost, market, qty: integer(r.qty, 0, 1e9), minutes: number(r.minutes, .1, 1000), at: stamp(r.at, now), source: choice(r.source, ['YATA', 'Prometheus'], 'YATA') };
  });
  const mult = { Standard: 1, Airstrip: .7, Private: .5, Business: .3 }[p.method];
  const candidates = rows.filter((r) => r.market != null && (!p.countries.length || p.countries.includes(r.code)) && (!p.maxFlight || r.minutes * mult <= p.maxFlight) && (!p.onlyInStock || r.qty > 0));
  const ranked = candidates.map((r) => {
    const baseline = tripMetrics(r.market - r.cost, p.capacity, r.qty, r.minutes * mult);
    const sale = r.market * (1 + p.sellChangePercent / 100) * (1 - p.feePercent / 100);
    const scenario = tripMetrics(sale - r.cost, p.capacity, r.qty, r.minutes * mult, p.waitMinutes, p.fixedCosts);
    return { ...r, baseline, scenario, stale: now - r.at > 900, stockAssumed: r.qty === 0 };
  }).filter((r) => r.scenario.perHour >= p.minProfit).sort((a, b) => b.scenario.perHour - a.scenario.perHour || a.key.localeCompare(b.key));
  const chosen = p.watchKey ? rows.find((r) => r.key === p.watchKey) : ranked[0];
  const watched = ranked.find((r) => r.key === chosen?.key);
  const alerts = chosen && now - chosen.at <= 900 ? threshold(p.rule, { buyPrice: chosen.cost, sellPrice: chosen.market, hourlyProfit: watched?.scenario.perHour }, 'travel:' + chosen.key) : [];
  return { result: { routes: ranked.slice(0, 30), countries: [...new Set(ranked.map((r) => r.code))].map((code) => ranked.find((r) => r.code === code)), chartKey: chosen?.key || null, history: history.filter((h) => h.seriesKey === chosen?.key).map((h) => ({ at: h.at, ...h.data })), alerts, source: 'YATA / Prometheus observations + Torn market value; availability and proceeds are not guaranteed.' }, observations: chosen ? [{ key: chosen.key, at: chosen.at, data: { name: chosen.name, cost: chosen.cost, market: chosen.market, qty: chosen.qty, source: chosen.source } }] : [] };
}
function helpers(p, input, now) {
  const observedAt = stamp(input.observedAt, now), ownStats = input.ownStats == null ? null : number(input.ownStats, 0, 1e18);
  // Roster refreshes must not make stale overview bars look current, or vice versa.
  const metricsObservedAt = input.metricsObservedAt === undefined ? observedAt : input.metricsObservedAt == null ? null : stamp(input.metricsObservedAt, now);
  const players = list(input.players, 250).map((value) => { const r = object(value); return { id: integer(r.id, 1, Number.MAX_SAFE_INTEGER), name: text(r.name, 80), level: r.level == null ? null : integer(r.level, 1, 100), stats: r.stats == null ? null : number(r.stats, 0, 1e18), ff: r.ff == null ? null : number(r.ff, 0, 100), status: text(r.status, 30), group: text(r.group, 60), lastAction: r.lastAction == null ? null : stamp(r.lastAction, now), estimated: bool(r.estimated, true), ratio: ownStats > 0 && r.stats != null ? r.stats / ownStats : null }; });
  const between = (v, lo, hi) => v == null ? p.includeUnknown : v >= lo && v <= hi;
  const matches = players.filter((r) => between(r.level, p.minLevel, p.maxLevel) && between(r.stats, p.minStats, p.maxStats) && between(r.ff, p.minFF, p.maxFF) && (p.status === 'all' || r.status === p.status) && (!p.group || r.group.toLowerCase().includes(p.group.toLowerCase()))).sort((a, b) => (b[p.sort] ?? -1) - (a[p.sort] ?? -1) || a.id - b.id);
  const metrics = { matchingPlayers: input.hasPlayerData === false ? null : matches.length };
  for (const k of ['energyPercent', 'lifePercent', 'drugSeconds']) if (input.metrics?.[k] != null) metrics[k] = number(input.metrics[k], 0, k === 'drugSeconds' ? 1e8 : 1e5);
  const alertAt = p.rule.metric === 'matchingPlayers' ? observedAt : metricsObservedAt;
  return { result: { matches, comparison: p.compare.map((id) => players.find((r) => r.id === id)).filter(Boolean), columns: p.columns, observedAt, metricsObservedAt, stale: now - observedAt > 120, alerts: alertAt != null && now - alertAt <= 120 ? threshold(p.rule, metrics, 'helpers:' + p.rule.metric) : [], source: 'Existing desktop target estimates and cached overview; unknown values remain unknown.' }, observations: [] };
}
function events(p, input, now, history) {
  const rows = list(input.events, 100).map((r) => ({ key: id(r.key), title: text(r.title), start: stamp(r.start, now + 366 * 86400), end: stamp(r.end, now + 366 * 86400), exact: bool(r.exact), progress: r.progress == null ? null : number(r.progress, 0, 1e10), at: stamp(r.at, now) }));
  const e = rows.find((e) => e.key === p.eventKey); if (!e || e.end < e.start) fail('EVENT_NOT_AVAILABLE');
  const current = p.useManual ? p.manualProgress : e.progress;
  const source = p.useManual ? 'manual' : current == null ? 'unavailable' : 'desktop-api-snapshot';
  const at = p.useManual ? now : e.at, series = history.filter((h) => h.seriesKey === e.key && h.data.source === source).sort((a, b) => a.at - b.at);
  const first = series.find((h) => h.at < at && h.data.current <= current), hours = first ? (at - first.at) / 3600 : 0;
  const rate = current != null && hours >= 1 ? (current - first.data.current) / hours : null;
  const remaining = current == null ? null : Math.max(0, p.goal - current), pct = current == null ? null : Math.min(100, current / p.goal * 100);
  const comparisons = [...new Set(history.map((h) => h.seriesKey))].map((key) => history.filter((h) => h.seriesKey === key).sort((a, b) => b.at - a.at)[0]).map((h) => ({ key: h.seriesKey, title: h.data.title, current: h.data.current, goal: h.data.goal, source: h.data.source, at: h.at }));
  const alerts = [];
  if (p.notifications && e.exact && e.start >= now && e.start - now <= p.reminderMinutes * 60) alerts.push({ key: 'event-start:' + e.key, metric: 'eventStartsMinutes', value: Math.ceil((e.start - now) / 60), cooldown: 366 * 86400 });
  if (p.notifications && pct != null && pct >= p.notifyPercent && now - at <= 600 && now <= e.end) alerts.push({ key: 'event-goal:' + e.key + ':' + p.goal, metric: 'goalPercent', value: pct, cooldown: 366 * 86400 });
  return { result: { event: e, current, goal: p.goal, remaining, pct, source, perHour: rate, requiredPerDay: remaining != null && e.end > now ? remaining / ((e.end - Math.max(now, e.start)) / 86400) : null, estimatedHours: rate > 0 ? remaining / rate : null, history: series, comparisons, alerts }, observations: current == null ? [] : [{ key: e.key, at, data: { title: e.title, start: e.start, end: e.end, current, goal: p.goal, source } }] };
}
const cost = (level) => level * (level + 1) / 2;
function merits(p, input, now, history) {
  const tracks = list(input.tracks, 40).map((v) => ({ id: id(v.id), name: text(v.name, 80), description: text(v.description, 400), level: integer(v.level, 0, 10) }));
  if (!tracks.length || new Set(tracks.map((v) => v.id)).size !== tracks.length) fail();
  for (const map of [p.targets, p.comparison, p.priorities]) for (const key of Object.keys(map)) if (!tracks.some((t) => t.id === key)) fail('MERIT_TRACK_CHANGED');
  const preferred = { education: /education/i, income: /bank|awareness/i, combat: /brawn|protection|sharpness|evasion|life|critical|mastery/i, crime: /nerve|crime/i, work: /employee|addiction/i }[p.goal];
  const weight = (t) => p.priorities[t.id] ?? (preferred ? (preferred.test(t.name) ? 3 : 0) : 1);
  // Exact multiple-choice knapsack over upgrade ranks; objective is user priority points.
  let dp = new Map([[0, { score: 0, levels: [] }]]);
  for (const t of tracks) {
    const next = new Map();
    for (const [spent, state] of dp) for (let rank = t.level; rank <= 10; rank++) {
      const total = spent + cost(rank) - cost(t.level); if (total > p.budget) break;
      const score = state.score + (rank - t.level) * weight(t);
      if (!next.has(total) || next.get(total).score < score) next.set(total, { score, levels: [...state.levels, rank] });
    }
    dp = next;
  }
  const [spent, best] = [...dp].sort(([a, x], [b, y]) => y.score - x.score || a - b)[0];
  function distribution(map) { const rows = tracks.map((t) => { const target = Math.max(t.level, map[t.id] ?? t.level); return { ...t, target, cost: cost(target) - cost(t.level), priority: weight(t), alreadyMet: map[t.id] != null && map[t.id] < t.level }; }); const total = rows.reduce((n, r) => n + r.cost, 0); return { rows, cost: total, missing: Math.max(0, total - p.budget), remaining: Math.max(0, p.budget - total) }; }
  const recommended = distribution(Object.fromEntries(tracks.map((t, i) => [t.id, best.levels[i]])));
  const at = stamp(input.observedAt, now), available = input.available == null ? null : integer(input.available, 0, 10000), awards = input.awards == null ? null : integer(input.awards, 0, 100000);
  return { result: { recommended, planned: distribution(p.targets), comparison: distribution(p.comparison), score: best.score, spent, available, budgetExceedsAvailable: available != null && p.budget > available, history, source: choice(input.source, ['manual', 'desktop-api-snapshot'], 'manual'), mechanics: { checkedAt: '2026-11-11', url: 'https://wiki.torn.com/wiki/Merit', maximumRank: 10, fullTrackCost: 55 }, alerts: [] }, observations: [{ key: 'merits', at, data: { available, awards, levels: Object.fromEntries(tracks.map((t) => [t.id, t.level])), source: input.source || 'manual' } }] };
}
function analyze(feature, params, value, now, history = []) {
  const input = object(value || {});
  if (feature === 'appearance_custom_themes') return { result: { ...params, alerts: [] }, observations: [] };
  if (feature === 'travel_advanced') return travel(params, input, now, history);
  if (feature === 'helpers_advanced') return helpers(params, input, now);
  if (feature === 'events_advanced') return events(params, input, now, history);
  if (feature === 'merits_optimizer') return merits(params, input, now, history);
  fail('UNKNOWN_FEATURE');
}
module.exports = { validateParams, analyze, PRESETS, contrast };
