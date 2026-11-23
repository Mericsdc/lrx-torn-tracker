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
const HOLD_DAYS_FILE = path.join(DATA, 'holdings-days.json'); // Holdings per-item day records (holdings-days.js)
const { buildBattleStats } = require('./battle-stats');
const holdings = require('./holdings');
const holdingsDays = require('./holdings-days');
const overviewLayout = require('../../public/overview-layout');
const levelling = require('../../public/levelling');
const travelPlanner = require('../../public/travel-planner');
const factionTools = require('../../public/faction-tools');
const travelRadar = require('../../public/travel-radar');
const travelWorkspace = require('../../public/travel-workspace');
const factionWorkspace = require('../../public/faction-workspace');
const companyAdvisor = require('../../public/company-advisor');
const stocksMath = require('../../public/stocks-math');
const rosterCacheMod = require('./roster-cache');

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

// The saved keys are encrypted at rest inside the Electron app (see secret-store.js). safeStorage works only once
// Electron is ready, so the settings load now and the keys follow; until then the API waits and nothing is saved.
const secretStoreLib = require('./secret-store');
const secretStore = secretStoreLib.createSecretStore(secretStoreLib.defaultCipher(), { log: (...args) => console.warn('[secrets]', ...args) });
const rawConfig = readJson(CONFIG_FILE, {});
let config = { ...DEFAULT_CONFIG, ...secretStore.settingsOf(rawConfig) };
let secretsOpen = false, saveWaiting = false;
function openSecrets() {
  const { values, migrate } = secretStore.open(rawConfig);
  Object.assign(config, values);
  secretsOpen = true;
  // Plain-text keys from an older version (or `npm run web`) are encrypted now; a save asked for meanwhile runs now.
  if (migrate || saveWaiting) {
    try { saveConfig(); } catch (e) { console.warn('[secrets] saving config.json failed; the file is unchanged:', e.message); }
  }
}
const secretsReady = (() => {
  const ready = secretStore.whenReady();
  if (!ready) { openSecrets(); return Promise.resolve(); }
  // If the keys can't be opened, nothing is written (the file stays as it is) and the app asks for a key.
  return ready.then(openSecrets).catch((e) => console.warn('[secrets] opening the saved keys failed:', e.message));
})();
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
// data/holdings-days.json, read on the first Holdings load; holdDaysAt = the Holdings reply (its `at`) last recorded.
let holdDays = null, holdDaysAt = 0;
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

function saveConfig() {
  if (!secretsOpen) { saveWaiting = true; return; } // the keys on disk are not known yet: never write over them
  saveWaiting = false;
  writeJson(CONFIG_FILE, secretStore.seal(config), true);
}
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
    // The previous player's Holdings day records leave the disk too.
    holdDays = null; holdDaysAt = 0;
    resetRosterState();
    try { if (fs.existsSync(HOLD_DAYS_FILE)) writeJson(HOLD_DAYS_FILE, holdingsDays.empty(id)); } catch (e) { console.warn('[holdings-days]', e.message); }
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
/* Torn API (cache + rate limit + source telemetry)                    */
/* ------------------------------------------------------------------ */
class ApiError extends Error {
  constructor(message, code, source = 'torn') { super(message); this.code = code; this.source = source; }
}

const sourceHealth = {
  torn: { ok: null, lastSuccessAt: 0, lastErrorAt: 0, lastErrorClass: null, latencyMs: 0, calls: 0 },
  yata: { ok: null, lastSuccessAt: 0, lastErrorAt: 0, lastErrorClass: null, latencyMs: 0, calls: 0 },
  prometheus: { ok: null, lastSuccessAt: 0, lastErrorAt: 0, lastErrorClass: null, latencyMs: 0, calls: 0 },
};
function markSourceOk(name, latencyMs) {
  const s = sourceHealth[name];
  if (!s) return;
  s.ok = true; s.lastSuccessAt = Date.now(); s.lastErrorClass = null; s.latencyMs = Math.max(0, Math.round(latencyMs)); s.calls++;
}
function markSourceErr(name, err, latencyMs) {
  const s = sourceHealth[name];
  if (!s) return;
  s.ok = false; s.lastErrorAt = Date.now(); s.latencyMs = Math.max(0, Math.round(latencyMs)); s.calls++;
  s.lastErrorClass = String(err?.code || err?.name || 'ERROR');
}
// Torn itself is failing only on an outage: no connection, a timeout, an unreadable/HTTP error reply, or Torn's
// codes 5 (too many requests), 8 (IP block) and 9 (API disabled). A refusal for this key or position (2, 7, 16 ...)
// is a working Torn answering, not a source error.
const TORN_SOURCE_CODES = new Set([5, 8, 9]);
function isTornSourceError(err) {
  if (!err) return false;
  if (err.name === 'TimeoutError' || err.name === 'AbortError' || err instanceof TypeError) return true;
  const code = err.code;
  if (code === 'BAD_RESPONSE' || code === 'TIMEOUT' || code === 'NETWORK' || /^HTTP_\d+$/.test(String(code ?? ''))) return true;
  return TORN_SOURCE_CODES.has(Number(code));
}

const rosterCache = rosterCacheMod.createRosterCache({
  fetchMembers: () => tornRaw('v2/faction/members'),
  getFactionId: () => Number(history.lastOverview?.player?.faction?.faction_id) || null,
  getKeyGen: () => keyGen,
  onSnapshot: (entry) => recordFactionActivity(entry.members, entry.observedAtMs, entry.factionId, entry.radar),
});
function resetRosterState() {
  rosterCache.reset();
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
function resetKeyCaches() { keyGen++; cache.clear(); ffCache.clear(); estCache.clear(); resetRosterState(); }
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
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'TornTracker/1.0' }, signal: AbortSignal.timeout(20_000) });
    const out = tornReply(res, await res.text());
    markSourceOk('torn', Date.now() - started);
    return out;
  } catch (err) {
    if (isTornSourceError(err)) markSourceErr('torn', err, Date.now() - started);
    else markSourceOk('torn', Date.now() - started); // Torn answered; the refusal is about this key, not the source
    throw err;
  }
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
      // the medium profile card's details; part of the same profile reply
      age: u.age, property: u.property, awards: u.awards, married: u.married,
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
  const prevFacId = Number(history.lastOverview?.player?.faction?.faction_id) || 0;
  const nextFacId = Number(result.player?.faction?.faction_id) || 0;
  if (prevFacId !== nextFacId) resetRosterState();
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

// Finance › Networth › Holdings: the items and stocks behind the networth (src/server/holdings.js). Asked only while
// that card is shown, kept in memory as one entry (10 minutes, 30 s after a failure that may pass; holdings.cachePolicy).
// Refresh joins a load in flight instead of starting another.
// Price effect vs trading (switch finance.priceSplit): each reply not recorded yet becomes that Torn day's per-item
// record in data/holdings-days.json, and the reply carries the period start records as `split` (holdings-days.js).
async function getHoldings(force = false) {
  const { drop, ttl } = holdings.cachePolicy(cache.get('holdings'), force, Date.now());
  if (drop) cache.delete('holdings');
  const gen = keyGen;
  const data = await cached('holdings', ttl, () => holdings.loadHoldings({ get: torn, force }));
  const owner = historyOwner();
  if (config.features?.['finance.holdings'] === false || config.features?.['finance.priceSplit'] === false || owner == null) return data;
  try {
    holdDays = holdingsDays.forOwner(holdDays ?? readHoldDays(), owner);
    const day = tctDate(data.at);
    if (gen === keyGen && data.at !== holdDaysAt) { // a reply of the previous key is never recorded for this player
      const nwRec = history.networth?.[day]; // the Networth tab loads /api/networth right before Holdings
      const nw = nwRec && Math.abs(data.at - nwRec.at) < 15 * 60_000 ? Number(nwRec.total) : undefined;
      const next = holdingsDays.record(holdDays, day, holdingsDays.snapshot(data), { nw });
      holdDaysAt = data.at;
      if (next !== holdDays) {
        holdDays = next;
        try { writeJson(HOLD_DAYS_FILE, holdDays); } catch (e) { console.warn('[holdings-days]', e.message); }
      }
    }
    return { ...data, split: holdingsDays.starts(holdDays, day) };
  } catch (e) {
    // The split is optional: a records file it cannot read or use never takes the Holdings card down, and is not
    // written over. It is read again on the next load.
    console.warn('[holdings-days]', e.message);
    holdDays = null;
    return data;
  }
}
// A missing file, or one that is not JSON, is an empty one. Any other read error (a lock held by an antivirus, say)
// throws, so getHoldings skips this load instead of recording over up to a year of records.
function readHoldDays() {
  try { return JSON.parse(fs.readFileSync(HOLD_DAYS_FILE, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' || e instanceof SyntaxError) return null; throw e; }
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
// Stock chart history (6/12/24/48h on the Travel page): the last 48 hours, one reading per 30 minutes (the last one
// seen in that half hour, so the newest raw reading is always the last row), at most 96 rows per item.
const STOCK_HISTORY_SPAN = 48 * 3600, STOCK_HISTORY_STEP = 1800, STOCK_HISTORY_ROWS = 96;
function compactStockHistory(rows) {
  if (!rows.length) return rows;
  const cutoff = rows[rows.length - 1][0] - STOCK_HISTORY_SPAN;
  const byStep = new Map();
  for (const row of rows) if (row[0] > cutoff) byStep.set(Math.floor(row[0] / STOCK_HISTORY_STEP), row);
  const out = [...byStep.values()].sort((a, b) => a[0] - b[0]);
  return out.length > STOCK_HISTORY_ROWS ? out.slice(-STOCK_HISTORY_ROWS) : out;
}
const median = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };

function recordStock(code, update, list, sourceName = 'YATA') {
  if (!update) return;
  for (const it of list) {
    const k = `${code}:${it.id}`;
    const q = Number(it.quantity) || 0;
    const cost = Number(it.cost) || 0;
    const e = stockLog[k] ||= { q, t: update, restocks: [], empties: [], samples: [], history: [] };
    e.history ||= [];
    if (update <= e.t && e.samples.length) continue;
    if (q > e.q) {
      // Alımlar stoğu yalnızca azaltır: artış = restock. Gözlem aralığındaki son çeyreğe yuvarla.
      pushMax(e.restocks, Math.max(e.t, Math.floor(update / QUARTER) * QUARTER), 12);
      e.samples = [];
    } else if (q === 0 && e.q > 0) pushMax(e.empties, update, 12);
    e.samples.push([update, q]);
    if (e.samples.length > 30) e.samples.shift();
    if (!e.history.length || update > e.history[e.history.length - 1][0]) {
      e.history.push([update, q, cost, sourceName]);
      e.history = compactStockHistory(e.history);
    }
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
  return {
    rate,
    emptyAt,
    estRestock,
    lastRestock: e.restocks[e.restocks.length - 1] || null,
    interval: median(iv),
    samples: e.samples.length,
    restocks: e.restocks || [],
    history: (e.history && e.history.length ? e.history : e.samples) || [],
  };
}

/* YATA + Prometheus: miktar için en taze kaynak, restock tahmini Prometheus'tan */
async function fetchStocks() {
  return cached('travel:stocks', 120_000, async () => {
    const get = async (url, name, key) => {
      const started = Date.now();
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'LRX-Torn-Tracker' }, signal: AbortSignal.timeout(15_000) });
        if (!r.ok) throw Object.assign(new Error(`${name} HTTP ${r.status}`), { code: `HTTP_${r.status}` });
        const j = await r.json();
        if (!j || typeof j.stocks !== 'object') throw Object.assign(new Error(T(`${name}: beklenmeyen veri`, `${name}: unexpected data`)), { code: 'BAD_PAYLOAD' });
        markSourceOk(key, Date.now() - started);
        return j;
      } catch (err) {
        markSourceErr(key, err, Date.now() - started);
        throw err;
      }
    };
    const [y, p] = await Promise.allSettled([
      get('https://yata.yt/api/v1/travel/export/', 'YATA', 'yata'),
      get('https://api.prombot.co.uk/api/travel', 'Prometheus', 'prometheus'),
    ]);
    const yata = y.status === 'fulfilled' ? y.value : null;
    const prom = p.status === 'fulfilled' ? p.value : null;
    if (!yata && !prom) throw new ApiError(T(`Stok verisi alınamadı (${y.reason?.message}; ${p.reason?.message})`, `Could not get stock data (${y.reason?.message}; ${p.reason?.message})`), 'TRAVEL');
    const out = {};
    for (const code of new Set([...Object.keys(yata?.stocks || {}), ...Object.keys(prom?.stocks || {})])) {
      const yc = yata?.stocks?.[code], pc = prom?.stocks?.[code];
      const src = !pc || (yc && (yc.update || 0) >= (pc.update || 0)) ? yc : pc;
      const sourceName = src === yc ? 'YATA' : 'Prometheus';
      const next = {};
      for (const it of pc?.stocks || []) {
        const t = it.nextRestock ? Math.round(Date.parse(it.nextRestock) / 1000) : null;
        if (t) next[it.id] = t;
      }
      const list = Array.isArray(src?.stocks) ? src.stocks : [];
      recordStock(code, Number(src?.update) || 0, list, sourceName);
      out[code] = { update: Number(src?.update) || 0, source: sourceName, stocks: list, next };
    }
    return { countries: out, sources: { yata: !!yata, prom: !!prom } };
  });
}

