const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { fork } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { stockCompany } = require('./stock-fixture');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-companion-ui-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ features: { 'app.splash': false, 'app.animations': false, 'app.premium': false } }));
  const child = fork(path.join(__dirname, 'preview-server.js'), [], {
    env: { ...process.env, TORN_DATA_DIR: dir, TORN_API_KEY: '', TORN_PREMIUM_SERVICE_URL: '' },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  let browser;
  try {
    const [{ port }] = await once(child, 'message');
    const base = 'http://127.0.0.1:' + port;
    browser = await chromium.launch({ executablePath: process.env.QA_CHROME_PATH || undefined });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
      page.setDefaultTimeout(8000);
      const errors = [], reads = [], inventoryReads = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (url.pathname === '/api/companion/inventory') {
          assert.equal(route.request().method(), 'GET');
          const category = url.searchParams.get('category'), offset = Number(url.searchParams.get('offset'));
          inventoryReads.push([category, offset]);
          const row = category === 'Primary'
            ? { id: offset + 1, name: offset ? 'Fixture rifle' : 'Fixture pistol', amount: 1, equipped: !offset, factionOwned: !offset }
            : { id: 100, name: 'Fixture medication', amount: 1234 };
          return route.fulfill({ json: { category, offset, limit: 20, hasMore: category === 'Primary' && offset === 0,
            observedAt: Date.now(), rows: [row] } });
        }
        const data = {
          '/api/companion/company': { rows: [{ id: 1, name: 'Fixture Lingerie', rating: 7, weekly: 100 }],
            observedAt: Date.now() },
          '/api/companion/market': { name: '<script>unsafe</script>', reference: 123, observedAt: Date.now(), rows: [{ price: 100, quantity: 2 }] },
          '/api/companion/money': { observedAt: Date.now(), faction: { money: 3450, points: 7 } },
        };
        if (!Object.hasOwn(data, url.pathname)) return route.continue();
        if (url.pathname === '/api/companion/company') {
          assert.equal(url.searchParams.get('type'), '1');
          assert.equal(url.searchParams.get('rating'), '7');
        }
        reads.push(url.pathname);
        return route.fulfill({ json: data[url.pathname] });
      });
      await page.goto(base, { waitUntil: 'load' });
      await page.locator('#auth-screen').waitFor({ state: 'visible' });
      await page.evaluate((company) => {
        document.querySelector('#auth-screen').hidden = true;
        document.body.classList.remove('auth-open');
        state.lang = 'en'; LRXCompanion.render();
        applyCompanyMode(true); state.company = { ...company, hasDirectorAccess: true }; renderCompany();
        showView('report');
      }, stockCompany());
      const director = page.locator('#companion-director');
      await director.getByText('Director summary').waitFor();
      await director.getByRole('button', { name: 'Load comparable companies' }).click();
      await director.getByText('Fixture Lingerie', { exact: false }).waitFor();
      const open = page.locator('#companion-palette-open');
      await open.click();
      const palette = page.locator('#companion-palette'), field = palette.getByRole('combobox');
      await field.fill('= 1,200 * 25%');
      await palette.getByText('300', { exact: true }).waitFor();
      await field.press('Escape');
      await palette.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.id === 'companion-palette-open');
      await open.click();
      await field.fill('tools');
      await field.press('Enter');
      await page.waitForFunction(() => location.hash === '#tools');
      const trade = page.locator('#companion-trade');
      await trade.getByLabel('Wallet', { exact: true }).fill('1m');
      await trade.getByLabel('Current offer').fill('500k');
      await trade.getByLabel('Wallet reserve').fill('250k');
      await trade.getByLabel('Amount or percent').fill('100k');
      await trade.getByRole('button', { name: 'Preview', exact: true }).click();
      await trade.getByText(/600,000/).waitFor();
      assert.deepEqual(reads, ['/api/companion/company']);
      const market = page.locator('#companion-market');
      await market.getByLabel('Item ID').fill('1');
      await market.getByRole('button', { name: 'Load Item Market offers' }).click();
      await market.getByText(/<script>unsafe<\/script>/).waitFor();
      assert.equal(await market.locator('script').count(), 0);
      const balance = page.locator('#companion-balance');
      await balance.getByRole('button', { name: 'Show my balance' }).click();
      await balance.getByText(/3,450.*7 points/).waitFor();
      const inventory = page.locator('#companion-inventory');
      const loadInventory = inventory.getByRole('button', { name: 'Load inventory' });
      await loadInventory.click();
      await inventory.getByText('Equipped · Faction-owned', { exact: true }).waitFor();
      await inventory.getByRole('button', { name: 'Next page' }).click();
      await inventory.getByText('Page 2', { exact: true }).waitFor();
      await inventory.getByRole('button', { name: 'Previous page' }).click();
      await inventory.getByText('Fixture pistol', { exact: true }).waitFor();
      await inventory.getByRole('button', { name: 'Next page' }).click();
      await inventory.getByText('Fixture rifle', { exact: true }).waitFor();
      await inventory.getByLabel('Category').selectOption('Medical');
      await inventory.getByRole('button', { name: 'Previous page' }).click();
      assert.equal(await inventory.locator('tbody tr').count(), 0);
      await loadInventory.click();
      await inventory.getByText('Fixture medication', { exact: true }).waitFor();
      await inventory.getByText('1,234', { exact: true }).waitFor();
      assert.equal(await inventory.getByRole('button', { name: /Torn inventory/ }).getAttribute('data-open-url'), 'https://www.torn.com/item.php');
      assert.deepEqual(inventoryReads, [['Primary', 0], ['Primary', 20], ['Primary', 0], ['Primary', 20], ['Medical', 0]]);
      await page.locator('#lang-toggle [data-lang="tr"]').click();
      await trade.getByRole('heading', { name: 'Ticaret' }).waitFor();
      assert.equal(await inventory.getByLabel('Kategori').inputValue(), 'Medical');
      assert.equal(await trade.getByLabel('Cüzdan', { exact: true }).inputValue(), '1m');
      await page.evaluate(() => window.dispatchEvent(new Event('lrx-premium-reset')));
      assert.equal(await trade.getByLabel('Cüzdan', { exact: true }).inputValue(), '');
      assert.equal(await inventory.getByLabel('Kategori').inputValue(), 'Primary');
      assert.deepEqual(errors, []);
      await page.close();
    }

    const torn = await browser.newPage();
    const requested = [];
    await torn.route('**/*', (route) => {
      requested.push(route.request().url());
      if (route.request().url() !== 'https://www.torn.com/index.php') return route.abort();
      return route.fulfill({ contentType: 'text/html', body: '<div id="public_trade"><div class="scrollWrapper___test">' +
        '<div class="message___test" id="match" style="outline:1px solid red">Selling Xanax</div>' +
        '<div class="message___test" hidden>Hidden Xanax</div></div></div><button id="game">Game action</button>' });
    });
    await torn.goto('https://www.torn.com/index.php');
    await torn.addScriptTag({ path: path.join(__dirname, '../torn-helpers/chat-highlight.js') });
    await torn.getByRole('button', { name: 'Chat highlights' }).click();
    await torn.getByRole('textbox', { name: 'Chat highlights' }).fill('Xanax');
    assert.match(await torn.locator('#match').evaluate((node) => node.style.outline), /red/);
    await torn.evaluate(() => window.__lrxChatHighlight.setActive(true));
    await torn.waitForFunction(() => document.querySelector('#match').style.outline.includes('gold'));
    assert.equal(await torn.locator('.message___test[hidden]').evaluate((node) => node.style.outline), '');
    await torn.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.match(await torn.locator('#match').evaluate((node) => node.style.outline), /red/);
    await torn.evaluate(() => window.dispatchEvent(new Event('focus')));
    await torn.waitForFunction(() => document.querySelector('#match').style.outline.includes('gold'));
    await torn.evaluate(async () => {
      window.__lrxChatHighlight.setActive(false);
      window.dispatchEvent(new Event('focus'));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    assert.match(await torn.locator('#match').evaluate((node) => node.style.outline), /red/);
    await torn.evaluate(() => window.__lrxChatHighlight.stop());
    assert.equal(await torn.getByRole('button', { name: 'Chat highlights' }).count(), 0);
    assert.deepEqual(requested, ['https://www.torn.com/index.php']);
    console.log('Companion smoke passed at 1280px and 390px, including focused Torn chat fixture.');
  } finally {
    await browser?.close();
    if (child.exitCode === null && child.signalCode === null) {
      const done = once(child, 'exit');
      child.kill();
      await done;
    }
    if (path.dirname(dir) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('lrx-companion-ui-')) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
