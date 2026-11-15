// Real desktop HTTP bridge + real central SQLite service, synthetic events only.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createHttpServer } = require('../premium/server');
const { readConfig } = require('../premium/config');
const { parseEvent } = require('../premium/parser');
const { buildBattleStats } = require('../src/server/battle-stats');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-premium-ui-'));
const secret = crypto.randomBytes(32).toString('hex');
const config = readConfig({ PREMIUM_MODE: 'test', PREMIUM_DB_PATH: ':memory:', PREMIUM_TEST_AUTH_TOKEN: secret });
const { server, service } = createHttpServer(config, { fetchImpl: async () => { throw Error('External calls are forbidden in UI fixtures'); } });
const children = []; let browser;
const output = process.env.QA_OUTPUT || path.join(temp, 'screenshots'); fs.mkdirSync(output, { recursive: true });
async function desktop(tornId) {
  const data = path.join(temp, String(tornId)); fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ features: { 'app.splash': false, 'app.animations': false, 'app.updates': false, 'app.newYearWelcome': false } }));
  const child = fork(path.join(__dirname, 'preview-server.js'), { env: { ...process.env, TORN_DATA_DIR: data, TORN_API_KEY: '', TORN_PREMIUM_SERVICE_URL: 'http://127.0.0.1:' + server.address().port,
    TORN_PREMIUM_TEST_MODE: '1', TORN_PREMIUM_TEST_TOKEN: secret, TORN_PREMIUM_TEST_TORN_ID: String(tornId) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.push(child);
  const port = await new Promise((resolve, reject) => { child.once('message', (m) => resolve(m.port)); child.once('error', reject); child.once('exit', (code) => reject(Error('Fixture exited ' + code))); });
  const base = 'http://127.0.0.1:' + port, context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(base + '/#premium');
  await page.locator('#auth-key').waitFor({ state: 'visible' });
  // The app login is independent; membership proof is exercised through the real bridge below.
  await page.evaluate(() => { document.querySelector('#auth-screen').hidden = true; document.body.classList.remove('auth-open'); showView('premium'); });
  await page.waitForFunction(() => window.PremiumAccess?.snapshot()?.connected === true);
  assert.equal(await page.locator('#premium-consent').count(), 0);
  assert.equal(await page.locator('.premium-notice').count(), 0);
  assert.ok((await page.locator('#premium-content').textContent()).includes('Test workspace'));
  assert.equal(await page.locator('[data-premium-action="connect"],#premium-remember,#premium-consent,#pm-connect').count(), 0);
  await page.waitForFunction(() => !!window.PremiumAccess?.snapshot()?.account);
  return { page, base, errors, context };
}
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  const admin = await desktop(4037017);
  assert.ok((await admin.page.locator('.pm-seal-number').textContent()).includes('∞'));
  // The founder's lifetime seal is a full ring, with nothing to extend.
  assert.equal(await admin.page.locator('.pm-hero[data-state="lifetime"]').count(), 1);
  assert.equal(await admin.page.locator('circle.pm-seal-arc').getAttribute('data-fraction'), '1');
  assert.equal(await admin.page.locator('[data-premium-action="plans"]').count(), 0);
  assert.equal(await admin.page.locator('.pm-plan').count(), 4);
  assert.equal(await admin.page.locator('.pm-plan-until').count(), 0, 'a lifetime membership has no "until" dates');
  // The seal arc is a 30-day gauge; "until" dates add a plan's days to the current expiry, or to now.
  const view = await admin.page.evaluate(() => ({
    half: PremiumView.sealFraction({ active: true, remainingDays: 15 }), month: PremiumView.sealFraction({ active: true, remainingDays: 45 }),
    lifetime: PremiumView.sealFraction({ permanent: true, active: true }), expired: PremiumView.sealFraction({ active: false, status: 'expired', remainingDays: 0 }),
    expiredState: PremiumView.heroState({ configured: true, connected: true, account: { tornId: 1 }, subscription: { active: false, status: 'expired', remainingDays: 0 } }),
    extend: PremiumView.extendUntil({ active: true, expiresAt: 2e9 }, 30, 1e9), fresh: PremiumView.extendUntil({ active: false }, 15, 1e9),
  }));
  assert.deepEqual(view, { half: 0.5, month: 1, lifetime: 1, expired: 0, expiredState: 'expired', extend: 2e9 + 30 * 86400, fresh: 1e9 + 15 * 86400 });
  await admin.page.locator('[data-premium-tab="test"]').click();
  await admin.page.locator('[data-premium-action="test-payment"]').click();
  await admin.page.waitForFunction(() => document.querySelector('[data-test-added]')?.textContent.includes('30'));
  const firstExpiry = service.store.db.prepare('SELECT expires_at FROM premium_subscriptions').get().expires_at;
  const tornId = Number((await admin.page.locator('.pm-result-meta').textContent()).match(/Torn \[(\d+)\]/)[1]);
  await admin.page.locator('[data-premium-action="test-replay"]').click();
  await admin.page.waitForFunction(() => document.querySelector('[data-test-added]')?.textContent.trim() === '0 days');
  assert.equal(await admin.page.locator('[data-test-records]').textContent(), '1');
  assert.equal(service.store.entitlement(tornId).expiresAt, firstExpiry);
  assert.equal(service.store.settings().enabled, 0);
  service.store.cachePlayerName(tornId, 'ExamplePlayer');
  const user = await desktop(tornId);
  assert.ok((await user.page.locator('.pm-holder').textContent()).includes('ExamplePlayer'));
  assert.equal(await user.page.locator('[data-premium-tab="members"]').count(), 0);
  assert.equal(await user.page.locator('[data-premium-tab]').count(), 0, 'a regular member sees no lone tab');
  assert.equal((await user.page.request.get(user.base + '/api/premium/admin')).status(), 403);
  assert.ok((await user.page.locator('.pm-seal-number').textContent()).includes('30'));
  assert.equal(await user.page.locator('.pm-hero[data-state="active"]').count(), 1);
  assert.equal(await user.page.locator('circle.pm-seal-arc').getAttribute('data-fraction'), '1');
  assert.equal((await user.page.locator('[data-premium-action="plans"]').textContent()).trim(), 'Extend membership');
  assert.equal(service.store.entitlement(tornId).remainingDays, 30);
  const personal = await (await user.page.request.get(user.base + '/api/premium/data')).json();
  assert.equal(personal.account.torn_id, tornId); assert.equal(personal.transactions.length, 1);
  // The collection: six numbered rows, included for a member.
  assert.equal(await user.page.locator('.pm-collection .fx-entry').count(), 6);
  assert.match(await user.page.locator('.pm-collection .fx-entry').first().evaluate((el) => getComputedStyle(el, '::before').content), /counter\(pm-tool,\s*upper-roman\)/, 'each row carries a roman numeral');
  const badges = user.page.locator('.pm-collection .fx-badge');
  assert.equal(await badges.count(), 6);
  assert.equal(await badges.evaluateAll((els) => els.filter((el) => el.checkVisibility()).length), 0, 'the numeral replaces the Premium badge');
  assert.match(await user.page.locator('.pm-chapter:has(.pm-collection) .pm-chapter-title').textContent(), /^\d+ advanced tools, included$/);
  // Each plan says when the membership would then run until: the current expiry plus the plan's days (en-GB while the page is English).
  assert.equal(await user.page.locator('.pm-plan-until').count(), 4);
  // Small muted text is never faded further, so it keeps its contrast.
  assert.deepEqual(await user.page.evaluate(() => ['.pm-collection .fx-entry small', '.pm-plan-until'].map((s) => getComputedStyle(document.querySelector(s)).opacity)), ['1', '1']);
  const until = await user.page.evaluate(() => new Date((PremiumAccess.snapshot().subscription.expiresAt + 30 * 86400) * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
  assert.ok((await user.page.locator('.pm-plan[data-plan="2"] .pm-plan-until').textContent()).includes(until), 'the 2-Xanax plan runs 30 days past the current expiry: ' + until);
  assert.ok((await user.page.locator('.pm-receiver').textContent()).includes('4037017'));
  // An opened module workbench spans the whole collection and survives a refresh.
  await user.page.locator('#view-premium [data-feature-slot="travel_advanced"] [data-advanced-open]').click();
  const bench = user.page.locator('#view-premium [data-feature-slot="travel_advanced"][data-feature-open]');
  await bench.locator('.fx-workbench').waitFor();
  const spans = await user.page.evaluate(() => ({ bench: document.querySelector('#view-premium [data-feature-slot="travel_advanced"][data-feature-open]').getBoundingClientRect().width, list: document.querySelector('.pm-collection').getBoundingClientRect().width }));
  assert.ok(spans.bench >= spans.list * 0.95, 'the workbench spans both columns: ' + JSON.stringify(spans));
  await user.page.evaluate(() => { document.querySelector('.pm-hero').dataset.stale = '1'; });
  await user.page.locator('[data-premium-action="refresh"]').click();
  await user.page.waitForFunction(() => document.querySelector('.pm-hero') && !document.querySelector('.pm-hero').dataset.stale);
  assert.equal(await bench.locator('.fx-workbench').count(), 1, 'a refresh keeps the open workbench');
  await bench.locator('[data-fx-action="close"]').click();
  await user.page.locator('#view-premium [data-feature-slot="travel_advanced"] .fx-entry').waitFor();
  assert.equal(await user.page.locator('.pm-collection .fx-entry').count(), 6);
  // Motion: the entrance plays once, on fresh content after the view is shown; a refresh (the auto-refresh takes the same
  // path) never plays or replays it. The fixtures start with Animations off (body.no-anim).
  const statusRoute = (url) => url.pathname === '/api/premium/status';
  const slowStatus = (ms) => async (route) => { await new Promise((r) => setTimeout(r, ms)); await route.continue(); };
  const stale = (page) => page.evaluate(() => { const el = document.querySelector('.pm-page'); if (el) el.dataset.stale = '1'; });
  const reshow = (page) => page.evaluate(() => { showView('overview'); showView('premium'); });
  // Re-shows the view while the status answer is delayed: whether the old page stayed in sight meanwhile, then the fresh paint.
  const motion = async (page) => {
    await page.route(statusRoute, slowStatus(800));
    await stale(page); await reshow(page);
    const waiting = await page.evaluate(() => getComputedStyle(document.querySelector('.pm-page[data-stale]')).visibility);
    const handle = await page.waitForFunction(() => {
      const fresh = document.querySelector('.pm-page:not([data-stale])'), entry = fresh?.querySelector('.pm-collection .fx-entry');
      if (!entry) return false;
      const css = (el, pseudo) => getComputedStyle(el, pseudo);
      return { enter: fresh.classList.contains('pm-enter'), shown: css(fresh).visibility, arc: css(fresh.querySelector('.pm-seal-arc')).animationName, chapter: css(fresh.querySelector('.pm-chapter')).animationName, numeral: css(entry, '::before').transitionDuration, lift: css(fresh.querySelector('.pm-plan-days')).transitionDuration };
    }, null, { timeout: 5000 });
    await page.unroute(statusRoute);
    return { waiting, ...(await handle.jsonValue()) };
  };
  const still = await motion(user.page);
  assert.deepEqual([still.waiting, still.shown, still.arc, still.chapter], ['visible', 'visible', 'none', 'none'], 'Animations off: no hold and no entrance ' + JSON.stringify(still));
  await user.page.evaluate(() => document.body.classList.remove('no-anim'));
  const moving = await motion(user.page);
  assert.equal(moving.waiting, 'hidden', 'the old page waits hidden for fresh content, so it never shows and then replays');
  assert.deepEqual([moving.enter, moving.shown, moving.arc, moving.chapter], [true, 'visible', 'pmArc', 'pmRise'], 'the seal arc draws in and the chapters rise ' + JSON.stringify(moving));
  assert.notEqual(moving.numeral, '0s'); assert.notEqual(moving.lift, '0s');
  await user.page.locator('.pm-page:not(.pm-enter):not([data-stale])').waitFor({ timeout: 4000 }); // dropped once played, so it never replays
  await stale(user.page);
  await user.page.locator('[data-premium-action="refresh"]').click();
  await user.page.locator('.pm-page:not(.pm-enter):not([data-stale])').waitFor({ timeout: 5000 });
  // Showing Premium while it is already open (the active nav item, a module's "View membership") only refreshes: the
  // page stays in sight and the entrance is not replayed.
  await user.page.route(statusRoute, slowStatus(800));
  await stale(user.page);
  await user.page.evaluate(() => showView('premium'));
  assert.equal(await user.page.evaluate(() => getComputedStyle(document.querySelector('.pm-page[data-stale]')).visibility), 'visible', 'an open Premium page is never hidden');
  await user.page.locator('.pm-page:not([data-stale])').waitFor({ timeout: 5000 });
  assert.equal(await user.page.locator('.pm-page.pm-enter').count(), 0, 'an open Premium page does not replay the entrance');
  await user.page.unroute(statusRoute);
  // A failed refresh after the view is shown brings the old page back at once (well before the hold's 1.5 s limit), and
  // the next refresh does not play the entrance.
  await user.page.route(statusRoute, (route) => route.fulfill({ status: 500, json: { code: 'PREMIUM_SERVICE_ERROR', error: 'Unavailable' } }));
  await stale(user.page); await reshow(user.page);
  await user.page.waitForFunction(() => document.querySelector('#premium-feedback.premium-error')?.textContent && getComputedStyle(document.querySelector('.pm-page')).visibility === 'visible', null, { timeout: 1000 });
  await user.page.unroute(statusRoute);
  await user.page.locator('[data-premium-action="refresh"]').click();
  await user.page.locator('.pm-page:not([data-stale])').waitFor({ timeout: 5000 });
  assert.equal(await user.page.locator('.pm-page.pm-enter').count(), 0, 'no entrance after a failed refresh');
  // A slow answer never leaves the page blank: the old page shows again after a moment, and the late paint does not replay.
  await user.page.route(statusRoute, slowStatus(2500));
  await stale(user.page); await reshow(user.page);
  await user.page.waitForFunction(() => { const old = document.querySelector('.pm-page[data-stale]'); return !!old && getComputedStyle(old).visibility === 'visible'; }, null, { timeout: 2300 });
  await user.page.locator('.pm-page:not([data-stale])').waitFor({ timeout: 5000 });
  assert.equal(await user.page.locator('.pm-page.pm-enter').count(), 0, 'no entrance once the old page was shown again');
  await user.page.unroute(statusRoute);
  // A notice (here: service not configured) has nothing to animate, so it never carries the entrance class, which would
  // hold off the automatic refresh.
  const configured = await user.page.evaluate(() => PremiumAccess.snapshot());
  await user.page.route(statusRoute, (route) => route.fulfill({ json: { ...configured, configured: false } }));
  await stale(user.page); await reshow(user.page);
  await user.page.locator('.pm-page:not([data-stale]) .pm-not-configured').waitFor({ timeout: 5000 });
  assert.equal(await user.page.locator('.pm-page.pm-enter').count(), 0, 'a notice carries no entrance class');
  await user.page.unroute(statusRoute);
  await user.page.locator('[data-premium-action="refresh"]').click();
  await user.page.locator('.pm-page .pm-hero').waitFor({ timeout: 5000 });
  await user.page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await motion(user.page);
  assert.deepEqual([reduced.waiting, reduced.arc, reduced.chapter, reduced.numeral, reduced.lift], ['visible', 'none', 'none', '0s', '0s'], 'reduced motion: no hold, no entrance and no hover transitions ' + JSON.stringify(reduced));
  await user.page.emulateMedia({ reducedMotion: null });
  await user.page.evaluate(() => document.body.classList.add('no-anim'));
  await admin.page.locator('[data-premium-tab="members"]').click();
  await admin.page.locator('input[name="search"]').fill(String(tornId));
  await admin.page.locator('[data-premium-form="members"] [type="submit"]').click();
  await admin.page.waitForFunction(() => document.querySelector('.pm-days-cell b')?.textContent === '30');
  await admin.page.locator('input[name="search"]').fill('Ezlira');
  await admin.page.locator('[data-premium-form="members"] [type="submit"]').click();
  await admin.page.waitForFunction(() => document.querySelector('.pm-days-cell b')?.textContent === '∞');
  // Admin review text must be visible as text, never executed or inserted as markup.
  service.store.ingest(parseEvent({ id: 'xss_review', timestamp: Math.floor(Date.now() / 1000), event: 'You were sent 1x Xanax <img src=x onerror="window.premiumXSS=true">' }));
  await admin.page.locator('[data-premium-tab="payments"]').click();
  await admin.page.locator('tr').filter({ hasText: 'xss_review' }).waitFor();
  assert.equal(await admin.page.locator('[data-review-id],[data-premium-form="review"]').count(),0);
  assert.equal(await admin.page.locator('#premium-content img').count(), 0);
  assert.equal(await admin.page.evaluate(() => !!window.premiumXSS), false);
  const backgrounds = [];
  for (const theme of ['obsidian', 'ocean', 'forest', 'amethyst', 'light']) {
    await user.page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
    await user.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await user.page.screenshot({ path: path.join(output, 'premium-' + theme + '.png'), fullPage: true });
    backgrounds.push(await user.page.locator('.pm-hero').evaluate((el) => getComputedStyle(el).backgroundImage));
    // Gradient text washes out on the Light theme, so the seal number is a solid colour there.
    if (theme === 'light') assert.doesNotMatch(await user.page.locator('.pm-seal-number').evaluate((el) => getComputedStyle(el).color), /^rgba\(\d+, \d+, \d+, 0\)$|transparent/, 'the Light seal number is not transparent gradient text');
  }
  assert.equal(new Set(backgrounds).size, 5, 'the premium hero follows all five app themes');
  await admin.page.locator('[data-premium-tab="members"]').click();
  await admin.page.locator('input[name="search"]').fill('');
  await admin.page.locator('[data-premium-form="members"] [type="submit"]').click();
  await admin.page.waitForFunction(() => document.querySelectorAll('.pm-days-cell').length === 2);
  await admin.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await admin.page.screenshot({ path: path.join(output, 'premium-admin.png'), fullPage: true });
  await admin.page.locator('[data-premium-tab="test"]').click();
  await admin.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await admin.page.screenshot({ path: path.join(output, 'premium-test-result.png'), fullPage: true });
  await user.page.setViewportSize({ width: 640, height: 800 });
  await user.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await user.page.screenshot({ path: path.join(output, 'premium-640.png'), fullPage: true });
  const noOverflow = async (label) => {
    const overflow = await user.page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('#view-premium *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map((el) => el.tagName + '.' + el.className) }));
    assert.ok(overflow.scroll <= overflow.width + 1, label + ' ' + JSON.stringify(overflow));
  };
  await noOverflow('640 EN');
  // ≤760: a 190 px seal, a stacked ledger, one collection column and a 2×2 plan grid.
  const narrow = await user.page.evaluate(() => { const css = (s) => getComputedStyle(document.querySelector(s)); return { seal: css('.pm-seal').width, ledger: css('.pm-ledger').flexDirection, collection: css('.pm-collection').gridTemplateColumns.split(' ').length, plans: css('.pm-plans').gridTemplateColumns.split(' ').length }; });
  assert.deepEqual(narrow, { seal: '190px', ledger: 'column', collection: 1, plans: 2 });
  await user.page.locator('[data-lang="tr"]').click();
  assert.ok((await user.page.locator('#premium-content').textContent()).includes('Test ortamı'));
  await user.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await user.page.screenshot({ path: path.join(output, 'premium-640-tr.png'), fullPage: true });
  await noOverflow('640 TR');
  await user.page.reload();
  await user.page.evaluate(() => { document.querySelector('#auth-screen').hidden = true; document.body.classList.remove('auth-open'); showView('premium'); });
  await user.page.waitForFunction(() => window.PremiumAccess?.snapshot()?.connected === true);
  await user.page.locator('.pm-seal-number').filter({ hasText: '30' }).waitFor();
  assert.equal(await user.page.locator('[data-premium-action="connect"],#premium-remember,#pm-connect').count(), 0);
  assert.equal(service.store.entitlement(tornId).expiresAt, firstExpiry);
  // Members see the payment date without the long transaction ID; the admin ledger keeps it for matching Torn logs.
  assert.equal(await user.page.locator('#premium-content .pm-event-id').count(), 0, 'transaction IDs are hidden from members');
  assert.equal((await user.page.locator('#premium-content .pm-table th').first().textContent()).trim(), 'Tarih', 'the member column is just the date');
  assert.ok((await user.page.locator('#premium-content').textContent()).includes('2'), 'the payment row is still listed');
  await admin.page.locator('[data-premium-tab="payments"]').click();
  await admin.page.locator('tr').filter({ hasText: 'xss_review' }).waitFor();
  // The owner sees the Xanax received from every member, not their own (zero) payments.
  await admin.page.locator('[data-premium-tab="membership"]').click();
  await admin.page.locator('[data-premium-action="refresh"]').click();
  const received = service.store.receivedTotal();
  assert.ok(received >= 2, 'the UI test payment was counted');
  await admin.page.waitForFunction((n) => new RegExp('Total Xanax received\\s*' + n + '\\b').test(document.querySelector('.pm-ledger')?.textContent || ''), received);
  // A member who paid 4 Xanax sees the 60-day card lit as their plan; before that, the 30-day card stays recommended.
  assert.equal(await user.page.locator('.pm-plan.featured').getAttribute('data-plan'), '2');
  await service.adminAction({ tornId: 4037017, admin: true }, 'test-payment', { torn_id: tornId, quantity: 4 });
  await user.page.locator('[data-premium-action="refresh"]').click();
  await user.page.locator('.pm-plan.featured[data-plan="4"]').waitFor();
  assert.equal(await user.page.locator('.pm-plan').count(), 4);
  assert.equal(await user.page.locator('.pm-plan.featured').count(), 1);
  assert.match(await user.page.locator('.pm-plan.featured .pm-plan-label').textContent(), /SON PLANINIZ/);
  // The viewer's own Torn profile sits beside the membership card, built only from the overview the app already has.
  // The overview arrives through the real /api/overview → renderOverview() path, after the Premium page was painted.
  let overviewPlayer = null;
  const overviewFixture = () => ({ player: overviewPlayer, serverTime: Math.floor(Date.now() / 1000), battle: buildBattleStats({ strength: 1000, defense: 1000, speed: 1000, dexterity: 1000 }), bars: {}, cooldowns: {}, drug: { cooldown: 0, xanaxActive: false }, education: { timeLeft: 0, completed: 0, totalCourses: 100 } });
  await user.page.route((url) => url.pathname === '/api/overview', (route) => route.fulfill({ json: overviewFixture() }));
  const showProfile = async (player) => { overviewPlayer = player; await user.page.evaluate(() => loadOverview(true)); };
  await user.page.route('https://profileimages.torn.com/ok.png', (route) => route.fulfill({ path: path.join(__dirname, '..', 'public', 'logo.png') }));
  const player = { id: tornId, name: '<b>Bold</b>', level: 15, image: 'https://profileimages.torn.com/missing.png', status: { state: 'Okay', description: 'Okay', color: 'green' }, faction: { faction_tag: 'TAG', faction_name: 'Example' } };
  await showProfile(player);
  const card = user.page.locator('[data-pm-profile] .pm-profile');
  await card.waitFor();
  assert.ok((await card.textContent()).includes('<b>Bold</b>'), 'the name is shown as text');
  assert.equal(await user.page.locator('[data-pm-profile] b').count(), 0, 'Torn data never becomes markup');
  assert.ok((await card.textContent()).includes(String(tornId)));
  assert.equal(await card.getAttribute('data-open-url'), 'https://www.torn.com/profiles.php?XID=' + tornId);
  assert.equal(await user.page.locator('[data-pm-profile] img.pm-profile-photo').getAttribute('src'), player.image);
  await user.page.locator('[data-pm-profile] .pm-profile.is-missing').waitFor(); // the photo request failed; the card keeps its layout
  await showProfile({ ...player, id: tornId + 1 });
  assert.equal(await user.page.locator('[data-pm-profile] .pm-profile').count(), 0, 'another player is never shown');
  await showProfile({ ...player, image: 'javascript:alert(1)' });
  await card.waitFor();
  assert.equal(await user.page.locator('[data-pm-profile] img').count(), 0, 'only https photos are used');
  await user.page.evaluate(() => { state.config ||= {}; state.config.features = { ...(state.config.features || {}), 'app.premiumProfile': false }; });
  await showProfile(player);
  assert.equal(await user.page.locator('[data-pm-profile] .pm-profile').count(), 0, 'the setting turns the card off');
  await user.page.evaluate(() => { state.config.features['app.premiumProfile'] = true; });
  await user.page.setViewportSize({ width: 1440, height: 1050 });
  await showProfile({ ...player, name: 'ExamplePlayer', image: 'https://profileimages.torn.com/ok.png' });
  await user.page.locator('[data-pm-profile] .pm-profile:not(.is-missing) img.pm-profile-photo').waitFor();
  await user.page.waitForFunction(() => document.querySelector('[data-pm-profile] img.pm-profile-photo')?.complete);
  await user.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await user.page.screenshot({ path: path.join(output, 'premium-profile.png'), fullPage: true });
  for (const width of [1100, 760, 640]) {
    await user.page.setViewportSize({ width, height: 900 });
    await user.page.locator('.pm-holder.has-profile [data-pm-profile] .pm-profile').waitFor(); // the card is present while the layout is measured
    await user.page.screenshot({ path: path.join(output, 'premium-profile-' + width + '.png'), fullPage: false });
    const wide = await user.page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(wide.scroll <= wide.width + 1, 'no sideways scroll at ' + width + ': ' + JSON.stringify(wide));
  }
  // Status unknown (service unreachable): a paying member never reads "Not active", and the reason sits in the hero.
  const real = await user.page.evaluate(() => window.PremiumAccess.snapshot());
  const unreachable = { ...real, connected: false, connectionError: 'PREMIUM_SERVICE_UNREACHABLE' };
  for (const key of ['account', 'subscription', 'balance', 'transactions']) delete unreachable[key];
  await user.page.route(statusRoute, (route) => route.fulfill({ json: unreachable }));
  await user.page.locator('[data-premium-action="refresh"]').click();
  await user.page.locator('.pm-hero[data-state="unknown"]').waitFor();
  assert.equal((await user.page.locator('.pm-seal-number').textContent()).trim(), '—');
  assert.equal((await user.page.locator('.pm-seal-label').textContent()).trim(), 'ÜYELİK DURUMU');
  assert.doesNotMatch(await user.page.locator('.pm-hero').textContent(), /NOT ACTIVE|AKTİF DEĞİL/i);
  assert.ok(await user.page.locator('.pm-hero .pm-connection-status').isVisible());
  assert.equal(await user.page.locator('.pm-connection-status').count(), 1, 'the connection line is shown once, in the hero');
  assert.doesNotMatch(await user.page.locator('.pm-ledger').textContent(), /Standart|Premium/);
  assert.equal(await user.page.locator('[data-premium-action="plans"]').count(), 0);
  assert.equal(await user.page.locator('.pm-plan').count(), 4);
  assert.equal(await user.page.locator('.pm-plan-until').count(), 0, 'no "until" date is guessed while the status is unknown');
  await user.page.unroute(statusRoute);
  // Expired: the seal reads 0, the button renews, and every "until" date runs from now, never from the old expiry.
  const now = Math.floor(Date.now() / 1000);
  const lapsed = { ...real, connected: true, subscription: { active: false, permanent: false, status: 'expired', remainingDays: 0, expiresAt: now - 400 * 86400, startedAt: now - 430 * 86400 } };
  await user.page.route(statusRoute, (route) => route.fulfill({ json: lapsed }));
  await user.page.locator('[data-premium-action="refresh"]').click();
  await user.page.locator('.pm-hero[data-state="expired"]').waitFor();
  assert.equal((await user.page.locator('.pm-seal-number').textContent()).trim(), '0');
  assert.match(await user.page.locator('.pm-seal-label').textContent(), /MEMBERSHIP EXPIRED|ÜYELİK SONA ERDİ/);
  assert.match((await user.page.locator('[data-premium-action="plans"]').textContent()).trim(), /^(Renew membership|Üyeliği yenile)$/);
  // The page rendered a moment before this check, so a local midnight in between may move the date by one day.
  const runs = await user.page.evaluate(() => { const p = PremiumAccess.snapshot().pricing, from = Date.now() / 1000, locale = state.lang === 'tr' ? 'tr-TR' : 'en-GB'; return [...document.querySelectorAll('.pm-plan')].map((el) => ({ shown: el.querySelector('.pm-plan-until')?.textContent || '', expected: [-1, 0, 1].map((shift) => new Date((from + (Number(el.dataset.plan) * p.premiumDays / p.xanaxPrice + shift) * 86400) * 1000).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })) })); });
  assert.equal(runs.length, 4);
  for (const run of runs) assert.ok(run.expected.some((date) => run.shown.includes(date)), 'an expired member extends from now: ' + JSON.stringify(run));
  await user.page.unroute(statusRoute);
  // Long day counts (admin adjustments allow up to 36,500 days) stay inside the seal's ring, wide and narrow.
  for (const days of [1000, 36500]) {
    await user.page.route(statusRoute, (route) => route.fulfill({ json: { ...real, subscription: { ...real.subscription, active: true, permanent: false, status: 'active', remainingDays: days, expiresAt: now + days * 86400 } } }));
    await user.page.locator('[data-premium-action="refresh"]').click();
    await user.page.locator('.pm-seal-number').filter({ hasText: String(days) }).waitFor();
    for (const width of [1440, 640]) {
      await user.page.setViewportSize({ width, height: 900 });
      const fit = await user.page.evaluate(() => {
        const seal = document.querySelector('.pm-seal').getBoundingClientRect(), n = document.querySelector('.pm-seal-number').getBoundingClientRect();
        const cx = seal.left + seal.width / 2, cy = seal.top + seal.height / 2, corners = [[n.left, n.top], [n.right, n.top], [n.left, n.bottom], [n.right, n.bottom]];
        return { ring: Math.round(seal.width * 100 / 236), farthest: Math.round(Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)))), width: Math.round(n.width) };
      });
      assert.ok(fit.farthest < fit.ring - 4, days + ' days at ' + width + ' px stay inside the ring: ' + JSON.stringify(fit));
    }
    await user.page.unroute(statusRoute);
  }
  // A player without a membership sees "Not active" and a "See plans" button that brings the plans into view.
  const visitor = await desktop(9000555666);
  await visitor.page.locator('.pm-hero[data-state="none"]').waitFor();
  assert.match(await visitor.page.locator('.pm-seal-label').textContent(), /NOT ACTIVE/);
  assert.equal(await visitor.page.locator('circle.pm-seal-arc').getAttribute('data-fraction'), '0');
  assert.equal(await visitor.page.locator('.pm-collection .fx-entry.is-locked').count(), 6);
  assert.match(await visitor.page.locator('.pm-chapter:has(.pm-collection)').textContent(), /\d+ advanced tools\s*Unlocked with Premium/);
  assert.equal((await visitor.page.locator('.pm-plan.featured .pm-plan-label').textContent()).trim(), 'RECOMMENDED');
  await visitor.page.setViewportSize({ width: 1440, height: 640 });
  const plansInView = () => { const r = document.querySelector('#pm-plans')?.getBoundingClientRect(); return !!r && r.top >= 0 && r.top < innerHeight; };
  assert.equal(await visitor.page.evaluate(plansInView), false, 'the plans start below the fold');
  const seePlans = visitor.page.locator('[data-premium-action="plans"]');
  assert.equal((await seePlans.textContent()).trim(), 'See plans');
  await seePlans.click();
  await visitor.page.waitForFunction(plansInView, null, { timeout: 2000 });
  const plansFocused = () => document.activeElement?.matches('#pm-plans .pm-chapter-title');
  assert.ok(await visitor.page.evaluate(plansFocused), 'focus moves to the plans with the view');
  await visitor.page.screenshot({ path: path.join(output, 'premium-nonmember.png'), fullPage: true });
  // On this page, a locked module's "Details" leads to the plans too (elsewhere it opens Premium).
  await visitor.page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }); document.activeElement?.blur(); });
  assert.equal(await visitor.page.evaluate(plansInView), false);
  await visitor.page.locator('.pm-collection .fx-entry.is-locked [data-advanced-open]').first().evaluate((el) => el.click());
  await visitor.page.waitForFunction(plansInView, null, { timeout: 2000 });
  assert.ok(await visitor.page.evaluate(plansFocused), 'a locked module\'s Details moves focus to the plans');
  assert.deepEqual(visitor.errors, []);
  assert.deepEqual(admin.errors, []); assert.deepEqual(user.errors, []);
  console.log(JSON.stringify({ ok: true, assertions: ['real desktop-to-service authentication', 'automatic connection with collapsed privacy notice and no verification form', 'test mode never sends Torn keys', 'protected founder lifetime membership', 'in-app 2-Xanax test awards 30 days', 'same-event replay awards zero and retains one record', 'member search and remaining days', 'private history and admin isolation', 'informational payment ledger without approval controls', 'membership seal states and 30-day gauge', 'lone member tab hidden', 'status unknown never reads not active', 'expired seal renews from now', 'numbered collection with a full-width workbench that survives a refresh', 'plan until dates and receiver', 'see plans and a locked module\'s Details scroll and move focus to the plans', 'entrance once on fresh content: held old page, never replayed after a failed or slow refresh or by re-opening an open page, none on notices, off with no-anim and reduced motion', 'long day counts fit the seal', 'small muted text keeps its contrast', 'five themes with a solid Light seal number', '640px layout in EN and TR', 'TR/EN', 'restart reconnects automatically without a verification form'], screenshots: output }));
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  for (const child of children) { child.kill(); await new Promise((r) => child.exitCode !== null ? r() : child.once('exit', r)); }
  await new Promise((r) => server.close(r)); await service.close();
  const resolved = path.resolve(temp);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('lrx-premium-ui-')) throw Error('Unsafe fixture cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});
