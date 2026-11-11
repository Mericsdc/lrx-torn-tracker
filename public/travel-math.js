(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXTravelMath = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function tripMetrics(unitProfit, capacity, quantity, oneWay, delay = 0, costs = 0) {
    const units = quantity > 0 ? Math.min(capacity, quantity) : capacity;
    const trip = units * unitProfit - costs, round = 2 * oneWay + delay;
    return { units, trip, round, perHour: round > 0 ? trip / (round / 60) : 0 };
  }
  return Object.freeze({ tripMetrics });
});
