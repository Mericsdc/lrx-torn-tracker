const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { buildBattleStats } = require('../src/server/battle-stats');
const { createWarGroups } = require('../src/server/war-groups');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-tests-'));
process.env.TORN_DATA_DIR = temp;
process.env.TORN_API_KEY = '';
let keyMode = 'valid';
const realFetch = global.fetch;
global.fetch = async (url) => {
  if (!String(url).startsWith('https://api.torn.com/')) throw new Error('Unexpected external request');
  if (keyMode === 'network') throw new TypeError('fetch failed');
  if (keyMode === 'timeout') throw new DOMException('timeout', 'TimeoutError');
  if (keyMode === 'invalid') return { json: async () => ({ error: { code: 2, error: 'Incorrect key' } }) };
  const info = { access_level: keyMode === 'custom' ? 0 : keyMode === 'public' ? 1 : 3, access_type: keyMode === 'custom' ? 'Custom' : 'Limited Access', selections: { user: ['profile', 'battlestats', 'bars', 'cooldowns'] } };
  return { json: async () => String(url).includes('/key/') ? keyMode === 'nested' ? { info } : info : { player_id: 123, name: 'Test player', level: 20 } };
};
const { server, flushData } = require('../src/server/server');
const ready = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
async function request(route, body, headers = {}) {
  await ready;
  const raw = typeof body === 'string' ? body : body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: route, method: raw === null ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let text = ''; res.on('data', (c) => text += c); res.on('end', () => { let data; try { data = JSON.parse(text); } catch { data = text; } resolve({ status: res.statusCode, data }); });
    });
    req.on('error', reject); req.end(raw);
  });
}
after(async () => {
  global.fetch = realFetch; flushData(); await new Promise((resolve) => server.close(resolve));
  const resolved = path.resolve(temp), root = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(root) || !path.basename(resolved).startsWith('lrx-tests-')) throw new Error('Unsafe test cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});
const sample = () => {
  const u = { cooldowns: { drug: 3600 }, icons: { icon49: 'Drug cooldown - Xanax' } };
  ['strength', 'defense', 'speed', 'dexterity'].forEach((k, i) => {
    u[k] = [2978825, 502487, 2981600, 2765841][i]; u[k + '_modifier'] = [-11, -11, -8, -5][i];
    u[k + '_info'] = ['-35% to ' + k + ' from Drugs', '+24% from Merits'];
  }); return u;
};
test('screenshot regression: active Xanax is removed once, never applied twice', () => {
  const out = buildBattleStats(sample());
  assert.equal(out.xanaxActive, true);
  assert.equal(out.stats.strength.noXanax, 3693743);
  assert.equal(out.stats.strength.withXanax, 2651154);
  assert.deepEqual(Object.values(out.stats).map((s) => s.withXanax), Object.values(out.stats).map((s) => s.current));
  assert.equal(out.totals.base, 9228753);
  assert.equal(out.totals.withXanax, 8468988);
});
test('generic Drugs info, explicit Xanax, Unicode minus and spaced signs', () => {
  const u = sample(); u.icons = {};
  assert.equal(buildBattleStats(u).xanaxActive, true);
  for (const k of ['strength', 'defense', 'speed', 'dexterity']) u[k + '_info'] = ['− 35% to stats from Xanax', '-5% from Drug Addiction'];
  const b = buildBattleStats(u);
  assert.equal(b.stats.strength.noXanaxModifier, 24);
  assert.equal(b.stats.strength.withXanaxModifier, -11);
});
test('other drug and addiction effects are not mistaken for Xanax', () => {
  const u = sample(); u.icons = { icon49: 'Drug cooldown - Cannabis' };
  for (const k of ['strength', 'defense', 'speed', 'dexterity']) u[k + '_info'] = ['-5% from Drug Addiction'];
  u.speed_info.push('-35% to Speed from Drugs');
  const out = buildBattleStats(u);
  assert.equal(out.xanaxActive, false); assert.equal(out.stats.strength.noXanaxModifier, -11);
  u.cooldowns.drug = 0; u.icons = { icon49: 'Drug cooldown - Xanax' };
  assert.equal(buildBattleStats(u).xanaxActive, false);
});
test('groups persist per faction; rename, bulk assign, remove and invalid requests are atomic', () => {
  const groups = createWarGroups(temp); const first = groups.mutate(1, { action: 'create', name: 'Priority' }).groups[0];
  groups.mutate(1, { action: 'assign', groupId: first.id, playerIds: [10, 20] });
  assert.throws(() => groups.mutate(1, { action: 'assign', groupId: first.id, playerIds: [30, -1] }));
  assert.equal(groups.get(1).assignments[30], undefined);
  groups.mutate(1, { action: 'rename', groupId: first.id, name: '<Priority>' });
  assert.equal(createWarGroups(temp).labels([1])[10], '<Priority>');
  assert.equal(groups.get(2).groups.length, 0);
  groups.mutate(1, { action: 'remove', groupId: first.id });
  assert.deepEqual(groups.get(1), { groups: [], assignments: {} });
});
test('API handles malformed JSON, traversal and cross-origin writes', async () => {
  assert.equal((await request('/api/ff-script-request', { url: 'https://ffscouter.com/api/v1/check-key' })).status, 403);
  assert.equal((await request('/api/config', '{')).status, 400);
  assert.equal((await request('/api/config', null)).status, 400);
  assert.equal((await request('/%E0%A4%A')).status, 400);
  assert.equal((await request('/..%5cserver.js')).status, 403);
  assert.equal((await request('/api/config', { theme: 'light' }, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await request('/api/config', undefined, { Host: 'example.com' })).status, 403);
  assert.equal((await request('/api/config', { theme: 'bad', pollMinutes: 90 })).status, 400);
  assert.equal((await request('/api/config')).data.pollMinutes, 15);
  assert.equal((await request('/api/config', 'x'.repeat(100001))).status, 413);
});
test('themes and group endpoints persist validated values', async () => {
  for (const theme of ['obsidian', 'ocean', 'forest', 'amethyst', 'light']) {
    assert.equal((await request('/api/config', { theme })).status, 200);
    assert.equal((await request('/api/bootstrap')).data.config.theme, theme);
  }
  const group = (await request('/api/war-groups?faction=100', { action: 'create', name: 'Assist' })).data.groups[0];
  assert.equal((await request('/api/war-groups?faction=100', { action: 'assign', groupId: group.id, playerIds: [123] })).status, 200);
  assert.equal((await request('/api/war-groups?faction=100')).data.assignments[123], group.id);
  assert.equal((await request('/api/war-groups?faction=-1')).status, 400);
});
test('login accepts exact mixed-case keys, reports failures and preserves saved key', async () => {
  const key = 'AbCdEfGh12345678';
  for (const mode of ['valid', 'nested', 'custom']) {
    keyMode = mode; assert.equal((await request('/api/auth', { apiKey: key })).status, 200);
    assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'config.json'))).apiKey, key);
  }
  keyMode = 'invalid'; assert.equal((await request('/api/auth', { apiKey: 'a'.repeat(16) })).data.code, 2);
  keyMode = 'public'; assert.equal((await request('/api/auth', { apiKey: key })).status, 403);
  keyMode = 'network'; assert.equal((await request('/api/auth', { apiKey: key })).data.code, 'NETWORK');
  keyMode = 'timeout'; assert.equal((await request('/api/auth', { apiKey: key })).status, 504);
  assert.equal((await request('/api/auth', { apiKey: 'too-short' })).status, 400);
  assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'config.json'))).apiKey, key);
});
