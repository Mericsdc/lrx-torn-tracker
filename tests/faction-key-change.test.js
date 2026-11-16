// The weekly faction report walks every member, one Torn call at a time. When another player signs in
// while it runs, it must stop: it must not keep fetching the previous faction's members with the new key.
// Synthetic keys and players only; every Torn API reply comes from the stub below.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-faction-key-tests-'));
process.env.TORN_DATA_DIR = temp;
process.env.TORN_API_KEY = '';
process.env.TORN_PREMIUM_SERVICE_URL = '';

const KEY_A = 'AlphaKey00000001', KEY_B = 'BravoKey00000001';
const PLAYERS = { [KEY_A]: { id: 111, name: 'Alpha', faction: 900 }, [KEY_B]: { id: 222, name: 'Bravo', faction: 0 } };
const MEMBERS = [111, 501, 502, 503, 504];
const memberCalls = []; // [key, member id]
const realFetch = global.fetch;
global.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.torn.com') throw new Error('Unexpected external request: ' + url.hostname);
  const reply = (value) => ({ ok: true, status: 200, text: async () => JSON.stringify(value), json: async () => value });
  const key = url.searchParams.get('key'), player = PLAYERS[key];
  if (!player) return reply({ error: { code: 2, error: 'Incorrect key' } });
  const p = url.pathname, selections = url.searchParams.get('selections') || '';
  if (p === '/key/') return reply({ info: { access_level: 3, access_type: 'Limited Access' } });
  if (p === '/user/' && selections === 'basic') return reply({ player_id: player.id, name: player.name, level: 10 });
  if (p === '/v2/user/basic') return reply({ profile: { id: player.id, name: player.name } });
  if (p === '/v2/user/faction') return reply({ faction: player.faction ? { id: player.faction, name: 'Fixture', tag: 'FX', position: 'Leader' } : null });
  if (p === '/v2/faction/basic') return reply({ basic: { id: player.faction, leader_id: player.id, co_leader_id: 0, members: MEMBERS.length } });
  if (p === '/v2/faction/members') return reply({ members: MEMBERS.map((id) => ({ id, name: 'M' + id, level: 10, position: 'Member' })) });
  const m = p.match(/^\/v2\/user\/(\d+)\/personalstats$/);
  if (m) { memberCalls.push([key, Number(m[1])]); return reply({ personalstats: [{ name: 'xantaken', value: 1 }] }); }
  if (p === '/v2/faction/contributors') return reply({ contributors: [] });
  return reply({ error: { code: 7, error: 'Incorrect ID-entity relation' } });
};

fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ apiKey: KEY_A }));

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
  if (!resolved.startsWith(root) || !path.basename(resolved).startsWith('lrx-faction-key-tests-')) throw new Error('Unsafe test cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});
const until = async (check, ms = 10_000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)); } };

test('a running faction report stops when another player signs in', { timeout: 30_000 }, async () => {
  const started = await request('/api/faction/report', {});
  assert.equal(started.status, 200, JSON.stringify(started.data));
  await until(() => memberCalls.length >= 1);
  const signIn = await request('/api/auth', { apiKey: KEY_B });
  assert.equal(signIn.status, 200, JSON.stringify(signIn.data));
  const callsAtSwitch = memberCalls.length;
  await new Promise((r) => setTimeout(r, 4000)); // the job waits 1.5 s between members
  assert.deepEqual(memberCalls.filter(([key]) => key === KEY_B), [], 'no member of the old faction is fetched with the new key');
  assert.ok(memberCalls.length <= callsAtSwitch + 1, 'at most the call already in flight finishes');
});
