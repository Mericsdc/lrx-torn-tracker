/* Pure Travel Workspace, Faction Traffic & 24h Clock Dial Engine (N1 & N2 · UMD).
   Powers unified Item / Country / ROI views, Country Cards, 6/12/24/48h Stock/Price/Profit/Forecast
   step-line history series with restock markers and source-change flags, Faction Travel Traffic
   (deduplicated per-snapshot players, separate unknown-route denominator, non-zero outage handling),
   and the 24-hour SVG departure clock dial + pinned-plan validation. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXTravelWorkspace = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const STALE_STOCK_SEC = 30 * 60; // >30 min stock observation is marked stale

  const COUNTRY_META = Object.freeze({
    mex: Object.freeze({ code: 'mex', short: 'MEX', abbr: 'MX', name: 'Mexico', flag: '🇲🇽', color: '#26b880', minutes: 26 }),
    cay: Object.freeze({ code: 'cay', short: 'CAY', abbr: 'KY', name: 'Cayman Islands', flag: '🇰🇾', color: '#4b83db', minutes: 35 }),
    can: Object.freeze({ code: 'can', short: 'CAN', abbr: 'CA', name: 'Canada', flag: '🇨🇦', color: '#e06c75', minutes: 41 }),
    haw: Object.freeze({ code: 'haw', short: 'HAW', abbr: 'HI', name: 'Hawaii', flag: '🇺🇸', color: '#56b6c2', minutes: 134 }),
    uni: Object.freeze({ code: 'uni', short: 'UK', abbr: 'UK', name: 'United Kingdom', flag: '🇬🇧', color: '#61afef', minutes: 159 }),
    arg: Object.freeze({ code: 'arg', short: 'ARG', abbr: 'AR', name: 'Argentina', flag: '🇦🇷', color: '#73b8ff', minutes: 167 }),
    swi: Object.freeze({ code: 'swi', short: 'SWI', abbr: 'CH', name: 'Switzerland', flag: '🇨🇭', color: '#d19a66', minutes: 175 }),
    jap: Object.freeze({ code: 'jap', short: 'JAP', abbr: 'JP', name: 'Japan', flag: '🇯🇵', color: '#e5c07b', minutes: 225 }),
    chi: Object.freeze({ code: 'chi', short: 'CHI', abbr: 'CN', name: 'China', flag: '🇨🇳', color: '#dc4c64', minutes: 242 }),
    uae: Object.freeze({ code: 'uae', short: 'UAE', abbr: 'AE', name: 'UAE', flag: '🇦🇪', color: '#c678dd', minutes: 271 }),
    sou: Object.freeze({ code: 'sou', short: 'SA', abbr: 'ZA', name: 'South Africa', flag: '🇿🇦', color: '#c9a96a', minutes: 297 }),
  });

  const COUNTRY_ORDER = Object.freeze(Object.keys(COUNTRY_META));

  const BLOCK_IDS = Object.freeze(['summary', 'countries', 'traffic', 'history', 'planner', 'destinations']);

  /* Torn City Time is UTC. "HH:MM" for a moment on today's TCT date, "23 Nov HH:MM" otherwise
     (yesterday's flights, tomorrow's restocks, flight-history rows up to 60 days old). */
  const MONTHS = Object.freeze({
    en: Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']),
    tr: Object.freeze(['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']),
  });
  const pad2 = (n) => String(n).padStart(2, '0');
  // Plain "HH:MM" TCT, for places that are always within the next 24 h (dial, timeline axis).
  function tctHm(sec) {
    const s = Number(sec);
    if (!Number.isFinite(s) || s <= 0) return '—';
    const d = new Date(s * 1000);
    return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  }
  function formatTct(sec, { nowSec = Math.floor(Date.now() / 1000), lang = 'en' } = {}) {
    const s = Number(sec);
    if (!Number.isFinite(s) || s <= 0) return '—';
    const d = new Date(s * 1000);
    const hm = tctHm(s);
    if (Math.floor(s / 86400) === Math.floor(Number(nowSec) / 86400)) return hm;
    return `${d.getUTCDate()} ${MONTHS[lang === 'tr' ? 'tr' : 'en'][d.getUTCMonth()]} ${hm}`;
  }

  /* Saved block selection: nothing saved (or unreadable) -> every block; a saved list, even an empty one, is kept. */
  function parseBlockPrefs(raw, defaults = BLOCK_IDS) {
    if (raw == null) return new Set(defaults);
    let list;
    try { list = JSON.parse(raw); } catch { return new Set(defaults); }
    if (!Array.isArray(list)) return new Set(defaults);
    return new Set(list.filter((id) => defaults.includes(id)));
  }

  /* A pinned plan is over once its last flight is back home: its arcs would otherwise reappear at
     the same clock positions the next day with every stop flagged as missed. */
  function pinnedPlanExpired(pinned, nowSec = Math.floor(Date.now() / 1000)) {
    if (!pinned) return false;
    const stops = Array.isArray(pinned.stops) ? pinned.stops : [];
    if (!stops.length) return true;
    return Math.max(...stops.map((s) => Number(s.returnAt) || 0)) < Number(nowSec);
  }

  /* "By Country" view: item rows grouped per country, countries in flight-time order, rows keep the page's sort. */
  function groupRowsByCountry(rows = []) {
    const byCode = new Map();
    for (const r of rows || []) {
      const code = String(r?.c?.code || '').toLowerCase();
      let g = byCode.get(code);
      if (!g) {
        g = { code, name: r?.c?.name || COUNTRY_META[code]?.name || code, oneWay: Number(r?.oneWay) || 0, rows: [], bestPerHour: 0 };
        byCode.set(code, g);
      }
      g.rows.push(r);
      g.bestPerHour = Math.max(g.bestPerHour, Number(r?.perHour) || 0);
    }
    return [...byCode.values()].sort((a, b) => a.oneWay - b.oneWay || a.name.localeCompare(b.name));
  }

  /* Reference price & fee breakdown for Market (-5%), Bazaar (0%), and NPC (0% only when sellPrice > 0).
     Supports both channelBreakdown(cost, market, sellPrice) -> array of channels
     and channelBreakdown(itemObj) -> array of channels. */
  function channelBreakdown(costOrItem, marketArg, sellPriceArg) {
    const isObj = costOrItem && typeof costOrItem === 'object';
    const cost = Math.max(0, Number(isObj ? costOrItem.cost : costOrItem) || 0);
    const market = Math.max(0, Number(isObj ? costOrItem.market : marketArg) || 0);
    const sellPrice = Math.max(0, Number(isObj ? costOrItem.sellPrice : sellPriceArg) || 0);
    const marketFee = Math.round(market * 0.05);
    const marketNet = market > 0 ? (market - marketFee) - cost : null;
    const bazaarNet = market > 0 ? market - cost : null;
    const npcNet = sellPrice > 0 ? sellPrice - cost : null;

    const channels = [
      {
        id: 'market_tax',
        label: ['Item Market (−%5)', 'Item Market (−5%)'],
        grossPrice: market,
        feePct: 5,
        feeAmount: marketFee,
        netPrice: market > 0 ? market - marketFee : 0,
        netProfit: marketNet,
        isReference: true,
      },
      {
        id: 'bazaar',
        label: ['Bazaar (%0)', 'Bazaar (0%)'],
        grossPrice: market,
        feePct: 0,
        feeAmount: 0,
        netPrice: market,
        netProfit: bazaarNet,
        isReference: true,
      },
    ];
    if (sellPrice > 0) {
      channels.push({
        id: 'npc',
        label: ['NPC Dükkânı (%0)', 'NPC Shop (0%)'],
        grossPrice: sellPrice,
        feePct: 0,
        feeAmount: 0,
        netPrice: sellPrice,
        netProfit: npcNet,
        isReference: false,
      });
    }
    return channels;
  }

  function classifyAvailability(item, countryUpdateSec, nowSec, oneWayMinutes) {
    const update = Number(countryUpdateSec) || 0;
    const ageSec = update > 0 ? Math.max(0, Math.round(nowSec - update)) : null;
    const isStale = ageSec == null || ageSec > STALE_STOCK_SEC;
    const qty = item?.qty != null ? Number(item.qty) : null;
    const arriveSec = nowSec + Math.round((Number(oneWayMinutes) || 0) * 60);
    const nextRestock = Number(item?.nextRestock) || null;
    const emptyAt = Number(item?.emptyAt) || null;

    let status = 'unknown';
    if (qty != null && Number.isFinite(qty)) {
      if (qty > 0) {
        if (emptyAt && emptyAt < arriveSec) status = 'risk_before_arrival';
        else status = 'reachable';
      } else if (nextRestock && nextRestock > nowSec - 15 * 60 && nextRestock <= arriveSec + 45 * 60) {
        status = 'restock_soon';
      } else {
        status = 'sold_out';
      }
    }
    return { status, isStale, ageSec, arriveSec, nextRestock, emptyAt };
  }

  function buildItemSummary(countries = [], itemIdOrKey = 0, {
    nowSec = Math.floor(Date.now() / 1000),
  } = {}) {
    const offers = [];
    const targetId = Number(itemIdOrKey);
    const cleanKey = String(itemIdOrKey || '').trim().toLowerCase();

    for (const c of countries || []) {
      for (const it of c.items || []) {
        const match = targetId > 0
          ? Number(it.id) === targetId
          : (!cleanKey || String(it.name || '').toLowerCase().includes(cleanKey));
        if (match) {
          offers.push({ country: c, item: it });
        }
      }
    }
    if (!offers.length) {
      for (const c of countries || []) {
        for (const it of c.items || []) {
          if ((it.profit || 0) > 0) offers.push({ country: c, item: it });
        }
      }
      offers.sort((a, b) => (b.item.profit || 0) - (a.item.profit || 0));
    }
    if (!offers.length) return null;

    const pickedId = Number(offers[0].item.id);
    const sameItemOffers = offers.filter((o) => Number(o.item.id) === pickedId);
    sameItemOffers.sort((a, b) => (Number(a.item.cost) || 0) - (Number(b.item.cost) || 0));
    const best = sameItemOffers[0];
    const it = best.item;
    const c = best.country;
    const channels = channelBreakdown(it.cost, it.market, it.sellPrice);
    const bestUnitNet = Math.max(...channels.map((ch) => ch.netProfit ?? -Infinity));
    const totalStock = sameItemOffers.reduce((sum, o) => sum + Math.max(0, Number(o.item.qty) || 0), 0);
    const latestUpdate = Math.max(0, ...sameItemOffers.map((o) => Number(o.country.update) || 0));

    const hist = Array.isArray(it.history) ? it.history : [];
    const cutoff24 = nowSec - 24 * 3600;
    const recent = hist.filter((p) => Number(p[0]) >= cutoff24);
    let range24h = null;
    if (recent.length >= 1) {
      const costs = recent.map((p) => Number(p[2] ?? it.cost) || Number(it.cost) || 0);
      const qtys = recent.map((p) => Number(p[1]) || 0);
      range24h = {
        minCost: Math.min(...costs),
        maxCost: Math.max(...costs),
        minQty: Math.min(...qtys),
        maxQty: Math.max(...qtys),
        costDelta: costs[costs.length - 1] - costs[0],
      };
    }

    return {
      itemId: Number(it.id),
      name: String(it.name || `#${it.id}`),
      type: String(it.type || ''),
      market: Number(it.market) || 0,
      sellPrice: Number(it.sellPrice) || 0,
      bestOffer: {
        countryCode: c.code,
        countryName: c.name || COUNTRY_META[c.code]?.name || c.code,
        cost: Number(it.cost) || 0,
        qty: Number(it.qty) || 0,
        source: c.source || 'YATA',
      },
      channels,
      bestUnitNet: Number.isFinite(bestUnitNet) ? bestUnitNet : (Number(it.profit) || 0),
      totalStock,
      observedAtSec: latestUpdate || null,
      ageSec: latestUpdate ? Math.max(0, nowSec - latestUpdate) : null,
      stale: latestUpdate ? (nowSec - latestUpdate) > STALE_STOCK_SEC : true,
      range24h,
      offersCount: sameItemOffers.length,
    };
  }

  function buildCountryCards(countries = [], opts = {}) {
    const selectedSet = opts.selectedCountries instanceof Set
      ? opts.selectedCountries
      : new Set(Array.isArray(opts.selectedCountries) ? opts.selectedCountries : []);
    const itemId = Number(opts.itemId ?? opts.selectedItemId) || 0;
    const itemType = opts.itemType || 'all';
    const query = String(opts.query || '').trim().toLowerCase();
    const capacity = Math.max(1, Number(opts.capacity ?? opts.cap) || 15);
    const flightMultiplier = Number(opts.flightMultiplier) || 1;
    const nowSec = Number(opts.nowSec) || Math.floor(Date.now() / 1000);

    const byCode = new Map((countries || []).map((c) => [String(c.code || '').toLowerCase(), c]));
    return COUNTRY_ORDER.map((code) => {
      const meta = COUNTRY_META[code];
      const raw = byCode.get(code);
      const baseMin = Number(raw?.minutes) || meta.minutes;
      const oneWayMin = Math.max(1, Math.round(baseMin * flightMultiplier));
      const update = Number(raw?.update) || 0;
      const ageSec = update > 0 ? Math.max(0, nowSec - update) : null;
      const hasData = Boolean(raw && Array.isArray(raw.items) && raw.items.length > 0 && update > 0);
      // A country with no observation is Unknown only; "stale" is about an old observation.
      const stale = hasData && ageSec > STALE_STOCK_SEC;

      let candidates = hasData ? raw.items : [];
      if (itemId) candidates = candidates.filter((i) => Number(i.id) === itemId);
      if (itemType && itemType !== 'all') candidates = candidates.filter((i) => i.type === itemType);
      if (query) candidates = candidates.filter((i) => String(i.name || '').toLowerCase().includes(query));

      const scored = candidates.map((it) => {
        const unitNet = (Number(it.market) > 0 ? Math.round(Number(it.market) * 0.95) - (Number(it.cost) || 0) : Number(it.profit) || 0);
        const units = it.qty > 0 ? Math.min(capacity, Number(it.qty)) : capacity;
        const tripProfit = Math.max(0, unitNet) * units;
        return { it, unitNet, tripProfit, perHour: Math.round(tripProfit / ((oneWayMin * 2) / 60)) };
      });
      // A focused item is judged on its own. Otherwise only profitable items count, and one you can buy now
      // is shown before a better one that is sold out.
      const pool = itemId ? scored : scored.filter((s) => s.unitNet > 0);
      const inStock = pool.filter((s) => Number(s.it.qty) > 0);
      const pick = (list) => list.reduce((b, s) => (!b || s.perHour > b.perHour ? s : b), null);
      const best = pick(inStock) || pick(pool);
      const bestItem = best?.it || null;
      const bestTripProfit = best?.tripProfit || 0;
      const bestPerHour = best?.perHour || 0;

      let stockState = 'unknown';
      let stockQty = null;
      if (hasData) {
        if (!candidates.length) stockState = 'no_item'; // nothing here matches the item / type / search filter
        else if (!best) stockState = 'no_profit';
        else {
          stockQty = Math.max(0, Number(bestItem.qty) || 0);
          stockState = stockQty > 0 ? 'in_stock' : 'sold_out';
        }
      }

      // Only the shown item's restock (the server sends none for an item in stock).
      const nextRestockSec = bestItem && !(Number(bestItem.qty) > 0) ? (Number(bestItem.nextRestock) || null) : null;
      const restockCountdownSec = nextRestockSec ? (nextRestockSec - nowSec) : null;

      return {
        code,
        name: raw?.name || meta.name,
        short: meta.short,
        abbr: meta.abbr,
        flag: meta.flag,
        color: meta.color,
        oneWayMin,
        oneWayMinutes: oneWayMin,
        selected: selectedSet.has(code),
        source: raw?.source || null,
        observedAtSec: update || null,
        ageSec,
        stale,
        isStale: stale,
        stockState,
        stockQty,
        stockCount: stockQty,
        inStockCount: inStock.length,
        bestItem: bestItem ? {
          id: Number(bestItem.id),
          name: String(bestItem.name || ''),
          cost: Number(bestItem.cost) || 0,
          market: Number(bestItem.market) || 0,
          unitProfit: Number(bestItem.profit) || 0,
          qty: Number(bestItem.qty) || 0,
        } : null,
        bestTripProfit,
        bestPerHour,
        nextRestockSec,
        restockCountdownSec,
        restockSrc: bestItem?.restockSrc || null,
      };
    });
  }

  function buildHistorySeries(item = {}, {
    countryCode = 'mex',
    metric = 'stock',
    windowHours = 24,
    nowSec = Math.floor(Date.now() / 1000),
  } = {}) {
    const hours = [6, 12, 24, 48].includes(Number(windowHours)) ? Number(windowHours) : 24;
    const cutoffSec = nowSec - hours * 3600;
    const rawHistory = Array.isArray(item?.history) ? item.history : [];
    const baseCost = Number(item?.cost) || 0;
    const market = Number(item?.market) || 0;
    const netSell = market > 0 ? Math.round(market * 0.95) : 0;

    const points = [];
    const restockEvents = [];
    const sourceChanges = [];
    let prevQty = null;
    let prevSource = null;

    for (const row of rawHistory) {
      const t = Number(row[0]) || 0;
      if (t < cutoffSec || t > nowSec + 300) continue;
      const q = Math.max(0, Number(row[1]) || 0);
      const cost = Number(row[2]) > 0 ? Number(row[2]) : baseCost;
      const src = String(row[3] || 'YATA');
      const profit = netSell > 0 ? netSell - cost : (Number(item?.profit) || 0);
      const isRestock = prevQty != null && q > prevQty;
      const isSourceChange = prevSource != null && src !== prevSource;

      let v = q;
      if (metric === 'price') v = cost;
      else if (metric === 'profit') v = profit;

      const pt = { t, v, qty: q, cost, profit, source: src, isRestock, isSourceChange };
      points.push(pt);
      if (isRestock) restockEvents.push(pt);
      if (isSourceChange) sourceChanges.push({ t, from: prevSource, to: src });
      prevQty = q;
      prevSource = src;
    }

    // Forecast only in the Forecast view (the Stock view ends at now). Depletion follows the observed sell rate;
    // a restock is drawn only with the last restock size actually observed, never an invented quantity.
    let forecastPoints = [];
    const FORECAST_MAX_SEC = 12 * 3600;
    if (metric === 'forecast') {
      const curQ = Math.max(0, Number(item?.qty) || 0);
      const lastT = points.length ? points[points.length - 1].t : nowSec;
      if (curQ > 0 && Number(item?.rate) > 0) {
        const emptySec = Number(item?.emptyAt) || Math.round(lastT + (curQ / Number(item.rate)) * 60);
        forecastPoints.push({ t: lastT, v: curQ, kind: 'forecast_start' });
        forecastPoints.push({ t: emptySec, v: 0, kind: 'forecast_empty' });
      } else if (curQ === 0 && Number(item?.nextRestock) > nowSec) {
        let prev = null;
        let restockSize = 0;
        for (const row of [...rawHistory].sort((a, b) => Number(a[0]) - Number(b[0]))) {
          const q = Math.max(0, Number(row[1]) || 0);
          if (prev != null && q > prev) restockSize = q;
          prev = q;
        }
        if (restockSize > 0) {
          const rAt = Number(item.nextRestock);
          forecastPoints.push({ t: nowSec, v: 0, kind: 'forecast_wait' });
          forecastPoints.push({ t: rAt, v: 0, kind: 'forecast_wait' });
          forecastPoints.push({ t: rAt, v: restockSize, kind: 'forecast_restock' });
        }
      }
      // A forecast beyond 12 h is cut at the edge (interpolated), never squeezed against it.
      const edge = nowSec + FORECAST_MAX_SEC;
      const clipped = [];
      for (let i = 0; i < forecastPoints.length; i++) {
        const p = forecastPoints[i];
        if (p.t <= edge) { clipped.push(p); continue; }
        const a = forecastPoints[i - 1];
        if (a && a.t < edge) clipped.push({ t: edge, v: a.v + ((p.v - a.v) * (edge - a.t)) / (p.t - a.t), kind: 'forecast_cut' });
        break;
      }
      forecastPoints = clipped.length >= 2 ? clipped : [];
    }

    return {
      countryCode,
      color: COUNTRY_META[countryCode]?.color || '#38bdf8',
      metric,
      windowHours: hours,
      nowSec,
      points,
      restockEvents,
      sourceChanges,
      forecastPoints,
      forecastEndSec: forecastPoints.length ? forecastPoints[forecastPoints.length - 1].t : null,
    };
  }

  function buildDestinationsTable(countries = [], {
    selectedCountries = new Set(),
    itemId = null,
    itemType = 'all',
    query = '',
    availability = 'all',
    capacity = 15,
    flightMultiplier = 1,
    nowSec = Math.floor(Date.now() / 1000),
  } = {}) {
    const selectedSet = selectedCountries instanceof Set ? selectedCountries : new Set(selectedCountries || []);
    const q = String(query || '').trim().toLowerCase();
    const rows = [];

    for (const c of countries || []) {
      const code = String(c.code || '').toLowerCase();
      const meta = COUNTRY_META[code];
      if (!meta) continue;
      if (selectedSet.size && !selectedSet.has(code)) continue;
      const oneWayMin = Math.max(1, Math.round((Number(c.minutes) || meta.minutes) * flightMultiplier));
      const arriveSec = nowSec + oneWayMin * 60;
      const ageSec = c.update ? Math.max(0, nowSec - Number(c.update)) : null;
      // Never observed is "not observed", not "stale" (same rule as the country cards)
      const observed = ageSec != null;
      const stale = observed && ageSec > STALE_STOCK_SEC;

      for (const it of c.items || []) {
        if (itemId && Number(it.id) !== Number(itemId)) continue;
        if (itemType && itemType !== 'all' && it.type !== itemType) continue;
        if (q && !String(it.name || '').toLowerCase().includes(q)) continue;

        const unitNet = Number(it.market) > 0
          ? Math.round(Number(it.market) * 0.95) - (Number(it.cost) || 0)
          : (Number(it.profit) || 0);
        if (unitNet <= 0 && !itemId) continue;

        const qty = Math.max(0, Number(it.qty) || 0);
        const nextRestock = Number(it.nextRestock) || null;
        const emptyAt = Number(it.emptyAt) || null;
        const reachableOnArrival = (qty > 0 && (!emptyAt || emptyAt >= arriveSec))
          || (qty === 0 && nextRestock && nextRestock > nowSec - 900 && nextRestock <= arriveSec);
        const restockSoon = qty === 0 && nextRestock && nextRestock > nowSec - 900 && nextRestock <= nowSec + 3 * 3600;

        if (availability === 'now' && qty <= 0) continue;
        if ((availability === 'reachable' || availability === 'arrival') && !reachableOnArrival) continue;
        if (availability === 'restock_soon' && !restockSoon) continue;

        const units = qty > 0 ? Math.min(capacity, qty) : capacity;
        const modeledTripProfit = Math.max(0, unitNet) * units;
        const perHour = Math.round(modeledTripProfit / ((oneWayMin * 2) / 60));
        // Sold out with no known restock: there is no departure time to suggest
        const bestDepartureSec = qty > 0
          ? nowSec
          : (nextRestock ? Math.max(nowSec, nextRestock - oneWayMin * 60) : null);

        rows.push({
          key: `${code}:${it.id}`,
          countryCode: code,
          countryName: c.name || meta.name,
          flag: meta.flag,
          color: meta.color,
          itemId: Number(it.id),
          itemName: String(it.name || ''),
          itemType: String(it.type || ''),
          oneWayMin,
          qty,
          observed,
          stale,
          restockWindowSec: nextRestock,
          restockSrc: it.restockSrc || null,
          bestDepartureSec,
          unitNetProfit: unitNet,
          modeledTripProfit,
          perHour,
          units,
          profitKind: 'modeled',
        });
      }
    }

    rows.sort((a, b) => b.perHour - a.perHour || b.modeledTripProfit - a.modeledTripProfit);
    return rows;
  }

  /* ---------- N2: Faction Travel Traffic (Deduplicated, Non-Zero Gaps, Separate Unknown) ---------- */
  function buildTrafficSnapshot(travelRows = [], observedAtMs = Date.now()) {
    const seenPlayers = new Set();
    const byCountry = {};
    for (const code of COUNTRY_ORDER) {
      byCountry[code] = { outbound: 0, abroad: 0, inbound: 0 };
    }
    // Each member counts once: unknown = an unreadable route only. An inbound member whose origin is not known
    // is Inbound (counted in All routes) but in no country; `unattributed` says how many such members there are.
    const total = { outbound: 0, abroad: 0, inbound: 0, unknown: 0, unattributed: 0 };

    for (const r of Array.isArray(travelRows) ? travelRows : []) {
      const pid = Number(r?.playerId ?? r?.id);
      if (!Number.isInteger(pid) || pid <= 0 || seenPlayers.has(pid)) continue;
      const st = String(r?.travelState ?? r?.state ?? '').toLowerCase();
      if (!st || st === 'none_observed') continue;
      seenPlayers.add(pid);

      const code = String(r?.countryCode ?? (st === 'inbound' ? r?.origin : r?.destination) ?? '').toLowerCase();
      const knownCountry = Boolean(code && byCountry[code]);

      if (st === 'outbound' || st === 'abroad' || st === 'inbound') {
        total[st]++;
        if (knownCountry) byCountry[code][st]++;
        else total.unattributed++;
      } else if (st === 'unknown') {
        total.unknown++;
      }
    }

    return {
      v: 2,
      at: Number(observedAtMs) || Date.now(),
      observedAt: new Date(Number(observedAtMs) || Date.now()).toISOString(),
      total,
      byCountry,
    };
  }

  function summarizeTraffic(snapshots = [], {
    countryCode = '*',
    windowHours = 24,
    nowMs = Date.now(),
    restockEvents = [],
  } = {}) {
    const hours = [6, 12, 24].includes(Number(windowHours)) ? Number(windowHours) : 24;
    const fromMs = nowMs - hours * 3600_000;
    const cleanCode = countryCode && countryCode !== '*' && countryCode !== 'all'
      ? String(countryCode).toLowerCase()
      : '*';

    const valid = (Array.isArray(snapshots) ? snapshots : [])
      .filter((s) => s && Number(s.at) >= fromMs && Number(s.at) <= nowMs + 60_000)
      .sort((a, b) => a.at - b.at);

    // Snapshots saved before v2 also counted every member without a known country as unknown; that share is
    // exactly the total minus the per-country counts, so it is taken back out.
    const unknownOf = (s) => {
      const raw = Number(s.total?.unknown ?? s.unknown) || 0;
      if (Number(s.v) >= 2 || !s.total || !s.byCountry) return raw;
      let unattributed = 0;
      for (const k of ['outbound', 'abroad', 'inbound']) {
        const inCountries = Object.values(s.byCountry).reduce((sum, c) => sum + (Number(c?.[k]) || 0), 0);
        unattributed += Math.max(0, (Number(s.total[k]) || 0) - inCountries);
      }
      return Math.max(0, raw - unattributed);
    };
    const series = valid.map((s) => {
      const c = cleanCode !== '*' ? (s.byCountry?.[cleanCode] || { outbound: 0, abroad: 0, inbound: 0 }) : (s.total || { outbound: 0, abroad: 0, inbound: 0 });
      // An unknown route belongs to no country: a single-country view has no Unknown count.
      const unknown = cleanCode === '*' ? unknownOf(s) : null;
      const outbound = Number(c.outbound) || 0;
      const abroad = Number(c.abroad) || 0;
      const inbound = Number(c.inbound) || 0;
      const active = outbound + abroad + inbound;
      return {
        at: Number(s.at),
        observedAt: s.observedAt || new Date(Number(s.at)).toISOString(),
        outbound,
        abroad,
        inbound,
        unknown,
        active,
      };
    });

    // Split into contiguous segments (>25m gap breaks segment so missing slots are never drawn as zero)
    const GAP_MS = 25 * 60_000;
    const segments = [];
    let curSeg = [];
    for (let i = 0; i < series.length; i++) {
      if (i > 0 && (series[i].at - series[i - 1].at) > GAP_MS) {
        if (curSeg.length) segments.push(curSeg);
        curSeg = [];
      }
      curSeg.push(series[i]);
    }
    if (curSeg.length) segments.push(curSeg);

    const sampleCount = series.length;
    const expectedSlots = Math.max(1, Math.round((hours * 60) / 5));
    const coveragePct = Math.min(100, Math.round((sampleCount / expectedSlots) * 100));

    const latest = sampleCount
      ? series[sampleCount - 1]
      : { outbound: 0, abroad: 0, inbound: 0, unknown: cleanCode === '*' ? 0 : null, active: 0 };

    const periodDelta = sampleCount >= 2
      ? (series[sampleCount - 1].active - series[0].active)
      : null;

    const average = sampleCount
      ? Math.round((series.reduce((s, p) => s + p.active, 0) / sampleCount) * 10) / 10
      : 0;

    let peak = { value: 0, at: null, tct: null };
    for (const p of series) {
      if (p.active > peak.value) {
        const d = new Date(p.at);
        const tct = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
        peak = { value: p.active, at: p.at, tct };
      }
    }

    const uniqueRestocks = new Set();
    for (const ev of Array.isArray(restockEvents) ? restockEvents : []) {
      const tsMs = (Number(ev?.t ?? ev?.ts ?? ev) || 0) * 1000;
      const src = String(ev?.source || 'YATA');
      if (tsMs >= fromMs && tsMs <= nowMs + 60_000) {
        const slot = Math.floor(tsMs / (15 * 60_000));
        uniqueRestocks.add(`${src}:${slot}`);
      }
    }

    return {
      countryCode: cleanCode,
      windowHours: hours,
      fromMs,
      toMs: nowMs,
      latest,
      periodDelta,
      average,
      peak,
      sampleCount,
      expectedSlots,
      coveragePct,
      restockCount: uniqueRestocks.size,
      series,
      segments,
    };
  }

  /* Traffic chart geometry: a step line per contiguous segment and a dot for a lone sample
     (a one-point "M x,y" path draws nothing). */
  function buildTrafficChart(tf, { W = 680, H = 140, padL = 34, padR = 12, padT = 12, padB = 22 } = {}) {
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const series = Array.isArray(tf?.series) ? tf.series : [];
    const maxV = Math.max(4, ...series.map((s) => Number(s.active) || 0));
    const minT = Number(tf?.fromMs) || 0;
    const spanT = Math.max(1, (Number(tf?.toMs) || 0) - minT);
    const xOf = (ms) => Math.max(padL, Math.min(padL + plotW, padL + ((ms - minT) / spanT) * plotW));
    const yOf = (v) => padT + plotH - (Math.min(maxV, Math.max(0, Number(v) || 0)) / maxV) * plotH;
    const paths = [];
    const dots = [];
    for (const seg of Array.isArray(tf?.segments) ? tf.segments : []) {
      if (!seg.length) continue;
      if (seg.length === 1) {
        dots.push({ x: Number(xOf(seg[0].at).toFixed(1)), y: Number(yOf(seg[0].active).toFixed(1)), at: seg[0].at, active: seg[0].active });
        continue;
      }
      let d = '';
      for (let i = 0; i < seg.length; i++) {
        const x = xOf(seg[i].at).toFixed(1);
        const y = yOf(seg[i].active).toFixed(1);
        if (i === 0) d += `M${x},${y}`;
        else d += ` L${x},${yOf(seg[i - 1].active).toFixed(1)} L${x},${y}`;
      }
      paths.push(d);
    }
    return { W, H, padL, padR, padT, padB, plotW, plotH, maxV, paths, dots };
  }

  /* ---------- N2: 24-Hour Clock Dial & Pinned Plan Validator ---------- */
  function secToDialDeg(sec) {
    const s = ((Number(sec) || 0) % 86400 + 86400) % 86400;
    return (s / 86400) * 360;
  }

  function buildClockDial(plan, {
    nowSec = Math.floor(Date.now() / 1000),
    selectedIndex = null,
  } = {}) {
    const stops = Array.isArray(plan?.stops) ? plan.stops : [];
    const nowDeg = secToDialDeg(nowSec);
    const arcs = stops.map((s, idx) => {
      const code = String(s.countryCode || '').toLowerCase();
      const color = s.meta?.color || COUNTRY_META[code]?.color || '#38bdf8';
      const startDeg = secToDialDeg(s.departAt);
      const landDeg = secToDialDeg(s.arriveAt);
      const endDeg = secToDialDeg(s.returnAt);
      return {
        index: idx,
        key: s.key,
        countryCode: code,
        countryName: s.countryName,
        itemName: s.itemName,
        color,
        departAt: s.departAt,
        arriveAt: s.arriveAt,
        returnAt: s.returnAt,
        profit: s.profit,
        carry: s.carry,
        units: s.units,
        startDeg,
        landDeg,
        endDeg,
        selected: selectedIndex != null && Number(selectedIndex) === idx,
      };
    });

    const hourMarks = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      deg: (h / 24) * 360,
      label: `${String(h).padStart(2, '0')}:00`,
      major: h % 6 === 0,
    }));

    return {
      nowSec,
      nowDeg,
      radius: 86,
      cx: 120,
      cy: 120,
      hourMarks,
      arcs,
    };
  }

  function evaluatePinnedPlan(pinnedPlan, countries = [], {
    nowSec = Math.floor(Date.now() / 1000),
  } = {}) {
    if (!pinnedPlan || !Array.isArray(pinnedPlan.stops)) return null;
    const byCode = new Map((countries || []).map((c) => [String(c.code || '').toLowerCase(), c]));
    const stops = pinnedPlan.stops.map((s, idx) => {
      const c = byCode.get(String(s.countryCode || '').toLowerCase());
      const it = c?.items?.find((i) => Number(i.id) === Number(s.itemId));
      const warnings = [];
      if (nowSec > Number(s.departAt) + 5 * 60) {
        warnings.push({
          code: 'missed_departure',
          label: ['Kalkış penceresi kaçırıldı', 'Departure window missed'],
        });
      }
      if (c && c.update && (nowSec - Number(c.update)) > STALE_STOCK_SEC) {
        warnings.push({
          code: 'stale_stock',
          label: ['Stok gözlemi eski (>30 dk)', 'Stock reading is stale (>30m)'],
        });
      }
      if (it && Number(it.qty) <= 0 && (!it.nextRestock || Number(it.nextRestock) > Number(s.arriveAt))) {
        warnings.push({
          code: 'stock_depleted',
          label: ['Stok tükendi / restock tahmini belirsizleşti', 'Stock depleted / restock estimate uncertain'],
        });
      }
      return {
        ...s,
        index: idx,
        status: warnings.length ? 'warning' : 'ok',
        warnings,
      };
    });
    const warningCount = stops.filter((s) => s.warnings.length > 0).length;
    return {
      pinnedAt: pinnedPlan.pinnedAt || null,
      stops,
      warningCount,
      hasWarnings: warningCount > 0,
    };
  }

  return Object.freeze({
    STALE_STOCK_SEC,
    COUNTRY_META,
    COUNTRY_ORDER,
    BLOCK_IDS,
    tctHm,
    formatTct,
    parseBlockPrefs,
    pinnedPlanExpired,
    groupRowsByCountry,
    buildTrafficChart,
    channelBreakdown,
    classifyAvailability,
    buildItemSummary,
    buildCountryCards,
    buildHistorySeries,
    buildDestinationsTable,
    buildTrafficSnapshot,
    summarizeTraffic,
    secToDialDeg,
    buildClockDial,
    evaluatePinnedPlan,
  });
});
