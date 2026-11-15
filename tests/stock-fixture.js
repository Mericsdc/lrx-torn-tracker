// Synthetic company report for the Stock Status page, shaped like buildCompanyReport() in src/server/server.js.
// Only invented numbers: no player, company or Torn data.
const HOUR = 3600_000;

// [name, price, rrp, cost, in_stock, on_order, avgDaily, delivery] — delivery: minutes to arrival, 'torn' for a
// "Delivered in" timer read from Torn's stock page, or null for no order.
const DEFAULT_ROWS = [
  ['Bra', 41, 64, 21, 22789, 33100, 16825, 28],
  ['Thong', 37, 48, 10, 8110, 12400, 6423, 28],
  ['Corset', 85, 125, 40, 3152, 5000, 2545, 28],
  ['Knickers', 11, 20, 4, 14342, 22600, 11388, 28],
  ['Stockings', 19, 30, 8, 4277, 0, 3100, null],
  ['Suspenders', 64, 95, 30, 900, 8800, 1350, 'torn'],
];

function stockCompany({ now = Date.now(), rows = DEFAULT_ROWS, coverDays = 3, space = 200000, mode = 'hours', name = 'Fixture Lingerie' } = {}) {
  const nextResetMs = now + 2 * HOUR + 48 * 60_000;
  const seenAt = now - 5 * 60_000;
  let products = rows.map(([pname, price, rrp, cost, inStock, onOrder, avgDaily, delivery]) => {
    const daysLeft = avgDaily > 0 ? inStock / avgDaily : null;
    const daysLeftWithOrder = avgDaily > 0 ? (inStock + onOrder) / avgDaily : null;
    const hoursLeft = daysLeft != null ? daysLeft * 24 : null;
    const hoursLeftWithOrder = daysLeftWithOrder != null ? daysLeftWithOrder * 24 : null;
    const target = Math.ceil(avgDaily * coverDays);
    let need = Math.max(0, target - inStock - onOrder);
    if (need > 0) need = Math.ceil(need / 100) * 100;
    let status = 'ok';
    if (daysLeft != null && daysLeft < 1) status = 'critical';
    else if (daysLeftWithOrder != null && daysLeftWithOrder < coverDays) status = 'low';
    else if (daysLeftWithOrder != null && daysLeftWithOrder > coverDays * 2.5) status = 'over';
    const safe = (etaMs) => (hoursLeft == null ? true : hoursLeft * HOUR > etaMs - now);
    let orderDelivery = null;
    if (onOrder > 0 && delivery === 'torn') {
      const etaMs = now + 3 * HOUR + 12 * 60_000;
      orderDelivery = { amount: onOrder, shipments: 1, orderedAt: null, exact: true, source: 'torn', seenAt, etaMs, nextResetMs, cycleTotalMs: 6 * HOUR, mode: 'torn', deliveryHours: 6, safeUntilDelivery: safe(etaMs) };
    } else if (onOrder > 0) {
      const etaMs = mode === '18tct' ? nextResetMs : now + Number(delivery) * 60_000;
      orderDelivery = { amount: onOrder, orderedAt: etaMs - 6 * HOUR, exact: false, source: 'estimate', etaMs, nextResetMs, cycleTotalMs: mode === '18tct' ? 24 * HOUR : 6 * HOUR, mode, deliveryHours: 6, learned: false, safeUntilDelivery: safe(etaMs) };
    }
    const soldAmount = avgDaily, soldWorth = avgDaily * price, cogs = soldAmount * cost, profit = soldWorth - cogs;
    return {
      name: pname, price, rrp, cost, in_stock: inStock, on_order: onOrder, sold_amount: soldAmount, sold_worth: soldWorth,
      avgDaily, samples: 7, avgPrice: price, cogs, profit, margin: soldWorth ? profit / soldWorth : 0,
      daysLeft, daysLeftWithOrder, hoursLeft, hoursLeftWithOrder, target, need, status, orderDelivery,
    };
  });
  products = products.map((p) => ({ ...p, orderCost: p.need * p.cost }));
  const used = products.reduce((a, p) => a + p.in_stock + p.on_order, 0);
  const totals = products.reduce((a, x) => {
    a.sold += x.sold_amount; a.revenue += x.sold_worth; a.cogs += x.cogs; a.profit += x.profit;
    a.inStock += x.in_stock; a.onOrder += x.on_order; a.need += x.need; a.orderCost += x.orderCost;
    return a;
  }, { sold: 0, revenue: 0, cogs: 0, profit: 0, inStock: 0, onOrder: 0, need: 0, orderCost: 0 });
  const ads = 800000, wages = 450000;
  return {
    fetchedAt: now, nextResetMs, coverDays, deliveryHours: 6, deliveryMode: mode, estDeliveryHours: 6, deliveriesSeenAt: seenAt,
    company: { id: 1, name, type: 1, rating: 7, daysOld: 400, hired: 8, capacity: 10, dailyIncome: totals.revenue, dailyCustomers: 9000,
      weeklyIncome: totals.revenue * 7, weeklyCustomers: 63000, funds: 44100000, popularity: 90, efficiency: 95, environment: 80, trains: 3, ads, value: 1e9, upgrades: {} },
    storage: { space, used, free: space != null ? Math.max(0, space - used) : null, limited: false },
    products, totals, employees: [],
    income: { revenue: totals.revenue, cogs: totals.cogs, wages, ads, net: totals.revenue - totals.cogs - wages - ads, weeklyRevenue: totals.revenue * 7, weeklyAvg: totals.revenue, customers: 9000, weeklyCustomers: 63000 },
    days: [],
  };
}

module.exports = { stockCompany, DEFAULT_ROWS };
