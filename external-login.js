/**
 * "Google ile giriş" için harici tarayıcı köprüsü.
 *
 * Google, Electron gibi gömülü tarayıcılarda Google hesabıyla girişi engelliyor
 * ("Bu tarayıcı veya uygulama güvenli olmayabilir"); kimlik gizleme de artık işe yaramıyor.
 * Çözüm: Torn'u bilgisayardaki gerçek Chrome (yoksa Edge) içinde, TornTracker'a ait ayrı bir
 * profille açıyoruz. Kullanıcı orada Google ile normal şekilde giriş yapıyor; giriş algılanınca
 * torn.com çerezleri (PHPSESSID vb.) DevTools protokolüyle okunup uygulamanın oturumuna aktarılıyor
 * ve harici pencere kapanıyor. Kullanıcının kendi Chrome profiline dokunulmaz.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

/** Tek bir DevTools websocket çağrısı */
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

const LOGIN_CHECK_JS = `(() => {
  const hasSidebar = !!document.querySelector('#sidebarroot, #sidebar, [class*="sidebar___"]');
  const hasLoginForm = !!document.querySelector('form[action*="login"], input[type="password"]');
  const hasLogout = !!document.querySelector('a[href*="logout.php"]');
  return (hasSidebar || hasLogout) && !hasLoginForm;
})()`;

let active = null; // aynı anda tek oturum

/**
 * @param {object} o
 * @param {string} o.profileDir  harici tarayıcı için ayrı profil klasörü
 * @param {Electron.Session} o.targetSession  çerezlerin aktarılacağı oturum
 * @param {(s: {state: string, message: string, browser?: string}) => void} o.onStatus
 * @param {(...a: any[]) => void} [o.log]
 */
async function externalGoogleLogin({ profileDir, targetSession, onStatus, log = () => {} }) {
  if (active) { onStatus({ state: 'waiting', message: T('Harici tarayıcı zaten açık; girişi orada tamamla.', 'The external browser is already open; finish signing in there.') }); return active; }
  const browser = findBrowser();
  if (!browser) {
    onStatus({ state: 'error', message: T('Chrome veya Edge bulunamadı. "Oturum Aktar" ile PHPSESSID girebilirsin.', 'Chrome or Edge not found. You can enter your PHPSESSID under "Login Help".') });
    return null;
  }
  active = (async () => {
    fs.mkdirSync(profileDir, { recursive: true });
    const portFile = path.join(profileDir, 'DevToolsActivePort');
    try { fs.rmSync(portFile, { force: true }); } catch {}

    const child = spawn(browser.exe, [
      `--user-data-dir=${profileDir}`,
      '--remote-debugging-port=0',
      '--remote-allow-origins=http://127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      'https://www.torn.com/',
    ], { stdio: 'ignore', detached: false, windowsHide: false });
    let exited = false;
    child.on('exit', () => { exited = true; });
    child.on('error', (e) => { exited = true; log('external browser spawn err:', e.message); });

    onStatus({ state: 'waiting', browser: browser.name, message: T(`${browser.name} açıldı. Orada Torn'a "Google ile giriş" yap; giriş algılanınca oturum otomatik aktarılacak.`,
      `${browser.name} opened. Sign in to Torn with Google there; your session will be imported automatically once sign-in is detected.`) });

    // DevTools portunu bekle
    let port = null;
    for (let i = 0; i < 60 && !exited; i++) {
      try { port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]); } catch {}
      if (port) break;
      await sleep(250);
    }
    if (!port) throw new Error(T(`${browser.name} başlatılamadı (zaten aynı profil açık olabilir, pencereyi kapatıp tekrar dene).`,
      `Could not start ${browser.name} (the same profile may already be open; close that window and try again).`));
    const base = `http://127.0.0.1:${port}`;
    const version = await (await fetch(`${base}/json/version`)).json();
    const browserWs = version.webSocketDebuggerUrl;

    // Girişi bekle (en fazla 10 dk)
    const deadline = Date.now() + 10 * 60_000;
    let loggedIn = false;
    while (!exited && Date.now() < deadline) {
      await sleep(2000);
      let targets = [];
      try { targets = await (await fetch(`${base}/json/list`)).json(); } catch { continue; }
      for (const t of targets) {
        if (t.type !== 'page' || !/^https:\/\/(www\.)?torn\.com\//i.test(t.url) || !t.webSocketDebuggerUrl) continue;
        try {
          const r = await cdpCall(t.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: LOGIN_CHECK_JS, returnByValue: true });
          if (r?.result?.value === true) { loggedIn = true; break; }
        } catch {}
      }
      if (loggedIn) break;
    }
    if (!loggedIn) {
      if (!exited) { try { await cdpCall(browserWs, 'Browser.close'); } catch {} }
      throw new Error(exited
        ? T('Harici tarayıcı giriş tamamlanmadan kapatıldı.', 'The external browser was closed before sign-in finished.')
        : T('Giriş için süre doldu (10 dk).', 'Sign-in timed out (10 min).'));
    }

    // Çerezleri oku ve aktar (Cloudflare çerezleri tarayıcıya özel olduğu için hariç)
    const { cookies = [] } = await cdpCall(browserWs, 'Storage.getCookies', {});
    const tornCookies = cookies.filter((c) => /(^|\.)torn\.com$/i.test(c.domain) && !/^(cf_|__cf)/i.test(c.name));
    let count = 0;
    for (const c of tornCookies) {
      const host = c.domain.replace(/^\./, '');
      const details = {
        url: `https://${host}${c.path || '/'}`,
        name: c.name,
        value: c.value,
        path: c.path || '/',
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
      };
      if (c.domain.startsWith('.')) details.domain = c.domain;
      if (!c.session && c.expires > 0) details.expirationDate = c.expires;
      const ss = String(c.sameSite || '').toLowerCase();
      if (ss === 'lax' || ss === 'strict') details.sameSite = ss;
      else if (ss === 'none') details.sameSite = 'no_restriction';
      try { await targetSession.cookies.set(details); count++; } catch (e) { log('cookie set err', c.name, e.message); }
    }
    try { await targetSession.cookies.flushStore(); } catch {}
    try { await cdpCall(browserWs, 'Browser.close'); } catch {}
    if (!count) throw new Error(T('Torn çerezi bulunamadı.', 'No Torn cookies found.'));
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
