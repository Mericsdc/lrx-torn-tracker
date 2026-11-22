/* Holdings: the items and stocks behind the player's networth (Finance › Networth › Holdings card, public/finance.js).
   Pure: Torn replies come from an injected get(pathq, ttl) (src/server/server.js passes torn()); nothing is stored.
   Every place loads on its own, so one refused or broken reply leaves the others standing.
   Spec: docs/superpowers/specs/2026-11-22-finance-holdings-design.md */
'use strict';

const PLACES = Object.freeze(['inventory', 'bazaar', 'display', 'itemmarket', 'stocks']);
const PAGE_CAP = 8; // pages per paged place: 2,000 inventory rows
const INV_PAGE = 250;
const CATALOG_TTL = 3_600_000; // the item list, shared with the rest of the app
const STOCKS_TTL = 60_000; // shared with the Stock Market page

class ShapeError extends Error {
  constructor() { super('Unexpected reply from Torn'); this.code = 'BAD_SHAPE'; }
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const listOf = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : null);
const priceOf = (catalog, id) => num(catalog?.[id]?.market_value);

// One place's rows merged by id (weapons and armour come one row per uid), sorted by value.
function finish(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!(r.qty > 0)) continue;
    const m = by.get(r.id);
    if (!m) { by.set(r.id, { ...r, listedSum: r.listed != null ? r.listed * r.qty : null }); continue; }
    m.qty += r.qty;
    m.value += r.value;
    if (r.listed != null) m.listedSum = (m.listedSum || 0) + r.listed * r.qty;
  }
  const out = [...by.values()].map(({ listedSum, listed, ...r }) => {
    const row = { ...r, unit: r.value / r.qty };
    if (listedSum != null) row.listed = listedSum / r.qty;
    return row;
  }).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return { ok: true, total: out.reduce((a, r) => a + r.value, 0), rows: out };
}

// v2/user/inventory, 250 rows a page. Faction armory loans are not the player's; equipped items are.
async function inventory(get, catalog) {
  const rows = [];
  let partial = false, tornAt;
  for (let page = 0; ; page++) {
    if (page === PAGE_CAP) { partial = true; break; }
    const r = await get(`v2/user/inventory?limit=${INV_PAGE}&offset=${page * INV_PAGE}`, 0);
    const items = r?.inventory?.items;
    if (!Array.isArray(items)) throw new ShapeError();
    tornAt ??= num(r.inventory.timestamp) || undefined;
    for (const it of items) {
      if (it?.faction_owned) continue;
      const id = num(it?.id), qty = num(it?.amount), c = catalog[id];
      rows.push({ id, name: String(c?.name || it?.name || `#${id}`), type: String(c?.type || ''), qty, value: qty * priceOf(catalog, id) });
    }
    if (items.length < INV_PAGE || !r._metadata?.links?.next) break;
  }
  return { ...finish(rows), ...(partial ? { partial: true } : {}), ...(tornAt ? { tornAt } : {}) };
}

// API v1 bazaar / display lists ({ ID, quantity, market_price, price? }); a missing price falls back to the item list.
function v1Items(reply, key, catalog, withListed) {
  if (!reply || typeof reply !== 'object' || !(key in reply)) throw new ShapeError();
  const items = reply[key] == null ? [] : listOf(reply[key]);
  if (!items) throw new ShapeError();
  return finish(items.map((it) => {
    const id = num(it?.ID ?? it?.id), qty = num(it?.quantity ?? it?.amount), c = catalog?.[id];
    const unit = num(it?.market_price ?? it?.market_value) || priceOf(catalog, id);
    const row = { id, name: String(it?.name || c?.name || `#${id}`), type: String(it?.type || c?.type || ''), qty, value: qty * unit };
    if (withListed) row.listed = num(it?.price);
    return row;
  }));
}

