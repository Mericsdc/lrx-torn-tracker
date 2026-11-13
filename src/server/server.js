/**
 * Torn Tracker – yerel sunucu
 * - Statik arayüzü (public/) sunar
 * - Torn API ve FFScouter isteklerini sunucu tarafında yapar (API key tarayıcıya gitmez)
 * - Şirket verisinden günlük snapshot alır (data/history.json) -> günlük rapor & gelir tablosu
 *
 * Bağımlılık yok: Node 18+ (global fetch) yeterli.  Çalıştır: npm run web (node src/server/server.js)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { APP_ROOT: ROOT, dataDir } = require('../app-paths');

const PORT = Number(process.env.PORT) || 3737;
const PUBLIC = path.join(ROOT, 'public');
const DATA = dataDir();
const CONFIG_FILE = path.join(DATA, 'config.json');
const HISTORY_FILE = path.join(DATA, 'history.json');
const { buildBattleStats } = require('./battle-stats');

if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
const warGroups = require('./war-groups').createWarGroups(DATA);
const THEMES = new Set(['obsidian', 'ocean', 'forest', 'amethyst', 'light']);

/* ------------------------------------------------------------------ */
/* Config & history                                                    */
/* ------------------------------------------------------------------ */
const PKG = (() => { try { return require(path.join(ROOT, 'package.json')); } catch { return {}; } })();
const DEFAULT_UPDATE_URL = PKG.updateUrl || ''; // sabit: resmi GitHub sürüm adresi
const APP_VERSION = PKG.version || '';
const DEFAULT_CONFIG = { apiKey: process.env.TORN_API_KEY || '', ffscouterKey: '', coverDays: 3, pollMinutes: 15, deliveryHours: 6, deliveryMode: 'hours', theme: 'obsidian', features: {} };

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj, pretty = false) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj)); // büyük dosyalar sıkışık (yarı boyut)
  fs.renameSync(tmp, file);
}

let config = { ...DEFAULT_CONFIG, ...readJson(CONFIG_FILE, {}) };
const premiumClient = require('./premium-client').createPremiumClient(() => config.apiKey, {
  defaultServiceUrl: PKG.premiumServiceUrl || '',
  getRemembered: () => config.premiumConnection || null,
  setRemembered: (value) => { if (JSON.stringify(config.premiumConnection || null) !== JSON.stringify(value)) { if (value) config.premiumConnection = value; else delete config.premiumConnection; saveConfig(); } },
});
const ffScriptProxy = require('./ff-script-proxy').createFFScriptProxy(() => config, undefined, throttle);
// Language of user-facing server messages: English by default, Turkish when the app is set to TR
const T = (trStr, enStr) => (config.lang === 'tr' ? trStr : enStr);
delete config.updateUrl; // eski sürümlerde ayarlanabiliyordu; artık hep sabit adres kullanılır
let history = readJson(HISTORY_FILE, { days: [], addiction: {}, user: {}, stockOrders: {} });
history.days ||= []; history.addiction ||= {}; history.user ||= {}; history.stockOrders ||= {};
history.stockDeliveries ||= { at: 0, items: [] };
// Rebuild the saved bootstrap snapshot after the Xanax calculation fix.
if (history.lastOverview?.battle && history.lastOverview.battle.calculationVersion !== 2) {
  const old = history.lastOverview;
  const input = { icons: { drug: old.drug?.icon || '' }, cooldowns: old.cooldowns || { drug: old.drug?.cooldown || 0 } };
  for (const [key, stat] of Object.entries(old.battle.stats || {})) {
    input[key] = stat.base; input[key + '_modifier'] = stat.modifier;
    input[key + '_info'] = (stat.info || []).map((i) => i.text);
  }
  old.battle = buildBattleStats(input);
  if (old.drug) old.drug.xanaxActive = old.battle.xanaxActive;
}

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

/* history.json holds ONE player's records (stats, net worth, company days, purchases, busts ...).
   ownerId survives Log Out, so a different player who signs in later, or a key of another player saved in
   Settings, never inherits them. Returns true when the previous player's records were dropped. */
const playerIdOf = (value) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };
const historyOwner = () => playerIdOf(history.ownerId) ?? playerIdOf(history.lastOverview?.player?.id);
function adoptPlayer(playerId) {
  const id = playerIdOf(playerId);
  if (!id) return false;
  const previous = historyOwner();
  const changed = previous != null && previous !== id;
  if (changed) {
    history = { days: [], addiction: {}, user: {}, stockOrders: {}, stockDeliveries: { at: 0, items: [] }, eduNames: history.eduNames };
    // The previous player's separate log and FFScouter keys are not this player's.
    config.logKey = ''; config.ffscouterKey = '';
    logStatus = { ok: null, error: null, at: 0 };
    halloweenInfo = null;
    saveConfig();
  }
  if (history.ownerId !== id) {
    history.ownerId = id;
    if (changed) flushHistory(); else saveHistory(); // a dropped history leaves the disk at once
  }
  return changed;
}

/** Torn şirket günü her gün 18:00 TCT (UTC)'de yenilenir */
const tctDate = (ms = Date.now()) => new Date(ms - 18 * 3600_000).toISOString().slice(0, 10);
const xanBound = (day) => day.bound || (day.exactStart ? 'exact' : 'atLeast');
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
// Bumped whenever the API key changes: a Torn reply that was already on its way for the previous key
// must not be cached or written into the new player's history.
let keyGen = 0;
function resetKeyCaches() { keyGen++; cache.clear(); ffCache.clear(); estCache.clear(); }
async function cached(key, ttl, loader) {
  const c = cache.get(key);
  if (c && c.data !== undefined && Date.now() - c.t < ttl) return c.data;
  if (c && c.promise) return c.promise;
  const gen = keyGen;
  const promise = (async () => {
    try {
      const data = await loader();
      if (gen === keyGen) cache.set(key, { t: Date.now(), data });
      return data;
    } catch (e) {
      if (gen === keyGen) cache.delete(key);
      throw e;
    }
  })();
  cache.set(key, { ...(c || {}), promise });
  return promise;
}

// Torn answered "too many requests" (error 5 or HTTP 429; the limit is per player, shared with every other tool
// using the key): stop asking for half a minute instead of hammering a limited key. Requests fail fast meanwhile.
let tornPausedUntil = 0;
const RATE_PAUSE_MS = 30_000;
const rateLimited = () => new ApiError(T('Torn API istek sınırına ulaşıldı. Yarım dakika içinde kendiliğinden yeniden denenecek.', 'Torn API rate limit reached. It will be tried again by itself within half a minute.'), 5);
// Body of a Torn API reply. The API is untrusted input: anything but a JSON object is unreadable.
function tornReply(res, text) {
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (res.status === 429 || Number(json?.error?.code) === 5) { tornPausedUntil = Date.now() + RATE_PAUSE_MS; throw rateLimited(); }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new ApiError(T(`Torn API yanıtı okunamadı (HTTP ${res.status})`, `Could not read the Torn API response (HTTP ${res.status})`), 'BAD_RESPONSE');
  if (json.error) throw new ApiError(`Torn API: ${json.error.error}`, json.error.code);
  return json;
}

async function tornRaw(pathq) {
  if (!config.apiKey) throw new ApiError(T('API key ayarlanmamış. Ayarlar sekmesinden ekleyin.', 'API key not set. Add it in Settings.'), 'NO_KEY');
  if (Date.now() < tornPausedUntil) throw rateLimited();
  await throttle();
  if (Date.now() < tornPausedUntil) throw rateLimited(); // the limit was hit while this call waited its turn
  const sep = pathq.includes('?') ? '&' : '?';
  const url = `https://api.torn.com/${pathq}${sep}key=${encodeURIComponent(config.apiKey)}&comment=TornTracker`;
  const res = await fetch(url, { headers: { 'User-Agent': 'TornTracker/1.0' }, signal: AbortSignal.timeout(20_000) });
  return tornReply(res, await res.text());
}
const torn = (pathq, ttl = 30_000) => cached('torn:' + pathq, ttl, () => tornRaw(pathq));

