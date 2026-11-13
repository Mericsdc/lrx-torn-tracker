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
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ features: { 'app.splash': false, 'app.animations': false, 'app.updates': false } }));
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
  assert.ok((await admin.page.locator('.pm-card-number').textContent()).includes('∞'));
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
  assert.ok((await user.page.locator('.pm-card-bottom').textContent()).includes('ExamplePlayer'));
  assert.equal(await user.page.locator('[data-premium-tab="members"]').count(), 0);
  assert.equal((await user.page.request.get(user.base + '/api/premium/admin')).status(), 403);
  assert.ok((await user.page.locator('.pm-card-number').textContent()).includes('30'));
  assert.equal(service.store.entitlement(tornId).remainingDays, 30);
  const personal = await (await user.page.request.get(user.base + '/api/premium/data')).json();
  assert.equal(personal.account.torn_id, tornId); assert.equal(personal.transactions.length, 1);
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
    backgrounds.push(await user.page.locator('.pm-member-card').evaluate((el) => getComputedStyle(el).backgroundImage));
  }
  assert.equal(new Set(backgrounds).size, 5, 'premium cards follow all five app themes');
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
  const overflow = await user.page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('#view-premium *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map((el) => el.tagName + '.' + el.className) }));
  assert.ok(overflow.scroll <= overflow.width + 1, JSON.stringify(overflow));
  await user.page.locator('[data-lang="tr"]').click();
  assert.ok((await user.page.locator('#premium-content').textContent()).includes('Test ortamı'));
  await user.page.reload();
  await user.page.evaluate(() => { document.querySelector('#auth-screen').hidden = true; document.body.classList.remove('auth-open'); showView('premium'); });
  await user.page.waitForFunction(() => window.PremiumAccess?.snapshot()?.connected === true);
  await user.page.locator('.pm-card-number').filter({ hasText: '30' }).waitFor();
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
  await admin.page.waitForFunction((n) => new RegExp('Total Xanax received\\s*' + n + '\\b').test(document.querySelector('.pm-overview-stats')?.textContent || ''), received);
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
    await user.page.locator('.pm-hero-cards.has-profile [data-pm-profile] .pm-profile').waitFor(); // the card is present while the layout is measured
    await user.page.screenshot({ path: path.join(output, 'premium-profile-' + width + '.png'), fullPage: false });
    const wide = await user.page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(wide.scroll <= wide.width + 1, 'no sideways scroll at ' + width + ': ' + JSON.stringify(wide));
  }
  assert.deepEqual(admin.errors, []); assert.deepEqual(user.errors, []);
  console.log(JSON.stringify({ ok: true, assertions: ['real desktop-to-service authentication', 'automatic connection with collapsed privacy notice and no verification form', 'test mode never sends Torn keys', 'protected founder lifetime membership', 'in-app 2-Xanax test awards 30 days', 'same-event replay awards zero and retains one record', 'member search and remaining days', 'private history and admin isolation', 'informational payment ledger without approval controls', 'five themes', '640px layout', 'TR/EN', 'restart reconnects automatically without a verification form'], screenshots: output }));
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  for (const child of children) { child.kill(); await new Promise((r) => child.exitCode !== null ? r() : child.once('exit', r)); }
  await new Promise((r) => server.close(r)); await service.close();
  const resolved = path.resolve(temp);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('lrx-premium-ui-')) throw Error('Unsafe fixture cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});
