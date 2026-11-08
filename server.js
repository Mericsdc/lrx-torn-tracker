/**
 * Torn Tracker – yerel sunucu
 * - Statik arayüzü (public/) sunar
 * - Torn API ve FFScouter isteklerini sunucu tarafında yapar (API key tarayıcıya gitmez)
 * - Şirket verisinden günlük snapshot alır (data/history.json) -> günlük rapor & gelir tablosu
 *
 * Bağımlılık yok: Node 18+ (global fetch) yeterli.  Çalıştır: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 3737;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.TORN_DATA_DIR || path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA, 'config.json');
const HISTORY_FILE = path.join(DATA, 'history.json');
const XANAX_PENALTY = 35; // Xanax: tüm savaş statlarına -%35

if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

/* ------------------------------------------------------------------ */
/* Config & history                                                    */
/* ------------------------------------------------------------------ */
const DEFAULT_UPDATE_URL = (() => { try { return require('./package.json').updateUrl || ''; } catch { return ''; } })();
const DEFAULT_CONFIG = { apiKey: process.env.TORN_API_KEY || '', ffscouterKey: '', coverDays: 3, pollMinutes: 15, deliveryHours: 6, deliveryMode: 'hours', updateUrl: '', features: {} };

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj, pretty = false) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj)); // büyük dosyalar sıkışık (yarı boyut)
  fs.renameSync(tmp, file);
}

let config = { ...DEFAULT_CONFIG, ...readJson(CONFIG_FILE, {}) };
let history = readJson(HISTORY_FILE, { days: [], addiction: {}, user: {}, stockOrders: {} });
history.days ||= []; history.addiction ||= {}; history.user ||= {}; history.stockOrders ||= {};
history.stockDeliveries ||= { at: 0, items: [] };

const saveConfig = () => writeJson(CONFIG_FILE, config, true);
// Geçmiş her yenilemede değil, 10 sn içindeki değişiklikler toplanıp tek seferde yazılır
let historyTimer = null;
function flushHistory() {
  clearTimeout(historyTimer);
  historyTimer = null;
  try { writeJson(HISTORY_FILE, history); } catch (e) { console.warn('[history]', e.message); }
}
const saveHistory = () => { if (!historyTimer) historyTimer = setTimeout(flushHistory, 10_000); };
const ffKey = () => config.ffscouterKey || config.apiKey;

/** Torn şirket günü her gün 18:00 TCT (UTC)'de yenilenir */
const tctDate = (ms = Date.now()) => new Date(ms - 18 * 3600_000).toISOString().slice(0, 10);
function next18TctMs(ms = Date.now()) {
  const d = new Date(ms);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 18, 0, 0, 0);
  return ms < t ? t : t + 86400_000;
}

