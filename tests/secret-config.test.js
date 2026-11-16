// The local server with an encrypting cipher, as inside Electron: a plain-text config.json from an older version is
// encrypted once the cipher is ready, nothing is written before that, and every later save keeps the keys encrypted.
// Synthetic keys only; Torn API replies come from the stub below.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { fakeCipher } = require('./fake-secret-cipher');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-secret-config-tests-'));
process.env.TORN_DATA_DIR = temp;
process.env.TORN_API_KEY = '';
process.env.TORN_PREMIUM_SERVICE_URL = '';

const KEY = 'SecretCfgKey0001', KEY_2 = 'SecretCfgKey0002', FF = 'SecretCfgFFKey01', LOG = 'SecretCfgLogKy01', FF_2 = 'SecretCfgFFKey02';
const SECRETS = [KEY, KEY_2, FF, LOG, FF_2];
const realFetch = global.fetch;
global.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.torn.com') throw new Error('Unexpected external request: ' + url.hostname);
  const reply = (value) => ({ ok: true, status: 200, text: async () => JSON.stringify(value), json: async () => value });
  if (![KEY, KEY_2].includes(url.searchParams.get('key'))) return reply({ error: { code: 2, error: 'Incorrect key' } });
  if (url.pathname === '/key/') return reply({ access_level: 3, access_type: 'Limited Access' });
  if (url.pathname === '/user/' && url.searchParams.get('selections') === 'basic') return reply({ player_id: 4242, name: 'Synthetic', level: 10 });
  return reply({ error: { code: 7, error: 'Incorrect ID-entity relation' } });
};

const CONFIG_FILE = path.join(temp, 'config.json');
const LEGACY = JSON.stringify({ apiKey: KEY, ffscouterKey: FF, logKey: LOG, lang: 'tr', theme: 'ocean', features: { 'page.travel': false, 'app.updates': false } });
fs.writeFileSync(CONFIG_FILE, LEGACY);

// Electron: safeStorage works only once the app is ready.
let appReady;
const ready = new Promise((resolve) => { appReady = resolve; });
const secretStoreLib = require('../src/server/secret-store');
secretStoreLib.defaultCipher = () => fakeCipher('alice', { whenReady: () => ready });
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
  if (!resolved.startsWith(root) || !path.basename(resolved).startsWith('lrx-secret-config-tests-')) throw new Error('Unsafe test cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});
const diskText = () => fs.readFileSync(CONFIG_FILE, 'utf8');
const disk = () => JSON.parse(diskText());
const keysOnDisk = () => createReader().open(disk()).values;
const createReader = () => secretStoreLib.createSecretStore(fakeCipher('alice'));
const noKeyText = () => SECRETS.filter((secret) => diskText().includes(secret));

test('the API waits for the cipher and nothing is written before it is ready', async () => {
  let answered = false;
  const pending = request('/api/config').then((r) => { answered = true; return r; });
  const pendingSave = request('/api/features', { features: { 'app.splash': false } }); // a save asked for meanwhile
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(answered, false, 'no answer before the keys are known');
  assert.equal(diskText(), LEGACY, 'the file is untouched');

  appReady();
  assert.equal((await pendingSave).status, 200);
  const { status, data } = await pending;
  assert.equal(status, 200);
  assert.equal(data.hasKey, true);
  assert.equal(data.secretStorage, 'encrypted');
  assert.equal(data.secretsUnreadable, false);
  assert.ok(data.ffscouterKeyMasked && data.logKeyMasked);
});

test('plain-text keys are encrypted on the first start; settings stay readable for Electron', () => {
  assert.deepEqual(noKeyText(), [], 'no key text in config.json');
  const saved = disk();
  for (const field of ['apiKey', 'ffscouterKey', 'logKey']) assert.equal(field in saved, false, field);
  assert.equal(saved.lang, 'tr');
  assert.deepEqual(saved.features, { 'page.travel': false, 'app.updates': false, 'app.splash': false });
  assert.equal(saved.secrets.format, 'lrx-secrets');
  assert.deepEqual(keysOnDisk(), { apiKey: KEY, ffscouterKey: FF, logKey: LOG });
});

test('saving keys and settings keeps every key encrypted', async () => {
  assert.equal((await request('/api/config', { ffscouterKey: FF_2, theme: 'forest' })).status, 200);
  assert.equal((await request('/api/auth', { apiKey: KEY_2 })).status, 200);
  assert.deepEqual(noKeyText(), []);
  assert.equal(disk().theme, 'forest');
  assert.deepEqual(keysOnDisk(), { apiKey: KEY_2, ffscouterKey: FF_2, logKey: LOG });
  const boot = (await request('/api/bootstrap')).data.config;
  assert.equal(boot.hasKey, true); assert.equal(boot.secretStorage, 'encrypted'); assert.equal(boot.secretsUnreadable, false);
});

test('Log Out removes the keys from the file', async () => {
  assert.equal((await request('/api/logout', {})).status, 200);
  const saved = disk();
  assert.equal('secrets' in saved, false);
  assert.deepEqual([saved.apiKey, saved.ffscouterKey, saved.logKey], ['', '', '']);
  assert.equal((await request('/api/config')).data.hasKey, false);
});
