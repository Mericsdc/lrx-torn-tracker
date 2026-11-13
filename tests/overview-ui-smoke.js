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
  const { page, errors, context } = await desktop(MEMBER);
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

  // a failed layout request is asked again; until the player is confirmed a save is refused out loud, never skipped quietly
  posts.length = 0;
  const askedAgain = layoutReply(page);
  await page.evaluate(() => LRXOverview.commit(LRXOverviewLayout.remove(LRXOverview.current(), 0, 'chips')));
  assert.equal(await page.locator('#toast').textContent(), 'Could not save the layout: the saved layouts for this player could not be loaded.');
  assert.equal((await askedAgain).status(), 500, 'the save asked for the player\'s layouts once more first');
  assert.equal(posts.length, 0, 'nothing is saved for an unconfirmed player');
  await page.unroute(failing);
  const retried = layoutReply(page);
  await page.evaluate(() => loadOverview(true));
  assert.equal((await retried).status(), 200, 'the next overview render asks again');
  await page.waitForFunction((id) => LRXOverview.owner() === id, MEMBER);
  await waitForIds(page, ['battle', 'drug']); // the refused edit gives way to the saved layout
  await page.evaluate(() => LRXOverview.commit(LRXOverview.current()));
  assert.equal(posts.length, 1, 'once confirmed, a commit saves');
  assert.equal(posts[0].playerId, MEMBER);
  assert.deepEqual(posts[0].layouts.layouts[0].widgets.map((w) => w.id), ['battle', 'drug']);

  // a change made on the default screen (no readable cached copy, failed request) never replaces the saved layouts
  // when the save's own request confirms the player late
  await page.evaluate(() => localStorage.setItem('tt.cache.overviewLayouts.4037017', '{bad'));
  await page.route(failing, (route) => route.request().method() === 'GET' ? route.fulfill({ status: 500, json: { error: 'fixture outage' } }) : route.continue());
  await page.reload();
  const failedAtLoad = layoutReply(page);
  await open(page);
  assert.equal((await failedAtLoad).status(), 500);
  await page.locator('#ow-grid > [data-widget="profile"] .pm-profile').waitFor();
  assert.deepEqual(await visibleIds(page), DEFAULT_IDS);
  await page.unroute(failing);
  posts.length = 0;
  const lateReply = layoutReply(page);
  await page.evaluate(() => { document.querySelector('#toast').textContent = ''; return LRXOverview.commit(LRXOverviewLayout.remove(LRXOverview.current(), 0, 'chips')); });
  assert.equal((await lateReply).status(), 200, 'the save asked again and the player was confirmed');
  assert.equal(posts.length, 0, 'the default-screen change is not saved over the saved layouts');
  assert.equal(await page.locator('#toast').textContent(), 'Your saved layout was loaded; the change you made on the default screen was not saved.');
  assert.equal(await page.evaluate(() => LRXOverview.owner()), MEMBER);
  await waitForIds(page, ['battle', 'drug']);
  assert.deepEqual(await page.evaluate(() => fetch('/api/overview-layouts').then((r) => r.json()).then((r) => r.layouts.layouts[0].widgets.map((w) => w.id))), ['battle', 'drug'], 'the server keeps the saved layouts');
  await page.evaluate(() => LRXOverview.commit(LRXOverview.current()));
  assert.equal(posts.length, 1, 'a change made on the loaded layout saves');

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
  await page.evaluate(() => { document.querySelector('#toast').textContent = ''; return LRXOverview.commit(LRXOverviewLayout.remove(LRXOverview.current(), 0, 'chips')); });
  assert.equal(posts.length, 0, 'nothing is saved under another player');
  assert.equal(await page.locator('#toast').textContent(), 'Could not save the layout: the saved layouts for this player could not be loaded.');
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
  await context.close();

  // Edit mode: a free player (3000001, no Premium) on their own desktop.
  overviewPlayer = { ...overviewPlayer, id: OTHER, name: 'Free player' };
  const free = await desktop(OTHER), fp = free.page, freePosts = [];
  fp.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/overview-layouts') freePosts.push(r.postDataJSON()); });
  await fp.locator('#auth-key').waitFor({ state: 'visible' });
  assert.equal(await fp.evaluate(() => state.overview?.player?.id ?? null), null);
  assert.equal(await fp.locator('#ow-edit').isVisible(), false, 'no Edit before an overview player is known');
  assert.equal(await fp.evaluate(() => { LRXOverviewEdit.start(); return LRXOverviewEdit.active(); }), false, 'edit mode needs a known player');
  await open(fp);
  await fp.waitForFunction((id) => LRXOverview.owner() === id, OTHER);
  await waitForIds(fp, DEFAULT_IDS);
  const handle = (id) => fp.locator(`#ow-grid > [data-widget="${id}"] .ow-handle`);
  const removeBtn = (id) => fp.locator(`#ow-grid > [data-widget="${id}"] .ow-remove`);
  const focusedHandle = () => fp.evaluate(() => (document.activeElement?.classList.contains('ow-handle') ? document.activeElement.closest('#ow-grid > .ow-w').dataset.widget : null));
  const savedIds = (post) => post.layouts.layouts[0].widgets.map((w) => w.id);
  const editing = () => fp.evaluate(() => LRXOverviewEdit.active());

  // edit mode shows a handle and × for each shown widget
  await fp.locator('#ow-edit').click();
  assert.equal(await editing(), true);
  assert.equal(await fp.locator('#ow-grid').evaluate((el) => el.classList.contains('ow-editing')), true);
  for (const id of DEFAULT_IDS) {
    assert.equal(await handle(id).isVisible(), true, 'a handle on ' + id);
    assert.equal(await removeBtn(id).isVisible(), true, 'a × on ' + id);
    assert.equal(await fp.locator(`#ow-grid > [data-widget="${id}"]`).evaluate((el) => getComputedStyle(el).outlineStyle), 'dashed', 'a dashed frame on ' + id);
  }
  assert.equal(await handle('battle').getAttribute('aria-label'), 'Move: Battle stats');
  assert.equal(await removeBtn('battle').getAttribute('aria-label'), 'Remove');
  assert.equal(await fp.locator('#ow-grid .ow-sizes:visible').count(), 0, 'a free player has no size buttons');
  for (const sel of ['#ow-layout', '#ow-name', '#ow-duplicate', '#ow-delete', '#ow-edit']) assert.equal(await fp.locator(sel).isVisible(), false, sel + ' is not shown');
  for (const [sel, text] of [['#ow-reset', 'Reset to default'], ['#ow-add', '+ Add widget'], ['#ow-done', 'Done']]) assert.equal((await fp.locator(sel).textContent()).trim(), text);
  await fp.locator('[data-lang="tr"]').click();
  assert.equal((await fp.locator('#ow-done').textContent()).trim(), 'Bitti', 'a language change relabels the controls');
  assert.equal(await handle('battle').getAttribute('aria-label'), 'Taşı: Savaş gücü');
  assert.equal(await removeBtn('battle').getAttribute('aria-label'), 'Kaldır');
  await fp.locator('[data-lang="en"]').click();
  assert.equal((await fp.locator('#ow-add').textContent()).trim(), '+ Add widget');

  // × removes chips and #mini-row stays in the DOM
  await removeBtn('chips').click();
  await waitForIds(fp, ['profile', 'drug', 'edu', 'day', 'bars', 'battle']);
  assert.equal(await fp.locator('#mini-row').count(), 1);

  // keyboard: ArrowLeft twice on battle moves it two places; Delete on day removes it
  await handle('battle').focus();
  await fp.keyboard.press('ArrowLeft');
  assert.deepEqual(await visibleIds(fp), ['profile', 'drug', 'edu', 'day', 'battle', 'bars']);
  assert.equal(await focusedHandle(), 'battle', 'focus stays on the moved widget');
  await fp.keyboard.press('ArrowLeft');
  assert.deepEqual(await visibleIds(fp), ['profile', 'drug', 'edu', 'battle', 'day', 'bars']);
  assert.equal(await focusedHandle(), 'battle');
  await handle('day').focus();
  await fp.keyboard.press('Delete');
  assert.deepEqual(await visibleIds(fp), ['profile', 'drug', 'edu', 'battle', 'bars']);
  assert.equal(await focusedHandle(), 'bars', 'focus moves to the next handle');

  // drag drug onto edu moves drug after edu
  const edu = fp.locator('#ow-grid > [data-widget="edu"]'), eduBox = await edu.boundingBox();
  await handle('drug').dragTo(edu, { targetPosition: { x: eduBox.width * 0.8, y: eduBox.height / 2 } });
  await waitForIds(fp, ['profile', 'edu', 'drug', 'battle', 'bars']);
  assert.equal(await fp.locator('#ow-grid > :is(.ow-drop-before,.ow-drop-after,.ow-dragging)').count(), 0, 'no drag marks are left');

  // add list: chips comes back last; Premium items are disabled with a lock
  await fp.locator('#ow-add').click();
  const drawer = fp.locator('#ow-drawer');
  await drawer.waitFor({ state: 'visible' });
  assert.equal(await fp.locator('#ow-add').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await drawer.locator('[data-add]:not([disabled])').evaluateAll((els) => els.map((el) => el.dataset.add)), ['day', 'chips'], 'the free widgets not in the layout');
  const locked = drawer.locator('[data-add][disabled]');
  assert.equal(await locked.count(), 11, 'every Premium widget is listed');
  assert.equal(await locked.evaluateAll((els) => els.every((el) => el.textContent.includes('🔒') && el.textContent.includes('Premium'))), true, 'Premium items carry a lock and the note');
  assert.ok((await drawer.textContent()).includes('Premium 👑'));
  await drawer.locator('[data-add="gym"]').click({ force: true });
  await drawer.locator('[data-add="chips"]').click();
  await waitForIds(fp, ['profile', 'edu', 'drug', 'battle', 'bars', 'chips']);
  assert.equal(await drawer.locator('[data-add="chips"]').count(), 0, 'an added widget leaves the list');
  assert.equal(await fp.locator('#ow-grid > [data-widget="gym"]').count(), 0, 'a locked item adds nothing');
  assert.equal(freePosts.length, 0, 'edits are not saved before Done');

  // Done saves: after a reload the order is the same
  const doneSave = layoutReply(fp, 'POST');
  await fp.locator('#ow-done').click();
  assert.equal((await doneSave).status(), 200);
  assert.equal(freePosts.length, 1, 'Done saves once');
  assert.equal(freePosts[0].playerId, OTHER);
  assert.deepEqual(savedIds(freePosts[0]), ['profile', 'edu', 'drug', 'battle', 'bars', 'company', 'chips']);
  assert.equal(await editing(), false);
  assert.equal(await fp.locator('#ow-grid .ow-ctl').count(), 0, 'Done removes the edit controls');
  assert.equal(await drawer.isVisible(), false);
  assert.equal(await fp.locator('#ow-edit').evaluate((el) => document.activeElement === el), true, 'focus returns to Edit');
  await fp.evaluate(() => localStorage.removeItem('tt.cache.overviewLayouts.3000001')); // the order must come from the saved config
  await fp.reload(); await open(fp);
  await fp.waitForFunction((id) => LRXOverview.owner() === id, OTHER);
  await waitForIds(fp, ['profile', 'edu', 'drug', 'battle', 'bars', 'chips']);

  // a Done with no change sends nothing
  await fp.evaluate(async () => { LRXOverviewEdit.start(); await LRXOverviewEdit.stop(); });
  assert.equal(freePosts.length, 1, 'no change, no save');

  // leaving the Overview while editing saves and closes edit mode
  await fp.locator('#ow-edit').click();
  await removeBtn('bars').click();
  const leftSave = layoutReply(fp, 'POST');
  await fp.evaluate(() => showView('settings'));
  await leftSave;
  assert.equal(freePosts.length, 2);
  assert.deepEqual(savedIds(freePosts[1]), ['profile', 'edu', 'drug', 'battle', 'company', 'chips']);
  assert.equal(await editing(), false);
  await fp.evaluate(() => showView('overview'));
  assert.equal(await fp.locator('#ow-grid.ow-editing').count(), 0);
  assert.equal(await fp.locator('#ow-grid .ow-handle').count(), 0);
  await waitForIds(fp, ['profile', 'edu', 'drug', 'battle', 'chips']);

  // the window hidden while editing saves once and closes edit mode
  await fp.evaluate(() => LRXOverviewEdit.start());
  await handle('chips').focus();
  await fp.keyboard.press('ArrowUp');
  const hiddenSave = layoutReply(fp, 'POST');
  await fp.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState; delete document.hidden;
  });
  await hiddenSave;
  assert.equal(freePosts.length, 3);
  assert.deepEqual(savedIds(freePosts[2]), ['profile', 'edu', 'drug', 'chips', 'battle', 'company']);
  assert.equal(await editing(), false);

  // app.overviewLayout switched off while editing saves once and closes edit mode; Edit is hidden in classic mode
  await fp.evaluate(() => LRXOverviewEdit.start());
  await removeBtn('chips').click();
  const offSave = layoutReply(fp, 'POST');
  await fp.evaluate(() => setFeature('app.overviewLayout', false));
  await offSave;
  assert.equal(freePosts.length, 4);
  assert.deepEqual(savedIds(freePosts[3]), ['profile', 'edu', 'drug', 'battle', 'company']);
  assert.equal(await editing(), false);
  assert.equal(await fp.locator('#ow-edit').isVisible(), false, 'no Edit in classic mode');
  assert.equal(await fp.evaluate(() => { LRXOverviewEdit.start(); return LRXOverviewEdit.active(); }), false, 'edit mode does not start in classic mode');
  await fp.evaluate(() => setFeature('app.overviewLayout', true));
  assert.equal(await fp.locator('#ow-edit').isVisible(), true);

  // lrx-premium-reset closes edit mode without saving
  await fp.evaluate(() => LRXOverviewEdit.start());
  await removeBtn('drug').click();
  await fp.evaluate(() => window.dispatchEvent(new Event('lrx-premium-reset')));
  assert.equal(await editing(), false);
  assert.equal(await fp.locator('#ow-grid .ow-ctl').count(), 0);
  assert.equal(freePosts.length, 4, 'a Premium reset saves nothing');
  const resetReply = layoutReply(fp);
  await fp.evaluate(() => loadOverview(true));
  await resetReply;
  await fp.waitForFunction((id) => LRXOverview.owner() === id, OTHER);
  await waitForIds(fp, ['profile', 'edu', 'drug', 'battle']);

  // Reset to default asks once more, then restores the default layout
  await fp.evaluate(() => LRXOverviewEdit.start());
  await fp.locator('#ow-reset').click();
  assert.equal((await fp.locator('#ow-reset').textContent()).trim(), 'Sure?');
  assert.deepEqual(await visibleIds(fp), ['profile', 'edu', 'drug', 'battle'], 'the first click changes nothing');
  await fp.locator('#ow-reset').click();
  await waitForIds(fp, DEFAULT_IDS);
  assert.equal((await fp.locator('#ow-reset').textContent()).trim(), 'Reset to default');
  const resetSave = layoutReply(fp, 'POST');
  await fp.locator('#ow-done').click();
  await resetSave;
  assert.deepEqual(savedIds(freePosts[4]), [...DEFAULT_IDS, 'company']);

  // 640 px with the drawer open: no sideways scrolling; the drawer is below the grid
  await fp.setViewportSize({ width: 640, height: 900 });
  await fp.evaluate(() => LRXOverviewEdit.start());
  await fp.locator('#ow-add').click();
  await drawer.waitFor({ state: 'visible' });
  const narrow = await overflow(fp);
  assert.ok(narrow.scroll <= narrow.width, 'edit mode at 640: ' + JSON.stringify(narrow));
  const [gridBottom, drawerTop] = await fp.evaluate(() => [document.querySelector('#ow-grid').getBoundingClientRect().bottom, document.querySelector('#ow-drawer').getBoundingClientRect().top]);
  assert.ok(drawerTop >= gridBottom, `the drawer is below the grid (${drawerTop} ≥ ${gridBottom})`);
  await fp.evaluate(() => LRXOverviewEdit.stop());

  // edit mode in the five themes at 1440 and 640 px
  await fp.setViewportSize({ width: 1440, height: 1050 });
  await fp.locator('[data-view="settings"]').click(); await fp.locator('[data-set-tab="appearance"]').click();
  for (const theme of ['ocean', 'forest', 'amethyst', 'light', 'obsidian']) {
    await fp.locator(`[data-theme-choice="${theme}"]`).click();
    await fp.waitForFunction(() => document.querySelector('#theme-save-status').textContent.includes('saved'));
    await fp.evaluate(() => { showView('overview'); LRXOverviewEdit.start(); });
    await fp.locator('#ow-add').click();
    for (const width of [1440, 640]) {
      await fp.setViewportSize({ width, height: 1050 });
      const m = await overflow(fp);
      assert.ok(m.scroll <= m.width, theme + ' edit mode at ' + width + ': ' + JSON.stringify(m));
      await shot(fp, `overview-edit-${theme}-${width}.png`);
    }
    await fp.setViewportSize({ width: 1440, height: 1050 });
    await fp.evaluate(() => { showView('settings'); showSettingsTab('appearance'); });
  }
  assert.equal(freePosts.length, 5, 'opening and closing edit mode without a change saves nothing');

  // one column: the drop goes by the target's vertical midpoint (left half, lower half → after)
  await fp.setViewportSize({ width: 600, height: 1050 });
  await fp.evaluate(() => { showView('overview'); window.scrollTo({ top: 0, behavior: 'instant' }); LRXOverviewEdit.start(); });
  assert.equal(await editing(), true);
  assert.equal(await fp.locator('#ow-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
  const eduOne = fp.locator('#ow-grid > [data-widget="edu"]'), eduOneBox = await eduOne.boundingBox();
  await handle('drug').dragTo(eduOne, { targetPosition: { x: eduOneBox.width * 0.2, y: eduOneBox.height * 0.8 } });
  await waitForIds(fp, ['profile', 'edu', 'drug', 'day', 'bars', 'chips', 'battle']);
  const oneSave = layoutReply(fp, 'POST');
  await fp.locator('#ow-done').click();
  await oneSave;
  assert.deepEqual(savedIds(freePosts[5]), ['profile', 'edu', 'drug', 'day', 'bars', 'chips', 'battle', 'company']);
  assert.deepEqual(free.errors, []);

  console.log(JSON.stringify({ ok: true, assertions: ['default layout with the tall profile first', 'company hidden by company mode, never by the grid', 'profile name as text and Torn profile link', 'fixed IDs stay in the DOM', 'saved layout after reload', 'corrupt cached copy and failed request fall back quietly', 'a failed request is asked again; an unconfirmed save toasts and sends nothing', 'a default-screen change confirmed late never replaces the saved layouts', 'free cards before the layout reply', 'another player sees the default layout; a save toasts and sends nothing', 'commit saves once and caches; 409 reloads; errors toast', 'empty layout hint', 'classic switch', 'widths 1440/1100/760/640/600', 'five themes', 'TR/EN', 'Premium tiles show their lock state and hide in classic', 'edit mode shows a handle and × for each shown widget', '× removes chips and #mini-row stays in the DOM', 'keyboard: ArrowLeft twice on battle moves it two places; Delete on day removes it', 'drag drug onto edu moves drug after edu', 'add list: chips comes back last; Premium items are disabled with a lock', 'no Edit before an overview player is known', 'Done saves: after a reload the order is the same', 'a Done with no change sends nothing', 'leaving the Overview while editing saves and closes edit mode', 'hiding the window or switching the layout off saves and closes edit mode', 'lrx-premium-reset closes edit mode without saving', 'two-step Reset to default', '640 px with the drawer open: no sideways scrolling; the drawer is below the grid', 'edit mode in five themes at 1440 and 640', 'one column: drop by the vertical midpoint', 'no page errors or CSP reports'], screenshots: output }));
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  for (const child of children) { child.kill(); await new Promise((r) => child.exitCode !== null ? r() : child.once('exit', r)); }
  await new Promise((r) => server.close(r)); await service.close();
  const resolved = path.resolve(temp);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('lrx-overview-ui-')) throw Error('Unsafe fixture cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});