/* ------------------------------------------------------------------ */
/* Torn API (cache + rate limit)                                       */
/* ------------------------------------------------------------------ */
class ApiError extends Error {
  constructor(message, code, source = 'torn') { super(message); this.code = code; this.source = source; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const callLog = [];
const RATE_MAX = 80; // Torn limiti 100/dk – güvenli pay bırak
async function throttle() {
  for (;;) {
    const now = Date.now();
    while (callLog.length && now - callLog[0] > 60_000) callLog.shift();
    if (callLog.length < RATE_MAX) { callLog.push(now); return; }
    await sleep(60_000 - (now - callLog[0]) + 50);
  }
}

const cache = new Map(); // key -> { t, ttl, data, promise }
async function cached(key, ttl, loader) {
  const c = cache.get(key);
  if (c && c.data !== undefined && Date.now() - c.t < ttl) return c.data;
  if (c && c.promise) return c.promise;
  const promise = (async () => {
    try {
      const data = await loader();
      cache.set(key, { t: Date.now(), data });
      return data;
    } catch (e) {
      cache.delete(key);
      throw e;
    }
  })();
  cache.set(key, { ...(c || {}), promise });
  return promise;
}

async function tornRaw(pathq) {
  if (!config.apiKey) throw new ApiError('API key ayarlanmamış. Ayarlar sekmesinden ekleyin.', 'NO_KEY');
  await throttle();
  const sep = pathq.includes('?') ? '&' : '?';
  const url = `https://api.torn.com/${pathq}${sep}key=${encodeURIComponent(config.apiKey)}&comment=TornTracker`;
  const res = await fetch(url, { headers: { 'User-Agent': 'TornTracker/1.0' } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new ApiError(`Torn API yanıtı okunamadı (HTTP ${res.status})`, 'BAD_RESPONSE'); }
  if (json.error) throw new ApiError(`Torn API: ${json.error.error}`, json.error.code);
  return json;
}
const torn = (pathq, ttl = 30_000) => cached('torn:' + pathq, ttl, () => tornRaw(pathq));

/* ------------------------------------------------------------------ */
/* Battle stats helpers                                                */
/* ------------------------------------------------------------------ */
const STATS = ['strength', 'defense', 'speed', 'dexterity'];

function parseInfo(lines = []) {
  return lines.map((l) => {
    const m = String(l).match(/([+-]?\d+(?:\.\d+)?)%/);
    return { text: l, pct: m ? Number(m[1]) : 0, xanax: /xanax/i.test(l) };
  });
}

function buildBattleStats(u) {
  const out = { stats: {}, totals: {} };
  let base = 0, current = 0, noXan = 0, withXan = 0;
  for (const s of STATS) {
    const raw = Number(u[s]) || 0;
    const info = parseInfo(u[`${s}_info`]);
    const modCurrent = Number(u[`${s}_modifier`]) || 0;
    const xanInModifier = info.filter((i) => i.xanax).reduce((a, i) => a + i.pct, 0);
    const modNoXan = modCurrent - xanInModifier; // Xanax etkisini çıkar
    const modXan = modNoXan - XANAX_PENALTY;
    const st = {
      base: raw,
      modifier: modCurrent,
      info,
      current: Math.round(raw * (1 + modCurrent / 100)),
      noXanax: Math.round(raw * (1 + modNoXan / 100)),
      withXanax: Math.round(raw * (1 + modXan / 100)),
    };
    out.stats[s] = st;
    base += raw; current += st.current; noXan += st.noXanax; withXan += st.withXanax;
  }
  out.totals = { base, current, noXanax: noXan, withXanax: withXan };
  out.xanaxActive = STATS.some((s) => out.stats[s].info.some((i) => i.xanax));
  return out;
}

/* ------------------------------------------------------------------ */
/* Overview (user)                                                     */
/* ------------------------------------------------------------------ */
async function getEducationNames() {
  if (history.eduNames && Object.keys(history.eduNames).length > 10) return history.eduNames;
  return cached('edu-names', 24 * 3600_000, async () => {
    const j = await tornRaw('torn/?selections=education');
    const map = {};
    for (const [id, e] of Object.entries(j.education || {})) map[id] = { name: e.name, code: e.code, duration: e.duration };
    history.eduNames = map;
    saveHistory();
    return map;
  });
}

async function getOverview(force = false) {
  const q = 'user/?selections=profile,cooldowns,education,battlestats,bars,icons,personalstats,travel,timestamp';
  if (force) cache.delete('torn:' + q);
  const [u, eduNames] = await Promise.all([
    torn(q, 25_000),
    getEducationNames().catch(() => history.eduNames || {}),
  ]);

  const icons = u.icons || {};
  const iconList = Object.values(icons).map(String);
  const drugIcon = iconList.find((t) => /^drug/i.test(t) || /drug cooldown/i.test(t)) || null;
  const bs = buildBattleStats(u);
  const xanaxFromIcon = drugIcon ? /xanax/i.test(drugIcon) : false;

  // Bugün alınan Xanax (gün başındaki sayaçtan fark)
  const today = tctDate((u.server_time || u.timestamp) * 1000);
  const xantaken = u.personalstats?.xantaken ?? null;
  if (xantaken != null) {
    history.user[today] ||= { xanStart: xantaken };
    history.user[today].xanLast = xantaken;
    pruneUserHistory();
  }

  const eduId = u.education_current;
  const result = {
    serverTime: u.server_time || u.timestamp,
    player: {
      id: u.player_id, name: u.name, level: u.level, rank: u.rank,
      image: u.profile_image, status: u.status, lastAction: u.last_action,
      job: u.job, faction: u.faction,
    },
    bars: { energy: u.energy, nerve: u.nerve, happy: u.happy, life: u.life, chain: u.chain },
    cooldowns: u.cooldowns || {},
    drug: {
      cooldown: u.cooldowns?.drug || 0,
      icon: drugIcon,
      xanaxActive: bs.xanaxActive || xanaxFromIcon,
      xantaken,
      xanToday: xantaken != null ? xantaken - history.user[today].xanStart : null,
      refills: u.personalstats?.refills ?? null,
    },
    education: {
      currentId: eduId || 0,
      current: eduId ? (eduNames[eduId]?.name || `Kurs #${eduId}`) : null,
      code: eduId ? eduNames[eduId]?.code : null,
      duration: eduId ? eduNames[eduId]?.duration : null,
      timeLeft: u.education_timeleft || 0,
      completed: (u.education_completed || []).length,
      totalCourses: Object.keys(eduNames).length || null,
    },
    battle: bs,
    travel: u.status?.state === 'Traveling' || u.status?.state === 'Abroad'
      ? { description: u.status.description, icon: iconList.find((t) => /^travel/i.test(t)) || null }
      : null,
    trip: u.travel ? { destination: u.travel.destination, method: u.travel.method, timeLeft: u.travel.time_left || 0, arrival: u.travel.timestamp || 0 } : null,
  };
  recordStats(today, bs, u.personalstats || {});
  history.lastOverview = result;
  history.lastOverviewAt = Date.now();
  saveHistory();
  return result;
}

/* ------------------------------------------------------------------ */
/* Gym & stat / networth günlük kayıtları                              */
/* ------------------------------------------------------------------ */
function pruneDaily(obj, keep = 180) {
  const keys = Object.keys(obj).sort();
  while (keys.length > keep) delete obj[keys.shift()];
}
function recordStats(day, bs, ps) {
  history.stats ||= {};
  const s = bs.stats;
  history.stats[day] = {
    str: s.strength.base, def: s.defense.base, spd: s.speed.base, dex: s.dexterity.base, total: bs.totals.base,
    xantaken: ps.xantaken ?? null, refills: ps.refills ?? null, edrinks: ps.energydrinkused ?? null,
    enhancers: ps.statenhancersused ?? null, at: Date.now(),
  };
  pruneDaily(history.stats);
}
const dailyList = (obj) => Object.keys(obj || {}).sort().map((date) => ({ date, ...obj[date] }));

async function getNetworth(force = false) {
  const q = 'user/?selections=networth';
  if (force) cache.delete('torn:' + q);
  const u = await torn(q, 5 * 60_000);
  const n = u.networth || {};
  const day = tctDate((n.timestamp || Date.now() / 1000) * 1000);
  history.networth ||= {};
  const { parsetime, timestamp, ...parts } = n;
  history.networth[day] = { ...parts, at: Date.now() };
  pruneDaily(history.networth, 365);
  saveHistory();
  return { current: parts, timestamp: n.timestamp || Math.floor(Date.now() / 1000), history: dailyList(history.networth) };
}

/* İş asistanı: çalışma statları + şirket türlerinin pozisyon gereksinimleri */
async function getJobInfo() {
  const [u, t] = await Promise.all([
    torn('user/?selections=workstats,jobpoints,profile', 60_000),
    torn('torn/?selections=companies', 24 * 3600_000),
  ]);
  const types = {};
  for (const [id, c] of Object.entries(t.companies || {})) {
    types[id] = { name: c.name, cost: c.cost, positions: c.positions || {} };
  }
  return {
    workstats: { man: u.manual_labor || 0, int: u.intelligence || 0, end: u.endurance || 0 },
    jobpoints: u.jobpoints || {}, job: u.job || null, types,
  };
}

/* Seyahat kârı: YATA yurt dışı stokları + Torn market değeri */
const COUNTRIES = {
  mex: ['Mexico', 26], cay: ['Cayman Islands', 35], can: ['Canada', 41], haw: ['Hawaii', 134], uni: ['United Kingdom', 159],
  arg: ['Argentina', 167], swi: ['Switzerland', 175], jap: ['Japan', 225], chi: ['China', 242], uae: ['UAE', 271], sou: ['South Africa', 297],
};
/* Yurt dışı stok takibi: her gözlemi kaydedip restock / tükenme zamanlarını çıkarır */
const STOCK_FILE = path.join(DATA, 'travel-stock.json');
let stockLog = readJson(STOCK_FILE, {}); // "kod:id" -> { q, t, restocks: [ts], empties: [ts], samples: [[ts, adet]] }
let stockDirty = false;
const flushStocks = () => { if (stockDirty) { stockDirty = false; try { writeJson(STOCK_FILE, stockLog); } catch {} } };
setInterval(flushStocks, 60_000).unref();
const QUARTER = 900; // Torn yurt dışı stokları çeyrek saatlerde yenilenir
const pushMax = (arr, v, max) => { if (arr[arr.length - 1] !== v) arr.push(v); while (arr.length > max) arr.shift(); };
const median = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };

function recordStock(code, update, list) {
  if (!update) return;
  for (const it of list) {
    const k = `${code}:${it.id}`;
    const q = Number(it.quantity) || 0;
    const e = stockLog[k] ||= { q, t: update, restocks: [], empties: [], samples: [] };
    if (update <= e.t && e.samples.length) continue;
    if (q > e.q) {
      // Alımlar stoğu yalnızca azaltır: artış = restock. Gözlem aralığındaki son çeyreğe yuvarla.
      pushMax(e.restocks, Math.max(e.t, Math.floor(update / QUARTER) * QUARTER), 12);
      e.samples = [];
    } else if (q === 0 && e.q > 0) pushMax(e.empties, update, 12);
    e.samples.push([update, q]);
    if (e.samples.length > 30) e.samples.shift();
    e.q = q; e.t = update; stockDirty = true;
  }
}

function stockStats(code, id, q, update) {
  const e = stockLog[`${code}:${id}`];
  if (!e) return {};
  // Tükenme hızı (adet/dk): son restocktan beri, ilk sıfıra kadar olan örnekler
  let rate = null;
  const firstZero = e.samples.findIndex(([, v]) => v === 0);
  const smp = firstZero >= 0 ? e.samples.slice(0, firstZero + 1) : e.samples;
  if (smp.length >= 2) {
    const [t0, q0] = smp[0], [t1, q1] = smp[smp.length - 1];
    if (t1 - t0 >= 300 && q0 > q1) rate = (q0 - q1) / ((t1 - t0) / 60);
  }
  const emptyAt = q > 0 && rate ? Math.round(update + (q / rate) * 60) : null;
  // Boş kalma süresi: her restocktan önceki son tükenme anına göre
  const gaps = [];
  for (const r of e.restocks) {
    const em = [...e.empties].reverse().find((x) => x < r);
    if (em && r - em < 12 * 3600) gaps.push(r - em);
  }
  const gap = median(gaps);
  const lastEmpty = e.empties[e.empties.length - 1] || null;
  let estRestock = null;
  if (gap != null) {
    const base = q === 0 ? (lastEmpty || update) : emptyAt;
    if (base) estRestock = Math.ceil((base + gap) / QUARTER) * QUARTER;
  }
  const iv = e.restocks.slice(1).map((r, i) => r - e.restocks[i]).filter((x) => x > 0);
  return { rate, emptyAt, estRestock, lastRestock: e.restocks[e.restocks.length - 1] || null, interval: median(iv), samples: e.samples.length };
}

/* YATA + Prometheus: miktar için en taze kaynak, restock tahmini Prometheus'tan */
async function fetchStocks() {
  return cached('travel:stocks', 120_000, async () => {
    const get = async (url, name) => {
      const r = await fetch(url, { headers: { 'User-Agent': 'LRX-Torn-Tracker' }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`${name} HTTP ${r.status}`);
      const j = await r.json();
      if (!j || typeof j.stocks !== 'object') throw new Error(`${name}: beklenmeyen veri`);
      return j;
    };
    const [y, p] = await Promise.allSettled([
      get('https://yata.yt/api/v1/travel/export/', 'YATA'),
      get('https://api.prombot.co.uk/api/travel', 'Prometheus'),
    ]);
    const yata = y.status === 'fulfilled' ? y.value : null;
    const prom = p.status === 'fulfilled' ? p.value : null;
    if (!yata && !prom) throw new ApiError(`Stok verisi alınamadı (${y.reason?.message}; ${p.reason?.message})`, 'TRAVEL');
    const out = {};
    for (const code of new Set([...Object.keys(yata?.stocks || {}), ...Object.keys(prom?.stocks || {})])) {
      const yc = yata?.stocks?.[code], pc = prom?.stocks?.[code];
      const src = !pc || (yc && (yc.update || 0) >= (pc.update || 0)) ? yc : pc;
      const next = {};
      for (const it of pc?.stocks || []) {
        const t = it.nextRestock ? Math.round(Date.parse(it.nextRestock) / 1000) : null;
        if (t) next[it.id] = t;
      }
      const list = Array.isArray(src?.stocks) ? src.stocks : [];
      recordStock(code, Number(src?.update) || 0, list);
      out[code] = { update: Number(src?.update) || 0, source: src === yc ? 'YATA' : 'Prometheus', stocks: list, next };
    }
    return { countries: out, sources: { yata: !!yata, prom: !!prom } };
  });
}

async function getTravelProfit() {
  const [st, items, me] = await Promise.all([
    fetchStocks(),
    torn('torn/?selections=items', 3600_000),
    torn('user/?selections=travel', 30_000).catch(() => ({})),
  ]);
  const market = items.items || {};
  const nowS = Math.floor(Date.now() / 1000);
  const countries = Object.entries(st.countries).map(([code, c]) => ({
    code, name: COUNTRIES[code]?.[0] || code, minutes: COUNTRIES[code]?.[1] || null, update: c.update, source: c.source,
    items: c.stocks.map((s) => {
      const mv = Number(market[s.id]?.market_value) || 0;
      const q = Number(s.quantity) || 0;
      const stats = stockStats(code, s.id, q, c.update);
      const prom = c.next[s.id] || null;
      // Prometheus tahmini 3 saatten fazla gecikmişse güvenilmez say
      const promOk = prom && prom > nowS - 3 * 3600 ? prom : null;
      const nextRestock = q > 0 ? null : (promOk || stats.estRestock || null);
      return {
        id: s.id, name: s.name, type: market[s.id]?.type || '', cost: s.cost, qty: q, market: mv, profit: mv ? mv - s.cost : null,
        nextRestock, restockSrc: nextRestock ? (nextRestock === promOk ? 'Prometheus' : 'tahmin') : null,
        emptyAt: stats.emptyAt || null, rate: stats.rate ? Math.round(stats.rate * 10) / 10 : null,
        lastRestock: stats.lastRestock || null, interval: stats.interval || null,
      };
    }),
  }));
  return { countries, method: me.travel?.method || null, fetchedAt: Date.now(), serverNow: nowS, sources: st.sources };
}

function pruneUserHistory() {
  const keys = Object.keys(history.user).sort();
  while (keys.length > 60) delete history.user[keys.shift()];
}

/* ------------------------------------------------------------------ */
/* Company                                                             */
/* ------------------------------------------------------------------ */
async function fetchCompany(force = false) {
  const q = 'company/?selections=profile,detailed,stock,employees,news';
  if (force) cache.delete('torn:' + q);
  const c = await torn(q, 60_000);
  recordCompany(c);
  return c;
}

function recordCompany(c) {
  const p = c.company, d = c.company_detailed || {}, stock = c.company_stock || {}, emps = c.company_employees || {}, news = c.news || {};
  if (!p) return;
  const now = Date.now();
  const sig = `${p.daily_income}|${p.daily_customers}`;
  const wages = Object.values(emps).reduce((a, e) => a + (Number(e.wage) || 0), 0);
  const stockSnap = {};
  const hadStockHistory = Object.keys(history.stockOrders).length > 0;

  for (const [name, s] of Object.entries(stock)) {
    stockSnap[name] = { ...s };
    const prev = history.stockOrders[name];
    if (s.on_order > 0) {
      if (!prev || !prev.amount) {
        history.stockOrders[name] = { amount: s.on_order, orderedAt: now, exact: hadStockHistory };
      } else if (s.on_order > prev.amount) {
        history.stockOrders[name] = { amount: s.on_order, orderedAt: now, exact: true };
      } else {
        prev.amount = s.on_order;
      }
    } else {
      history.stockOrders[name] = { amount: 0, orderedAt: null, exact: false };
    }
  }

  // Şirket haberlerinden (18:00 TCT günlük raporları) geçmiş günleri tamamla
  for (const item of Object.values(news)) {
    const m = String(item.news || '').match(/report:\s*We had a total of ([\d,]+) customers and made a gross income of \$([\d,]+)/i);
    if (!m || !item.timestamp) continue;
    const cust = Number(m[1].replace(/,/g, ''));
    const inc = Number(m[2].replace(/,/g, ''));
    const ts = item.timestamp * 1000;
    const rDate = tctDate(ts);
    const rSig = `${inc}|${cust}`;
    const existing = history.days.find((x) => x.sig === rSig || x.date === rDate);
    if (!existing) {
      history.days.push({
        sig: rSig,
        capturedAt: ts,
        date: rDate,
        daily_income: inc,
        daily_customers: cust,
        weekly_income: p.weekly_income,
        weekly_customers: p.weekly_customers,
        funds: d.company_funds,
        popularity: d.popularity,
        efficiency: d.efficiency,
        environment: d.environment,
        ads: d.advertising_budget || 0,
        wages,
        employees: p.employees_hired,
        stock: inc === p.daily_income && cust === p.daily_customers ? stockSnap : {},
      });
    } else if (existing.sig === rSig) {
      existing.date = rDate;
      existing.capturedAt = ts;
    }
  }
  history.days.sort((a, b) => a.date.localeCompare(b.date));

  const last = history.days[history.days.length - 1];
  const entry = {
    sig,
    capturedAt: now,
    date: tctDate(now),
    daily_income: p.daily_income,
    daily_customers: p.daily_customers,
    weekly_income: p.weekly_income,
    weekly_customers: p.weekly_customers,
    funds: d.company_funds,
    popularity: d.popularity,
    efficiency: d.efficiency,
    environment: d.environment,
    ads: d.advertising_budget || 0,
    wages,
    employees: p.employees_hired,
    stock: stockSnap,
  };
  const sameSig = history.days.find((x) => x.sig === sig);
  if (!sameSig) {
    history.days.push(entry);
    history.days.sort((a, b) => a.date.localeCompare(b.date));
    while (history.days.length > 180) history.days.shift();
  } else {
    Object.assign(sameSig, { funds: entry.funds, popularity: entry.popularity, efficiency: entry.efficiency, environment: entry.environment, ads: entry.ads, wages: entry.wages, updatedAt: now });
    sameSig.stock ||= {};
    for (const [n, s] of Object.entries(stockSnap)) {
      if (sameSig.stock[n]) Object.assign(sameSig.stock[n], { in_stock: s.in_stock, on_order: s.on_order, price: s.price, cost: s.cost, sold_amount: s.sold_amount, sold_worth: s.sold_worth });
      else sameSig.stock[n] = s;
    }
  }

  // Çalışan addiction geçmişi (18:00 TCT gününe göre)
  const today = tctDate(now);
  for (const [id, e] of Object.entries(emps)) {
    const val = e.effectiveness?.addiction ?? 0;
    const arr = (history.addiction[id] ||= []);
    const lastA = arr[arr.length - 1];
    if (lastA && lastA.date === today) { lastA.value = val; lastA.name = e.name; }
    else arr.push({ date: today, value: val, name: e.name });
    if (arr.length > 90) arr.shift();
  }
  saveHistory();
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function buildCompanyReport(c) {
  const p = c.company, d = c.company_detailed || {}, stock = c.company_stock || {}, emps = c.company_employees || {};
  const coverDays = Number(config.coverDays) || 3;
  const deliveryHours = Number(config.deliveryHours) || 6;
  const deliveryMode = config.deliveryMode || 'hours';
  const now = Date.now();
  const nextResetMs = next18TctMs(now);
  const recent = history.days.slice(-7);
  // Ölçülmüş gerçek teslim süresi varsa tahminlerde onu kullan
  const estHours = history.learnedDeliveryHours || deliveryHours;
  const shipments = (history.stockDeliveries?.items || [])
    .filter((x) => x.deliverAt > now - 120_000)
    .sort((a, b) => a.deliverAt - b.deliverAt);

  let products = Object.entries(stock).map(([name, s]) => {
    const hist = recent.map((x) => x.stock?.[name]?.sold_amount).filter((n) => typeof n === 'number' && n > 0);
    const avgDaily = hist.length ? mean(hist) : s.sold_amount;
    const cogs = s.sold_amount * s.cost;
    const profit = s.sold_worth - cogs;
    const daysLeft = avgDaily > 0 ? s.in_stock / avgDaily : null;
    const daysLeftWithOrder = avgDaily > 0 ? (s.in_stock + s.on_order) / avgDaily : null;
    const hoursLeft = daysLeft != null ? daysLeft * 24 : null;
    const hoursLeftWithOrder = daysLeftWithOrder != null ? daysLeftWithOrder * 24 : null;
    const target = Math.ceil(avgDaily * coverDays);
    let need = Math.max(0, target - s.in_stock - s.on_order);
    if (need > 0) need = Math.ceil(need / 100) * 100;
    let status = 'ok';
    if (daysLeft != null && daysLeft < 1) status = 'critical';
    else if (daysLeftWithOrder != null && daysLeftWithOrder < coverDays) status = 'low';
    else if (daysLeftWithOrder != null && daysLeftWithOrder > coverDays * 2.5) status = 'over';

    // Sipariş teslim süresi: önce Torn'un kendi "Delivered in" sayacı (stok sayfasından okunur),
    // yoksa sipariş zamanından tahmin. Tahmin, uygulama siparişi verildiği an görmediyse güvenilmezdir.
    const ord = history.stockOrders[name];
    let orderDelivery = null;
    if (s.on_order > 0) {
      const ships = shipments.filter((x) => x.name === name);
      const safe = (etaMs) => (hoursLeft == null ? true : hoursLeft * 3600_000 > etaMs - now);
      if (ships.length) {
        const etaMs = ships[0].deliverAt;
        const startMs = Math.min(ord?.orderedAt || history.stockDeliveries.at, history.stockDeliveries.at);
        orderDelivery = {
          amount: s.on_order, shipments: ships.length, orderedAt: ord?.orderedAt || null, exact: true,
          source: 'torn', seenAt: history.stockDeliveries.at, etaMs, nextResetMs,
          cycleTotalMs: Math.max(etaMs - startMs, 3600_000), mode: 'torn', deliveryHours: estHours,
          safeUntilDelivery: safe(etaMs),
        };
      } else {
        const orderedAt = ord?.orderedAt || now;
        const totalMs = estHours * 3600_000;
        const byHoursEta = orderedAt + totalMs;
        const etaMs = deliveryMode === '18tct' ? nextResetMs : (byHoursEta > now ? byHoursEta : nextResetMs);
        const modeUsed = deliveryMode === '18tct' || byHoursEta <= now ? '18tct' : 'hours';
        orderDelivery = {
          amount: s.on_order, orderedAt, exact: !!ord?.exact, source: 'estimate', etaMs, nextResetMs,
          cycleTotalMs: modeUsed === '18tct' ? 24 * 3600_000 : totalMs, mode: modeUsed, deliveryHours: estHours,
          learned: !!history.learnedDeliveryHours, safeUntilDelivery: safe(etaMs),
        };
      }
    }

    return {
      name, ...s, avgDaily: Math.round(avgDaily), samples: hist.length,
      avgPrice: s.sold_amount ? s.sold_worth / s.sold_amount : s.price,
      cogs, profit, margin: s.sold_worth ? profit / s.sold_worth : 0,
      daysLeft, daysLeftWithOrder, hoursLeft, hoursLeftWithOrder,
      target, need, status, orderDelivery,
    };
  });

  const storageSpace = d.upgrades?.storage_space || null;
  const storageUsed = products.reduce((a, x) => a + x.in_stock + x.on_order, 0);
  const storageFree = storageSpace != null ? Math.max(0, storageSpace - storageUsed) : null;
  const needTotal = products.reduce((a, x) => a + x.need, 0);
  let storageLimited = false;
  if (storageFree != null && needTotal > storageFree && needTotal > 0) {
    storageLimited = true;
    const f = storageFree / needTotal;
    products = products.map((x) => ({ ...x, needUncapped: x.need, need: Math.floor((x.need * f) / 100) * 100 }));
  }
  products = products.map((x) => ({ ...x, orderCost: x.need * x.cost }));
  products.sort((a, b) => b.sold_worth - a.sold_worth);

  const totals = products.reduce((a, x) => {
    a.sold += x.sold_amount; a.revenue += x.sold_worth; a.cogs += x.cogs; a.profit += x.profit;
    a.inStock += x.in_stock; a.onOrder += x.on_order; a.need += x.need; a.orderCost += x.orderCost;
    return a;
  }, { sold: 0, revenue: 0, cogs: 0, profit: 0, inStock: 0, onOrder: 0, need: 0, orderCost: 0 });

  const employees = Object.entries(emps).map(([id, e]) => ({
    id: Number(id), name: e.name, position: e.position, days: e.days_in_company, wage: e.wage || 0,
    manual_labor: e.manual_labor, intelligence: e.intelligence, endurance: e.endurance,
    effectiveness: e.effectiveness || {}, addiction: e.effectiveness?.addiction ?? 0,
    inactivity: e.effectiveness?.inactivity ?? 0,
    lastAction: e.last_action, status: e.status,
    addictionHistory: (history.addiction[id] || []).slice(-14),
  })).sort((a, b) => a.addiction - b.addiction);

  const wages = employees.reduce((a, e) => a + e.wage, 0);
  const ads = d.advertising_budget || 0;
  const income = {
    revenue: p.daily_income, cogs: totals.cogs, wages, ads,
    net: p.daily_income - totals.cogs - wages - ads,
    weeklyRevenue: p.weekly_income, weeklyAvg: Math.round(p.weekly_income / 7),
    customers: p.daily_customers, weeklyCustomers: p.weekly_customers,
  };

  const cogsRatio = p.daily_income > 0 ? totals.cogs / p.daily_income : 0.58;
  const days = history.days.map((x) => {
    const hasStock = x.stock && Object.keys(x.stock).length > 0;
    const cogs = hasStock
      ? Object.values(x.stock).reduce((a, s) => a + (s.sold_amount || 0) * (s.cost || 0), 0)
      : Math.round((x.daily_income || 0) * cogsRatio);
    return {
      date: x.date, capturedAt: x.capturedAt, revenue: x.daily_income, customers: x.daily_customers,
      cogs, cogsEstimated: !hasStock, wages: x.wages || wages, ads: x.ads ?? ads,
      net: x.daily_income - cogs - (x.wages || wages) - (x.ads ?? ads), funds: x.funds, popularity: x.popularity,
      products: Object.fromEntries(Object.entries(x.stock || {}).map(([n, s]) => [n, { sold: s.sold_amount, worth: s.sold_worth }])),
    };
  });

  const report = {
    fetchedAt: now,
    nextResetMs,
    coverDays,
    deliveryHours,
    deliveryMode,
    estDeliveryHours: estHours,
    deliveriesSeenAt: history.stockDeliveries?.at || 0,
    company: {
      id: p.ID, name: p.name, type: p.company_type, rating: p.rating, daysOld: p.days_old,
      hired: p.employees_hired, capacity: p.employees_capacity,
      dailyIncome: p.daily_income, dailyCustomers: p.daily_customers,
      weeklyIncome: p.weekly_income, weeklyCustomers: p.weekly_customers,
      funds: d.company_funds, popularity: d.popularity, efficiency: d.efficiency, environment: d.environment,
      trains: d.trains_available, ads, value: d.value, upgrades: d.upgrades || {},
    },
    storage: { space: storageSpace, used: storageUsed, free: storageFree, limited: storageLimited },
    products, totals, employees, income, days,
    hasDirectorAccess: !!c.company_stock,
  };
  history.lastCompanyReport = report;
  history.lastCompanyAt = now;
  saveHistory();
  return report;
}

/* ------------------------------------------------------------------ */
/* Faction war & targets                                               */
/* ------------------------------------------------------------------ */
async function getMyWars() {
  const f = await torn('faction/?selections=basic', 60_000);
  const myId = f.ID;
  const wars = [];
  for (const [wid, w] of Object.entries(f.ranked_wars || {})) {
    const opp = Object.entries(w.factions || {}).find(([id]) => Number(id) !== myId);
    if (opp) wars.push({ type: 'Ranked War', id: wid, factionId: Number(opp[0]), name: opp[1].name, score: opp[1].score, myScore: w.factions[myId]?.score, start: w.war?.start, end: w.war?.end, target: w.war?.target });
  }
  for (const [wid, w] of Object.entries(f.raid_wars || {})) {
    const oppId = w.raiding_faction === myId ? w.defending_faction : w.raiding_faction;
    if (oppId) wars.push({ type: 'Raid', id: wid, factionId: oppId, name: `Faction #${oppId}` });
  }
  for (const [wid, w] of Object.entries(f.territory_wars || {})) {
    const oppId = w.assaulting_faction === myId ? w.defending_faction : w.assaulting_faction;
    if (oppId) wars.push({ type: 'Territory', id: wid, factionId: oppId, name: `Faction #${oppId}`, territory: w.territory });
  }
  return { faction: { id: myId, name: f.name, tag: f.tag, members: Object.keys(f.members || {}).length, respect: f.respect }, wars };
}

// FFScouter cache: playerId -> { t, data }
const ffCache = new Map();
let ffStatus = { ok: null, error: null, checkedAt: 0 };

async function ffscouterStats(ids) {
  const fresh = [], need = [];
  for (const id of ids) {
    const c = ffCache.get(id);
    if (c && Date.now() - c.t < 60 * 60_000) fresh.push(id); else need.push(id);
  }
  if (need.length) {
    for (let i = 0; i < need.length; i += 100) {
      const chunk = need.slice(i, i + 100);
      const url = `https://ffscouter.com/api/v1/get-stats?key=${encodeURIComponent(ffKey())}&targets=${chunk.join(',')}`;
      let res, body;
      try {
        res = await fetch(url, { headers: { 'User-Agent': 'TornTracker/1.0' } });
        body = await res.text();
      } catch (e) {
        ffStatus = { ok: false, error: 'FFScouter erişilemedi: ' + e.message, checkedAt: Date.now() };
        break;
      }
      let json; try { json = JSON.parse(body); } catch { json = null; }
      if (!res.ok || (json && json.error)) {
        const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
        ffStatus = {
          ok: false,
          error: res.status === 401 || /regist/i.test(String(msg))
            ? 'API key FFScouter\'a kayıtlı değil. ffscouter.com adresinde key\'inizle bir kez giriş yapıp kaydedin (ücretsiz).'
            : `FFScouter hatası: ${msg}`,
          checkedAt: Date.now(),
        };
        break;
      }
      const list = Array.isArray(json) ? json : Object.values(json || {});
      for (const r of list) {
        const pid = Number(r.player_id ?? r.id);
        if (!pid) continue;
        ffCache.set(pid, { t: Date.now(), data: { bs: r.bs_estimate ?? null, bsHuman: r.bs_estimate_human ?? null, ff: r.fair_fight ?? null, updated: r.last_updated ?? null } });
      }
      for (const id of chunk) if (!ffCache.has(id)) ffCache.set(id, { t: Date.now(), data: { bs: null } });
      ffStatus = { ok: true, error: null, checkedAt: Date.now() };
    }
  }
  const out = {};
  for (const id of ids) { const c = ffCache.get(id); if (c) out[id] = c.data; }
  return out;
}

/* --- Yedek tahmin: Rank tabanlı (TornTools yöntemi) --- */
const RANKS = {
  'Absolute beginner': 1, Beginner: 2, Inexperienced: 3, Rookie: 4, Novice: 5, 'Below average': 6, Average: 7,
  Reasonable: 8, 'Above average': 9, Competent: 10, 'Highly competent': 11, Veteran: 12, Distinguished: 13,
  'Highly distinguished': 14, Professional: 15, Star: 16, Master: 17, Outstanding: 18, Celebrity: 19,
  Supreme: 20, Idolized: 21, Champion: 22, Heroic: 23, Legendary: 24, Elite: 25, Invincible: 26,
};
const RANK_NAMES = Object.keys(RANKS).sort((a, b) => b.length - a.length);
const TRIGGERS = { level: [2, 6, 11, 26, 31, 50, 71, 100], crimes: [100, 5000, 10000, 20000, 30000, 50000], networth: [5e6, 5e7, 5e8, 5e9, 5e10] };
const EST_RANGES = [
  { label: '< 2K', min: 0, max: 2e3, mid: 1e3 },
  { label: '2K – 25K', min: 2e3, max: 2.5e4, mid: 7e3 },
  { label: '20K – 250K', min: 2e4, max: 2.5e5, mid: 7e4 },
  { label: '200K – 2.5M', min: 2e5, max: 2.5e6, mid: 7e5 },
  { label: '2M – 25M', min: 2e6, max: 2.5e7, mid: 7e6 },
  { label: '20M – 250M', min: 2e7, max: 2.5e8, mid: 7e7 },
  { label: '> 200M', min: 2e8, max: Infinity, mid: 5e8 },
];
function rankEstimate(rankStr, level, crimes, networth) {
  const rn = RANK_NAMES.find((r) => String(rankStr).toLowerCase().startsWith(r.toLowerCase()));
  if (!rn) return null;
  const cnt = (arr, v) => arr.filter((t) => v >= t).length;
  const idx = RANKS[rn] - cnt(TRIGGERS.level, level) - cnt(TRIGGERS.crimes, crimes) - cnt(TRIGGERS.networth, networth) - 1;
  const r = EST_RANGES[Math.max(0, Math.min(EST_RANGES.length - 1, idx))];
  return { ...r, max: r.max === Infinity ? null : r.max };
}

const estCache = new Map(); // id -> { t, data }
const estJobs = new Map();  // factionId -> { total, done, running, errors }

function startEstimateJob(factionId, ids) {
  const existing = estJobs.get(factionId);
  if (existing && existing.running) return existing;
  const todo = ids.filter((id) => { const c = estCache.get(id); return !c || Date.now() - c.t > 12 * 3600_000; });
  const job = { total: todo.length, done: 0, running: todo.length > 0, errors: 0, startedAt: Date.now() };
  estJobs.set(factionId, job);
  (async () => {
    for (const id of todo) {
      try {
        const j = await tornRaw(`user/${id}?selections=profile,personalstats`);
        const ps = j.personalstats || {};
        const est = rankEstimate(j.rank, j.level, ps.criminaloffenses ?? ps.crimes ?? 0, ps.networth ?? 0);
        estCache.set(id, { t: Date.now(), data: est ? { ...est, xantaken: ps.xantaken ?? null, rank: j.rank } : null });
      } catch (e) {
        job.errors++;
        if (e.code === 5) await sleep(15_000); // rate limit
      }
      job.done++;
      await sleep(400);
    }
    job.running = false;
  })();
  return job;
}

async function getTargets(factionId) {
  const [enemy, me] = await Promise.all([
    torn(`faction/${factionId}?selections=basic`, 30_000),
    getOverview(),
  ]);
  const members = Object.entries(enemy.members || {}).map(([id, m]) => ({ id: Number(id), ...m }));
  const ids = members.map((m) => m.id);
  let ff = {};
  try { ff = await ffscouterStats(ids); } catch (e) { ffStatus = { ok: false, error: e.message, checkedAt: Date.now() }; }

  const list = members.map((m) => {
    const f = ff[m.id];
    const est = estCache.get(m.id)?.data || null;
    let source = null, bs = null, bsMin = null, bsMax = null, label = null;
    if (f && f.bs) { source = 'ffscouter'; bs = f.bs; label = f.bsHuman; }
    else if (est) { source = 'rank'; bs = est.mid; bsMin = est.min; bsMax = est.max; label = est.label; }
    return {
      id: m.id, name: m.name, level: m.level, position: m.position, daysInFaction: m.days_in_faction,
      status: m.status, lastAction: m.last_action,
      bs, bsMin, bsMax, bsLabel: label, source, ffRemote: f?.ff ?? null, ffUpdated: f?.updated ?? null,
    };
  });

  return {
    faction: { id: enemy.ID, name: enemy.name, tag: enemy.tag, respect: enemy.respect, members: members.length, rank: enemy.rank },
    me: { name: me.player.name, totals: me.battle.totals, xanaxActive: me.drug.xanaxActive, drugCooldown: me.drug.cooldown },
    ffscouter: { ...ffStatus, keyIsMain: !config.ffscouterKey },
    estimateJob: estJobs.get(Number(factionId)) || null,
    serverTime: me.serverTime,
    members: list,
  };
}

/* ------------------------------------------------------------------ */
/* Arka plan poller                                                    */
/* ------------------------------------------------------------------ */
let pollTimer = null;
function schedulePoll() {
  clearInterval(pollTimer);
  const mins = Math.max(5, Number(config.pollMinutes) || 15);
  pollTimer = setInterval(() => {
    fetchCompany(true).catch((e) => console.warn('[poll] company:', e.message));
    getOverview().catch(() => {});
    if (config.features?.['page.networth'] !== false) getNetworth().catch(() => {});
  }, mins * 60_000);
}
// Yurt dışı stok geçmişi sürekli birikmeli (restock / tükenme tahmini için)
const pollStocks = () => { if (config.features?.['page.travel'] !== false) fetchStocks().catch((e) => console.warn('[poll] travel:', e.message)); };
setInterval(pollStocks, 3 * 60_000).unref();
setTimeout(pollStocks, 8000).unref();

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}
const maskKey = (k) => (k ? k.slice(0, 3) + '•'.repeat(Math.max(0, k.length - 6)) + k.slice(-3) : '');

async function handleApi(req, res, url) {
  const p = url.pathname;
  try {
    if (p === '/api/config' && req.method === 'GET') {
      return send(res, 200, {
        hasKey: !!config.apiKey, apiKeyMasked: maskKey(config.apiKey), ffscouterKeyMasked: maskKey(config.ffscouterKey),
        coverDays: config.coverDays, pollMinutes: config.pollMinutes,
        deliveryHours: config.deliveryHours || 6, deliveryMode: config.deliveryMode || 'hours',
        updateUrl: config.updateUrl || DEFAULT_UPDATE_URL,
        features: config.features || {},
      });
    }
    if (p === '/api/features' && req.method === 'POST') {
      const b = await readBody(req);
      config.features ||= {};
      for (const [k, v] of Object.entries(b.features || {})) {
        if (/^[a-zA-Z0-9_.-]{1,40}$/.test(k) && typeof v === 'boolean') config.features[k] = v;
      }
      saveConfig();
      return send(res, 200, { ok: true, features: config.features });
    }
    if (p === '/api/stats') return send(res, 200, { history: dailyList(history.stats), battle: history.lastOverview?.battle || null });
    if (p === '/api/networth') return send(res, 200, await getNetworth(url.searchParams.get('force') === '1'));
    if (p === '/api/job') return send(res, 200, await getJobInfo());
    if (p === '/api/travel') return send(res, 200, await getTravelProfit());
    if (p === '/api/config' && req.method === 'POST') {
      const b = await readBody(req);
      if (typeof b.apiKey === 'string' && b.apiKey.trim()) { config.apiKey = b.apiKey.trim(); cache.clear(); }
      if (typeof b.ffscouterKey === 'string') { config.ffscouterKey = b.ffscouterKey.trim(); ffCache.clear(); ffStatus = { ok: null, error: null, checkedAt: 0 }; }
      if (b.coverDays != null) config.coverDays = Math.min(14, Math.max(1, Number(b.coverDays) || 3));
      if (b.pollMinutes != null) config.pollMinutes = Math.min(120, Math.max(5, Number(b.pollMinutes) || 15));
      if (b.deliveryHours != null) config.deliveryHours = Math.min(48, Math.max(1, Number(b.deliveryHours) || 6));
      if (b.deliveryMode === 'hours' || b.deliveryMode === '18tct') config.deliveryMode = b.deliveryMode;
      if (typeof b.updateUrl === 'string' && (!b.updateUrl.trim() || /^https:\/\//i.test(b.updateUrl.trim()))) config.updateUrl = b.updateUrl.trim();
      saveConfig(); schedulePoll();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/auth' && req.method === 'POST') {
      const b = await readBody(req);
      const key = String(b.apiKey || '').trim();
      if (!/^[A-Za-z0-9]{16}$/.test(key)) return send(res, 400, { error: 'API key 16 karakterlik harf/rakam olmalı.' });
      const call = async (q) => {
        await throttle();
        const r = await fetch(`https://api.torn.com/${q}&key=${encodeURIComponent(key)}&comment=TornTracker`, { headers: { 'User-Agent': 'TornTracker/1.0' } });
        const j = await r.json().catch(() => ({ error: { error: `HTTP ${r.status}` } }));
        if (j.error) throw new ApiError(j.error.code === 2 ? 'API key geçersiz.' : `Torn API: ${j.error.error}`, j.error.code);
        return j;
      };
      const [info, user] = await Promise.all([call('key/?selections=info'), call('user/?selections=basic')]);
      const level = Number(info.access_level) || 0;
      if (level < 3) {
        return send(res, 403, { error: `Bu key "${info.access_type || 'Public'}" seviyesinde. Şirket ve faction verileri için en az "Limited Access" key gerekli.` });
      }
      // Farklı bir oyuncuya geçildiyse önceki oyuncunun verilerini karıştırma
      const prevPlayer = history.lastOverview?.player?.id;
      if (prevPlayer && prevPlayer !== user.player_id) {
        history = { days: [], addiction: {}, user: {}, stockOrders: {}, stockDeliveries: { at: 0, items: [] }, eduNames: history.eduNames };
        saveHistory();
      }
      config.apiKey = key;
      cache.clear(); ffCache.clear(); estCache.clear();
      ffStatus = { ok: null, error: null, checkedAt: 0 };
      saveConfig(); schedulePoll();
      return send(res, 200, { ok: true, player: { id: user.player_id, name: user.name, level: user.level }, accessType: info.access_type, resetData: !!(prevPlayer && prevPlayer !== user.player_id) });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      config.apiKey = '';
      config.ffscouterKey = '';
      cache.clear(); ffCache.clear(); estCache.clear();
      delete history.lastOverview; delete history.lastCompanyReport;
      saveConfig(); saveHistory();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/stock-order' && req.method === 'POST') {
      const b = await readBody(req);
      if (b.deliveryMode === 'hours' || b.deliveryMode === '18tct') config.deliveryMode = b.deliveryMode;
      if (b.deliveryHours != null) config.deliveryHours = Math.min(48, Math.max(1, Number(b.deliveryHours) || 6));
      if (b.hoursAgo != null) {
        const ts = Date.now() - Math.max(0, Number(b.hoursAgo) || 0) * 3600_000;
        const targets = b.product ? [b.product] : Object.keys(history.stockOrders);
        for (const k of targets) {
          if (history.stockOrders[k] && history.stockOrders[k].amount > 0) {
            history.stockOrders[k].orderedAt = ts;
            history.stockOrders[k].exact = true;
          }
        }
      }
      saveConfig(); saveHistory();
      const c = await fetchCompany(false);
      return send(res, 200, buildCompanyReport(c));
    }
    if (p === '/api/bootstrap') {
      return send(res, 200, {
        config: {
          hasKey: Boolean(config.apiKey),
          apiKeyMasked: maskKey(config.apiKey),
          ffscouterKeyMasked: maskKey(config.ffscouterKey),
          coverDays: config.coverDays,
          pollMinutes: config.pollMinutes,
          deliveryHours: config.deliveryHours || 6,
          deliveryMode: config.deliveryMode || 'hours',
          features: config.features || {},
        },
        overview: history.lastOverview || null,
        overviewAt: history.lastOverviewAt || 0,
        company: history.lastCompanyReport || null,
        companyAt: history.lastCompanyAt || 0,
      });
    }
    if (p === '/api/overview') return send(res, 200, await getOverview(url.searchParams.get('force') === '1'));
    if (p === '/api/company') {
      const c = await fetchCompany(url.searchParams.get('force') === '1');
      return send(res, 200, buildCompanyReport(c));
    }
    if (p === '/api/wars') return send(res, 200, await getMyWars());
    if (p === '/api/player') {
      const id = Number(url.searchParams.get('id'));
      if (!id) return send(res, 400, { error: 'id parametresi gerekli' });
      const j = await torn(`user/${id}?selections=profile,timestamp`, 15_000);
      return send(res, 200, {
        id: j.player_id, name: j.name, level: j.level, status: j.status, lastAction: j.last_action,
        faction: j.faction ? { id: j.faction.faction_id, name: j.faction.faction_name, tag: j.faction.faction_tag } : null,
        serverTime: j.server_time || j.timestamp || Math.floor(Date.now() / 1000),
      });
    }
    if (p === '/api/targets') {
      const fid = Number(url.searchParams.get('faction'));
      if (!fid) return send(res, 400, { error: 'faction parametresi gerekli' });
      return send(res, 200, await getTargets(fid));
    }
    if (p === '/api/estimate' && req.method === 'POST') {
      const fid = Number(url.searchParams.get('faction'));
      const enemy = await torn(`faction/${fid}?selections=basic`, 30_000);
      const ids = Object.keys(enemy.members || {}).map(Number).filter((id) => !(ffCache.get(id)?.data?.bs));
      return send(res, 200, startEstimateJob(fid, ids));
    }
    if (p === '/api/ffscouter/check') {
      const r = await fetch(`https://ffscouter.com/api/v1/check-key?key=${encodeURIComponent(ffKey())}`);
      const j = await r.json().catch(() => ({}));
      return send(res, 200, { registered: !!j.is_registered, premium: !!j.is_premium, raw: { registered_at: j.registered_at, last_used: j.last_used } });
    }
    return send(res, 404, { error: 'Bulunamadı' });
  } catch (e) {
    console.warn('[api]', p, e.message);
    return send(res, e.code === 'NO_KEY' ? 412 : 502, { error: e.message, code: e.code });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);

  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

function startServer(preferredPort = PORT) {
  return new Promise((resolve, reject) => {
    const onListen = () => {
      const actualPort = server.address().port;
      console.log(`\n  ◆ Torn Tracker hazır →  http://localhost:${actualPort}\n`);
      schedulePoll();
      if (config.apiKey) {
        getOverview(false).catch((e) => console.warn('[init] overview:', e.message));
        fetchCompany(false).then(buildCompanyReport).catch((e) => console.warn('[init] company:', e.message));
      }
      resolve(actualPort);
    };
    // Port doluysa önce yakın portları dene: arayüz origin'i (ve localStorage ayarları) sabit kalsın.
    let attempt = 0;
    const tryListen = () => {
      const port = attempt <= 10 ? preferredPort + attempt : 0;
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port !== 0) { attempt++; tryListen(); }
        else reject(err);
      });
      server.listen(port, '127.0.0.1', () => { server.removeAllListeners('error'); onListen(); });
    };
    tryListen();
  });
}

/* Torn şirket stok sayfasındaki "Current Shipments" sayaçları — Electron, Torn sekmesinden okuyup buraya verir. */
function stockProductNames() {
  const fromReport = (history.lastCompanyReport?.products || []).map((x) => x.name);
  if (fromReport.length) return fromReport;
  return Object.keys(history.days[history.days.length - 1]?.stock || {});
}

function ingestStockDeliveries(rows, at = Date.now()) {
  const names = new Set(stockProductNames());
  const items = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const name = String(r?.name || '');
    const secs = Number(r?.secs);
    if (!names.has(name) || !Number.isFinite(secs) || secs < 0 || secs > 7 * 86400) continue;
    items.push({ name, amount: Math.max(0, Number(r.amount) || 0), deliverAt: at + secs * 1000 });
  }
  history.stockDeliveries = { at, items };
  // Siparişin verildiği anı gördüğümüz ürünlerden gerçek kargo süresini öğren (tahminler için)
  const measured = items
    .map((it) => ({ it, ord: history.stockOrders[it.name] }))
    .filter(({ it, ord }) => ord?.exact && ord.orderedAt && ord.amount === it.amount)
    .map(({ it, ord }) => (it.deliverAt - ord.orderedAt) / 3600_000)
    .filter((h) => h >= 1 && h <= 72)
    .sort((a, b) => a - b);
  if (measured.length) history.learnedDeliveryHours = Math.round(measured[Math.floor(measured.length / 2)] * 4) / 4;
  if (history.lastCompanyReport) history.lastCompanyReport.deliveriesSeenAt = at;
  saveHistory();
  return items.length;
}

/* Savaş sayfası yardımcısı: kendi faction'ın + savaştığın faction'ların üye durumları.
   Dönüş: { oyuncuId: { s: 'Okay'|'Hospital'|..., u: bitiş (unix sn), d: açıklama } } */
async function warMemberStatuses(pageFactionIds = []) {
  if (!config.apiKey) return {};
  const ids = new Set(pageFactionIds.map(Number).filter((n) => n > 0));
  try {
    const w = await getMyWars();
    if (w.faction?.id) ids.add(w.faction.id);
    for (const x of w.wars) if (x.type === 'Ranked War') ids.add(x.factionId);
  } catch {}
  const out = {};
  await Promise.all([...ids].slice(0, 4).map(async (fid) => {
    try {
      const f = await torn(`faction/${fid}?selections=basic`, 20_000);
      for (const [id, m] of Object.entries(f.members || {})) {
        out[id] = { s: m.status?.state || '', u: Number(m.status?.until) || 0, d: m.status?.description || '' };
      }
    } catch {}
  }));
  return out;
}

if (require.main === module) {
  startServer(PORT);
}

// Kapanış / yeniden başlatma öncesi bekleyen yazmaları diske al
function flushData() {
  if (historyTimer) flushHistory();
  flushStocks();
}
process.on('exit', flushData);

// API key sahibinin oyuncu numarası (Torn sekmesindeki `uid` çerezini doğrulamak için)
const myPlayerId = () => { const id = Number(history.lastOverview?.player?.id); return Number.isInteger(id) && id > 0 ? String(id) : null; };

module.exports = { startServer, server, stockProductNames, ingestStockDeliveries, warMemberStatuses, flushData, myPlayerId };
