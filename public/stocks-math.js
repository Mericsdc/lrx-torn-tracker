/* Pure Torn Stock Market ROI & Portfolio engine (UMD: browser global + Node/Vitest require).
   Uses official Torn stock benefit structures, live item/points pricing for item dividends,
   doubling-increment math for stackable active benefits, and 0.1% sell-fee adjusted P/L. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXStocksMath = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const SELL_FEE = 0.001; // Torn charges 0.1% when selling shares

  // Official Torn Stock Benefit payout metadata keyed by acronym.
  // Cash payouts are exact; item/points payouts are priced live from Torn API items & stats.
  const PAYOUT_MAP = {
    CNC: { kind: 'cash', amount: 80_000_000, freq: 31 },
    TSB: { kind: 'cash', amount: 50_000_000, freq: 31 },
    TMI: { kind: 'cash', amount: 25_000_000, freq: 31 },
    IOU: { kind: 'cash', amount: 12_000_000, freq: 31 },
    GRN: { kind: 'cash', amount: 4_000_000, freq: 31 },
    TCT: { kind: 'cash', amount: 1_000_000, freq: 31 },
    ASS: { kind: 'item', itemName: 'Six-Pack of Alcohol', qty: 1, freq: 7 },
    EWM: { kind: 'item', itemName: 'Box of Grenades', qty: 1, freq: 7 },
    FHG: { kind: 'item', itemName: 'Feathery Hotel Coupon', qty: 1, freq: 7 },
    LAG: { kind: 'item', itemName: 'Lawyer Business Card', qty: 1, freq: 7 },
    LSC: { kind: 'item', itemName: 'Lottery Voucher', qty: 1, freq: 7 },
    MUN: { kind: 'item', itemName: 'Six-Pack of Energy Drink', qty: 1, freq: 7 },
    PRN: { kind: 'item', itemName: 'Erotic DVD', qty: 1, freq: 7 },
    SYM: { kind: 'item', itemName: 'Drug Pack', qty: 1, freq: 7 },
    TCC: { kind: 'item', itemName: 'Clothing Cache', qty: 1, freq: 31 },
    THS: { kind: 'item', itemName: 'Box of Medical Supplies', qty: 1, freq: 7 },
    PTS: { kind: 'points', qty: 100, freq: 7 },
  };

  // Active benefit increments double each level: cumulative shares for N increments = req * (2^N - 1).
  function benefitProgress(totalShares, requirement, type) {
    const shares = Math.max(0, Number(totalShares) || 0);
    const req = Number(requirement) || 0;
    if (!(req > 0)) return { blocks: 0, nextShares: 0, nextIncrementShares: 0, progressPct: 0, excessShares: 0 };
    if (String(type || '').toLowerCase() === 'active') {
      if (shares < req) {
        return { blocks: 0, nextShares: req - shares, nextIncrementShares: req, progressPct: (shares / req) * 100, excessShares: 0 };
      }
      const blocks = Math.floor(Math.log2(shares / req + 1));
      const cumulative = req * (Math.pow(2, blocks) - 1);
      const banked = shares - cumulative;
      const nextIncrementShares = req * Math.pow(2, blocks);
      return {
        blocks,
        nextShares: Math.max(0, nextIncrementShares - banked),
        nextIncrementShares,
        progressPct: nextIncrementShares > 0 ? Math.min(100, (banked / nextIncrementShares) * 100) : 0,
        excessShares: banked,
      };
    }
    const owned = shares >= req;
    return {
      blocks: owned ? 1 : 0,
      nextShares: owned ? 0 : req - shares,
      nextIncrementShares: owned ? 0 : req,
      progressPct: owned ? 100 : (shares / req) * 100,
      excessShares: owned ? shares - req : 0,
    };
  }

  function resolvePayoutValue(acronym, itemPriceByName = {}, pointsPrice = 0) {
    const spec = PAYOUT_MAP[String(acronym || '').toUpperCase()];
    if (!spec) return null;
    if (spec.kind === 'cash') return { payoutValue: spec.amount, freq: spec.freq, source: 'cash' };
    if (spec.kind === 'points') {
      const pp = Number(pointsPrice) || 0;
      return pp > 0 ? { payoutValue: spec.qty * pp, freq: spec.freq, source: 'points' } : null;
    }
    if (spec.kind === 'item') {
      const p = Number(itemPriceByName[spec.itemName.toLowerCase()]) || 0;
      return p > 0 ? { payoutValue: spec.qty * p, freq: spec.freq, source: 'item', itemName: spec.itemName } : null;
    }
    return null;
  }

  function holdingSummary(userStock, currentPrice) {
    if (!userStock) return null;
    const shares = Number(userStock.total_shares ?? userStock.shares) || 0;
    if (!(shares > 0)) return null;
    let costBasis = 0;
    let txShares = 0;
    const txs = userStock.transactions ? Object.values(userStock.transactions) : [];
    for (const tx of txs) {
      const s = Number(tx.shares) || 0;
      const bp = Number(tx.bought_price) || 0;
      if (s > 0 && bp > 0) { costBasis += s * bp; txShares += s; }
    }
    if (!txShares && Number(userStock.bought_price) > 0) {
      txShares = shares;
      costBasis = shares * Number(userStock.bought_price);
    }
    const avgBuy = txShares > 0 ? costBasis / txShares : null;
    const value = shares * currentPrice;
    const netSellValue = value * (1 - SELL_FEE);
    const pnl = avgBuy != null ? netSellValue - shares * avgBuy : null;
    const pnlPct = avgBuy != null && avgBuy > 0 ? (pnl / (shares * avgBuy)) * 100 : null;
    const div = userStock.dividend || null;
    return {
      shares,
      avgBuy,
      value,
      pnl,
      pnlPct,
      dividendReady: Boolean(div && Number(div.ready) === 1),
      dividendProgress: div?.progress ?? null,
      dividendFrequency: div?.frequency ?? null,
      dividendIncrement: div?.increment ?? null,
    };
  }

  function rangeStats(currentPrice, snapshots) {
    const list = Array.isArray(snapshots) ? snapshots : [];
    let low = currentPrice, high = currentPrice;
    for (const s of list) {
      const lo = Number(s.low ?? s.price ?? s.close);
      const hi = Number(s.high ?? s.price ?? s.close);
      if (lo > 0 && lo < low) low = lo;
      if (hi > 0 && hi > high) high = hi;
    }
    const span = high - low;
    const posPct = span > 0 ? ((currentPrice - low) / span) * 100 : 50;
    return { low, high, days: list.length, posPct };
  }

  function analyzeStocks({
    stocks = {},
    userStocks = {},
    itemPriceByName = {},
    pointsPrice = 0,
    bankAprs = null,
    priceHistory = {},
  } = {}) {
    const byId = {};
    for (const [k, u] of Object.entries(userStocks || {})) {
      const sid = String(u?.stock_id ?? k);
      byId[sid] = u;
    }
    const itemsLow = {};
    for (const [name, price] of Object.entries(itemPriceByName || {})) {
      itemsLow[String(name).toLowerCase()] = Number(price) || 0;
    }

    const rows = [];
    for (const [id, s] of Object.entries(stocks || {})) {
      const price = Number(s.current_price) || 0;
      const acronym = String(s.acronym || '');
      const benefit = s.benefit || null;
      const req = Number(benefit?.requirement) || 0;
      const bType = String(benefit?.type || '').toLowerCase() || null;
      const freq = Number(benefit?.frequency) || PAYOUT_MAP[acronym]?.freq || null;
      const blockCost = req > 0 && price > 0 ? req * price : null;

      const resolved = resolvePayoutValue(acronym, itemsLow, pointsPrice);
      const payoutFreq = freq || resolved?.freq || null;
      const annualPerBlock = resolved && payoutFreq > 0 ? resolved.payoutValue * (365 / payoutFreq) : null;
      const roiPct = annualPerBlock != null && blockCost > 0 ? (annualPerBlock / blockCost) * 100 : null;

      const holding = holdingSummary(byId[String(s.stock_id ?? id)], price);
      const progress = benefitProgress(holding?.shares || 0, req, bType);
      const nextCost = progress.nextShares > 0 && price > 0 ? progress.nextShares * price : 0;
      const nextIncrementCost = progress.nextIncrementShares > 0 && price > 0 ? progress.nextIncrementShares * price : null;
      const marginalRoiPct = annualPerBlock != null && nextIncrementCost > 0 ? (annualPerBlock / nextIncrementCost) * 100 : null;
      const ownedAnnual = annualPerBlock != null && progress.blocks > 0 ? annualPerBlock * progress.blocks : 0;

      const hist = rangeStats(price, priceHistory[String(s.stock_id ?? id)] || priceHistory[acronym] || []);

      rows.push({
        id: Number(s.stock_id ?? id) || id,
        acronym,
        name: String(s.name || acronym),
        price,
        marketCap: Number(s.market_cap) || 0,
        totalShares: Number(s.total_shares) || 0,
        investors: Number(s.investors) || 0,
        benefit: benefit ? {
          type: bType,
          requirement: req,
          frequency: payoutFreq,
          description: String(benefit.description || ''),
        } : null,
        blockCost,
        payoutValue: resolved?.payoutValue ?? null,
        payoutSource: resolved?.source ?? null,
        annualPerBlock,
        roiPct,
        marginalRoiPct,
        holding,
        progress,
        nextCost,
        ownedAnnual,
        range: hist,
      });
    }

    const portfolioValue = rows.reduce((a, r) => a + (r.holding?.value || 0), 0);
    const portfolioPnlKnown = rows.some((r) => r.holding?.pnl != null);
    const portfolioPnl = portfolioPnlKnown ? rows.reduce((a, r) => a + (r.holding?.pnl || 0), 0) : null;
    const annualDividends = rows.reduce((a, r) => a + r.ownedAnnual, 0);
    const readyDividends = rows.filter((r) => r.holding?.dividendReady).length;
    const bestRoi = rows.filter((r) => r.roiPct != null).sort((a, b) => b.roiPct - a.roiPct)[0] || null;
    const bestBankApr = bankAprs ? Math.max(0, ...Object.values(bankAprs).map((v) => Number(v) || 0)) : null;

    return {
      rows,
      summary: {
        totalStocks: rows.length,
        ownedCount: rows.filter((r) => r.holding).length,
        portfolioValue,
        portfolioPnl,
        annualDividends,
        readyDividends,
        bestRoi: bestRoi ? { acronym: bestRoi.acronym, roiPct: bestRoi.roiPct, blockCost: bestRoi.blockCost } : null,
        bestBankApr,
      },
    };
  }

  return Object.freeze({
    SELL_FEE,
    PAYOUT_MAP: Object.freeze(PAYOUT_MAP),
    benefitProgress,
    resolvePayoutValue,
    holdingSummary,
    analyzeStocks,
  });
});
