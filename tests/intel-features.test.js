const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const travelPlanner = require('../public/travel-planner');
const stocksMath = require('../public/stocks-math');
const warPayout = require('../public/war-payout');
const companyAdvisor = require('../public/company-advisor');
const factionTools = require('../public/faction-tools');

/* =========================================================
   1. Regressions: page.php Attack URL & OC Missing Item -> Armory Utilities
   ========================================================= */
test('regression: Torn Attack and Merit links use page.php, never retired loader.php', () => {
  for (const rel of ['torn-helpers/war-helper.js', 'public/merit-guide.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.equal(src.includes('loader.php'), false, `${rel} must not contain retired loader.php`);
  }
  const warHelper = fs.readFileSync(path.join(__dirname, '..', 'torn-helpers/war-helper.js'), 'utf8');
  assert.ok(warHelper.includes('page.php?sid=attack&user2ID='), 'war-helper builds page.php attack link');
  const meritGuide = fs.readFileSync(path.join(__dirname, '..', 'public/merit-guide.js'), 'utf8');
  assert.ok(meritGuide.includes('page.php?sid=missions'), 'merit-guide uses page.php?sid=missions');
  assert.ok(meritGuide.includes('page.php?sid=racing'), 'merit-guide uses page.php?sid=racing');
});

test('regression: OC Missing Item rows and badges open Faction Armory Utilities', () => {
  const facJs = fs.readFileSync(path.join(__dirname, '..', 'public/faction.js'), 'utf8');
  assert.ok(facJs.includes('factions.php?step=your#/tab=armoury&start=0&sub=utilities'), 'faction.js defines Armory Utilities URL');
  assert.ok(facJs.includes('fac-armory-row'), 'Ongoing OCs rows with missing items use fac-armory-row');
  assert.ok(facJs.includes('fac-armory-link'), 'Own OC missing item badge uses fac-armory-link');
});

/* =========================================================
   2. Travel Departure Planner (public/travel-planner.js)
   ========================================================= */
test('travel planner: unitProfit handles market_tax (-5%), market (0%), and npc (0%)', () => {
  const item = { cost: 1000, market: 10000, sellPrice: 2500 };
  assert.equal(travelPlanner.unitProfit(item, 'market_tax'), 8500);
  assert.equal(travelPlanner.unitProfit(item, 'market'), 9000);
  assert.equal(travelPlanner.unitProfit(item, 'npc'), 1500);
  assert.equal(travelPlanner.unitProfit({ cost: 1000, market: 10000, sellPrice: 0 }, 'npc'), null);
});

test('travel planner: detectTravelProfile extracts capacity perks and flight method', () => {
  const prof = travelPlanner.detectTravelProfile({
    property_perks: ['+10 travel item capacity', 'Access to airstrip'],
    faction_perks: ['+5 travel item capacity'],
    job_perks: ['+2 travel item capacity'],
  }, { method: 'Airstrip' });
  assert.equal(prof.detectedBaseCap, 22); // 5 base + 10 + 5 + 2
  assert.equal(prof.detectedMethod, 'Airstrip');

  const wlt = travelPlanner.detectTravelProfile({ stock_perks: ['Access to a Private Jet'] }, {});
  assert.equal(wlt.detectedMethod, 'WLT');
});

test('travel planner: 24h itinerary schedules non-overlapping stops, in-flight delay, cash shortage, and exclusions', () => {
  const nowSec = Date.UTC(2026, 10, 22, 18, 0, 0) / 1000; // 18:00 UTC -> midnight in 6h
  const countries = [
    {
      code: 'sou', name: 'South Africa', minutes: 297,
      items: [{ id: 206, name: 'Xanax', type: 'Drug', cost: 750000, market: 840000, sellPrice: 0, qty: 100, nextRestock: nowSec + 3600, interval: 7200 }],
    },
    {
      code: 'uni', name: 'United Kingdom', minutes: 159,
      items: [{ id: 266, name: 'Nessie Plushie', type: 'Plushie', cost: 200, market: 48000, sellPrice: 100, qty: 500, nextRestock: nowSec + 1800, interval: 3600 }],
    },
    {
      code: 'mex', name: 'Mexico', minutes: 26,
      items: [{ id: 258, name: 'Jaguar Plushie', type: 'Plushie', cost: 10, market: 18000, sellPrice: 10, qty: 300, nextRestock: nowSec + 900, interval: 1800 }],
    },
  ];

  // Normal plan starting now with wallet smaller than Xanax carry
  const plan = travelPlanner.buildDeparturePlan({
    countries, nowSec, cap: 20, method: 'Airstrip', wallet: 1_000_000,
    priceMode: 'market_tax', optimizeFor: 'max_profit',
  });
  assert.ok(plan.stops.length >= 2, 'schedules multiple stops across 24h');
  for (let i = 1; i < plan.stops.length; i++) {
    assert.ok(plan.stops[i].departAt >= plan.stops[i - 1].returnAt, 'stops never overlap');
  }
  assert.equal(plan.summary.totalProfit, plan.summary.todayProfit + plan.summary.afterMidnightProfit);
  assert.ok(plan.summary.todayProfit > 0 && plan.summary.afterMidnightProfit > 0, 'splits today and after midnight');

  // Verify high-carry & cashShort on Xanax when prioritized
  const drugPlan = travelPlanner.buildDeparturePlan({
    countries, nowSec, cap: 20, method: 'Airstrip', wallet: 1_000_000,
    category: 'Drug', priceMode: 'market',
  });
  assert.equal(drugPlan.nextFlight.itemName, 'Xanax');
  assert.equal(drugPlan.nextFlight.carry, 15_000_000);
  assert.equal(drugPlan.nextFlight.cashShort, 14_000_000);
  assert.equal(drugPlan.nextFlight.highCarryRisk, true);

  // In-flight player: plan waits until back home
  const flightPlan = travelPlanner.buildDeparturePlan({
    countries, nowSec, cap: 20, method: 'Airstrip',
    trip: { destination: 'Torn', timeLeft: 1800 },
    includeCurrentFlight: true,
  });
  assert.equal(flightPlan.inFlight, true);
  assert.ok(flightPlan.nextFlight.departAt >= nowSec + 1860, 'first stop departs after current flight lands');

  // Excluding top item removes it from itinerary
  const excluded = new Set([plan.nextFlight.key]);
  const alt = travelPlanner.buildDeparturePlan({ countries, nowSec, cap: 20, method: 'Airstrip', excludedKeys: excluded });
  assert.ok(alt.stops.every((s) => s.key !== plan.nextFlight.key), 'excluded item never appears');
});

/* =========================================================
   3. Stock Market ROI & Portfolio (public/stocks-math.js)
   ========================================================= */
test('stocks math: doubling active increments, live dividend ROI, marginal ROI, and 0.1% sell-fee P/L', () => {
  // Active doubling: req = 500_000 -> 1 block = 500k, 2 blocks = 1.5M, 3 blocks = 3.5M
  assert.deepEqual(
    [0, 250_000, 500_000, 1_499_999, 1_500_000, 3_500_000].map((s) => stocksMath.benefitProgress(s, 500_000, 'active').blocks),
    [0, 0, 1, 1, 2, 3],
  );
  const p1 = stocksMath.benefitProgress(500_000, 500_000, 'active');
  assert.equal(p1.nextIncrementShares, 1_000_000);
  assert.equal(p1.nextShares, 1_000_000);

  // Passive: single threshold
  const pass = stocksMath.benefitProgress(5_000_000, 1_000_000, 'passive');
  assert.equal(pass.blocks, 1);
  assert.equal(pass.nextShares, 0);

  const out = stocksMath.analyzeStocks({
    stocks: {
      1: { stock_id: 1, acronym: 'SYM', name: 'Symbiotic Ltd.', current_price: 700, benefit: { type: 'active', frequency: 7, requirement: 500_000, description: '1x Drug Pack' } },
      2: { stock_id: 2, acronym: 'TSB', name: 'Torn City Bank', current_price: 1000, benefit: { type: 'active', frequency: 31, requirement: 3_000_000, description: '$50,000,000' } },
      3: { stock_id: 3, acronym: 'PTS', name: 'Points Stock', current_price: 50, benefit: { type: 'active', frequency: 7, requirement: 10_000_000, description: '100 points' } },
    },
    userStocks: {
      1: { stock_id: 1, total_shares: 500_000, transactions: { t1: { shares: 500_000, bought_price: 600 } }, dividend: { ready: 1 } },
    },
    itemPriceByName: { 'drug pack': 4_200_000 },
    pointsPrice: 45_000,
    bankAprs: { '3m': 78.5 },
    priceHistory: { 1: [{ low: 650, high: 750, close: 700 }, { low: 680, high: 720, close: 700 }] },
  });

  const sym = out.rows.find((r) => r.acronym === 'SYM');
  assert.equal(sym.blockCost, 350_000_000);
  assert.equal(sym.payoutValue, 4_200_000);
  assert.ok(Math.abs(sym.roiPct - ((4_200_000 * (365 / 7)) / 350_000_000) * 100) < 0.01);
  // With 1 block owned, next increment costs 2x -> marginal ROI is half of Block #1 ROI
  assert.ok(Math.abs(sym.marginalRoiPct - sym.roiPct / 2) < 0.01);
  // Net sell value = 350M * 0.999 = 349,650,000; cost basis = 300M -> P/L = +49,650,000
  assert.equal(sym.holding.pnl, 49_650_000);
  assert.equal(sym.holding.dividendReady, true);
  assert.equal(sym.range.posPct, 50);

  const pts = out.rows.find((r) => r.acronym === 'PTS');
  assert.equal(pts.payoutValue, 4_500_000);
  assert.equal(out.summary.readyDividends, 1);
  assert.equal(out.summary.bestBankApr, 78.5);
});

/* =========================================================
   4. Ranked War Payout Planner & CSV Export (public/war-payout.js)
   ========================================================= */
test('war payout: pool split, minHits, cap overflow redistribution, bank links, and CSV formula protection', () => {
  const members = [
    { id: 101, name: '=HYPERLINK("evil")', level: 80, attacks: 50, score: 300 },
    { id: 102, name: 'Bob, Jr.', level: 60, attacks: 20, score: 100 },
    { id: 103, name: 'Cara', level: 45, attacks: 10, score: 50 },
    { id: 104, name: 'LowHits', level: 30, attacks: 1, score: 5 },
  ];
  // 100M pool, 10% faction cut -> 90M distributable; maxCap 50M caps player 101 and redistributes overflow to 102 & 103
  const res = warPayout.calculatePayouts(members, {
    mode: 'pool', totalPool: 100_000_000, factionCutPct: 10, respectWeightPct: 70, minHits: 2, maxCap: 50_000_000,
  });
  assert.equal(res.summary.factionCut, 10_000_000);
  assert.equal(res.summary.distributable, 90_000_000);
  assert.equal(res.summary.qualifiedCount, 3);
  assert.equal(res.summary.cappedCount, 1);
  assert.ok(Math.abs(res.summary.totalPaid - 90_000_000) <= 2, 'overflow redistributed so full distributable pool is paid');

  const top = res.rows.find((r) => r.id === 101);
  assert.equal(top.payout, 50_000_000);
  assert.equal(top.capped, true);
  assert.equal(top.payUrl, 'https://www.torn.com/factions.php?step=your#/tab=controls&addMoneyTo=101&money=50000000');

  const low = res.rows.find((r) => r.id === 104);
  assert.equal(low.qualified, false);
  assert.equal(low.payout, 0);
  assert.equal(low.payUrl, null);

  // Fixed mode
  const fixed = warPayout.calculatePayouts(members, { mode: 'fixed', perHit: 1_000_000, perRespect: 100_000, minHits: 2, maxCap: 60_000_000 });
  assert.equal(fixed.rows.find((r) => r.id === 101).payout, 60_000_000); // 50M + 30M capped at 60M
  assert.equal(fixed.rows.find((r) => r.id === 102).payout, 30_000_000); // 20M + 10M

  // CSV export: UTF-8 BOM, formula-injection neutralized with leading apostrophe, commas quoted
  const csv = warPayout.toCsv(res, { warTitle: 'War #5555' });
  assert.ok(csv.startsWith('\uFEFF# War #5555\r\n'));
  assert.ok(csv.includes(`"'=HYPERLINK(""evil"")"`), 'formula injection neutralized and quotes doubled');
  assert.ok(csv.includes('"Bob, Jr."'), 'commas properly CSV-quoted');
});

/* =========================================================
   5. Company Position Advisor (public/company-advisor.js)
   ========================================================= */
test('company advisor: Torn log2 working-stat formula, BUS2110 boost, and optimal Hungarian matching', () => {
  const pos = { man_required: 10000, int_required: 5000, end_required: 0 };
  // At exact requirements: 45 + 45 = 90
  assert.equal(companyAdvisor.workStatEfficiency({ manual_labor: 10000, intelligence: 5000, endurance: 0 }, pos), 90);
  // At 2x both stats: (45+5) + (45+5) = 100
  assert.equal(companyAdvisor.workStatEfficiency({ manual_labor: 20000, intelligence: 10000, endurance: 0 }, pos), 100);
  // BUS2110 (+20%): boosts stats before formula
  const baseHalf = companyAdvisor.workStatEfficiency({ manual_labor: 5000, intelligence: 2500, endurance: 0 }, pos, { directorEduBonus: false });
  const busHalf = companyAdvisor.workStatEfficiency({ manual_labor: 5000, intelligence: 2500, endurance: 0 }, pos, { directorEduBonus: true });
  assert.equal(baseHalf, 45);
  assert.equal(busHalf, 54);

  // Hungarian finds globally optimal swap
  const positions = {
    'Tech Lead': { man_required: 0, int_required: 20000, end_required: 10000 },
    'Guard': { man_required: 20000, int_required: 0, end_required: 10000 },
  };
  const employees = [
    { id: 1, name: 'Brawn', position: 'Tech Lead', manual_labor: 40000, intelligence: 1000, endurance: 20000 },
    { id: 2, name: 'Brain', position: 'Guard', manual_labor: 1000, intelligence: 40000, endurance: 20000 },
  ];
  const opt = companyAdvisor.optimizeStaff(employees, positions);
  assert.equal(opt.assignments.find((a) => a.id === 1).recommendedPosition, 'Guard');
  assert.equal(opt.assignments.find((a) => a.id === 2).recommendedPosition, 'Tech Lead');
  assert.equal(opt.moves.length, 2);
  assert.ok(opt.gain > 60, `expected large gain, got ${opt.gain}`);

  // Already optimal produces zero pointless swaps
  const already = companyAdvisor.optimizeStaff(
    employees.map((e) => ({ ...e, position: e.id === 1 ? 'Guard' : 'Tech Lead' })),
    positions,
  );
  assert.equal(already.moves.length, 0);
  assert.equal(already.gain, 0);
});

/* =========================================================
   6. Faction Intel Tools (public/faction-tools.js)
   ========================================================= */
test('faction tools: armory HTML stripping, 7x24 heatmap, chain milestones, and 1x/2x/4x upgrade multipliers', () => {
  const arm = factionTools.parseArmoryNews([
    { id: '1', timestamp: 200, text: '<a href="profiles.php?XID=42">Alice</a> used one of the faction&apos;s First Aid Kit items' },
    { id: '2', timestamp: 300, text: '<a href="profiles.php?XID=99">Bob</a> loaned a ArmaLite M-15A4 to <a href="profiles.php?XID=42">Alice</a>' },
    { id: '3', timestamp: 100, text: '<a href="profiles.php?XID=42">Alice</a> filled one of the faction&apos;s Empty Blood Bag items' },
  ]);
  assert.equal(arm.entries.length, 3);
  assert.equal(arm.entries[0].category, 'loaned'); // newest first
  assert.equal(arm.entries[1].actorId, 42);
  assert.equal(arm.entries[1].text.includes('<'), false, 'HTML tags stripped');
  assert.ok(arm.entries[1].text.includes("faction's"), 'HTML entities decoded');
  assert.equal(arm.counts.used, 1);
  assert.equal(arm.counts.loaned, 1);
  assert.equal(arm.counts.filled, 1);
  assert.equal(arm.topActors[0].name, 'Alice');
  assert.equal(arm.topActors[0].total, 2);

  const hm = factionTools.buildActivityHeatmap({
    '1:18': { samples: 4, onlineSum: 40, idleSum: 8, totalSum: 100 },
    '1:5': { samples: 2, onlineSum: 4, idleSum: 2, totalSum: 50 },
  });
  assert.equal(hm.grid.length, 7);
  assert.equal(hm.grid[0].length, 24);
  assert.equal(hm.peakHour.hour, 18);
  assert.equal(hm.quietHour.hour, 5);
  assert.equal(hm.totalSamples, 6);

  const ch = factionTools.summarizeChains([
    { id: 1, chain: 1000, respect: 4200, start: 1000, end: 5000 },
    { id: 2, chain: 250, respect: 800, start: 6000, end: 7200 },
  ]);
  assert.equal(ch[0].id, 2); // newest first
  assert.equal(ch[0].milestone, 250);
  assert.equal(ch[1].milestone, 1000);
  assert.equal(ch[1].respectPerHit, 4.2);

  // Upgrade Simulator: Core=1x; active non-core sorted descending -> 1x, 2x, 4x
  const tree = factionTools.normalizeFactionTree({
    1: { 1: { branch: 'Core', name: 'Capacity', level: 1, base_cost: 5000, ability: '+2' } },
    2: { 1: { branch: 'Steadfast', name: 'Strength', level: 1, base_cost: 10000, ability: '+1%' } },
    3: { 1: { branch: 'Toleration', name: 'Overdose', level: 1, base_cost: 20000, ability: '-3%' } },
    4: { 1: { branch: 'Voracity', name: 'Candy', level: 1, base_cost: 4000, ability: '+1' } },
  });
  const sim = factionTools.simulateUpgrades(tree, {
    'Core::Capacity': 1,        // Core: 5000 * 1 = 5000
    'Toleration::Overdose': 1,  // #1 (highest base 20k): 20000 * 1 = 20000
    'Steadfast::Strength': 1,   // #2 (base 10k): 10000 * 2 = 20000
    'Voracity::Candy': 1,       // #3 (base 4k): 4000 * 4 = 16000
  }, 50000);
  assert.equal(sim.activeNonCoreCount, 3);
  assert.equal(sim.totalRespectCost, 61000);
  assert.equal(sim.remainingRespect, -11000);
  assert.equal(sim.affordable, false);
  const byB = Object.fromEntries(sim.breakdown.map((b) => [b.branch, b]));
  assert.equal(byB.Core.multiplier, 1);
  assert.equal(byB.Toleration.multiplier, 1);
  assert.equal(byB.Steadfast.multiplier, 2);
  assert.equal(byB.Voracity.multiplier, 4);
});

/* =========================================================
   7. Server API Integration Tests (all new endpoints)
   ========================================================= */
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-intel-tests-'));
process.env.TORN_DATA_DIR = temp;
process.env.TORN_API_KEY = 'TestKey123456789';
const realFetch = global.fetch;

global.fetch = async (url) => {
  const s = String(url);
  if (s.startsWith('https://yata.yt/')) {
    return {
      ok: true,
      json: async () => ({
        stocks: {
          mex: { update: Math.floor(Date.now() / 1000), stocks: [{ id: 258, name: 'Jaguar Plushie', quantity: 200, cost: 10 }] },
        },
      }),
    };
  }
  if (s.startsWith('https://api.prombot.co.uk/')) {
    return { ok: true, json: async () => ({}) };
  }
  if (!s.startsWith('https://api.torn.com/')) throw new Error('Unexpected fetch: ' + s);
  const json = async () => {
    if (s.includes('/v2/faction/members')) {
      return {
        members: [
          { id: 1, name: 'Alpha', level: 70, position: 'Leader', days_in_faction: 200, is_in_oc: true, last_action: { status: 'Online', timestamp: Math.floor(Date.now() / 1000) - 30, relative: '0m ago' }, status: { state: 'Okay', description: 'Okay' } },
          { id: 2, name: 'Beta', level: 55, position: 'Member', days_in_faction: 50, is_in_oc: false, last_action: { status: 'Idle', timestamp: Math.floor(Date.now() / 1000) - 900, relative: '15m ago' }, status: { state: 'Hospital', description: 'Hospitalized' } },
        ],
      };
    }
    if (s.includes('/v2/faction/news')) {
      return { news: [{ id: 'n1', timestamp: 1700000000, text: '<a href="profiles.php?XID=1">Alpha</a> used one Xanax' }] };
    }
    if (s.includes('/v2/faction/chains')) {
      return { chains: [{ id: 77, chain: 500, respect: 2100, start: 1700000000, end: 1700004000 }] };
    }
    if (s.includes('/v2/faction/chain')) {
      return { chain: { current: 25, max: 100, timeout: 240, modifier: 1.5, cooldown: 0 } };
    }
    if (s.includes('/v2/user/faction')) return { faction: { id: 9001, name: 'Test Fac', tag: 'TST' } };
    if (s.includes('/v2/faction/rankedwars')) {
      return { rankedwars: [{ id: 5555, start: 1700000000, end: 1700100000, target: 1000, winner: 9001, factions: [{ id: 9001, name: 'Test Fac', score: 1050 }, { id: 9002, name: 'Rivals', score: 700 }] }] };
    }
    if (s.includes('/v2/faction/5555/rankedwarreport')) {
      return {
        rankedwarreport: {
          start: 1700000000, end: 1700100000, winner: 9001,
          factions: [
            { id: 9001, name: 'Test Fac', score: 1050, attacks: 120, members: [{ id: 1, name: 'Alpha', level: 70, attacks: 80, score: 700 }, { id: 2, name: 'Beta', level: 55, attacks: 40, score: 350 }] },
            { id: 9002, name: 'Rivals', score: 700, attacks: 90, members: [{ id: 9, name: 'Enemy', level: 60, attacks: 90, score: 700 }] },
          ],
        },
      };
    }
    if (s.includes('selections=stocks') && s.includes('/torn/')) {
      return { stocks: { 1: { stock_id: 1, acronym: 'SYM', name: 'Symbiotic Ltd.', current_price: 700, benefit: { type: 'active', frequency: 7, requirement: 500000, description: '1x Drug Pack' } } } };
    }
    if (s.includes('selections=stocks') && s.includes('/user/')) {
      return { stocks: { 1: { stock_id: 1, total_shares: 500000, transactions: { t1: { shares: 500000, bought_price: 600 } } } } };
    }
    if (s.includes('selections=items')) {
      return { items: { 258: { name: 'Jaguar Plushie', type: 'Plushie', market_value: 18000, sell_price: 10 }, 370: { name: 'Drug Pack', type: 'Supply Pack', market_value: 4200000, sell_price: 0 } } };
    }
    if (s.includes('selections=bank')) return { bank: { '3m': 78.2 } };
    if (s.includes('selections=stats')) return { stats: { points_averagecost: 45000 } };
    if (s.includes('selections=factiontree')) {
      return { factiontree: { 1: { 1: { branch: 'Core', name: 'Capacity', level: 1, base_cost: 5000, ability: '+2' } } } };
    }
    if (s.includes('selections=basic')) return { ID: 9001, name: 'Test Fac', tag: 'TST', respect: 120000 };
    if (s.includes('selections=upgrades')) return { upgrades: { 1: { branch: 'Core', name: 'Capacity', level: 1 } } };
    if (s.includes('company/?selections=profile')) return { company: { company_type: 14, name: 'Sweet Shop Test' } };
    if (s.includes('torn/?selections=companies')) {
      return { companies: { 14: { name: 'Sweet Shop', positions: { Cashier: { man_required: 1000, int_required: 0, end_required: 1000 } } } } };
    }
    if (s.includes('torn/?selections=education')) return { education: { 10: { name: 'Management', code: 'BUS2110', duration: 100 } } };
    if (s.includes('user/?selections=education')) return { education_completed: [10] };
    if (s.includes('selections=travel,money,perks')) {
      return {
        money_onhand: 12_500_000,
        travel: { destination: 'Torn', time_left: 0, method: 'Airstrip' },
        property_perks: ['+10 travel item capacity', 'Access to airstrip'],
      };
    }
    return {};
  };
  return { ok: true, status: 200, json, text: async () => JSON.stringify(await json()) };
};

const { server, flushData } = require('../src/server/server');
const ready = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
async function apiGet(route) {
  await ready;
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: route, method: 'GET' }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end();
  });
}

