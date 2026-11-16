const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { buildUserscriptExtension, adaptOpenMarket } = require('../src/main/userscripts');

const root = path.join(__dirname, '..');
const build = (features) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-us-'));
  try {
    const dest = buildUserscriptExtension(dir, features);
    const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
    const file = path.join(dest, 'openmarket.js');
    return { manifest, openMarket: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('OpenMarket is loaded with labels only on the Item Market, bazaars and the Auction House', () => {
  const { manifest, openMarket } = build({});
  const entry = manifest.content_scripts.find((c) => c.js.includes('openmarket.js'));
  assert.deepEqual(entry, { matches: ['https://www.torn.com/page.php*', 'https://www.torn.com/bazaar.php*', 'https://www.torn.com/amarket.php*'], js: ['openmarket.js'], run_at: 'document_start', world: 'MAIN' });
  assert.match(openMarket, /^\(\(\) => \{ if \(location\.pathname === '\/page\.php' && new URLSearchParams\(location\.search\)\.get\('sid'\) !== 'ItemMarket'\) return;/);
  assert.doesNotMatch(openMarket, /innerHTML|\.click\(\)|new MouseEvent/);
  for (const off of ['enableDisplayCase: false,', 'enableInventory: false,', 'factionArmoury: false', 'LRX: sort menu entries off', 'LRX: filter sliders off']) assert.ok(openMarket.includes(off), off);
  assert.equal(openMarket.split("new DOMParser().parseFromString(String(titleAttr), 'text/html').body").length - 1, 3);
  const vendor = fs.readFileSync(path.join(root, 'userscripts', 'openmarket.user.js'), 'utf8');
  assert.match(vendor, /@grant\s+none/);
  assert.doesNotMatch(vendor, /GM_|@connect|sendBeacon|WebSocket|lrx-userscript-request/, 'OpenMarket itself sends nothing anywhere');
});

test('the OpenMarket switch removes it from the extension', () => {
  const { manifest, openMarket } = build({ 'torn.openMarketScript': false });
  assert.equal(openMarket, null);
  assert.ok(!manifest.content_scripts.some((c) => c.js.includes('openmarket.js')));
  assert.ok(manifest.content_scripts.some((c) => c.js.includes('tornw3b-bazaars.js')), 'other scripts stay');
});

test('the OpenMarket adapter refuses a version it was not written for', () => {
  const vendor = fs.readFileSync(path.join(root, 'userscripts', 'openmarket.user.js'), 'utf8');
  assert.throws(() => adaptOpenMarket(vendor.replace('function ensureQualitySlider() {', 'function ensureQualitySlider(x) {')), /no longer matches/);
  assert.throws(() => adaptOpenMarket(vendor + '\nel.innerHTML = "x";'), /does not cover/);
  assert.throws(() => adaptOpenMarket(vendor + '\nbutton.click();'), /does not cover/);
});

test('bundled OpenMarket matches its pinned upstream hash and GPL notice', () => {
  const sources = JSON.parse(fs.readFileSync(path.join(root, 'userscripts', 'sources.json'), 'utf8'));
  const list = Array.isArray(sources) ? sources : Object.values(sources).find(Array.isArray);
  const pinned = list.find((s) => s.file === 'openmarket.user.js');
  assert.equal(pinned.license, 'GPL-3.0');
  const bytes = fs.readFileSync(path.join(root, 'userscripts', pinned.file));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), pinned.sha256);
  assert.match(bytes.toString('utf8'), new RegExp(`@version\\s+${pinned.version.replace(/\./g, '\\.')}`));
  const notice = fs.readFileSync(path.join(root, 'userscripts', 'NOTICE.txt'), 'utf8');
  assert.match(notice, /OpenMarket 1\.11\.9[\s\S]*GPL version 3/);
  assert.match(notice, /Auto Bazaar Pricing" by swervelord \[3637232\]/);
});

const background = () => {
  let listener; const calls = [];
  const context = vm.createContext({ URL, AbortController, Response, setTimeout, clearTimeout,
    chrome: { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } },
    fetch: async (url, options) => { calls.push({ url, method: options.method }); return new Response('{"listings":[]}', { status: 200 }); } });
  vm.runInContext(fs.readFileSync(path.join(root, 'userscript-extension', 'background.js'), 'utf8'), context);
  const send = (message, from = 'https://www.torn.com/bazaar.php') => new Promise((resolve) => {
    listener({ channel: 'lrx-userscript-request', action: 'request', id: '1', ...message }, { url: from, tab: { id: 1 } }, resolve);
  });
  return { send, calls };
};

test('the bazaar helper can only read one item\'s weav3r.dev listings', async () => {
  const { send, calls } = background();
  const ok = await send({ script: 'lrx-bazaar-price', method: 'GET', url: 'https://weav3r.dev/api/marketplace/206' });
  assert.equal(ok.response.status, 200);
  for (const bad of [
    { method: 'POST', url: 'https://weav3r.dev/api/marketplace/206' },
    { method: 'GET', url: 'https://weav3r.dev/api/marketplace/206?sync=1' },
    { method: 'GET', url: 'https://weav3r.dev/api/bazaar/sync' },
    { method: 'GET', url: 'https://weav3r.dev/api/marketplace/abc' },
    { method: 'GET', url: 'https://api.torn.com/torn/?selections=items' },
    { method: 'GET', url: 'https://ffscouter.com/api/v1/check-key' },
  ]) assert.ok((await send({ script: 'lrx-bazaar-price', ...bad })).error, bad.url);
  assert.ok((await send({ script: 'lrx-bazaar-price', method: 'GET', url: 'https://weav3r.dev/api/marketplace/206' }, 'https://evil.example/')).error);
  assert.ok((await send({ script: 'tornw3b-bazaars', method: 'POST', url: 'https://weav3r.dev/api/marketplace/206' })).response, 'TornW3B keeps its own access');
  assert.deepEqual(calls, [{ url: 'https://weav3r.dev/api/marketplace/206', method: 'GET' }, { url: 'https://weav3r.dev/api/marketplace/206', method: 'POST' }]);
});

test('the bridge forwards the bazaar helper and still ignores unknown scripts', () => {
  let handler; const sent = [];
  const window = { addEventListener: (type, fn) => { if (type === 'message') handler = fn; }, postMessage() {} };
  vm.runInContext(fs.readFileSync(path.join(root, 'userscript-extension', 'bridge.js'), 'utf8'), vm.createContext({
    window, location: { origin: 'https://www.torn.com' }, chrome: { runtime: { sendMessage: (m) => sent.push(m.script) } } }));
  const post = (script, origin = 'https://www.torn.com', source = window) => handler({ source, origin, data: { channel: 'lrx-userscript-request', script } });
  post('lrx-bazaar-price'); post('openmarket'); post('lrx-bazaar-price', 'https://evil.example'); post('lrx-bazaar-price', 'https://www.torn.com', {});
  assert.deepEqual(sent, ['lrx-bazaar-price']);
});

test('the userscript relay only sends the GET and POST requests the scripts use, TornW3B only under /api/', async () => {
  const { send, calls } = background();
  for (const bad of [
    { script: 'tornw3b-bazaars', method: 'DELETE', url: 'https://weav3r.dev/api/marketplace/206' },
    { script: 'tornw3b-bazaars', method: 'PUT', url: 'https://weav3r.dev/api/bazaar' },
    { script: 'tornw3b-bazaars', method: 'PATCH', url: 'https://weav3r.dev/api/bazaar' },
    { script: 'tornw3b-bazaars', method: 'GET', url: 'https://weav3r.dev/admin' },
    { script: 'ff-scouter', method: 'DELETE', url: 'https://ffscouter.com/api/v1/get-stats' },
  ]) assert.ok((await send(bad)).error, `${bad.method} ${bad.url}`);
  assert.equal(calls.length, 0);
  assert.ok((await send({ script: 'tornw3b-bazaars', method: 'GET', url: 'https://weav3r.dev/api/marketplace/206' })).response);
  assert.ok((await send({ script: 'ff-scouter', method: 'GET', url: 'https://ffscouter.com/api/v1/get-stats?key=x&targets=1' })).response);
  assert.ok((await send({ script: 'ff-scouter', method: 'POST', url: 'https://ffscouter.com/claim-bounties' })).response);
  assert.equal(calls.length, 3);
});
