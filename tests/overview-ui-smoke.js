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
const DEFAULT_IDS = ['profile', 'timers', 'bars', 'chips', 'battle']; // company is in the layout but hidden: not a director
const PHOTO = 'https://profileimages.torn.com/ok.png';
const PORTRAIT = 'https://profileimages.torn.com/portrait.png'; // a portrait photo, served as an SVG in the profile size check
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
    { name: 'Bar Breaker', kind: 'honor', type: 'Crimes', description: 'Commit 1,000 Theft offenses', owned: false, pct: 0.92, cur: 920, goal: 1000, circulation: 100, stat: 'crimes.offenses.theft', what: 'Theft' },
    { name: 'Owned', kind: 'medal', type: 'Level', description: '', owned: true, pct: 1, cur: 1, goal: 1, circulation: 9 },
    // A long grind with a higher % than Bar Breaker: the tile shows easy wins, so it must not lead
    { name: 'Halfway', kind: 'medal', type: 'Level', description: 'Reach level 100', owned: false, pct: 0.95, cur: 95, goal: 100, circulation: 50, stat: 'level' },
    { name: 'Protege', kind: 'honor', type: 'missions', description: 'Complete the mission Introduction: Duke', owned: false, pct: null, cur: null, goal: null, circulation: 275340 }] },
  '/api/faction': { at: Date.now(), access: { inFaction: true, allowed: true, role: 'leader' }, oc: { crimes: [], notInOc: [], totals: { members: 2, inOc: 2 } },
    myOc: { inOc: true, crime: { id: 77, name: 'Mob Mentality', difficulty: 3, status: 'Planning', readyAt: NOW + 7200, filled: 3, total: 4 }, slot: { role: 'Looter', cpr: 70, item: { name: 'Crowbar', ok: true } } } },
  '/api/wars': { faction: { id: 5, name: 'Example' }, wars: [{ type: 'Ranked War', id: '1', factionId: 99, name: MARK, score: 1200, myScore: 1500 }] },
  '/api/events': { seasonal: [], at: Date.now(), events: [{ title: 'Easter Egg Hunt', description: '', start: NOW + 3 * 86400 + 7200, end: NOW + 10 * 86400, exact: true, fixed: true }] },
  '/api/companion/money': { observedAt: Date.now(), wallet: 12345, vault: 67890, faction: { money: 3400, points: 6 } },
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
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ features: { 'app.splash': false, 'app.animations': false, 'app.updates': false, 'app.newYearWelcome': false } }));
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
// The live timer strip as laid out: its box beside the profile's and each segment, a tile (countdown, bar, icon, and
// the room above its label and below its bar). extras counts what the strip no longer has: a LIVE badge or a freshness line.
const STRIP_EXTRAS = '#ls-live, .ls-live, .ls-dot, #ls-fresh, .ls-fresh, .ls-head';
const stripOf = (page) => page.evaluate((extras) => {
  const card = document.querySelector('#ow-grid > [data-widget="timers"]'), css = getComputedStyle(card), r = card.getBoundingClientRect();
  const p = document.querySelector('#ow-grid > [data-widget="profile"]')?.getBoundingClientRect() || { top: 0, right: 0, bottom: 0 };
  const segs = [...card.querySelectorAll('.ls-seg')].map((seg) => {
    const b = seg.getBoundingClientRect(), v = seg.querySelector('.ls-value'), text = document.createRange(), s = getComputedStyle(seg);
    const label = seg.querySelector('.eyebrow').getBoundingClientRect(), bar = seg.querySelector('.ls-bar').getBoundingClientRect(), icon = seg.querySelector('.ls-icon');
    text.selectNodeContents(v);
    return { key: seg.dataset.ls, top: Math.round(b.top), left: Math.round(b.left), right: Math.round(b.right), bottom: Math.round(b.bottom), value: v.textContent, lines: text.getClientRects().length, clipped: v.scrollWidth > v.clientWidth, bar: parseFloat(seg.querySelector('.ls-bar > i').style.width), done: seg.classList.contains('done'),
      tile: parseFloat(s.borderTopLeftRadius) > 0 && s.borderTopStyle === 'solid', svgIcon: !!icon.querySelector('svg') && !/\p{Extended_Pictographic}/u.test(icon.textContent),
      above: Math.round(label.top - b.top), below: Math.round(b.bottom - bar.bottom) };
  });
  return { top: Math.round(r.top), left: Math.round(r.left), bottom: Math.round(r.bottom), rows: css.gridRowStart, cols: css.gridColumnStart,
    profile: { top: Math.round(p.top), right: Math.round(p.right), bottom: Math.round(p.bottom) }, segs,
    extras: card.querySelectorAll(extras).length, bars: getComputedStyle(card.querySelector('.ls-bar > i')).transitionDuration };
}, STRIP_EXTRAS);
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
  overviewPlayer = { id: MEMBER, name: '<b>Bold</b>', level: 15, image: PHOTO, status: { state: 'Okay', description: 'Okay', color: 'green' }, faction: { faction_id: 5, faction_tag: 'TAG', faction_name: 'Example', position: 'Member' }, job: { position: 'Employee', company_id: 0, job: 'None' },
    rank: 'Average Hustler', age: 1234, property: '<u>Private Island</u>', awards: 120, married: { spouse_id: 7, spouse_name: 'Partner', duration: 300 } };
  const { page, errors, context } = await desktop(MEMBER);
  const posts = []; page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/overview-layouts') posts.push(r.postDataJSON()); });
  const firstReply = layoutReply(page);
  // the strip has no LIVE badge and no "updated … ago" line, before the first overview or after it
  await page.locator('#auth-key').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => state.overview), null, 'no overview yet');
  await page.evaluate(() => tick()); // what the app's one-second interval runs (this fixture skips startApp)
  assert.equal(await page.evaluate((extras) => document.querySelectorAll(extras).length, STRIP_EXTRAS), 0, 'no LIVE badge and no freshness line');
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
  assert.equal(await page.locator('.sidebar :is(#me-chip, .sidebar-foot)').count(), 0, 'the profile card replaces the player card that sat at the bottom of the sidebar');
  assert.equal(await page.locator('#ow-grid > [data-widget="profile"]').evaluate((el) => getComputedStyle(el).gridRowStart), 'span 2', 'the profile is two rows tall');
  const bottomOf = (sel) => page.locator(sel).evaluate((el) => Math.round(el.getBoundingClientRect().bottom));
  assert.ok(Math.abs(await bottomOf('#ow-grid > [data-widget="profile"]') - await bottomOf('#ow-grid > [data-widget="bars"]')) <= 2, 'the profile card ends with the Bars card');
  // Edit sits in the page header beside Refresh; no row of its own above the grid outside edit mode
  assert.equal(await page.locator('#ow-edit').evaluate((el) => !!el.closest('.topbar .top-actions')), true, 'Edit is in the page header');
  assert.equal(await page.locator('#ow-edit').isVisible(), true);
  assert.equal(await page.locator('#ow-bar').isVisible(), false, 'no edit toolbar row outside edit mode');
  await page.evaluate(() => showView('premium'));
  assert.equal(await page.locator('#ow-edit').isVisible(), false, 'Edit is only shown on the Overview');
  await page.evaluate(() => showView('overview'));
  assert.equal(await page.locator('#ow-edit').isVisible(), true, 'Edit is back on the Overview');
  // member: the profile has S, M and L, always one column. S ends with Bars; M shows the whole photo at its own shape
  // and is as tall as it needs; L is three rows and ends with Battle Stats. Tried without saving.
  await page.waitForFunction(() => LRXOverview.access() === 'active');
  const sizeProfile = (size) => page.evaluate((s) => LRXOverview.commit(LRXOverviewLayout.resize(LRXOverview.current(), LRXOverview.shown().index, 'profile', s, LRXOverview.access()), { save: false }), size);
  const profileBox = () => page.evaluate(() => {
    const card = document.querySelector('#ow-grid > [data-widget="profile"]'), r = card.querySelector('.pm-profile-frame').getBoundingClientRect(), css = getComputedStyle(card);
    return { size: card.dataset.size, rows: css.gridRowStart, cols: css.gridColumnStart, bottom: Math.round(card.getBoundingClientRect().bottom), fw: Math.round(r.width), fh: Math.round(r.height), fit: getComputedStyle(card.querySelector('.pm-profile-photo')).objectFit };
  });
  const sBox = await profileBox();
  assert.deepEqual([sBox.size, sBox.rows, sBox.cols, sBox.fit], ['S', 'span 2', 'span 1', 'cover'], 'S: one column, two rows');
  const detailsShown = () => page.locator('#ow-grid > [data-widget="profile"] .pm-profile-more').isVisible();
  assert.equal(await detailsShown(), false, 'S: no detail lines');
  // M with a portrait photo (the owner's case): all of it, as wide as the card, at its own shape; the card is as tall
  // as the photo needs, from the top of its three rows
  await page.route(PORTRAIT, (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="410" viewBox="0 0 300 410"><rect width="300" height="410" fill="#2b3350"/><circle cx="150" cy="150" r="80" fill="#8a93b8"/><rect y="380" width="300" height="30" fill="#c44"/></svg>' }));
  const setPhoto = (src) => page.evaluate(async (s) => {
    const img = document.querySelector('#ow-grid > [data-widget="profile"] .pm-profile-photo');
    if (img.getAttribute('src') !== s) img.src = s;
    await img.decode().catch(() => {});
    return img.naturalWidth + 'x' + img.naturalHeight;
  }, src);
  const photoFit = () => page.evaluate(() => {
    const card = document.querySelector('#ow-grid > [data-widget="profile"]'), frame = card.querySelector('.pm-profile-frame'), img = card.querySelector('.pm-profile-photo');
    const f = frame.getBoundingClientRect(), p = img.getBoundingClientRect(), css = getComputedStyle(card);
    return { size: card.dataset.size, rows: css.gridRowStart, cols: css.gridColumnStart, inner: frame.clientWidth, pw: Math.round(p.width), ph: Math.round(p.height), ratio: p.width / p.height, natural: img.naturalWidth / img.naturalHeight, photoBottom: Math.round(p.bottom), frameBottom: Math.round(f.bottom), bottom: Math.round(card.getBoundingClientRect().bottom) };
  });
  const checkM = async (where) => {
    await sizeProfile('M');
    assert.equal(await setPhoto(PORTRAIT), '300x410', 'the portrait test photo is loaded ' + where);
    const m = await photoFit();
    assert.deepEqual([m.size, m.rows, m.cols], ['M', 'span 3', 'span 1'], 'M: one column, three rows ' + where);
    assert.ok(Math.abs(m.pw - m.inner) <= 2, 'M: the photo is as wide as the frame, no empty sides ' + where + ': ' + JSON.stringify(m));
    assert.ok(Math.abs(m.ratio / m.natural - 1) <= 0.02, 'M: the photo keeps its own shape ' + where + ': ' + JSON.stringify(m));
    assert.ok(m.photoBottom <= m.frameBottom + 1, 'M: the photo is not cut off at the bottom ' + where + ': ' + JSON.stringify(m));
    assert.ok(m.bottom > sBox.bottom, 'M with a portrait photo is taller than S ' + where + ': ' + JSON.stringify(m));
    // nothing is left empty: the card reaches the bottom of Battle Stats beside it, and the room under the photo holds
    // the profile details down to the card's bottom, whole lines only
    assert.ok(Math.abs(m.bottom - await bottomOf('#ow-grid > [data-widget="battle"]')) <= 2, 'M: the card ends with Battle Stats, nothing empty below it ' + where + ': ' + JSON.stringify(m));
    const more = await page.evaluate(() => {
      const card = document.querySelector('#ow-grid > [data-widget="profile"] .pm-profile'), panel = card.querySelector('.pm-profile-more');
      if (!panel || !panel.offsetParent) return null;
      const c = card.getBoundingClientRect(), css = getComputedStyle(card), p = panel.getBoundingClientRect();
      const rows = [...panel.children].map((row) => row.getBoundingClientRect()).filter((r) => r.left < p.right - 1 && r.right > p.left + 1);
      return { gap: Math.round(c.bottom - parseFloat(css.paddingBottom) - parseFloat(css.borderBottomWidth) - p.bottom), shown: rows.length, whole: rows.every((r) => r.top >= p.top - 1 && r.bottom <= p.bottom + 1), text: panel.textContent };
    });
    assert.ok(more, 'M: the profile details are shown under the photo ' + where);
    assert.ok(Math.abs(more.gap) <= 2, 'M: the details fill the card to its bottom ' + where + ': ' + JSON.stringify(more));
    assert.ok(more.shown >= 3 && more.whole, 'M: at least three detail lines, none cut in half ' + where + ': ' + JSON.stringify(more));
    for (const text of ['Average Hustler', 'Example', 'Member']) assert.ok(more.text.includes(text), 'M details show ' + text + ' ' + where);
    assert.equal(await page.locator('#ow-grid > [data-widget="profile"] u').count(), 0, 'Torn text in the details is never markup');
    return m;
  };
  await checkM('at 1440');
  await shot(page, 'overview-profile-M-1440.png');
  await setPhoto(PHOTO);
  await sizeProfile('L');
  const lBox = await profileBox();
  assert.deepEqual([lBox.size, lBox.rows, lBox.cols, lBox.fit], ['L', 'span 3', 'span 1', 'cover'], 'L: one column, three rows');
  assert.ok(Math.abs(lBox.bottom - await bottomOf('#ow-grid > [data-widget="battle"]')) <= 2, 'L ends with Battle Stats');
  assert.equal(await detailsShown(), false, 'L: the photo fills the card, no detail lines');
  await shot(page, 'overview-profile-L-1440.png');
  // a wide card (the owner's window)
  await page.setViewportSize({ width: 1700, height: 1050 });
  await checkM('at 1700');
  await shot(page, 'overview-profile-M-1700.png');
  await setPhoto(PHOTO);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await sizeProfile('S');
  await page.locator('#ow-edit').click();
  assert.deepEqual(await page.locator('#ow-grid > [data-widget="profile"] .ow-sizes button').allTextContents(), ['S', 'M', 'L'], 'a member gets S/M/L on the profile in edit mode');
  assert.equal(await page.locator('#ow-grid > [data-widget="profile"] .ow-sizes [data-ow-size="S"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#ow-done').click();
  assert.equal(await page.evaluate(() => LRXOverview.owner()), MEMBER);
  assert.equal(posts.length, 0, 'loading never saves');

  // fixed IDs: app.js renders into these whether or not their widget is shown
  for (const selector of ['#t-drug', '#t-edu', '#t-day', '#bars', '#mini-row', '#status-chip', '#xan-chip', '#bs-totals', '#bs-table', '#ov-company']) {
    assert.equal(await page.locator(selector).count(), 1, 'fixed ID ' + selector);
  }
  for (const key of ['drug', 'edu', 'day']) {
    assert.equal(await page.locator(`#t-${key} [data-timer="${key}"]`).count(), 1, 'the ' + key + ' card has its countdown');
    assert.equal(await page.locator(`#ow-grid > [data-widget="timers"] [data-timer="${key}"]`).count(), 1, 'the strip has the ' + key + ' countdown');
    assert.equal(await page.locator(`[data-timer="${key}"]`).count(), 2, 'one ' + key + ' countdown in the card and one in the strip');
  }
  assert.equal(await page.locator('#ow-grid > [data-widget="bars"]').locator('#status-chip, #bars').count(), 2, 'the bars widget holds the status chip and the bars');
  assert.equal(await page.locator('#ow-grid > [data-widget="chips"] #mini-row').count(), 1, 'the status chips are their own widget');
  // Status: one row per value, the label on the left and the value on the right, the state by colour (a running
  // cooldown is amber, one that is over says Ready in green). At S the rows are one column and fill the card, which
  // ends with Bars, so nothing is left empty under them.
  const statusRows = () => page.evaluate(() => {
    const card = document.querySelector('#mini-row').closest('.card'), list = card.querySelector('#mini-row'), c = card.getBoundingClientRect(), css = getComputedStyle(card);
    const rows = [...list.querySelectorAll('.st-row')].map((r) => {
      const b = r.getBoundingClientRect(), v = r.querySelector('.st-v');
      // fits: the laid-out text is no wider than its box (scrollWidth alone missed an ellipsis-cut value)
      const text = document.createRange(); text.selectNodeContents(v);
      return { k: r.querySelector('.st-k').textContent.trim(), v: v.textContent.trim(), state: [...r.classList].filter((x) => x !== 'st-row').join(' '), left: Math.round(b.left), width: Math.round(b.width), bottom: Math.round(b.bottom), fits: v.scrollWidth <= v.clientWidth + 1 && text.getBoundingClientRect().width <= v.getBoundingClientRect().width + 1 };
    });
    return { rows, listWidth: Math.round(list.getBoundingClientRect().width), gap: rows.length ? Math.round(c.bottom - parseFloat(css.paddingBottom) - parseFloat(css.borderBottomWidth) - Math.max(...rows.map((r) => r.bottom))) : null };
  });
  const status = await statusRows();
  assert.deepEqual(status.rows.map((r) => r.k), ['Xanax Today', 'Total Xanax', 'Refills', 'Booster CD', 'Medical CD', 'Bank'], 'Status: one row per value ' + JSON.stringify(status));
  const statusOf = (k) => status.rows.find((r) => r.k === k);
  assert.deepEqual([statusOf('Xanax Today').v, statusOf('Total Xanax').v, statusOf('Refills').v], ['1', '812', '40']);
  assert.deepEqual([statusOf('Booster CD').v, statusOf('Booster CD').state], ['Ready', 'st-ok'], 'a cooldown that is over says Ready');
  assert.match(statusOf('Medical CD').v, /^00:\d\d:\d\d$/); assert.equal(statusOf('Medical CD').state, 'st-warn', 'a running cooldown is amber');
  assert.match(statusOf('Bank').v, /^\$2\.50B · 3d/);
  assert.ok(status.rows.every((r) => r.left === status.rows[0].left && Math.abs(r.width - status.listWidth) <= 1), 'S: the rows are one column as wide as the card ' + JSON.stringify(status));
  assert.ok(status.rows.every((r) => r.fits), 'S: every value fits on its row ' + JSON.stringify(status));
  assert.ok(Math.abs(status.gap) <= 2, 'S: the rows fill the card to its bottom ' + JSON.stringify(status));
  assert.ok(Math.abs(await bottomOf('#ow-grid > [data-widget="chips"]') - await bottomOf('#ow-grid > [data-widget="bars"]')) <= 2, 'Status ends with Bars');
  const recovery = await page.evaluate(() => {
    const o = state.overview, original = o.bars, oldAt = state.overviewAt, realNow = Date.now;
    const sample = () => ['energy', 'nerve'].map((key) => {
      const next = document.querySelector(`[data-next-tick="${key}"]`);
      const full = document.querySelector(`[data-full="${key}"]`);
      return [next.hidden ? null : next.textContent, full.textContent];
    });
    try {
      state.overviewAt = Date.now() - 3000;
      Date.now = () => state.overviewAt + 3000;
      o.bars = { ...original, energy: { current: 145, maximum: 150, ticktime: 6, fulltime: 6 },
        nerve: { current: 48, maximum: 50, ticktime: 4, fulltime: 304 } };
      renderOverview();
      const cached = sample();
      Date.now = () => state.overviewAt + 7000;
      tick();
      const waiting = sample();
      o.bars = { ...o.bars, energy: { current: 150, maximum: 150, ticktime: 599, fulltime: 0 } };
      renderOverview();
      return { cached, waiting, refreshed: sample() };
    } finally {
      Date.now = realNow; o.bars = original; state.overviewAt = oldAt; renderOverview();
    }
  });
  assert.deepEqual(recovery, {
    cached: [['Next recovery 00:00:03', '· full in 00:00:03'], ['Next recovery 00:00:01', '· full in 00:05:01']],
    waiting: [['Next recovery awaiting refresh', ''], ['Next recovery awaiting refresh', '· full in 00:04:57']],
    refreshed: [[null, '· full'], ['Next recovery awaiting refresh', '· full in 00:04:57']],
  }, 'Energy and nerve account for cache age and wait for the API to confirm recovery');
  // traveling: the trip is shown once, in Status, as the route and a landing countdown with its TCT time (from the
  // overview's own travel data, no extra request); the Bars header and the profile card show no travel chip
  const landAt = Math.floor(Date.now() / 1000) + 33 * 60 + 28;
  const travelTo = (fields) => page.evaluate((f) => { Object.assign(state.overview, f); state.overview.player.status = f.status; renderOverview(); tick(); }, fields);
  await travelTo({ status: { state: 'Traveling', description: 'Traveling from China to Torn', color: 'blue', until: 0 }, travel: { description: 'Traveling from China to Torn', icon: null }, trip: { destination: 'Torn', method: 'Airstrip', timeLeft: 2008, arrival: landAt } });
  const flying = await statusRows();
  assert.deepEqual(flying.rows.slice(0, 2).map((r) => [r.k, r.state]), [['Travel', 'st-blue'], ['Landing', 'st-blue st-land']], 'traveling: Travel and Landing lead Status ' + JSON.stringify(flying));
  assert.equal(flying.rows[0].v, 'China → Torn', 'the route, short');
  const landTct = new Date(landAt * 1000).toISOString().slice(11, 16);
  assert.match(flying.rows[1].v, new RegExp('^3[23]m \\d\\ds · ' + landTct + ' TCT$'), 'the landing countdown and its TCT time ' + JSON.stringify(flying.rows[1]));
  assert.ok(flying.rows.every((r) => r.fits), 'traveling: every value fits on its row ' + JSON.stringify(flying));
  assert.ok(flying.gap >= -1, 'traveling: the rows stay inside the card ' + JSON.stringify(flying));
  // the countdown is always whole on its row; its "· HH:MM TCT" is either whole beside it or wrapped out of sight, never cut
  const landFit = () => page.evaluate(() => {
    const v = document.querySelector('#mini-row .st-land .st-v'), box = v.getBoundingClientRect();
    const inside = (b) => b.left >= box.left - 1 && b.right <= box.right + 1 && b.top >= box.top - 1 && b.bottom <= box.bottom + 1;
    const left = v.querySelector('[data-land]').getBoundingClientRect(), when = v.querySelector('.st-when').getBoundingClientRect();
    return { left: inside(left), when: inside(when) ? 'shown' : when.top >= box.bottom - 1 ? 'hidden' : 'cut', box: [Math.round(box.width), Math.round(box.height)] };
  });
  const fit1440 = await landFit();
  assert.ok(fit1440.left && fit1440.when !== 'cut', 'at 1440 the landing countdown is whole and its TCT time is never cut ' + JSON.stringify(fit1440));
  await page.setViewportSize({ width: 1700, height: 1050 });
  assert.deepEqual(await landFit().then((f) => [f.left, f.when]), [true, 'shown'], 'at 1700 the TCT time has room beside the countdown');
  await shot(page, 'overview-traveling-1700.png', false);
  await page.setViewportSize({ width: 1440, height: 1050 });
  // a narrow Status card: the TCT time steps out of sight whole, the countdown stays
  await page.evaluate(() => { document.querySelector('#mini-row').style.width = '190px'; });
  assert.deepEqual(await landFit().then((f) => [f.left, f.when]), [true, 'hidden'], 'in a narrow card the TCT time is hidden whole');
  await page.evaluate(() => { document.querySelector('#mini-row').style.width = ''; });
  // long country names are shortened so the route fits
  assert.deepEqual(await page.evaluate(() => ['Traveling to Cayman Islands', 'Returning to Torn from United Kingdom', 'Traveling from South Africa to Torn', 'In United Arab Emirates', 'In Japan'].map(travelRoute)),
    ['Torn → Cayman', 'UK → Torn', 'South Africa → Torn', 'In UAE', 'In Japan'], 'travel routes, short');
  assert.equal(await page.locator('#status-chip').isVisible(), false, 'no travel chip in the Bars header');
  assert.equal(await page.locator('#ow-grid > [data-widget="profile"] .pm-profile-meta .chip').count(), 0, 'no travel chip on the profile card');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('#ow-grid *')].filter((el) => el.offsetParent !== null && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes('Traveling from China to Torn'))).length), 0, "Torn's long travel text is not shown on the Overview");
  await shot(page, 'overview-traveling-1440.png', false);
  await page.waitForTimeout(1100);
  await page.evaluate(() => tick());
  assert.notEqual((await statusRows()).rows[1].v, flying.rows[1].v, 'the landing countdown ticks');
  await travelTo({ status: { state: 'Traveling', description: 'Traveling from China to Torn', color: 'blue', until: 0 }, travel: { description: 'Traveling from China to Torn', icon: null }, trip: { destination: 'Torn', method: 'Airstrip', timeLeft: 0, arrival: Math.floor(Date.now() / 1000) - 5 } });
  assert.match((await statusRows()).rows[1].v, /^landed · \d\d:\d\d TCT$/, 'past the landing time it says landed until the next refresh');
  assert.equal(await page.locator('#mini-row [data-land]').textContent(), 'landed', 'the countdown part says landed');
  // abroad: where the player is, no landing line
  await travelTo({ status: { state: 'Abroad', description: 'In China', color: 'blue', until: 0 }, travel: { description: 'In China', icon: null }, trip: { destination: 'China', method: 'Airstrip', timeLeft: 0, arrival: landAt - 9000 } });
  const abroad = await statusRows();
  assert.deepEqual(abroad.rows.slice(0, 2).map((r) => [r.k, r.v]), [['Travel', 'In China'], ['Xanax Today', '1']], 'abroad: where, and no landing line ' + JSON.stringify(abroad));
  assert.equal(await page.locator('#status-chip').isVisible(), false, 'abroad: no chip in the Bars header');
  // back in Torn: the chips are back and Status has no travel lines
  await travelTo({ status: { state: 'Okay', description: 'Okay', color: 'green', until: 0 }, travel: null, trip: null });
  assert.equal((await statusRows()).rows[0].k, 'Xanax Today', 'in Torn: no travel lines');
  assert.equal(await page.locator('#status-chip').isVisible(), true, 'in Torn: the Bars header chip is back');
  assert.equal((await page.locator('#ow-grid > [data-widget="profile"] .pm-profile-meta .chip').textContent()).trim(), 'Okay', 'in Torn: the profile chip is back');

  // the live timer strip: in the first row beside the profile, three countdowns side by side, each its own tile with an
  // icon, its content in the middle (no empty band above it: no LIVE badge, no freshness line). They tick every second
  // (the hidden single cards are painted too).
  const ls = await stripOf(page);
  assert.equal(ls.extras, 0, 'no LIVE badge and no freshness line ' + JSON.stringify(ls));
  assert.ok(ls.segs.every((x) => x.tile && x.svgIcon), 'each countdown is a tile with a drawn (not emoji) icon ' + JSON.stringify(ls.segs));
  assert.ok(ls.segs.every((x, i) => i === 0 || x.left - ls.segs[i - 1].right >= 8), 'the tiles stand apart ' + JSON.stringify(ls.segs));
  assert.ok(ls.segs.every((x) => Math.abs(x.above - x.below) <= 4), 'each tile has as much room above its label as below its bar ' + JSON.stringify(ls.segs));
  assert.ok(ls.segs.every((x) => Math.abs((x.top - ls.top) - (ls.bottom - x.bottom)) <= 2), 'the tiles sit in the middle of the card ' + JSON.stringify(ls));
  assert.ok(Math.abs(ls.top - ls.profile.top) <= 2 && ls.left > ls.profile.right, 'the strip is in the first row beside the profile ' + JSON.stringify(ls));
  assert.deepEqual(ls.segs.map((x) => x.key), ['drug', 'edu', 'day']);
  assert.equal(new Set(ls.segs.map((x) => x.top)).size, 1, 'the three segments share one row ' + JSON.stringify(ls.segs));
  const segOf = (k) => ls.segs.find((x) => x.key === k);
  assert.match(segOf('drug').value, /^\d\d:\d\d:\d\d$/);
  assert.match(segOf('edu').value, /^12d \d\d:\d\d:\d\d$/);
  assert.match(segOf('day').value, /^\d\d:\d\d:\d\d$/);
  assert.ok(ls.segs.every((x) => x.lines === 1 && !x.clipped), 'each countdown is one whole line ' + JSON.stringify(ls.segs));
  assert.ok(ls.segs.every((x) => x.bar > 0 && x.bar <= 100 && !x.done), 'a running timer has a part-full bar ' + JSON.stringify(ls.segs));
  const eduCopies = await page.evaluate(() => [...document.querySelectorAll('[data-timer="edu"]')].map((el) => el.textContent));
  assert.ok(eduCopies.length === 2 && eduCopies.every((t) => /^12d /.test(t)), 'the hidden education card is painted too ' + JSON.stringify(eduCopies));
  // The app's one-second setInterval(tick) starts with the signed-in app (startApp), which this fixture skips: the test
  // runs tick() itself, as that interval does.
  await page.waitForTimeout(1100);
  await page.evaluate(() => tick());
  assert.notEqual((await stripOf(page)).segs[2].value, segOf('day').value, 'a second later the countdowns have moved on');
  // the moving bars follow the Animations switch (off in this fixture) and the system's reduced motion
  assert.equal(ls.bars, '0s', 'Animations off: the bars do not glide');
  await setSwitch(page, 'app.animations', true);
  const moving = await stripOf(page);
  assert.equal(moving.bars, '1s', 'Animations on: the bars glide for a second');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await stripOf(page);
  assert.ok(parseFloat(reduced.bars) <= 0.0001, 'reduced motion: no glide (the app-wide .01ms) ' + reduced.bars);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setSwitch(page, 'app.animations', false);
  await shot(page, 'overview-live-strip-1440.png');
  // the strip at full width (W) on a wide window: the same tiles, in the middle of the card, each countdown whole
  await page.setViewportSize({ width: 1700, height: 1050 });
  await showSet(page, oneLayout(['timers', 'W'], ['bars', 'M'], ['chips', 'S']));
  await waitForIds(page, ['timers', 'bars', 'chips']);
  const wide = await stripOf(page);
  assert.ok(wide.extras === 0 && wide.segs.every((x) => x.tile && x.lines === 1 && !x.clipped && Math.abs(x.above - x.below) <= 4 && Math.abs((x.top - wide.top) - (wide.bottom - x.bottom)) <= 2), 'W at 1700: whole, centred tiles ' + JSON.stringify(wide));
  await shot(page, 'overview-live-strip-W-1700.png', false);
  await page.evaluate(() => LRXOverview.commit(LRXOverviewLayout.defaultSet(), { save: false }));
  await waitForIds(page, DEFAULT_IDS);
  await page.setViewportSize({ width: 1440, height: 1050 });

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
  const classicStatus = await statusRows();
  assert.equal(classicStatus.rows.length, 6, 'classic: the same Status rows under the bars');
  assert.ok(classicStatus.rows.every((r) => r.fits), 'classic: every value fits on its row ' + JSON.stringify(classicStatus));
  assert.equal(await page.locator('#ow-grid > [data-widget="profile"]').isVisible(), false, 'classic: no profile card');
  assert.equal(await page.locator('#ow-grid > [data-widget="chips"]').isVisible(), false);
  assert.equal(await page.locator('#ow-grid > [data-widget="timers"]').isVisible(), false, 'classic: the three timer cards, no live strip');
  assert.equal(await page.locator('#ow-grid').evaluate((el) => el.classList.contains('ow-classic')), true);
  const tops = await page.evaluate(() => ['#t-drug', '#t-edu', '#t-day'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)));
  assert.equal(new Set(tops).size, 1, 'classic: the three timers share one row ' + JSON.stringify(tops));
  await shot(page, 'overview-classic-1440.png');
  await page.evaluate(() => setFeature('app.overviewLayout', true));
  assert.equal(await page.locator('[data-widget="chips"] #mini-row').count(), 1, 'the chips card is restored');
  await waitForIds(page, DEFAULT_IDS);

  // widths; at 4 columns the multi-day education countdown stays on one line in the strip
  for (const [width, columns] of [[1440, 4], [1366, 4], [1280, 4], [1100, 2], [760, 2], [640, 2], [600, 1]]) {
    await page.setViewportSize({ width, height: 900 });
    const m = await overflow(page);
    assert.ok(m.scroll <= m.width, 'no sideways scroll at ' + width + ': ' + JSON.stringify(m));
    assert.equal(await page.locator('#ow-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length), columns, 'columns at ' + width);
    // the profile fills the rows beside it: Bars at 4 columns, the live strip at 2 columns (no hole beside it)
    if (columns > 1) {
      const besideId = columns === 4 ? 'bars' : 'timers';
      const ends = await page.evaluate((id) => ['profile', id].map((w) => Math.round(document.querySelector(`#ow-grid > [data-widget="${w}"]`).getBoundingClientRect().bottom)), besideId);
      assert.ok(Math.abs(ends[0] - ends[1]) <= 2, `the profile ends with ${besideId} at ${width}: ${ends}`);
    }
    if (columns === 4) {
      const edu = await page.evaluate(() => {
        const v = document.querySelector('#ow-grid > [data-widget="timers"] [data-timer="edu"]'), text = document.createRange();
        text.selectNodeContents(v);
        return { text: v.textContent, lines: text.getClientRects().length, clipped: v.scrollWidth > v.clientWidth, size: getComputedStyle(v).fontSize };
      });
      assert.match(edu.text, /^\d+d \d\d:\d\d:\d\d$/, 'the education countdown has a day part at ' + width);
      assert.equal(edu.lines, 1, 'the education countdown is one line at ' + width + ': ' + JSON.stringify(edu));
      assert.equal(edu.clipped, false, 'the education countdown is not cut off at ' + width + ': ' + JSON.stringify(edu));
    }
    // two columns: the strip is 1 column and 3 rows beside the profile, its segments stacked, each countdown whole
    if (columns === 2) {
      const narrow = await stripOf(page);
      assert.deepEqual([narrow.cols, narrow.rows], ['span 1', 'span 3'], 'the strip is 1 column and 3 rows at ' + width);
      assert.ok(narrow.segs.every((x, i) => x.left === narrow.segs[0].left && (i === 0 || x.top > narrow.segs[i - 1].top)), 'the segments are stacked at ' + width + ': ' + JSON.stringify(narrow.segs));
      assert.ok(narrow.segs.every((x) => x.lines === 1 && !x.clipped), 'each countdown is one whole line at ' + width + ': ' + JSON.stringify(narrow.segs));
    }
    await shot(page, 'overview-' + width + '.png');
  }

  // two columns, the strip not right beside the profile (here without one): it spans both columns with its segments
  // side by side, so no column is left empty beside it. Right before the profile it is 1 x 3 beside it.
  await page.setViewportSize({ width: 1100, height: 900 });
  await showSet(page, oneLayout(['timers', 'L'], ['bars', 'M'], ['chips', 'S'], ['battle', 'L']));
  await waitForIds(page, ['timers', 'bars', 'chips', 'battle']);
  const alone = await page.evaluate(() => {
    const grid = document.querySelector('#ow-grid').getBoundingClientRect(), card = document.querySelector('#ow-grid > [data-widget="timers"]'), css = getComputedStyle(card);
    return { cols: css.gridColumnStart, rows: css.gridRowStart, width: Math.round(card.getBoundingClientRect().width), grid: Math.round(grid.width), tops: [...card.querySelectorAll('.ls-seg')].map((x) => Math.round(x.getBoundingClientRect().top)) };
  });
  assert.ok(alone.cols === 'span 2' && alone.rows !== 'span 3' && Math.abs(alone.width - alone.grid) <= 2, 'without the profile beside it the strip spans both columns ' + JSON.stringify(alone));
  assert.equal(new Set(alone.tops).size, 1, 'its segments are side by side ' + JSON.stringify(alone));
  await showSet(page, oneLayout(['timers', 'L'], ['profile', 'S'], ['bars', 'M'], ['battle', 'L']));
  await waitForIds(page, ['timers', 'profile', 'bars', 'battle']);
  const first = await stripOf(page);
  assert.deepEqual([first.cols, first.rows], ['span 1', 'span 3'], 'right before the profile the strip is 1 x 3 ' + JSON.stringify(first));
  assert.ok(Math.abs(first.bottom - first.profile.bottom) <= 2 && Math.abs(first.top - first.profile.top) <= 2, 'beside the profile, ending with it ' + JSON.stringify(first));
  await page.evaluate(() => LRXOverview.commit(LRXOverviewLayout.defaultSet(), { save: false }));
  await waitForIds(page, DEFAULT_IDS);

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
  // Networth is a tab of the Finance page now: the tile opens Finance on that tab.
  assert.equal(await page.evaluate(() => state.view), 'finance', 'a click on the tile opens its page');
  await page.waitForSelector('.fin-tab[data-fin-tab="wealth"][aria-selected="true"]', { timeout: 5000 });
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
  assert.equal(await layoutSelect.evaluate((el) => !!el.closest('.topbar .top-actions')), true, 'the layout picker sits beside Edit in the page header');
  await page.locator('.topbar').screenshot({ path: path.join(output, 'overview-header-layouts.png') });
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
  const ALL = [['gym', 'L'], ['networth', 'M'], ['travel', 'L'], ['job', 'M'], ['crimes', 'L'], ['jail', 'M'], ['awards', 'M'], ['oc', 'M'], ['war', 'L'], ['events', 'M'], ['orders', 'L'], ['faction_balance', 'S']];
  await showSet(page, oneLayout(...ALL));
  for (const [id] of ALL) if (id !== 'orders') await tileReady(page, id);
  const expected = {
    gym: ['Speed +12,000 · Strength +10,000', 'Last 7 days'], job: ['42', '1 position fits'], crimes: ['1 shop without security', 'Burglary', "Sally's Sweet Shop"],
    jail: ['3 / 9', '512'], awards: ['Bar Breaker', '92%', 'Commit 80 more Theft offenses.', 'Protege', '275,340 players have it'], oc: ['3/4', 'Mob Mentality', 'Looter'],
    war: ['1,500 – 1,200', '2 suitable targets', MARK, 'Alpha'], events: ['Easter Egg Hunt', 'starts in 3d'], orders: ['Company mode only'],
    faction_balance: ['$3,400', '6 points'],
  };
  for (const [id, parts] of Object.entries(expected)) {
    const text = await tileText(page, id);
    for (const part of parts) assert.ok(text.includes(part), `${id}: "${part}" in "${text}"`);
  }
  assert.ok(!(await tileText(page, 'awards')).includes('Halfway'), 'the Merit tile shows easy wins, not a long grind with a higher %');
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

  // Hiding promotions keeps paid widgets available. Turning the membership connection off hides the previews.
  await showSet(page, oneLayout(['drug', 'S'], ['gym', 'M'], ['networth', 'S']));
  await setSwitch(page, 'app.premiumPromos', false);
  assert.equal(await page.evaluate(() => LRXOverview.access()), 'active');
  await setSwitch(page, 'app.premium', false);
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
  await setSwitch(page, 'app.premium', true);
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
  assert.equal(await handle('timers').getAttribute('aria-label'), 'Move: Live timers');
  assert.equal(await removeBtn('battle').getAttribute('aria-label'), 'Remove');
  assert.equal(await fp.locator('#ow-grid .ow-sizes:visible').count(), 0, 'a free player has no size buttons');
  for (const sel of ['#ow-layout', '#ow-name', '#ow-duplicate', '#ow-delete', '#ow-edit']) assert.equal(await fp.locator(sel).isVisible(), false, sel + ' is not shown');
  for (const [sel, text] of [['#ow-reset', 'Reset to default'], ['#ow-add', '+ Add widget'], ['#ow-done', 'Done']]) assert.equal((await fp.locator(sel).textContent()).trim(), text);
  await fp.locator('[data-lang="tr"]').click();
  assert.equal((await fp.locator('#ow-done').textContent()).trim(), 'Bitti', 'a language change relabels the controls');
  assert.equal(await handle('battle').getAttribute('aria-label'), 'Taşı: Savaş gücü');
  assert.equal(await handle('timers').getAttribute('aria-label'), 'Taşı: Canlı sayaçlar');
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

  // The move, drag and add tests below use the three single timer cards: a player who put them back after the strip
  // came keeps them (a v 2 set is never moved to the strip again).
  await fp.evaluate(() => LRXOverviewEdit.stop());
  assert.equal(freePosts.length, 0, 'leaving edit mode with no change saves nothing');
  const cards = ['profile:S', 'drug:S', 'edu:S', 'day:S', 'bars:M', 'chips:S', 'battle:L', 'company:W'].map((w) => ({ id: w.split(':')[0], size: w.split(':')[1] }));
  await showSet(fp, { v: 2, active: 0, layouts: [{ name: '', widgets: cards }] });
  await waitForIds(fp, ['profile', 'drug', 'edu', 'day', 'bars', 'chips', 'battle']);
  await fp.evaluate(() => LRXOverviewEdit.start());
  assert.equal(await editing(), true);

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
  assert.deepEqual(await drawer.locator('[data-add]:not([disabled])').evaluateAll((els) => els.map((el) => el.dataset.add)), ['day', 'timers', 'chips', 'wallet', 'open_trades', 'active_gym', 'drug_inventory', 'equipment'], 'the free widgets not in the layout');
  const catalogSearch = drawer.getByRole('searchbox', { name: 'Search widgets' });
  await catalogSearch.fill('cuzdan');
  const wallet = drawer.locator('[data-add="wallet"]');
  assert.equal(await drawer.locator('[data-add]').count(), 1, 'search matches both languages and ignores accents');
  await wallet.click();
  await fp.locator('#ow-grid [data-widget="wallet"] .ow-t-main').filter({ hasText: '$12,345' }).waitFor();
  await removeBtn('wallet').click();
  await catalogSearch.fill('');
  const locked = drawer.locator('[data-add][disabled]');
  assert.equal(await locked.count(), 21, 'every Premium widget is listed');
  assert.equal(await locked.evaluateAll((els) => els.every((el) => el.textContent.includes('🔒') && el.textContent.includes('Premium'))), true, 'Premium items carry a lock and the note');
  assert.equal(await drawer.getByRole('heading', { name: 'Premium', exact: true }).count(), 1);
  const accessFilter = drawer.getByRole('combobox', { name: 'Widget access' });
  await accessFilter.selectOption('free');
  assert.equal(await locked.count(), 0, 'the free filter hides locked widgets');
  await accessFilter.selectOption('all');
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
  const barsOne = fp.locator('#ow-grid > [data-widget="bars"]'), barsOneBox = await barsOne.boundingBox();
  await handle('timers').dragTo(barsOne, { targetPosition: { x: barsOneBox.width * 0.2, y: barsOneBox.height * 0.8 } });
  await waitForIds(fp, ['profile', 'bars', 'timers', 'chips', 'battle']);
  const oneSave = layoutReply(fp, 'POST');
  await fp.locator('#ow-done').click();
  await oneSave;
  assert.deepEqual(savedIds(freePosts[5]), ['profile', 'bars', 'timers', 'chips', 'battle', 'company']);
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

  console.log(JSON.stringify({ ok: true, assertions: ['default layout with the profile first, ending with Bars', 'traveling: route and landing countdown only in Status; no travel chips', 'live timer strip beside the profile: three ticking countdowns as centred tiles with drawn icons (no LIVE badge, no freshness line), whole at W, stacked at 2 columns', 'Edit in the page header, on the Overview only; no toolbar row outside edit mode', 'company hidden by company mode, never by the grid', 'profile name as text and Torn profile link', 'fixed IDs stay in the DOM', 'saved layout after reload', 'corrupt cached copy and failed request fall back quietly', 'a failed request is asked again; an unconfirmed save toasts and sends nothing', 'a default-screen change confirmed late never replaces the saved layouts', 'free cards before the layout reply', 'another player sees the default layout; a save toasts and sends nothing', 'commit saves once and caches; 409 reloads; errors toast', 'empty layout hint', 'classic switch', 'widths 1440/1366/1280/1100/760/640/600', 'a multi-day education countdown is one line at 1280/1366/1440', 'five themes', 'TR/EN', 'member: networth and travel tiles render escaped data', 'a tile click opens its page', 'edit mode: a click, Enter or a drag attempt on a tile body opens nothing', 'member: S/M/L chips resize and a second layout is saved and switched', 'member: a layout name with markup is shown as text', 'every Premium widget renders; orders without company mode shows the note', 'off: no Premium group, tiles read Not available; Premium tiles hide in classic', 'Premium page Open goes to the Overview edit mode', 'fetch policy: none on another view, 1 within 59 s, 2 after 61 s; a failed attempt counts', 'page off: the Settings note and no request', 'unknown: the checking placeholder and no widget request', 'never requested: POST /api/stock-order, /api/faction/report, /api/targets', 'lapsed: default sizes and locked tiles, saved layout kept; renewal restores it','the profile card opens the Torn profile; in edit mode a click or a drag attempt on it opens no tab', 'edit mode shows a handle and × for each shown widget', '× removes chips and #mini-row stays in the DOM', 'keyboard: ArrowLeft twice on battle moves it two places; Delete on day removes it', 'drag drug onto edu moves drug after edu', 'add list: chips comes back last; Premium items are disabled with a lock', 'no Edit before an overview player is known', 'Done saves: after a reload the order is the same', 'a Done with no change sends nothing', 'leaving the Overview while editing saves and closes edit mode', 'hiding the window or switching the layout off saves and closes edit mode', 'lrx-premium-reset closes edit mode without saving', 'two-step Reset to default', '640 px with the drawer open: no sideways scrolling; the drawer is below the grid', 'edit mode in five themes at 1440 and 640', 'one column: drop by the vertical midpoint', 'no page errors or CSP reports'], screenshots: output }));
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  for (const child of children) { child.kill(); await new Promise((r) => child.exitCode !== null ? r() : child.once('exit', r)); }
  await new Promise((r) => server.close(r)); await service.close();
  const resolved = path.resolve(temp);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('lrx-overview-ui-')) throw Error('Unsafe fixture cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});
