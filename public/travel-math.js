(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXTravelMath = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function tripMetrics(unitProfit, capacity, quantity, oneWay, delay = 0, costs = 0) {
    const units = quantity > 0 ? Math.min(capacity, quantity) : capacity;
    const trip = units * unitProfit - costs, round = 2 * oneWay + delay;
    return { units, trip, round, perHour: round > 0 ? trip / (round / 60) : 0 };
  }
  // A price typed by the player. Torn prices are whole dollars: "830.000", "830,000" and "830 000" are thousands
  // separators, "830k" / "1.5m" / "2b" are suffixes. Anything else is NaN: never a silently smaller number.
  // A suffix after exactly three decimals ("1,500k", "2.500m") could be either a decimal or a grouped number, so it is NaN too.
  function parsePrice(text) {
    const t = String(text ?? '').trim().toLowerCase().replace(/^\$\s*/, '');
    const suffix = /^(\d+(?:[.,](\d+))?)\s*([kmb])$/.exec(t);
    if (suffix) return suffix[2]?.length === 3 ? NaN : Math.round(Number(suffix[1].replace(',', '.')) * { k: 1e3, m: 1e6, b: 1e9 }[suffix[3]]);
    if (/^\d{1,3}(?:[.,\s]\d{3})+$/.test(t)) return Number(t.replace(/[.,\s]/g, ''));
    return /^\d+$/.test(t) ? Number(t) : NaN;
  }
  return Object.freeze({ tripMetrics, parsePrice });
});