/* ------------------------------------------------------------------ */
/* Battle stats helpers                                                */
/* ------------------------------------------------------------------ */
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
  const q = 'user/?selections=profile,cooldowns,education,battlestats,bars,icons,personalstats,travel,money,timestamp';
  if (force) cache.delete('torn:' + q);
  const gen = keyGen;
  const [u, eduNames] = await Promise.all([
    torn(q, 25_000),
    getEducationNames().catch(() => history.eduNames || {}),
  ]);
  if (gen !== keyGen) throw new ApiError(T('API key değişti, yeniden yükleniyor.', 'API key changed, reloading.'), 'KEY_CHANGED');
  // When Torn sent this reply. It may come from the 25 s cache, so the page must not take "now" for it:
  // every countdown and the TCT clock would run late by the cache age.
  const fetchedAt = cache.get('torn:' + q)?.t || Date.now();
  // The saved key can also change outside sign-in and Settings (config.json, TORN_API_KEY):
  // another player's records are never continued under this one.
  adoptPlayer(u.player_id);

  const icons = u.icons || {};
  const iconList = Object.values(icons).map(String);
  const drugIcon = iconList.find((t) => /^drug/i.test(t) || /drug cooldown/i.test(t)) || null;
  const bs = buildBattleStats(u);
  // Torn normally sends its clock; without it the local clock is close enough (and never an invalid date)
  const serverTime = Number(u.server_time || u.timestamp) || Math.floor(Date.now() / 1000);

  // Bugün alınan Xanax (gün başındaki sayaçtan fark)
  const today = tctDate(serverTime * 1000);
  const xantaken = u.personalstats?.xantaken ?? null;
  if (xantaken != null) {
    if (!history.user[today]) {
      // Start of the day's count (the day runs from 18:00 TCT). The app is often opened hours into the day, so the
      // last value seen the day before is the starting point when there is one:
      // - seen within 15 min before 18:00, or unchanged since: exact;
      // - seen earlier: an upper bound, since some of the difference may have been taken before 18:00;
      // - no record from the day before: the first value seen today, a lower bound.
      const dayBefore = history.user[tctDate(serverTime * 1000 - 86400_000)];
      const known = !!dayBefore && Number.isFinite(dayBefore.xanLast) && dayBefore.xanLast <= xantaken;
      const dayStart = Date.parse(today + 'T18:00:00Z') / 1000;
      const recent = known && Number.isFinite(dayBefore.xanLastAt) && dayStart - dayBefore.xanLastAt <= 15 * 60;
      const bound = !known ? 'atLeast' : recent || dayBefore.xanLast === xantaken ? 'exact' : 'atMost';
      history.user[today] = { xanStart: known ? dayBefore.xanLast : xantaken, bound };
    }
    history.user[today].xanLast = xantaken;
    history.user[today].xanLastAt = serverTime;
    pruneUserHistory();
  }

  const eduId = u.education_current;
  const result = {
    serverTime, fetchedAt,
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
      xanaxActive: bs.xanaxActive,
      xantaken,
      xanToday: xantaken != null ? xantaken - history.user[today].xanStart : null,
      // exact / atLeast (counted only since the app was opened today) / atMost (from an older count of the day before).
      // Records written before 'bound' existed only have exactStart.
      xanTodayBound: xantaken != null ? xanBound(history.user[today]) : null,
      xanTodayExact: xantaken != null ? xanBound(history.user[today]) === 'exact' : null,
      refills: u.personalstats?.refills ?? null,
    },
    education: {
      currentId: eduId || 0,
      current: eduId ? (eduNames[eduId]?.name || `${T('Kurs', 'Course')} #${eduId}`) : null,
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
    // Şehir bankası yatırımı: tutar ve bitişe kalan süre (sn)
    bank: u.city_bank && Number(u.city_bank.amount) > 0 ? { amount: Number(u.city_bank.amount), timeLeft: Number(u.city_bank.time_left) || 0 } : null,
  };
  recordStats(today, bs, u.personalstats || {});
  history.lastOverview = result;
  history.lastOverviewAt = fetchedAt;
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
      if (!j || typeof j.stocks !== 'object') throw new Error(T(`${name}: beklenmeyen veri`, `${name}: unexpected data`));
      return j;
    };
    const [y, p] = await Promise.allSettled([
      get('https://yata.yt/api/v1/travel/export/', 'YATA'),
      get('https://api.prombot.co.uk/api/travel', 'Prometheus'),
    ]);
    const yata = y.status === 'fulfilled' ? y.value : null;
    const prom = p.status === 'fulfilled' ? p.value : null;
    if (!yata && !prom) throw new ApiError(T(`Stok verisi alınamadı (${y.reason?.message}; ${p.reason?.message})`, `Could not get stock data (${y.reason?.message}; ${p.reason?.message})`), 'TRAVEL');
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
  // Teslim süresi tahmini: önce Torn stok sayfasındaki "Delivery: 24 hours", sonra ölçülen süre, en son ayar
  const tornHours = Object.fromEntries(Object.entries(history.tornDeliveryHours || {})
    .filter(([, h]) => Number.isFinite(h) && h > 0));
  const tornVals = Object.values(tornHours);
  const estHours = (tornVals.length ? Math.max(...tornVals) : 0) || history.learnedDeliveryHours || deliveryHours;
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
        const prodHours = tornHours[name] || estHours;
        const totalMs = prodHours * 3600_000;
        const byHoursEta = orderedAt + totalMs;
        const etaMs = deliveryMode === '18tct' ? nextResetMs : (byHoursEta > now ? byHoursEta : nextResetMs);
        const modeUsed = deliveryMode === '18tct' || byHoursEta <= now ? '18tct' : 'hours';
        orderDelivery = {
          amount: s.on_order, orderedAt, exact: !!ord?.exact, source: 'estimate', etaMs, nextResetMs,
          cycleTotalMs: modeUsed === '18tct' ? 24 * 3600_000 : totalMs, mode: modeUsed, deliveryHours: prodHours,
          learned: !!(tornHours[name] || history.learnedDeliveryHours), safeUntilDelivery: safe(etaMs),
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
        res = await fetch(url, { headers: { 'User-Agent': 'TornTracker/1.0' }, signal: AbortSignal.timeout(20_000) });
        body = await res.text();
      } catch (e) {
        ffStatus = { ok: false, error: T('FFScouter erişilemedi: ', 'Could not reach FFScouter: ') + e.message, checkedAt: Date.now() };
        break;
      }
      let json; try { json = JSON.parse(body); } catch { json = null; }
      if (!res.ok || (json && json.error)) {
        const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
        ffStatus = {
          ok: false,
          error: res.status === 401 || /regist/i.test(String(msg))
            ? T('API key FFScouter\'a kayıtlı değil. ffscouter.com adresinde key\'inizle bir kez giriş yapıp kaydedin (ücretsiz).',
              'Your API key is not registered with FFScouter. Sign in once on ffscouter.com with your key to register it (free).')
            : T(`FFScouter hatası: ${msg}`, `FFScouter error: ${msg}`),
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
/* Seviye 15 altı: Baldr's Levelling Targets                           */
/* ------------------------------------------------------------------ */
// oran.pw/baldrstargets'ın kullandığı açık topluluk listesi. Hedeflerin durumu kullanıcının kendi key'iyle,
// yalnızca sayfa açıkken ve dakikada en fazla ~30 istekle (hastanedekiler çıkış saatine kadar hiç) kontrol edilir.
const LEVEL_LISTS_URL = 'https://raw.githubusercontent.com/Baldr-Geek/Baldrs-List/refs/heads/main/data.json';
const LEVEL_STOP_CODES = new Set(['NO_KEY', 2, 8, 9, 10, 13, 14, 16, 18]); // key/erişim sorunu: taramayı durdur
const plainNum = (v) => Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0;

function getLevelLists() {
  return cached('level-lists', 6 * 3600_000, async () => {
    const r = await fetch(LEVEL_LISTS_URL, { headers: { 'User-Agent': 'TornTracker' }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new ApiError(T(`Hedef listesi alınamadı (HTTP ${r.status})`, `Could not get the target list (HTTP ${r.status})`), 'LIST_HTTP', 'levelling');
    const lists = {};
    for (const [name, rows] of Object.entries((await r.json()) || {})) {
      const arr = (Array.isArray(rows) ? rows : Object.values(rows || {}))
        .map((x) => ({ id: Number(x.id), name: String(x.name || ''), lvl: plainNum(x.lvl), total: plainNum(x.total), str: plainNum(x.str), def: plainNum(x.def), spd: plainNum(x.spd), dex: plainNum(x.dex) }))
        .filter((x) => Number.isInteger(x.id) && x.id > 0);
      if (arr.length) lists[name] = arr;
    }
    if (!Object.keys(lists).length) throw new ApiError(T('Hedef listesi boş geldi', 'The target list came back empty'), 'LIST_EMPTY', 'levelling');
    return lists;
  });
}

const levelScan = { list: null, wantedAt: 0, running: false, error: null, stoppedAt: 0, status: new Map() }; // id -> { state, until, description, level, at }
function levelStale(s, now) {
  if (!s) return true;
  if ((s.state === 'Hospital' || s.state === 'Jail') && s.until) return s.until * 1000 <= now;
  return now - s.at > (s.state === 'Okay' ? 3 : 6) * 60_000;
}
async function runLevelScan() {
  if (levelScan.running) return;
  levelScan.running = true;
  try {
    while (Date.now() - levelScan.wantedAt < 20_000) { // sayfa kapanınca (istek gelmeyince) durur
      const rows = (await getLevelLists())[levelScan.list] || [];
      const now = Date.now();
      const next = [...rows].sort((a, b) => b.lvl - a.lvl).find((r) => levelStale(levelScan.status.get(r.id), now));
      if (!next) { await sleep(3000); continue; }
      try {
        const u = await torn(`user/${next.id}?selections=basic`, 60_000);
        levelScan.status.set(next.id, { state: u.status?.state || '?', until: Number(u.status?.until) || 0, description: u.status?.description || '', level: Number(u.level) || 0, at: Date.now() });
        levelScan.error = null;
        levelScan.stoppedAt = 0;
      } catch (e) {
        levelScan.error = e.message;
        if (LEVEL_STOP_CODES.has(e.code)) { levelScan.stoppedAt = Date.now(); break; }
        if (e.code === 6) levelScan.status.set(next.id, { state: 'Unknown', until: 0, description: '', level: 0, at: Date.now() });
        await sleep(e.code === 5 ? 60_000 : 5000);
      }
      await sleep(2000);
    }
  } finally { levelScan.running = false; }
}
async function getLevelling(listName) {
  const lists = await getLevelLists();
  const names = Object.keys(lists);
  const list = lists[listName] ? listName : names[0];
  levelScan.list = list;
  levelScan.wantedAt = Date.now();
  // Key hatası sonrası 2 dk bekle; her sayfa yenilemesinde boşuna istek atma
  if (Date.now() - levelScan.stoppedAt > 120_000) runLevelScan().catch((e) => { levelScan.error = e.message; });
  const targets = lists[list].map((r) => {
    const s = levelScan.status.get(r.id);
    return { ...r, lvl: s?.level || r.lvl, status: s && s.state !== 'Unknown' ? { state: s.state, until: s.until, description: s.description } : null, checkedAt: s?.at || 0 };
  });
  return { lists: names, list, targets, checked: targets.filter((t) => t.checkedAt).length, error: levelScan.error, myLevel: history.lastOverview?.player?.level ?? null };
}

/* ------------------------------------------------------------------ */
/* Suç Merkezi: shoplifting güvenliği (yalnızca Torn API)              */
/* ------------------------------------------------------------------ */
const SHOPLIFT_STORES = {
  sallys_sweet_shop: "Sally's Sweet Shop", Bits_n_bobs: "Bits 'n' Bobs", tc_clothing: 'TC Clothing', super_store: 'Super Store',
  pharmacy: 'Pharmacy', cyber_force: 'Cyber Force', jewelry_store: 'Jewelry Store', big_als: "Big Al's Gun Shop",
};
async function getShoplifting() {
  const j = await torn('torn/?selections=shoplifting', 50_000);
  const stores = Object.entries(j.shoplifting || {}).map(([key, list]) => {
    const security = (Array.isArray(list) ? list : []).map((s) => ({ title: String(s.title || ''), down: !!s.disabled }));
    return { key, name: SHOPLIFT_STORES[key] || key.replace(/_/g, ' '), security, allDown: security.length > 0 && security.every((s) => s.down) };
  });
  return { stores, at: Date.now() };
}

/* ------------------------------------------------------------------ */
/* Merit takibi: eksik honor + medal, kişisel istatistikle ilerleme    */
/* ------------------------------------------------------------------ */
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
const wordsToNum = (s) => {
  let n = 0;
  for (const w of String(s).toLowerCase().split(/[\s-]+/)) { if (w === 'hundred') n = (n || 1) * 100; else if (WORD_NUM[w]) n += WORD_NUM[w]; else return 0; }
  return n;
};
const snake = (s) => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const FINISH = { 'smgs': 'sub_machine_guns', 'clubbing weapons': 'clubbing', 'fists or kick': 'hand_to_hand', 'heavy artillery': 'heavy_artillery', 'machine guns': 'machine_guns', 'mechanical weapons': 'mechanical', 'piercing weapons': 'piercing', 'pistols': 'pistols', 'rifles': 'rifles', 'shotguns': 'shotguns', 'slashing weapons': 'slashing', 'temporary weapons': 'temporary' };
const AWN = '([\\d,]+)';
// [açıklama kalıbı, (eşleşme, istatistik okuyucu) => şu anki değer]  — hedef, kalıptaki ilk sayıdır
const AWARD_RULES = [
  [`^Achieve ${AWN} critical hits`, (m, g) => g('attacking.hits.critical')],
  [`^Deal ${AWN} critical hits`, (m, g) => g('attacking.hits.critical')],
  [`^Achieve ${AWN} hits$`, (m, g) => g('attacking.hits.success')],
  [`^Achieve ${AWN} one hit kills`, (m, g) => g('attacking.hits.one_hit_kills')],
  [`^(?:Achieve a best kill streak of|Acquire a kill streak of) ${AWN}`, (m, g) => g('attacking.killstreak.best')],
  [`^Assist in ${AWN} attacks`, (m, g) => g('attacking.attacks.assist')],
  [`^Collect ${AWN} bounties`, (m, g) => g('bounties.collected.amount')],
  [`^Earn \\$${AWN} from bounty hunting`, (m, g) => g('bounties.collected.value')],
  [`^Deal over ${AWN} total damage`, (m, g) => g('attacking.damage.total')],
  [`^Deal at least ${AWN} damage in a single hit`, (m, g) => g('attacking.damage.best')],
  [`^Fire ${AWN} rounds`, (m, g) => g('attacking.ammunition.total')],
  [`^Make \\$${AWN} from a single mugging`, (m, g) => g('attacking.networth.largest_mug')],
  [`^Make ${AWN} stealthed attacks`, (m, g) => g('attacking.attacks.stealth')],
  [`^Stalemate ${AWN} times`, (m, g) => g('attacking.attacks.stalemate') + g('attacking.defends.stalemate')],
  [`^(?:Win ${AWN} defends|Successfully defend against ${AWN} attacks)`, (m, g) => g('attacking.defends.won')],
  [`^Win ${AWN} unarmored fights`, (m, g) => g('attacking.unarmored_wins')],
  [`^Win ${AWN} attacks`, (m, g) => g('attacking.attacks.won')],
  [`^Earn ${AWN} respect for your faction`, (m, g) => g('attacking.faction.respect')],
  [`^Have ${AWN} enemies escape from you`, (m, g) => g('attacking.escapes.foes')],
  [`^Successfully escape from ${AWN} foes`, (m, g) => g('attacking.escapes.player')],
  [`^Achieve ${AWN} skill in hunting`, (m, g) => g('travel.hunting.skill')],
  [`^Achieve ${AWN} hours of activity`, (m, g) => Math.floor(g('other.activity.time') / 3600)],
  [`^Be online every day for ${AWN} days`, (m, g) => g('other.activity.streak.best')],
  [`^Be a donator for ${AWN} days`, (m, g) => g('other.donator_days')],
  [`^Achieve a skill level of ${AWN} in (.+)$`, (m, g) => g(`crimes.skills.${snake(m[2])}`)],
  [`^Commit ${AWN} criminal offenses`, (m, g) => g('crimes.offenses.total')],
  [`^Commit a total of ${AWN} criminal offenses`, (m, g) => g('crimes.offenses.total')],
  [`^Commit ${AWN} (.+?) offenses`, (m, g) => g(`crimes.offenses.${snake(m[2]).replace(/^illicit_service$/, 'illicit_services')}`)],
  [`^Participate in ${AWN} organized crimes`, (m, g) => g('crimes.offenses.organized_crimes')],
  [`^Use ${AWN} (Cannabis|Ecstasy|Ketamine|LSD|Opium|PCP|Shrooms|Speed|Vicodin|Xanax)$`, (m, g) => g(`drugs.${m[2].toLowerCase()}`)],
  [`^Attain ${AWN} endurance`, (m, g) => g('jobs.stats.endurance')],
  [`^Attain ${AWN} intelligence`, (m, g) => g('jobs.stats.intelligence')],
  [`^Attain ${AWN} manual labor`, (m, g) => g('jobs.stats.manual')],
  [`^Achieve ${AWN} in any working stat`, (m, g) => Math.max(g('jobs.stats.endurance'), g('jobs.stats.intelligence'), g('jobs.stats.manual'))],
  [`^Complete ${AWN} education courses`, (m, g, x) => x.eduDone],
  [`^Attain ${AWN} total stats`, (m, g) => g('battle_stats.total')],
  [`^Gain ${AWN} (defense|dexterity|speed|strength)`, (m, g) => g(`battle_stats.${m[2]}`)],
  [`^Fill ${AWN} empty blood bags`, (m, g) => g('hospital.blood_withdrawn')],
  [`^Go to hospital ${AWN} times`, (m, g) => g('hospital.times_hospitalized')],
  [`^Revive ${AWN} people$`, (m, g) => g('hospital.reviving.revives')],
  [`^Use ${AWN} medical items`, (m, g) => g('hospital.medical_items_used')],
  [`^Drink ${AWN} bottles of alcohol`, (m, g) => g('items.used.alcohol')],
  [`^Drink ${AWN} cans of energy drink`, (m, g) => g('items.used.energy_drinks')],
  [`^Eat ${AWN} bags of candy`, (m, g) => g('items.used.candy')],
  [`^Find ${AWN} items in the city`, (m, g) => g('items.found.city')],
  [`^Find ${AWN} items in the dump`, (m, g) => g('items.found.dump')],
  [`^Have ${AWN} customers buy from your bazaar`, (m, g) => g('trading.bazaar.customers')],
  [`^Read ${AWN} books`, (m, g) => g('items.used.books')],
  [`^Trash ${AWN} items`, (m, g) => g('items.trashed')],
  [`^Win ${AWN} auctions`, (m, g) => g('trading.items.auctions.won')],
  [`^Bust ${AWN} people`, (m, g) => g('jail.busts.success')],
  [`^Go to jail ${AWN} times`, (m, g) => g('jail.times_jailed')],
  [`^Make ${AWN} bails`, (m, g) => g('jail.bails.amount')],
  [`^Reach level ${AWN}$`, (m, g, x) => x.level],
  [`^Achieve ${AWN} total awards`, (m, g) => g('other.awards')],
  [`^Code ${AWN} viruses`, (m, g) => g('items.viruses_coded')],
  [`^Earn ${AWN} racing points`, (m, g) => g('racing.points')],
  [`^Reach a racing skill of ${AWN}`, (m, g) => g('racing.skill')],
  [`^Win ${AWN} races$`, (m, g) => g('racing.races.won')],
  [`^Refill your energy bar ${AWN} times`, (m, g) => g('other.refills.energy')],
  [`^Refill your nerve bar ${AWN} times`, (m, g) => g('other.refills.nerve')],
  [`^Refill your casino tokens ${AWN} times`, (m, g) => g('other.refills.token')],
  [`^Sell ${AWN} points on the market`, (m, g) => g('trading.points.sold')],
  [`^Use ${AWN} job points`, (m, g) => g('jobs.job_points_used')],
  [`^Complete ${AWN} contracts`, (m, g) => g('missions.contracts.total')],
  [`^Earn ${AWN} mission credits`, (m, g) => g('missions.credits')],
  [`^Achieve \\$${AWN} in total losses in the stock market`, (m, g) => g('investments.stocks.losses')],
  [`^Achieve \\$${AWN} in total profits in the stock market`, (m, g) => g('investments.stocks.profits')],
  [`^Receive ${AWN} stock payouts`, (m, g) => g('investments.stocks.payouts')],
  [`^Defeat ${AWN} people while abroad`, (m, g) => g('travel.attacks_won')],
  [`^Import ${AWN} items from abroad`, (m, g) => g('travel.items_bought')],
  [`^Spend ${AWN} days in the air`, (m, g) => Math.floor(g('travel.time_spent') / 86400)],
  [`^Travel (?:abroad )?${AWN} times`, (m, g) => g('travel.total')],
  [`^Travel to (?:the )?(.+) ${AWN} times`, (m, g) => g(`travel.${snake(m[1])}`), 2],
  [`^Achieve ${AWN} finishing hits with (.+)$`, (m, g) => g(`finishing_hits.${FINISH[m[2].toLowerCase()] || snake(m[2])}`)],
  [`^Achieve ${AWN} finishing hits in every category`, (m, g) => Math.min(...Object.values(FINISH).map((k) => g(`finishing_hits.${k}`)))],
  [`^Use ${AWN} (Hollow Point|Incendiary|Piercing|Tracer) rounds`, (m, g) => g(`attacking.ammunition.${snake(m[2])}`)],
  [`^Use ${AWN} rounds of special ammunition`, (m, g) => g('attacking.ammunition.special')],
  [`^Have a recorded networth value of \\$${AWN}`, (m, g) => g('networth.total')],
].map(([re, cur]) => ({ re: new RegExp(re, 'i'), cur }));

const AWARD_RANKS = ['Beginner', 'Inexperienced', 'Rookie', 'Novice', 'Below Average', 'Average', 'Reasonable', 'Above Average', 'Competent', 'Highly Competent', 'Veteran', 'Distinguished', 'Highly Distinguished', 'Professional', 'Star', 'Master', 'Outstanding', 'Celebrity', 'Supreme', 'Idolized', 'Champion', 'Heroic', 'Legendary', 'Elite', 'Invincible'];
function awardProgress(desc, g, extra) {
  const d = String(desc);
  let m = d.match(/^Reach level ([A-Za-z -]+)$/i);
  if (m && wordsToNum(m[1])) return { goal: wordsToNum(m[1]), cur: extra.level };
  m = d.match(/^Live in Torn for ([a-z ]+) years?$/i);
  if (m && wordsToNum(m[1])) return { goal: wordsToNum(m[1]) * 365, cur: extra.ageDays, unit: 'days' };
  m = d.match(/^Stay married (?:to a single person )?for ([\d,]+) days/i);
  if (m) return { goal: Number(m[1].replace(/,/g, '')), cur: extra.marriedDays };
  m = d.match(/^Serve ([\d,]+) days in a single faction/i);
  if (m) return { goal: Number(m[1].replace(/,/g, '')), cur: extra.factionDays };
  m = d.match(/^Reach the rank of (.+)$/i);
  if (m) {
    const goal = AWARD_RANKS.findIndex((r) => r.toLowerCase() === m[1].trim().toLowerCase());
    const cur = AWARD_RANKS.reduce((best, r, i) => (extra.rank.toLowerCase().startsWith(r.toLowerCase()) ? i : best), -1);
    if (goal >= 0 && cur >= 0) return { goal: goal + 1, cur: cur + 1, unit: 'rank' };
  }
  for (const r of AWARD_RULES) {
    m = d.match(r.re);
    if (!m) continue;
    const goal = Number(String(m.slice(1).find((x) => x && /^[\d,]+$/.test(x)) || '').replace(/,/g, ''));
    const cur = Number(r.cur(m, g, extra));
    if (goal > 0 && Number.isFinite(cur)) return { goal, cur };
  }
  return null;
}

async function getAwards() {
  const [th, tm, uh, um, ps, pr] = await Promise.all([
    torn('v2/torn/honors', 6 * 3600_000), torn('v2/torn/medals', 6 * 3600_000),
    torn('v2/user/honors', 5 * 60_000), torn('v2/user/medals', 5 * 60_000), torn('v2/user/personalstats?cat=all', 5 * 60_000),
    torn('user/?selections=profile', 5 * 60_000),
  ]);
  const stats = ps.personalstats || {};
  const g = (p) => Number(p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), stats)) || 0;
  const ov = history.lastOverview;
  const extra = {
    level: Number(pr.level) || Number(ov?.player?.level) || 0,
    ageDays: Number(pr.age) || 0,
    marriedDays: Number(pr.married?.duration) || 0,
    factionDays: Number(pr.faction?.days_in_faction) || 0,
    rank: String(pr.rank || ''),
    eduDone: Array.isArray(ov?.education?.completed) ? ov.education.completed.length : Number(ov?.education?.completed) || 0,
  };
  const ownH = new Set((uh.honors || []).map((h) => h.id)), ownM = new Set((um.medals || []).map((h) => h.id));
  const list = [];
  const add = (a, kind, owned) => {
    if (a.type?.title === 'default' || a.crimes_version === 'v1') return; // varsayılan barlar ve artık alınamayan Crimes 1.0 ödülleri
    const p = owned ? null : awardProgress(a.description, g, extra);
    list.push({
      id: a.id, kind, name: a.name, description: a.description, type: a.type?.title || '', rarity: a.rarity || '',
      circulation: Number(a.circulation) || 0, owned,
      goal: p?.goal ?? null, cur: p ? Math.min(p.cur, p.goal) : null, pct: p ? Math.min(1, p.cur / p.goal) : null,
    });
  };
  for (const a of th.honors || []) add(a, 'honor', ownH.has(a.id));
  for (const a of tm.medals || []) add(a, 'medal', ownM.has(a.id));
  return {
    awards: list,
    totals: { honors: [ownH.size, (th.honors || []).length], medals: [ownM.size, (tm.medals || []).length], awards: g('other.awards') },
    at: Date.now(),
  };
}

// Raw merit allocations remain Free; the paid planner uses these cached values.
async function getMeritAllocation() {
  return cached('merits:allocation', 5 * 60_000, async () => {
    const [own, catalog] = await Promise.all([torn('v2/user/merits', 5 * 60_000), torn('v2/torn/merits', 6 * 3600_000)]);
    if (!Array.isArray(own.merits?.upgrades) || !Array.isArray(catalog.merits)) throw new Error(T('Merit verisi alınamadı.', 'Merit data unavailable.'));
    const levels = new Map(own.merits.upgrades.map((r) => [r.id, r.level]));
    return { available: own.merits.available, used: own.merits.used, awards: own.merits.honors + own.merits.medals,
      tracks: catalog.merits.map((m) => ({ id: String(m.id), name: m.name, description: m.description, level: levels.get(m.id) ?? 0 })), at: Date.now(), source: 'desktop-api-snapshot' };
  });
}

/* ------------------------------------------------------------------ */
/* Suç kârlılığı: Emforus'un Crime Profitability Index tablosu         */
/* ------------------------------------------------------------------ */
// Topluluk tablosu (Google Sheets); Torn'a istek değildir ve hiçbir kullanıcı verisi gönderilmez.
// Günde bir kez çekilir; çekilemezse son kayıtlı kopya, o da yoksa paketteki örnek kullanılır.
const CV_URL = 'https://docs.google.com/spreadsheets/d/13wUFhhssuPdAONI_OmRJi6l_Bs7KRZXDgVFCn7uJJNQ/gviz/tq?tqx=out:csv&gid=';
const CV_TABS = { all: '560321570', burglary: '706159343', cracking: '1626436424' };
const CV_FILE = path.join(DATA, 'crime-value.json');
const CV_SNAPSHOT = path.join(ROOT, 'assets', 'crime-value.json');
const CV_TTL = 24 * 3600_000;

function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const cvNum = (s) => {
  const t = String(s ?? '').replace(/[$,%\s]/g, '');
  if (!t || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

function buildCrimeValue(allCsv, burgCsv, crackCsv) {
  const byCrime = new Map();
  for (const r of parseCsv(allCsv).slice(1)) {
    const [crime, target, v] = r.map((x) => (x || '').trim());
    if (!crime || !target) continue;
    if (!byCrime.has(crime)) byCrime.set(crime, []);
    byCrime.get(crime).push({ target, value: cvNum(v) });
  }
  const crimes = [...byCrime].map(([crime, options]) => {
    const vals = options.filter((o) => o.value != null);
    const best = vals.sort((a, b) => b.value - a.value)[0];
    return { crime, best: best?.target || null, value: best?.value ?? null, options };
  });
  const bh = parseCsv(burgCsv);
  const head = (bh[0] || []).map((h) => h.trim().toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const ci = {
    target: col(/^target$/), district: col(/^district$/), incidence: col(/incidence/), cases: col(/casing/),
    item: col(/item drop value/), moneyRate: col(/money droprate/), money: col(/average money/), nerve: col(/nerve cost/),
    value: col(/^estimated \$\/n$/), focused: col(/focused/),
  };
  const burglary = bh.slice(1).map((r) => {
    const g = (k) => (ci[k] >= 0 ? r[ci[k]] : '');
    return {
      target: (g('target') || '').trim(), district: (g('district') || '').trim(),
      incidence: cvNum(g('incidence')), cases: cvNum(g('cases')), item: cvNum(g('item')), moneyRate: cvNum(g('moneyRate')),
      money: cvNum(g('money')), nerve: cvNum(g('nerve')), value: cvNum(g('value')), focused: cvNum(g('focused')),
    };
  }).filter((b) => b.target && b.value != null);
  const cracking = parseCsv(crackCsv).slice(1).map((r) => ({
    type: (r[0] || '').trim(), service: (r[1] || '').trim(), v6: cvNum(r[6]), v7: cvNum(r[7]),
  })).filter((c) => c.type && c.service && (c.v6 != null || c.v7 != null));
  if (!crimes.length) throw new Error(T('tablo boş geldi', 'the sheet came back empty'));
  // Burglary için "All" sekmesi yalnızca focused/ortalama değerleri verir; normal keşifteki en iyi hedefi öne al
  const bc = crimes.find((c) => c.crime.toLowerCase() === 'burglary');
  const topB = [...burglary].sort((a, b) => b.value - a.value)[0];
  if (bc && topB && topB.value > (bc.value || 0)) { bc.best = topB.target; bc.value = topB.value; }
  return { fetchedAt: Date.now(), source: 'Emforus · Crime Profitability Index', crimes, burglary, cracking };
}

let cvMem = null;
let cvBusy = null;
async function getCrimeValue(force = false) {
  if (!cvMem) cvMem = readJson(CV_FILE, null);
  if (!force && cvMem && Date.now() - cvMem.fetchedAt < CV_TTL) return cvMem;
  if (cvBusy) return cvBusy;
  cvBusy = (async () => {
    try {
      const get = async (gid) => {
        const r = await fetch(CV_URL + gid, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'TornTracker/1.0' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      };
      const [a, b, c] = await Promise.all([get(CV_TABS.all), get(CV_TABS.burglary), get(CV_TABS.cracking)]);
      cvMem = buildCrimeValue(a, b, c);
      try { writeJson(CV_FILE, cvMem); } catch {}
    } catch (e) {
      cvMem ||= readJson(CV_SNAPSHOT, null);
      if (!cvMem) throw new ApiError(T(`Kârlılık tablosu alınamadı: ${e.message}`, `Could not get the profitability sheet: ${e.message}`), 'CV_FETCH', 'sheet');
      cvMem = { ...cvMem, stale: e.message };
    } finally { cvBusy = null; }
    return cvMem;
  })();
  return cvBusy;
}
// Torn sayfa yardımcısı için küçük özet (electron-main enjekte eder): suç -> { hedef(küçük harf) -> $/N }
function crimeValueForPage() {
  const cv = cvMem || readJson(CV_FILE, null) || readJson(CV_SNAPSHOT, null);
  if (!cv) return null;
  const crimes = {};
  for (const c of cv.crimes) {
    const m = {};
    for (const o of c.options) if (o.value != null) m[o.target.toLowerCase()] = o.value;
    crimes[c.crime.toLowerCase()] = { best: c.value, options: m };
  }
  const burglary = {};
  for (const b of cv.burglary) burglary[b.target.toLowerCase()] = { d: b.district, c: b.cases, v: b.value, f: b.focused, n: b.nerve };
  return { crimes, burglary };
}

/* ------------------------------------------------------------------ */
/* Log erişimi (isteğe bağlı): bust zamanları ve alış fiyatları         */
/* ------------------------------------------------------------------ */
// Torn log'u yalnızca Full ya da "log" izni verilmiş özel (custom) key ile okunur. Limited key'de
// bu özellikler personalstats farkı / elle girilen fiyatla çalışır. Log key yalnızca bu bilgisayarda saklanır.
const LOG_BUY = { 1112: 'market', 1103: 'market', 1225: 'bazaar', 1220: 'bazaar', 4200: 'shop', 4201: 'abroad' };
const LOG_BUST = 5360;
function ensureLogHistory() {
  history.busts ||= { last: null, events: [] };
  history.purchases ||= {};
  history.manualCosts ||= {};
  history.logSeen ||= [];
}
let logStatus = { ok: null, error: null, at: 0 };

async function tornLogRaw(pathq) {
  const key = config.logKey || config.apiKey;
  if (!key) throw new ApiError(T('API key ayarlanmamış.', 'API key not set.'), 'NO_KEY');
  if (Date.now() < tornPausedUntil) throw rateLimited();
  await throttle();
  const res = await fetch(`https://api.torn.com/${pathq}&key=${encodeURIComponent(key)}&comment=TornTracker`, { headers: { 'User-Agent': 'TornTracker/1.0' }, signal: AbortSignal.timeout(20_000) });
  return tornReply(res, await res.text());
}

function ingestLogs(list) {
  ensureLogHistory();
  const seen = new Set(history.logSeen);
  let changed = false;
  for (const e of list) {
    const id = String(e.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id); history.logSeen.push(id); changed = true;
    const type = Number(e.details?.id);
    const ts = Number(e.timestamp) * 1000;
    const d = e.data || {};
    if (type === LOG_BUST) { history.busts.events.push(ts); continue; }
    const src = LOG_BUY[type];
    if (!src) continue;
    const add = (itemId, qty, each) => {
      itemId = Number(itemId); qty = Number(qty) || 1; each = Number(each);
      if (!itemId || !(each > 0)) return;
      const arr = (history.purchases[itemId] ||= []);
      arr.push({ ts, qty, each, src });
      arr.sort((a, b) => b.ts - a.ts); arr.length = Math.min(arr.length, 20);
    };
    if (Array.isArray(d.items)) for (const it of d.items) add(it.id, it.qty, d.cost_each);
    else add(d.item, d.quantity, d.cost_each);
  }
  if (history.logSeen.length > 3000) history.logSeen = history.logSeen.slice(-2000);
  const cutoff = Date.now() - 7 * 86400_000;
  history.busts.events = [...new Set(history.busts.events)].filter((t) => t > cutoff).sort((a, b) => a - b);
  if (changed) saveHistory();
}

// Log'u en fazla dakikada bir oku (Torn log API'si zaten ~60 sn önbellekli)
async function syncLogs(force = false) {
  if (!force && Date.now() - logStatus.at < 60_000) return logStatus;
  logStatus.at = Date.now();
  try {
    const ids = [LOG_BUST, ...Object.keys(LOG_BUY)].join(',');
    const j = await tornLogRaw(`v2/user/log?log=${ids}&limit=100`);
    ingestLogs(Array.isArray(j.log) ? j.log : Object.values(j.log || {}));
    logStatus = { ok: true, error: null, at: logStatus.at };
  } catch (e) {
    logStatus = { ok: false, error: e.code === 16 ? 'ACCESS' : e.message, at: logStatus.at };
  }
  return logStatus;
}

/* Jail bust takibi --------------------------------------------------- */
// Topluluk modeli (BUSTR / Bustr+): her başarılı bust 128 puan ekler, puan 128/(1+saat/10) ile azalır, 72 saatte düşer.
// Torn resmî rakam yayımlamaz; yalnızca yol gösterici.
const bustScore = (events, now = Date.now()) => events
  .filter((t) => now - t < 72 * 3600_000)
  .reduce((s, t) => s + 128 / (1 + (now - t) / 36e5 / 10), 0);

async function getJail() {
  ensureLogHistory();
  const [ps, lg] = await Promise.all([
    torn('v2/user/personalstats?cat=jail', 60_000).catch(() => null),
    syncLogs(),
  ]);
  const j = ps?.personalstats?.jail || {};
  const success = Number(j.busts?.success) || 0;
  const b = history.busts;
  // Log yoksa: başarılı bust sayısındaki artışı o anki zamana yaz (uygulama açıkken takip)
  if (!lg.ok && ps && b.last != null && success > b.last) {
    const add = Math.min(50, success - b.last);
    for (let i = 0; i < add; i++) b.events.push(Date.now() - i * 1000);
    b.events.sort((x, y) => x - y);
    saveHistory();
  }
  if (ps && b.last !== success) { b.last = success; saveHistory(); }
  const now = Date.now();
  const in72 = b.events.filter((t) => now - t < 72 * 3600_000);
  const score = bustScore(b.events, now);
  // Puanın şu andan itibaren nasıl düşeceği (6 saatlik adımlarla, 72 saat)
  const decay = [];
  for (let h = 0; h <= 72; h += 6) decay.push({ h, score: Math.round(bustScore(b.events, now + h * 3600_000)) });
  return {
    source: lg.ok ? 'log' : 'stats', logError: lg.ok ? null : lg.error,
    total: { success, fails: Number(j.busts?.fails) || 0, jailed: Number(j.times_jailed) || 0, bails: Number(j.bails?.amount) || 0 },
    last24: in72.filter((t) => now - t < 24 * 3600_000).length, last72: in72.length,
    score: Math.round(score), decay, lastBust: in72.length ? in72[in72.length - 1] : null, at: now,
  };
}

/* Alış fiyatı koruması ----------------------------------------------- */
function costOf(id) {
  ensureLogHistory();
  const m = history.manualCosts[id];
  if (m && m.cost > 0) return { cost: m.cost, src: 'manual', at: m.at };
  const buys = (history.purchases[id] || []).filter((x) => Date.now() - x.ts < 60 * 86400_000);
  if (!buys.length) return null;
  const qty = buys.reduce((s, x) => s + x.qty, 0);
  const cost = Math.round(buys.reduce((s, x) => s + x.each * x.qty, 0) / qty);
  return { cost, src: buys[0].src, at: buys[0].ts, last: buys[0].each, qty, n: buys.length };
}
async function getPurchases() {
  ensureLogHistory();
  const [lg, items] = await Promise.all([syncLogs(), torn('torn/?selections=items', 3600_000).catch(() => ({}))]);
  const market = items.items || {};
  const ids = new Set([...Object.keys(history.purchases), ...Object.keys(history.manualCosts)]);
  const list = [...ids].map((id) => {
    const c = costOf(id); if (!c) return null;
    return { id: Number(id), name: market[id]?.name || `#${id}`, market: Number(market[id]?.market_value) || 0, ...c };
  }).filter(Boolean).sort((a, b) => b.at - a.at);
  return {
    logAccess: !!lg.ok, logError: lg.ok ? null : lg.error, logKeyMasked: maskKey(config.logKey),
    items: list,
    catalog: Object.entries(market).filter(([, v]) => v.tradeable !== false).map(([id, v]) => [Number(id), v.name]).sort((a, b) => a[1].localeCompare(b[1])),
    at: Date.now(),
  };
}
// Torn sayfa yardımcısı için: eşya ID -> alış fiyatı
function purchaseCostsForPage() {
  ensureLogHistory();
  const out = {};
  const ids = new Set([...Object.keys(history.purchases), ...Object.keys(history.manualCosts)]);
  for (const id of ids) { const c = costOf(id); if (c) out[id] = c.cost; }
  return out;
}

/* Etkinlikler: Torn takvimi + Halloween sepeti ------------------------ */
/* ---------- Etkinlikler: Torn takvimi (tarihler her yıl API'den gelir, sabit değil) ---------- */
// Yıllık etkinlikler ve Torn sayfa yardımcıları: Easter → yumurta bulucu, Trick or Treat → şeker dükkânı,
// Christmas Town → CT yardımcısı. Yardımcılar yalnızca oyuncunun kendi etkinlik penceresinde çalışır.
// prep: etkinlikten önce hazırlık anı (takvim gününe göre sn). Trick or Treat sepetleri bir gün önce
// 12:00 TCT'de Sweet Shop'ta satışa çıkar (IceBlueFire'ın Trick or Treat rehberi, SSS 2).
const SEASONAL = [
  { id: 'easter', re: /easter egg hunt/i },
  { id: 'halloween', re: /trick or treat|halloween/i, prep: -12 * 3600 },
  { id: 'christmas', re: /christmas town/i },
];
const EVENT_GRACE = 30 * 60; // sn: saat farkına karşı pencerenin iki ucuna küçük pay
const CAL_TTL = 3 * 3600_000;
const startOffset = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : null; };
const dayOf = (t) => Math.floor(t / 86400) * 86400;
// Kişisel başlangıçlı çok günlü etkinlik: ilk gün + oyuncunun saati → son gün + oyuncunun saati
// (Torn'daki "16:00 02/04 – 16:00 08/04" gösterimiyle aynı). Saat bilinmiyorsa olası en geniş aralık.
function eventWindow(e, offset) {
  if (e.fixed) return { start: e.start, end: e.end, exact: true };
  if (offset == null) return { start: e.earliest ?? e.start, end: e.latest ?? e.end, exact: false };
  if (dayOf(e.end) > dayOf(e.start)) return { start: dayOf(e.start) + offset, end: dayOf(e.end) + offset, exact: true };
  return { start: e.start, end: e.end, exact: false }; // tek günlük kişisel etkinlik: takvim günü
}
let eventCalBusy = null;
async function refreshEventCal(force = false) {
  const cur = history.eventCal;
  if (!config.apiKey) return cur || null;
  if (!force && cur && Date.now() - cur.at < CAL_TTL) return cur;
  if (eventCalBusy) return eventCalBusy;
  eventCalBusy = (async () => {
    const [cal, me] = await Promise.all([
      torn('v2/torn/calendar', CAL_TTL),
      torn('v2/user/calendar', 3600_000).catch(() => null),
    ]);
    const list = [...(cal.calendar?.events || []).map((e) => ({ ...e, kind: 'event' })), ...(cal.calendar?.competitions || []).map((e) => ({ ...e, kind: 'competition' }))]
      .map((e) => ({ title: e.title, description: e.description, kind: e.kind, start: e.start, end: e.end, earliest: e.earliest_start ?? e.start, latest: e.latest_end ?? e.end, fixed: e.fixed_start_time !== false }));
    history.eventCal = { at: Date.now(), startTime: me?.calendar?.start_time || cur?.startTime || null, list };
    saveHistory();
    return history.eventCal;
  })().finally(() => { eventCalBusy = null; });
  return eventCalBusy;
}
// Her yıllık etkinlik için şu anki ya da sıradaki pencere
function seasonalList(now = Math.floor(Date.now() / 1000)) {
  const cal = history.eventCal;
  const offset = startOffset(cal?.startTime);
  return SEASONAL.map(({ id, re, prep }) => {
    const all = (cal?.list || []).filter((e) => re.test(e.title)).map((e) => ({ e, w: eventWindow(e, offset) })).sort((a, b) => a.w.start - b.w.start);
    const cur = all.find(({ w }) => w.start - EVENT_GRACE <= now && w.end + EVENT_GRACE >= now);
    const next = all.find(({ w }) => w.start > now);
    const last = [...all].reverse().find(({ w }) => w.end < now);
    const hit = cur || next || last;
    const prepStart = prep != null && hit ? dayOf(hit.e.start) + prep : null;
    const status = cur ? 'active' : next ? 'upcoming' : last ? 'past' : 'unknown';
    return {
      id, title: hit?.e.title || null, start: hit?.w.start ?? null, end: hit?.w.end ?? null, exact: hit?.w.exact ?? false,
      status, prepStart, stage: status === 'active' ? 'live' : status === 'upcoming' && prepStart != null && now >= prepStart ? 'prep' : null,
    };
  });
}
// Torn sayfa yardımcıları: etkinlik penceresinde ve (varsa) hazırlık anından itibaren açık
const seasonalActive = (id) => seasonalList().some((s) => s.id === id && (s.stage === 'live' || s.stage === 'prep'));

let halloweenInfo = null; // Torn sayfa yardımcısı için son bilinen sepet durumu
// v2/user/competition: Halloween → sepet + toplanan şeker, Easter → bulunan yumurta. Hata 33: aktif yarışma yok / katılmadın.
async function getCompetition() {
  try { return { ok: true, c: (await torn('v2/user/competition', 5 * 60_000))?.competition || null }; }
  catch (e) { return { ok: e.code === 33, c: null }; }
}
async function getHalloween(live) {
  const [h, th, comp] = await Promise.all([
    torn('v2/user/halloween', 5 * 60_000).catch(() => null),
    torn('v2/torn/halloween', 6 * 3600_000).catch(() => null),
    getCompetition(),
  ]);
  const c = comp.c && /halloween/i.test(String(comp.c.name || '')) ? comp.c : null;
  const own = new Set((h?.halloween?.basket_upgrades || []).map((u) => u.id));
  halloweenInfo = {
    basket: c?.basket?.name || null,
    hasBasket: c ? !!c.basket : (live && comp.ok ? false : null), // null: bilinmiyor
    treats: h?.halloween?.treats || (c ? { total: c.treats_collected, current: null } : null),
    upgrades: (th?.halloween?.basket_upgrades || []).map((u) => ({ id: u.id, name: u.name, description: u.description, cost: u.cost, requirement: u.requirement, owned: own.has(u.id) })),
    at: Date.now(),
  };
  return halloweenInfo;
}
const halloweenForPage = () => ({
  hasBasket: halloweenInfo?.hasBasket ?? null, basket: halloweenInfo?.basket || null,
  stage: seasonalList().find((x) => x.id === 'halloween')?.stage || null,
});

async function getEvents(force = false) {
  const cal = await refreshEventCal(force).catch((e) => { if (history.eventCal) return history.eventCal; throw e; });
  if (!cal) throw new Error(T('Torn takvimi okunamadı.', 'Could not read the Torn calendar.'));
  const now = Math.floor(Date.now() / 1000);
  const offset = startOffset(cal.startTime);
  const events = cal.list
    .map((e) => { const w = eventWindow(e, offset); return { title: e.title, description: e.description, kind: e.kind, start: w.start, end: w.end, exact: w.exact, fixed: e.fixed }; })
    .filter((e) => e.end >= now - 86400)
    .sort((a, b) => a.start - b.start);
  const seasonal = seasonalList(now);
  const hw = seasonal.find((s) => s.id === 'halloween');
  // Halloween verisi yalnızca etkinlik penceresine 2 gün kala → bitişten 1 gün sonraya kadar çekilir
  const halloween = hw?.start && hw.start - 2 * 86400 <= now && hw.end + 86400 >= now ? await getHalloween(hw.status === 'active') : null;
  // Easter sırasında bulunan yumurta sayısı (yarışma verisi)
  const easter = seasonal.some((s) => s.id === 'easter' && s.status === 'active')
    ? await getCompetition().then(({ c }) => (c && /easter/i.test(String(c.name || '')) ? { score: c.score, total: c.total } : null))
    : null;
  return { events, active: events.filter((e) => e.start <= now && e.end >= now), startTime: cal.startTime, seasonal, halloween, easter, calAt: cal.at, at: Date.now() };
}
// Takvim 3 saatte bir tazelenir: Torn sayfa yardımcıları uygulama açıkken de doğru günde açılıp kapanır
const pollEvents = () => { if (config.apiKey) refreshEventCal().catch((e) => console.warn('[poll] events:', e.message)); };
setInterval(pollEvents, CAL_TTL).unref();
setTimeout(pollEvents, 15000).unref();

/* ------------------------------------------------------------------ */
/* Faction: OC takibi ve haftalık üye raporu                            */
/* ------------------------------------------------------------------ */
// Faction bölümünü yalnızca lider, eş lider ve liderin "Organised Crimes" yetkisi verdiği pozisyondakiler görür.
// İzni Torn'un kendisi verir: faction/positions ve faction/crimes "Faction API Access" ister; lider bunu oyunda
// pozisyonlara dağıtır. Uygulama ayrıca bir yetki listesi tutmaz. Bütün veriler Torn API'den gelir.
const FAC_NO_ACCESS = new Set([7, 16]); // 7: faction izni yok, 16: key seviyesi yetmiyor
const OC_AWAY = new Set(['Traveling', 'Abroad', 'Hospital', 'Jail', 'Federal']);

async function myIdNow() {
  const id = Number(myPlayerId());
  if (id) return id;
  return Number((await torn('v2/user/basic', 3600_000)).profile?.id) || 0;
}

// Erişim 10 dakika saklanır (her sayfa açılışında Torn'a tekrar sorulmaz)
const factionAccess = (force = false) => {
  if (force) cache.delete('faction-access');
  return cached('faction-access', 10 * 60_000, async () => {
    const f = (await torn('v2/user/faction', 10 * 60_000)).faction;
    if (!f) return { inFaction: false, allowed: false };
    const [me, basic] = await Promise.all([myIdNow(), torn('v2/faction/basic', 3600_000).then((j) => j.basic)]);
    const role = me && me === basic.leader_id ? 'leader' : me && me === basic.co_leader_id ? 'co-leader' : null;
    const out = {
      inFaction: true, faction: { id: f.id, name: f.name, tag: f.tag }, position: f.position, role,
      allowed: !!role, apiAccess: role ? true : null, ocAbility: role ? true : null, members: basic.members,
    };
    if (!role) {
      try {
        const pos = await torn('v2/faction/positions', 3600_000);
        const mine = (pos.positions || []).find((p) => p.name === f.position);
        out.apiAccess = true;
        out.ocAbility = !!mine?.abilities?.includes('Organised Crimes');
        out.allowed = out.ocAbility;
      } catch (e) {
        if (!FAC_NO_ACCESS.has(Number(e.code))) throw e;
        out.apiAccess = false;
      }
    }
    return out;
  });
};

const itemNames = async () => (await torn('torn/?selections=items', 3600_000).catch(() => ({}))).items || {};

// Bir OC'nin slotlarını sadeleştir: kim, hangi rol, eşyası var mı, şu an uzakta mı
function ocSummary(c, items, byId, now) {
  const slots = (c.slots || []).map((s) => {
    const m = s.user ? byId.get(s.user.id) : null;
    const req = s.item_requirement;
    return {
      role: s.position_info?.label || s.position, userId: s.user?.id || null,
      name: m?.name || (s.user ? `#${s.user.id}` : null), progress: s.user?.progress ?? null, cpr: s.checkpoint_pass_rate ?? null,
      item: req ? { id: req.id, name: items[req.id]?.name || `#${req.id}`, ok: !!req.is_available, reusable: !!req.is_reusable } : null,
      away: m && OC_AWAY.has(m.state) ? { state: m.state, until: m.until, desc: m.desc } : null,
    };
  });
  const open = slots.filter((s) => !s.userId).length;
  return {
    id: c.id, name: c.name, difficulty: c.difficulty, status: c.status,
    readyAt: c.ready_at || null, expiredAt: c.expired_at || null,
    filled: slots.length - open, total: slots.length, open, slots,
    missing: slots.filter((s) => s.userId && s.item && !s.item.ok).map((s) => ({ id: s.userId, name: s.name, role: s.role, item: s.item.name })),
    away: slots.filter((s) => s.away).map((s) => ({ id: s.userId, name: s.name, role: s.role, ...s.away })),
    delayed: c.status === 'Planning' && !!c.ready_at && c.ready_at <= now,
  };
}

const memberRow = (m) => ({
  id: m.id, name: m.name, level: m.level, position: m.position, days: m.days_in_faction, inOc: !!m.is_in_oc,
  last: m.last_action?.timestamp || 0, lastRel: m.last_action?.relative || '', lastStatus: m.last_action?.status || '',
  state: m.status?.state || '', until: m.status?.until || null, desc: m.status?.description || '',
});

// Herkes: kendi OC'si (yalnızca kendi bilgisi)
async function getMyOcInfo() {
  let oc;
  try { oc = (await torn('v2/user/organizedcrime', 5 * 60_000)).organizedCrime; }
  catch (e) { return { error: e.message }; }
  if (!oc || oc.error) return { inOc: false };
  const [me, items] = await Promise.all([myIdNow(), itemNames()]);
  const s = ocSummary(oc, items, new Map(), Math.floor(Date.now() / 1000));
  const mine = s.slots.find((x) => x.userId === me) || null;
  return { inOc: true, crime: { id: s.id, name: s.name, difficulty: s.difficulty, status: s.status, readyAt: s.readyAt, expiredAt: s.expiredAt, filled: s.filled, total: s.total }, slot: mine && { role: mine.role, progress: mine.progress, cpr: mine.cpr, item: mine.item } };
}

// Yetkili: OC'ye girmeyenler ve sorunlu OC'ler
async function getFactionOC(force = false) {
  const access = await factionAccess(force);
  if (!access.allowed) return { access };
  const ttl = force ? 0 : 60_000;
  const [mem, cr, items] = await Promise.all([
    torn('v2/faction/members', ttl), torn('v2/faction/crimes?cat=available&limit=100', ttl), itemNames(),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const members = (mem.members || []).map(memberRow);
  const byId = new Map(members.map((m) => [m.id, m]));
  const rank = (c) => (c.delayed ? 0 : c.missing.length || c.away.length ? 1 : c.status === 'Planning' ? 2 : 3);
  const crimes = (cr.crimes || []).map((c) => ocSummary(c, items, byId, now))
    .sort((a, b) => rank(a) - rank(b) || (a.readyAt || a.expiredAt || 9e9) - (b.readyAt || b.expiredAt || 9e9));
  return {
    access, at: Date.now(),
    totals: { members: members.length, inOc: members.filter((m) => m.inOc).length },
    notInOc: members.filter((m) => !m.inOc).sort((a, b) => b.last - a.last),
    crimes,
  };
}

/* Haftalık rapor: üyelerin kişisel istatistik farkı (son 7 gün). Torn günlük kayıt tutar; her üye için
   bugünün ve 7 gün önceki değer bir kez çekilip saklanır, sonraki günlerde yalnızca yeni gün çekilir. */
const FAC_STATS = ['timeplayed', 'xantaken', 'criminaloffenses', 'bloodwithdrawn', 'organizedcrimes'];
const facJob = { running: false, done: 0, total: 0, error: null, startedAt: 0, finishedAt: 0 };
const facStore = () => { history.faction ||= { snaps: {}, gym: {} }; history.faction.snaps ||= {}; history.faction.gym ||= {}; return history.faction; };
const utcDay = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
const dayTs = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000);

async function memberStats(id, ts) {
  const q = `v2/user/${id}/personalstats?stat=${FAC_STATS.join(',')}${ts ? `&timestamp=${ts}` : ''}`;
  let j;
  try { j = await tornRaw(q); }
  catch (e) {
    if (Number(e.code) !== 5) throw e; // 5: çok fazla istek → bir dakika bekle, bir kez daha dene
    await sleep(61_000); j = await tornRaw(q);
  }
  const out = {};
  for (const s of j.personalstats || []) out[s.name] = s.value;
  return out;
}

async function runFactionReport() {
  if (facJob.running) return facJob;
  const access = await factionAccess();
  if (!access.allowed) throw new ApiError(T('Bu rapor faction liderine ve yetki verdiği pozisyonlara açık.', 'This report is only available to the faction leader and the positions they have given access.'), 'FAC_DENIED');
  Object.assign(facJob, { running: true, done: 0, total: 0, error: null, startedAt: Date.now(), finishedAt: 0 });
  (async () => {
    const st = facStore();
    try {
      const mem = await torn('v2/faction/members', 60_000);
      const ids = (mem.members || []).map((m) => m.id);
      const now = Math.floor(Date.now() / 1000);
      const today = utcDay(now);
      const past = utcDay(now - 7 * 86400);
      st.snaps[today] ||= {}; st.snaps[past] ||= {};
      const todo = [];
      for (const id of ids) {
        if (!st.snaps[today][id]) todo.push([id, 0, today]);
        if (!st.snaps[past][id]) todo.push([id, now - 7 * 86400, past]);
      }
      facJob.total = todo.length + 1;
      for (const [id, ts, day] of todo) {
        try { st.snaps[day][id] = await memberStats(id, ts); }
        catch (e) { if (!FAC_NO_ACCESS.has(Number(e.code)) && Number(e.code) !== 6) throw e; } // 6: geçersiz ID → atla
        facJob.done++;
        if (facJob.done % 10 === 0) saveHistory();
        await sleep(1500); // ~40 istek/dk: uygulamanın diğer istekleri ve TornTools için pay kalır (Torn sınırı 100/dk)
      }
      // Gym enerjisi: faction katkı listesi (toplam değer) — günlük kayıt, fark kayıtlar arasından hesaplanır
      try {
        const c = await tornRaw('v2/faction/contributors?stat=gymenergy&cat=current');
        st.gym[today] = Object.fromEntries((c.contributors || []).map((x) => [x.id, x.value]));
        st.gymError = null;
      } catch (e) { st.gymError = e.message; }
      facJob.done++;
      // 40 günden eski kayıtları sil
      const cut = utcDay(now - 40 * 86400);
      for (const k of Object.keys(st.snaps)) if (k < cut) delete st.snaps[k];
      for (const k of Object.keys(st.gym)) if (k < cut) delete st.gym[k];
      st.builtAt = Date.now();
    } catch (e) {
      facJob.error = e.message;
    } finally {
      facJob.running = false; facJob.finishedAt = Date.now();
      saveHistory();
    }
  })();
  return facJob;
}

function topList(rows, key, n = 10, asc = false) {
  return rows.filter((r) => r[key] != null && (asc || r[key] > 0))
    .sort((a, b) => (asc ? a[key] - b[key] : b[key] - a[key])).slice(0, n)
    .map((r) => ({ id: r.id, name: r.name, value: r[key] }));
}

async function getFactionReport(start = false) {
  const access = await factionAccess();
  if (!access.allowed) return { access };
  const st = facStore();
  const now = Math.floor(Date.now() / 1000);
  const today = utcDay(now);
  const mem = await torn('v2/faction/members', 60_000);
  const members = (mem.members || []).map(memberRow);
  const fresh = members.length && members.every((m) => st.snaps[today]?.[m.id]);
  if ((start || !fresh) && !facJob.running && !(facJob.error && Date.now() - facJob.finishedAt < 5 * 60_000)) await runFactionReport();

  // En yeni gün ile 7 gün öncesi
  const days = Object.keys(st.snaps).filter((d) => Object.keys(st.snaps[d]).length).sort();
  const to = days[days.length - 1] || null;
  const from = to ? utcDay(dayTs(to) - 7 * 86400) : null;
  const A = from && st.snaps[from], B = to && st.snaps[to];
  const gymDays = Object.keys(st.gym).sort();
  const gTo = gymDays[gymDays.length - 1] || null;
  const gFrom = gTo ? (gymDays.filter((d) => d <= utcDay(dayTs(gTo) - 7 * 86400)).pop() || gymDays[0]) : null;
  const G1 = gFrom && st.gym[gFrom], G2 = gTo && st.gym[gTo];
  const diff = (a, b, k) => (a && b && a[k] != null && b[k] != null ? b[k] - a[k] : null);
  const rows = members.map((m) => {
    const a = A?.[m.id], b = B?.[m.id];
    return {
      id: m.id, name: m.name,
      activity: diff(a, b, 'timeplayed'), xanax: diff(a, b, 'xantaken'), crimes: diff(a, b, 'criminaloffenses'),
      blood: diff(a, b, 'bloodwithdrawn'), oc: diff(a, b, 'organizedcrimes'),
      gym: gFrom && gFrom !== gTo && G1?.[m.id] != null && G2?.[m.id] != null ? G2[m.id] - G1[m.id] : null,
    };
  });
  return {
    access, at: Date.now(),
    job: { ...facJob },
    range: { from, to, complete: !!(A && B) },
    gymRange: { from: gFrom !== gTo ? gFrom : null, to: gTo, days: gFrom && gTo ? Math.round((dayTs(gTo) - dayTs(gFrom)) / 86400) : 0, error: st.gymError || null },
    members: members.length,
    boards: {
      activity: topList(rows, 'activity'), gym: topList(rows, 'gym'), xanax: topList(rows, 'xanax'),
      crimes: topList(rows, 'crimes'), blood: topList(rows, 'blood'), oc: topList(rows, 'oc'),
      idle: topList(rows, 'activity', 10, true),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Geri bildirim: istek, öneri ve hatalar e-posta ile geliştiriciye      */
/* ------------------------------------------------------------------ */
// E-posta FormSubmit (formsubmit.co) üzerinden gider: sunucu şifresi ya da SMTP bilgisi gerekmez.
// Yalnızca formdaki alanlar ve uygulama sürümü gönderilir; API key ve başka kişisel veri asla eklenmez.
// FormSubmit takma adı: e-posta adresi açık kaynak kodda görünmesin diye adres yerine bu kod kullanılır.
const FEEDBACK_TO = process.env.LRX_FEEDBACK_TO || '4d5de3d49afa4bc275628b52f5a9c39d';
const FEEDBACK_KINDS = { oneri: 'Öneri', istek: 'İstek', hata: 'Hata', diger: 'Diğer' };
let feedbackLast = 0;
async function sendFeedback(b) {
  const kind = FEEDBACK_KINDS[b.kind] ? b.kind : 'diger';
  const message = String(b.message || '').trim().slice(0, 4000);
  const name = String(b.name || '').trim().slice(0, 80);
  const contact = String(b.contact || '').trim().slice(0, 120);
  if (message.length < 5) throw new ApiError(T('Mesaj çok kısa.', 'Message is too short.'), 'FEEDBACK_SHORT');
  const wait = 60_000 - (Date.now() - feedbackLast);
  const waitS = Math.ceil(wait / 1000);
  if (wait > 0) throw new ApiError(T(`Bir dakikada bir mesaj gönderilebilir (${waitS} sn).`, `You can send one message per minute (try again in ${waitS} s).`), 'FEEDBACK_RATE');
  const payload = {
    _subject: `LRX Torn Tracker · ${FEEDBACK_KINDS[kind]}${name ? ` · ${name}` : ''}`,
    _template: 'table', _captcha: 'false',
    Kategori: FEEDBACK_KINDS[kind], Mesaj: message,
    Gonderen: name || '(belirtilmedi)', Iletisim: contact || '(belirtilmedi)',
    Surum: APP_VERSION || '?', Dil: b.lang === 'en' ? 'EN' : 'TR',
  };
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) payload._replyto = contact; // e-postaya "Yanıtla" ile dönülebilsin
  let res;
  try {
    res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(FEEDBACK_TO)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Referer: 'https://github.com/Mericsdc/lrx-torn-tracker', 'User-Agent': 'LRX-Torn-Tracker' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000), // the Send button must not stay busy for minutes
    });
  } catch (e) {
    throw new ApiError(e?.name === 'TimeoutError'
      ? T('Geri bildirim servisi zamanında yanıt vermedi. Mesajın gönderilmedi, tekrar dene.', 'The feedback service did not respond in time. Your message was not sent, please try again.')
      : T('Geri bildirim servisine ulaşılamadı. İnternet bağlantını kontrol et.', 'The feedback service could not be reached. Check your internet connection.'), 'FEEDBACK_FAIL');
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || String(j.success) !== 'true') throw new ApiError(j.message || T(`Gönderilemedi (HTTP ${res.status})`, `Could not send (HTTP ${res.status})`), 'FEEDBACK_FAIL');
  feedbackLast = Date.now();
  return { ok: true };
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
  }, mins * 60_000).unref();
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
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
/* The app page holds privileged controls (the saved key behind /api, the Torn tabs through the desktop bridge) and
   shows text that comes from the Torn API. Only the app's own script files may run in it, so a name or message
   that carries markup stays inert even where a template forgot to escape it. No inline scripts or handlers. */
const PAGE_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com", "img-src 'self' data: blob: https:", "connect-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-src 'none'", "frame-ancestors 'none'",
].join('; ');
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const bad = (message, status = 400) => reject(Object.assign(new Error(message), { status }));
    req.on('data', (c) => { size += c.length; if (size > 1e5) bad('Request body too large', 413); else chunks.push(c); });
    req.on('error', reject);
    req.on('aborted', () => bad('Request aborted'));
    req.on('end', () => {
      if (size > 1e5) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('Expected a JSON object');
        resolve(value);
      } catch { bad('Invalid JSON'); }
    });
  });
}
const maskKey = (k) => (k ? k.slice(0, 3) + '•'.repeat(Math.max(0, k.length - 6)) + k.slice(-3) : '');