// v2/user/itemmarket, paged by offset. A listing counts at most what is still available to sell.
async function itemMarket(get, catalog) {
  const rows = [];
  let partial = false, offset = 0;
  for (let page = 0; ; page++) {
    if (page === PAGE_CAP) { partial = true; break; }
    const r = await get(`v2/user/itemmarket?offset=${offset}`, 0);
    const items = r?.itemmarket;
    if (!Array.isArray(items)) throw new ShapeError();
    for (const l of items) {
      const id = num(l?.item?.id), c = catalog[id], amount = num(l?.amount);
      const qty = l?.available != null && Number.isFinite(Number(l.available)) ? Math.min(amount, num(l.available)) : amount;
      rows.push({ id, name: String(l?.item?.name || c?.name || `#${id}`), type: String(l?.item?.type || c?.type || ''), qty, value: qty * priceOf(catalog, id), listed: num(l?.price) });
    }
    offset += items.length;
    if (!items.length || !r._metadata?.links?.next) break;
  }
  return { ...finish(rows), ...(partial ? { partial: true } : {}) };
}

// user stocks (shares) × torn stocks (current price).
function stocks(mine, market) {
  const own = mine?.stocks, prices = market?.stocks;
  if (own != null && typeof own !== 'object') throw new ShapeError();
  if (!prices || typeof prices !== 'object') throw new ShapeError();
  const byId = {};
  for (const [k, s] of Object.entries(prices)) byId[String(s?.stock_id ?? k)] = s || {};
  return finish(Object.entries(own || {}).map(([k, u]) => {
    const sid = String(u?.stock_id ?? k), s = byId[sid] || {}, qty = num(u?.total_shares ?? u?.shares);
    const name = s.acronym ? `${s.name || s.acronym} (${s.acronym})` : String(s.name || `#${sid}`);
    return { id: 's' + sid, name, type: 'Stock', qty, value: qty * num(s.current_price) };
  }));
}

async function loadHoldings({ get, force = false, now = () => Date.now() }) {
  const catalog = get('torn/?selections=items', CATALOG_TTL).then((r) => {
    if (!r?.items || typeof r.items !== 'object') throw new ShapeError();
    return r.items;
  });
  const priceList = catalog.catch(() => null); // bazaar / display carry their own prices
  const stocksTtl = force ? 0 : STOCKS_TTL;
  const tasks = {
    inventory: async () => inventory(get, await catalog),
    bazaar: async () => v1Items(await get('user/?selections=bazaar', 0), 'bazaar', await priceList, true),
    display: async () => v1Items(await get('user/?selections=display', 0), 'display', await priceList, false),
    itemmarket: async () => itemMarket(get, await catalog),
    stocks: async () => stocks(...(await Promise.all([get('user/?selections=stocks', stocksTtl), get('torn/?selections=stocks', stocksTtl)]))),
  };
  const settled = await Promise.allSettled(PLACES.map((k) => tasks[k]()));
  const places = {};
  PLACES.forEach((k, i) => {
    const s = settled[i];
    const code = s.reason?.code;
    places[k] = s.status === 'fulfilled' ? s.value
      : { ok: false, error: String(s.reason?.message || s.reason), ...(typeof code === 'number' || typeof code === 'string' ? { code } : {}) };
  });
  return { at: now(), places };
}

// How server.js getHoldings uses its cache entry ({ t, data } once loaded, plus { promise } while loading).
// A reply is kept 10 minutes, but only 30 seconds when a place failed in a way that may pass soon (rate limit,
// timeout, Torn down): a refusal for good (access level, a reply we can't read) is not asked again sooner.
// Refresh (force) joins a load in flight and reuses one under 30 seconds old, so pressing it again and again
// does not start another full load of up to 20 Torn calls.
const FULL_TTL = 10 * 60_000;
const SHAKY_TTL = 30_000;
const FORCE_GAP = 30_000;
const STABLE_CODES = new Set([16, 'BAD_SHAPE']);
const shaky = (h) => Object.values(h?.places || {}).some((p) => p && !p.ok && !STABLE_CODES.has(p.code));
function cachePolicy(entry, force, now) {
  if (!force) return { drop: false, ttl: entry?.data !== undefined && shaky(entry.data) ? SHAKY_TTL : FULL_TTL };
  if (entry?.promise) return { drop: false, ttl: 0 }; // the cache answers with the load in flight
  if (entry?.data !== undefined && now - entry.t < FORCE_GAP) return { drop: false, ttl: FORCE_GAP };
  return { drop: true, ttl: FULL_TTL };
}

module.exports = { loadHoldings, cachePolicy, PLACES, PAGE_CAP };
