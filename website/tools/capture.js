'use strict';
// Captures marketing screenshots of the real app UI with synthetic demo data.
// Uses the app's own isolated fixture server (temporary data dir, no API key, no Torn calls).
// Usage: PLAYWRIGHT_MODULE=<dir> node website/tools/capture.js [outDir]   (SHOT_LANG=tr for Turkish)
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const APP = path.resolve(__dirname, '..', '..'); // the repository root
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'shots'));
const SUFFIX = (process.env.SHOT_LANG || 'en') === 'tr' ? '-tr' : '';
fs.mkdirSync(OUT, { recursive: true });
const { buildBattleStats } = require(path.join(APP, 'src', 'server', 'battle-stats'));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-site-shots-'));
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ lang: process.env.SHOT_LANG || 'en', features: { 'app.splash': false, 'app.animations': true, 'page.travel': true, 'app.premiumPromos': false } }));
const child = fork(path.join(APP, 'tests', 'preview-server.js'), { env: { ...process.env, TORN_DATA_DIR: temp, TORN_API_KEY: '', TORN_PREMIUM_SERVICE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });

const now = () => Math.floor(Date.now() / 1000);
const battle = buildBattleStats({ strength: 1250000, defense: 980000, speed: 1100000, dexterity: 870000 });
const overview = () => ({
  player: { id: 123, name: 'Demo Player', level: 42, image: '/logo-64.png', job: { job: 'Law', position: 'Lawyer' }, faction: { faction_id: 5, faction_name: 'Demo Syndicate' }, status: { state: 'Okay' } },
  serverTime: now(), battle,
  bars: { energy: { current: 135, maximum: 150, fulltime: 450 }, nerve: { current: 48, maximum: 60, fulltime: 2400 }, happy: { current: 4200, maximum: 5025, fulltime: 3600 }, life: { current: 3210, maximum: 3480, fulltime: 900 }, chain: { current: 0, maximum: 10 } },
  cooldowns: { drug: 4 * 3600 + 1260, booster: 5400, medical: 0 },
  drug: { cooldown: 4 * 3600 + 1260, xanaxActive: true },
  education: { currentId: 12, current: 'Bachelor of Biology', code: 'BIO2350', timeLeft: 9 * 3600 + 1500, duration: 14 * 86400, completed: 42, totalCourses: 100 },
});
const names = ['Nova', 'Raven', 'Kestrel', 'Viper', 'Onyx', 'Ember', 'Atlas', 'Jinx'];
const targets = (id) => ({
  faction: { id, name: 'Rival Cartel', members: names.length, respect: 184250 },
  me: { totals: battle.totals },
  members: names.map((name, i) => ({
    id: 900100 + i, name, level: 28 + i * 4, bs: [310000, 520000, 760000, 1150000, 1600000, 2400000, 3900000, 6100000][i],
    status: i === 2 ? { state: 'Hospital', until: now() + 1260, description: 'In hospital' } : i === 5 ? { state: 'Traveling', description: 'Traveling to Japan' } : { state: 'Okay' },
    lastAction: { status: i % 3 ? 'Idle' : 'Online', relative: i % 3 ? (i * 7) + ' minutes ago' : 'Online' },
    source: 'ffscouter',
  })),
  ffscouter: { ok: true },
});
const travel = () => {
  const n = now();
  const c = (code, name, minutes, items) => ({ code, name, minutes, update: n - 120, source: 'YATA', items });
  const it = (id, name, type, cost, market, qty, extra = {}) => ({ id, name, type, cost, qty, market, profit: market - cost, nextRestock: null, restockSrc: null, emptyAt: null, rate: null, lastRestock: null, interval: null, ...extra });
  return {
    countries: [
      c('mex', 'Mexico', 26, [it(260, 'Dahlia', 'Flower', 300, 4100, 1520)]),
      c('cay', 'Cayman Islands', 35, [it(618, 'Stingray Plushie', 'Plushie', 400, 3700, 860)]),
      c('can', 'Canada', 41, [it(263, 'Crocus', 'Flower', 600, 5600, 0, { nextRestock: n + 3300, restockSrc: 'Prometheus' })]),
      c('uni', 'United Kingdom', 159, [it(268, 'Red Fox Plushie', 'Plushie', 1000, 9400, 412)]),
      c('swi', 'Switzerland', 175, [it(267, 'Edelweiss', 'Flower', 900, 9800, 0, { nextRestock: n + 5400, restockSrc: 'Prometheus' })]),
      c('jap', 'Japan', 225, [it(277, 'Cherry Blossom', 'Flower', 500, 16200, 2140)]),
      c('chi', 'China', 242, [it(276, 'Peony', 'Flower', 5000, 41000, 330)]),
      c('sou', 'South Africa', 297, [it(206, 'Xanax', 'Drug', 750000, 845000, 95)]),
    ],
    method: 'Airstrip', fetchedAt: Date.now(), serverNow: n, sources: ['YATA', 'Prometheus'],
  };
};

async function toWebp(conv, png, width, quality) {
  const data = await conv.evaluate(async ([b64, w, q]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = w; c.height = Math.round(img.height * w / img.width);
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/webp', q);
  }, [png.toString('base64'), width, quality]);
  return Buffer.from(data.split(',')[1], 'base64');
}

(async () => {
  const { port } = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('exit', (code) => reject(new Error('fixture exited ' + code))); });
  const base = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_EXE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const conv = await (await browser.newContext()).newPage();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await context.addInitScript((lang) => { window.electronAPI = { onUpdateProgress: () => {} }; try { localStorage.setItem('tt.lang', lang); } catch {} }, process.env.SHOT_LANG || 'en');
  let signedIn = false;
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    const p = url.pathname;
    const json = (obj, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (p === '/api/bootstrap') { const r = await route.fetch(); const b = await r.json(); b.config.hasKey = signedIn; b.overview = signedIn ? overview() : null; return json(b); }
    if (p === '/api/auth') { signedIn = true; return json({ player: overview().player }); }
    if (p === '/api/overview') return json(overview());
    if (p === '/api/wars') return json({ faction: { name: 'Demo Syndicate' }, wars: [] });
    if (p === '/api/targets') return json(targets(Number(url.searchParams.get('faction')) || 6));
    if (p === '/api/travel') return json(travel());
    if (p === '/api/company') return json({ error: 'Not a company director', code: 7 }, 400);
    if (p.startsWith('/api/') && !['/api/config', '/api/features', '/api/lang', '/api/war-groups'].includes(p)) return json({ error: 'Not available in demo' }, 412);
    return route.continue();
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const shots = [];
  async function shot(name, opts = {}) {
    await page.waitForTimeout(opts.wait || 900);
    const png = await page.screenshot({ type: 'png', clip: opts.clip });
    fs.writeFileSync(path.join(OUT, name + SUFFIX + '.png'), png);
    for (const w of opts.widths || [1600, 960]) fs.writeFileSync(path.join(OUT, `LRXe8-tt-${name}-${w}${SUFFIX}.webp`), await toWebp(conv, png, w, 0.84));
    shots.push(name);
  }

  await page.goto(base);
  await page.locator('#auth-key').waitFor({ state: 'visible' });
  await shot('login', { wait: 5200 });

  await page.locator('#auth-key').fill('DemoDemoDemo1234');
  await page.locator('#auth-submit').click();
  await page.locator('#auth-screen').waitFor({ state: 'hidden' });
  await page.evaluate(() => { showView('overview'); window.scrollTo(0, 0); });
  await shot('overview', { wait: 1500 });

  await page.locator('[data-view="war"]').click();
  await page.evaluate(() => { state.factionId = 6; state.targets = null; loadTargets(); });
  await page.waitForFunction(() => state.targets?.faction?.id === 6);
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('h3')].find((x) => /Payout-Focused|Ödeme Odaklı/.test(x.textContent) && x.offsetParent);
    if (!h) return;
    h.scrollIntoView({ block: 'start' });
    for (let el = h.parentElement; el; el = el.parentElement) if (el.scrollTop > 0) { el.scrollTop -= 64; return; }
    window.scrollBy(0, -64);
  });
  await shot('war', { wait: 1400 });

  await page.locator('[data-view="travel"]').click();
  await shot('travel', { wait: 2000 });

  await page.locator('[data-view="settings"]').click();
  await page.locator('[data-set-tab="torn"]').click();
  await shot('settings', { wait: 1000 });

  console.log(JSON.stringify({ shots, errors }));
  await browser.close();
  child.kill();
  fs.rmSync(temp, { recursive: true, force: true });
})().catch((e) => { console.error(e); child.kill(); process.exit(1); });
