const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { calculator, directorSummary, salePlan, tradePlan } = require('../public/companion-math');
const { companionData, latestCompanyTraining } = require('../src/server/companion');
const { nextChainMilestone } = require('../public/faction-tools');

test('trade preview parses shorthand exactly and keeps the reserved balance', () => {
  const base = { wallet: '1,000,000', current: '500k', reserve: '$250,000', direction: 'add' };
  assert.deepEqual(tradePlan({ ...base, mode: 'money', amount: '750.001k' }), { error: 'funds', shortfall: '1' });
  assert.deepEqual(tradePlan({ ...base, mode: 'money', amount: '750k' }), { delta: 750000, wallet: 250000, offer: 1250000 });
  assert.deepEqual(tradePlan({ ...base, mode: 'percent', amount: '2.55%', direction: 'withdraw' }),
    { delta: 12750, wallet: 1012750, offer: 487250 });
  assert.deepEqual(tradePlan({ ...base, mode: 'money', amount: '1m', direction: 'withdraw' }),
    { error: 'withdraw', shortfall: 500000 });
  for (const value of ['-5k', '0.001', '1,00', '9,007,199,254,740,992', '5e3', 'Infinity']) {
    assert.ok(tradePlan({ ...base, mode: 'money', amount: value }).error, value);
  }
  assert.equal(tradePlan({ ...base, mode: 'percent', amount: '1%', current: '0' }).error, 'percentage');
});

test('calculator allows bounded arithmetic and fee rounds up to a whole dollar', () => {
  assert.equal(calculator('-(1,200 + $300) * -10%'), 150);
  assert.equal(calculator('7 - 3 * (1 + 1)'), 1);
  for (const value of ['alert(1)', '1 / 0', '2(3)', '1**2', '($2+', '2,00', '1+']) assert.equal(calculator(value), null, value);
  assert.deepEqual(salePlan({ cost: '99', price: '101', fee: '1%' }), { net: 99, profit: 0 });
});

test('company derives latest recorded training and handles old reports', () => {
  const line = '<a href="https://www.torn.com/profiles.php?XID=2">Employee</a> has been trained';
  assert.deepEqual([...latestCompanyTraining({
    a: { timestamp: 100, news: line }, b: { timestamp: 105, news: line }, c: { timestamp: 9999, news: line },
    d: { timestamp: 120, news: 'other notice' },
  }, 150_000)], [[2, 105]]);
  assert.deepEqual(directorSummary({
    company: { environment: 99, efficiency: 91 }, products: [{ daysLeft: 1.4 }, { daysLeft: 1.5 }, { daysLeft: null }],
    days: [{ revenue: 500 }, { revenue: 650 }],
  }), { lowStock: 1, efficiencyBelowGoal: false, environmentBelowGoal: true, dailyChange: 150 });
});

test('next chain bonus stays within the faction limit', () => {
  assert.equal(nextChainMilestone(10, 100), 25);
  assert.equal(nextChainMilestone(100, 100), null);
});

test('company comparison sends both filters upstream before the result limit', async () => {
  const read = async (query, ttl) => {
    const url = new URL(query, 'https://api.torn.com/v2/');
    assert.equal(url.pathname, '/v2/company/search');
    assert.equal(url.searchParams.get('filters'), 'type:Equal:32,rating:Equal:3');
    assert.equal(url.searchParams.get('limit'), '100');
    assert.equal(ttl, 600_000);
    return { observedAt: 123, data: { search: [
      { id: 1, name: 'Own company', rating: 3, type: { id: 32 }, income: { weekly: 10 } },
      { id: 2, name: 'Different stars', rating: 4, type: { id: 32 }, income: { weekly: 99 } },
      { id: 3, name: 'Different type', rating: 3, type: { id: 44 }, income: { weekly: 99 } },
    ] } };
  };
  const d = await companionData('company', new URLSearchParams({ type: 32, rating: 3 }), read);
  assert.deepEqual(d.rows, [{ id: 1, name: 'Own company', rating: 3, weekly: 10 }]);
  assert.equal(d.hasMore, false);
  const invalid = async () => { assert.fail('Invalid ratings must not fetch'); };
  await assert.rejects(companionData('company', new URLSearchParams({ type: 32, rating: 11 }), invalid), { code: 'BAD_INPUT' });
  await assert.rejects(companionData('company', new URLSearchParams({ type: 32 }), invalid), { code: 'BAD_INPUT' });
});

