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
const MEMBER = 4037017, OTHER = 3000001, LAPSE = 3000002; // 4037017 is a permanent member and cannot lapse
const DEFAULT_IDS = ['profile', 'drug', 'edu', 'day', 'bars', 'chips', 'battle']; // company is in the layout but hidden: not a director
const PHOTO = 'https://profileimages.torn.com/ok.png';
const NOW = Math.floor(Date.now() / 1000), MARK = '<b>x</b>'; // Torn text with markup: shown as text, never parsed
// Every endpoint a Premium widget reads, answered with synthetic data. A function answers the route itself.
const widgetData = {
  '/api/stats': { battle: null, history: [
    { date: '2026-11-06', str: 1200000, def: 970000, spd: 1080000, dex: 866000, total: 4116000 },
    { date: '2026-11-12', str: 1240000, def: 975000, spd: 1088000, dex: 868000, total: 4171000 },
    { date: '2026-11-13', str: 1250000, def: 980000, spd: 1100000, dex: 870000, total: 4200000 }] },
  '/api/networth': { current: { total: 2500000000, bank: 1000000000, wallet: MARK }, timestamp: NOW,
    history: [{ date: '2026-11-06', total: 2400000000 }, { date: '2026-11-12', total: 2450000000 }, { date: '2026-11-13', total: 2500000000 }] },
  '/api/travel': { method: null, fetchedAt: NOW * 1000, serverNow: NOW, sources: { yata: true }, countries: [
    { code: 'mex', name: MARK, minutes: 26, update: NOW, source: 'YATA', items: [{ id: 1, name: MARK, type: 'Flower', cost: 100, market: 500, qty: 1000, profit: 400 }] },
    { code: 'uni', name: 'United Kingdom', minutes: 159, update: NOW, source: 'YATA', items: [{ id: 2, name: 'Plushie', type: 'Plushie', cost: 200, market: 1500, qty: 100, profit: 1300 }] }] },
  '/api/job': { workstats: { man: 5000, int: 3000, end: 4000 }, job: { company_id: 0, job: 'None' },
    jobpoints: { jobs: { army: 12 }, companies: { 1: { name: MARK, jobpoints: 30 } } },
    types: { 1: { name: 'Hair Salon', positions: { Trainee: { man_required: 100, int_required: 100, end_required: 100, man_gain: 5, int_gain: 5, end_gain: 5 }, Director: { man_required: 1e6, int_required: 1e6, end_required: 1e6 } } } } },
  '/api/shoplifting': { stores: [{ key: 'sally', name: "Sally's Sweet Shop", allDown: true, security: [] }, { key: 'bits', name: 'Bits n Bobs', allDown: false, security: [] }] },
  '/api/crime-value': { fetchedAt: Date.now(), burglary: [], crimes: [{ crime: 'Burglary', best: 'Warehouse', value: 3600, options: [] }, { crime: 'Shoplifting', best: "Sally's Sweet Shop", value: 900, options: [] }] },
  '/api/jail': { source: 'stats', total: { success: 120, fails: 10 }, last24: 3, last72: 9, score: 512, decay: [], lastBust: Date.now() - 3600000 },
  '/api/awards': { totals: { honors: [1, 10], medals: [1, 10], awards: 2 }, awards: [
    { name: 'Bar Breaker', kind: 'honor', type: 'Crimes', description: '', owned: false, pct: 0.92, cur: 920, goal: 1000, circulation: 100 },
    { name: 'Owned', kind: 'medal', type: 'Level', description: '', owned: true, pct: 1, cur: 1, goal: 1, circulation: 9 },
    { name: 'Halfway', kind: 'medal', type: 'Level', description: '', owned: false, pct: 0.5, cur: 50, goal: 100, circulation: 50 }] },
  '/api/faction': { at: Date.now(), access: { inFaction: true, allowed: true, role: 'leader' }, oc: { crimes: [], notInOc: [], totals: { members: 2, inOc: 2 } },
    myOc: { inOc: true, crime: { id: 77, name: 'Mob Mentality', difficulty: 3, status: 'Planning', readyAt: NOW + 7200, filled: 3, total: 4 }, slot: { role: 'Looter', cpr: 70, item: { name: 'Crowbar', ok: true } } } },
  '/api/wars': { faction: { id: 5, name: 'Example' }, wars: [{ type: 'Ranked War', id: '1', factionId: 99, name: MARK, score: 1200, myScore: 1500 }] },
  '/api/events': { seasonal: [], at: Date.now(), events: [{ title: 'Easter Egg Hunt', description: '', start: NOW + 3 * 86400 + 7200, end: NOW + 10 * 86400, exact: true, fixed: true }] },
};
const WIDGET_PATHS = Object.keys(widgetData);
const forbidden = []; // requests the widgets must never make, from every page in this run
let overviewPlayer = null;
const overviewFixture = () => ({
  player: overviewPlayer, serverTime: Math.floor(Date.now() / 1000),
  battle: buildBattleStats({ strength: 1250000, defense: 980000, speed: 1100000, dexterity: 870000 }),
  bars: { energy: { current: 120, maximum: 150, fulltime: 900 }, nerve: { current: 35, maximum: 60, fulltime: 3600 }, happy: { current: 3500, maximum: 5000, fulltime: 7200 }, life: { current: 2400, maximum: 3000, fulltime: 1200 }, chain: { current: 0 } },
  cooldowns: { drug: 3600, booster: 0, medical: 1800 },
  drug: { cooldown: 3600, xanaxActive: true, xanToday: 1, xantaken: 812, refills: 40 },
  // Torn courses run for days: the education countdown reads "12d 05:12:57".
  education: { timeLeft: 12 * 86400 + 5 * 3600 + 777, currentId: 12, current: 'Bachelor of Biology', code: 'BIO', duration: 30 * 86400, completed: 20, totalCourses: 100 },
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
  // The page's own fetch() calls, logged the moment they are made, so a count is exact even while its clock is paused.
  await context.addInitScript(() => {
    const original = window.fetch;
    window.qaFetches = [];
    window.fetch = function (input, init) {
      try { window.qaFetches.push([String(init?.method || 'GET').toUpperCase(), new URL(String(input?.url || input), location.href).pathname]); } catch {}
      return original.apply(this, arguments);
    };
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss().catch(() => {}); });
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p === '/api/targets' || p === '/api/faction/report' || p === '/api/stock-order') forbidden.push(`${tornId} ${r.method()} ${p}`);
  });
  await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.route(PHOTO, (route) => route.fulfill({ path: path.join(__dirname, '..', 'public', 'logo.png') }));
  await page.route((url) => url.pathname === '/api/overview', (route) => route.fulfill({ json: overviewFixture() }));
  await page.route((url) => WIDGET_PATHS.includes(url.pathname), (route) => {
    const answer = widgetData[new URL(route.request().url()).pathname];
    return typeof answer === 'function' ? answer(route) : route.fulfill({ json: answer });
  });
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
// Polls from Node: page.waitForFunction would wait on the page's own timers, which a paused page clock stops.
async function until(page, fn, arg, what, timeout = 10000) {
  for (const end = Date.now() + timeout; !(await page.evaluate(fn, arg));) {
    if (Date.now() > end) throw Error('Timed out waiting for ' + what);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const fetches = (page, paths) => page.evaluate((list) => window.qaFetches.filter(([method, p]) => method === 'GET' && list.includes(p)).length, [].concat(paths));
// Waits briefly for the expected count, then checks it exactly (a count above it fails at once).
async function expectFetches(page, paths, want, what) {
  for (const end = Date.now() + 3000; (await fetches(page, paths)) < want && Date.now() < end;) await new Promise((r) => setTimeout(r, 25));
  assert.equal(await fetches(page, paths), want, what);
}
// A new membership answer. status(true) hands back a request already in flight, which may predate the change the
// test just made on the service (the Premium page asks too), so that one settles first. A refused answer is not thrown.
const freshStatus = (page) => page.evaluate(async () => { await PremiumAccess.status().catch(() => {}); return PremiumAccess.status(true).then(() => true, () => false); });
const shownOf = (page) => page.evaluate(() => LRXOverview.shown().widgets.map((w) => `${w.id}:${w.size}:${w.locked}`));
// Language clicks and the Settings view reload the app config without awaiting it (app.js). A reply that lands after a
// later setFeature() puts the old switch value back, so a switch is set only once every such reload has been applied.
const trackConfigLoads = (page) => page.evaluate(() => {
  if (window.qaConfigLoads) return;
  const load = window.loadConfig;
  window.qaConfigLoads = { pending: 0 };
  window.loadConfig = (...args) => { window.qaConfigLoads.pending++; return load(...args).finally(() => { window.qaConfigLoads.pending--; }); };
});
const configLoaded = (page) => until(page, () => window.qaConfigLoads.pending === 0, null, 'the app config reloads');
async function setSwitch(page, key, value) {
  await trackConfigLoads(page); await configLoaded(page);
  await page.evaluate(([k, v]) => setFeature(k, v), [key, value]);
}
const oneLayout = (...widgets) => ({ v: 1, active: 0, layouts: [{ name: '', widgets: widgets.map(([id, size]) => ({ id, size })) }] });
const showSet = (page, set) => page.evaluate((s) => LRXOverview.commit(s, { save: false }), set);
const tileOf = (page, id) => page.locator(`#ow-grid > article.glass.card.ow-w.ow-premium[data-widget="${id}"]`);
const tileText = async (page, id) => (await tileOf(page, id).textContent()).replace(/\s+/g, ' ').trim();
const tileReady = (page, id) => until(page, (w) => !!document.querySelector(`#ow-grid > [data-widget="${w}"] .ow-t-main`), id, `the ${id} tile's data`);
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

  // widths; at 4 columns the multi-day education countdown stays on one line beside its ring
  for (const [width, columns] of [[1440, 4], [1366, 4], [1280, 4], [1100, 2], [760, 2], [640, 2], [600, 1]]) {
    await page.setViewportSize({ width, height: 900 });
    const m = await overflow(page);
    assert.ok(m.scroll <= m.width, 'no sideways scroll at ' + width + ': ' + JSON.stringify(m));
    assert.equal(await page.locator('#ow-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length), columns, 'columns at ' + width);
    if (columns === 4) {
      const edu = await page.evaluate(() => {
        const v = document.querySelector('[data-timer="edu"]'), text = document.createRange();
        text.selectNodeContents(v);
        return { text: v.textContent, lines: text.getClientRects().length, clipped: v.scrollWidth > v.clientWidth, size: getComputedStyle(v).fontSize };
      });
      assert.match(edu.text, /^\d+d \d\d:\d\d:\d\d$/, 'the education countdown has a day part at ' + width);
      assert.equal(edu.lines, 1, 'the education countdown is one line at ' + width + ': ' + JSON.stringify(edu));
      assert.equal(edu.clipped, false, 'the education countdown is not cut off at ' + width + ': ' + JSON.stringify(edu));
    }
    await shot(page, 'overview-' + width + '.png');
  }

  // themes
  await page.setViewportSize({ width: 1440, height: 1050 });
  await trackConfigLoads(page);
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

  // TR / EN (each language click reloads the app config in the background: wait until it is applied)
  await page.evaluate(() => showView('overview'));
  await page.locator('[data-lang="tr"]').click();
  await configLoaded(page);
  assert.equal((await page.locator('#ow-grid > [data-widget="chips"] h3').textContent()).trim(), 'Durum');
  await page.evaluate(() => LRXOverview.commit({ v: 1, active: 0, layouts: [{ name: '', widgets: [] }] }, { save: false }));
  assert.equal((await page.locator('#ow-grid .ow-empty').textContent()).trim(), "Bu düzende widget yok. Eklemek için Düzenle'ye bas.");
  await page.locator('[data-lang="en"]').click();
  await configLoaded(page);
  assert.equal((await page.locator('#ow-grid .ow-empty').textContent()).trim(), 'This layout has no widgets. Press Edit to add some.', 'a language change redraws the grid');
  assert.equal((await page.locator('#ow-grid > [data-widget="chips"] h3').textContent()).trim(), 'Status');

  // Premium widgets. 4037017 is a permanent member: the service grants the module.
  // member: networth and travel tiles render escaped data
  await showSet(page, oneLayout(['networth', 'S'], ['travel', 'M']));
  await tileReady(page, 'networth');
  await tileReady(page, 'travel');
  assert.equal(await page.evaluate(() => LRXOverview.access()), 'active');
  const networthS = await tileText(page, 'networth');
  for (const part of ['Networth', '$2.50B', '+$50.0M']) assert.ok(networthS.includes(part), 'networth S: ' + networthS);
  const travelM = await tileText(page, 'travel');
  for (const part of ['Travel profit', `${MARK} · ${MARK}`, '$6.92K/h', 'United Kingdom']) assert.ok(travelM.includes(part), 'travel M: ' + travelM);
  assert.equal(await page.locator('#ow-grid > .ow-premium b').count(), 0, 'Torn data never becomes markup');
  assert.equal(await tileOf(page, 'travel').getAttribute('data-size'), 'M');
  await shot(page, 'overview-member-1440.png');
  await tileOf(page, 'networth').locator('.ow-t').click();
  assert.equal(await page.evaluate(() => state.view), 'networth', 'a click on the tile opens its page');
  await page.evaluate(() => showView('overview'));

  // member: S/M/L chips resize and a second layout is saved and switched
  posts.length = 0;
  await page.locator('#ow-edit').click();
  // in edit mode a click, Enter or a drag attempt on an unlocked tile's body opens nothing; only the controls act
  const stillEditing = async (what) => assert.deepEqual(await page.evaluate(() => [state.view, LRXOverviewEdit.active()]), ['overview', true], what);
  const networthBody = tileOf(page, 'networth').locator('.ow-t');
  assert.equal(await tileOf(page, 'networth').getAttribute('data-ow-view'), 'networth', 'the tile is unlocked and opens its page outside edit mode');
  await networthBody.click();
  await stillEditing('edit mode: a click on a tile body opens nothing');
  await networthBody.press('Enter');
  await stillEditing('edit mode: Enter on a tile body opens nothing');
  const nb = await networthBody.boundingBox();
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2); await page.mouse.down();
  await page.mouse.move(nb.x + nb.width / 2 + 10, nb.y + nb.height / 2 + 20, { steps: 8 }); await page.mouse.up();
  await stillEditing('edit mode: a drag that did not start on the handle is no click on the tile');
  const sizeBtn = (id, size) => page.locator(`#ow-grid > [data-widget="${id}"] .ow-sizes [data-ow-size="${size}"]`);
  assert.deepEqual(await page.locator('#ow-grid > [data-widget="networth"] .ow-sizes button').allTextContents(), ['S', 'M']);
  assert.deepEqual(await page.locator('#ow-grid > [data-widget="travel"] .ow-sizes button').allTextContents(), ['S', 'M', 'L']);
  await sizeBtn('travel', 'L').click();
  assert.equal(await tileOf(page, 'travel').getAttribute('data-size'), 'L');
  assert.equal(await sizeBtn('travel', 'L').getAttribute('aria-pressed'), 'true');
  assert.equal(await tileOf(page, 'travel').evaluate((el) => getComputedStyle(el).gridColumnStart), 'span 3');
  await sizeBtn('networth', 'M').click();
  assert.equal(await tileOf(page, 'networth').getAttribute('data-size'), 'M');
  assert.ok((await tileText(page, 'networth')).includes('Last 7 days'), 'M adds the next lines');
  await page.locator('#ow-duplicate').click();
  await page.locator('#ow-name').fill('War');
  await page.locator('#ow-name').press('Tab');
  await sizeBtn('travel', 'S').click();
  const twoSaved = layoutReply(page, 'POST');
  await page.locator('#ow-done').click();
  assert.equal((await twoSaved).status(), 200);
  assert.equal(posts.length, 1, 'Done saves once');
  assert.equal(posts[0].layouts.active, 1, 'the copy is the active layout');
  assert.deepEqual(posts[0].layouts.layouts.map((l) => l.name), ['', 'War']);
  assert.deepEqual(posts[0].layouts.layouts.map((l) => l.widgets), [[{ id: 'networth', size: 'M' }, { id: 'travel', size: 'L' }], [{ id: 'networth', size: 'M' }, { id: 'travel', size: 'S' }]]);
  const layoutSelect = page.locator('#ow-layout');
  assert.deepEqual(await layoutSelect.locator('option').allTextContents(), ['Main', 'War']);
  const switched = layoutReply(page, 'POST');
  await layoutSelect.selectOption('0');
  assert.equal((await switched).status(), 200);
  assert.equal(posts[1].layouts.active, 0, 'choosing a layout saves it as the active one');
  assert.equal(await tileOf(page, 'travel').getAttribute('data-size'), 'L');
  await page.evaluate(() => localStorage.removeItem('tt.cache.overviewLayouts.4037017')); // the choice must come from the saved config
  await page.reload(); await open(page);
  await page.waitForFunction((id) => LRXOverview.owner() === id && LRXOverview.access() === 'active', MEMBER);
  await waitForIds(page, ['networth', 'travel']);
  assert.deepEqual(await page.evaluate(() => LRXOverview.shown().widgets.map((w) => w.id + ':' + w.size)), ['networth:M', 'travel:L']);

  // member: a layout name with markup is shown as text
  await page.locator('#ow-edit').click();
  await page.locator('#ow-name').fill('<img src=x onerror=alert(1)>');
  await page.locator('#ow-name').press('Tab');
  const nameSaved = layoutReply(page, 'POST');
  await page.locator('#ow-done').click();
  await nameSaved;
  const hostileName = '<img src=x onerror=alert'; // cleaned and cut to 24 characters
  assert.equal(posts[posts.length - 1].layouts.layouts[0].name, hostileName);
  assert.equal(await layoutSelect.locator('option').first().textContent(), hostileName);
  assert.equal(await page.locator('#ow-name').inputValue(), hostileName);
  assert.equal(await page.locator('#ow-bar img, #ow-grid > .ow-premium img').count(), 0, 'the name never becomes an element');

  // every Premium widget renders from its page's endpoint; Daily order hint needs company mode
  await page.evaluate(() => {
    state.targets = { faction: { id: 99, name: 'Rival' }, me: { totals: { noXanax: 1000, withXanax: 650 } }, members: [
      { id: 11, name: 'Alpha', level: 30, bs: 600, status: { state: 'Okay' } }, { id: 12, name: 'Beta', level: 20, bs: 200, status: { state: 'Hospital' } },
      { id: 13, name: 'Gamma', level: 50, bs: 5000, status: { state: 'Okay' } }] };
  });
  const ALL = [['gym', 'L'], ['networth', 'M'], ['travel', 'L'], ['job', 'M'], ['crimes', 'L'], ['jail', 'M'], ['awards', 'M'], ['oc', 'M'], ['war', 'L'], ['events', 'M'], ['orders', 'L']];
  await showSet(page, oneLayout(...ALL));
  for (const [id] of ALL) if (id !== 'orders') await tileReady(page, id);
  const expected = {
    gym: ['Speed +12,000 · Strength +10,000', 'Last 7 days'], job: ['42', '1 position fits'], crimes: ['1 shop without security', 'Burglary', "Sally's Sweet Shop"],
    jail: ['3 / 9', '512'], awards: ['Bar Breaker', '92%', 'Halfway'], oc: ['3/4', 'Mob Mentality', 'Looter'],
    war: ['1,500 – 1,200', '2 suitable targets', MARK, 'Alpha'], events: ['Easter Egg Hunt', 'starts in 3d'], orders: ['Company mode only'],
  };
  for (const [id, parts] of Object.entries(expected)) {
    const text = await tileText(page, id);
    for (const part of parts) assert.ok(text.includes(part), `${id}: "${part}" in "${text}"`);
  }
  assert.match(await tileText(page, 'oc'), /ready in (2h 0m|1h 5\dm)/, 'the OC countdown (the fixture is two hours ahead of the run start)');
  assert.equal(await page.locator('#ow-grid > .ow-premium :is(b,img,i)').count(), 0, 'Torn data never becomes markup');
  await page.evaluate(() => {
    state.companyMode = true;
    state.company = { company: { name: 'Fixture Co' }, totals: { need: 50, orderCost: 25000 }, products: [
      { name: '<b>x</b>', daysLeftWithOrder: 0.6, sold_amount: 40, need: 50, orderCost: 25000 }, { name: 'Candle', daysLeftWithOrder: 4.2, sold_amount: 12, need: 0, orderCost: 0 }] };
    LRXOverview.apply();
  });
  const orders = await tileText(page, 'orders');
  for (const part of [`${MARK} · 0.6d`, `Order today: ${MARK} ×50`, 'Candle', '$25,000']) assert.ok(orders.includes(part), `orders: "${part}" in "${orders}"`);
  await shot(page, 'overview-widgets-1440.png');
  await page.setViewportSize({ width: 600, height: 1050 });
  const narrowAll = await overflow(page);
  assert.ok(narrowAll.scroll <= narrowAll.width, 'every widget at 600: ' + JSON.stringify(narrowAll));
  await shot(page, 'overview-widgets-600.png');
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.evaluate(() => { state.companyMode = false; state.company = null; LRXOverview.apply(); });

  // off: with app.premiumPromos off the Premium group leaves the add list and the tiles read "Not available"
  await showSet(page, oneLayout(['drug', 'S'], ['gym', 'M'], ['networth', 'S']));
  await setSwitch(page, 'app.premiumPromos', false);
  assert.equal(await page.evaluate(() => LRXOverview.access()), 'off');
  for (const id of ['gym', 'networth']) {
    const text = await tileText(page, id);
    assert.ok(text.includes('Not available') && !text.includes('Premium'), id + ': ' + text);
    assert.equal(await tileOf(page, id).locator('a, button').count(), 0, 'no sales text and no link');
  }
  await page.locator('#ow-edit').click(); await page.locator('#ow-add').click();
  assert.equal((await page.locator('#ow-drawer').textContent()).includes('Premium'), false, 'no Premium group');
  assert.equal(await page.locator('#ow-drawer [data-add="travel"]').count(), 0);
  await page.evaluate(() => LRXOverviewEdit.stop());
  await setSwitch(page, 'app.premiumPromos', true);
  await page.waitForFunction(() => LRXOverview.access() === 'active');
  await setSwitch(page, 'app.overviewLayout', false);
  assert.equal(await tileOf(page, 'gym').isVisible(), false, 'classic: Premium tiles are hidden');
  await setSwitch(page, 'app.overviewLayout', true);

  // Premium page Open goes to the Overview edit mode
  await page.evaluate(() => showView('premium'));
  const openModule = page.locator('#view-premium [data-feature-slot="overview_widgets"] [data-advanced-open="overview_widgets"]');
  await openModule.waitFor();
  assert.ok((await page.locator('#view-premium [data-feature-slot="overview_widgets"]').textContent()).includes('Overview widgets'));
  assert.equal((await openModule.textContent()).replace(/\s+/g, ' ').trim(), 'Open ↗');
  await openModule.click();
  assert.equal(await page.evaluate(() => state.view), 'overview');
  assert.equal(await page.evaluate(() => LRXOverviewEdit.active()), true, 'edit mode is on');
  assert.equal(await page.evaluate(() => !!window.LRXAdvanced), false, 'no workbench is loaded for this module');
  await page.evaluate(() => LRXOverviewEdit.stop());

  // fetch policy: the page clock is under test control from here on
  const networthFixture = widgetData['/api/networth'];
  await page.clock.install();
  await page.reload(); await open(page);
  await page.waitForFunction((id) => LRXOverview.owner() === id && LRXOverview.access() === 'active', MEMBER);
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
  const networthGets = () => fetches(page, '/api/networth');
  await page.evaluate(() => showView('premium'));
  await showSet(page, oneLayout(['drug', 'S'], ['networth', 'S']));
  const policyStart = await networthGets();
  await page.clock.runFor(130000);
  assert.equal(await networthGets(), policyStart, 'no request while another view is shown');
  await freshStatus(page); // a grant lasts 60 s; the app renews it every 30 s
  await page.evaluate(() => showView('overview'));
  await expectFetches(page, '/api/networth', policyStart + 1, 'showing the Overview loads the tile once');
  await page.clock.runFor(30000);
  await freshStatus(page);
  await page.clock.runFor(29000);
  assert.equal(await networthGets(), policyStart + 1, 'within 59 s there is one request');
  widgetData['/api/networth'] = (route) => route.fulfill({ status: 500, json: { error: '<i>networth down</i>' } });
  await page.clock.runFor(2000);
  await expectFetches(page, '/api/networth', policyStart + 2, 'after 61 s there are two');
  await until(page, () => document.querySelector('#ow-grid > [data-widget="networth"] .ow-t-err')?.textContent.includes('<i>networth down</i>'), null, 'the error line');
  assert.equal(await tileOf(page, 'networth').locator('i').count(), 0, 'the error is shown as text');
  assert.ok((await tileText(page, 'networth')).includes('$2.50B'), 'the last data stays in the frame');
  widgetData['/api/networth'] = networthFixture;
  await page.clock.runFor(30000);
  assert.equal(await networthGets(), policyStart + 2, 'a failed attempt counts: no retry within 60 s');

  // page off: setFeature('page.networth', false) shows the Settings note and no request follows
  await freshStatus(page);
  await setSwitch(page, 'page.networth', false);
  assert.ok((await tileText(page, 'networth')).includes('Turned off in Settings'));
  const offStart = await networthGets();
  await page.clock.runFor(130000);
  assert.equal(await networthGets(), offStart, 'a page switched off loads nothing');
  await freshStatus(page);
  await setSwitch(page, 'page.networth', true);
  await expectFetches(page, '/api/networth', offStart + 1, 'switched on again, the due tile loads at once');

  // unknown: /api/premium/status fails, Premium tiles show the checking placeholder and no widget request is made
  const QUIET = ['/api/networth', '/api/stats', '/api/jail', '/api/awards']; // no page loads these in the background
  await page.route('**/api/premium/status', (route) => route.fulfill({ status: 503, json: { code: 'PREMIUM_SERVICE_UNREACHABLE', error: 'Unavailable' } }));
  await freshStatus(page);
  assert.equal(await page.evaluate(() => LRXOverview.access()), 'unknown');
  const unknownStart = await fetches(page, QUIET);
  await showSet(page, oneLayout(['networth', 'S'], ['gym', 'M'], ['jail', 'S'], ['awards', 'S']));
  for (const id of ['networth', 'gym', 'jail', 'awards']) assert.ok((await tileText(page, id)).includes('Checking membership…'), id);
  await page.clock.runFor(130000);
  assert.equal(await fetches(page, QUIET), unknownStart, 'no widget request while membership is unknown');
  await page.unroute('**/api/premium/status');
  await freshStatus(page);
  assert.equal(await page.evaluate(() => LRXOverview.access()), 'active');
  await expectFetches(page, QUIET, unknownStart + 4, 'access back: each due tile loads once');
  await page.clock.resume();

  assert.deepEqual(forbidden, [], 'never: POST /api/stock-order, /api/faction/report, /api/targets');
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

  // the profile card opens the player's Torn profile in a tab (openInTab is recorded here, not run)
  await fp.evaluate(() => { window.qaOpened = []; window.qaOpenInTab = window.openInTab; window.openInTab = (url) => { window.qaOpened.push(url); }; });
  const profileCard = fp.locator('#ow-grid > [data-widget="profile"] .pm-profile');
  await profileCard.click();
  assert.deepEqual(await fp.evaluate(() => window.qaOpened), ['https://www.torn.com/profiles.php?XID=3000001'], 'outside edit mode the profile card opens the Torn profile');

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

  // edit mode: a click on the profile card, or a press on it that did not start on the handle, opens no Torn tab
  await fp.evaluate(() => { window.qaOpened = []; });
  await profileCard.click();
  assert.deepEqual(await fp.evaluate(() => window.qaOpened), [], 'edit mode: a click on the profile card opens no tab');
  const pb = await profileCard.boundingBox();
  await fp.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2); await fp.mouse.down();
  await fp.mouse.move(pb.x + pb.width / 2 + 10, pb.y + pb.height / 2 + 40, { steps: 8 }); await fp.mouse.up();
  assert.deepEqual(await fp.evaluate(() => window.qaOpened), [], 'edit mode: a drag that did not start on the handle is no click on the profile card');
  assert.deepEqual(await fp.evaluate(() => [state.view, LRXOverviewEdit.active()]), ['overview', true], 'edit mode stays on');
  await fp.evaluate(() => { window.openInTab = window.qaOpenInTab; });

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

  // lapsed: 3000002 becomes a member, saves a second layout with sizes, lapses and renews.
  // The test-payment action accepts only synthetic payer IDs (9000000000 and up), so the days are granted directly.
  const ADMIN = { tornId: MEMBER, admin: true };
  overviewPlayer = { ...overviewPlayer, id: LAPSE, name: 'Lapsing player' };
  const lapse = await desktop(LAPSE), lp = lapse.page, lapsePosts = [];
  lp.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/overview-layouts') lapsePosts.push(r.postDataJSON()); });
  await open(lp);
  await lp.waitForFunction((id) => LRXOverview.owner() === id && PremiumAccess.snapshot()?.account?.tornId === id && LRXOverview.access() === 'lapsed', LAPSE);
  await service.adminAction(ADMIN, 'subscription', { torn_id: LAPSE, days: 30, reason: 'QA membership' });
  await freshStatus(lp);
  assert.equal(await lp.evaluate(() => LRXOverview.access()), 'active', 'a member now');
  const sized = { v: 1, active: 1, layouts: [
    { name: '', widgets: [{ id: 'drug', size: 'S' }, { id: 'networth', size: 'M' }, { id: 'travel', size: 'L' }] },
    { name: 'War', widgets: [{ id: 'travel', size: 'S' }, { id: 'gym', size: 'L' }] }] };
  const sizedSave = layoutReply(lp, 'POST');
  await lp.evaluate((s) => LRXOverview.commit(s), sized);
  assert.equal((await sizedSave).status(), 200);
  assert.equal(lapsePosts.length, 1);
  assert.equal(lapsePosts[0].layouts.active, 1);
  assert.deepEqual(lapsePosts[0].layouts.layouts.map((l) => l.widgets), sized.layouts.map((l) => l.widgets));
  assert.deepEqual(await shownOf(lp), ['travel:S:null', 'gym:L:null']);
  await tileReady(lp, 'gym');

  await service.adminAction(ADMIN, 'subscription', { torn_id: LAPSE, days: -1000, reason: 'QA lapse' });
  await freshStatus(lp);
  assert.equal(await lp.evaluate(() => LRXOverview.access()), 'lapsed');
  assert.deepEqual(await shownOf(lp), ['drug:S:null', 'networth:S:premium', 'travel:M:premium'], 'a lapse shows layout 1 at default sizes with locked tiles');
  for (const id of ['networth', 'travel']) {
    assert.ok((await tileText(lp, id)).includes('Unlocks with Premium'), id);
    assert.equal(await tileOf(lp, id).locator('button[data-goto-view="premium"]').count(), 1, id + ': a link to the Premium page');
  }
  const kept = await lp.evaluate(() => fetch('/api/overview-layouts').then((r) => r.json()));
  assert.equal(kept.layouts.active, 1, 'the saved config still holds layout 2 as active');
  assert.deepEqual(kept.layouts.layouts.map((l) => l.widgets), sized.layouts.map((l) => l.widgets), 'and every saved size');
  assert.equal(lapsePosts.length, 1, 'a lapse saves nothing');
  await shot(lp, 'overview-lapsed-1440.png');
  await lp.setViewportSize({ width: 600, height: 1050 });
  const narrowLapsed = await overflow(lp);
  assert.ok(narrowLapsed.scroll <= narrowLapsed.width, 'lapsed at 600: ' + JSON.stringify(narrowLapsed));
  await shot(lp, 'overview-lapsed-600.png');
  await lp.setViewportSize({ width: 1440, height: 1050 });
  await tileOf(lp, 'networth').locator('button[data-goto-view="premium"]').click();
  assert.equal(await lp.evaluate(() => state.view), 'premium', 'the locked tile leads to the Premium page');
  await lp.evaluate(() => showView('overview'));

  await service.adminAction(ADMIN, 'subscription', { torn_id: LAPSE, days: 30, reason: 'QA renewal' });
  await freshStatus(lp);
  assert.equal(await lp.evaluate(() => LRXOverview.access()), 'active');
  assert.deepEqual(await shownOf(lp), ['travel:S:null', 'gym:L:null'], 'renewed: the chosen layout and its sizes return');
  await tileReady(lp, 'travel');
  assert.equal(lapsePosts.length, 1, 'a renewal saves nothing');
  assert.deepEqual(lapse.errors, []);
  assert.deepEqual(forbidden, [], 'never: POST /api/stock-order, /api/faction/report, /api/targets');

  console.log(JSON.stringify({ ok: true, assertions: ['default layout with the tall profile first', 'company hidden by company mode, never by the grid', 'profile name as text and Torn profile link', 'fixed IDs stay in the DOM', 'saved layout after reload', 'corrupt cached copy and failed request fall back quietly', 'a failed request is asked again; an unconfirmed save toasts and sends nothing', 'a default-screen change confirmed late never replaces the saved layouts', 'free cards before the layout reply', 'another player sees the default layout; a save toasts and sends nothing', 'commit saves once and caches; 409 reloads; errors toast', 'empty layout hint', 'classic switch', 'widths 1440/1366/1280/1100/760/640/600', 'a multi-day education countdown is one line at 1280/1366/1440', 'five themes', 'TR/EN', 'member: networth and travel tiles render escaped data', 'a tile click opens its page', 'edit mode: a click, Enter or a drag attempt on a tile body opens nothing', 'member: S/M/L chips resize and a second layout is saved and switched', 'member: a layout name with markup is shown as text', 'every Premium widget renders; orders without company mode shows the note', 'off: no Premium group, tiles read Not available; Premium tiles hide in classic', 'Premium page Open goes to the Overview edit mode', 'fetch policy: none on another view, 1 within 59 s, 2 after 61 s; a failed attempt counts', 'page off: the Settings note and no request', 'unknown: the checking placeholder and no widget request', 'never requested: POST /api/stock-order, /api/faction/report, /api/targets', 'lapsed: default sizes and locked tiles, saved layout kept; renewal restores it','the profile card opens the Torn profile; in edit mode a click or a drag attempt on it opens no tab', 'edit mode shows a handle and × for each shown widget', '× removes chips and #mini-row stays in the DOM', 'keyboard: ArrowLeft twice on battle moves it two places; Delete on day removes it', 'drag drug onto edu moves drug after edu', 'add list: chips comes back last; Premium items are disabled with a lock', 'no Edit before an overview player is known', 'Done saves: after a reload the order is the same', 'a Done with no change sends nothing', 'leaving the Overview while editing saves and closes edit mode', 'hiding the window or switching the layout off saves and closes edit mode', 'lrx-premium-reset closes edit mode without saving', 'two-step Reset to default', '640 px with the drawer open: no sideways scrolling; the drawer is below the grid', 'edit mode in five themes at 1440 and 640', 'one column: drop by the vertical midpoint', 'no page errors or CSP reports'], screenshots: output }));
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  for (const child of children) { child.kill(); await new Promise((r) => child.exitCode !== null ? r() : child.once('exit', r)); }
  await new Promise((r) => server.close(r)); await service.close();
  const resolved = path.resolve(temp);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('lrx-overview-ui-')) throw Error('Unsafe fixture cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});
