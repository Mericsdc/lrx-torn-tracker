/* Pure Travel Departure Planner engine (UMD: browser global + Node/Vitest require).
   Builds a non-overlapping 24-hour itinerary from live abroad stock & restock forecasts,
   calculates cash requirements/shortages, and supports Item Market (-5% tax), Bazaar (0%)
   and NPC shop pricing modes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXTravelPlanner = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const METHODS = { Standard: 1, Airstrip: 0.7, WLT: 0.5, Business: 0.3 };
  const PRICE_MODES = ['market_tax', 'market', 'npc'];
  const OPTIMIZE_MODES = ['max_profit', 'max_per_hour', 'short_flights'];
  const MARKET_TAX = 0.05;
  const HIGH_CARRY_WARN = 5_000_000;

  const COUNTRY_META = {
    mex: { flag: '🇲🇽', abbr: 'MX', color: '#2ea86f' },
    cay: { flag: '🇰🇾', abbr: 'KY', color: '#4b83db' },
    can: { flag: '🇨🇦', abbr: 'CA', color: '#dc4c64' },
    haw: { flag: '🇺🇸', abbr: 'HI', color: '#3ea4c9' },
    uni: { flag: '🇬🇧', abbr: 'UK', color: '#5c7ce6' },
    arg: { flag: '🇦🇷', abbr: 'AR', color: '#5bb3e6' },
    swi: { flag: '🇨🇭', abbr: 'CH', color: '#e05263' },
    jap: { flag: '🇯🇵', abbr: 'JP', color: '#e66376' },
    chi: { flag: '🇨🇳', abbr: 'CN', color: '#d9534f' },
    uae: { flag: '🇦🇪', abbr: 'AE', color: '#38a169' },
    sou: { flag: '🇿🇦', abbr: 'ZA', color: '#d99b26' },
  };

  function unitProfit(item, priceMode = 'market_tax') {
    const cost = Number(item?.cost) || 0;
    const market = Number(item?.market) || 0;
    const sellPrice = Number(item?.sellPrice) || 0;
    if (priceMode === 'npc') {
      if (!(sellPrice > 0)) return null;
      return sellPrice - cost;
    }
    if (!(market > 0)) return null;
    if (priceMode === 'market') return market - cost;
    return Math.round(market * (1 - MARKET_TAX)) - cost;
  }

  function detectTravelProfile(perksObj, travelObj) {
    const perkLists = [
      ...(perksObj?.job_perks || []),
      ...(perksObj?.property_perks || []),
      ...(perksObj?.stock_perks || []),
      ...(perksObj?.merit_perks || []),
      ...(perksObj?.education_perks || []),
      ...(perksObj?.enhancer_perks || []),
      ...(perksObj?.company_perks || []),
      ...(perksObj?.faction_perks || []),
      ...(perksObj?.book_perks || []),
    ].map(String);

    let bonus = 0;
    let hasPerks = perkLists.length > 0;
    let method = null;
    for (const p of perkLists) {
      const m = p.match(/(?:increase[sd]?\s+(?:maximum\s+)?travel(?:\s+item)?\s+capacity\s+by|\+)\s*(\d+)\s*(?:travel(?:\s+item)?(?:\s+capacity)?|items?\s+while\s+traveling)/i)
        || p.match(/\+\s*(\d+)\s+travel\s+item\s+capacity/i)
        || p.match(/travel\s+item\s+capacity\s+by\s+(\d+)/i);
      if (m) bonus += Number(m[1]) || 0;
      if (/business\s+class|free\s+business\s+class/i.test(p)) method = 'Business';
      else if (/private\s+jet/i.test(p) && method !== 'Business') method = 'WLT';
      else if (/airstrip/i.test(p) && !method) method = 'Airstrip';
    }
    const rawMethod = String(travelObj?.method || '');
    if (/business/i.test(rawMethod)) method = 'Business';
    else if (/private/i.test(rawMethod) && method !== 'Business') method = 'WLT';
    else if (/airstrip/i.test(rawMethod) && !method) method = 'Airstrip';
    else if (!method && rawMethod) method = 'Standard';

    return {
      // Base capacity is 5; suitcases live in inventory (not perks), so detectedCap reflects base + perks.
      // When a suitcase isn't in perks, players with Large Suitcase (+4) may have higher cap; we note both.
      detectedBaseCap: hasPerks ? 5 + bonus : null,
      detectedMethod: method,
    };
  }

  function nextUtcMidnight(sec) {
    const d = new Date(sec * 1000);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0) / 1000);
  }

  function countryByName(countries, name) {
    if (!name) return null;
    const low = String(name).trim().toLowerCase();
    return (countries || []).find((c) => {
      const cn = String(c.name || '').toLowerCase();
      return cn === low || (low === 'uk' && c.code === 'uni') || (low === 'dubai' && c.code === 'uae');
    }) || null;
  }

  function buildDeparturePlan({
    countries = [],
    nowSec = Math.floor(Date.now() / 1000),
    cap = 15,
    method = 'Standard',
    wallet = null,
    trip = null,
    priceMode = 'market_tax',
    optimizeFor = 'max_profit',
    category = 'all',
    watchSet = null,
    watchOnly = false,
    excludedKeys = null,
    includeCurrentFlight = true,
    groundMinutes = 2,
    horizonHours = 24,
  } = {}) {
    const mult = METHODS[method] || 1;
    const safeCap = Math.max(1, Math.min(100, Number(cap) || 15));
    const groundSec = Math.max(0, Number(groundMinutes) || 0) * 60;
    const excluded = excludedKeys instanceof Set ? excludedKeys : new Set(excludedKeys || []);
    const watched = watchSet instanceof Set ? watchSet : new Set(watchSet || []);

    // Determine whether player is currently in flight and when they'll be back in Torn
    let inFlight = false;
    let backHomeAt = nowSec;
    let currentFlight = null;
    if (trip && Number(trip.timeLeft) > 0) {
      inFlight = true;
      const dest = String(trip.destination || '');
      const returning = dest.toLowerCase() === 'torn' || dest.toLowerCase() === 'torn city';
      const legLeft = Number(trip.timeLeft) || 0;
      const destCountry = returning ? null : countryByName(countries, dest);
      const returnLeg = returning ? 0 : (destCountry?.minutes ? Math.round(destCountry.minutes * mult * 60) : 0);
      const arrivalAt = nowSec + legLeft;
      backHomeAt = returning ? arrivalAt : arrivalAt + returnLeg + groundSec;
      currentFlight = {
        destination: dest || 'Torn',
        returning,
        arrivalAt,
        backHomeAt,
        countryCode: destCountry?.code || null,
      };
    }

    const planStart = inFlight && includeCurrentFlight ? backHomeAt + 60 : nowSec;
    const horizonEnd = nowSec + horizonHours * 3600;
    const midnight = nextUtcMidnight(nowSec);

    // Flatten eligible items
    const pool = [];
    for (const c of countries || []) {
      if (!c?.minutes) continue;
      const oneWaySec = Math.round(c.minutes * mult * 60);
      const roundSec = oneWaySec * 2;
      for (const it of c.items || []) {
        const key = `${c.code}:${it.id}`;
        if (excluded.has(key)) continue;
        if (watchOnly && !watched.has(key)) continue;
        if (category && category !== 'all' && String(it.type || '').toLowerCase() !== String(category).toLowerCase()) continue;
        const prof = unitProfit(it, priceMode);
        if (prof == null || prof <= 0) continue;
        pool.push({ c, it, key, oneWaySec, roundSec, unitProfit: prof });
      }
    }

    const stops = [];
    let cursor = planStart;
    // Track how many units of each currently-in-stock item we've already consumed in earlier planned stops
    const consumedNow = new Map();
    const MAX_STOPS = 16;

    for (let step = 0; step < MAX_STOPS && cursor < horizonEnd; step++) {
      let best = null;
      for (const cand of pool) {
        const { c, it, key, oneWaySec, roundSec } = cand;
        if (optimizeFor === 'short_flights' && oneWaySec > 95 * 60) continue;

        const used = consumedNow.get(key) || 0;
        const remainingQty = Math.max(0, (Number(it.qty) || 0) - used);
        const interval = Number(it.interval) > 900 ? Number(it.interval) : 7200;

        let departAt = cursor;
        let mode = 'stock';
        let units = safeCap;
        let expectedRestockAt = null;

        // Option A: Buy from currently visible stock (only meaningful near `now` while stock lasts)
        const arriveNow = cursor + oneWaySec;
        const stockSurvives = remainingQty >= Math.min(safeCap, 5)
          && (!it.emptyAt || it.emptyAt > arriveNow)
          && (arriveNow - nowSec <= 4 * 3600);

        if (stockSurvives) {
          units = Math.min(safeCap, remainingQty);
          departAt = cursor;
          mode = 'stock';
        } else {
          // Option B: Target a predicted restock (nextRestock or stepped by observed interval)
          let rAt = Number(it.nextRestock) || 0;
          if (!rAt && Number(it.lastRestock) > 0 && Number(it.interval) > 900) {
            rAt = Number(it.lastRestock) + Number(it.interval);
          }
          if (!rAt) continue;
          while (rAt - oneWaySec < cursor - 180) rAt += interval;
          // Avoid excessively long idle waits (> 90 min) if other flights exist
          const waitSec = Math.max(0, (rAt - oneWaySec) - cursor);
          if (waitSec > 95 * 60) continue;
          departAt = Math.max(cursor, rAt - oneWaySec);
          expectedRestockAt = rAt;
          mode = 'restock';
          units = safeCap;
        }

        const arriveAt = departAt + oneWaySec;
        const returnAt = departAt + roundSec + groundSec;
        if (departAt >= horizonEnd) continue;

        const waitSec = Math.max(0, departAt - cursor);
        const totalWindowSec = (returnAt - cursor);
        const profit = units * cand.unitProfit;
        const carry = units * (Number(it.cost) || 0);
        const perHourFlying = roundSec > 0 ? profit / (roundSec / 3600) : 0;
        const effectivePerHour = totalWindowSec > 0 ? profit / (totalWindowSec / 3600) : 0;

        let score;
        if (optimizeFor === 'max_per_hour') {
          score = perHourFlying - (waitSec / 3600) * (perHourFlying * 0.25);
        } else if (optimizeFor === 'short_flights') {
          score = effectivePerHour * (1 + Math.max(0, (90 * 60 - oneWaySec) / (180 * 60)));
        } else {
          // Max $: maximize profit earned per total clock hour (wait + flight) so 24h cumulative $ is maximized
          score = effectivePerHour;
        }

        if (!best || score > best.score) {
          best = {
            score,
            key,
            countryCode: c.code,
            countryName: c.name,
            meta: COUNTRY_META[c.code] || { flag: '✈', abbr: c.code.toUpperCase().slice(0, 2), color: '#8fa3b8' },
            itemId: it.id,
            itemName: it.name,
            itemType: it.type || '',
            mode,
            departAt,
            arriveAt,
            returnAt,
            oneWaySec,
            roundSec,
            waitSec,
            expectedRestockAt,
            units,
            unitCost: Number(it.cost) || 0,
            unitProfit: cand.unitProfit,
            profit,
            carry,
            perHourFlying,
            afterMidnight: arriveAt >= midnight,
            highCarryRisk: carry >= HIGH_CARRY_WARN,
          };
        }
      }

      if (!best) break;
      stops.push(best);
      if (best.mode === 'stock') consumedNow.set(best.key, (consumedNow.get(best.key) || 0) + best.units);
      cursor = best.returnAt;
    }

    const todayStops = stops.filter((s) => !s.afterMidnight);
    const afterStops = stops.filter((s) => s.afterMidnight);
    const todayProfit = todayStops.reduce((a, s) => a + s.profit, 0);
    const afterMidnightProfit = afterStops.reduce((a, s) => a + s.profit, 0);
    const totalProfit = todayProfit + afterMidnightProfit;
    const totalFlightSec = stops.reduce((a, s) => a + s.roundSec, 0);
    const perHourWhileFlying = totalFlightSec > 0 ? totalProfit / (totalFlightSec / 3600) : 0;
    const biggestCarryStop = stops.reduce((best, s) => (!best || s.carry > best.carry ? s : best), null);
    const nextFlight = stops[0] || null;
    const walletNum = wallet != null && Number.isFinite(Number(wallet)) ? Number(wallet) : null;
    const shortOf = (amount) => (walletNum != null && amount > walletNum ? amount - walletNum : 0);

    return {
      nowSec,
      planStart,
      horizonEnd,
      midnight,
      cap: safeCap,
      method,
      priceMode,
      optimizeFor,
      wallet: walletNum,
      inFlight,
      currentFlight,
      eligibleCount: pool.length,
      stops,
      nextFlight: nextFlight ? { ...nextFlight, cashShort: shortOf(nextFlight.carry) } : null,
      biggestCarry: biggestCarryStop ? { ...biggestCarryStop, cashShort: shortOf(biggestCarryStop.carry) } : null,
      summary: {
        todayProfit,
        afterMidnightProfit,
        totalProfit,
        todayCount: todayStops.length,
        afterMidnightCount: afterStops.length,
        totalCount: stops.length,
        totalFlightSec,
        perHourWhileFlying,
      },
    };
  }

  return Object.freeze({
    METHODS: Object.freeze(METHODS),
    PRICE_MODES: Object.freeze(PRICE_MODES),
    OPTIMIZE_MODES: Object.freeze(OPTIMIZE_MODES),
    COUNTRY_META: Object.freeze(COUNTRY_META),
    HIGH_CARRY_WARN,
    unitProfit,
    detectTravelProfile,
    buildDeparturePlan,
  });
});
