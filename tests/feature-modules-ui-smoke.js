// Integrated UI + desktop bridge + authoritative SQLite service. Game data is synthetic.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createHttpServer } = require('../premium/server');
const { readConfig } = require('../premium/config');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-feature-ui-'));
const output = process.env.QA_OUTPUT || path.join(temp, 'screenshots'); fs.mkdirSync(output, { recursive: true });
const secret = crypto.randomBytes(32).toString('hex'), now = Math.floor(Date.now() / 1000);
const { server, service } = createHttpServer(readConfig({ PREMIUM_MODE: 'test', PREMIUM_DB_PATH: ':memory:', PREMIUM_TEST_AUTH_TOKEN: secret }), { fetchImpl: async () => { throw Error('External Torn calls forbidden'); } });
let browser; const children = [], errors = [];
const travel = { countries: [{ code: 'mex', name: 'Mexico', minutes: 30, update: now, source: 'YATA', items: [{ id: 1, name: 'Flower', type: 'Flower', cost: 100, market: 500, qty: 100, profit: 400 }] }, { code: 'uk', name: 'UK', minutes: 60, update: now, source: 'Prometheus', items: [{ id: 2, name: 'Plushie', type: 'Plushie', cost: 200, market: 1500, qty: 10, profit: 1300 }] }], fetchedAt: now * 1000, serverNow: now, method: 'Standard', sources: { yata: true, prom: true } };
const events = { events: [{ title: 'Easter Egg Hunt', description: '', kind: 'event', start: now - 3600, end: now + 86400, exact: true, fixed: true }], seasonal: [], easter: { score: 20, total: 100 }, halloween: null, at: now * 1000, calAt: now * 1000 };
const merits = { tracks: [{ id: '1', name: 'Education Length', level: 1, description: 'Course time reduction' }, { id: '2', name: 'Bank Interest', level: 0, description: 'Bank bonus' }, { id: '3', name: 'Life Points', level: 2, description: 'Life bonus' }], available: 30, awards: 40, at: now * 1000, source: 'desktop-api-snapshot' };
async function desktop(tornId) {
  const dir = path.join(temp, String(tornId)); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ theme: 'ocean', features: { 'app.splash': false, 'app.animations': false, 'app.updates': false } }));
  const child = fork(path.join(__dirname, 'preview-server.js'), { env: { ...process.env, TORN_DATA_DIR: dir, TORN_API_KEY: '', TORN_PREMIUM_SERVICE_URL: 'http://127.0.0.1:' + server.address().port, TORN_PREMIUM_TEST_MODE: '1', TORN_PREMIUM_TEST_TOKEN: secret, TORN_PREMIUM_TEST_TORN_ID: String(tornId) }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); children.push(child);
  const port = await new Promise((resolve, reject) => { child.once('message', (m) => resolve(m.port)); child.once('error', reject); child.once('exit', (c) => reject(Error('Desktop exited: ' + c))); });
  const base = 'http://127.0.0.1:' + port, context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }), page = await context.newPage();
  await context.addInitScript(() => {
    window.qaNotifications = JSON.parse(sessionStorage.getItem('qa.notifications') || '[]');
    window.Notification = class {
      static permission = 'granted';
      static requestPermission() { return Promise.resolve('granted'); }
      constructor(title, options) {
        window.qaNotifications.push({ title, ...options });
        sessionStorage.setItem('qa.notifications', JSON.stringify(window.qaNotifications));
      }
    };
  });
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url()); if (u.origin !== base) return route.abort();
    const fixtures = { '/api/travel': travel, '/api/events': events, '/api/merit-allocation': merits, '/api/awards': { awards: [], totals: { honors: [1, 10], medals: [1, 10], awards: 2 }, at: Date.now() } };
    return fixtures[u.pathname] ? route.fulfill({ json: fixtures[u.pathname] }) : route.continue();
  });
  await page.goto(base + '/#premium'); await page.locator('#auth-key').waitFor();
  await page.evaluate(() => { document.querySelector('#auth-screen').hidden = true; document.body.classList.remove('auth-open'); showView('premium'); });
  assert.equal(await page.locator('[data-premium-action="connect"],#premium-remember,#premium-consent,#pm-connect').count(), 0);
  await page.waitForFunction(() => !!window.PremiumAccess?.snapshot()?.account);
  return { page, base, context };
}
async function show(page, feature, view = 'premium') {
  await page.evaluate((v) => showView(v), view);
  const slot = page.locator('#view-' + view + ' [data-feature-slot="' + feature + '"]').first();
  await slot.locator('[data-advanced-open]').click(); await slot.locator('.fx-workbench').waitFor(); return slot;
}
async function save(slot, name) {
  await slot.locator('[name="profileName"]').fill(name);
  const response = slot.page().waitForResponse((r) => r.url().endsWith('/api/premium/feature-save') && r.request().method() === 'POST');
  await slot.locator('[data-fx-action="save"]').click(); assert.equal((await response).status(), 200);
  await slot.locator('.fx-feedback').filter({ hasText: /saved|kaydedildi/ }).waitFor();
  await slot.page().waitForFunction(() => !document.querySelector('[data-feature-open] [data-fx-action="save"]')?.matches(':disabled'));
}
async function analyze(slot) { await slot.locator('[type="submit"]').click(); await slot.locator('.fx-feedback').filter({ hasText: /completed|tamamlandı/ }).waitFor(); }
async function capture(page, name) { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await page.screenshot({ path: path.join(output, name), fullPage: true }); }
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const free = await desktop(234567), member = await desktop(123456);
  assert.equal(await free.page.locator('script[src="/advanced-modules.js"]').count(), 0, 'unused advanced bundle not loaded');
  assert.equal(await free.page.locator('#view-premium .fx-entry.is-locked').count(), 6);
  const forged = await free.page.request.post(free.base + '/api/premium/feature-run', { data: { featureId: 'appearance_custom_themes', premium: true, tornId: 4037017 } }); assert.equal(forged.status(), 403);
  await free.page.evaluate(() => showView('travel')); await free.page.locator('#tv-cap').waitFor();
  await free.page.locator('#tv-cap').fill('25'); await free.page.locator('#tv-cap').dispatchEvent('change');
  assert.equal(await free.page.locator('#tv-cap').inputValue(), '25'); assert.equal(await free.page.locator('#tv-results table').count() > 0, true);
  await free.page.evaluate(() => { showView('settings'); showSettingsTab('appearance'); });
  assert.equal(await free.page.locator('#theme-options .theme-choice').count(), 5);
  await free.page.locator('[data-theme-choice="light"]').click(); await free.page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await free.page.evaluate(() => showSettingsTab('torn'));
  for (const key of ['torn.ffScouterScript', 'torn.tornw3bScript', 'torn.liveFight']) assert.equal(await free.page.locator('[data-feature="' + key + '"]').isEnabled(), true);
  service.store.adjustSubscription({ tornId: 4037017, admin: true }, { torn_id: 123456, days: 30, reason: 'Feature UI fixture membership' });
  await member.page.evaluate(() => PremiumAccess.status(true));
  let slot = await show(member.page, 'appearance_custom_themes');
  await slot.locator('[data-fx-form]').waitFor();
  assert.equal(await slot.locator('[name="analysis-consent"]').count(),0);
  assert.equal(await slot.locator('.fx-data-notice').isVisible(),true);
  await slot.locator('[data-fx-preset="aurora"]').click(); await slot.locator('[name="density"]').selectOption('compact');
  await save(slot, 'Aurora desk'); await member.page.waitForFunction(() => document.documentElement.dataset.premiumAppearance === 'true');
  assert.equal(await member.page.evaluate(() => document.documentElement.dataset.density), 'compact');
  await slot.locator('[data-fx-profile]').selectOption(''); await slot.locator('[data-fx-preset="rose"]').click(); await save(slot, 'Rose desk');
  const w = service.features.workspace({ tornId: 123456 }, 'appearance_custom_themes'); assert.equal(w.profiles.length, 2);
  await slot.locator('[data-fx-profile]').selectOption(w.profiles[0].id); await member.page.waitForFunction(() => document.documentElement.style.getPropertyValue('--tq') === '#68e0c2');
  await capture(member.page, 'appearance-studio.png');
  await slot.locator('[data-fx-action="close"]').click();
  await member.page.evaluate(() => showView('travel')); await member.page.locator('#tv-results table').first().waitFor();
  await capture(member.page, 'travel-basic.png');
  slot = await show(member.page, 'travel_advanced', 'travel');
  await slot.locator('[name="feePercent"]').fill('10'); await slot.locator('[name="waitMinutes"]').fill('20'); await analyze(slot);
  assert.ok((await slot.locator('.fx-result').textContent()).includes('Mexico'));
  await save(slot, '<img src=x onerror=alert(1)>'); assert.equal(await slot.locator('img').count(), 0);
  await capture(member.page, 'travel-strategies.png');
  await slot.locator('[name="watchKey"]').selectOption('mex:1');
  await slot.locator('details:has([name="rule.enabled"]) > summary').click();
  await slot.locator('[name="rule.enabled"]').check(); await slot.locator('[name="rule.threshold"]').fill('100');
  await save(slot, '<img src=x onerror=alert(1)>');
  await member.page.evaluate(async () => { await LRXAdvanced.background(); await LRXAdvanced.background(); });
  assert.equal(await member.page.evaluate(() => qaNotifications.filter((n) => n.tag.startsWith('advanced:')).length), 1, 'one native notification per matching rule cooldown');
  const travelProfile = service.features.workspace({ tornId: 123456 }, 'travel_advanced').activeProfile;
  await slot.locator('[data-fx-action="close"]').click();
  // Target data mirrors the existing Free war module's loaded data structure.
  await member.page.evaluate((at) => {
    state.targets = { faction: { id: 99, name: 'Fixture faction', members: 2 }, serverTime: at, me: { name: 'Fixture', totals: { base: 1000, noXanax: 1000, withXanax: 650 } }, members: [{ id: 11, name: 'Alpha', level: 30, bs: 600, status: { state: 'Okay' }, lastAction: { timestamp: at }, ffRemote: 2.6 }, { id: 12, name: 'Beta', level: 50, bs: 1200, status: { state: 'Hospital' }, lastAction: { timestamp: at }, ffRemote: 3 }] };
  }, now);
  slot = await show(member.page, 'helpers_advanced');
  await slot.locator('[name="status"]').selectOption('Okay'); await slot.locator('[name="minFF"]').fill('2');
  await slot.locator('[name="compare.0"]').selectOption('11'); await slot.locator('[name="compare.1"]').selectOption('12'); await analyze(slot);
  assert.ok((await slot.locator('.fx-result').textContent()).includes('Alpha')); assert.ok((await slot.locator('.fx-result').textContent()).includes('Beta'));
  await save(slot, 'Okay players'); await capture(member.page, 'player-comparison.png'); await slot.locator('[data-fx-action="close"]').click();
  slot = await show(member.page, 'events_advanced');
  await slot.locator('[name="eventKey"]').selectOption({ index: 1 }); await slot.locator('[name="goal"]').fill('40'); await analyze(slot);
  assert.ok((await slot.locator('.fx-result').textContent()).includes('20 / 40')); await save(slot, 'Easter goal');
  await capture(member.page, 'event-goals.png'); await slot.locator('[data-fx-action="close"]').click();
  slot = await show(member.page, 'merits_optimizer', 'awards');
  await slot.locator('[name="goal"]').selectOption('education'); await slot.locator('[name="targets.1"]').fill('10'); await analyze(slot);
  assert.ok((await slot.locator('.fx-result').textContent()).includes('Education Length')); await save(slot, 'Study plan');
  await capture(member.page, 'merit-planner.png');
  for (const width of [640, 390]) {
    await member.page.setViewportSize({ width, height: 900 });
    await capture(member.page, 'merits-' + width + '.png');
    const size = await member.page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth })); assert.ok(size.scroll <= size.width + 1, JSON.stringify(size));
  }
  await member.page.setViewportSize({ width: 1440, height: 1050 });
  service.store.db.prepare('UPDATE premium_subscriptions SET expires_at=? WHERE torn_id=123456').run(Math.floor(Date.now() / 1000) + 2);
  await member.page.evaluate(() => PremiumAccess.status(true));
  await member.page.waitForFunction(() => !document.documentElement.dataset.premiumAppearance, null, { timeout: 6000 });
  assert.ok((await slot.textContent()).includes('Saved settings are retained')); assert.equal(await member.page.evaluate(() => document.documentElement.dataset.theme), 'ocean');
  assert.equal((await member.page.request.post(member.base + '/api/premium/feature-run', { data: { featureId: 'travel_advanced', input: {} } })).status(), 403);
  service.store.adjustSubscription({ tornId: 4037017, admin: true }, { torn_id: 123456, days: 30, reason: 'Renew UI fixture membership' });
  await member.page.evaluate(() => PremiumAccess.status(true)); await member.page.waitForFunction(() => document.documentElement.dataset.premiumAppearance === 'true');
  assert.equal(service.features.workspace({ tornId: 123456 }, 'travel_advanced').activeProfile, travelProfile);
  await slot.locator('[data-fx-action="close"]').click(); slot = await show(member.page, 'travel_advanced', 'travel');
  assert.equal(await slot.locator('[name="feePercent"]').inputValue(), '10');
  // A transport failure locks paid tools and falls back to the user's original Free theme.
  await member.page.route('**/api/premium/status', (r) => r.fulfill({ status: 503, json: { code: 'PREMIUM_SERVICE_UNREACHABLE', error: 'Unavailable' } }));
  await member.page.evaluate(() => PremiumAccess.status(true).catch(() => {})); assert.equal(await member.page.evaluate(() => PremiumAccess.can('travel_advanced')), false);
  assert.equal(await member.page.evaluate(() => PremiumAccess.can('travel_basic')), true);
  await member.page.unroute('**/api/premium/status'); await member.page.evaluate(() => PremiumAccess.status(true));
  await member.page.locator('[data-lang="tr"]').click(); assert.ok((await slot.textContent()).includes('Seyahat stratejileri'));
  // A new renderer loads active rules itself and keeps notification deduplication on disk.
  await member.page.reload(); await member.page.waitForFunction(() => !!window.LRXAdvanced && !!PremiumAccess.snapshot()?.featureAccess?.automations?.length);
  await member.page.evaluate(async () => { await LRXAdvanced.resume(PremiumAccess.snapshot().featureAccess.automations); await fetchTravel(); await LRXAdvanced.background(); });
  assert.equal(await member.page.evaluate(() => qaNotifications.filter((n) => n.tag.startsWith('advanced:')).length), 1, 'reload does not repeat an already delivered alert');
  const afterReload = await member.page.evaluate(async () => {
    const keys = [...notified.keys()].filter((k) => k.startsWith('advanced:'));
    for (const key of keys) notified.delete(key); // Expire only this synthetic notification cooldown.
    await LRXAdvanced.background(); return qaNotifications.filter((n) => n.tag.startsWith('advanced:')).length;
  });
  assert.equal(afterReload, 2, 'restored rule remains functional when its cooldown expires');
  assert.deepEqual(errors, []); console.log(JSON.stringify({ ok: true, checks: ['Free travel/capacity/themes/scripts', 'lazy advanced bundle', 'server rejects forged membership', 'informational analysis notice without acceptance', 'custom theme profiles and one-click switching', 'travel scenarios/history', 'combined filters/player comparison', 'API event progress', 'merit budget/plan', 'escaped profile names', '390/640/1440px', 'expiry and renewal', 'outage fails closed without blocking Free', 'TR/EN', 'native rule notification', 'rules and deduplication survive renderer restart'], screenshots: output }));
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); for (const c of children) c.kill(); await new Promise((r) => server.close(r)); await service.close(); });
