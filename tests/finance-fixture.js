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

// /api/holdings (src/server/holdings.js shape): 31 priced inventory rows (one name with markup) + 2 without a market
// value, a $5B bazaar that is 80 % Xanax (Xanax also sits in the inventory), a display case, an item market the key
// may not read, and two stocks.
function holdingsData({ now = Date.now() } = {}) {
  const row = (id, name, type, qty, unit, listed) => ({ id, name, type, qty, unit, value: qty * unit, ...(listed != null ? { listed } : {}) });
  const place = (rows, extra = {}) => ({ ok: true, total: rows.reduce((a, r) => a + r.value, 0), rows: rows.sort((a, b) => b.value - a.value), ...extra });
  const inventory = Array.from({ length: 29 }, (_, i) => row(1000 + i, `Item ${String(i + 1).padStart(2, '0')}`, 'Other', i + 1, 10_000 * (30 - i)));
  inventory.push(row(206, 'Xanax', 'Drug', 10, 1_000_000), row(2002, '<b>Bold</b> Plushie', 'Plushie', 2, 5_000), row(2000, 'Dozen Roses', 'Flower', 3, 0), row(2001, 'Old Newspaper', 'Other', 1, 0));
  return {
    at: now,
    places: {
      inventory: place(inventory, { tornAt: Math.floor(now / 1000) - 300 }),
      bazaar: place([row(206, 'Xanax', 'Drug', 4_000, 1_000_000, 1_050_000), row(370, 'Feathery Hotel Coupon', 'Special', 12, 25_000_000, 26_000_000), row(186, 'Sheep Plushie', 'Plushie', 100, 7_000_000, 7_100_000)]),
      display: place([row(500, 'Rare Painting', 'Collectible', 1, 150_000_000)]),
      itemmarket: { ok: false, error: 'Torn API: Access level of this key is not high enough' },
      stocks: place([row('s25', 'Torn City Investments (TCI)', 'Stock', 1_000, 1_200.5), row('s1', 'Torn & Shanghai Banking (TSB)', 'Stock', 2_000_000, 1_000)]),
    },
  };
}

// /api/holdings `split` (src/server/holdings-days.js) against holdingsData(): records 20 and 3 days before `now`
// (none yesterday, so 1D has no start). Since then: 1,000 / 2,000 Xanax left the bazaar at a lower price, Item 01 went
// from 6 to 1, TCI rose from 1,100 to 1,200.5, and a box sold out that is only named in `names` (markup on purpose).
function holdingsSplit({ now = Date.now() } = {}) {
  const cur = holdingsData({ now }).places, nw = networthData({ now }).history;
  const rows = (p) => Object.fromEntries(p.rows.filter((r) => r.qty > 0).map((r) => [r.id, [r.qty, r.unit]]));
  const names = {};
  for (const p of Object.values(cur)) for (const r of p.rows || []) names[r.id] = [r.name, r.type];
  names[3001] = ['<i>Gone</i> Box', 'Other'];
  const rec = (daysAgo, xanax) => ({
    date: iso(now - daysAgo * DAY), at: now - daysAgo * DAY, nw: nw[nw.length - 1 - daysAgo].total,
    places: {
      inventory: { ...rows(cur.inventory), 1000: [6, 300_000], 3001: [4, 2_000_000] },
      bazaar: { ...rows(cur.bazaar), 206: xanax },
      display: rows(cur.display),
      stocks: { ...rows(cur.stocks), s25: [1000, 1100] },
    },
  });
  return { today: iso(now), starts: [rec(20, [6000, 1_020_000]), rec(3, [5000, 1_010_000])], names };
}

module.exports = { networthData, financeCompany, holdingsData, holdingsSplit, DEFAULT_ROWS };