test('API projections keep provenance and never follow an upstream pagination URL', async () => {
  const observedAt = 123456;
  const calls = [];
  const responses = {
    'user/inventory?cat=Supply+Pack&limit=20&offset=20': { inventory: { items: [{ id: 1, name: 'Test', amount: 2, uid: 'secret', faction_owned: true }] },
      _metadata: { links: { next: 'https://example.invalid' } } },
    'user/inventory?cat=Primary&limit=20&offset=0': { inventory: { items: [], timestamp: 42 } },
    'user/gym': { gym: { id: 2, name: 'B', unlocked_gyms: [{ id: 1, available: true }, { id: 3, available: false }] } },
    'torn/gyms': { gyms: [{ id: 1, name: 'A', modifiers: { strength: 8 } }, { id: 2, name: 'B', modifiers: { strength: 8 } },
      { id: 3, name: 'C', modifiers: { strength: 99 } }] },
  };
  const read = async (query) => { calls.push(query); return { data: responses[query], observedAt }; };
  const inventory = await companionData('inventory', new URLSearchParams({ category: 'Supply Pack', offset: 20 }), read);
  assert.equal(inventory.category, 'Supply Pack');
  assert.deepEqual(inventory.rows, [{ id: 1, name: 'Test', amount: 2, factionOwned: true, equipped: false }]);
  assert.equal(inventory.hasMore, true);
  assert.deepEqual(await companionData('inventory', new URLSearchParams(), read),
    { category: 'Primary', offset: 0, limit: 20, hasMore: false, observedAt: 42_000, rows: [] });
  assert.deepEqual((await companionData('gyms', new URLSearchParams(), read)).best.strength, { names: ['A', 'B'], modifier: 8 });
  await assert.rejects(companionData('market', new URLSearchParams({ item: '1/../blah' }), read), { code: 'BAD_INPUT' });
  await assert.rejects(companionData('inventory', new URLSearchParams({ category: 'constructor' }), read), { code: 'BAD_INPUT' });
  assert.equal(calls.length, 4);
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-companion-test-'));
process.env.TORN_DATA_DIR = root;
process.env.TORN_API_KEY = 'fixture-key';
process.env.TORN_PREMIUM_SERVICE_URL = '';
const fetchLocal = global.fetch;
let upstream = 0;
global.fetch = async (input, options) => {
  const url = new URL(input);
  if (url.hostname === '127.0.0.1') return fetchLocal(input, options);
  assert.equal(url.origin, 'https://api.torn.com');
  assert.equal(url.pathname, '/v2/user/money');
  assert.equal(url.searchParams.get('key'), 'fixture-key');
  upstream++;
  await new Promise((resolve) => setTimeout(resolve, 20));
  return new Response(JSON.stringify({ money: { wallet: 42, vault: 8, faction: { money: -5, points: 0 }, private: 'omitted' } }));
};
const { server, flushData } = require('../src/server/server');
const ready = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
after(async () => {
  global.fetch = fetchLocal;
  await new Promise((resolve) => server.close(resolve));
  flushData();
  if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('lrx-companion-test-')) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('local routes share a cache and reject writes and malformed IDs', async () => {
  await ready;
  const base = 'http://127.0.0.1:' + server.address().port + '/api/companion/';
  const response = await Promise.all([fetch(base + 'money'), fetch(base + 'money')]);
  assert.equal(response[0].status, 200);
  const [one, two] = await Promise.all(response.map((r) => r.json()));
  assert.deepEqual(one, two);
  assert.deepEqual(one.faction, { money: -5, points: 0 });
  assert.equal(one.private, undefined);
  assert.equal((await fetch(base + 'money')).status, 200);
  assert.equal((await fetch(base + 'money', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + 'market?item=%2f')).status, 400);
  assert.equal(upstream, 1);
});
