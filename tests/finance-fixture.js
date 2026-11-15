// Synthetic data for the Finance page smoke (tests/finance-ui-smoke.js). Invented numbers only: no player, company or
// Torn data. Shapes follow getNetworth() and buildCompanyReport() in src/server/server.js.
const { stockCompany, DEFAULT_ROWS } = require('./stock-fixture');

const DAY = 86400_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// One networth record per day for `count` days ending on `now`'s date, every part included, plus a part the app
// does not know yet ("newthing") and a negative one (loan).
function networthData({ now = Date.now(), count = 40 } = {}) {
  const history = [];
  for (let i = count - 1; i >= 0; i--) {
    const k = count - 1 - i; // 0 = oldest
    const parts = {
      wallet: 4_000_000 + (k % 5) * 250_000,
      bank: 1_000_000_000 + k * 1_500_000,
      cayman: 0, vault: 50_000_000, piggybank: 0,
      points: 20_000_000, items: 560_000_000 + k * 1_000_000 + (k % 3) * 2_000_000,
      displaycase: 0, bazaar: 0, itemmarket: 0, trade: 0, auctionhouse: 0,
      stockmarket: 380_000_000 + k * 2_000_000 - (k % 4 === 0 ? 9_000_000 : 0),
      properties: 250_000_000, company: 100_000_000, enlistedcars: 0, bookie: 0,
      pending: 0, loan: -25_000_000, unpaidfees: 0, newthing: k > 30 ? 1_000_000 : 0,
    };
    const total = Object.values(parts).reduce((a, v) => a + v, 0);
    history.push({ date: iso(now - i * DAY), ...parts, total, at: now - i * DAY });
  }
  const { date, at, ...current } = history[history.length - 1];
  return { current, timestamp: Math.floor(now / 1000), history };
}

// stockCompany() plus `count` company day records ending on `now`'s date, with per-product sales and funds.
function financeCompany({ now = Date.now(), count = 40, name } = {}) {
  const c = stockCompany({ now, ...(name ? { name } : {}) });
  const days = [];
  for (let i = count - 1; i >= 0; i--) {
    const k = count - 1 - i;
    const products = Object.fromEntries(DEFAULT_ROWS.map(([pname, price], j) => {
      const sold = 900 + ((k + j) % 7) * 60;
      return [pname, { sold, worth: sold * price }];
    }));
    const revenue = Object.values(products).reduce((a, p) => a + p.worth, 0);
    const cogs = Math.round(revenue * 0.42), wages = c.income.wages, ads = c.income.ads;
    days.push({
      date: iso(now - i * DAY), capturedAt: now - i * DAY, revenue, customers: 8000 + k * 15, cogs, cogsEstimated: k < 5,
      wages, ads, net: revenue - cogs - wages - ads, funds: 40_000_000 + k * 120_000, popularity: 80 + (k % 10), products,
    });
  }
  return { ...c, days };
}

module.exports = { networthData, financeCompany, DEFAULT_ROWS };
