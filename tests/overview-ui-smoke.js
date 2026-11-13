// Overview widget grid: real desktop HTTP bridge + real central Premium service (test mode), synthetic Torn data only.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createHttpServer } = require('../premium/server');
const { readConfig } = require('../premium/config');
const { buildBattleStats } = require('../src/server/battle-stats');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-overview-ui-'));
const secret = crypto.randomBytes(32).toString('hex');
const config = readConfig({ PREMIUM_MODE: 'test', PREMIUM_DB_PATH: ':memory:', PREMIUM_TEST_AUTH_TOKEN: secret });
const { server, service } = createHttpServer(config, { fetchImpl: async () => { throw Error('External calls are forbidden in UI fixtures'); } });
const children = []; let browser;
const output = process.env.QA_OUTPUT || path.join(temp, 'screenshots'); fs.mkdirSync(output, { recursive: true });
const MEMBER = 4037017, OTHER = 3000001;
const DEFAULT_IDS = ['profile', 'drug', 'edu', 'day', 'bars', 'chips', 'battle']; // company is in the layout but hidden: not a director
const PHOTO = 'https://profileimages.torn.com/ok.png';
let overviewPlayer = null;
const overviewFixture = () => ({
  player: overviewPlayer, serverTime: Math.floor(Date.now() / 1000),
  battle: buildBattleStats({ strength: 1250000, defense: 980000, speed: 1100000, dexterity: 870000 }),
  bars: { energy: { current: 120, maximum: 150, fulltime: 900 }, nerve: { current: 35, maximum: 60, fulltime: 3600 }, happy: { current: 3500, maximum: 5000, fulltime: 7200 }, life: { current: 2400, maximum: 3000, fulltime: 1200 }, chain: { current: 0 } },
  cooldowns: { drug: 3600, booster: 0, medical: 1800 },
  drug: { cooldown: 3600, xanaxActive: true, xanToday: 1, xantaken: 812, refills: 40 },
  education: { timeLeft: 7200, currentId: 12, current: 'Bachelor of Biology', code: 'BIO', duration: 86400, completed: 20, totalCourses: 100 },
  bank: { amount: 2500000000, timeLeft: 86400 * 3 },
});
async function desktop(tornId) {
  const data = path.join(temp, String(tornId)); fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ features: { 'app.splash': false, 'app.animations': false, 'app.updates': false } }));
  // The server's player (historyOwner) is this id, as after a sign-in.
  fs.writeFileSync(path.join(data, 'history.json'), JSON.stringify({ ownerId: tornId, days: [], addiction: {}, user: {}, stockOrders: {} }));
  const child = fork(path.join(__dirname, 'preview-server.js'), { env: { ...process.env, TORN_DATA_DIR: data, TORN_API_KEY: '', TORN_PREMIUM_SERVICE_URL: 'http://127.0.0.1:' + server.address().port,
    TORN_PREMIUM_TEST_MODE: '1', TORN_PREMIUM_TEST_TOKEN: secret, TORN_PREMIUM_TEST_TORN_ID: String(tornId) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.push(child);
  const port = await new Promise((resolve, reject) => { child.once('message', (m) => resolve(m.port)); child.once('error', reject); child.once('exit', (code) => reject(Error('Fixture exited ' + code))); });
  const base = 'http://127.0.0.1:' + port, context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.route(PHOTO, (route) => route.fulfill({ path: path.join(__dirname, '..', 'public', 'logo.png') }));
  await page.route((url) => url.pathname === '/api/overview', (route) => route.fulfill({ json: overviewFixture() }));
  await page.goto(base + '/#overview');
  return { page, base, errors, context };
}
// The app login is independent of this check: the sign-in screen is closed and the overview arrives through the
// real loadOverview() → renderOverview() path, with the Torn reply routed to the fixture above.
async function open(page) {
  await page.locator('#auth-key').waitFor({ state: 'visible' });
  await page.evaluate(() => { document.querySelector('#auth-screen').hidden = true; document.body.classList.remove('auth-open'); showView('overview'); });
  await page.evaluate(() => loadOverview(true));
}
const visibleIds = (page) => page.evaluate(() => [...document.querySelectorAll('#ow-grid > .ow-w:not(.ow-off)')].filter((el) => el.getClientRects().length).map((el) => el.dataset.widget));
const waitForIds = (page, ids) => page.waitForFunction((want) => [...document.querySelectorAll('#ow-grid > .ow-w:not(.ow-off)')].filter((el) => el.getClientRects().length).map((el) => el.dataset.widget).join() === want.join(), ids, { timeout: 10000 });
// Settled quietly when the test fails before awaiting it; awaiting it still reports a rejection.
const layoutReply = (page, method = 'GET') => { const reply = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/overview-layouts' && r.request().method() === method); reply.catch(() => {}); return reply; };
const saveDirect = (page, playerId, widgets) => page.evaluate(({ playerId, widgets }) => fetch('/api/overview-layouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId, layouts: { v: 1, active: 0, layouts: [{ name: '', widgets }] } }) }).then((r) => r.status), { playerId, widgets });
const overflow = (page) => page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('#view-overview *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map((el) => el.tagName + '.' + el.className) }));
const shot = async (page, name, fullPage = true) => { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await page.screenshot({ path: path.join(output, name), fullPage }); };
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  overviewPlayer = { id: MEMBER, name: '<b>Bold</b>', level: 15, image: PHOTO, status: { state: 'Okay', description: 'Okay', color: 'green' }, faction: { faction_id: 5, faction_tag: 'TAG', faction_name: 'Example' }, job: { position: 'Employee', company_id: 0, job: 'None' } };
  const { page, errors } = await desktop(MEMBER);
  const posts = []; page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/overview-layouts') posts.push(r.postDataJSON()); });
  const firstReply = layoutReply(page);
  await open(page);

  // default layout
  assert.equal(await page.locator('#ow-grid').count(), 1, 'default layout: the Overview is a widget grid (#ow-grid)');
  await firstReply;
  await page.locator('#ow-grid > [data-widget="profile"] .pm-profile:not(.is-missing) img.pm-profile-photo').waitFor();
  assert.deepEqual(await visibleIds(page), DEFAULT_IDS, 'default layout: today\'s cards with the profile first');
  assert.equal(await page.locator('#ov-company').evaluate((el) => el.hidden && !el.classList.contains('ow-off') && el.classList.contains('grid') && el.classList.contains('three')), true, 'company mode owns #ov-company.hidden; the widget is in the layout');
  const profile = page.locator('#ow-grid > [data-widget="profile"] .pm-profile');
  assert.ok((await profile.textContent()).includes('<b>Bold</b>'), 'the name is shown as text');
  assert.equal(await page.locator('#ow-grid > [data-widget="profile"] b').count(), 0, 'Torn data never becomes markup');
  assert.match(await profile.getAttribute('data-open-url'), /XID=4037017$/);
  assert.equal(await page.locator('#ow-grid > [data-widget="profile"]').evaluate((el) => getComputedStyle(el).gridRowStart), 'span 3', 'the profile is tall');
  assert.equal(await page.evaluate(() => LRXOverview.owner()), MEMBER);
  assert.equal(posts.length, 0, 'loading never saves');

  // fixed IDs: app.js renders into these whether or not their widget is shown
  for (const selector of ['#t-drug', '#t-edu', '#t-day', '[data-timer="drug"]', '[data-timer="edu"]', '[data-timer="day"]', '#bars', '#mini-row', '#status-chip', '#xan-chip', '#bs-totals', '#bs-table', '#ov-company']) {
    assert.equal(await page.locator(selector).count(), 1, 'fixed ID ' + selector);
  }
  assert.equal(await page.locator('#ow-grid > [data-widget="bars"]').locator('#status-chip, #bars').count(), 2, 'the bars widget holds the status chip and the bars');
  assert.equal(await page.locator('#ow-grid > [data-widget="chips"] #mini-row').count(), 1, 'the status chips are their own widget');

  // saved layout
  assert.equal(await saveDirect(page, MEMBER, [{ id: 'battle', size: 'M' }, { id: 'drug', size: 'S' }]), 200);
  posts.length = 0;
  await page.reload(); await open(page);
  await waitForIds(page, ['battle', 'drug']);
  assert.equal(await page.locator('#bars').count(), 1, 'a hidden widget stays in the DOM');
  assert.equal(await page.locator('[data-widget="bars"]').evaluate((el) => el.classList.contains('ow-off') && getComputedStyle(el).display === 'none'), true);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('tt.cache.overviewLayouts.4037017')).layouts[0].widgets.map((w) => w.id)), ['battle', 'drug'], 'the confirmed set is cached');

  // corrupt cached copy
  await page.evaluate(() => localStorage.setItem('tt.cache.overviewLayouts.4037017', '{bad'));
  const failing = (url) => url.pathname === '/api/overview-layouts';
  await page.route(failing, (route) => route.request().method() === 'GET' ? route.fulfill({ status: 500, json: { error: 'fixture outage' } }) : route.continue());
  await page.reload();
  const failed = layoutReply(page);
  await open(page);
  assert.equal((await failed).status(), 500);
  await page.locator('#ow-grid > [data-widget="profile"] .pm-profile').waitFor();
  assert.deepEqual(await visibleIds(page), DEFAULT_IDS, 'an unreadable cached copy falls back to the default layout');
  assert.equal(await page.locator('#alert-area .alert').count(), 0, 'a failed layout request raises no alert');
  assert.equal(await page.evaluate(() => LRXOverview.owner()), null);
  await page.unroute(failing);

  // free cards first
  let released = false;
  const slow = (url) => url.pathname === '/api/overview-layouts';
  await page.route(slow, async (route) => { if (route.request().method() === 'GET') { await new Promise((r) => setTimeout(r, 1500)); released = true; } return route.continue(); });
  await page.reload();
  const slowReply = layoutReply(page);
  await open(page);
  await page.locator('#t-drug').waitFor({ state: 'visible', timeout: 1000 });
  assert.equal(released, false, '#t-drug is visible before the layout reply');
  await slowReply;
  await waitForIds(page, ['battle', 'drug']);
  await page.unroute(slow);

  // another player in the overview sees the default layout
  posts.length = 0;
  overviewPlayer = { ...overviewPlayer, id: OTHER, name: 'Other' };
  const otherReply = layoutReply(page);
  await page.evaluate(() => loadOverview(true));
  assert.equal((await (await otherReply).json()).playerId, MEMBER, 'the server still reports its own player');
  await waitForIds(page, DEFAULT_IDS);
  assert.match(await profile.getAttribute('data-open-url'), /XID=3000001$/);
  assert.equal(await page.evaluate(() => LRXOverview.owner()), null);
  await page.evaluate(() => LRXOverview.commit(LRXOverviewLayout.remove(LRXOverview.current(), 0, 'chips')));
  assert.equal(posts.length, 0, 'nothing is saved under another player');
  assert.equal(await page.evaluate(() => localStorage.getItem('tt.cache.overviewLayouts.3000001')), null);
  overviewPlayer = { ...overviewPlayer, id: MEMBER, name: '<b>Bold</b>' };
  const backReply = layoutReply(page);
  await page.evaluate(() => loadOverview(true));
  await backReply;
  await waitForIds(page, ['battle', 'drug']);

  // saving: commit sends the full set once, updates the cached copy; 409 reloads; other errors say so
  posts.length = 0;
  await page.evaluate(() => LRXOverview.commit(LRXOverviewLayout.defaultSet()));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].playerId, MEMBER);
  assert.deepEqual(posts[0].layouts.layouts[0].widgets.map((w) => w.id), [...DEFAULT_IDS, 'company']);
  await waitForIds(page, DEFAULT_IDS);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('tt.cache.overviewLayouts.4037017')).layouts[0].widgets.map((w) => w.id)), [...DEFAULT_IDS, 'company']);
  const conflict = (url) => url.pathname === '/api/overview-layouts';
  await page.route(conflict, (route) => route.request().method() === 'POST' ? route.fulfill({ status: 409, json: { error: 'The layout belongs to another player.', code: 'PLAYER_CHANGED' } }) : route.continue());
  const reloaded = layoutReply(page);
  await page.evaluate(() => LRXOverview.commit(LRXOverviewLayout.remove(LRXOverview.current(), 0, 'battle')));
  await reloaded;
  await page.waitForFunction(() => document.querySelector('#toast').textContent === 'The layout belonged to another player; reloaded.');
  await waitForIds(page, DEFAULT_IDS);
  await page.unroute(conflict);
  await page.route(conflict, (route) => route.request().method() === 'POST' ? route.fulfill({ status: 500, json: { error: 'fixture failure' } }) : route.continue());
  await page.evaluate(() => LRXOverview.commit(LRXOverviewLayout.remove(LRXOverview.current(), 0, 'battle')));
  await page.waitForFunction(() => document.querySelector('#toast').textContent === 'Could not save the layout: fixture failure');
  await page.unroute(conflict);
  await page.evaluate(() => LRXOverview.commit(LRXOverviewLayout.defaultSet()));
  await waitForIds(page, DEFAULT_IDS);

  // empty layout hint
  await page.evaluate(() => LRXOverview.commit({ v: 1, active: 0, layouts: [{ name: '', widgets: [] }] }, { save: false }));
  assert.deepEqual(await visibleIds(page), []);
  assert.equal((await page.locator('#ow-grid .ow-empty').textContent()).trim(), 'This layout has no widgets. Press Edit to add some.');
  await page.evaluate(() => LRXOverview.commit(LRXOverviewLayout.defaultSet(), { save: false }));
  assert.equal(await page.locator('#ow-grid .ow-empty').count(), 0);
  await waitForIds(page, DEFAULT_IDS);
  await page.waitForFunction(() => !document.querySelector('#toast').classList.contains('show')); // clean screenshots

  // classic switch
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.evaluate(() => setFeature('app.overviewLayout', false));
  assert.equal(await page.locator('[data-widget="bars"] #mini-row').count(), 1, 'classic: the chips are back in the bars card');
  assert.equal(await page.locator('#ow-grid > [data-widget="profile"]').isVisible(), false, 'classic: no profile card');
  assert.equal(await page.locator('#ow-grid > [data-widget="chips"]').isVisible(), false);
  assert.equal(await page.locator('#ow-grid').evaluate((el) => el.classList.contains('ow-classic')), true);
  const tops = await page.evaluate(() => ['#t-drug', '#t-edu', '#t-day'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)));
  assert.equal(new Set(tops).size, 1, 'classic: the three timers share one row ' + JSON.stringify(tops));
  await shot(page, 'overview-classic-1440.png');
  await page.evaluate(() => setFeature('app.overviewLayout', true));
  assert.equal(await page.locator('[data-widget="chips"] #mini-row').count(), 1, 'the chips card is restored');
  await waitForIds(page, DEFAULT_IDS);

  // widths
  for (const [width, columns] of [[1440, 4], [1100, 2], [760, 2], [640, 2], [600, 1]]) {
    await page.setViewportSize({ width, height: 900 });
    const m = await overflow(page);
    assert.ok(m.scroll <= m.width, 'no sideways scroll at ' + width + ': ' + JSON.stringify(m));
    assert.equal(await page.locator('#ow-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length), columns, 'columns at ' + width);
    await shot(page, 'overview-' + width + '.png');
  }

  // themes
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.locator('[data-view="settings"]').click(); await page.locator('[data-set-tab="appearance"]').click();
  for (const theme of ['ocean', 'forest', 'amethyst', 'light', 'obsidian']) {
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    await page.waitForFunction(() => document.querySelector('#theme-save-status').textContent.includes('saved'));
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    await page.evaluate(() => showView('overview'));
    const m = await overflow(page);
    assert.ok(m.scroll <= m.width, theme + ': ' + JSON.stringify(m));
    await shot(page, 'overview-theme-' + theme + '.png');
    await page.evaluate(() => { showView('settings'); showSettingsTab('appearance'); });
  }

  // TR / EN
  await page.evaluate(() => showView('overview'));
  await page.locator('[data-lang="tr"]').click();
  assert.equal((await page.locator('#ow-grid > [data-widget="chips"] h3').textContent()).trim(), 'Durum');
  await page.evaluate(() => LRXOverview.commit({ v: 1, active: 0, layouts: [{ name: '', widgets: [] }] }, { save: false }));
  assert.equal((await page.locator('#ow-grid .ow-empty').textContent()).trim(), "Bu düzende widget yok. Eklemek için Düzenle'ye bas.");
  await page.locator('[data-lang="en"]').click();
  assert.equal((await page.locator('#ow-grid .ow-empty').textContent()).trim(), 'This layout has no widgets. Press Edit to add some.', 'a language change redraws the grid');
  assert.equal((await page.locator('#ow-grid > [data-widget="chips"] h3').textContent()).trim(), 'Status');

  // Premium tiles before their widgets exist: the host creates them, shows the lock state, removes them again.
  // The service does not know the module yet, so a fresh answer for this member is a lapse.
  await page.waitForFunction(() => LRXOverview.access() === 'lapsed');
  await page.evaluate(() => LRXOverview.commit({ v: 1, active: 0, layouts: [{ name: '', widgets: [{ id: 'drug', size: 'S' }, { id: 'gym', size: 'L' }] }] }, { save: false }));
  const gym = page.locator('#ow-grid > article.glass.card.ow-w.ow-premium[data-widget="gym"]');
  assert.deepEqual(await visibleIds(page), ['drug', 'gym']);
  assert.equal(await gym.getAttribute('data-size'), 'M', 'after a lapse a Premium widget shows at its default size');
  assert.ok((await gym.textContent()).includes('Gym gains') && (await gym.textContent()).includes('Unlocks with Premium'));
  await page.evaluate(() => setFeature('app.premiumPromos', false));
  assert.ok((await gym.textContent()).includes('Not available'));
  await page.evaluate(() => setFeature('app.premiumPromos', true));
  await page.evaluate(() => setFeature('app.overviewLayout', false));
  assert.equal(await gym.isVisible(), false, 'classic: Premium tiles are hidden');
  await page.evaluate(() => setFeature('app.overviewLayout', true));
  await page.evaluate(() => LRXOverview.commit(LRXOverviewLayout.defaultSet(), { save: false }));
  assert.equal(await page.locator('#ow-grid > .ow-premium').count(), 0);

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, assertions: ['default layout with the tall profile first', 'company hidden by company mode, never by the grid', 'profile name as text and Torn profile link', 'fixed IDs stay in the DOM', 'saved layout after reload', 'corrupt cached copy and failed request fall back quietly', 'free cards before the layout reply', 'another player sees the default layout and nothing is saved', 'commit saves once and caches; 409 reloads; errors toast', 'empty layout hint', 'classic switch', 'widths 1440/1100/760/640/600', 'five themes', 'TR/EN', 'Premium tiles show their lock state and hide in classic', 'no page errors or CSP reports'], screenshots: output }));
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  for (const child of children) { child.kill(); await new Promise((r) => child.exitCode !== null ? r() : child.once('exit', r)); }
  await new Promise((r) => server.close(r)); await service.close();
  const resolved = path.resolve(temp);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('lrx-overview-ui-')) throw Error('Unsafe fixture cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});
