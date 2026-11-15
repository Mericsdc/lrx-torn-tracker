// Profile helper lookups (server.js profileWorkStats): the two public Torn requests the owner chose to make
// automatically, their memory cache and their limits. Synthetic key and replies only.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-profile-tests-'));
process.env.TORN_DATA_DIR = temp;
process.env.TORN_API_KEY = '';
process.env.TORN_PREMIUM_SERVICE_URL = '';
const KEY = 'ProfileKey000001';
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ apiKey: KEY }));

const calls = [];
let mode = 'ok';
const realFetch = global.fetch;
const reply = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });
global.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.torn.com') throw new Error('Unexpected external request: ' + url.hostname);
  calls.push(url);
  if (mode === 'error') return reply({ error: { code: 6, error: 'Incorrect ID' } });
  if (/^\/v2\/user\/\d+\/hof$/.test(url.pathname)) return reply({ hof: { working_stats: { value: 152340, rank: 1200 }, level: { value: 50 } } });
  if (/^\/company\/\d+$/.test(url.pathname)) return reply({ company: { ID: 77, name: 'Shine Co', rating: 7, employees: { 1: {}, 2: {} } } });
  return reply({});
};
const { profileWorkStats, flushData } = require('../src/server/server');
const realNow = Date.now;
after(() => {
  global.fetch = realFetch; Date.now = realNow; flushData();
  const resolved = path.resolve(temp);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('lrx-profile-tests-')) fs.rmSync(resolved, { recursive: true, force: true });
});

test('one profile costs two public Torn requests, then comes from memory', async () => {
  const result = await profileWorkStats('1001', '77');
  assert.deepEqual(result, { workingStats: 152340, rating: 7 });
  assert.equal(calls.length, 2);
  const [hof, company] = calls;
  assert.equal(hof.pathname, '/v2/user/1001/hof');
  assert.equal(company.pathname, '/company/77');
  assert.equal(company.searchParams.get('selections'), 'profile');
  for (const url of calls) { assert.equal(url.searchParams.get('key'), KEY); assert.equal(url.searchParams.get('comment'), 'TornTracker'); }
  assert.ok(!JSON.stringify(result).includes(KEY), 'only the two numbers go back to the page');
  // Same player and company again, and the same company from a colleague's profile: one new request
  assert.deepEqual(await profileWorkStats(1001, 77), { workingStats: 152340, rating: 7 });
  await profileWorkStats('1002', '77');
  assert.deepEqual(calls.slice(2).map((u) => u.pathname), ['/v2/user/1002/hof']);
  // 12 h later the player is looked up again; the company keeps its 24 h
  Date.now = () => realNow() + 12 * 3600_000 + 1000;
  await profileWorkStats('1001', '77');
  assert.deepEqual(calls.slice(3).map((u) => u.pathname), ['/v2/user/1001/hof']);
  Date.now = realNow;
});

test('two lookups at once share the same request', async () => {
  calls.length = 0;
  await Promise.all([profileWorkStats('2001', '88'), profileWorkStats('2001', '88')]);
  assert.deepEqual(calls.map((u) => u.pathname).sort(), ['/company/88', '/v2/user/2001/hof']);
});

test('a player without a company link costs one request', async () => {
  calls.length = 0;
  assert.deepEqual(await profileWorkStats('3001', null), { workingStats: 152340, rating: null });
  assert.deepEqual(calls.map((u) => u.pathname), ['/v2/user/3001/hof']);
});

test('IDs from the page are numbers or nothing is asked', async () => {
  calls.length = 0;
  for (const [player, company] of [['', '77'], ['0', '77'], ['12a', '77'], ['../key', '77'], ['1'.repeat(11), '77'], [null, null], [{}, []]]) {
    assert.deepEqual(await profileWorkStats(player, company), { workingStats: null, rating: null });
  }
  assert.deepEqual(await profileWorkStats('4001', '7/../../user'), { workingStats: 152340, rating: null });
  assert.deepEqual(calls.map((u) => u.pathname), ['/v2/user/4001/hof']);
});

test('a failed lookup shows nothing and is retried after five minutes, not on every focus', async () => {
  calls.length = 0; mode = 'error';
  assert.deepEqual(await profileWorkStats('5001', '99'), { workingStats: null, rating: null });
  assert.deepEqual(await profileWorkStats('5001', '99'), { workingStats: null, rating: null });
  assert.equal(calls.length, 2);
  mode = 'ok';
  Date.now = () => realNow() + 5 * 60_000 + 1000;
  assert.deepEqual(await profileWorkStats('5001', '99'), { workingStats: 152340, rating: 7 });
  assert.equal(calls.length, 4);
  Date.now = realNow;
});

test('replies outside the expected shape are not shown', async () => {
  const saved = global.fetch;
  global.fetch = async () => reply({ hof: { working_stats: { value: '<img src=x onerror=alert(1)>' } }, company: { rating: 11 } });
  try { assert.deepEqual(await profileWorkStats('6001', '66'), { workingStats: null, rating: null }); }
  finally { global.fetch = saved; }
});
