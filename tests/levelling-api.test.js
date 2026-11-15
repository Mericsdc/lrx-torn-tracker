// Baldr's Levelling Targets on the server: "I attacked this target" makes the slow status scan check it again soon,
// only for a target of the current list. Synthetic key, list and replies only.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-levelling-tests-'));
process.env.TORN_DATA_DIR = temp;
process.env.TORN_API_KEY = '';
process.env.TORN_PREMIUM_SERVICE_URL = '';
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ apiKey: 'LevellingKey0001' }));

const LIST = { 'List A': [{ id: 11, name: 'Old', lvl: '90', total: '120', str: '30', def: '30', spd: '30', dex: '30' }, { id: 12, name: 'Older', lvl: '80', total: '100', str: '25', def: '25', spd: '25', dex: '25' }] };
const checks = [];
const state = { 11: 'Okay', 12: 'Okay' };
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body) });
global.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname === 'raw.githubusercontent.com') return reply(JSON.stringify(LIST));
  if (url.hostname !== 'api.torn.com') throw new Error('Unexpected external request: ' + url.hostname);
  const id = Number(url.pathname.split('/')[2]);
  if (!(id > 0)) return reply(JSON.stringify({ error: { code: 2, error: 'Not part of this test' } }));
  checks.push(id);
  return reply(JSON.stringify({ player_id: id, level: 90, status: { state: state[id] || 'Okay', until: 0, description: '' } }));
};

const { server } = require('../src/server/server');
const ready = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
after(() => new Promise((resolve) => server.close(resolve)));
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

test('an attacked target of the current list is marked for a quick re-check', async () => {
  const page = await request('/api/levelling?list=List%20A');
  assert.equal(page.status, 200);
  assert.deepEqual(page.data.targets.map((t) => t.id), [11, 12]);
  const ok = await request('/api/levelling/attacked', { id: 12 });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data, { ok: true });
});

test('an id outside the current list, or not a player id, is refused and changes nothing', async () => {
  for (const id of [99, -1, 1.5, '12', null]) {
    const r = await request('/api/levelling/attacked', { id });
    assert.equal(r.status, 400, 'refused: ' + JSON.stringify(id));
  }
  assert.equal((await request('/api/levelling/attacked')).status, 405, 'GET is not an attack report');
});

test('the scan checks the attacked target again within about 20 s of the report', { timeout: 60_000 }, async () => {
  await request('/api/levelling?list=List%20A');
  // wait for the first round (both never checked) to finish
  const firstRound = Date.now();
  while (!(checks.includes(11) && checks.includes(12)) && Date.now() - firstRound < 15_000) {
    await request('/api/levelling?list=List%20A');
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(checks.includes(11) && checks.includes(12), 'both targets were checked once: ' + checks);
  state[12] = 'Hospital';
  await request('/api/levelling/attacked', { id: 12 });
  const before = checks.length, reported = Date.now();
  let seen = null;
  while (Date.now() - reported < 25_000) {
    const page = await request('/api/levelling?list=List%20A'); // the page polls; the scan runs only while it does
    seen = page.data.targets.find((t) => t.id === 12)?.status?.state;
    if (seen === 'Hospital') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(seen, 'Hospital', 'the attacked target was checked again: ' + checks.slice(before));
  assert.ok(Date.now() - reported < 22_000, 'within about 20 s');
});