async function getTravelProfit() {
  const [st, items, me] = await Promise.all([
    fetchStocks(),
    torn('torn/?selections=items', 3600_000),
    torn('user/?selections=travel,money,perks', 30_000).catch(() => ({})),
  ]);
  const market = items.items || {};
  const nowS = Math.floor(Date.now() / 1000);
  const profile = travelPlanner.detectTravelProfile(me, me.travel);
  const abroadItemCountries = new Map(); // item id -> Set of country codes that sell it
  const countries = Object.entries(st.countries).map(([code, c]) => ({
    code, name: COUNTRIES[code]?.[0] || code, minutes: COUNTRIES[code]?.[1] || null, update: c.update, source: c.source,
    items: c.stocks.map((s) => {
      if (!abroadItemCountries.has(Number(s.id))) abroadItemCountries.set(Number(s.id), new Set());
      abroadItemCountries.get(Number(s.id)).add(code);
      const mv = Number(market[s.id]?.market_value) || 0;
      const sp = Number(market[s.id]?.sell_price) || 0;
      const q = Number(s.quantity) || 0;
      const stats = stockStats(code, s.id, q, c.update);
      const prom = c.next[s.id] || null;
      // Prometheus tahmini 3 saatten fazla gecikmişse güvenilmez say
      const promOk = prom && prom > nowS - 3 * 3600 ? prom : null;
      const nextRestock = q > 0 ? null : (promOk || stats.estRestock || null);
      return {
        id: s.id, name: s.name, type: market[s.id]?.type || '', cost: s.cost, qty: q, market: mv, sellPrice: sp,
        profit: mv ? mv - s.cost : null,
        nextRestock, restockSrc: nextRestock ? (nextRestock === promOk ? 'Prometheus' : 'tahmin') : null,
        emptyAt: stats.emptyAt || null, rate: stats.rate ? Math.round(stats.rate * 10) / 10 : null,
        lastRestock: stats.lastRestock || null, interval: stats.interval || null,
        restocks: stats.restocks || [],
        history: stats.history || [],
      };
    }),
  }));
  const trip = me.travel ? {
    destination: me.travel.destination || '',
    method: me.travel.method || '',
    timeLeft: Number(me.travel.time_left) || 0,
    arrival: Number(me.travel.timestamp) || 0,
    departed: Number(me.travel.departed) || 0,
  } : null;

  ensureLogHistory();
  // The purchase log does not say where an item was bought: the country is known only when a single country sells
  // it. An item sold in several countries keeps an unknown country instead of a guess.
  const soleCountry = (id) => { const set = abroadItemCountries.get(id); return set && set.size === 1 ? [...set][0] : null; };
  const flightEntries = [];
  for (const [idStr, buys] of Object.entries(history.purchases || {})) {
    const id = Number(idStr);
    const code = soleCountry(id);
    for (const b of Array.isArray(buys) ? buys : []) {
      if (b.src !== 'abroad') continue; // market, bazaar and shop buys are not flights
      const mv = Number(market[id]?.market_value) || 0;
      const each = Number(b.each) || 0;
      const qty = Number(b.qty) || 1;
      flightEntries.push({
        itemId: id,
        name: market[id]?.name || `#${id}`,
        countryCode: code,
        ts: Number(b.ts) || 0,
        qty,
        each,
        market: mv,
        modeledUnitProfit: mv > 0 ? Math.round(mv * 0.95) - each : null,
        modeledTotalProfit: mv > 0 ? (Math.round(mv * 0.95) - each) * qty : null,
        source: b.src === 'abroad' ? 'log_abroad' : 'log_purchase',
        profitKind: 'modeled_reference',
      });
    }
  }
  for (const [idStr, m] of Object.entries(history.manualCosts || {})) {
    const id = Number(idStr);
    if (!abroadItemCountries.has(id) || !(m?.cost > 0)) continue; // only items sold abroad
    const code = soleCountry(id);
    const mv = Number(market[id]?.market_value) || 0;
    flightEntries.push({
      itemId: id,
      name: market[id]?.name || `#${id}`,
      countryCode: code,
      ts: Number(m.at) || 0,
      qty: 1,
      each: Number(m.cost),
      market: mv,
      modeledUnitProfit: mv > 0 ? Math.round(mv * 0.95) - Number(m.cost) : null,
      modeledTotalProfit: mv > 0 ? Math.round(mv * 0.95) - Number(m.cost) : null,
      source: 'manual_cost',
      profitKind: 'modeled_reference',
    });
  }
  flightEntries.sort((a, b) => b.ts - a.ts);

  const facAct = facStore().activity || {};
  return {
    countries,
    method: me.travel?.method || profile.detectedMethod || null,
    detectedMethod: profile.detectedMethod || null,
    detectedBaseCap: profile.detectedBaseCap,
    wallet: me.money_onhand != null ? Number(me.money_onhand) : null,
    trip,
    fetchedAt: Date.now(),
    serverNow: nowS,
    sources: st.sources,
    factionTraffic: Array.isArray(facAct.traffic) ? facAct.traffic : [],
    flightHistory: {
      // true: the last log read worked · false: it was refused or failed (see logError; 'ACCESS' = the key has no log
      // access) · null: not read yet since the app started or the log key changed. No log request is made here.
      logAccess: logStatus.ok === true ? true : logStatus.ok === false ? false : null,
      logKeySet: Boolean(config.logKey),
      logError: logStatus.error || null,
      entries: flightEntries.slice(0, 30),
    },
  };
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

    const orderBasis = companyAdvisor.companyStockOrder({
      avgDailySales: avgDaily,
      targetDays: coverDays,
      availableStock: s.in_stock,
      verifiedInTransit: s.on_order,
      salesSamples: hist.length || (s.sold_amount > 0 ? 1 : 0),
    });
    return {
      name, ...s, avgDaily: Math.round(avgDaily), samples: hist.length,
      avgPrice: s.sold_amount ? s.sold_worth / s.sold_amount : s.price,
      cogs, profit, margin: s.sold_worth ? profit / s.sold_worth : 0,
      daysLeft, daysLeftWithOrder, hoursLeft, hoursLeftWithOrder,
      target, need, status, orderDelivery, orderBasis,
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
  const gen = keyGen;
  (async () => {
    for (const id of todo) {
      if (gen !== keyGen) break; // the key changed: a new page load starts a fresh job with the new key
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
// Sıra public/levelling.js'te: sayfanın en üstündeki hedefler ve az önce saldırılan hedef daha sık kontrol edilir;
// istek hızı aynı kalır, yalnızca sıra değişir.
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

// status: id -> { state, until, description, level, at }; hot: id -> ms until which an attacked target is checked often
const levelScan = { list: null, wantedAt: 0, running: false, error: null, stoppedAt: 0, status: new Map(), hot: new Map() };
async function runLevelScan() {
  if (levelScan.running) return;
  levelScan.running = true;
  try {
    while (Date.now() - levelScan.wantedAt < 20_000) { // sayfa kapanınca (istek gelmeyince) durur
      const rows = (await getLevelLists())[levelScan.list] || [];
      const now = Date.now();
      for (const [id, until] of levelScan.hot) if (until <= now) levelScan.hot.delete(id);
      const nextId = levelling.nextToCheck(rows, (id) => levelScan.status.get(id), { mine: levelling.mineFrom(history.lastOverview?.battle), nowMs: now, hot: levelScan.hot });
      if (nextId == null) { await sleep(3000); continue; }
      const next = { id: nextId };
      try {
        const u = await torn(`user/${next.id}?selections=basic`, levelling.FRESH_TTL_MS);
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
  [`^Complete ${AWN} education courses`, (m, g, x) => x.eduDone, 'education'],
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
  [`^Reach level ${AWN}$`, (m, g, x) => x.level, 'level'],
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
  [`^Travel to (?:the )?(.+) ${AWN} times`, (m, g) => g(`travel.${snake(m[1])}`)],
  [`^Achieve ${AWN} finishing hits with (.+)$`, (m, g) => g(`finishing_hits.${FINISH[m[2].toLowerCase()] || snake(m[2])}`)],
  [`^Achieve ${AWN} finishing hits in every category`, (m, g) => Math.min(...Object.values(FINISH).map((k) => g(`finishing_hits.${k}`)))],
  [`^Use ${AWN} (Hollow Point|Incendiary|Piercing|Tracer) rounds`, (m, g) => g(`attacking.ammunition.${snake(m[2])}`)],
  [`^Use ${AWN} rounds of special ammunition`, (m, g) => g('attacking.ammunition.special')],
  [`^Have a recorded networth value of \\$${AWN}`, (m, g) => g('networth.total')],
].map(([re, cur, stat]) => ({ re: new RegExp(re, 'i'), cur, stat })); // stat: id for rules that read the profile, not personal stats

const AWARD_RANKS = ['Beginner', 'Inexperienced', 'Rookie', 'Novice', 'Below Average', 'Average', 'Reasonable', 'Above Average', 'Competent', 'Highly Competent', 'Veteran', 'Distinguished', 'Highly Distinguished', 'Professional', 'Star', 'Master', 'Outstanding', 'Celebrity', 'Supreme', 'Idolized', 'Champion', 'Heroic', 'Legendary', 'Elite', 'Invincible'];
// { goal, cur, stat, what }: stat names what the progress is read from (a personal stat path, `a|b` when the rule reads
// several, or level / age / married / faction / rank / education); what is the rule's text capture (Theft, SMGs, Japan).
// The Merit Tracker page (public/merit-guide.js) turns these into how-to lines.
function awardProgress(desc, g, extra) {
  const d = String(desc);
  let m = d.match(/^Reach level ([A-Za-z -]+)$/i);
  if (m && wordsToNum(m[1])) return { goal: wordsToNum(m[1]), cur: extra.level, stat: 'level', what: null };
  m = d.match(/^Live in Torn for ([a-z ]+) years?$/i);
  if (m && wordsToNum(m[1])) return { goal: wordsToNum(m[1]) * 365, cur: extra.ageDays, unit: 'days', stat: 'age', what: null };
  m = d.match(/^Stay married (?:to a single person )?for ([\d,]+) days/i);
  if (m) return { goal: Number(m[1].replace(/,/g, '')), cur: extra.marriedDays, stat: 'married', what: null };
  m = d.match(/^Serve ([\d,]+) days in a single faction/i);
  if (m) return { goal: Number(m[1].replace(/,/g, '')), cur: extra.factionDays, stat: 'faction', what: null };
  m = d.match(/^Reach the rank of (.+)$/i);
  if (m) {
    const goal = AWARD_RANKS.findIndex((r) => r.toLowerCase() === m[1].trim().toLowerCase());
    const cur = AWARD_RANKS.reduce((best, r, i) => (extra.rank.toLowerCase().startsWith(r.toLowerCase()) ? i : best), -1);
    if (goal >= 0 && cur >= 0) return { goal: goal + 1, cur: cur + 1, unit: 'rank', stat: 'rank', what: m[1].trim() };
  }
  for (const r of AWARD_RULES) {
    m = d.match(r.re);
    if (!m) continue;
    const goal = Number(String(m.slice(1).find((x) => x && /^[\d,]+$/.test(x)) || '').replace(/,/g, ''));
    const used = [];
    const cur = Number(r.cur(m, (p) => { if (!used.includes(p)) used.push(p); return g(p); }, extra));
    const what = m.slice(1).find((x) => x && !/^[\d,]+$/.test(x)) ?? null;
    if (goal > 0 && Number.isFinite(cur)) return { goal, cur, stat: r.stat || used.join('|') || null, what };
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
      stat: p?.stat ?? null, what: p?.what ?? null,
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

const memberRow = rosterCacheMod.normalizeMemberRow;

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
  const [roster, cr, items] = await Promise.all([
    rosterCache.load({ force }), torn('v2/faction/crimes?cat=available&limit=100', ttl), itemNames(),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const members = roster.members || [];
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
const FAC_KEEP_DAYS = 95; // daily member snapshots and gym records
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
  const gen = keyGen;
  (async () => {
    const st = facStore();
    // Another player signed in (or the key changed): stop instead of walking the old faction with the new key.
    const keyChanged = () => gen !== keyGen;
    try {
      // The shared roster cache: the report page has just loaded it, so this is normally no Torn request at all.
      const roster = await rosterCache.load({ force: false });
      if (keyChanged()) return;
      const ids = (roster.members || []).map((m) => m.id).filter((id) => id > 0);
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
        if (keyChanged()) return;
        try { st.snaps[day][id] = await memberStats(id, ts); }
        catch (e) { if (!FAC_NO_ACCESS.has(Number(e.code)) && Number(e.code) !== 6) throw e; } // 6: geçersiz ID → atla
        facJob.done++;
        if (facJob.done % 10 === 0) saveHistory();
        await sleep(1500); // ~40 istek/dk: uygulamanın diğer istekleri ve TornTools için pay kalır (Torn sınırı 100/dk)
      }
      if (keyChanged()) return;
      // Gym enerjisi: faction katkı listesi (toplam değer) — günlük kayıt, fark kayıtlar arasından hesaplanır
      try {
        const c = await tornRaw('v2/faction/contributors?stat=gymenergy&cat=current');
        st.gym[today] = Object.fromEntries((c.contributors || []).map((x) => [x.id, x.value]));
        st.gymError = null;
      } catch (e) { st.gymError = e.message; }
      facJob.done++;
      // Records older than 95 days are dropped (the 90-day views need 90 days plus a little slack)
      const cut = utcDay(now - FAC_KEEP_DAYS * 86400);
      for (const k of Object.keys(st.snaps)) if (k < cut) delete st.snaps[k];
      for (const k of Object.keys(st.gym)) if (k < cut) delete st.gym[k];
      st.builtAt = Date.now();
    } catch (e) {
      if (!keyChanged()) facJob.error = e.message;
    } finally {
      facJob.running = false; facJob.finishedAt = Date.now();
      if (keyChanged()) Object.assign(facJob, { done: 0, total: 0, error: null }); // the stopped run belonged to the previous key
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

async function getFactionReport(start = false, windowDays = 7) {
  const access = await factionAccess();
  if (!access.allowed) return { access };
  const st = facStore();
  const now = Math.floor(Date.now() / 1000);
  const today = utcDay(now);
  const roster = await rosterCache.load({ force: false });
  const members = roster.members || [];
  const fresh = members.length && members.every((m) => st.snaps[today]?.[m.id]);
  if ((start || !fresh) && !facJob.running && !(facJob.error && Date.now() - facJob.finishedAt < 5 * 60_000)) await runFactionReport();

  const span = windowDays === 30 ? 30 : 7;
  const days = Object.keys(st.snaps).filter((d) => Object.keys(st.snaps[d]).length).sort();
  const to = days[days.length - 1] || null;
  const targetFrom = to ? utcDay(dayTs(to) - span * 86400) : null;
  // Exact match for 7d when available, or closest available snapshot at/before target for 30d
  const from = to ? (st.snaps[targetFrom] ? targetFrom : span > 7 ? (days.filter((d) => d <= targetFrom).pop() || (days[0] !== to ? days[0] : null)) : targetFrom) : null;
  const A = from && st.snaps[from], B = to && st.snaps[to];
  const gymDays = Object.keys(st.gym).sort();
  const gTo = gymDays[gymDays.length - 1] || null;
  const gFrom = gTo ? (gymDays.filter((d) => d <= utcDay(dayTs(gTo) - span * 86400)).pop() || gymDays[0]) : null;
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
    days: span,
    job: { ...facJob },
    range: { from, to, complete: !!(A && B), actualDays: from && to ? Math.round((dayTs(to) - dayTs(from)) / 86400) : 0 },
    gymRange: { from: gFrom !== gTo ? gFrom : null, to: gTo, days: gFrom && gTo ? Math.round((dayTs(gTo) - dayTs(gFrom)) / 86400) : 0, error: st.gymError || null },
    members: members.length,
    rows,
    boards: {
      activity: topList(rows, 'activity'), gym: topList(rows, 'gym'), xanax: topList(rows, 'xanax'),
      crimes: topList(rows, 'crimes'), blood: topList(rows, 'blood'), oc: topList(rows, 'oc'),
      idle: topList(rows, 'activity', 10, true),
    },
  };
}

/* Per-member travel log entry: { id (the radar's transitionId), fromState, toState, destination, origin, seenFrom,
   seenTo } — seenFrom/seenTo are the ISO times of the two roster observations the change happened between. */
const isTravelLogEntry = (x) => Boolean(x && typeof x === 'object' && typeof x.id === 'string' && x.id);
const travelLogEntry = (x) => ({
  id: x.id, fromState: x.fromState ?? null, toState: x.toState ?? null, destination: x.destination ?? null,
  origin: x.origin ?? null, seenFrom: x.seenFrom ?? null, seenTo: x.seenTo ?? null,
});

/* Battle Stats history of other members (st.memberBs[playerId] = [{ at, observedAt, source, verified, total }]).
   One point per member per UTC day, taken only from totals already in memory (FFScouter replies fetched for another
   page): no Torn or FFScouter request is made for it. A rank estimate is never stored. Own stats come from the daily
   stat history instead. Members who left the faction are dropped; at most 400 days per member. */
const MEMBER_BS_KEEP = 400;
const bsDay = (ms) => { const d = new Date(Number(ms)); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); };
function recordMemberBattleStats(members) {
  const ids = new Set((members || []).map((m) => Number(m.id)).filter((id) => id > 0));
  if (!ids.size) return false;
  const st = facStore();
  st.memberBs ||= {};
  const meId = Number(myPlayerId()) || 0;
  let dirty = false;
  for (const pid of Object.keys(st.memberBs)) {
    if (!ids.has(Number(pid)) || Number(pid) === meId) { delete st.memberBs[pid]; dirty = true; }
  }
  for (const pid of ids) {
    if (pid === meId) continue;
    const prev = Array.isArray(st.memberBs[pid]) ? st.memberBs[pid] : [];
    let arr = prev.filter((p) => p && p.source !== 'rank_estimate' && Number(p.total) > 0 && Number(p.at) > 0);
    let changed = arr.length !== prev.length;
    const ff = ffCache.get(pid);
    const total = Number(ff?.data?.bs);
    if (total > 0) {
      const at = Number(ff.data.updated) > 0 ? Number(ff.data.updated) * 1000 : ff.t;
      const point = { at, observedAt: new Date(at).toISOString(), source: 'ffscouter', verified: false, total };
      const last = arr[arr.length - 1];
      if (last && bsDay(last.at) === bsDay(at)) {
        // the day's point is replaced by a newer estimate, never a verified point by an estimate
        if (!last.verified && at >= last.at && (last.total !== total || last.at !== at)) { arr[arr.length - 1] = point; changed = true; }
      } else if (!last || at > last.at) { arr.push(point); changed = true; }
    }
    if (arr.length > MEMBER_BS_KEEP) { arr = arr.slice(-MEMBER_BS_KEEP); changed = true; }
    if (changed) {
      if (arr.length) st.memberBs[pid] = arr; else delete st.memberBs[pid];
      dirty = true;
    }
  }
  return dirty;
}

/* Faction Activity (members + hourly heatmap snapshots + 24h timeline + Travel Radar + Traffic + Transfers), Armory History, Chains, Upgrade Simulator */
function recordFactionActivity(members, nowMs = Date.now(), factionId = null, radar = null) {
  if (!Array.isArray(members) || !members.length) return;
  const st = facStore();
  st.activity ||= { factionId: null, lastAt: 0, lastTimelineAt: 0, lastTrafficAt: 0, buckets: {}, timeline: [], traffic: [], transfers: [], lastMembers: null, lastMembersAt: null, memberTravel: {} };
  if (factionId && st.activity.factionId && st.activity.factionId !== factionId) {
    st.activity = { factionId, lastAt: 0, lastTimelineAt: 0, lastTrafficAt: 0, buckets: {}, timeline: [], traffic: [], transfers: [], lastMembers: null, lastMembersAt: null, memberTravel: {} };
  }
  if (factionId) st.activity.factionId = factionId;
  st.activity.buckets ||= {};
  st.activity.timeline ||= [];
  st.activity.traffic ||= [];
  st.activity.transfers ||= [];
  st.activity.memberTravel ||= {};

  let online = 0, idle = 0, offline = 0;
  for (const m of members) {
    if (m.lastStatus === 'Online') online++;
    else if (m.lastStatus === 'Idle') idle++;
    else offline++;
  }

  let dirty = false;
  const obsIso = travelRadar.isoUtc(nowMs);

  // N4 Roster Transfer detection: records observation interval [seenFrom, seenTo], never fake exact transfer timestamp
  if (Array.isArray(st.activity.lastMembers) && st.activity.lastMembers.length) {
    const detected = factionWorkspace.detectRosterTransfers(st.activity.lastMembers, members, {
      prevObservedAt: st.activity.lastMembersAt || obsIso,
      currObservedAt: obsIso,
      factionId: factionId || st.activity.factionId,
    });
    if (detected.length) {
      const existingIds = new Set(st.activity.transfers.map((t) => t.id));
      for (const tr of detected) {
        if (!existingIds.has(tr.id)) {
          st.activity.transfers.unshift(tr);
          existingIds.add(tr.id);
        }
      }
      if (st.activity.transfers.length > 100) st.activity.transfers.length = 100;
      dirty = true;
    }
  }
  st.activity.lastMembers = members.map((m) => ({ id: m.id, name: m.name, level: m.level, position: m.position, days: m.days }));
  st.activity.lastMembersAt = obsIso;

  // N3 Member Travel transition log (newest first, 30 per member). Entries of older versions carry no id: dropped.
  const memberIds = new Set(members.map((m) => Number(m.id)).filter((id) => id > 0));
  for (const [pid, arr] of Object.entries(st.activity.memberTravel)) {
    const kept = Array.isArray(arr) ? arr.filter(isTravelLogEntry) : [];
    // Members who left the faction take their travel log with them
    if (!memberIds.has(Number(pid)) || !kept.length) { delete st.activity.memberTravel[pid]; dirty = true; }
    else if (kept.length !== arr.length) { st.activity.memberTravel[pid] = kept; dirty = true; }
  }
  if (Array.isArray(radar?.transitions) && radar.transitions.length) {
    for (const tr of radar.transitions) {
      const pid = Number(tr.playerId);
      if (!pid || !tr.transitionId) continue;
      const arr = (st.activity.memberTravel[pid] ||= []);
      if (!arr.some((x) => x.id === tr.transitionId)) {
        arr.unshift({
          id: String(tr.transitionId),
          fromState: tr.fromState,
          toState: tr.toState,
          destination: tr.destination ?? null,
          origin: tr.origin ?? null,
          seenFrom: tr.seenFrom ?? null,
          seenTo: tr.seenTo ?? null,
        });
        if (arr.length > 30) arr.length = 30;
        dirty = true;
      }
    }
  }

  if (recordMemberBattleStats(members)) dirty = true;

  // N2 Faction Travel Traffic snapshot (deduplicated per player, at most 1 every 5m, 48h rolling)
  if (radar && Array.isArray(radar.travel) && nowMs - (st.activity.lastTrafficAt || 0) >= 5 * 60_000) {
    const snap = travelWorkspace.buildTrafficSnapshot(radar.travel, nowMs);
    st.activity.traffic.push(snap);
    const cutoff48 = nowMs - 48 * 3600_000;
    while (st.activity.traffic.length && st.activity.traffic[0].at < cutoff48) st.activity.traffic.shift();
    st.activity.lastTrafficAt = nowMs;
    dirty = true;
  }

  // 24h TCT activity step-line samples (at most 1 sample every 5 minutes, keep 72h rolling)
  if (nowMs - (st.activity.lastTimelineAt || 0) >= 5 * 60_000) {
    st.activity.timeline.push({
      at: nowMs,
      observedAt: obsIso,
      online,
      idle,
      offline,
      total: members.length,
    });
    const cutoff = nowMs - 72 * 3600_000;
    while (st.activity.timeline.length && st.activity.timeline[0].at < cutoff) st.activity.timeline.shift();
    st.activity.lastTimelineAt = nowMs;
    dirty = true;
  }

  // At most one heatmap snapshot every 15 minutes so manual refreshes do not skew the hourly heatmap
  if (nowMs - (st.activity.lastAt || 0) >= 15 * 60_000) {
    const d = new Date(nowMs);
    const key = `${d.getUTCDay()}:${d.getUTCHours()}`;
    const b = st.activity.buckets[key] ||= { samples: 0, onlineSum: 0, idleSum: 0, totalSum: 0 };
    b.samples++; b.onlineSum += online; b.idleSum += idle; b.totalSum += members.length;
    st.activity.lastAt = nowMs;
    dirty = true;
  }

  if (dirty) saveHistory();
}

function summarizeActivityCounts(members) {
  const counts = { total: members.length, online: 0, idle: 0, offline: 0, okay: 0, hospital: 0, traveling: 0, abroad: 0, jail: 0, inOc: 0 };
  for (const m of members) {
    if (m.lastStatus === 'Online') counts.online++;
    else if (m.lastStatus === 'Idle') counts.idle++;
    else counts.offline++;
    if (m.state === 'Okay') counts.okay++;
    else if (m.state === 'Hospital') counts.hospital++;
    else if (m.state === 'Traveling') counts.traveling++;
    else if (m.state === 'Abroad') counts.abroad++;
    else if (m.state === 'Jail' || m.state === 'Federal') counts.jail++;
    if (m.inOc) counts.inOc++;
  }
  return counts;
}

// The overview (polled anyway) says the player is in no faction: faction pages answer without asking Torn.
const knownFactionless = () => {
  const f = history.lastOverview?.player?.faction;
  return Boolean(history.lastOverview?.player && f && typeof f === 'object' && !Number(f.faction_id));
};
const notInFactionText = () => T('Bir faction\'da değilsin.', 'You are not in a faction.');

async function getFactionActivity(force = false, opts = {}) {
  const myFacId = Number(history.lastOverview?.player?.faction?.faction_id) || null;
  if (knownFactionless()) {
    return {
      factionId: null, notInFaction: true, error: notInFactionText(), code: 'NOT_IN_FACTION', sourceMode: 'local', freshness: null,
      travel: [], travelSummary: { outbound: 0, abroad: 0, inbound: 0, unknown: 0, totalTravel: 0 }, transitions: [],
      members: [], counts: summarizeActivityCounts([]), heatmap: factionTools.buildActivityHeatmap({}), timeline: [],
      lastSampleAt: null, at: Date.now(),
    };
  }
  let hubFallbackReason = null;

  if (opts.preferShared && myFacId && config.features?.['app.premium'] !== false) {
    try {
      const shared = await premiumClient.factionHub(`/v1/factions/${myFacId}/status`);
      if (shared && shared.freshness && Array.isArray(shared.travel)) {
        const st = facStore();
        const cutoff24 = Date.now() - 24 * 3600_000;
        return {
          factionId: shared.factionId || myFacId,
          sourceMode: 'shared',
          freshness: shared.freshness,
          travel: shared.travel,
          travelSummary: shared.travelSummary || { outbound: 0, abroad: 0, inbound: 0, unknown: 0, totalTravel: shared.travel.length },
          members: shared.members || [],
          counts: shared.counts || summarizeActivityCounts(shared.members || []),
          heatmap: factionTools.buildActivityHeatmap(st.activity?.buckets || {}),
          timeline: (st.activity?.timeline || []).filter((pt) => pt.at >= cutoff24),
          lastSampleAt: st.activity?.lastAt || null,
          collector: shared.collector || null,
          at: Date.now(),
        };
      }
    } catch (err) {
      hubFallbackReason = String(err?.code || err?.message || 'HUB_UNAVAILABLE');
    }
  }

  const roster = await rosterCache.load({ force });
  const members = roster.members || [];
  const counts = summarizeActivityCounts(members);
  const st = facStore();
  const heatmap = factionTools.buildActivityHeatmap(st.activity?.buckets || {});
  const cutoff24 = Date.now() - 24 * 3600_000;
  const timeline = (st.activity?.timeline || []).filter((pt) => pt.at >= cutoff24);
  return {
    factionId: roster.factionId || myFacId,
    sourceMode: 'local',
    hubFallbackReason,
    freshness: roster.freshness,
    travel: roster.travel,
    travelSummary: roster.travelSummary,
    transitions: roster.transitions,
    members,
    counts,
    heatmap,
    timeline,
    lastSampleAt: st.activity?.lastAt || null,
    at: Date.now(),
  };
}

async function getFactionArmory(force = false) {
  const ttl = force ? 0 : 60_000;
  let raw = null;
  try {
    const v2 = await torn('v2/faction/news?cat=armoryAction&limit=100', ttl);
    raw = v2.news || [];
  } catch (e) {
    if (FAC_NO_ACCESS.has(Number(e.code))) {
      return {
        allowed: false,
        error: T('Armory geçmişi için pozisyonunda "Faction API Access" izni gerekir.', 'Armory history requires the "Faction API Access" permission for your faction position.'),
        at: Date.now(),
      };
    }
    // Fallback to v1 armorynews if v2 category is unavailable
    try {
      const v1 = await torn('faction/?selections=armorynews', ttl);
      raw = v1.armorynews || {};
    } catch (e2) {
      if (FAC_NO_ACCESS.has(Number(e2.code))) {
        return {
          allowed: false,
          error: T('Armory geçmişi için pozisyonunda "Faction API Access" izni gerekir.', 'Armory history requires the "Faction API Access" permission for your faction position.'),
          at: Date.now(),
        };
      }
      throw e2;
    }
  }
  return { allowed: true, ...factionTools.parseArmoryNews(raw), at: Date.now() };
}

async function getFactionChains(force = false) {
  const ttl = force ? 0 : 60_000;
  let chainsRaw = null, current = null;
  try {
    const [ch, cur] = await Promise.all([
      torn('v2/faction/chains?limit=25', ttl),
      torn('v2/faction/chain', ttl).catch(() => ({})),
    ]);
    chainsRaw = ch.chains || [];
    current = cur.chain || null;
  } catch {
    const v1 = await torn('faction/?selections=chains,chain', ttl);
    chainsRaw = v1.chains || {};
    current = v1.chain || null;
  }
  return { current, chains: factionTools.summarizeChains(chainsRaw), at: Date.now() };
}

async function getFactionUpgrades(force = false) {
  const ttl = force ? 0 : 5 * 60_000;
  const [treeRes, basicRes] = await Promise.all([
    torn('torn/?selections=factiontree', 24 * 3600_000),
    torn('faction/?selections=basic', ttl),
  ]);
  const tree = factionTools.normalizeFactionTree(treeRes.factiontree || treeRes.faction_tree || {});
  let currentLevels = {};
  let hasUpgradesAccess = false;
  try {
    const up = await torn('faction/?selections=upgrades', ttl);
    if (up.upgrades && typeof up.upgrades === 'object') {
      hasUpgradesAccess = true;
      for (const u of Object.values(up.upgrades)) {
        if (!u || !u.branch || !u.name) continue;
        const key = `${u.branch}::${u.name}`;
        currentLevels[key] = Math.max(currentLevels[key] || 0, Number(u.level) || 0);
      }
    }
  } catch (e) {
    if (!FAC_NO_ACCESS.has(Number(e.code))) throw e;
  }
  return {
    faction: { id: basicRes.ID, name: basicRes.name, tag: basicRes.tag, respect: Number(basicRes.respect) || 0 },
    tree,
    currentLevels,
    hasUpgradesAccess,
    at: Date.now(),
  };
}

/* N3 & N4: Personal Member Series + Detailed Faction Workspace (Members, Stats, Gym, Bank, Recruitment, Transfers, Alliance & Graffiti) */
// Same day choice as the weekly report: 7d uses the exact day a week back; a longer span uses the closest day at or
// before its start, or else the oldest older day. actualDays tells how many days the delta really covers and
// complete is true only when that is at least 90% of the span, so a 10-day delta is never presented as 30 days.
const spanComplete = (actualDays, spanDays) => actualDays > 0 && actualDays >= spanDays * 0.9;
function computeSpanDiffs(members, st, spanDays) {
  const days = Object.keys(st.snaps || {}).filter((d) => Object.keys(st.snaps[d]).length).sort();
  const to = days[days.length - 1] || null;
  const targetFrom = to ? utcDay(dayTs(to) - spanDays * 86400) : null;
  const from = !to ? null
    : st.snaps[targetFrom] ? targetFrom
      : spanDays > 7 ? (days.filter((d) => d <= targetFrom).pop() || (days[0] !== to ? days[0] : null)) : null;
  const A = from && st.snaps[from], B = to && st.snaps[to];
  const actualDays = A && B ? Math.round((dayTs(to) - dayTs(from)) / 86400) : 0;
  const gymDays = Object.keys(st.gym || {}).sort();
  const gTo = gymDays[gymDays.length - 1] || null;
  const gFrom = gTo ? (gymDays.filter((d) => d <= utcDay(dayTs(gTo) - spanDays * 86400)).pop() || gymDays[0]) : null;
  const G1 = gFrom && st.gym[gFrom], G2 = gTo && st.gym[gTo];
  const gymActualDays = gFrom && gTo && gFrom !== gTo ? Math.round((dayTs(gTo) - dayTs(gFrom)) / 86400) : 0;
  const diff = (a, b, k) => (a && b && a[k] != null && b[k] != null ? b[k] - a[k] : null);
  const byId = new Map();
  for (const m of members) {
    const a = A?.[m.id], b = B?.[m.id];
    byId.set(m.id, {
      id: m.id,
      name: m.name,
      activity: diff(a, b, 'timeplayed'),
      xanax: diff(a, b, 'xantaken'),
      crimes: diff(a, b, 'criminaloffenses'),
      blood: diff(a, b, 'bloodwithdrawn'),
      oc: diff(a, b, 'organizedcrimes'),
      gym: gFrom && gFrom !== gTo && G1?.[m.id] != null && G2?.[m.id] != null ? G2[m.id] - G1[m.id] : null,
    });
  }
  return {
    from,
    to,
    complete: spanComplete(actualDays, spanDays),
    actualDays,
    gymActualDays,
    gymComplete: spanComplete(gymActualDays, spanDays),
    byId,
    rows: [...byId.values()],
  };
}

async function getLocalMemberSeries(playerId, searchParams) {
  const pid = Number(playerId);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw Object.assign(new ApiError(T('Geçersiz üye kimliği.', 'Invalid player ID.'), 'BAD_PLAYER_ID'), { status: 400 });
  }
  const metric = String(searchParams.get('metric') || 'battlestats').toLowerCase();
  const mode = searchParams.get('mode') === 'gain' ? 'gain' : 'value';
  const rangeKey = String(searchParams.get('range') || '30d').toLowerCase();
  const statKey = String(searchParams.get('stat') || 'total').toLowerCase();
  const parseTs = (v) => {
    if (!v) return null;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n < 1e11 ? n * 1000 : n;
    const p = Date.parse(String(v));
    return Number.isFinite(p) ? p : null;
  };
  const fromMs = parseTs(searchParams.get('from'));
  const toMs = parseTs(searchParams.get('to'));
  const st = facStore();
  const meId = Number(myPlayerId()) || 0;

  if (metric === 'travel') {
    const localTr = (Array.isArray(st.activity?.memberTravel?.[pid]) ? st.activity.memberTravel[pid] : [])
      .filter(isTravelLogEntry).map(travelLogEntry);
    return {
      playerId: pid,
      metric: 'travel',
      transitions: localTr,
      points: localTr,
      at: Date.now(),
    };
  }

  let rawPoints = [];
  if (metric === 'battlestats') {
    if (pid === meId) {
      for (const d of dailyList(history.stats)) {
        const at = Number(d.at) || dayTs(d.date) * 1000;
        rawPoints.push({
          at,
          observedAt: new Date(at).toISOString(),
          source: 'torn_self',
          verified: true,
          total: d.total,
          str: d.str,
          def: d.def,
          spd: d.spd,
          dex: d.dex,
        });
      }
    } else {
      const savedBs = (Array.isArray(st.memberBs?.[pid]) ? st.memberBs[pid] : []).filter((pt) => pt && pt.source !== 'rank_estimate');
      for (const pt of savedBs) rawPoints.push(pt);
      const ff = ffCache.get(pid);
      const ffAt = ff?.data?.bs > 0 ? (ff.data.updated ? Number(ff.data.updated) * 1000 : ff.t) : 0;
      // the live FFScouter total unless the saved history already holds that day's point
      if (ffAt && !savedBs.some((pt) => pt.source === 'ffscouter' && bsDay(pt.at) === bsDay(ffAt))) {
        const at = ffAt;
        rawPoints.push({
          at,
          observedAt: new Date(at).toISOString(),
          source: 'ffscouter',
          verified: false,
          total: Number(ff.data.bs),
        });
      }
      const est = estCache.get(pid);
      if (!rawPoints.length && est?.data?.mid > 0) {
        rawPoints.push({
          at: est.t,
          observedAt: new Date(est.t).toISOString(),
          source: 'rank_estimate',
          verified: false,
          total: Number(est.data.mid),
        });
      }
    }
  } else if (metric === 'contribution') {
    for (const day of Object.keys(st.gym || {}).sort()) {
      const val = st.gym[day]?.[pid];
      if (val != null && Number.isFinite(Number(val))) {
        const at = dayTs(day) * 1000;
        rawPoints.push({
          at,
          observedAt: `${day}T00:00:00.000Z`,
          source: 'torn_contributors',
          value: Number(val),
        });
      }
    }
  } else {
    // activity (timeplayed in minutes, xanax, crimes, oc, blood)
    for (const day of Object.keys(st.snaps || {}).sort()) {
      const snap = st.snaps[day]?.[pid];
      if (!snap) continue;
      let val = null;
      if (statKey === 'xanax') val = snap.xantaken;
      else if (statKey === 'crimes') val = snap.criminaloffenses;
      else if (statKey === 'oc') val = snap.organizedcrimes;
      else if (statKey === 'blood') val = snap.bloodwithdrawn;
      else val = snap.timeplayed != null ? Math.round((Number(snap.timeplayed) || 0) / 60) : null;
      if (val != null && Number.isFinite(Number(val))) {
        const at = dayTs(day) * 1000;
        rawPoints.push({
          at,
          observedAt: `${day}T00:00:00.000Z`,
          source: 'torn_personalstats',
          value: Number(val),
        });
      }
    }
  }

  const series = factionWorkspace.buildMemberSeries(rawPoints, {
    metric: metric === 'battlestats' ? 'battlestats' : metric,
    mode,
    rangeKey,
    fromMs,
    toMs,
    statKey,
    nowMs: Date.now(),
  });
  return {
    playerId: pid,
    ...series,
    at: Date.now(),
  };
}

/* Bank (donations) and applications need the position's "Faction API Access", not the Organised Crimes ability that
   access.allowed stands for. Only Torn's permission codes mean "permission required": a check that failed for another
   reason (rate limit, timeout, network) is { status: 'error', error } so the page can say so and offer a retry. */
function factionDataAccess(access) {
  if (access?.error) {
    if (FAC_NO_ACCESS.has(Number(access.errorCode))) return { allowed: false, status: 'permission_required' };
    return { allowed: false, status: 'error', error: T('Faction yetkilerin şu anda kontrol edilemedi. Biraz sonra tekrar dene.', 'Your faction permissions could not be checked right now. Please try again shortly.') };
  }
  const allowed = access?.inFaction !== false && access?.apiAccess === true;
  return { allowed, status: allowed ? 'idle' : 'permission_required' };
}
// A Torn failure as the user reads it (the same texts as the API error handler).
function userErrorText(e) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return T('Torn bağlantısı zaman aşımına uğradı. Tekrar deneyin.', 'The Torn connection timed out. Please try again.');
  if (e instanceof TypeError && e.message === 'fetch failed') return T('Torn API bağlantısı kurulamadı. İnternet bağlantısını kontrol edin.', 'Could not connect to the Torn API. Check your internet connection.');
  return String(e?.message || T('Bilinmeyen hata', 'Unknown error'));
}

/* Members table travel fields from a Travel Radar row (public/travel-radar.js): travelState, destination, origin
   (country codes) and etaKind / etaAt / etaFrom / etaTo (ISO times). countryCode is where the member is or flies to;
   for a flight home it is the country they come from. etaSec counts down to the exact arrival, or to the end of the
   estimated window (etaSource 'exact' | 'estimate' | 'none'). */
function radarTravelFields(row, nowMs = Date.now()) {
  if (!row) return { countryCode: null, country: null, travelState: null, etaSec: null, etaSource: 'none' };
  const state = row.travelState || null;
  const code = state === 'inbound' ? row.origin : state === 'outbound' || state === 'abroad' ? row.destination : null;
  const countryCode = code && code !== 'torn' ? code : null;
  let etaSec = null, etaSource = 'none';
  if (state === 'outbound' || state === 'inbound') {
    const exact = Date.parse(row.etaAt || ''), windowEnd = Date.parse(row.etaTo || '');
    if (row.etaKind === 'exact' && Number.isFinite(exact)) { etaSec = Math.max(0, Math.round((exact - nowMs) / 1000)); etaSource = 'exact'; }
    else if (row.etaKind === 'estimate' && Number.isFinite(windowEnd)) { etaSec = Math.max(0, Math.round((windowEnd - nowMs) / 1000)); etaSource = 'estimate'; }
  }
  return { countryCode, country: countryCode ? travelRadar.countryName(countryCode) : null, travelState: state, etaSec, etaSource };
}

const emptyCoverage = () => ({ d7: { actualDays: 0, complete: false }, d30: { actualDays: 0, complete: false } });
// Faction workspace for a player without a faction: the same sections, empty, and no Torn request.
function notInFactionWorkspace(access, span, tenureFilter) {
  const notIn = { allowed: false, status: 'not_in_faction' };
  return {
    factionId: null, notInFaction: true, error: notInFactionText(), code: 'NOT_IN_FACTION',
    access: access || { inFaction: false, allowed: false }, freshness: null, coverage: emptyCoverage(), reportJob: { ...facJob },
    membersTable: factionWorkspace.buildMembersTable({ members: [], freshness: null, hasOfficerAccess: false }),
    statsView: factionWorkspace.buildFactionStatsView({ members: [], reportRows: [], windowDays: span, tenureFilter, range: { from: null, to: null, complete: false, actualDays: 0 } }),
    gymView: factionWorkspace.buildFactionGymView({ members: [], gymSnaps: {}, windowDays: span }),
    bank: { ...notIn, source: 'torn_donations', rows: [], totals: { money: 0, points: 0, debtors: 0 }, tornBankUrl: 'https://www.torn.com/factions.php?step=your#/tab=controls&option=give-to-user' },
    recruitment: { ...notIn, source: 'torn_applications', applications: [], watchlist: [], watchlistSource: 'lrx_local' },
    transfers: { source: 'roster_observation', entries: [] },
    alliance: { source: 'lrx_local', alliances: [], graffiti: [] },
    at: Date.now(),
  };
}

async function getFactionWorkspace(force = false, searchParams = new URLSearchParams()) {
  const span = [7, 30, 90].includes(Number(searchParams.get('days'))) ? Number(searchParams.get('days')) : 7;
  const tenureFilter = searchParams.get('tenure') !== 'all';
  const section = String(searchParams.get('section') || 'all');
  if (knownFactionless()) return notInFactionWorkspace(null, span, tenureFilter);
  const [access, rosterResult] = await Promise.all([
    // A failed check is not "not in a faction": inFaction stays unknown (null) and errorCode keeps Torn's code.
    factionAccess(force).catch((e) => ({ inFaction: null, allowed: false, apiAccess: null, error: userErrorText(e), errorCode: e?.code ?? null })),
    rosterCache.load({ force }).then((roster) => ({ roster }), (error) => ({ error })),
  ]);
  if (access.inFaction === false) return notInFactionWorkspace(access, span, tenureFilter);
  if (rosterResult.error) throw rosterResult.error;
  const { roster } = rosterResult;
  const factionId = roster.factionId || access?.faction?.id || Number(history.lastOverview?.player?.faction?.faction_id) || null;
  const members = roster.members || [];
  const st = facStore();
  const meId = Number(myPlayerId()) || 0;
  if (recordMemberBattleStats(members)) saveHistory();

  const diff7 = computeSpanDiffs(members, st, 7);
  const diff30 = computeSpanDiffs(members, st, 30);
  const diffSpan = span === 7 ? diff7 : span === 30 ? diff30 : computeSpanDiffs(members, st, span);
  // How many days the 7d / 30d member columns really cover (complete: at least 90% of the span)
  const coverOf = (d) => ({ actualDays: d.actualDays, complete: d.complete, gymActualDays: d.gymActualDays, gymComplete: d.gymComplete });
  const coverage = { d7: coverOf(diff7), d30: coverOf(diff30) };

  const travelByPlayer = new Map((roster.travel || []).map((t) => [Number(t.playerId), t]));
  const nowMs = Date.now();
  const enriched = members.map((m) => {
    const r7 = diff7.byId.get(m.id);
    const r30 = diff30.byId.get(m.id);
    const travel = radarTravelFields(travelByPlayer.get(m.id), nowMs);
    let battleStats = null;
    if (m.id === meId && history.lastOverview?.battle?.totals) {
      const b = history.lastOverview.battle;
      battleStats = {
        source: 'torn_self',
        verified: true,
        total: b.totals.base,
        str: b.stats?.strength?.base ?? null,
        spd: b.stats?.speed?.base ?? null,
        dex: b.stats?.dexterity?.base ?? null,
        def: b.stats?.defense?.base ?? null,
      };
    } else if (ffCache.get(m.id)?.data?.bs > 0) {
      const f = ffCache.get(m.id).data;
      battleStats = {
        source: 'ffscouter',
        verified: false,
        total: Number(f.bs),
        str: null,
        spd: null,
        dex: null,
        def: null,
      };
    } else if (estCache.get(m.id)?.data?.mid > 0) {
      const e = estCache.get(m.id).data;
      battleStats = {
        source: 'rank_estimate',
        verified: false,
        total: Number(e.mid),
        str: null,
        spd: null,
        dex: null,
        def: null,
      };
    }
    return {
      ...m,
      ...travel, // countryCode, country, travelState, etaSec, etaSource
      battleStats,
      activity7d: r7?.activity ?? null,
      xanax7d: r7?.xanax ?? null,
      crimes7d: r7?.crimes ?? null,
      oc7d: r7?.oc ?? null,
      gym7d: r7?.gym ?? null,
      activity30d: r30?.activity ?? null,
      xanax30d: r30?.xanax ?? null,
      gym30d: r30?.gym ?? null,
    };
  });

  const membersTable = factionWorkspace.buildMembersTable({
    members: enriched,
    freshness: roster.freshness,
    hasOfficerAccess: Boolean(access.allowed),
  });
  const statsView = factionWorkspace.buildFactionStatsView({
    members: enriched,
    reportRows: diffSpan.rows,
    windowDays: span,
    tenureFilter,
    range: { from: diffSpan.from, to: diffSpan.to, complete: diffSpan.complete, actualDays: diffSpan.actualDays },
  });
  const gymView = factionWorkspace.buildFactionGymView({
    members: enriched,
    gymSnaps: st.gym || {},
    windowDays: span,
  });

  // Bank & Recruitment: only queried from Torn when requested and permitted (Faction API Access), otherwise explicit status
  const dataAccess = factionDataAccess(access);
  const accessState = { allowed: dataAccess.allowed, status: dataAccess.status, ...(dataAccess.error ? { error: dataAccess.error } : {}) };
  let bank = {
    ...accessState,
    source: 'torn_donations',
    rows: [],
    totals: { money: 0, points: 0, debtors: 0 },
    tornBankUrl: 'https://www.torn.com/factions.php?step=your#/tab=controls&option=give-to-user',
  };
  if (dataAccess.allowed && (section === 'bank' || section === 'all')) {
    const ttl = force ? 0 : 60_000;
    try {
      const dRes = await torn('faction/?selections=donations', ttl);
      const donations = dRes.donations || {};
      const byMember = new Map(enriched.map((m) => [Number(m.id), m]));
      const rows = Object.entries(donations).map(([idStr, d]) => {
        const id = Number(idStr);
        const mem = byMember.get(id);
        const money = Number(d.money_balance) || 0;
        const points = Number(d.points_balance) || 0;
        return {
          id,
          name: String(d.name || mem?.name || `#${id}`),
          inFaction: byMember.has(id),
          position: mem?.position || '',
          money,
          points,
        };
      }).filter((r) => r.inFaction || r.money !== 0 || r.points !== 0)
        .sort((a, b) => Math.abs(b.money) - Math.abs(a.money) || b.points - a.points);
      const totals = rows.reduce((acc, r) => {
        if (r.money > 0) acc.money += r.money;
        if (r.money < 0) acc.debtors++;
        if (r.points > 0) acc.points += r.points;
        return acc;
      }, { money: 0, points: 0, debtors: 0 });
      bank = { ...bank, status: 'ok', rows, totals };
    } catch (e) {
      if (FAC_NO_ACCESS.has(Number(e.code))) {
        bank = { ...bank, allowed: false, status: 'permission_required' };
      } else {
        bank = { ...bank, status: 'error', error: userErrorText(e) };
      }
    }
  }

  st.notes ||= {};
  const facKey = String(factionId || 'default');
  const facNotes = st.notes[facKey] ||= { watchlist: [], alliances: [], graffiti: [] };
  facNotes.watchlist ||= [];
  facNotes.alliances ||= [];
  facNotes.graffiti ||= [];

  let recruitment = {
    ...accessState,
    source: 'torn_applications',
    applications: [],
    watchlist: facNotes.watchlist,
    watchlistSource: 'lrx_local',
  };
  if (dataAccess.allowed && (section === 'recruitment' || section === 'all')) {
    const ttl = force ? 0 : 60_000;
    try {
      const appRes = await torn('v2/faction/applications', ttl);
      const rawApps = Array.isArray(appRes.applications) ? appRes.applications : Object.values(appRes.applications || {});
      const applications = rawApps.map((a) => ({
        id: Number(a.id || a.user?.id) || 0,
        playerId: Number(a.user?.id ?? a.player_id ?? a.id) || 0,
        name: String(a.user?.name ?? a.name ?? `#${a.id || 0}`),
        level: Number(a.user?.level ?? a.level) || 0,
        stats: a.stats || a.user?.stats || null,
        message: String(a.message || ''),
        status: String(a.status || 'active'),
        validUntil: Number(a.valid_until || a.expires) || null,
      }));
      recruitment = { ...recruitment, status: 'ok', applications };
    } catch (e) {
      if (FAC_NO_ACCESS.has(Number(e.code))) {
        recruitment = { ...recruitment, allowed: false, status: 'permission_required' };
      } else {
        recruitment = { ...recruitment, status: 'error', error: userErrorText(e) };
      }
    }
  }

  return {
    factionId,
    access,
    freshness: roster.freshness,
    coverage,
    reportJob: { ...facJob },
    membersTable,
    statsView,
    gymView,
    bank,
    recruitment,
    transfers: {
      source: 'roster_observation',
      entries: Array.isArray(st.activity?.transfers) ? st.activity.transfers : [],
    },
    alliance: {
      source: 'lrx_local',
      alliances: facNotes.alliances,
      graffiti: facNotes.graffiti,
    },
    at: Date.now(),
  };
}

function mutateFactionWorkspace(body = {}) {
  const st = facStore();
  st.notes ||= {};
  const factionId = Number(body.factionId) || Number(history.lastOverview?.player?.faction?.faction_id) || 0;
  const facKey = String(factionId || 'default');
  const facNotes = st.notes[facKey] ||= { watchlist: [], alliances: [], graffiti: [] };
  facNotes.watchlist ||= [];
  facNotes.alliances ||= [];
  facNotes.graffiti ||= [];
  // Defaults are stored empty (author, watchlist tag, graffiti category): the page shows them in the user's language.
  const authorName = String(history.lastOverview?.player?.name || '');
  const authorId = Number(myPlayerId()) || 0;
  const nowIso = travelRadar.isoUtc(Date.now());
  const action = String(body.action || '');

  if (action === 'watchlist_add') {
    const playerId = Number(body.playerId);
    const name = String(body.name || `#${playerId || ''}`).trim().slice(0, 60);
    const note = String(body.note || '').trim().slice(0, 280);
    const tag = String(body.tag || '').trim().slice(0, 32);
    if (!playerId && !name) throw Object.assign(new ApiError(T('Oyuncu ID veya isim gerekli.', 'Player ID or name required.'), 'BAD_INPUT'), { status: 400 });
    const entry = {
      id: `wl_${playerId || Date.now()}`,
      playerId: playerId > 0 ? playerId : null,
      name,
      level: Number(body.level) || null,
      tag,
      note,
      authorId,
      authorName,
      updatedAt: nowIso,
      source: 'lrx_local',
    };
    facNotes.watchlist = [entry, ...facNotes.watchlist.filter((x) => x.id !== entry.id && (!playerId || x.playerId !== playerId))].slice(0, 60);
    saveHistory();
    return { ok: true, watchlist: facNotes.watchlist };
  }
  if (action === 'watchlist_remove') {
    const id = String(body.id || '');
    facNotes.watchlist = facNotes.watchlist.filter((x) => x.id !== id);
    saveHistory();
    return { ok: true, watchlist: facNotes.watchlist };
  }
  if (action === 'alliance_add') {
    const targetFactionId = Number(body.targetFactionId) || null;
    const name = String(body.name || '').trim().slice(0, 80);
    const tag = String(body.tag || '').trim().slice(0, 16);
    const relation = ['ally', 'family', 'nap', 'rival'].includes(body.relation) ? body.relation : 'ally';
    const note = String(body.note || '').trim().slice(0, 280);
    if (!name && !targetFactionId) throw Object.assign(new ApiError(T('Faction adı veya ID gerekli.', 'Faction name or ID required.'), 'BAD_INPUT'), { status: 400 });
    const entry = {
      id: `al_${targetFactionId || Date.now()}`,
      factionId: targetFactionId,
      name: name || `Faction #${targetFactionId}`,
      tag,
      relation,
      note,
      authorId,
      authorName,
      updatedAt: nowIso,
      source: 'lrx_local',
    };
    facNotes.alliances = [entry, ...facNotes.alliances.filter((x) => x.id !== entry.id)].slice(0, 50);
    saveHistory();
    return { ok: true, alliances: facNotes.alliances };
  }
  if (action === 'alliance_remove') {
    const id = String(body.id || '');
    facNotes.alliances = facNotes.alliances.filter((x) => x.id !== id);
    saveHistory();
    return { ok: true, alliances: facNotes.alliances };
  }
  if (action === 'graffiti_add') {
    const text = String(body.text || '').trim().slice(0, 500);
    const category = String(body.category || '').trim().slice(0, 32);
    if (!text) throw Object.assign(new ApiError(T('Graffiti metni boş olamaz.', 'Graffiti text cannot be empty.'), 'BAD_INPUT'), { status: 400 });
    const entry = {
      id: `gf_${Date.now()}`,
      text,
      category,
      authorId,
      authorName,
      createdAt: nowIso,
      source: 'lrx_local',
    };
    facNotes.graffiti = [entry, ...facNotes.graffiti].slice(0, 80);
    saveHistory();
    return { ok: true, graffiti: facNotes.graffiti };
  }
  if (action === 'graffiti_remove') {
    const id = String(body.id || '');
    facNotes.graffiti = facNotes.graffiti.filter((x) => x.id !== id);
    saveHistory();
    return { ok: true, graffiti: facNotes.graffiti };
  }
  throw Object.assign(new ApiError(T('Geçersiz işlem.', 'Invalid action.'), 'BAD_ACTION'), { status: 400 });
}

/* Stock Market Tracker: live prices, benefit block ROI, holdings P/L and local 30-day observed range */
const STOCK_DIVIDEND_ITEMS = new Set([
  'six-pack of alcohol', 'box of grenades', 'feathery hotel coupon', 'lawyer business card',
  'lottery voucher', 'six-pack of energy drink', 'erotic dvd', 'drug pack',
  'clothing cache', 'box of medical supplies',
]);

function recordStockPrices(stocks) {
  if (!stocks || typeof stocks !== 'object') return;
  history.stockPrices ||= {};
  const day = utcDay(Math.floor(Date.now() / 1000));
  const cut = utcDay(Math.floor(Date.now() / 1000) - 32 * 86400);
  let dirty = false;
  for (const [id, s] of Object.entries(stocks)) {
    const price = Number(s?.current_price) || 0;
    if (!(price > 0)) continue;
    const arr = history.stockPrices[id] ||= [];
    const last = arr[arr.length - 1];
    if (last && last.date === day) {
      if (price < last.low) { last.low = price; dirty = true; }
      if (price > last.high) { last.high = price; dirty = true; }
      if (price !== last.close) { last.close = price; dirty = true; }
    } else {
      arr.push({ date: day, low: price, high: price, close: price });
      dirty = true;
    }
    while (arr.length && arr[0].date < cut) { arr.shift(); dirty = true; }
  }
  if (dirty) saveHistory();
}

async function getStockMarket(force = false) {
  const ttl = force ? 0 : 60_000;
  const [market, mine, items, bank, stats] = await Promise.all([
    torn('torn/?selections=stocks', ttl),
    torn('user/?selections=stocks', ttl).catch(() => ({})),
    torn('torn/?selections=items', 3600_000).catch(() => ({})),
    torn('torn/?selections=bank', 3600_000).catch(() => ({})),
    torn('torn/?selections=stats', 3600_000).catch(() => ({})),
  ]);
  const stocks = market.stocks || {};
  recordStockPrices(stocks);
  const itemPriceByName = {};
  for (const it of Object.values(items.items || {})) {
    const low = String(it?.name || '').toLowerCase();
    if (STOCK_DIVIDEND_ITEMS.has(low)) itemPriceByName[low] = Number(it.market_value) || 0;
  }
  const pointsPrice = Number(stats.stats?.points_averagecost) || 0;

  // Evaluate local price threshold alerts (first sample = baseline; source loss never fires)
  const rules = Array.isArray(history.priceAlerts) ? history.priceAlerts : [];
  const currentPrices = {};
  for (const [id, s] of Object.entries(stocks)) {
    const p = Number(s?.current_price) || 0;
    if (p > 0) currentPrices[`stock:${s.stock_id ?? id}`] = p;
  }
  const evaluated = stocksMath.evaluatePriceAlerts(rules, currentPrices, history.priceAlertBaselines || {}, travelRadar.isoUtc(Date.now()));
  if (JSON.stringify(evaluated.nextPrev) !== JSON.stringify(history.priceAlertBaselines || {})) {
    history.priceAlertBaselines = evaluated.nextPrev;
    saveHistory();
  }

  return {
    stocks,
    userStocks: mine.stocks || {},
    itemPriceByName,
    pointsPrice,
    bankAprs: bank.bank || null,
    priceHistory: history.stockPrices || {},
    priceAlerts: { rules, triggered: evaluated.events },
    at: Date.now(),
  };
}

function managePriceAlerts(body = {}) {
  history.priceAlerts ||= [];
  const action = String(body.action || 'list');
  if (action === 'add') {
    const assetKind = body.assetKind === 'item' ? 'item' : 'stock';
    const assetId = String(body.assetId || '').trim();
    const threshold = Number(body.threshold);
    const direction = body.direction === 'below' ? 'below' : 'above';
    if (!assetId || !(threshold > 0)) throw Object.assign(new ApiError(T('Geçersiz fiyat eşiği.', 'Invalid price threshold.'), 'BAD_ALERT'), { status: 400 });
    const rule = {
      id: `${assetKind}_${assetId}_${direction}_${Date.now()}`,
      assetKind,
      assetId,
      label: String(body.label || assetId).slice(0, 48),
      direction,
      threshold,
      enabled: true,
      source: assetKind === 'stock' ? 'torn_stocks' : 'torn_items',
      createdAt: Date.now(),
    };
    history.priceAlerts = [...history.priceAlerts.slice(-49), rule];
    saveHistory();
    return { rules: history.priceAlerts, added: rule };
  }
  if (action === 'remove') {
    const id = String(body.id || '');
    history.priceAlerts = history.priceAlerts.filter((r) => r.id !== id);
    saveHistory();
    return { rules: history.priceAlerts };
  }
  return { rules: history.priceAlerts };
}

async function getOpsStatus(checkSources = false) {
  if (checkSources) {
    await Promise.allSettled([
      tornRaw('torn/?selections=timestamp').catch(() => null),
      fetchStocks().catch(() => null),
    ]);
  }
  const maskedKey = config.apiKey ? '****' + config.apiKey.slice(-4) : '';
  const peek = rosterCache.peek();
  const facId = Number(history.lastOverview?.player?.faction?.faction_id) || peek?.factionId || null;
  let hub = { connected: false, admin: false, collector: null, factionSettings: null };
  if (config.features?.['app.premium'] !== false) {
    try {
      const st = await premiumClient.status({ skipReconnect: true });
      hub.connected = Boolean(st?.connected);
      hub.admin = Boolean(st?.account?.admin);
      if (st?.connected && st?.account?.admin) {
        hub.collector = await premiumClient.factionHub('/v1/admin/faction-collector').catch(() => null);
      }
      if (st?.connected && facId) {
        hub.factionSettings = await premiumClient.factionHub(`/v1/factions/${facId}/settings`).catch(() => null);
      }
    } catch { /* Hub optional: local ops remain fully visible */ }
  }
  return {
    at: Date.now(),
    factionId: facId,
    maskedKey,
    tornPausedUntil,
    sources: { ...sourceHealth },
    localRoster: peek ? {
      factionId: peek.factionId,
      observedAt: peek.freshness.observedAt,
      receivedAt: peek.freshness.receivedAt,
      ageSec: peek.freshness.ageSec,
      state: peek.freshness.state,
      membersCount: peek.membersCount,
      travelCount: peek.travelCount,
    } : null,
    hub,
  };
}

/* Company Position Advisor: positions of the director's company type + BUS2110 check */
async function getCompanyPositions() {
  const [compRes, typesRes, eduRes, eduNames] = await Promise.all([
    torn('company/?selections=profile', 60_000),
    torn('torn/?selections=companies', 24 * 3600_000),
    torn('user/?selections=education', 5 * 60_000).catch(() => ({})),
    getEducationNames().catch(() => history.eduNames || {}),
  ]);
  const c = compRes.company;
  if (!c) throw new ApiError(T('Şirket bulunamadı.', 'No company found.'), 'NO_COMPANY');
  const typeInfo = typesRes.companies?.[String(c.company_type)] || {};
  const completed = new Set((eduRes.education_completed || []).map(Number));
  let directorBus2110 = false;
  for (const [id, info] of Object.entries(eduNames || {})) {
    if (String(info?.code || '').toUpperCase() === 'BUS2110' && completed.has(Number(id))) {
      directorBus2110 = true;
      break;
    }
  }
  return {
    companyType: c.company_type,
    companyName: c.name,
    typeName: typeInfo.name || '',
    positions: typeInfo.positions || {},
    directorBus2110,
    at: Date.now(),
  };
}

/* Ranked War Payout Planner: recent wars + per-war member hit/respect report */
async function getRankedWars(force = false) {
  const ttl = force ? 0 : 5 * 60_000;
  const [myFac, rw] = await Promise.all([
    torn('v2/user/faction', 10 * 60_000).catch(() => ({})),
    torn('v2/faction/rankedwars?limit=15', ttl).catch(() => torn('faction/?selections=rankedwars', ttl)),
  ]);
  const myFactionId = Number(myFac.faction?.id) || null;
  const raw = rw.rankedwars || rw.ranked_wars || [];
  const list = Array.isArray(raw)
    ? raw.map((w) => {
        const facs = Array.isArray(w.factions) ? w.factions : Object.entries(w.factions || {}).map(([id, f]) => ({ id: Number(id), ...f }));
        const mine = facs.find((f) => Number(f.id) === myFactionId) || facs[0];
        const opp = facs.find((f) => Number(f.id) !== Number(mine?.id)) || facs[1];
        return {
          id: Number(w.id),
          start: Number(w.start ?? w.war?.start) || 0,
          end: Number(w.end ?? w.war?.end) || 0,
          target: Number(w.target ?? w.war?.target) || 0,
          winner: Number(w.winner ?? w.war?.winner) || 0,
          myName: mine?.name || '',
          myScore: Number(mine?.score) || 0,
          oppId: Number(opp?.id) || 0,
          oppName: opp?.name || '',
          oppScore: Number(opp?.score) || 0,
        };
      })
    : Object.entries(raw || {}).map(([id, w]) => {
        const facs = Object.entries(w.factions || {}).map(([fid, f]) => ({ id: Number(fid), ...f }));
        const mine = facs.find((f) => f.id === myFactionId) || facs[0];
        const opp = facs.find((f) => f.id !== mine?.id) || facs[1];
        return {
          id: Number(id),
          start: Number(w.war?.start) || 0,
          end: Number(w.war?.end) || 0,
          target: Number(w.war?.target) || 0,
          winner: Number(w.war?.winner) || 0,
          myName: mine?.name || '',
          myScore: Number(mine?.score) || 0,
          oppId: opp?.id || 0,
          oppName: opp?.name || '',
          oppScore: Number(opp?.score) || 0,
        };
      });
  list.sort((a, b) => b.start - a.start);
  return { myFactionId, wars: list, at: Date.now() };
}

async function getRankedWarReport(warId, force = false) {
  const id = Number(warId);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new ApiError(T('Geçersiz savaş ID.', 'Invalid ranked war ID.'), 'BAD_WAR_ID'), { status: 400 });
  const ttl = force ? 0 : 5 * 60_000;
  const [myFac, rep] = await Promise.all([
    torn('v2/user/faction', 10 * 60_000).catch(() => ({})),
    torn(`v2/faction/${id}/rankedwarreport`, ttl).catch(() => torn(`torn/${id}?selections=rankedwarreport`, ttl)),
  ]);
  const myFactionId = Number(myFac.faction?.id) || null;
  const r = rep.rankedwarreport || rep;
  const rawFacs = r.factions || [];
  const normMembers = (mems) => {
    const arr = Array.isArray(mems) ? mems : Object.entries(mems || {}).map(([mid, m]) => ({ id: Number(mid), ...(m || {}) }));
    return arr.map((m) => ({
      id: Number(m.id) || 0,
      name: String(m.name || `#${m.id || 0}`),
      level: Number(m.level) || 0,
      attacks: Number(m.attacks) || 0,
      score: Number(m.score) || 0,
    }));
  };
  const factions = Array.isArray(rawFacs)
    ? rawFacs.map((f) => ({ id: Number(f.id) || 0, name: String(f.name || ''), score: Number(f.score) || 0, attacks: Number(f.attacks) || 0, members: normMembers(f.members) }))
    : Object.entries(rawFacs || {}).map(([fid, f]) => ({ id: Number(fid) || 0, name: String(f.name || ''), score: Number(f.score) || 0, attacks: Number(f.attacks) || 0, members: normMembers(f.members) }));
  return {
    warId: id,
    myFactionId,
    war: { start: Number(r.start ?? r.war?.start) || 0, end: Number(r.end ?? r.war?.end) || 0, winner: Number(r.winner ?? r.war?.winner) || 0 },
    factions,
    at: Date.now(),
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
    if (config.features?.['page.faction'] !== false
      && (config.features?.['faction.activity'] !== false || config.features?.['faction.travelRadar'] !== false)
      && Number(history.lastOverview?.player?.faction?.faction_id) > 0) {
      getFactionActivity().catch(() => {});
    }
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

/* Faction Hub (Premium service) error codes as the user reads them; the code itself stays in `code`. */
function hubErrorText(code) {
  switch (code) {
    case 'PREMIUM_DISABLED': return T('Premium üyelik bağlantısı Ayarlar → Uygulama bölümünde kapalı; Faction Hub kullanılamaz.', 'The Premium membership connection is off in Settings → App, so the Faction Hub is not available.');
    case 'PREMIUM_CONNECT_REQUIRED': case 'API_KEY_REQUIRED': return T('Faction Hub için önce Premium üyeliğini bağla.', 'Connect your Premium membership to use the Faction Hub.');
    case 'PREMIUM_SERVICE_NOT_CONFIGURED': case 'PREMIUM_SERVICE_URL_INVALID': return T('Bu sürümde Premium servisi ayarlı değil.', 'The Premium service is not configured in this version.');
    case 'PREMIUM_SERVICE_UNREACHABLE': return T('Premium servisine ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.', 'The Premium service could not be reached. Check your internet connection and try again.');
    case 'PREMIUM_IDENTITY_CHANGED': return T('API key bu sırada değişti. Tekrar dene.', 'The API key changed in the meantime. Please try again.');
    case 'FACTION_ACCESS_DENIED': return T('Faction Hub yalnızca bu faction\'ın üyelerine açık.', 'The Faction Hub is only open to members of this faction.');
    case 'FACTION_OFFICER_REQUIRED': case 'ADMIN_REQUIRED': case 'FORBIDDEN': return T('Bu Faction Hub işlemi için yetkin yok.', 'You do not have permission for this Faction Hub action.');
    case 'FACTION_PLAN_REQUIRED': case 'FACTION_PLAN_EXPIRED': case 'FACTION_PLAN_INACTIVE': return T('Bu aralık için faction takım planı gerekli.', 'This range needs an active faction team plan.');
    case 'FACTION_NOT_TRACKED': case 'COLLECTOR_NOT_FOUND': return T('Bu faction Hub\'da henüz takip edilmiyor.', 'This faction is not tracked on the Hub yet.');
    default: return T('Premium servisi isteği tamamlayamadı. Biraz sonra tekrar dene.', 'The Premium service could not complete the request. Please try again shortly.');
  }
}
// Faction Hub proxy routes: like /api/premium/*, nothing (and never the API key) goes to the Premium service while
// Settings → App → Premium membership connection is off. Bridge errors reach the page as text.
async function hubRoute(res, run) {
  if (config.features?.['app.premium'] === false) return send(res, 403, { error: hubErrorText('PREMIUM_DISABLED'), code: 'PREMIUM_DISABLED' });
  try { return send(res, 200, await run()); }
  catch (e) {
    const code = typeof e?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(e.code) ? e.code : null;
    // A bridge error carries only its code; anything else (a bad request body, say) keeps its own message.
    if (code && (e.message === code || !e.message)) return send(res, e.status || 503, { error: hubErrorText(code), code });
    return send(res, e.status || 502, { error: e.message || hubErrorText(null), code: code || 'PREMIUM_SERVICE_ERROR' });
  }
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (!secretsOpen) await secretsReady; // the saved keys are decrypted once Electron is ready
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
        secretStorage: secretStore.mode, secretsUnreadable: secretStore.unreadable,
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
    // Overview widget layouts, one set per Torn player. Only the server's player is read or written: a save sent for
    // another player (the app switched players in the meantime) is refused, and other players' sets are never returned.
    if (p === '/api/overview-layouts' && req.method === 'GET') {
      const playerId = historyOwner(), saved = playerId == null ? null : config.overviewLayouts?.[String(playerId)];
      return send(res, 200, { playerId, layouts: saved == null ? null : overviewLayout.normalize(saved) });
    }
    if (p === '/api/overview-layouts' && req.method === 'POST') {
      const b = await readBody(req), playerId = historyOwner();
      if (playerId == null || b.playerId !== playerId) return send(res, 409, { error: T('Bu düzen başka bir oyuncuya ait.', 'The layout belongs to another player.'), code: 'PLAYER_CHANGED' });
      const layouts = overviewLayout.normalize(b.layouts);
      if (!config.overviewLayouts || typeof config.overviewLayouts !== 'object' || Array.isArray(config.overviewLayouts)) config.overviewLayouts = {};
      config.overviewLayouts[String(playerId)] = layouts;
      saveConfig();
      return send(res, 200, { ok: true, playerId, layouts });
    }
    if (p === '/api/stats') return send(res, 200, { history: dailyList(history.stats), battle: history.lastOverview?.battle || null });
    if (p === '/api/networth') return send(res, 200, await getNetworth(url.searchParams.get('force') === '1'));
    if (p === '/api/holdings') return send(res, 200, await getHoldings(url.searchParams.get('force') === '1'));
    if (p === '/api/job') return send(res, 200, await getJobInfo());
    if (p === '/api/travel') return send(res, 200, await getTravelProfit());
    if (p === '/api/levelling') return send(res, 200, await getLevelling(url.searchParams.get('list') || ''));
    // "I pressed Attack on this target": the scan checks it again every few seconds for a while, so a target that went
    // to hospital leaves the page soon. Only a target of the list being scanned; it adds no Torn request.
    if (p === '/api/levelling/attacked') {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
      const { id } = await readBody(req);
      const rows = levelScan.list ? (await getLevelLists())[levelScan.list] || [] : [];
      if (!Number.isInteger(id) || id <= 0 || !rows.some((r) => r.id === id)) return send(res, 400, { error: T('Bu hedef listede yok.', 'This target is not in the list.') });
      levelScan.hot.set(id, Date.now() + levelling.HOT_FOR_MS);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/shoplifting') return send(res, 200, await getShoplifting());
    if (p === '/api/awards') return send(res, 200, await getAwards());
    if (p === '/api/merit-allocation') return send(res, 200, await getMeritAllocation());
    if (p === '/api/crime-value') return send(res, 200, await getCrimeValue(url.searchParams.get('force') === '1'));
    if (p === '/api/jail') return send(res, 200, await getJail());
    if (p === '/api/events') return send(res, 200, await getEvents(url.searchParams.get('force') === '1'));
    if (p === '/api/stocks') return send(res, 200, await getStockMarket(url.searchParams.get('force') === '1'));
    if (p === '/api/company/positions') return send(res, 200, await getCompanyPositions());
    if (p === '/api/war/rankedwars') return send(res, 200, await getRankedWars(url.searchParams.get('force') === '1'));
    if (p === '/api/war/payout') return send(res, 200, await getRankedWarReport(url.searchParams.get('warId'), url.searchParams.get('force') === '1'));
    if (p === '/api/faction') {
      const force = url.searchParams.get('force') === '1';
      const [access, myOc] = await Promise.all([factionAccess(force).catch((e) => ({ error: e.message })), getMyOcInfo()]);
      const oc = access.allowed ? await getFactionOC(force).catch((e) => ({ error: e.message })) : null;
      return send(res, 200, { access, myOc, oc, at: Date.now() });
    }
    if (p === '/api/faction/report') return send(res, 200, await getFactionReport(req.method === 'POST', Number(url.searchParams.get('days')) || 7));
    if (p === '/api/faction/activity') return send(res, 200, await getFactionActivity(url.searchParams.get('force') === '1', { preferShared: url.searchParams.get('source') === 'shared' }));
    if (p === '/api/faction/armory') return send(res, 200, await getFactionArmory(url.searchParams.get('force') === '1'));
    if (p === '/api/faction/chains') return send(res, 200, await getFactionChains(url.searchParams.get('force') === '1'));
    if (p === '/api/faction/upgrades') return send(res, 200, await getFactionUpgrades(url.searchParams.get('force') === '1'));
    if (p === '/api/faction/workspace' && req.method === 'GET') {
      return send(res, 200, await getFactionWorkspace(url.searchParams.get('force') === '1', url.searchParams));
    }
    if (p === '/api/faction/workspace' && req.method === 'POST') {
      return send(res, 200, mutateFactionWorkspace(await readBody(req)));
    }
    const memberSeriesMatch = p.match(/^\/api\/faction\/members\/(\d+)\/series$/);
    if (memberSeriesMatch && req.method === 'GET') {
      return send(res, 200, await getLocalMemberSeries(memberSeriesMatch[1], url.searchParams));
    }
    if (p === '/api/alerts/price' && req.method === 'GET') return send(res, 200, managePriceAlerts({ action: 'list' }));
    if (p === '/api/alerts/price' && req.method === 'POST') return send(res, 200, managePriceAlerts(await readBody(req)));
    if (p === '/api/ops/status' && req.method === 'GET') return send(res, 200, await getOpsStatus(url.searchParams.get('check') === '1'));
    if (p === '/api/ops/faction-collector/jobs' && req.method === 'POST') {
      return hubRoute(res, async () => premiumClient.factionHub('/v1/admin/faction-collector/jobs', { method: 'POST', body: await readBody(req) }));
    }
    const hubFactionId = () => Number(url.searchParams.get('factionId')) || Number(history.lastOverview?.player?.faction?.faction_id) || 0;
    if (p === '/api/faction/hub/settings') {
      const fid = hubFactionId();
      if (!fid) return send(res, 400, { error: T('Faction kimliği bulunamadı.', 'Faction ID not found.') });
      const method = req.method === 'PATCH' || req.method === 'POST' ? 'PATCH' : 'GET';
      return hubRoute(res, async () => premiumClient.factionHub(`/v1/factions/${fid}/settings`, { method, body: method === 'PATCH' ? await readBody(req) : undefined }));
    }
    if (p === '/api/faction/hub/history' && req.method === 'GET') {
      const fid = hubFactionId();
      if (!fid) return send(res, 400, { error: T('Faction kimliği bulunamadı.', 'Faction ID not found.') });
      const q = new URLSearchParams();
      for (const k of ['from', 'to', 'grain']) if (url.searchParams.get(k)) q.set(k, url.searchParams.get(k));
      const suffix = q.toString() ? `?${q.toString()}` : '';
      return hubRoute(res, () => premiumClient.factionHub(`/v1/factions/${fid}/history${suffix}`));
    }
    if (p === '/api/faction/hub/report' && req.method === 'GET') {
      const fid = hubFactionId();
      if (!fid) return send(res, 400, { error: T('Faction kimliği bulunamadı.', 'Faction ID not found.') });
      return hubRoute(res, () => premiumClient.factionHub(`/v1/factions/${fid}/report`));
    }
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
      secretStore.discardUnreadable(); // Log Out forgets every saved key, also those this computer can't read
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
          secretStorage: secretStore.mode,
          secretsUnreadable: secretStore.unreadable,
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
    // A Premium bridge error carries only its code: the user reads a sentence instead
    if (typeof e.code === 'string' && e.message === e.code && /^(?:PREMIUM_|API_KEY_REQUIRED$|FACTION_|COLLECTOR_)/.test(e.code)) {
      return send(res, e.status || 503, { error: hubErrorText(e.code), code: e.code });
    }
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
      secretsReady.then(() => {
        if (!config.apiKey) return;
        getOverview(false).catch((e) => console.warn('[init] overview:', e.message));
        fetchCompany(false).then(buildCompanyReport).catch((e) => console.warn('[init] company:', e.message));
      });
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

/* Profile helper (torn-helpers/profile-work-stats.js): the player's working stats from the Hall of Fame and the star
   rating of the company their profile links to. The owner chose automatic lookups: two public Torn API requests per
   profile, made here with the saved key (it never reaches the page) and inside the shared 80/min throttle. Only the
   two numbers are kept, in memory: 12 h per player, 24 h per company; a failed lookup is retried after 5 min.
   Idea: swervelord's "Torn Profile Company Star Rating + Working Stats" userscript (no code copied). */
const PROFILE_PLAYER_TTL = 12 * 3600_000, PROFILE_COMPANY_TTL = 24 * 3600_000, PROFILE_RETRY_MS = 5 * 60_000, PROFILE_CACHE_MAX = 2000;
const profileCache = new Map(); // 'u:<id>' | 'c:<id>' -> { gen, t, value } or { gen, promise }
function profileLookup(key, ttl, pathq, pick) {
  const hit = profileCache.get(key);
  if (hit && hit.gen === keyGen) {
    if (hit.promise) return hit.promise;
    if (Date.now() - hit.t < (hit.value === null ? PROFILE_RETRY_MS : ttl)) return Promise.resolve(hit.value);
  }
  const gen = keyGen;
  const promise = tornRaw(pathq).then(pick).catch(() => null).then((value) => {
    profileCache.delete(key);
    if (gen === keyGen) {
      profileCache.set(key, { gen, t: Date.now(), value });
      while (profileCache.size > PROFILE_CACHE_MAX) profileCache.delete(profileCache.keys().next().value);
    }
    return value;
  });
  profileCache.set(key, { gen, promise });
  return promise;
}
async function profileWorkStats(playerId, companyId) {
  const pid = /^\d{1,10}$/.test(String(playerId ?? '')) ? String(Number(playerId)) : null;
  const cid = /^\d{1,10}$/.test(String(companyId ?? '')) ? String(Number(companyId)) : null;
  if (!config.apiKey || !pid || pid === '0') return { workingStats: null, rating: null };
  const [workingStats, rating] = await Promise.all([
    profileLookup('u:' + pid, PROFILE_PLAYER_TTL, `v2/user/${pid}/hof`, (j) => {
      const v = Number(j?.hof?.working_stats?.value);
      return Number.isFinite(v) && v >= 0 ? v : null;
    }),
    cid && cid !== '0' ? profileLookup('c:' + cid, PROFILE_COMPANY_TTL, `company/${cid}?selections=profile`, (j) => {
      const r = Number(j?.company?.rating);
      return Number.isInteger(r) && r >= 0 && r <= 10 ? r : null;
    }) : null,
  ]);
  return { workingStats, rating };
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

module.exports = { startServer, server, stockProductNames, ingestStockDeliveries, warMemberStatuses, profileWorkStats, warGroupLabels: warGroups.labels, flushData, myPlayerId, getCrimeValue, crimeValueForPage, purchaseCostsForPage, seasonalActive, seasonalList, halloweenForPage, factionDataAccess, isTornSourceError, ffScriptBridge: () => ({ url: `http://127.0.0.1:${server.address().port}/api/ff-script-request`, token: ffScriptProxy.token }) };