after(async () => {
  global.fetch = realFetch;
  flushData();
  await new Promise((resolve) => server.close(resolve));
  const resolved = path.resolve(temp), root = path.resolve(os.tmpdir()) + path.sep;
  if (resolved.startsWith(root) && path.basename(resolved).startsWith('lrx-intel-tests-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

test('API endpoints: stocks, company positions, ranked wars/payout, faction intel, and enhanced travel', async () => {
  const stk = await apiGet('/api/stocks');
  assert.equal(stk.status, 200);
  assert.equal(stk.data.itemPriceByName['drug pack'], 4200000);
  assert.equal(stk.data.pointsPrice, 45000);
  assert.ok(stk.data.priceHistory['1']?.length >= 1, 'records stock price history locally');

  const comp = await apiGet('/api/company/positions');
  assert.equal(comp.status, 200);
  assert.equal(comp.data.directorBus2110, true);
  assert.ok(comp.data.positions.Cashier);

  const wars = await apiGet('/api/war/rankedwars');
  assert.equal(wars.status, 200);
  assert.equal(wars.data.wars[0].id, 5555);
  assert.equal(wars.data.wars[0].oppName, 'Rivals');

  const pay = await apiGet('/api/war/payout?warId=5555');
  assert.equal(pay.status, 200);
  assert.equal(pay.data.factions[0].members.length, 2);

  const badPay = await apiGet('/api/war/payout?warId=0');
  assert.equal(badPay.status, 400);

  const act = await apiGet('/api/faction/activity');
  assert.equal(act.status, 200);
  assert.equal(act.data.counts.online, 1);
  assert.equal(act.data.counts.idle, 1);
  assert.ok(act.data.heatmap.totalSamples >= 1);

  const arm = await apiGet('/api/faction/armory');
  assert.equal(arm.status, 200);
  assert.equal(arm.data.allowed, true);
  assert.equal(arm.data.entries[0].category, 'used');

  const ch = await apiGet('/api/faction/chains');
  assert.equal(ch.status, 200);
  assert.equal(ch.data.current.current, 25);
  assert.equal(ch.data.chains[0].milestone, 500);

  const upg = await apiGet('/api/faction/upgrades');
  assert.equal(upg.status, 200);
  assert.equal(upg.data.hasUpgradesAccess, true);
  assert.equal(upg.data.currentLevels['Core::Capacity'], 1);

  const tv = await apiGet('/api/travel');
  assert.equal(tv.status, 200);
  assert.equal(tv.data.wallet, 12_500_000);
  assert.equal(tv.data.detectedBaseCap, 15);
  assert.equal(tv.data.detectedMethod, 'Airstrip');
  const mex = tv.data.countries.find((c) => c.code === 'mex');
  assert.equal(mex.items[0].sellPrice, 10);
});

/* =========================================================
   8. Frontend UI Render Smoke Test (EN & TR, all 5 UI modules)
   ========================================================= */
test('frontend UI modules render cleanly in EN and TR without errors, NaN, undefined, or CSP violations', async () => {
  const vm = require('node:vm');
  const makeEl = (id) => ({
    id,
    innerHTML: '',
    hidden: false,
    className: '',
    listeners: {},
    addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; },
  });
  const nodes = Object.fromEntries([
    'tv-planner', 'travel-body', 'stocks-body', 'war-payout-card', 'emp-advisor-card', 'faction-body',
  ].map((id) => [`#${id}`, makeEl(id)]));

  const nowSec = Math.floor(Date.now() / 1000);
  const store = new Map();
  const state = {
    lang: 'en',
    view: 'travel',
    companyMode: true,
    overview: { player: { faction: { faction_id: 9001 } } },
    company: {
      company: { name: 'Sweet Shop Test', rating: 8, environment: 92, efficiency: 95, trains: 3 },
      employees: [
        { id: 1, name: 'Brawn', position: 'Tech Lead', manual_labor: 40000, intelligence: 1000, endurance: 20000, addiction: -2, effectiveness: { total: 80 } },
        { id: 2, name: 'Brain', position: 'Guard', manual_labor: 1000, intelligence: 40000, endurance: 20000, addiction: -9, effectiveness: { total: 75 } },
      ],
    },
  };
  const travelState = {
    cap: 20,
    watch: new Set(['mex:258']),
    data: {
      wallet: 1_000_000,
      detectedBaseCap: 15,
      detectedMethod: 'Airstrip',
      trip: { destination: 'Torn', timeLeft: 900 },
      countries: [
        { code: 'mex', name: 'Mexico', minutes: 26, items: [{ id: 258, name: 'Jaguar Plushie', type: 'Plushie', cost: 10, market: 18000, sellPrice: 10, qty: 200, nextRestock: nowSec + 1800, interval: 3600 }] },
        { code: 'sou', name: 'South Africa', minutes: 297, items: [{ id: 206, name: 'Xanax', type: 'Drug', cost: 750000, market: 840000, sellPrice: 0, qty: 100, nextRestock: nowSec + 3600, interval: 7200 }] },
      ],
    },
  };

  const apiMocks = {
    '/api/stocks': {
      stocks: { 1: { stock_id: 1, acronym: 'SYM', name: 'Symbiotic Ltd.', current_price: 700, benefit: { type: 'active', frequency: 7, requirement: 500000, description: '1x Drug Pack' } } },
      userStocks: { 1: { stock_id: 1, total_shares: 500000, transactions: { t1: { shares: 500000, bought_price: 600 } }, dividend: { ready: 1 } } },
      itemPriceByName: { 'drug pack': 4200000 },
      pointsPrice: 45000,
      bankAprs: { '3m': 78.2 },
      priceHistory: { 1: [{ low: 650, high: 750, close: 700 }, { low: 680, high: 720, close: 700 }] },
    },
    '/api/war/rankedwars': {
      myFactionId: 9001,
      wars: [{ id: 5555, start: 1700000000, end: 1700100000, myScore: 1050, oppName: 'Rivals', oppScore: 700 }],
    },
    '/api/war/payout?warId=5555': {
      warId: 5555, myFactionId: 9001,
      factions: [{ id: 9001, name: 'Test Fac', score: 1050, members: [{ id: 1, name: 'Alpha', level: 70, attacks: 80, score: 700 }, { id: 2, name: 'Beta', level: 55, attacks: 1, score: 5 }] }],
    },
    '/api/company/positions': {
      companyType: 14, directorBus2110: true,
      positions: {
        'Tech Lead': { man_required: 0, int_required: 20000, end_required: 10000, special_ability: 'Efficiency' },
        'Guard': { man_required: 20000, int_required: 0, end_required: 10000, special_ability: 'Security' },
      },
    },
    '/api/faction': {
      access: { inFaction: true, allowed: true, role: 'leader', position: 'Leader', faction: { name: 'Test Fac', tag: 'TST' }, members: 2 },
      myOc: { inOc: true, crime: { id: 10, name: 'Blast from the Past', difficulty: 6, status: 'Planning', filled: 4, total: 4, readyAt: nowSec + 3600 }, slot: { role: 'Hacker', cpr: 88, item: { name: 'USB Drive', ok: false } } },
      oc: {
        totals: { inOc: 1, members: 2 },
        notInOc: [{ id: 2, name: 'Beta', level: 55, position: 'Member', lastStatus: 'Idle', lastRel: '10m ago', state: 'Okay', days: 50 }],
        crimes: [{ id: 10, name: 'Blast from the Past', difficulty: 6, status: 'Planning', filled: 4, total: 4, readyAt: nowSec + 3600, delayed: false, open: 0, missing: [{ id: 1, name: 'Alpha', item: 'USB Drive' }], away: [] }],
      },
    },
    '/api/faction/report?days=7': {
      range: { from: '2026-11-15', to: '2026-11-22', actualDays: 7 },
      boards: { activity: [{ id: 1, name: 'Alpha', value: 7200 }], gym: [], xanax: [], crimes: [], blood: [], oc: [], idle: [] },
      rows: [{ id: 1, name: 'Alpha', activity: 7200, xanax: 14, gym: 5000, crimes: 200, oc: 2 }],
    },
    '/api/faction/activity': {
      counts: { total: 2, online: 1, idle: 1, offline: 0, okay: 1, hospital: 1, traveling: 0, abroad: 0, jail: 0, inOc: 1 },
      members: [
        { id: 1, name: 'Alpha', level: 70, position: 'Leader', last: nowSec - 30, lastStatus: 'Online', lastRel: '0m ago', state: 'Okay', days: 200, inOc: true },
        { id: 2, name: 'Beta', level: 55, position: 'Member', last: nowSec - 900, lastStatus: 'Idle', lastRel: '15m ago', state: 'Hospital', days: 50, inOc: false },
      ],
      heatmap: factionTools.buildActivityHeatmap({ '1:18': { samples: 3, onlineSum: 30, idleSum: 6, totalSum: 60 } }),
    },
    '/api/faction/armory': { allowed: true, ...factionTools.parseArmoryNews([{ id: '1', timestamp: nowSec, text: '<a href="profiles.php?XID=1">Alpha</a> used a First Aid Kit' }]) },
    '/api/faction/chains': { current: { current: 25, max: 100, timeout: 240, modifier: 1.5, cooldown: 0 }, chains: factionTools.summarizeChains([{ id: 1, chain: 1000, respect: 4200, start: nowSec - 5000, end: nowSec - 1000 }]) },
    '/api/faction/upgrades': {
      faction: { id: 9001, name: 'Test Fac', tag: 'TST', respect: 100000 },
      hasUpgradesAccess: true,
      currentLevels: { 'Core::Capacity': 1 },
      tree: factionTools.normalizeFactionTree({ 1: { 1: { branch: 'Core', name: 'Capacity', level: 1, base_cost: 5000, ability: '+2' } } }),
    },
  };

  const sandbox = {
    console, Math, Date, Number, String, Array, Object, Set, Map, JSON, RegExp, Error, Promise,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    I18N: {}, VIEW_META: {}, EXTRA_LOADERS: {}, FEATURE_HOOKS: [],
    state, travelState,
    LRXTravelPlanner: travelPlanner, LRXStocksMath: stocksMath, LRXWarPayout: warPayout,
    LRXCompanyAdvisor: companyAdvisor, LRXFactionTools: factionTools,
    LRXTravelMath: require('../public/travel-math'),
    $: (sel) => nodes[sel] || null,
    document: { activeElement: null, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    tr: (t, e) => (state.lang === 'en' ? e : t),
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])),
    n0: (n) => Math.round(Number(n) || 0).toLocaleString('en-US'),
    money: (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US'),
    cmoney: (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US'),
    compact: (n) => String(Math.round(Number(n) || 0)),
    human: (s) => `${Math.max(0, Math.round(Number(s) || 0))}s`,
    signed: (v, f) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(f || ((x) => '$' + Math.round(x)))(v)}`),
    deltaCls: (v) => (v == null ? '' : v >= 0 ? 'pos' : 'neg'),
    kpi: (l, v, h = '') => `<div class="kpi">${l}:${v}:${h}</div>`,
    emptyBox: (t, x) => `<div class="empty">${t}:${x}</div>`,
    loadingBox: () => '<div>Loading</div>',
    errorBox: (e) => `<div class="err">${e?.message || e}</div>`,
    lsGet: (k, d) => (store.has(k) ? store.get(k) : d),
    lsSet: (k, v) => store.set(k, String(v)),
    feat: () => true,
    nowTct: () => nowSec * 1000,
    trackerVisible: () => true,
    travelMethod: () => 'Airstrip',
    applyLang: () => {},
    applyFeatures: () => {},
    notify: () => {},
    toast: () => {},
    openInTab: () => {},
    copyText: async () => {},
    api: async (route) => {
      const clean = route.replace(/([?&])force=1(&|$)/, (_, a, b) => (a === '?' && b ? '?' : '')).replace(/[?&]$/, '');
      if (apiMocks[route]) return apiMocks[route];
      if (apiMocks[clean]) return apiMocks[clean];
      throw new Error('Unmocked API route: ' + route);
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const file of ['faction.js', 'travel-planner-ui.js', 'stocks.js', 'war-payout-ui.js', 'company-advisor-ui.js']) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  }

  const assertCleanHtml = (label, html) => {
    assert.ok(html.length > 40, `${label}: rendered non-empty HTML`);
    const textOnly = html.replace(/<[^>]+>/g, ' ');
    assert.equal(/\b(NaN|undefined|Infinity|null)\b/.test(textOnly), false, `${label}: no NaN/undefined/Infinity/null in "${textOnly.slice(0, 200)}"`);
    assert.equal(/\son[a-z]+\s*=/i.test(html), false, `${label}: no inline event handlers`);
  };

  for (const lang of ['en', 'tr']) {
    state.lang = lang;

    // 1. Travel Departure Planner
    state.view = 'travel';
    sandbox.renderDeparturePlanner();
    assertCleanHtml(`travel-planner (${lang})`, nodes['#tv-planner'].innerHTML);
    assert.ok(nodes['#tv-planner'].innerHTML.includes('dp-timeline-card'));

    // 2. Stock Market Tracker
    state.view = 'stocks';
    await sandbox.EXTRA_LOADERS.stocks(true);
    assertCleanHtml(`stocks (${lang})`, nodes['#stocks-body'].innerHTML);
    assert.ok(nodes['#stocks-body'].innerHTML.includes('SYM'));

    // 3. Ranked War Payout Planner (expanded)
    state.view = 'war';
    store.set('tt.wp.open', '1');
    // trigger toggle open via click handler
    const wpCard = nodes['#war-payout-card'];
    if (!wpCard.innerHTML.includes('wp-controls')) {
      for (const fn of wpCard.listeners.click || []) await fn({ target: { closest: (s) => (s === '#wp-toggle' ? {} : null) } });
    }
    sandbox.renderWarPayout();
    await new Promise((r) => setTimeout(r, 15));
    assertCleanHtml(`war-payout (${lang})`, wpCard.innerHTML);
    assert.ok(wpCard.innerHTML.includes('factions.php?step=your#/tab=controls&addMoneyTo=1'));

    // 4. Company Position Advisor (expanded)
    state.view = 'employees';
    const advCard = nodes['#emp-advisor-card'];
    if (!advCard.innerHTML.includes('adv-slots')) {
      for (const fn of advCard.listeners.click || []) await fn({ target: { closest: (s) => (s === '#adv-toggle' ? {} : null) } });
    }
    sandbox.renderCompanyAdvisor();
    await new Promise((r) => setTimeout(r, 15));
    assertCleanHtml(`company-advisor (${lang})`, advCard.innerHTML);
    assert.ok(advCard.innerHTML.includes('BUS2110'));

    // 5. Faction page — ALL 5 tabs (oc, activity, armory, chains, upgrades)
    state.view = 'faction';
    for (const tab of ['oc', 'activity', 'armory', 'chains', 'upgrades']) {
      sandbox.lrxFaction.tab = tab;
      await sandbox.EXTRA_LOADERS.faction(true);
      await new Promise((r) => setTimeout(r, 10));
      const html = nodes['#faction-body'].innerHTML;
      assertCleanHtml(`faction:${tab} (${lang})`, html);
      if (tab === 'oc') {
        assert.ok(html.includes('fac-armory-row'), `faction:oc (${lang}) renders clickable missing-item row`);
        assert.ok(html.includes('factions.php?step=your#/tab=armoury&amp;start=0&amp;sub=utilities') || html.includes('factions.php?step=your#/tab=armoury&start=0&sub=utilities'), 'Armory Utilities URL present');
      }
      if (tab === 'activity') assert.ok(html.includes('fac-hm-cell'));
      if (tab === 'armory') assert.ok(html.includes('First Aid Kit'));
      if (tab === 'chains') assert.ok(html.includes('1000'));
      if (tab === 'upgrades') assert.ok(html.includes('fac-upg-grid'));
    }
  }
});

