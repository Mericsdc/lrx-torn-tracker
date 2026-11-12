const { app, BrowserWindow, WebContentsView, session, shell, ipcMain, clipboard, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// 1. Remove AutomationControlled flag and align User-Agent with the EXACT Chromium version
// so Cloudflare Turnstile (main frame + Web Workers + Sec-CH-UA Client Hints) match 100%.
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
// Hafiflik: önceden açılmış yedek renderer süreci tutma (her zaman boşta ~20-40 MB)
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess');
const exactChromeUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
app.userAgentFallback = exactChromeUA;

// Google, Electron/gömülü tarayıcılarda "Google ile giriş"i engelliyor (kimlik gizleme de algılanıyor).
// Google giriş sayfasına gidilmek istendiğinde girişi gerçek Chrome/Edge'de yaptırıp oturumu aktarıyoruz.
const isGoogleAuthUrl = (u) => /^https:\/\/accounts\.(google\.[a-z.]+|youtube\.com)\//i.test(String(u || ''));
const isTornUrl = (u) => /^https?:\/\/([^/]+\.)?torn\.com(\/|$)/i.test(String(u || ''));

const { APP_ROOT } = require('../app-paths');
const isPackaged = app.isPackaged;
const DEFAULT_UPDATE_URL = require('../../package.json').updateUrl || '';
const APP_ICON = path.join(APP_ROOT, 'assets', 'icon.ico');
if (process.platform === 'win32') app.setAppUserModelId('com.lrx.torntracker');
const exeDir = path.dirname(process.execPath);
const bundledDataDir = path.join(APP_ROOT, 'data');
const persistentDataDir = process.env.TT_DATA_DIR || (isPackaged ? path.join(exeDir, 'data') : bundledDataDir);
const logFile = process.env.TT_LOG_FILE || path.join(isPackaged ? exeDir : APP_ROOT, 'startup.log');

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

  const { startServer, stockProductNames, ingestStockDeliveries, warMemberStatuses, warGroupLabels, flushData, myPlayerId, getCrimeValue, crimeValueForPage, purchaseCostsForPage, seasonalActive, halloweenForPage, ffScriptBridge } = require('../server/server');
  app.on('will-quit', () => { try { flushData(); } catch {} });
  const { ensureTornTools } = require('./torntools');
  const { externalGoogleLogin } = require('./external-login');
  const updater = require('./updater');
  const { normalizeTornSession, replaceTornCookies } = require('./torn-session');
  const { buildUserscriptExtension } = require('./userscripts');
  if (isPackaged) {
    try {
      const removed = updater.removeLegacyFiles();
      if (removed.length) log('Removed files left over from the old folder layout:', removed.join(', '));
    } catch (e) { log('Legacy file cleanup:', e.message); }
  }
  const serverPromise = startServer(3737);

  const PARTITION = 'persist:torn_v2';
  const TOP_BAR_HEIGHT = 88; // 44px workspace-bar + 44px browser-toolbar

  let mainWindow = null;
  let appOrigin = null; // http://127.0.0.1:<port>, set when the main window loads
  // Privileged IPC only answers the app's own page in the main window.
  const fromAppPage = (event) => {
    try { return !!appOrigin && !!mainWindow && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame && new URL(event.senderFrame.url).origin === appOrigin; } catch { return false; }
  };
  let tornRuntimeReady = Promise.resolve();
  const tabs = new Map(); // tabId -> { id, view, url, loggedIn }
  const pendingTabCreates = new Set();
  let activeTabId = 'tracker';
  let viewsVisible = true;
  const tornTools = { status: 'loading', id: null, version: null, error: null };

  function layoutViews() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [width, height] = mainWindow.getContentSize();
    for (const [id, t] of tabs.entries()) {
      if (viewsVisible && activeTabId === id) {
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
      url: t.sleptUrl || wc.getURL() || t.url,
      title: t.sleptUrl ? t.sleptTitle || '' : wc.getTitle() || '',
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

  /* Torn'un React sayfaları (Crimes 2.0 hub'ı vb.) oyuncu numarasını document.cookie'deki İLK `uid`
     değerinden okuyup crimesHubApi.php'ye userID olarak gönderir. Eski bir oturum aktarımından kalan
     yanlış/yinelenen `uid` çerezi öne geçerse Torn "Wrong api key" döner → "Invalid hub status batch response".
     Doğru numara sırasıyla: sayfanın bildirdiği kimlik, tek sayısal çerez, API key sahibinin numarası. */
  const UID_CHECK_JS = `(() => {
    let real = document.querySelector('script[uid][name]')?.getAttribute('uid') || '';
    if (!/^\\d+$/.test(real)) { try { real = String(JSON.parse(document.getElementById('torn-user')?.value || 'null')?.id ?? ''); } catch { real = ''; } }
    const uids = document.cookie.split(/;\\s*/).filter((c) => c.startsWith('uid=')).map((c) => decodeURIComponent(c.slice(4)));
    return { real: /^\\d+$/.test(real) ? real : null, uids };
  })()`;
  const uidShape = (v) => (/^\d+$/.test(v) ? `sayı(${v.length})` : `sayı değil(${v.length})`);

  function pickRealUid(r, loggedIn) {
    if (r.real) return r.real;
    const numeric = [...new Set(r.uids.filter((u) => /^\d+$/.test(u)))];
    if (numeric.length === 1) return numeric[0];
    const appId = myPlayerId();
    if (appId && (numeric.includes(appId) || (numeric.length === 0 && loggedIn))) return appId;
    return null;
  }

  async function repairUidCookie(id) {
    const t = tabs.get(id);
    if (!t || !featureEnabled('torn.sessionGuard')) return;
    const wc = t.view.webContents;
    if (wc.isDestroyed() || !isTornUrl(wc.getURL())) return;
    try {
      const r = await wc.executeJavaScript(UID_CHECK_JS, true);
      if (!r) return;
      const real = pickRealUid(r, t.loggedIn === true);
      if (!real) return; // giriş yapılmamış ya da numara belirsiz
      // Never reload here. Repair uid only when the logged-in page identifies
      // its owner explicitly; leave RFC/session cookies to Torn itself.
      if (r.uids.length && r.uids.every((u) => u === real)) return;
      if (t.loggedIn !== true || !r.real || t.uidRepairBusy) return;
      t.uidRepairBusy = true;
      try {
      const ses = wc.session;
      const urls = new Set((await ses.cookies.get({ name: 'uid' }))
        .filter((c) => /(^|\.)torn\.com$/i.test(c.domain))
        .map((c) => `https://${c.domain.replace(/^\./, '')}${c.path || '/'}`));
      for (const url of urls) { try { await ses.cookies.remove(url, 'uid'); } catch {} }
      await ses.cookies.set({
        url: 'https://www.torn.com', domain: '.torn.com', path: '/', name: 'uid', value: real,
        secure: true, sameSite: 'lax', expirationDate: Math.floor(Date.now() / 1000) + 365 * 86400,
      });
      try { await ses.cookies.flushStore(); } catch {}
      log('uid çerezi onarıldı:', `[${r.uids.map(uidShape).join(', ') || 'yok'}] → ${uidShape(real)}`);
      } finally { t.uidRepairBusy = false; }
    } catch (e) { log('uid onarım hatası:', e.message); }
  }

  function sendToRenderer(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  }

  /* ---- Crimes teşhisi: Crimes sayfası açılınca Torn'un Crimes isteklerini (crimesData / crimesHubApi.php)
     DevTools protokolüyle izler; yalnızca HATALI yanıtları startup.log'a yazar ve ilk sağlıklı hub yanıtında
     kendini kapatır. Anahtar/token alanları maskelenir, çerez değerleri yazılmaz. */
  const CRIMES_REQ = /\/(crimesHubApi\.php|page\.php\?[^#]*sid=crimesData)/i;
  const maskSecrets = (v, depth = 0) => {
    if (depth > 6 || v == null || typeof v !== 'object') return v;
    const out = Array.isArray(v) ? [] : {};
    for (const [k, x] of Object.entries(v)) {
      out[k] = /key|token|secret|pass|rfc/i.test(k) && x != null && typeof x !== 'object' ? `[gizli, ${String(x).length} karakter]` : maskSecrets(x, depth + 1);
    }
    return out;
  };
  const summarizeBody = (text) => {
    try {
      const j = maskSecrets(JSON.parse(text));
      const s = JSON.stringify(j);
      if (s.length <= 900) return s;
      const db = j && j.DB && typeof j.DB === 'object' ? j.DB : null;
      return `JSON ${s.length}b · keys=[${Object.keys(j || {}).join(',')}]${db ? ` · DB.keys=[${Object.keys(db).join(',')}] · DB.time=${db.time} · DB.error=${JSON.stringify(db.error ?? null)}` : ''} · ${s.slice(0, 400)}…`;
    } catch {
      return `metin ${text.length}b: ${text.replace(/\s+/g, ' ').slice(0, 500)}`;
    }
  };
  const hubOk = (text) => {
    try {
      const j = JSON.parse(text);
      const db = j && typeof j === 'object' && j.DB && typeof j.DB === 'object' ? j.DB : j;
      return !!db && typeof db === 'object' && !('error' in db) && !('error' in j);
    } catch { return false; }
  };
  const summarizeForm = (post) => {
    const fields = {};
    for (const m of String(post || '').matchAll(/name="([^"]+)"\r?\n\r?\n([^\r\n]*)/g)) fields[m[1]] = m[2];
    if (!Object.keys(fields).length) for (const [k, v] of new URLSearchParams(String(post || ''))) fields[k] = v;
    if (fields.userID != null) fields.userID = uidShape(String(fields.userID));
    return JSON.stringify(maskSecrets(fields));
  };

  async function watchCrimes(id) {
    const t = tabs.get(id);
    if (!t || t.crimesDiag) return;
    const wc = t.view.webContents;
    const dbg = wc.debugger;
    try { if (!dbg.isAttached()) dbg.attach('1.3'); } catch (e) { log('crimes-diag attach:', e.message); return; }
    t.crimesDiag = { count: 0, reqs: new Map() };
    const onDetach = () => { t.crimesDiag = null; dbg.removeListener('message', onMessage); dbg.removeListener('detach', onDetach); };
    t.crimesDiag.stop = () => { try { if (dbg.isAttached()) dbg.detach(); } catch {} onDetach(); };
    const onMessage = async (_e, method, p) => {
      const d = t.crimesDiag;
      if (!d || d.count > 40) return;
      try {
        if (method === 'Network.requestWillBeSent' && CRIMES_REQ.test(p.request.url)) {
          d.reqs.set(p.requestId, { url: p.request.url.replace(/([?&]rfcv=)[^&#]+/i, '$1…'), method: p.request.method, form: p.request.postData ? summarizeForm(p.request.postData) : '' });
        } else if (method === 'Network.responseReceived' && d.reqs.has(p.requestId)) {
          const h = p.response.headers || {};
          const pick = (n) => h[n] ?? h[n.toLowerCase()] ?? Object.entries(h).find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1];
          Object.assign(d.reqs.get(p.requestId), { status: p.response.status, type: p.response.mimeType, retry: pick('Retry-After'), cfRay: pick('cf-ray'), server: pick('server') });
        } else if ((method === 'Network.loadingFinished' || method === 'Network.loadingFailed') && d.reqs.has(p.requestId)) {
          const r = d.reqs.get(p.requestId);
          d.reqs.delete(p.requestId);
          const isHub = /crimesHubApi/i.test(r.url);
          let body = method === 'Network.loadingFailed' ? `YÜKLENEMEDİ: ${p.errorText}${p.blockedReason ? ` (${p.blockedReason})` : ''}` : '';
          if (!body) {
            const res = await dbg.sendCommand('Network.getResponseBody', { requestId: p.requestId });
            const text = res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
            if (r.status === 200 && hubOk(text)) {
              if (isHub) { t.crimesOk = true; log('[crimes-diag] Crimes hub yanıtı sağlıklı, izleme kapatıldı'); d.stop(); }
              return;
            }
            body = summarizeBody(text);
          }
          d.count++;
          let uid = '';
          if (isHub) {
            const chk = await wc.executeJavaScript(UID_CHECK_JS, true).catch(() => null);
            const real = chk && pickRealUid(chk, t.loggedIn === true);
            uid = chk ? `\n    uid çerezleri=[${chk.uids.map(uidShape).join(', ') || 'yok'}] · sayfa kimliği=${chk.real ? 'var' : 'yok'} · doğru numara=${real ? `${uidShape(real)}${real === chk.uids[0] ? ', önde' : ', önde DEĞİL'}` : 'belirsiz'}` : '';
            if (real && real !== chk.uids[0]) repairUidCookie(id);
          }
          log(`[crimes-diag] ${r.method} ${r.url} → ${r.status ?? '-'} ${r.type || ''}${r.retry ? ` retry-after=${r.retry}` : ''}${r.cfRay ? ` cf-ray=${r.cfRay}` : ''}${r.form ? `\n    istek: ${r.form}` : ''}\n    yanıt: ${body}${uid}`);
        }
      } catch (e) { log('crimes-diag err:', e.message); }
    };
    dbg.on('detach', onDetach);
    dbg.on('message', onMessage);
    try {
      await dbg.sendCommand('Network.enable', { maxPostDataSize: 4096 });
    } catch (e) { log('crimes-diag enable:', e.message); }
  }

  /* ---- LRX Torn yardımcıları: Torn sekmelerine enjekte edilen betikler (torn-helpers/) ---- */
  const helperCache = new Map();
  const helperSrc = (name) => {
    if (!helperCache.has(name)) helperCache.set(name, fs.readFileSync(path.join(APP_ROOT, 'torn-helpers', `${name}.js`), 'utf8'));
    return helperCache.get(name);
  };
  // Torn kuralı: sayfadan okunan veri yalnızca oyuncunun o an baktığı (odaktaki) sekmeden alınabilir.
  // Sayfayı okuyup uygulamaya veri gönderen yardımcılar (needsFocus) arka plan sekmesinde çalışmaz;
  // sekmeye geçilince ya da pencere odağa gelince çalışır. Yalnızca sayfayı boyayanlar her zaman yüklenir.
  const tabViewed = (id) => id === activeTabId && !!mainWindow && !mainWindow.isDestroyed()
    && mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused();
  const TORN_HELPERS = [
    { name: 'fast-slots', feature: 'torn.fastSlots', match: /^https:\/\/www\.torn\.com\/page\.php\?(.*&)?sid=slots(&|#|$)/i },
    { name: 'war-helper', feature: 'torn.warHelper', match: /^https:\/\/www\.torn\.com\/factions\.php/i, after: (id) => warTick(id) },
    { name: 'fight-helper', feature: 'torn.liveFight', needsFocus: true, match: /^https:\/\/www\.torn\.com\/(loader|page)\.php\?(.*&)?sid=attack(&|#|$)/i },
    { name: 'company-stock', feature: 'torn.stockSync', needsFocus: true, match: /^https:\/\/www\.torn\.com\/companies\.php/i, run: syncStockDeliveries },
    // Suçlar: XP renkleri + $/N rozetleri + burglary notları (her biri ayrı ayardan açılıp kapanır)
    { name: 'crime-helper', feature: ['torn.crimeHelper', 'torn.crimeValue', 'torn.crimeRank', 'torn.burglaryHelper'], match: /^https:\/\/www\.torn\.com\/page\.php\?(.*&)?sid=crimes(&|#|$)/i,
      prelude: () => {
        getCrimeValue().catch(() => {}); // tablo bayatsa arka planda yenile (Google Sheets, Torn isteği değil)
        const opts = { xp: featureEnabled('torn.crimeHelper'), value: featureEnabled('torn.crimeValue'), rank: featureEnabled('torn.crimeRank'), burglary: featureEnabled('torn.burglaryHelper') };
        return `window.__lrxCrimeOpts=${JSON.stringify(opts)};window.__lrxCV=${JSON.stringify(crimeValueForPage())};`;
      } },
    { name: 'jail-helper', feature: 'torn.jailHelper', match: /^https:\/\/www\.torn\.com\/jailview\.php/i },
    { name: 'sell-guard', feature: 'torn.sellGuard', match: /^https:\/\/www\.torn\.com\/(page\.php\?(.*&)?sid=ItemMarket|bazaar\.php)/i,
      prelude: () => `window.__lrxCosts=${JSON.stringify(purchaseCostsForPage())};` },
    { name: 'poker-helper', feature: 'torn.pokerHelper', match: /^https:\/\/www\.torn\.com\/page\.php\?(.*&)?sid=holdem/i },
    // Etkinlik yardımcıları (event): yalnızca oyuncunun etkinlik penceresinde çalışır. Tarihler her yıl
    // Torn takviminden (API) gelir; kişisel başlangıç saati (user/calendar) dahil.
    { name: 'ct-helper', feature: 'torn.ctHelper', event: 'christmas', match: /^https:\/\/www\.torn\.com\/christmas_town\.php/i },
    { name: 'halloween-helper', feature: 'torn.halloweenHelper', event: 'halloween', match: /^https:\/\/www\.torn\.com\/shops\.php\?(.*&)?step=candy/i,
      prelude: () => `window.__lrxHalloween=${JSON.stringify(halloweenForPage())};` },
    // Yumurta yalnızca bakılan sekmede gösterilir (arka plan sekmesinden uyarı vermek kural dışı)
    { name: 'egg-finder', feature: 'torn.eggFinder', event: 'easter', needsFocus: true, match: /^https:\/\/www\.torn\.com\//i },
  ];

  async function injectTornHelpers(id) {
    const t = tabs.get(id);
    if (!t) return;
    const wc = t.view.webContents;
    if (wc.isDestroyed()) return;
    const url = wc.getURL();
    // Helpers read window.__lrxLang ('en' | 'tr') for the text they add to Torn pages; sent with each helper in one call
    const lang = `window.__lrxLang=${JSON.stringify(appLang())};`;
    for (const h of TORN_HELPERS) {
      if (!h.match.test(url) || ![].concat(h.feature).some(featureEnabled) || (h.needsFocus && !tabViewed(id))) continue;
      if (h.event && !seasonalActive(h.event)) continue; // etkinlik günü değil
      if (wc.isDestroyed() || wc.getURL() !== url) return; // the page changed meanwhile; its own load runs the helpers again
      try {
        if (h.run) await h.run(wc, t, lang);
        else await wc.executeJavaScript(lang + (h.prelude ? h.prelude() : '') + helperSrc(h.name), true);
        if (h.after) h.after(id);
      } catch (e) {
        // Navigating or reloading while a helper runs destroys its frame: expected, not an error
        if (!/WebFrame was removed|Render frame was disposed|Object has been destroyed|Execution context was destroyed/i.test(e.message)) log(`helper ${h.name}:`, e.message);
      }
    }
  }

  // Şirket stok sayfası: Torn'un "Delivered in" sayaçlarını oku → teslim süresi tahmini yerine gerçek süre
  async function syncStockDeliveries(wc, t, lang = '') {
    const names = stockProductNames();
    if (!names.length || t?.stockBusy) return; // focus and hash events can fire together: one read at a time
    if (t) t.stockBusy = true;
    let res;
    try { res = await wc.executeJavaScript(`${lang}${helperSrc('company-stock')}(${JSON.stringify(names)})`, true); }
    finally { if (t) t.stockBusy = false; }
    // { shipments: [{ name, amount, secs }], deliveryHours: { ürün: saat } } · eski biçim: yalnızca dizi
    const rows = Array.isArray(res) ? res : res?.shipments;
    if (!Array.isArray(rows)) return;
    const count = ingestStockDeliveries(rows, Date.now(), Array.isArray(res) ? null : res.deliveryHours);
    sendToRenderer('torn-data', { type: 'stock-deliveries', count });
  }

  // Savaş sayfası: üye durumlarını (hastane bitişleri) API'den alıp sayfadaki yardımcıya ver
  async function warTick(id) {
    const t = tabs.get(id);
    if (!t || t.warBusy || !tabViewed(id)) return; // sayfadaki faction ID'leri yalnızca bakılan sekmeden okunur
    const wc = t.view.webContents;
    if (wc.isDestroyed() || !/^https:\/\/www\.torn\.com\/factions\.php/i.test(wc.getURL())) return;
    t.warBusy = true;
    try {
      const info = await wc.executeJavaScript('window.__lrxWar ? window.__lrxWar.scan() : null', true);
      if (!info?.active) return;
      const statuses = await warMemberStatuses(info.factionIds || []);
      if (!wc.isDestroyed() && tabViewed(id)) await wc.executeJavaScript(`window.__lrxWar && window.__lrxWar.update(${JSON.stringify(statuses)}, ${JSON.stringify(featureEnabled('war.groups') ? warGroupLabels(info.factionIds || []) : {})})`, true);
    } catch {} finally { t.warBusy = false; }
  }
  setInterval(() => {
    if (!featureEnabled('torn.warHelper')) return;
    if (tabs.has(activeTabId)) warTick(activeTabId);
  }, 20_000);

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
        webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
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
  ipcMain.handle('clipboard-read', (event) => {
    if (!fromAppPage(event)) throw new Error('Clipboard access denied');
    return clipboard.readText();
  });

  ipcMain.handle('tab-create', async (_event, { id, url, activate = true }) => {
    if (typeof id !== 'string' || tabs.has(id) || pendingTabCreates.has(id)) return;
    pendingTabCreates.add(id);
    if (activate) markActive(id);
    await tornRuntimeReady;
    if (!pendingTabCreates.delete(id)) return;
    activate = activate && activeTabId === id;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });

    mainWindow.contentView.addChildView(view);
    tabs.set(id, { id, view, url, loggedIn: null, lastActive: Date.now(), sleptUrl: null });

    if (activate) {
      markActive(id);
    }
    // Set initial bounds BEFORE loadURL so Cloudflare Turnstile never sees 0x0 viewport
    const [width, height] = mainWindow.getContentSize();
    view.setBounds({
      x: 0,
      y: TOP_BAR_HEIGHT,
      width: Math.max(100, width),
      height: Math.max(100, height - TOP_BAR_HEIGHT),
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
    const navigations = [];
    wc.on('will-navigate', (event) => {
      const now = Date.now();
      while (navigations.length && now - navigations[0] > 2500) navigations.shift();
      navigations.push(now);
      if (navigations.length > 6) {
        event.preventDefault();
        sendToRenderer('torn-data', { type: 'navigation-loop-stopped' });
        log('Torn navigation loop stopped:', id);
      }
    });

    wc.on('did-start-loading', () => sendTabUpdate(id));
    // Torn Crimes'a hem tam yüklemeyle hem de sayfa içi (SPA) geçişle gelinebilir; ikisini de izle
    wc.on('did-start-navigation', (_e, navUrl, inPlace, isMainFrame) => {
      const t = tabs.get(id);
      if (!isMainFrame || !t) return;
      if (!inPlace) t.crimesOk = false; // yeni belge: Crimes yeniden doğrulanmalı
      if (/^https:\/\/www\.torn\.com\/page\.php\?(.*&)?sid=crimes(&|#|$)/i.test(navUrl)) { if (!t.crimesOk) watchCrimes(id); }
      else t.crimesDiag?.stop(); // Crimes'tan çıkıldı
    });
    wc.on('did-stop-loading', () => { sendTabUpdate(id); checkTornLogin(id); repairUidCookie(id); injectTornHelpers(id); });
    wc.on('dom-ready', () => {
      if (/\/(loader|page)\.php\?(.*&)?sid=attack(&|#|$)/i.test(wc.getURL())) injectTornHelpers(id);
    });
    // F12 / Ctrl+Shift+I → Torn sekmesinin geliştirici araçları (sorun teşhisi için)
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const key = String(input.key || '').toLowerCase();
      if (key === 'f12' || ((input.control || input.meta) && input.shift && key === 'i')) {
        e.preventDefault();
        if (wc.isDevToolsOpened()) wc.closeDevTools(); else wc.openDevTools({ mode: 'detach' });
      }
    });
    wc.on('page-title-updated', () => sendTabUpdate(id));
    wc.on('did-navigate', () => sendTabUpdate(id));
    wc.on('did-navigate-in-page', (_e, _url, isMainFrame) => { sendTabUpdate(id); if (isMainFrame) injectTornHelpers(id); });

    wc.loadURL(url).catch((e) => log('loadURL err:', e.message));
    return { id, url };
  });

  /* ---- Kullanılmayan sekmeleri uyut: uzun süre açılmayan Torn sekmesinin sayfası RAM'den boşaltılır
     (about:blank), sekmeye dönülünce kaldığı adrese yeniden yüklenir. Ayarlar → app.tabSleep */
  const TAB_SLEEP_MS = Number(process.env.TT_TAB_SLEEP_MS) || 20 * 60_000; // ortam değişkeni yalnızca test için
  function markActive(id) {
    const prev = tabs.get(activeTabId);
    if (prev) prev.lastActive = Date.now(); // arka plana geçtiği an
    activeTabId = id || 'tracker';
    const t = tabs.get(activeTabId);
    if (t) { t.lastActive = Date.now(); wakeTab(t); }
  }
  function sleepTab(t) {
    const wc = t.view.webContents;
    if (t.sleptUrl || wc.isDestroyed() || wc.isLoading()) return;
    const url = wc.getURL();
    if (!/^https?:\/\//i.test(url)) return;
    t.sleptUrl = url;
    t.sleptTitle = wc.getTitle();
    wc.loadURL('about:blank').catch(() => {});
    log('sekme uyutuldu:', t.id);
  }
  function wakeTab(t) {
    if (!t.sleptUrl) return;
    const url = t.sleptUrl;
    t.sleptUrl = null;
    const wc = t.view.webContents;
    if (wc.isDestroyed()) return;
    const h = wc.navigationHistory;
    const blankIdx = h.getActiveIndex();
    wc.loadURL(url)
      .then(() => { // Geri tuşu boş sayfaya gitmesin
        try { if (/^about:blank/.test(h.getEntryAtIndex(blankIdx)?.url || '') && h.getActiveIndex() !== blankIdx) h.removeEntryAtIndex(blankIdx); } catch {}
      })
      .catch((e) => log('wake err:', e.message));
  }
  setInterval(() => {
    if (!featureEnabled('app.tabSleep')) return;
    const now = Date.now();
    for (const [id, t] of tabs) if (id !== activeTabId && now - t.lastActive > TAB_SLEEP_MS) sleepTab(t);
  }, 60_000);

  ipcMain.handle('tab-activate', async (_event, tabId) => {
    markActive(tabId);
    layoutViews();
    if (tabs.has(activeTabId)) injectTornHelpers(activeTabId); // odak gerektiren yardımcılar şimdi çalışsın
    if (activeTabId !== 'tracker' && tabs.has(activeTabId)) {
      sendTabUpdate(activeTabId);
      tabs.get(activeTabId).view.webContents.focus();
    }
  });

  ipcMain.handle('tab-close', async (_event, tabId) => {
    pendingTabCreates.delete(tabId);
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
    t.sleptUrl = null;
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
  // Torn rules: the app never clicks Torn's buttons or sends a message for the user.
  // It only fills the text into a chat box the user already opened; the user presses Enter.
  const chatJs = (name) => `(() => {
    const target = ${JSON.stringify(String(name || '').toLowerCase())};
    const box = [...document.querySelectorAll("#chatRoot [class*='item___']")].find((b) => {
      const h = b.querySelector("button [class*='title___'], button [class*='name___'], [class*='chat-box-header__name']");
      return h && b.querySelector('textarea') && h.textContent.trim().toLowerCase().includes(target);
    });
    const ta = box && box.querySelector('textarea');
    if (!ta) return { ok: false, step: 'box' };
    ta.scrollIntoView({ block: 'nearest' });
    ta.focus();
    return { ok: true };
  })()`;

  ipcMain.handle('torn-chat-send', async (_event, { tabId, name, message }) => {
    if (!fromAppPage(_event)) return { ok: false, step: 'denied' };
    const t = tabs.get(tabId);
    if (!t) return { ok: false, step: 'tab' };
    const wc = t.view.webContents;
    try {
      if (!(await waitProfileLoaded(wc))) return { ok: false, step: 'load' };
      const opened = await wc.executeJavaScript(chatJs(name), true);
      if (!opened?.ok) return opened || { ok: false, step: 'box' };
      wc.focus();
      await sleep(150);
      await wc.insertText(String(message || '').replace(/\s*\n+\s*/g, ' ').trim());
      return { ok: true, sent: false };
    } catch (e) {
      log('torn-chat-send err:', e.message);
      return { ok: false, step: 'error', error: e.message };
    }
  });

  ipcMain.handle('tab-action', async (_event, { tabId, action }) => {
    const t = tabs.get(tabId);
    if (!t) return;
    const wc = t.view.webContents;
    if (t.sleptUrl) return wakeTab(t); // uyuyan sekme: önce kaldığı sayfayı geri yükle
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === 'reload') wc.reload();
  });

  ipcMain.handle('set-view-visibility', async (_event, visible) => {
    viewsVisible = Boolean(visible);
    if (!visible) {
      for (const t of tabs.values()) t.view.setVisible(false);
      if (mainWindow.isFocused()) mainWindow.webContents.focus();
    } else {
      layoutViews();
    }
  });

  ipcMain.handle('torntools-info', async () => ({ ...tornTools }));
  ipcMain.handle('external-login', async () => { startExternalLogin(); });

  // ---- Güncelleme ----
  // Güncelleme adresi sabit: package.json'daki resmi GitHub sürüm adresi (ayarlardan değiştirilemez)
  const updateUrl = () => DEFAULT_UPDATE_URL;
  // Çalışan sürüm = açılışta yüklenen kod. Diskteki package.json daha yeniyse (güncelleme kuruldu
  // ya da dosyalar uygulama açıkken değişti) yeniden başlatmak gerekir; bunu ayrıca bildiriyoruz.
  const runningVersion = updater.currentVersion();
  const restartPending = () => updater.cmpVersion(updater.currentVersion(), runningVersion) > 0;
  const { restartApplication } = require('./restart');
  const relaunch = () => setTimeout(async () => {
    try {
      flushData();
      await session.fromPartition(PARTITION).cookies.flushStore();
      await session.fromPartition(PARTITION).flushStorageData();
      restartApplication({ app, windows: BrowserWindow.getAllWindows(), log });
    } catch (e) { log('restart error:', e.message); app.relaunch(); app.exit(0); }
  }, 350);
  ipcMain.handle('app-version', async () => runningVersion);
  ipcMain.handle('update-check', async () => {
    const url = updateUrl();
    const pending = restartPending();
    const restartInfo = { current: runningVersion, latest: updater.currentVersion(), available: true, restartOnly: true };
    if (!url) return pending ? { ...restartInfo, configured: false } : { current: runningVersion, available: false, configured: false };
    try {
      const r = await updater.checkForUpdate(url); // r.available: manifest > diskteki sürüm
      if (pending && !r.available) return { ...r, ...restartInfo, configured: true };
      return { ...r, current: runningVersion, configured: true };
    } catch (e) {
      return pending ? { ...restartInfo, configured: true } : { current: runningVersion, available: false, configured: true, error: e.message };
    }
  });
  // Dosyalar uygulama açıkken güncellenirse arayüze hemen haber ver
  fs.watchFile(path.join(APP_ROOT, 'package.json'), { interval: 5000 }, () => {
    if (restartPending()) sendToRenderer('update-pending', { latest: updater.currentVersion() });
  });
  let updating = false;
  ipcMain.handle('update-apply', async (event) => {
    if (!fromAppPage(event)) return { ok: false, error: 'denied' };
    if (updating) return { ok: false, error: T('Güncelleme zaten sürüyor', 'An update is already in progress') };
    updating = true;
    try {
      let download = true;
      if (restartPending()) {
        // Yeni sürüm zaten diskte; daha yenisi yayınlanmadıysa sadece yeniden başlat
        try { download = (await updater.checkForUpdate(updateUrl())).available; } catch { download = false; }
      }
      if (download) await updater.applyUpdate(updateUrl(), (p) => sendToRenderer('update-progress', p));
      sendToRenderer('update-progress', { step: 'restart', message: T('Yeniden başlatılıyor…', 'Restarting…') });
      log(download ? 'update applied, relaunching' : 'restart for pending update', runningVersion, '->', updater.currentVersion());
      relaunch();
      return { ok: true };
    } catch (e) {
      log('update err:', e.message);
      updating = false;
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('set-torn-cookies', async (_event, { phpSessId, uid, pass, raw }) => {
    if (!fromAppPage(_event)) throw new Error('denied');
    const tornSession = session.fromPartition(PARTITION);
    const exp = Math.floor(Date.now() / 1000) + 365 * 86400;
    const pairs = [];
    if (phpSessId && String(phpSessId).trim()) pairs.push(['PHPSESSID', String(phpSessId).trim()]);
    if (uid && /^\d+$/.test(String(uid).trim())) pairs.push(['uid', String(uid).trim()]);
    if (pass && String(pass).trim()) pairs.push(['pass', String(pass).trim()]);
    if (raw && String(raw).trim()) {
      for (const part of String(raw).split(';')) {
        const idx = part.indexOf('=');
        if (idx > 0) {
          const k = part.slice(0, idx).trim();
          const v = part.slice(idx + 1).trim();
          if (k && v && !(k === 'uid' && !/^\d+$/.test(v))) pairs.push([k, v]);
        }
      }
    }
    if (!pairs.some(([name]) => name === 'PHPSESSID')) throw new Error(T('PHPSESSID gerekli.', 'PHPSESSID is required.'));
    await replaceTornCookies(tornSession, [...new Map(pairs)].map(([name, value]) => ({ name, value, domain: '.torn.com', path: '/', secure: true, sameSite: 'lax', expirationDate: exp })));
    for (const t of tabs.values()) {
      try { t.view.webContents.reload(); } catch {}
    }
    return { count: pairs.length };
  });

  function setupTornSession(tornSession) {
    tornSession.setUserAgent(exactChromeUA);
    try { tornSession.setSpellCheckerEnabled(false); } catch {}
    try { session.defaultSession.setSpellCheckerEnabled(false); } catch {}
  }

  // App language (EN default, TR optional), set from the app's language toggle via the server's config.json
  function appLang() {
    try { return JSON.parse(fs.readFileSync(path.join(persistentDataDir, 'config.json'), 'utf8')).lang === 'tr' ? 'tr' : 'en'; } catch { return 'en'; }
  }
  const T = (trStr, enStr) => (appLang() === 'tr' ? trStr : enStr);

  var lastFeatures = null; // var: featureEnabled() is hoisted and may run before this line
  function featureEnabled(key) {
    try { lastFeatures = JSON.parse(fs.readFileSync(path.join(persistentDataDir, 'config.json'), 'utf8')).features || {}; } catch {}
    return lastFeatures?.[key] !== false;
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

      // Tabs wait for extension registration before their first load.
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
      tornRuntimeReady = (async () => {
        try { await normalizeTornSession(tornSession); } catch (e) { log('Torn session normalize:', e.message); }
        try { await setupTornTools(tornSession); } catch (e) { log('TornTools setup:', e.message); sendToRenderer('torntools-status', { ...tornTools, status: 'error', error: e.message }); }
        let features = {};
        try { features = JSON.parse(fs.readFileSync(path.join(persistentDataDir, 'config.json'), 'utf8')).features || {}; } catch {}
        await serverPromise;
        const dir = buildUserscriptExtension(persistentDataDir, features, ffScriptBridge());
        const loader = tornSession.extensions || tornSession;
        await loader.loadExtension(dir, { allowFileAccess: false });
        log('LRX userscripts loaded');
      })().catch((e) => log('Torn runtime:', e.message));

      const port = await serverPromise;
      const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      const width = Math.min(1360, Math.round(workArea.width * 0.9));
      const height = Math.min(900, Math.round(workArea.height * 0.9));

      mainWindow = new BrowserWindow({
        width, height,
        x: workArea.x + Math.round((workArea.width - width) / 2),
        y: workArea.y + Math.round((workArea.height - height) / 2),
        minWidth: 480,
        minHeight: 400,
        show: true,
        title: 'LRX Torn Tracker',
        icon: APP_ICON,
        backgroundColor: '#040506',
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          spellcheck: false,
        },
      });
      mainWindow.webContents.on('context-menu', (_event, params) => {
        if (!params.isEditable) return;
        Menu.buildFromTemplate([
          { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
          { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        ]).popup({ window: mainWindow });
      });

      mainWindow.on('resize', layoutViews);
      mainWindow.on('focus', () => { if (tabs.has(activeTabId)) injectTornHelpers(activeTabId); });
      mainWindow.on('maximize', layoutViews);
      mainWindow.on('unmaximize', layoutViews);

      mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url && /^(https?|chrome-extension):\/\//i.test(url)) {
          sendToRenderer('open-tab', url);
        }
        return { action: 'deny' };
      });

      // The main window holds the privileged preload API: it may only show the app's own page.
      // A dropped link or a stray navigation opens in a Torn tab (http/https) or is ignored.
      appOrigin = `http://127.0.0.1:${port}`;
      const keepAppPage = (e, url) => {
        let origin = '';
        try { origin = new URL(url).origin; } catch {}
        if (origin === appOrigin) return;
        e.preventDefault();
        if (/^https?:\/\//i.test(url)) sendToRenderer('open-tab', url);
      };
      mainWindow.webContents.on('will-navigate', keepAppPage);
      mainWindow.webContents.on('will-redirect', keepAppPage);

      mainWindow.show();
      mainWindow.focus();
      mainWindow.loadURL(appOrigin);
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
