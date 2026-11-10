/**
 * "Google ile giriş" için harici tarayıcı köprüsü.
 *
 * Google, Electron gibi gömülü tarayıcılarda Google hesabıyla girişi engelliyor
 * ("Bu tarayıcı veya uygulama güvenli olmayabilir").
 * Çözüm: Torn'u bilgisayardaki gerçek Chrome (yoksa Edge) içinde, TornTracker'a ait ayrı bir
 * profille açıyoruz. Kullanıcı orada Google ile normal şekilde giriş yapıp pencereyi kapatıyor;
 * ardından aynı profilin torn.com çerezleri okunup uygulamanın oturumuna aktarılıyor.
 *
 * Neden iki aşama: Chrome, uzaktan hata ayıklama portuyla (--remote-debugging-port) açılınca kendini
 * "otomasyon altında" bildiriyor (navigator.webdriver = true). Cloudflare ve Google bu tarayıcıyı
 * reddediyor; giriş hiç tamamlanamıyor. Bu yüzden giriş penceresi tamamen normal açılır. Çerezler
 * ancak pencere kapandıktan sonra, aynı profil görünmez (headless) açılarak okunur. Bu sırada ağ
 * kapalıdır (geçersiz proxy), yani Torn'a ya da başka bir yere istek gitmez.
 * Kullanıcının kendi Chrome profiline dokunulmaz.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { replaceTornCookies } = require('./torn-session');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Language of user-facing messages: English by default, Turkish when the app is set to TR.
// Reads the same config.json as server.js (electron-main sets TORN_DATA_DIR before loading this module).
const T = (trStr, enStr) => {
  let lang = 'en';
  try { lang = JSON.parse(fs.readFileSync(path.join(process.env.TORN_DATA_DIR || path.join(__dirname, 'data'), 'config.json'), 'utf8')).lang; } catch {}
  return lang === 'tr' ? trStr : enStr;
};

function findBrowser() {
  const env = process.env;
  const candidates = [
    [env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'],
    [env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'],
    [env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'],
    [env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'],
    [env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'],
    [env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
  ];
  for (const parts of candidates) {
    if (!parts[0]) continue;
    const p = path.join(...parts);
    if (fs.existsSync(p)) return { exe: p, name: /msedge/i.test(p) ? 'Edge' : /brave/i.test(p) ? 'Brave' : 'Chrome' };
  }
  return null;
}

/** Tek bir DevTools websocket çağrısı (yalnızca görünmez çerez okuma aşamasında) */
function cdpCall(wsUrl, method, params = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let ws;
    const timer = setTimeout(() => { try { ws && ws.close(); } catch {} reject(new Error(T('CDP zaman aşımı', 'CDP timed out'))); }, timeoutMs);
    try { ws = new WebSocket(wsUrl); } catch (e) { clearTimeout(timer); reject(e); return; }
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method, params })));
    ws.addEventListener('message', (m) => {
      let j; try { j = JSON.parse(m.data); } catch { return; }
      if (j.id !== 1) return;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (j.error) reject(new Error(j.error.message)); else resolve(j.result);
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(T('CDP bağlantı hatası', 'CDP connection error'))); });
  });
}

/**
 * Profil hâlâ bir tarayıcıda açık mı? Chrome/Edge açıkken profil klasöründeki "lockfile"ı kilitli tutar.
 * Silinebiliyorsa (ya da yoksa) tarayıcı tamamen kapanmıştır.
 */
function profileInUse(profileDir) {
  const lock = path.join(profileDir, 'lockfile');
  try { fs.rmSync(lock, { force: true }); return fs.existsSync(lock); } catch { return true; }
}

const LOGIN_WAIT_MS = 20 * 60_000;
let active = null; // aynı anda tek oturum

/**
 * @param {object} o
 * @param {string} o.profileDir  harici tarayıcı için ayrı profil klasörü
 * @param {Electron.Session} o.targetSession  çerezlerin aktarılacağı oturum
 * @param {(s: {state: string, message: string, browser?: string}) => void} o.onStatus
 * @param {(...a: any[]) => void} [o.log]
 */
