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
      const stale = ageSec == null || ageSec > STALE_STOCK_SEC;
      const hasData = Boolean(raw && Array.isArray(raw.items) && raw.items.length > 0 && update > 0);

      let candidates = hasData ? raw.items : [];
      if (itemId) candidates = candidates.filter((i) => Number(i.id) === itemId);
      if (itemType && itemType !== 'all') candidates = candidates.filter((i) => i.type === itemType);
      if (query) candidates = candidates.filter((i) => String(i.name || '').toLowerCase().includes(query));

      let bestItem = null;
      let bestTripProfit = 0;
      let bestPerHour = 0;
      for (const it of candidates) {
        const unitNet = (Number(it.market) > 0 ? Math.round(Number(it.market) * 0.95) - (Number(it.cost) || 0) : Number(it.profit) || 0);
        const units = it.qty > 0 ? Math.min(capacity, Number(it.qty)) : capacity;
        const tripProfit = Math.max(0, unitNet) * units;
        const perHour = Math.round(tripProfit / ((oneWayMin * 2) / 60));
        if (!bestItem || perHour > bestPerHour) {
          bestItem = it;
          bestTripProfit = tripProfit;
          bestPerHour = perHour;
        }
      }

      let stockState = 'unknown';
      let stockQty = null;
      if (hasData) {
        if (itemId && bestItem) {
          stockQty = Math.max(0, Number(bestItem.qty) || 0);
          stockState = stockQty > 0 ? 'in_stock' : 'sold_out';
        } else if (!itemId) {
          const totalInStock = candidates.reduce((s, i) => s + Math.max(0, Number(i.qty) || 0), 0);
          stockQty = bestItem ? Math.max(0, Number(bestItem.qty) || 0) : totalInStock;
          stockState = stockQty > 0 ? 'in_stock' : 'sold_out';
        }
      }

      const nextRestockSec = bestItem?.nextRestock || candidates.find((i) => i.nextRestock)?.nextRestock || null;
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

    const forecastPoints = [];
    if (metric === 'forecast' || metric === 'stock') {
      const curQ = Math.max(0, Number(item?.qty) || 0);
      const lastT = points.length ? points[points.length - 1].t : nowSec;
      if (curQ > 0 && Number(item?.rate) > 0) {
        const emptySec = Number(item?.emptyAt) || Math.round(lastT + (curQ / Number(item.rate)) * 60);
        forecastPoints.push({ t: lastT, v: curQ, kind: 'forecast_start' });
        forecastPoints.push({ t: emptySec, v: 0, kind: 'forecast_empty' });
      } else if (curQ === 0 && Number(item?.nextRestock) > nowSec) {
        const peakQ = points.reduce((m, p) => Math.max(m, p.qty), 100) || 100;
        forecastPoints.push({ t: nowSec, v: 0, kind: 'forecast_wait' });
        forecastPoints.push({ t: Number(item.nextRestock), v: peakQ, kind: 'forecast_restock' });
      }
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
      const stale = ageSec == null || ageSec > STALE_STOCK_SEC;

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
        const bestDepartureSec = qty > 0
          ? nowSec
          : (nextRestock ? Math.max(nowSec, nextRestock - oneWayMin * 60) : nowSec);

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
    const total = { outbound: 0, abroad: 0, inbound: 0, unknown: 0 };

    for (const r of Array.isArray(travelRows) ? travelRows : []) {
      const pid = Number(r?.playerId ?? r?.id);
      if (!Number.isInteger(pid) || pid <= 0 || seenPlayers.has(pid)) continue;
      const st = String(r?.travelState ?? r?.state ?? '').toLowerCase();
      if (!st || st === 'none_observed') continue;
      seenPlayers.add(pid);

      const code = String(r?.countryCode ?? (st === 'inbound' ? r?.origin : r?.destination) ?? '').toLowerCase();
      const knownCountry = Boolean(code && byCountry[code]);

      if (st === 'outbound') {
        total.outbound++;
        if (knownCountry) byCountry[code].outbound++;
        else total.unknown++;
      } else if (st === 'abroad') {
        total.abroad++;
        if (knownCountry) byCountry[code].abroad++;
        else total.unknown++;
      } else if (st === 'inbound') {
        total.inbound++;
        if (knownCountry) byCountry[code].inbound++;
        else total.unknown++;
      } else if (st === 'unknown') {
        total.unknown++;
      }
    }

    return {
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

    const series = valid.map((s) => {
      const c = cleanCode !== '*' ? (s.byCountry?.[cleanCode] || { outbound: 0, abroad: 0, inbound: 0 }) : (s.total || { outbound: 0, abroad: 0, inbound: 0 });
      const unknown = Number(s.total?.unknown ?? s.unknown) || 0;
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
      : { outbound: 0, abroad: 0, inbound: 0, unknown: 0, active: 0 };

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
