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
  app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../../TornTracker.exe'), args: ['--user-data-dir=' + path.join(temp, 'profile')], env: { ...process.env, TT_DATA_DIR: dataDir, TT_LOG_FILE: path.join(temp, 'startup.log'), TORN_API_KEY: '', TORN_PREMIUM_SERVICE_URL: '' }, timeout: 20000 });
  const page = await app.firstWindow();
  await page.locator('#auth-key').waitFor({ state: 'visible' });
  const minimum = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMinimumSize());
  assert.deepEqual(minimum, [480, 400]);
  const key = 'AbCdEfGh12345678';
  // Restore the existing clipboard after checking the explicit paste action.
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    global.__qaClipboard = clipboard.read ? await Promise.all((await clipboard.read()).filter((item) => item.types.length).map(async (item) => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async (type) => [type, await item.getType(type)])))))) : { text: await clipboard.readText() };
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
  } finally { await app.evaluate(async ({ clipboard }) => { if (!Array.isArray(global.__qaClipboard) || global.__qaClipboard.length) await clipboard.write(global.__qaClipboard); else clipboard.clear(); delete global.__qaClipboard; }); }
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
  await page.evaluate(() => window.electronAPI.setViewVisibility(true));

  // A tab opened through the app's own tab bar. Zooming the app page (Ctrl + / Ctrl -) scales the top bars:
  // the native view must start exactly below them, never over the toolbar and never leaving a gap.
  const views = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map((v) => ({ visible: v.getVisible(), y: v.getBounds().y })));
  const viewLoaded = () => app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].contentView.children[0].webContents;
    if (wc.isLoading()) await new Promise((resolve) => wc.once('did-stop-loading', resolve));
  });
  const menuClick = (label) => app.evaluate(({ Menu, BrowserWindow }, label) => {
    const w = BrowserWindow.getAllWindows()[0];
    Menu.getApplicationMenu().items.flatMap((m) => m.submenu?.items || []).find((i) => i.label === label).click(undefined, w, w.webContents);
  }, label);
  const aligned = async (label) => {
    const [zoom, contentWidth] = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return [w.webContents.getZoomFactor(), w.getContentSize()[0]]; });
    await page.waitForFunction(([z, width]) => Math.abs(window.innerWidth * z - width) < 3, [zoom, contentWidth]); // the zoom has reached the page
    const barsEnd = (await page.evaluate(() => document.querySelector('.browser-toolbar').getBoundingClientRect().bottom)) * zoom;
    const [view] = await views();
    assert.ok(Math.abs(view.y - barsEnd) <= 1, `${label}: the view starts at ${view.y} but the top bars end at ${barsEnd}`);
  };
  await page.evaluate((url) => { openInTab(url, { activate: true }); }, localUrl);
  await page.waitForFunction(() => document.querySelectorAll('#browser-tabs [data-ws-tab]').length === 1);
  await viewLoaded();
  await aligned('100%');
  await menuClick('Zoom In'); await menuClick('Zoom In'); await aligned('zoomed in');
  for (let i = 0; i < 4; i++) await menuClick('Zoom Out');
  await aligned('zoomed out');
  await menuClick('Actual Size'); await aligned('actual size');

  // Reload (Ctrl+R) acts on the Torn tab being viewed and leaves the app page alone.
  await page.evaluate(() => { window.qaAppPageKept = true; });
  await app.evaluate(({ BrowserWindow }) => { global.__qaReloads = 0; BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.on('did-start-loading', () => { global.__qaReloads++; }); });
  await menuClick('Reload');
  await app.evaluate(async () => { for (let i = 0; i < 100 && !global.__qaReloads; i++) await new Promise((resolve) => setTimeout(resolve, 50)); });
  await viewLoaded();
  assert.ok(await app.evaluate(() => global.__qaReloads) >= 1, 'the viewed tab reloaded');
  assert.equal(await page.evaluate(() => window.qaAppPageKept), true, 'the app page did not reload');

  // Reloading the app page itself (Ctrl+Shift+R, a recovered crash) keeps the open tab in the tab bar and on screen.
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#browser-tabs [data-ws-tab]').length === 1 && state.activeWsTab === 'tab-1');
  assert.deepEqual((await views()).map((v) => v.visible), [true]);
  // A tab never loads a script URL or a local file, whatever the app page asks for.
  await page.evaluate(() => window.electronAPI.tabNavigate('tab-1', 'javascript:document.title="scripted"'));
  await page.evaluate(() => window.electronAPI.tabNavigate('tab-1', 'file:///C:/Windows/win.ini'));
  await page.evaluate(() => window.electronAPI.tabCreate({ id: 'file-tab', url: 'file:///C:/Windows/win.ini' }));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const tabState = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map((v) => ({ url: v.webContents.getURL(), title: v.webContents.getTitle() })));
  assert.equal(tabState.length, 1); assert.equal(tabState[0].url, localUrl); assert.notEqual(tabState[0].title, 'scripted');
  await page.locator('[data-close-tab="tab-1"]').dispatchEvent('click');
  await page.waitForFunction(() => document.querySelectorAll('#browser-tabs [data-ws-tab]').length === 0 && state.activeWsTab === 'tracker');
  assert.deepEqual(await views(), []);
  await app.evaluate(async ({ session }) => {
    await session.fromPartition('persist:torn_v2').protocol.handle('https', (req) => {
      const url = new URL(req.url);
      // A page that sends itself to a new URL every 700 ms: too slow for the burst limit, caught by the slow-loop limit.
      if (url.hostname === 'www.torn.com' && url.pathname === '/loop.php') {
        global.__qaLoopLoads = (global.__qaLoopLoads || 0) + 1;
        const n = Number(url.searchParams.get('n')) || 0;
        return new Response(`<!doctype html><html><body>loop ${n}<script>setInterval(() => { location.href = '/loop.php?n=${n + 1}'; }, 700);</script></body></html>`, { headers: { 'Content-Type': 'text/html' } });
      }
      if (url.hostname === 'www.torn.com') return new Response('<!doctype html><html><head></head><body><div id="sidebarroot"><a id="test-link" href="/gym.php?rfcv=old">Gym</a></div><div id="profileroot"></div></body></html>', { headers: { 'Content-Type': 'text/html' } });
      return new Response(JSON.stringify({ fixture: true }), { headers: { 'Content-Type': 'application/json' } });
    });
  });
  await app.evaluate(() => {
    const original = global.fetch;
    global.__expectedFFKey = 'AbCdEfGh12345678';
    global.fetch = async (input, options) => {
      const url = new URL(String(input));
      // Saving a key in Settings asks Torn who owns it: answer for the fixture key, never the real API.
      if (url.hostname === 'api.torn.com' && url.pathname === '/key/') return new Response(JSON.stringify({ access_level: 3, access_type: 'Limited Access' }));
      if (url.hostname === 'api.torn.com' && url.pathname === '/user/' && url.searchParams.get('selections') === 'basic') return new Response(JSON.stringify({ player_id: 4242, name: 'Fixture player', level: 1 }));
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
  // LRX page helpers are injected for the page they match and only there: the sell guard and the purchase costs sent
  // with it exist on the market page, and nothing of them is left in the next page the tab shows.
  const helperState = () => app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].contentView.children[0].webContents;
    if (wc.isLoading()) await new Promise((r) => wc.once('did-stop-loading', r));
    await new Promise((r) => setTimeout(r, 700));
    return wc.executeJavaScript(`({ guard: window.__lrxSellGuard === true, costs: typeof window.__lrxCosts, lang: window.__lrxLang })`);
  });
  assert.deepEqual(await helperState(), { guard: true, costs: 'object', lang: 'en' });
  await page.evaluate(() => window.electronAPI.tabNavigate('script-test', 'https://www.torn.com/index.php'));
  assert.deepEqual(await helperState(), { guard: false, costs: 'undefined', lang: undefined });
  // A tab that keeps navigating by itself is stopped after 8 navigations nobody asked for, with one notice;
  // a click in the page lets it continue.
  await page.evaluate(() => {
    window.__qaToasts = [];
    new MutationObserver(() => window.__qaToasts.push(document.querySelector('#toast').textContent)).observe(document.querySelector('#toast'), { childList: true, characterData: true, subtree: true });
  });
  await page.evaluate(() => window.electronAPI.tabNavigate('script-test', 'https://www.torn.com/loop.php?n=0'));
  const settledLoads = () => app.evaluate(async () => {
    let last = -1;
    for (let i = 0; i < 60 && last !== global.__qaLoopLoads; i++) { last = global.__qaLoopLoads; await new Promise((r) => setTimeout(r, 2500)); }
    return global.__qaLoopLoads;
  });
  assert.equal(await settledLoads(), 9, 'the first load and 8 page navigations, then the loop is stopped');
  const loopToasts = await page.evaluate(() => window.__qaToasts.filter((text) => text.includes('kept changing pages on its own')).length);
  assert.equal(loopToasts, 1, 'one notice for the stopped loop');
  await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].contentView.children[0].webContents;
    wc.sendInputEvent({ type: 'mouseDown', x: 20, y: 20, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: 20, y: 20, button: 'left', clickCount: 1 });
  });
  assert.ok(await settledLoads() > 9, 'a click in the page lets it navigate again');
  await page.evaluate(() => window.electronAPI.tabClose('script-test'));
  // The app page's renderer dies: the page comes back by itself instead of leaving a blank window.
  // (Last step: only the main process is asked from here on.)
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer(); });
  const recovered = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    for (let i = 0; i < 100; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (wc.isCrashed() || wc.isLoading()) continue;
      try { if (await wc.executeJavaScript('!!document.querySelector("#workspace-bar") && typeof startApp === "function"')) return true; } catch {}
    }
    return false;
  });
  assert.equal(recovered, true, 'the app page reloads after its renderer process is gone');
  const startupLog = fs.readFileSync(path.join(temp, 'startup.log'), 'utf8');
  assert.ok(startupLog.includes('app page renderer gone'));
  assert.ok(!startupLog.includes('UNHANDLED'));
  console.log(JSON.stringify({ result: 'PASS', checked: ['packaged executable startup', 'native clipboard paste', 'manual key entry', '480x400 minimum', '640x700 window', 'native view bounds', 'modal visibility during resize', 'tab view follows app zoom', 'Reload acts on the viewed tab', 'tabs survive an app page reload', 'session guard document-start', 'FF Scouter initialization', 'isolated React dependency', 'GM network bridge', 'TornW3B market injection', 'page helpers run only on their own page', 'self-navigating tab stopped until the user clicks', 'app page recovers from a renderer crash'] }));
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await app?.close();
  const resolved = path.resolve(temp);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('lrx-electron-')) {
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Chromium can briefly retain cache handles. */ }
  }
});
