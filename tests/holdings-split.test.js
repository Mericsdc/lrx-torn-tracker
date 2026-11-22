// Finance › Networth › Holdings › Change: /api/holdings writes one per-item record per Torn day to
// data/holdings-days.json and sends the period start records back as `split` (src/server/holdings-days.js).
// Synthetic player and replies only; every Torn API call is answered by the stub below.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-holdsplit-tests-'));
process.env.TORN_DATA_DIR = temp;
process.env.TORN_API_KEY = 'SplitTestKey0001';
process.env.TORN_PREMIUM_SERVICE_URL = '';

const tctDate = (ms) => new Date(ms - 18 * 3600_000).toISOString().slice(0, 10);
const today = tctDate(Date.now());
const yesterday = tctDate(Date.now() - 86400_000);
const DAYS_FILE = path.join(temp, 'holdings-days.json');
const readDays = () => JSON.parse(fs.readFileSync(DAYS_FILE, 'utf8'));

const REPLIES = {
  'torn/?selections=items': { items: { 206: { name: 'Xanax', type: 'Drug', market_value: 830000 } } },
  'v2/user/inventory?limit=250&offset=0': { inventory: { items: [], timestamp: 1 }, _metadata: { links: { next: null } } },
  'user/?selections=bazaar': { bazaar: [{ ID: 206, name: 'Xanax', type: 'Drug', quantity: 4700, price: 850000, market_price: 830000 }] },
  'user/?selections=display': { display: [] },
  'v2/user/itemmarket?offset=0': { itemmarket: [], _metadata: { links: { next: null } } },
  'user/?selections=stocks': { stocks: {} },
  'torn/?selections=stocks': { stocks: { 25: { stock_id: 25, name: 'Torn City Investments', acronym: 'TCI', current_price: 1200 } } },
};
let fetchCalls = 0;
const realFetch = global.fetch;
global.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.torn.com') throw new Error('Unexpected external request: ' + url.hostname);
  fetchCalls++;
  url.searchParams.delete('key'); url.searchParams.delete('comment');
  const q = url.pathname.slice(1) + (url.searchParams.size ? '?' + decodeURIComponent(url.searchParams.toString()) : '');
  const body = REPLIES[q] || { error: { code: 7, error: 'no stub for ' + q } };
  return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
};

// Player 123: a networth record taken a moment ago, and yesterday's Holdings record (5,000 Xanax in the bazaar).
fs.writeFileSync(path.join(temp, 'history.json'), JSON.stringify({ ownerId: 123, days: [], addiction: {}, user: {}, stockOrders: {},
  networth: { [today]: { total: 1e9, at: Date.now() } } }));
const seedDays = (places = { bazaar: { 206: [5000, 840000] } }) => fs.writeFileSync(DAYS_FILE, JSON.stringify({ v: 1, ownerId: 123,
  names: { 206: ['Xanax', 'Drug'] }, days: { [yesterday]: { at: Date.now() - 86400_000, nw: 9e8, places } } }));
seedDays();

const { server, flushData } = require('../src/server/server');
const ready = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
async function request(route, body) {
  await ready;
  const raw = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: route, method: raw === null ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let text = ''; res.on('data', (c) => text += c); res.on('end', () => { let data; try { data = JSON.parse(text); } catch { data = text; } resolve({ status: res.statusCode, data }); });
    });
    req.on('error', reject); req.end(raw);
  });
}
after(async () => {
  global.fetch = realFetch; flushData(); await new Promise((resolve) => server.close(resolve));
  const resolved = path.resolve(temp), root = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(root) || !path.basename(resolved).startsWith('lrx-holdsplit-tests-')) throw new Error('Unsafe test cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});

test('switch off: the reply has no split and nothing is recorded', async () => {
  assert.equal((await request('/api/features', { features: { 'finance.priceSplit': false } })).status, 200);
  const r = await request('/api/holdings');
  assert.equal(r.status, 200);
  assert.equal(r.data.places.bazaar.ok, true, 'the holdings themselves load');
  assert.equal(r.data.split, undefined);
  assert.deepEqual(Object.keys(readDays().days), [yesterday]);
});

test('a records file the split cannot use never breaks Holdings and is not written over', async () => {
  await request('/api/features', { features: { 'finance.priceSplit': true } });
  seedDays({ bazaar: null }); // hand-edited: a place that is not an object
  const before = fs.readFileSync(DAYS_FILE, 'utf8');
  const r = await request('/api/holdings');
  assert.equal(r.status, 200);
  assert.equal(r.data.places.bazaar.ok, true, 'the Value view still has its data');
  assert.equal(r.data.split, undefined, 'no split from a file it cannot use');
  assert.equal(fs.readFileSync(DAYS_FILE, 'utf8'), before, 'the file is left as it was');
});

test('a records file that cannot be read right now is not taken for an empty one', async () => {
  fs.rmSync(DAYS_FILE);
  fs.mkdirSync(DAYS_FILE); // reading it fails with EISDIR, like a lock held by another program
  const r = await request('/api/holdings');
  assert.equal(r.status, 200);
  assert.equal(r.data.split, undefined, 'skipped this time, nothing recorded over it');
  fs.rmdirSync(DAYS_FILE);
});

test("switch on: the reply is recorded once and split carries yesterday's start", async () => {
  seedDays();
  await request('/api/features', { features: { 'finance.priceSplit': true } });
  const calls = fetchCalls;
  const r = await request('/api/holdings');
  assert.equal(fetchCalls, calls, 'answered from the cache, no Torn call');
  assert.equal(r.data.split.today, today);
  assert.deepEqual(r.data.split.starts.map((s) => s.date), [yesterday]);
  assert.deepEqual(r.data.split.starts[0].places.bazaar['206'], [5000, 840000]);
  assert.deepEqual(r.data.split.names['206'], ['Xanax', 'Drug']);
  const d = readDays().days[today];
  assert.deepEqual(d.places.bazaar['206'], [4700, 830000]);
  assert.equal(d.nw, 1e9, 'the networth of the moment');
  assert.equal(d.at, r.data.at);
  const again = await request('/api/holdings');
  assert.equal(again.data.at, r.data.at);
  assert.equal(readDays().days[today].at, d.at, 'a cached reply is not recorded again');
});

test('Holdings off: no split', async () => {
  await request('/api/features', { features: { 'finance.holdings': false } });
  assert.equal((await request('/api/holdings')).data.split, undefined);
  await request('/api/features', { features: { 'finance.holdings': true } });
});
