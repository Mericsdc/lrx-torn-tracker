// One Torn player's local records must never be shown to, or mixed into, another player's:
// Log Out followed by another sign-in, a key changed in Settings, or a key changed outside the app.
// Synthetic keys and players only; every Torn API reply comes from the stub below.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-account-tests-'));
process.env.TORN_DATA_DIR = temp;
process.env.TORN_API_KEY = '';
process.env.TORN_PREMIUM_SERVICE_URL = '';

const KEY_A = 'AlphaKey00000001', KEY_A2 = 'AlphaKey00000002', KEY_B = 'BravoKey00000001';
const KEY_LOG = 'LogKeyOfAlpha001', KEY_FF = 'FFKeyOfAlpha0001', KEY_BAD = 'NotAKey000000000';
const PLAYERS = {
  [KEY_A]: { id: 111, name: 'Alpha', strength: 1000 },
  [KEY_A2]: { id: 111, name: 'Alpha', strength: 1000 },
  [KEY_B]: { id: 222, name: 'Bravo', strength: 5000 },
};
let network = 'up';
const realFetch = global.fetch;
global.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.torn.com') throw new Error('Unexpected external request: ' + url.hostname);
  if (network === 'down') throw new TypeError('fetch failed');
  const reply = (value) => ({ ok: true, status: 200, text: async () => JSON.stringify(value), json: async () => value });
  const player = PLAYERS[url.searchParams.get('key')];
  if (!player) return reply({ error: { code: 2, error: 'Incorrect key' } });
  const selections = url.searchParams.get('selections') || '';
  if (url.pathname === '/key/') return reply({ access_level: 3, access_type: 'Limited Access' });
  if (url.pathname === '/user/' && selections === 'basic') return reply({ player_id: player.id, name: player.name, level: 10 });
  if (url.pathname === '/user/' && selections.startsWith('profile,cooldowns')) {
    const user = { player_id: player.id, name: player.name, level: 10, timestamp: Math.floor(Date.now() / 1000), cooldowns: { drug: 0 }, icons: {}, personalstats: { xantaken: 7 }, status: { state: 'Okay' } };
    for (const stat of ['strength', 'defense', 'speed', 'dexterity']) { user[stat] = player.strength; user[stat + '_modifier'] = 0; user[stat + '_info'] = []; }
    return reply(user);
  }
  if (url.pathname === '/torn/' && selections === 'education') return reply({ education: {} });
  return reply({ error: { code: 7, error: 'Incorrect ID-entity relation' } });
};

