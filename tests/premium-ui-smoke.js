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
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(base + '/#premium');
  await page.locator('#auth-key').waitFor({ state: 'visible' });
  // The app login is independent; membership proof is exercised through the real bridge below.
  await page.evaluate(() => { document.querySelector('#auth-screen').hidden = true; document.body.classList.remove('auth-open'); showView('premium'); });
  await page.locator('#premium-consent').waitFor();
  assert.equal(await page.locator('.premium-notice').count(), 0);
  assert.ok((await page.locator('#premium-content').textContent()).includes('Test workspace'));
  await page.locator('[data-premium-action="connect"]').click();
  await page.waitForFunction(() => document.querySelector('#premium-feedback').textContent.includes('Acknowledge'));
  await page.locator('#premium-consent').check(); await page.locator('[data-premium-action="connect"]').click();
  await page.waitForFunction(() => !document.querySelector('#premium-consent'));
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
  const user = await desktop(tornId);
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
  await admin.page.locator('tr').filter({ hasText: 'xss_review' }).locator('[data-review-id]').click();
  assert.ok((await admin.page.locator('.pm-review-text').textContent()).includes('<img'));
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
  await user.page.locator('[data-premium-action="disconnect"]').click(); await user.page.locator('#premium-consent').waitFor();
  assert.ok((await user.page.locator('.pm-card-number').textContent()).includes('—'));
  assert.deepEqual(admin.errors, []); assert.deepEqual(user.errors, []);
  console.log(JSON.stringify({ ok: true, assertions: ['real desktop-to-service authentication', 'opt-in required', 'test mode never sends Torn keys', 'protected founder lifetime membership', 'in-app 2-Xanax test awards 30 days', 'same-event replay awards zero and retains one record', 'member search and remaining days', 'private history and admin isolation', 'safe review text', 'five themes', '640px layout', 'TR/EN', 'disconnect clears identity'], screenshots: output }));
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  for (const child of children) { child.kill(); await new Promise((r) => child.exitCode !== null ? r() : child.once('exit', r)); }
  await new Promise((r) => server.close(r)); await service.close();
  const resolved = path.resolve(temp);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('lrx-premium-ui-')) throw Error('Unsafe fixture cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});
