const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-electron-'));
const dataDir = path.join(temp, 'data'); fs.mkdirSync(dataDir);
fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ features: { 'app.torntools': false, 'app.updates': false, 'page.travel': false, 'app.splash': false, 'app.animations': false } }));
let app;
(async () => {
  app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../../TornTracker.exe'), args: ['--user-data-dir=' + path.join(temp, 'profile')], env: { ...process.env, TT_DATA_DIR: dataDir, TT_LOG_FILE: path.join(temp, 'startup.log'), TORN_API_KEY: '' }, timeout: 20000 });
  const page = await app.firstWindow();
  await page.locator('#auth-key').waitFor({ state: 'visible' });
  const minimum = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMinimumSize());
  assert.deepEqual(minimum, [480, 400]);
  const key = 'AbCdEfGh12345678';
  // Restore the existing clipboard after checking the explicit paste action.
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    global.__qaClipboard = clipboard.read ? await Promise.all((await clipboard.read()).map(async (item) => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async (type) => [type, await item.getType(type)])))))) : { text: await clipboard.readText() };
    if (!Array.isArray(global.__qaClipboard)) {
      if (clipboard.readHTML) global.__qaClipboard.html = clipboard.readHTML();
      if (clipboard.readRTF) global.__qaClipboard.rtf = clipboard.readRTF();
      if (clipboard.readImage) global.__qaClipboard.image = clipboard.readImage();
    }
  });
  try {
    await app.evaluate(({ clipboard }, key) => clipboard.writeText(key), key);
    await page.locator('#auth-paste').click();
    assert.equal(await page.locator('#auth-key').inputValue(), key);
  } finally { await app.evaluate(async ({ clipboard }) => { await clipboard.write(global.__qaClipboard); delete global.__qaClipboard; }); }
  await page.locator('#auth-key').fill(''); await page.locator('#auth-key').pressSequentially(key);
  assert.equal(await page.locator('#auth-key').inputValue(), key);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 700));
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
  assert.deepEqual(size, [640, 700]);
  // Open a local fixture in the real native WebContentsView. No game account or requests.
  const localUrl = await page.evaluate(() => location.origin + '/index.html');
  await page.evaluate((url) => window.electronAPI.tabCreate({ id: 'native-test', url }), localUrl);
  await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].contentView.children[0].webContents;
    if (wc.isLoading()) await new Promise((resolve) => wc.once('did-stop-loading', resolve));
  });
  const view = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const view = w.contentView.children[0];
    return { width: w.getContentSize()[0], bounds: view.getBounds(), sandbox: view.webContents.getLastWebPreferences().sandbox };
  });
  assert.equal(view.bounds.width, view.width); assert.equal(view.bounds.y, 88); assert.equal(view.sandbox, true);
  await page.evaluate(() => window.electronAPI.setViewVisibility(false));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(650, 710));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].getVisible()), false);
  await page.evaluate(() => window.electronAPI.tabClose('native-test'));
  await app.evaluate(async ({ session }) => {
    await session.fromPartition('persist:torn_v2').protocol.handle('https', (req) => {
      const url = new URL(req.url);
      if (url.hostname === 'www.torn.com') return new Response('<!doctype html><html><head></head><body><div id="sidebarroot"><a id="test-link" href="/gym.php?rfcv=old">Gym</a></div><div id="profileroot"></div></body></html>', { headers: { 'Content-Type': 'text/html' } });
      return new Response(JSON.stringify({ fixture: true }), { headers: { 'Content-Type': 'application/json' } });
    });
  });
  await app.evaluate(() => {
    const original = global.fetch;
    global.__expectedFFKey = 'AbCdEfGh12345678';
    global.fetch = async (input, options) => {
      const url = new URL(String(input));
      if (['ffscouter.com', 'api.torn.com'].includes(url.hostname)) return new Response(JSON.stringify({ fixture: true, is_registered: true, usingSavedKey: url.searchParams.get('key') === global.__expectedFFKey }));
      return original(input, options);
    };
  });
  await page.evaluate(async () => {
    const response = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: 'AbCdEfGh12345678' }) });
    if (!response.ok) throw new Error('Fixture key could not be saved');
  });
  await page.evaluate(() => window.electronAPI.tabCreate({ id: 'script-test', url: 'https://www.torn.com/index.php' }));
  const check = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].contentView.children[0].webContents;
    if (wc.isLoading()) await new Promise((r) => wc.once('did-stop-loading', r));
    return await wc.executeJavaScript(`({guard:window.__lrxSessionGuard, ff:document.documentElement.getAttribute('__FF_SCOUTER_V2_INJECTED__'), mainReact:!!window.React})`);
  });
  assert.equal(check.guard, true); assert.equal(check.ff, '1'); assert.equal(check.mainReact, false);
  const bridgeResult = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].contentView.children[0].webContents;
    return wc.executeJavaScript(`new Promise((resolve) => { const timer=setTimeout(()=>resolve({error:'bridge timeout'}),8000); window.addEventListener('message', function listener(e){ if(e.data?.channel==='lrx-userscript-response' && e.data.id==='fixture'){clearTimeout(timer);window.removeEventListener('message',listener);resolve(e.data);}}); window.postMessage({channel:'lrx-userscript-request',script:'ff-scouter',id:'fixture',url:'https://ffscouter.com/api/v1/check-key?key=LRXMANAGEDKEY000'},location.origin); })`);
  });
  assert.equal(bridgeResult.response?.status, 200, JSON.stringify(bridgeResult));
  assert.equal(JSON.parse(bridgeResult.response.responseText).usingSavedKey, true);
  const generatedScript = fs.readFileSync(path.join(dataDir, 'extensions/lrx-userscripts/ff-scouter.js'), 'utf8');
  assert.ok(!generatedScript.includes('AbCdEfGh12345678'));
  assert.ok(generatedScript.includes('get key() { return LRX_MANAGED_KEY; }'));
  await page.evaluate(() => window.electronAPI.tabNavigate('script-test', 'https://www.torn.com/page.php?sid=ItemMarket'));
  const bazaar = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].contentView.children[0].webContents;
    if (wc.isLoading()) await new Promise((r) => wc.once('did-stop-loading', r));
    return wc.executeJavaScript(`new Promise((resolve) => { let tries=0; const check=()=>{const value=document.documentElement.getAttribute('data-lrx-script-tornw3b-bazaars');if(value||tries++>50)resolve(value);else setTimeout(check,50)};check();})`);
  });
  assert.equal(bazaar, 'loaded');
  await page.evaluate(() => window.electronAPI.tabClose('script-test'));
  assert.ok(!fs.readFileSync(path.join(temp, 'startup.log'), 'utf8').includes('UNHANDLED'));
  console.log(JSON.stringify({ result: 'PASS', checked: ['packaged executable startup', 'native clipboard paste', 'manual key entry', '480x400 minimum', '640x700 window', 'native view bounds', 'modal visibility during resize', 'session guard document-start', 'FF Scouter initialization', 'isolated React dependency', 'GM network bridge', 'TornW3B market injection'] }));
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await app?.close();
  const resolved = path.resolve(temp);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('lrx-electron-')) {
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Chromium can briefly retain cache handles. */ }
  }
});