// Player 111's records are on disk, but the saved key now belongs to player 222 (changed outside the app).
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ apiKey: KEY_B }));
fs.writeFileSync(path.join(temp, 'history.json'), JSON.stringify({ ownerId: 111, days: [], addiction: {}, user: {}, stockOrders: {},
  stats: { '2026-11-01': { str: 1000, def: 1000, spd: 1000, dex: 1000, total: 4000, at: 1 } } }));

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
  if (!resolved.startsWith(root) || !path.basename(resolved).startsWith('lrx-account-tests-')) throw new Error('Unsafe test cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});
const savedConfig = () => JSON.parse(fs.readFileSync(path.join(temp, 'config.json'), 'utf8'));
const statTotals = async () => (await request('/api/stats')).data.history.map((day) => day.total);

test('records saved for one player are dropped when the saved key belongs to another player', async () => {
  assert.equal((await request('/api/overview')).data.player.id, 222);
  assert.deepEqual(await statTotals(), [20000], 'only player 222 is in the stat history');
});

test('Log Out followed by another player signing in starts with an empty history', async () => {
  assert.equal((await request('/api/logout', {})).status, 200);
  const login = await request('/api/auth', { apiKey: KEY_A });
  assert.equal(login.status, 200); assert.equal(login.data.player.id, 111); assert.equal(login.data.resetData, true);
  assert.deepEqual(await statTotals(), [], 'player 222 is gone before player 111 has any data');
  assert.equal((await request('/api/bootstrap')).data.overview, null);
  await request('/api/overview');
  assert.deepEqual(await statTotals(), [4000]);
});

test('the same player signing in again keeps their own history', async () => {
  await request('/api/logout', {});
  const login = await request('/api/auth', { apiKey: KEY_A });
  assert.equal(login.data.resetData, false);
  assert.deepEqual(await statTotals(), [4000]);
});

test('Settings rejects a key Torn does not accept and keeps the working key', async () => {
  const rejected = await request('/api/config', { apiKey: KEY_BAD });
  assert.notEqual(rejected.status, 200); assert.equal(rejected.data.code, 2);
  assert.equal(savedConfig().apiKey, KEY_A);
  network = 'down';
  const offline = await request('/api/config', { apiKey: KEY_B });
  network = 'up';
  assert.equal(offline.data.code, 'NETWORK'); assert.equal(savedConfig().apiKey, KEY_A);
  assert.deepEqual(await statTotals(), [4000]);
});

test('another key of the same player keeps the history, the log key and the FFScouter key', async () => {
  assert.equal((await request('/api/config', { logKey: KEY_LOG, ffscouterKey: KEY_FF })).status, 200);
  const rotated = await request('/api/config', { apiKey: KEY_A2 });
  assert.equal(rotated.status, 200); assert.equal(rotated.data.resetData, false);
  assert.equal(savedConfig().apiKey, KEY_A2); assert.equal(savedConfig().logKey, KEY_LOG); assert.equal(savedConfig().ffscouterKey, KEY_FF);
  assert.deepEqual(await statTotals(), [4000]);
});

test('a key of another player entered in Settings starts clean and drops the previous player\'s extra keys', async () => {
  const switched = await request('/api/config', { apiKey: KEY_B });
  assert.equal(switched.status, 200); assert.equal(switched.data.resetData, true);
  assert.deepEqual(await statTotals(), []);
  assert.equal((await request('/api/bootstrap')).data.overview, null);
  const config = (await request('/api/config')).data;
  assert.equal(config.logKeyMasked, ''); assert.equal(config.ffscouterKeyMasked, '');
  assert.equal(savedConfig().apiKey, KEY_B);
  flushData();
  assert.ok(!fs.readFileSync(path.join(temp, 'history.json'), 'utf8').includes('"total":4000'), 'the previous player is not left on disk');
});

test('each player gets back only their own Overview layouts', async () => {
  const daily = { v: 1, active: 0, layouts: [{ name: 'Daily', widgets: [{ id: 'battle', size: 'M' }] }] };
  await request('/api/logout', {});
  assert.equal((await request('/api/auth', { apiKey: KEY_A })).data.player.id, 111);
  assert.equal((await request('/api/overview-layouts', { playerId: 111, layouts: daily })).status, 200);
  assert.deepEqual((await request('/api/overview-layouts')).data, { playerId: 111, layouts: daily });

  await request('/api/logout', {});
  assert.equal((await request('/api/auth', { apiKey: KEY_B })).data.player.id, 222);
  assert.deepEqual((await request('/api/overview-layouts')).data, { playerId: 222, layouts: null });
  const hijack = { v: 1, active: 0, layouts: [{ name: 'Hijack', widgets: [] }] };
  const stale = await request('/api/overview-layouts', { playerId: 111, layouts: hijack });
  assert.equal(stale.status, 409); assert.equal(stale.data.code, 'PLAYER_CHANGED');
  assert.deepEqual(savedConfig().overviewLayouts, { 111: daily }, 'a refused save stores nothing');

  await request('/api/logout', {});
  assert.equal((await request('/api/auth', { apiKey: KEY_A })).data.player.id, 111);
  assert.deepEqual((await request('/api/overview-layouts')).data, { playerId: 111, layouts: daily });
});

test('a hostile saved layout is repaired before it is stored', async () => {
  const { WIDGETS, defaultSet } = require('../public/overview-layout');
  const name = '<img src=x onerror=alert(1)>'.repeat(3);
  const layouts = Array.from({ length: 7 }, (_, i) => ({ name, widgets: [{ id: '__proto__', size: 'M' }, { id: 'nope', size: 'S' }, { id: 'drug', size: 'S' }] }));
  layouts[2].widgets = 'battle';
  assert.equal((await request('/api/overview-layouts', { playerId: 111, layouts: { v: 1, active: 0, layouts } })).status, 200);
  const stored = savedConfig().overviewLayouts['111'];
  assert.equal(stored.layouts.length, 5);
  assert.ok(stored.layouts.every((l) => l.name.length <= 24), 'names are capped at 24 characters');
  const known = new Set(WIDGETS.map((w) => w.id));
  assert.ok(stored.layouts.every((l) => l.widgets.every((w) => known.has(w.id))), 'unknown ids are dropped');
  assert.deepEqual(stored.layouts[1].widgets, [{ id: 'drug', size: 'S' }]);
  assert.deepEqual(stored.layouts[2].widgets, defaultSet().layouts[0].widgets, 'a string as widgets gives the default widgets');
});