// Asks Torn who owns a key and whether its access is enough for the app. Nothing is saved here.
async function verifyTornKey(key) {
  const call = async (q) => {
    await throttle();
    const r = await fetch(`https://api.torn.com/${q}&key=${encodeURIComponent(key)}&comment=TornTracker`, { headers: { 'User-Agent': 'TornTracker/1.0' }, signal: AbortSignal.timeout(20_000) });
    const j = await r.json().catch(() => ({ error: { error: `HTTP ${r.status}` } }));
    if (!j || typeof j !== 'object') throw new ApiError(T(`Torn API yanıtı okunamadı (HTTP ${r.status})`, `Could not read the Torn API response (HTTP ${r.status})`), 'BAD_RESPONSE');
    if (j.error) throw new ApiError(j.error.code === 2 ? T('API key geçersiz.', 'Invalid API key.') : `Torn API: ${j.error.error}`, j.error.code);
    return j;
  };
  const [keyResponse, user] = await Promise.all([call('key/?selections=info'), call('user/?selections=basic')]);
  const info = keyResponse.info || keyResponse;
  const level = Number(info.access_level) || 0;
  const customAccess = info.access_type === 'Custom' && ['profile', 'battlestats', 'bars', 'cooldowns'].every((s) => info.selections?.user?.includes(s));
  if (level < 3 && !customAccess) {
    const accessType = info.access_type || 'Public';
    throw Object.assign(new ApiError(T(`Bu key "${accessType}" seviyesinde. Şirket ve faction verileri için en az "Limited Access" key gerekli.`,
      `This key has "${accessType}" access. Company and faction data need at least a "Limited Access" key.`), 'KEY_ACCESS'), { status: 403 });
  }
  if (!playerIdOf(user.player_id)) throw new ApiError(T('Torn API oyuncu bilgisini döndürmedi. Tekrar deneyin.', 'The Torn API did not return the player. Please try again.'), 'BAD_RESPONSE');
  // The overview asks Torn for more than the four selections checked above. A Custom key that lacks one of them is
  // accepted (other pages still work), but the caller is told which ones so the user is not left guessing.
  const granted = Array.isArray(info.selections?.user) ? info.selections.user : null;
  const missing = info.access_type === 'Custom' && granted ? ['education', 'icons', 'personalstats', 'travel', 'money'].filter((s) => !granted.includes(s)) : [];
  return { user, info, missing };
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  try {
    if (p.startsWith('/api/premium/')) {
      try {
        const action = p.slice('/api/premium/'.length);
        // Settings → App → Premium membership connection. Off: the API key and every request stay on this computer.
        if (config.features?.['app.premium'] === false) {
          if (action === 'status' && req.method === 'GET') return send(res, 200, { configured: true, connected: false, disabled: true, code: 'PREMIUM_DISABLED', freeApiAccess: true });
          if (action === 'disconnect' && req.method === 'POST') { premiumClient.reset(); return send(res, 200, { ok: true }); }
          return send(res, 403, { error: 'PREMIUM_DISABLED', code: 'PREMIUM_DISABLED' });
        }
        if (action === 'status' && req.method === 'GET') return send(res, 200, await premiumClient.status());
        if (action === 'connect' && req.method === 'POST') return send(res, 200, await premiumClient.connect(await readBody(req)));
        if (action === 'disconnect' && req.method === 'POST') { premiumClient.reset(); return send(res, 200, { ok: true }); }
        return send(res, 200, await premiumClient.proxy(action, req.method, req.method === 'POST' ? await readBody(req) : undefined));
      } catch (error) { return send(res, error.status || 503, { error: error.code || 'PREMIUM_SERVICE_ERROR', code: error.code || 'PREMIUM_SERVICE_ERROR' }); }
    }
    if (p === '/api/ff-script-request' && req.method === 'POST') {
      const gone = new AbortController();
      res.on('close', () => { if (!res.writableEnded) gone.abort(); });
      return send(res, 200, await ffScriptProxy.run(await readBody(req), gone.signal));
    }
    if (p === '/api/config' && req.method === 'GET') {
      return send(res, 200, {
        hasKey: !!config.apiKey, apiKeyMasked: maskKey(config.apiKey), ffscouterKeyMasked: maskKey(config.ffscouterKey), logKeyMasked: maskKey(config.logKey),
        coverDays: config.coverDays, pollMinutes: config.pollMinutes,
        deliveryHours: config.deliveryHours || 6, deliveryMode: config.deliveryMode || 'hours',
        updateUrl: DEFAULT_UPDATE_URL, version: APP_VERSION,
        features: config.features || {},
        lang: config.lang === 'tr' ? 'tr' : 'en',
        theme: THEMES.has(config.theme) ? config.theme : 'obsidian',
      });
    }
    if (p === '/api/lang' && req.method === 'POST') {
      const b = await readBody(req);
      const lang = b.lang === 'tr' ? 'tr' : 'en';
      if (config.lang !== lang) { config.lang = lang; saveConfig(); }
      return send(res, 200, { ok: true, lang });
    }
    if (p === '/api/features' && req.method === 'POST') {
      const b = await readBody(req);
      config.features ||= {};
      for (const [k, v] of Object.entries(b.features || {})) {
        if (/^[a-zA-Z0-9_.-]{1,40}$/.test(k) && typeof v === 'boolean') config.features[k] = v;
      }
      saveConfig();
      if (b.features?.['app.premium'] === false) premiumClient.reset();
      return send(res, 200, { ok: true, features: config.features });
    }
    if (p === '/api/stats') return send(res, 200, { history: dailyList(history.stats), battle: history.lastOverview?.battle || null });
    if (p === '/api/networth') return send(res, 200, await getNetworth(url.searchParams.get('force') === '1'));
    if (p === '/api/job') return send(res, 200, await getJobInfo());
    if (p === '/api/travel') return send(res, 200, await getTravelProfit());
    if (p === '/api/levelling') return send(res, 200, await getLevelling(url.searchParams.get('list') || ''));
    if (p === '/api/shoplifting') return send(res, 200, await getShoplifting());
    if (p === '/api/awards') return send(res, 200, await getAwards());
    if (p === '/api/merit-allocation') return send(res, 200, await getMeritAllocation());
    if (p === '/api/crime-value') return send(res, 200, await getCrimeValue(url.searchParams.get('force') === '1'));
    if (p === '/api/jail') return send(res, 200, await getJail());
    if (p === '/api/events') return send(res, 200, await getEvents(url.searchParams.get('force') === '1'));
    if (p === '/api/faction') {
      const force = url.searchParams.get('force') === '1';
      const [access, myOc] = await Promise.all([factionAccess(force).catch((e) => ({ error: e.message })), getMyOcInfo()]);
      const oc = access.allowed ? await getFactionOC(force).catch((e) => ({ error: e.message })) : null;
      return send(res, 200, { access, myOc, oc, at: Date.now() });
    }
    if (p === '/api/faction/report') return send(res, 200, await getFactionReport(req.method === 'POST'));
    if (p === '/api/feedback' && req.method === 'POST') {
      try { return send(res, 200, await sendFeedback(await readBody(req))); }
      catch (e) { return send(res, e.code === 'FEEDBACK_RATE' ? 429 : e.code === 'FEEDBACK_SHORT' ? 400 : 502, { error: e.message, code: e.code }); }
    }
    if (p === '/api/purchases' && req.method === 'GET') return send(res, 200, await getPurchases());
    if (p === '/api/purchases' && req.method === 'POST') {
      const b = await readBody(req);
      ensureLogHistory();
      const id = Number(b.id);
      if (!Number.isInteger(id) || id <= 0) return send(res, 400, { error: T('Geçersiz eşya.', 'Invalid item.') });
      const cost = Number(b.cost);
      if (cost > 0 && cost < 1e12) history.manualCosts[id] = { cost: Math.round(cost), at: Date.now() };
      else delete history.manualCosts[id];
      saveHistory();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/config' && req.method === 'POST') {
      const b = await readBody(req);
      // Validate the entire request before changing the in-memory config.
      for (const key of ['apiKey', 'ffscouterKey', 'logKey']) {
        if (b[key] != null && (typeof b[key] !== 'string' || (b[key].trim() && !/^[A-Za-z0-9]{16}$/.test(b[key].trim())))) {
          return send(res, 400, { error: T('API key 16 karakterlik harf/rakam olmalı.', 'API keys must be 16 letters or digits.') });
        }
      }
      if (b.theme != null && !THEMES.has(b.theme)) return send(res, 400, { error: T('Geçersiz tema.', 'Invalid theme.') });
      // A different main key is checked with Torn before anything is saved: a key Torn rejects never replaces a
      // working one, and a key of another player does not inherit this player's records or extra keys.
      const newKey = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
      let resetData = false, missingSelections = [];
      if (newKey && newKey !== config.apiKey) {
        const keyBefore = config.apiKey;
        const { user, missing } = await verifyTornKey(newKey);
        missingSelections = missing;
        if (config.apiKey !== keyBefore) return send(res, 409, { error: T('API key bu sırada değişti. Tekrar deneyin.', 'The API key changed in the meantime. Please try again.'), code: 'KEY_CHANGED' });
        premiumClient.reset();
        resetData = adoptPlayer(user.player_id);
        config.apiKey = newKey; resetKeyCaches();
        ffStatus = { ok: null, error: null, checkedAt: 0 };
      }
      if (typeof b.ffscouterKey === 'string') { config.ffscouterKey = b.ffscouterKey.trim(); ffCache.clear(); ffStatus = { ok: null, error: null, checkedAt: 0 }; }
      if (typeof b.logKey === 'string') {
        const k = b.logKey.trim();
        if (k && !/^[A-Za-z0-9]{16}$/.test(k)) return send(res, 400, { error: T('Log key 16 karakterlik harf/rakam olmalı.', 'The log key must be 16 letters and digits.') });
        config.logKey = k; logStatus = { ok: null, error: null, at: 0 };
      }
      if (b.coverDays != null) config.coverDays = Math.min(14, Math.max(1, Number(b.coverDays) || 3));
      if (b.pollMinutes != null) config.pollMinutes = Math.min(120, Math.max(5, Number(b.pollMinutes) || 15));
      if (b.deliveryHours != null) config.deliveryHours = Math.min(48, Math.max(1, Number(b.deliveryHours) || 6));
      if (b.deliveryMode === 'hours' || b.deliveryMode === '18tct') config.deliveryMode = b.deliveryMode;
      if (b.theme != null) config.theme = b.theme;
      saveConfig(); schedulePoll();
      return send(res, 200, { ok: true, resetData, missingSelections });
    }
    if (p === '/api/auth' && req.method === 'POST') {
      const b = await readBody(req);
      const key = String(b.apiKey || '').trim();
      if (!/^[A-Za-z0-9]{16}$/.test(key)) return send(res, 400, { error: T('API key 16 karakterlik harf/rakam olmalı.', 'The API key must be 16 letters and digits.') });
      const { user, info, missing } = await verifyTornKey(key);
      // Farklı bir oyuncuya geçildiyse önceki oyuncunun verilerini karıştırma (çıkış yapılmış olsa bile)
      const resetData = adoptPlayer(user.player_id);
      if (config.apiKey !== key) premiumClient.reset();
      config.apiKey = key;
      resetKeyCaches();
      ffStatus = { ok: null, error: null, checkedAt: 0 };
      saveConfig(); schedulePoll();
      return send(res, 200, { ok: true, player: { id: user.player_id, name: user.name, level: user.level }, accessType: info.access_type, resetData, missingSelections: missing });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      premiumClient.reset();
      config.apiKey = '';
      config.ffscouterKey = '';
      config.logKey = '';
      resetKeyCaches();
      // Remember whose records these are: the next sign-in may be a different player.
      const owner = historyOwner();
      if (owner) history.ownerId = owner;
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
          theme: THEMES.has(config.theme) ? config.theme : 'obsidian',
          lang: config.lang === 'tr' ? 'tr' : 'en',
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
    if (p === '/api/war-groups') {
      const fid = Number(url.searchParams.get('faction'));
      if (req.method === 'GET') return send(res, 200, warGroups.get(fid));
      if (req.method === 'POST') return send(res, 200, warGroups.mutate(fid, await readBody(req)));
      return send(res, 405, { error: T('Bu işlem desteklenmiyor.', 'Method not allowed.') });
    }
    if (p === '/api/player') {
      const id = Number(url.searchParams.get('id'));
      if (!id) return send(res, 400, { error: T('id parametresi gerekli', 'The id parameter is required') });
      const j = await torn(`user/${id}?selections=profile,timestamp`, 15_000);
      return send(res, 200, {
        id: j.player_id, name: j.name, level: j.level, status: j.status, lastAction: j.last_action,
        faction: j.faction ? { id: j.faction.faction_id, name: j.faction.faction_name, tag: j.faction.faction_tag } : null,
        serverTime: j.server_time || j.timestamp || Math.floor(Date.now() / 1000),
      });
    }
    if (p === '/api/targets') {
      const fid = Number(url.searchParams.get('faction'));
      if (!fid) return send(res, 400, { error: T('faction parametresi gerekli', 'The faction parameter is required') });
      return send(res, 200, await getTargets(fid));
    }
    if (p === '/api/estimate' && req.method === 'POST') {
      const fid = Number(url.searchParams.get('faction'));
      const enemy = await torn(`faction/${fid}?selections=basic`, 30_000);
      const ids = Object.keys(enemy.members || {}).map(Number).filter((id) => !(ffCache.get(id)?.data?.bs));
      return send(res, 200, startEstimateJob(fid, ids));
    }
    if (p === '/api/ffscouter/check') {
      const r = await fetch(`https://ffscouter.com/api/v1/check-key?key=${encodeURIComponent(ffKey())}`, { signal: AbortSignal.timeout(20_000) });
      const j = await r.json().catch(() => null);
      // A refused key (HTTP 401/403, or an error about registration, as /api/targets reads it) is "not registered";
      // an outage or an unreadable reply is not
      const refusal = j && typeof j === 'object' ? String(j.error || j.message || '') : '';
      if (r.status === 401 || r.status === 403 || (!r.ok && /regist/i.test(refusal))) return send(res, 200, { registered: false, premium: false, raw: {} });
      if (!r.ok || !j || typeof j !== 'object') throw new ApiError(T(`FFScouter şu anda yanıt vermiyor (HTTP ${r.status}). Biraz sonra tekrar dene.`, `FFScouter is not answering right now (HTTP ${r.status}). Please try again shortly.`), 'FFSCOUTER_HTTP', 'ffscouter');
      return send(res, 200, { registered: !!j.is_registered, premium: !!j.is_premium, raw: { registered_at: j.registered_at, last_used: j.last_used } });
    }
    return send(res, 404, { error: T('Bulunamadı', 'Not found') });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return send(res, 504, { error: T('Torn bağlantısı zaman aşımına uğradı. Tekrar deneyin.', 'The Torn connection timed out. Please try again.'), code: 'TIMEOUT' });
    if (e instanceof TypeError && e.message === 'fetch failed') return send(res, 502, { error: T('Torn API bağlantısı kurulamadı. İnternet bağlantısını kontrol edin.', 'Could not connect to the Torn API. Check your internet connection.'), code: 'NETWORK' });
    console.warn('[api]', p, e.message);
    return send(res, e.status || (e.code === 'NO_KEY' ? 412 : 502), { error: e.message, code: e.code });
  }
}

const server = http.createServer(async (req, res) => {
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(req.headers.host || '')) return send(res, 403, { error: 'Invalid local host' });
  let url, pathname;
  try { url = new URL(req.url, 'http://127.0.0.1'); pathname = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400); return res.end('Invalid URL'); }
  if (url.pathname === '/api/ff-script-request') {
    if (req.headers.authorization !== 'Bearer ' + ffScriptProxy.token) return send(res, 403, { error: T('FF Scouter köprüsüne erişim reddedildi.', 'FF Scouter bridge access denied.') });
    return handleApi(req, res, url);
  }
  // Local APIs must not be writable by an unrelated web page.
  if (url.pathname.startsWith('/api/') && req.headers.origin) {
    const expected = `http://${req.headers.host}`;
    if (req.headers.origin !== expected) return send(res, 403, { error: 'Cross-origin requests are not allowed' });
  }
  // ... nor triggered by one: a browser marks what another site requests (an image or script tag, a no-cors
  // fetch) even when it sends no Origin header. Such a request could spend the player's Torn API allowance.
  if (url.pathname.startsWith('/api/') && ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) {
    return send(res, 403, { error: 'Cross-origin requests are not allowed' });
  }
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);

  const file = path.resolve(PUBLIC, '.' + (pathname === '/' ? '/index.html' : pathname));
  const relative = path.relative(PUBLIC, file);
  if (relative.startsWith('..') || path.isAbsolute(relative) || pathname.includes('\0')) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    if (path.extname(file) === '.html') Object.assign(headers, { 'Content-Security-Policy': PAGE_CSP, 'Referrer-Policy': 'same-origin' });
    res.writeHead(200, headers);
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
    server.once('listening', onListen);
    // Port doluysa önce yakın portları dene: arayüz origin'i (ve localStorage ayarları) sabit kalsın.
    let attempt = 0;
    const tryListen = () => {
      const port = attempt <= 10 ? preferredPort + attempt : 0;
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port !== 0) { attempt++; tryListen(); }
        else { server.removeListener('listening', onListen); reject(err); }
      });
      server.listen(port, '127.0.0.1');
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

function ingestStockDeliveries(rows, at = Date.now(), deliveryHours = null) {
  const names = new Set(stockProductNames());
  // Torn stok tablosundaki ürün başına teslim süresi ("Delivery: 24 hours")
  if (deliveryHours && typeof deliveryHours === 'object') {
    const hours = {};
    for (const [n, h] of Object.entries(deliveryHours)) {
      const v = Number(h);
      if (names.has(n) && Number.isFinite(v) && v >= 1 && v <= 240) hours[n] = v;
    }
    if (Object.keys(hours).length) history.tornDeliveryHours = { ...(history.tornDeliveryHours || {}), ...hours };
  }
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

module.exports = { startServer, server, stockProductNames, ingestStockDeliveries, warMemberStatuses, warGroupLabels: warGroups.labels, flushData, myPlayerId, getCrimeValue, crimeValueForPage, purchaseCostsForPage, seasonalActive, seasonalList, halloweenForPage, ffScriptBridge: () => ({ url: `http://127.0.0.1:${server.address().port}/api/ff-script-request`, token: ffScriptProxy.token }) };