async function externalGoogleLogin({ profileDir, targetSession, onStatus, log = () => {} }) {
  if (active) { onStatus({ state: 'waiting', message: T('Giriş penceresi zaten açık: orada Google ile giriş yap, sonra o pencereyi kapat.', 'The sign-in window is already open: sign in with Google there, then close that window.') }); return active; }
  const browser = findBrowser();
  if (!browser) {
    onStatus({ state: 'error', message: T('Chrome veya Edge bulunamadı. "Oturum Aktar" ile PHPSESSID girebilirsin.', 'Chrome or Edge not found. You can enter your PHPSESSID under "Login Help".') });
    return null;
  }
  active = (async () => {
    fs.mkdirSync(profileDir, { recursive: true });

    // 1) Normal tarayıcı penceresi: hata ayıklama portu yok, otomasyon bayrağı yok
    const edgeFlags = browser.name === 'Edge' ? ['--disable-features=msEdgeStartupBoost'] : [];
    const child = spawn(browser.exe, [
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...edgeFlags,
      '--new-window',
      'https://www.torn.com/',
    ], { stdio: 'ignore', detached: false, windowsHide: false });
    child.on('error', (e) => log('external browser spawn err:', e.message));
    log('external login: opened', browser.name);

    onStatus({ state: 'waiting', browser: browser.name, message: T(
      `${browser.name} açıldı. Orada Torn'a Google ile giriş yap. Torn ana sayfan açılınca o ${browser.name} penceresini kapat; oturumun uygulamaya aktarılacak.`,
      `${browser.name} opened. Sign in to Torn with Google there. Once your Torn home page appears, close that ${browser.name} window and your session will be copied into the app.`) });

    // Pencerenin (ve profili tutan tarayıcı sürecinin) kapanmasını bekle
    await sleep(3000);
    const deadline = Date.now() + LOGIN_WAIT_MS;
    while (profileInUse(profileDir)) {
      if (Date.now() > deadline) {
        throw new Error(T(`Süre doldu (20 dk). Girişi yaptıysan ${browser.name} penceresini kapatıp tekrar dene.`,
          `Timed out (20 min). If you signed in, close the ${browser.name} window and try again.`));
      }
      await sleep(1500);
    }
    onStatus({ state: 'waiting', browser: browser.name, message: T('Pencere kapandı, oturum aktarılıyor…', 'Window closed, copying your session…') });

    // 2) Aynı profili görünmez aç ve yalnızca çerezleri oku (ağ kapalı: geçersiz proxy → hiçbir istek gitmez)
    const portFile = path.join(profileDir, 'DevToolsActivePort');
    try { fs.rmSync(portFile, { force: true }); } catch {}
    const reader = spawn(browser.exe, [
      `--user-data-dir=${profileDir}`,
      '--headless=new',
      '--remote-debugging-port=0',
      '--remote-allow-origins=http://127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
      '--proxy-server=http://127.0.0.1:9',
      '--proxy-bypass-list=<-loopback>',
      ...edgeFlags,
      'about:blank',
    ], { stdio: 'ignore', detached: false, windowsHide: true });
    let readerExited = false;
    reader.on('exit', () => { readerExited = true; });
    reader.on('error', (e) => { readerExited = true; log('cookie reader spawn err:', e.message); });

    let port = null;
    for (let i = 0; i < 60 && !readerExited; i++) {
      try { port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]); } catch {}
      if (port) break;
      await sleep(250);
    }
    if (!port) {
      try { reader.kill(); } catch {}
      throw new Error(T(`${browser.name} oturumu okunamadı. ${browser.name} penceresinin tamamen kapandığından emin olup tekrar dene.`,
        `Could not read the ${browser.name} session. Make sure the ${browser.name} window is fully closed and try again.`));
    }
    let cookies = [];
    try {
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      ({ cookies = [] } = await cdpCall(version.webSocketDebuggerUrl, 'Storage.getCookies', {}));
      try { await cdpCall(version.webSocketDebuggerUrl, 'Browser.close'); } catch {}
    } finally {
      await sleep(500);
      if (!readerExited) { try { reader.kill(); } catch {} }
    }

    // Torn çerezlerini aktar (Cloudflare çerezleri tarayıcıya özel olduğu için hariç)
    const tornCookies = cookies.filter((c) => /(^|\.)torn\.com$/i.test(c.domain) && !/^(cf_|__cf)/i.test(c.name));
    if (!tornCookies.some((c) => c.name === 'PHPSESSID')) {
      throw new Error(T('Torn oturumu bulunamadı. Pencereyi kapatmadan önce Torn\'a giriş yaptığından emin ol. Olmazsa Yöntem 2 (e-posta ve şifre) ya da Yöntem 3\'ü (PHPSESSID) kullan.',
        'No Torn session was found. Make sure you are signed in to Torn before closing the window. If it still fails, use Method 2 (email and password) or Method 3 (PHPSESSID).'));
    }
    const count = await replaceTornCookies(targetSession, tornCookies);
    await require('./torn-session').normalizeTornSession(targetSession);
    if (!count) throw new Error(T('Torn çerezi aktarılamadı.', 'Could not copy the Torn cookies.'));
    onStatus({ state: 'done', browser: browser.name, message: T(`Google girişi aktarıldı ✓ (${count} çerez)`, `Google sign-in imported ✓ (${count} ${count === 1 ? 'cookie' : 'cookies'})`) });
    log('external login imported cookies:', count);
    return { count };
  })().catch((e) => {
    onStatus({ state: 'error', message: e.message });
    log('external login err:', e.message);
    return null;
  }).finally(() => { active = null; });
  return active;
}

module.exports = { externalGoogleLogin };
