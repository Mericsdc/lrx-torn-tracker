// Keys encrypted by another Windows account (or with a reset app profile) can't be read: the server says so, asks
// for the key again and keeps the encrypted entry in config.json until a new key is saved. Synthetic keys only.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { fakeCipher } = require('./fake-secret-cipher');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-secret-unreadable-tests-'));
process.env.TORN_DATA_DIR = temp;
process.env.TORN_API_KEY = '';
process.env.TORN_PREMIUM_SERVICE_URL = '';

const OLD_KEY = 'UnreadableKey001', OLD_FF = 'UnreadableFFKey1', NEW_KEY = 'UnreadableKey002';
const realFetch = global.fetch;
global.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.torn.com') throw new Error('Unexpected external request: ' + url.hostname);
  const reply = (value) => ({ ok: true, status: 200, text: async () => JSON.stringify(value), json: async () => value });
  if (url.searchParams.get('key') !== NEW_KEY) return reply({ error: { code: 2, error: 'Incorrect key' } });
  if (url.pathname === '/key/') return reply({ access_level: 3, access_type: 'Limited Access' });
  if (url.pathname === '/user/' && url.searchParams.get('selections') === 'basic') return reply({ player_id: 5151, name: 'Synthetic', level: 10 });
  return reply({ error: { code: 7, error: 'Incorrect ID-entity relation' } });
};

const secretStoreLib = require('../src/server/secret-store');
const CONFIG_FILE = path.join(temp, 'config.json');
// Written by the app under another Windows account.
const foreign = secretStoreLib.createSecretStore(fakeCipher('alice')).seal({ apiKey: OLD_KEY, ffscouterKey: OLD_FF, lang: 'en', theme: 'amethyst', features: {} });
fs.writeFileSync(CONFIG_FILE, JSON.stringify(foreign, null, 2));

secretStoreLib.defaultCipher = () => fakeCipher('bob');
const { server, flushData } = require('../src/server/server');

const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
async function request(route, body) {
  await listening;
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
  if (!resolved.startsWith(root) || !path.basename(resolved).startsWith('lrx-secret-unreadable-tests-')) throw new Error('Unsafe test cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});
const disk = () => JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

test('unreadable keys are reported and the app asks for a key, without crashing or wiping', async () => {
  const boot = await request('/api/bootstrap');
  assert.equal(boot.status, 200);
  assert.equal(boot.data.config.hasKey, false);
  assert.equal(boot.data.config.secretsUnreadable, true);
  assert.equal(boot.data.config.secretStorage, 'encrypted');
  assert.equal(boot.data.config.theme, 'amethyst', 'the readable settings still load');
  assert.equal((await request('/api/overview')).data.code, 'NO_KEY');

  // Changing a setting before signing in keeps the encrypted keys for the account that can read them.
  assert.equal((await request('/api/features', { features: { 'app.splash': false } })).status, 200);
  assert.deepEqual(disk().secrets, foreign.secrets);
  assert.equal(disk().features['app.splash'], false);
});

test('signing in with a new key replaces the unreadable entry with one this account can read', async () => {
  const login = await request('/api/auth', { apiKey: NEW_KEY });
  assert.equal(login.status, 200);
  const config = (await request('/api/config')).data;
  assert.equal(config.hasKey, true);
  assert.equal(config.secretsUnreadable, false);
  const saved = disk();
  assert.notDeepEqual(saved.secrets, foreign.secrets);
  assert.equal(JSON.stringify(saved).includes(NEW_KEY), false);
  assert.equal(secretStoreLib.createSecretStore(fakeCipher('bob')).open(saved).values.apiKey, NEW_KEY);
});
