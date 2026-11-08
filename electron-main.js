const { app, BrowserWindow, WebContentsView, session, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// 1. Remove AutomationControlled flag and align User-Agent with the EXACT Chromium version
// so Cloudflare Turnstile (main frame + Web Workers + Sec-CH-UA Client Hints) match 100%.
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
const exactChromeUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
app.userAgentFallback = exactChromeUA;

// Google, Electron/gömülü tarayıcılarda "Google ile giriş"i engelliyor (kimlik gizleme de algılanıyor).
// Google giriş sayfasına gidilmek istendiğinde girişi gerçek Chrome/Edge'de yaptırıp oturumu aktarıyoruz.
const isGoogleAuthUrl = (u) => /^https:\/\/accounts\.(google\.[a-z.]+|youtube\.com)\//i.test(String(u || ''));
const isTornUrl = (u) => /^https?:\/\/([^/]+\.)?torn\.com(\/|$)/i.test(String(u || ''));

const isPackaged = app.isPackaged;
const DEFAULT_UPDATE_URL = require('./package.json').updateUrl || '';
const APP_ICON = path.join(__dirname, 'assets', 'icon.ico');
if (process.platform === 'win32') app.setAppUserModelId('com.lrx.torntracker');
const exeDir = path.dirname(process.execPath);
const bundledDataDir = path.join(__dirname, 'data');
const persistentDataDir = process.env.TT_DATA_DIR || (isPackaged ? path.join(exeDir, 'data') : bundledDataDir);
const logFile = path.join(isPackaged ? exeDir : __dirname, 'startup.log');

function log(...args) {
  try {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')}\n`);
  } catch {}
}

process.on('uncaughtException', (err) => log('UNCAUGHT:', err));
process.on('unhandledRejection', (err) => log('UNHANDLED:', err));

// Tek örnek: ikinci kez açılırsa mevcut pencereyi öne getir (port & oturum çakışmasını önler)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  if (!fs.existsSync(persistentDataDir)) {
    fs.mkdirSync(persistentDataDir, { recursive: true });
  }
  if (isPackaged && fs.existsSync(bundledDataDir) && path.resolve(bundledDataDir) !== path.resolve(persistentDataDir)) {
    for (const fname of ['config.json', 'history.json']) {
      const src = path.join(bundledDataDir, fname);
      const dst = path.join(persistentDataDir, fname);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        try { fs.copyFileSync(src, dst); } catch {}
      }
    }
  }
  process.env.TORN_DATA_DIR = persistentDataDir;

  const { startServer } = require('./server');
  const { ensureTornTools } = require('./torntools');
  const { externalGoogleLogin } = require('./external-login');
  const updater = require('./updater');
  const serverPromise = startServer(3737);

  const PARTITION = 'persist:torn_v2';
  const TOP_BAR_HEIGHT = 88; // 44px workspace-bar + 44px browser-toolbar

  let mainWindow = null;
  const tabs = new Map(); // tabId -> { id, view, url, loggedIn }
  let activeTabId = 'tracker';
  const tornTools = { status: 'loading', id: null, version: null, error: null };

  function layoutViews() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [width, height] = mainWindow.getContentSize();
    for (const [id, t] of tabs.entries()) {
      if (activeTabId === id) {
        t.view.setVisible(true);
        t.view.setBounds({
          x: 0,
          y: TOP_BAR_HEIGHT,
          width: Math.max(100, width),
          height: Math.max(100, height - TOP_BAR_HEIGHT),
        });
      } else {
        t.view.setVisible(false);
      }
    }
  }

  function sendTabUpdate(id) {
    const t = tabs.get(id);
    if (!t || !mainWindow || mainWindow.isDestroyed()) return;
    const wc = t.view.webContents;
    if (wc.isDestroyed()) return;
    mainWindow.webContents.send('tab-updated', {
      id,
      url: wc.getURL() || t.url,
      title: wc.getTitle() || '',
      loading: wc.isLoading(),
      loggedIn: t.loggedIn,
    });
  }

  // Torn sayfası yüklendiğinde oturum açık mı? (sidebar varsa ve giriş formu yoksa açık)
  const LOGIN_CHECK_JS = `(() => {
    const hasSidebar = !!document.querySelector('#sidebarroot, #sidebar, [class*="sidebar___"]');
    const hasLoginForm = !!document.querySelector('form[action*="login"], input[type="password"]');
    const hasLogout = !!document.querySelector('a[href*="logout.php"]');
    return (hasSidebar || hasLogout) && !hasLoginForm;
  })()`;

  async function checkTornLogin(id) {
    const t = tabs.get(id);
    if (!t) return;
    const wc = t.view.webContents;
    if (wc.isDestroyed() || !isTornUrl(wc.getURL())) return;
    try {
      t.loggedIn = Boolean(await wc.executeJavaScript(LOGIN_CHECK_JS, true));
      sendTabUpdate(id);
    } catch {}
  }

  function sendToRenderer(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  }

  // Torn olmayan pop-up'lar (Google ile giriş vb.) ayrı küçük pencerede açılır.
  // Aynı oturumu (partition) paylaşırlar; böylece Google girişi Torn sekmesine geri döner.
  function popupWindowOptions() {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 520,
        height: 720,
        autoHideMenuBar: true,
        icon: APP_ICON,
        backgroundColor: '#111111',
        parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
        webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
      },
    };
  }

  function startExternalLogin() {
    externalGoogleLogin({
      profileDir: path.join(persistentDataDir, 'login-browser-profile'),
      targetSession: session.fromPartition(PARTITION),
      log,
      onStatus: (s) => {
        sendToRenderer('login-status', s);
        if (s.state === 'done') {
          for (const t of tabs.values()) {
            try { if (isTornUrl(t.view.webContents.getURL()) || !t.view.webContents.getURL()) t.view.webContents.reload(); } catch {}
          }
        }
      },
    });
  }

  // Google giriş sayfasına gitmeye çalışan her şeyi yakala → harici tarayıcı akışı
  function guardGoogleNavigation(wc) {
    const guard = (e, url) => {
      if (isGoogleAuthUrl(url)) { e.preventDefault(); startExternalLogin(); }
    };
    wc.on('will-navigate', (e, url) => guard(e, url));
    wc.on('will-redirect', (e, url) => guard(e, url));
  }

  ipcMain.handle('open-external', async (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle('tab-create', async (_event, { id, url, activate = true }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    mainWindow.contentView.addChildView(view);
    tabs.set(id, { id, view, url, loggedIn: null });

    if (activate) {
      activeTabId = id;
    }
    // Set initial bounds BEFORE loadURL so Cloudflare Turnstile never sees 0x0 viewport
    const [width, height] = mainWindow.getContentSize();
    view.setBounds({
      x: 0,
      y: TOP_BAR_HEIGHT,
      width: Math.max(800, width),
      height: Math.max(500, height - TOP_BAR_HEIGHT),
    });
    layoutViews();

    const wc = view.webContents;
    const openHandler = ({ url: targetUrl }) => {
      if (targetUrl && isGoogleAuthUrl(targetUrl)) {
        startExternalLogin();
        return { action: 'deny' };
      }
      if (targetUrl && isTornUrl(targetUrl)) {
        sendToRenderer('open-tab', targetUrl);
        return { action: 'deny' };
      }
      return popupWindowOptions();
    };
    wc.setWindowOpenHandler(openHandler);
    wc.on('did-create-window', (win) => {
      guardGoogleNavigation(win.webContents);
      win.webContents.setWindowOpenHandler(openHandler);
    });
    guardGoogleNavigation(wc);

    wc.on('did-start-loading', () => sendTabUpdate(id));
    wc.on('did-stop-loading', () => { sendTabUpdate(id); checkTornLogin(id); });
    wc.on('page-title-updated', () => sendTabUpdate(id));
    wc.on('did-navigate', () => sendTabUpdate(id));
    wc.on('did-navigate-in-page', () => sendTabUpdate(id));

    wc.loadURL(url).catch((e) => log('loadURL err:', e.message));
    return { id, url };
  });

  ipcMain.handle('tab-activate', async (_event, tabId) => {
    activeTabId = tabId || 'tracker';
    layoutViews();
    if (activeTabId !== 'tracker' && tabs.has(activeTabId)) {
      sendTabUpdate(activeTabId);
      tabs.get(activeTabId).view.webContents.focus();
    }
  });

  ipcMain.handle('tab-close', async (_event, tabId) => {
    const t = tabs.get(tabId);
    if (!t) return;
    tabs.delete(tabId);
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.contentView.removeChildView(t.view);
      }
      t.view.webContents.close();
    } catch {}
    layoutViews();
  });

  ipcMain.handle('tab-navigate', async (_event, { tabId, url }) => {
    const t = tabs.get(tabId);
    if (!t) return;
    t.url = url;
    t.view.webContents.loadURL(url).catch((e) => log('nav err:', e.message));
  });

  /* Profil sayfasından Torn private chat'i açıp mesajı gönderir.
     Selector'lar TornTools'un chat v3 seçicileriyle aynı (#chatRoot [class*='item___'] …). */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitProfileLoaded(wc, ms = 25000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (wc.isDestroyed()) return false;
      if (!wc.isLoading() && /profiles\.php/i.test(wc.getURL())) return true;
      await sleep(200);
    }
    return false;
  }
  const chatJs = (name, step) => `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(150); } return null; };
    const target = ${JSON.stringify(String(name || '').toLowerCase())};
    const boxes = () => [...document.querySelectorAll("#chatRoot [class*='item___']")].filter((b) => b.querySelector('textarea, button'));
    const findBox = () => boxes().find((b) => {
      const h = b.querySelector("button [class*='title___'], button [class*='name___'], [class*='chat-box-header__name']");
      return h && h.textContent.trim().toLowerCase().includes(target);
    });
    if (${JSON.stringify(step)} === 'open') {
      let box = findBox();
      if (!box) {
        const btn = await until(() => document.querySelector("a[class*='profile-button-initiateChat'], a[class*='initiateChat'], [class*='profile-button'][aria-label*='chat' i], [class*='profile-button'][title*='chat' i]"), 12000);
        if (!btn) return { ok: false, step: 'button' };
        btn.click();
        box = await until(findBox, 8000);
      }
      if (!box) return { ok: false, step: 'box' };
      let ta = box.querySelector('textarea');
      if (!ta) { box.querySelector('button')?.click(); ta = await until(() => box.querySelector('textarea'), 3000); }
      if (!ta) return { ok: false, step: 'textarea' };
      ta.scrollIntoView({ block: 'nearest' });
      ta.focus();
      return { ok: true };
    }
    const box = findBox();
    const ta = box && box.querySelector('textarea');
    if (!ta || !ta.value.trim()) return { ok: false, step: 'text' };
    const send = box.querySelector("[class*='chat-box-footer__send-icon-wrapper__'], button[class*='iconWrapper___']");
    if (send) { send.click(); await sleep(400); return { ok: true, sent: !ta.value.trim(), via: 'button' }; }
    return { ok: true, sent: false, via: 'none' };
  })()`;

  ipcMain.handle('torn-chat-send', async (_event, { tabId, name, message }) => {
    const t = tabs.get(tabId);
    if (!t) return { ok: false, step: 'tab' };
    const wc = t.view.webContents;
    try {
      if (!(await waitProfileLoaded(wc))) return { ok: false, step: 'load' };
      const opened = await wc.executeJavaScript(chatJs(name, 'open'), true);
      if (!opened?.ok) return opened || { ok: false, step: 'open' };
      wc.focus();
      await sleep(150);
      await wc.insertText(String(message || '').replace(/\s*\n+\s*/g, ' ').trim());
      await sleep(300);
      const res = await wc.executeJavaScript(chatJs(name, 'send'), true);
      if (res?.ok && !res.sent) {
        // Gönder butonu bulunamadı → gerçek Enter tuşu
        wc.focus();
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
        wc.sendInputEvent({ type: 'char', keyCode: '\r' });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        return { ok: true, sent: true, via: 'enter' };
      }
      return res;
    } catch (e) {
      log('torn-chat-send err:', e.message);
      return { ok: false, step: 'error', error: e.message };
    }
  });

  ipcMain.handle('tab-action', async (_event, { tabId, action }) => {
    const t = tabs.get(tabId);
    if (!t) return;
    const wc = t.view.webContents;
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === 'reload') wc.reload();
  });

  ipcMain.handle('set-view-visibility', async (_event, visible) => {
    if (!visible) {
      for (const t of tabs.values()) t.view.setVisible(false);
    } else {
      layoutViews();
    }
  });

  ipcMain.handle('torntools-info', async () => ({ ...tornTools }));
  ipcMain.handle('external-login', async () => { startExternalLogin(); });

  // ---- Güncelleme ----
  const updateUrl = () => {
    try { return JSON.parse(fs.readFileSync(path.join(persistentDataDir, 'config.json'), 'utf8')).updateUrl || DEFAULT_UPDATE_URL; } catch { return DEFAULT_UPDATE_URL; }
  };
  ipcMain.handle('app-version', async () => updater.currentVersion());
  ipcMain.handle('update-check', async () => {
    const url = updateUrl();
    if (!url) return { current: updater.currentVersion(), available: false, configured: false };
    try { return { ...(await updater.checkForUpdate(url)), configured: true }; }
    catch (e) { return { current: updater.currentVersion(), available: false, configured: true, error: e.message }; }
  });
  let updating = false;
  ipcMain.handle('update-apply', async () => {
    if (updating) return { ok: false, error: 'Güncelleme zaten sürüyor' };
    updating = true;
    try {
      await updater.applyUpdate(updateUrl(), (p) => sendToRenderer('update-progress', p));
      log('update applied, relaunching');
      setTimeout(() => { app.relaunch(); app.exit(0); }, 800);
      return { ok: true };
    } catch (e) {
      log('update err:', e.message);
      return { ok: false, error: e.message };
    } finally { updating = false; }
  });

  ipcMain.handle('set-torn-cookies', async (_event, { phpSessId, uid, pass, raw }) => {
    const tornSession = session.fromPartition(PARTITION);
    const exp = Math.floor(Date.now() / 1000) + 365 * 86400;
    const pairs = [];
    if (phpSessId && String(phpSessId).trim()) pairs.push(['PHPSESSID', String(phpSessId).trim()]);
    if (uid && String(uid).trim()) pairs.push(['uid', String(uid).trim()]);
    if (pass && String(pass).trim()) pairs.push(['pass', String(pass).trim()]);
    if (raw && String(raw).trim()) {
      for (const part of String(raw).split(';')) {
        const idx = part.indexOf('=');
        if (idx > 0) {
          const k = part.slice(0, idx).trim();
          const v = part.slice(idx + 1).trim();
          if (k && v) pairs.push([k, v]);
        }
      }
    }
    for (const [name, value] of pairs) {
      await tornSession.cookies.set({
        url: 'https://www.torn.com',
        domain: '.torn.com',
        path: '/',
        name,
        value,
        secure: true,
        sameSite: 'lax',
        expirationDate: exp,
      });
    }
    for (const t of tabs.values()) {
      try { t.view.webContents.reload(); } catch {}
    }
    return { count: pairs.length };
  });

  function setupTornSession(tornSession) {
    tornSession.setUserAgent(exactChromeUA);
  }

  function featureEnabled(key) {
    try { return JSON.parse(fs.readFileSync(path.join(persistentDataDir, 'config.json'), 'utf8')).features?.[key] !== false; } catch { return true; }
  }

  async function setupTornTools(tornSession) {
    if (!featureEnabled('app.torntools')) {
      Object.assign(tornTools, { status: 'disabled', error: null });
      log('TornTools ayarlardan kapalı, yüklenmedi.');
      sendToRenderer('torntools-status', { ...tornTools });
      return;
    }
    try {
      const info = await ensureTornTools({ baseDir: persistentDataDir, log });
      const loader = tornSession.extensions && typeof tornSession.extensions.loadExtension === 'function'
        ? tornSession.extensions : tornSession;
      const ext = await loader.loadExtension(info.dir, { allowFileAccess: false });
      Object.assign(tornTools, { status: 'ready', id: ext.id, version: ext.version || info.version, error: info.error || null });
      log('TornTools yüklendi:', ext.id, tornTools.version);

      // Arka plan servis çalışanını canlı tut (Electron'da chrome.alarms yok, zamanlayıcılar shim'de)
      const scope = `chrome-extension://${ext.id}/`;
      const ping = () => {
        try {
          if (tornSession.serviceWorkers && typeof tornSession.serviceWorkers.startWorkerForScope === 'function') {
            tornSession.serviceWorkers.startWorkerForScope(scope).catch(() => {});
          }
        } catch {}
      };
      ping();
      setInterval(ping, 20_000);

      // Eklenti yüklenmeden açılmış Torn sekmelerini yenile ki içerik betikleri çalışsın
      for (const t of tabs.values()) {
        try { if (isTornUrl(t.view.webContents.getURL())) t.view.webContents.reload(); } catch {}
      }
    } catch (e) {
      Object.assign(tornTools, { status: 'error', error: e.message });
      log('TornTools yüklenemedi:', e);
    }
    sendToRenderer('torntools-status', { ...tornTools });
  }

  async function createWindow() {
    try {
      const tornSession = session.fromPartition(PARTITION);
      setupTornSession(tornSession);
      setupTornTools(tornSession);

      const port = await serverPromise;

      mainWindow = new BrowserWindow({
        width: 1560,
        height: 960,
        minWidth: 1120,
        minHeight: 720,
        show: true,
        title: 'LRX Torn Tracker',
        icon: APP_ICON,
        backgroundColor: '#040506',
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      mainWindow.on('resize', layoutViews);
      mainWindow.on('maximize', layoutViews);
      mainWindow.on('unmaximize', layoutViews);

      mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url && /^(https?|chrome-extension):\/\//i.test(url)) {
          sendToRenderer('open-tab', url);
        }
        return { action: 'deny' };
      });

      mainWindow.show();
      mainWindow.focus();
      mainWindow.loadURL(`http://127.0.0.1:${port}`);
      log('mainWindow ready on port', port);
    } catch (err) {
      log('createWindow ERROR:', err);
    }
  }

  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    app.quit();
  });
}
