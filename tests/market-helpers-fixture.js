// Market helpers on fixture Torn pages (run from ui-smoke.js): the bazaar undercut helper and the bundled OpenMarket
// as the extension serves it. The markup copies the selectors current userscripts use for these pages; nothing here
// talks to Torn or weav3r.dev (the weav3r bridge is answered by the fixture page itself).
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const { buildUserscriptExtension } = require('../src/main/userscripts');

const MANAGE_HTML = `<!doctype html><html><head><title>Bazaar</title></head><body class="dark-mode">
<div id="bazaarRoot"><div class="content-wrapper"><div class="itemsContainner___qa"><div><div>
  <div data-testid="sortable-item" class="row___qa1" id="row-a">
    <div class="item___qa2 active___qa3">
      <div class="imgContainer___qa4"><img src="/images/items/206/large.png" alt="Xanax"></div>
      <div class="desc___qa5"><span>Xanax</span></div>
      <button type="button" aria-label="Manage" class="manage-btn">Manage</button>
    </div>
    <div class="price___qa6"><div class="input-money-group"><span class="input-money-symbol">$</span><input class="input-money" type="text" id="price-a" value="900,000"><input class="input-money" type="hidden" value="900000"></div></div>
    <button type="button" class="torn-btn update-btn">Update</button>
  </div>
  <div data-testid="sortable-item" class="row___qa1" id="row-b">
    <div class="item___qa2">
      <div class="imgContainer___qa4"><img src="/images/items/1/large.png" alt="Hammer"></div>
      <div class="desc___qa5"><span>Hammer</span></div>
      <button type="button" aria-label="Manage" class="manage-btn">Manage</button>
    </div>
  </div>
</div></div></div></div></div>
<script>
  window.qa = { manage: 0, update: 0, rowPointer: 0, requests: [] };
  for (const b of document.querySelectorAll('.manage-btn')) b.addEventListener('click', () => qa.manage++);
  document.querySelector('.update-btn').addEventListener('click', () => qa.update++);
  for (const r of document.querySelectorAll('[data-testid="sortable-item"]')) r.addEventListener('pointerdown', () => qa.rowPointer++);
  // Stands in for the extension bridge: answers weav3r lookups with fixture listings
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m?.channel !== 'lrx-userscript-request' || m.script !== 'lrx-bazaar-price') return;
    qa.requests.push(m.url);
    const now = Math.floor(Date.now() / 1000);
    const listings = [
      { player_id: 4242, player_name: 'Me', price: 800000, last_checked: now },
      { player_id: 11, player_name: 'Old', price: 810000, last_checked: now - 7200 },
      { player_id: 12, player_name: 'Seller<b>x</b>', price: 817099, last_checked: now - 60 },
      { player_id: 13, player_name: 'Other', price: 820000, last_checked: now },
    ];
    qa.releaseListings = () => window.postMessage({ channel: 'lrx-userscript-response', script: m.script, id: m.id, response: { status: 200, responseText: JSON.stringify({ item_id: 206, listings }) } }, location.origin);
  });
</script></body></html>`;

// Bazaar → Add items: Torn's older list (li.clearfix rows). A greyed-out row is an item that cannot be added.
// Rows have a fixed height and a narrow name column; picture paths can be relative and a row can show the picture twice.
const ADD_HTML = `<!doctype html><html><head><title>Bazaar</title><style>
  ul.items-cont { width: 520px; margin: 0; padding: 0; list-style: none; font: 12px Arial, sans-serif; }
  ul.items-cont li { height: 34px; line-height: 34px; border-bottom: 1px solid #444; }
  ul.items-cont .title-wrap { float: left; width: 250px; }
  ul.items-cont .image-wrap { float: left; width: 50px; height: 34px; }
  ul.items-cont .image-wrap img { width: 46px; height: 23px; vertical-align: middle; }
  ul.items-cont .name-wrap { margin-left: 50px; height: 34px; }
  ul.items-cont .t-overflow { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  ul.items-cont .amount-main-wrap { float: right; width: 260px; }
</style></head><body class="dark-mode">
<div id="bazaarRoot"><div class="content-wrapper"><ul class="items-cont tab-menu-cont">
  <li class="clearfix" id="add-a">
    <div class="title-wrap"><div class="image-wrap"><img src="images/items/206/large.png" alt="Xanax"></div><div class="name-wrap"><span class="t-overflow">Xanax</span></div></div>
    <div class="amount-main-wrap"><div class="amount"><input class="clear-all" type="text" id="qty-a" value=""></div>
      <div class="price"><div class="input-money-group"><span class="input-money-symbol">$</span><input class="input-money" type="text" id="add-price-a" value=""><input class="input-money" type="hidden" value=""></div></div></div>
  </li>
  <li class="clearfix disabled" id="add-b">
    <div class="title-wrap"><div class="image-wrap"><img src="/images/items/1/large.png" alt="Hammer"></div><div class="name-wrap"><span class="t-overflow">Hammer</span></div></div>
    <div class="amount-main-wrap"><div class="price"><div class="input-money-group"><input class="input-money" type="text" id="add-price-b" value=""></div></div></div>
  </li>
  <li class="clearfix" id="add-c">
    <div class="title-wrap"><div class="image-wrap glow-yellow"><img class="torn-item" src="https://www.torn.com/images/items/180/large.png" alt="Bottle of Beer"><img src="https://www.torn.com/images/items/180/large.png" alt="" style="display:none"></div><div class="name-wrap"><span class="t-overflow">Bottle of Beer</span> x3</div></div>
    <div class="amount-main-wrap"><div class="amount"><input class="clear-all" type="text" id="qty-c" value=""></div>
      <div class="price"><div class="input-money-group"><input class="input-money" type="text" id="add-price-c" value=""></div></div></div>
  </li>
</ul><button type="button" class="torn-btn" id="add-confirm">Add to bazaar</button></div></div>
<script>
  window.qa = { confirm: 0, requests: [] };
  document.getElementById('add-confirm').addEventListener('click', () => qa.confirm++);
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m?.channel !== 'lrx-userscript-request' || m.script !== 'lrx-bazaar-price') return;
    qa.requests.push(m.url);
    const now = Math.floor(Date.now() / 1000);
    const price = m.url.endsWith('/180') ? 1 : 760000;
    const listings = [{ player_id: 4242, player_name: 'Me', price: 700000, last_checked: now }, { player_id: 21, player_name: 'Cheapest', price, last_checked: now }];
    window.postMessage({ channel: 'lrx-userscript-response', script: m.script, id: m.id, response: { status: 200, responseText: JSON.stringify({ listings }) } }, location.origin);
  });
</script></body></html>`;

const marketHtml = (tile, extra = '') => `<!doctype html><html><head><title>Item Market</title></head><body class="dark-mode">
<div id="item-market-root"><div class="filters___qa"><div class="rangeSlider___qa"><input type="range"><input type="range"></div></div>
  <button type="button" data-testid="dropdown-toggler" aria-expanded="true">Sort by: Price ascending</button>
  <ul role="listbox"><li role="option">Sort by: Price ascending</li><li role="option">Sort by: Quality</li></ul>
  <ul class="items___qa"><li>${tile}</li></ul></div>${extra}</body></html>`;
const tile = ({ price, damage, accuracy, bonus = '' }) => `<div class="itemTile___qa1">
  <div class="tileImage___qa2"><img src="/images/items/1/large.png" alt="Hammer"></div>
  <div><div class="title___qa3">Hammer</div></div>
  <div class="priceAndTotal___qa4"><span>$${price.toLocaleString('en-US')}</span></div>
  <div class="properties___qa5"><div class="property___qa6"><i class="icon___qa7"></i><span class="value___qa8" aria-label="Damage">${damage}</span></div>
    <div class="property___qa6"><i class="icon___qa7"></i><span class="value___qa8" aria-label="Accuracy">${accuracy}</span></div></div>
  <div class="bonuses___qa9">${bonus}</div></div>`;

async function checkMarketHelpers(browser, output) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const listings = { items: [{ listingID: 9, itemID: 1, minPrice: 2500, damage: 21.5, accuracy: 57, armor: 0, bonuses: [{ bonusID: 51, title: 'Expose', value: 12, description: '12% chance to expose' }] }] };
  let marketPage = '';
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'www.torn.com') return route.abort();
    if (url.pathname === '/bazaar.php') return route.fulfill({ contentType: 'text/html', body: url.searchParams.get('qa') === 'add' ? ADD_HTML : MANAGE_HTML });
    if (url.pathname === '/page.php' && url.searchParams.get('sid') === 'iMarket') return route.fulfill({ json: listings });
    if (url.pathname === '/page.php') return route.fulfill({ contentType: 'text/html', body: marketPage });
    return route.fulfill({ status: 404, body: '' });
  });

  // Bazaar → Manage: the helper fills one open row after a real click and nothing else
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('https://www.torn.com/bazaar.php#/manage');
  await page.bringToFront();
  await page.evaluate(() => { window.__lrxLang = 'en'; window.__lrxMe = '4242'; });
  await page.addScriptTag({ path: path.join(__dirname, '../torn-helpers/bazaar-undercut.js') });
  await page.waitForFunction(() => document.querySelectorAll('.lrx-bu').length === 2);
  const undercut = (row, percent) => page.locator(row).getByRole('button', { name: `−${percent}%`, exact: true });
  assert.deepEqual(await page.locator('#row-a .lrx-bu-btn').allTextContents(), ['−1%', '−5%', '−10%']);
  await undercut('#row-a', 1).click();
  await page.waitForFunction(() => typeof qa.releaseListings === 'function');
  assert.equal(await page.locator('#row-a .lrx-bu-btn:disabled').count(), 3, 'all rates wait for the same row lookup');
  await page.evaluate(() => qa.releaseListings());
  await page.locator('#row-a .lrx-bu-note.ok').waitFor();
  assert.equal(await page.inputValue('#price-a'), '808928', 'uses the cheapest fresh competing listing and rounds down');
  const note = page.locator('#row-a .lrx-bu-note');
  assert.equal(await note.textContent(), 'Set $808,928 · cheapest $817,099 (Seller<b>x</b>) · press Update yourself');
  assert.equal(await note.locator('b').count(), 0, 'a seller name from weav3r is shown as text');
  assert.deepEqual(await page.evaluate(() => qa.requests), ['https://weav3r.dev/api/marketplace/206']);
  // A closed row is not opened for the player
  await undercut('#row-b', 5).click();
  assert.equal(await page.locator('#row-b .lrx-bu-note').textContent(), "Open the row with Torn's Manage button first");
  // Synthetic clicks do nothing. The other rates reuse the same marketplace response.
  await page.fill('#price-a', '5');
  await page.evaluate(() => document.querySelector('#row-a .lrx-bu-btn').click());
  await page.waitForTimeout(200);
  assert.equal(await page.inputValue('#price-a'), '5');
  for (const [percent, expected] of [[5, '776244'], [10, '735389']]) {
    await undercut('#row-a', percent).click();
    await page.waitForFunction((value) => document.querySelector('#price-a').value === value, expected);
  }
  assert.deepEqual(await page.evaluate(() => ({ manage: qa.manage, update: qa.update, rowPointer: qa.rowPointer, requests: qa.requests.length })),
    { manage: 0, update: 0, rowPointer: 0, requests: 1 }, 'never presses Manage or Update, never starts a row drag, one weav3r request');
  await page.screenshot({ path: path.join(output, 'bazaar-undercut-fixture.png') });
  await page.evaluate(() => { location.hash = '#/add'; });
  await page.waitForFunction(() => document.querySelectorAll('.lrx-bu').length === 0);
  await page.evaluate(() => { location.hash = '#/manage'; });
  await page.waitForFunction(() => document.querySelectorAll('.lrx-bu').length === 2);
  await page.evaluate(() => { window.__lrxLang = 'tr'; document.querySelectorAll('.lrx-bu').forEach((n) => n.remove()); });
  await page.waitForFunction(() => document.querySelectorAll('.lrx-bu').length === 2);
  assert.deepEqual(await page.locator('#row-b .lrx-bu-btn').allTextContents(), ['−%1', '−%5', '−%10']);
  await page.locator('#row-b').getByRole('button', { name: '−%10', exact: true }).click();
  assert.equal(await page.locator('#row-b .lrx-bu-note').textContent(), "Önce Torn'un Manage düğmesiyle satırı aç");
  assert.deepEqual(errors, []);
  await page.close();

  // Bazaar → Add items: the same choices next to each eligible item, with only the price filled.
  const add = await context.newPage();
  add.on('pageerror', (e) => errors.push(e.message));
  await add.goto('https://www.torn.com/bazaar.php?qa=add#/add');
  await add.bringToFront();
  await add.evaluate(() => { window.__lrxLang = 'en'; window.__lrxMe = '4242'; });
  await add.addScriptTag({ path: path.join(__dirname, '../torn-helpers/bazaar-undercut.js') });
  await add.locator('#add-c .name-wrap .lrx-bu-options').waitFor();
  assert.equal(await add.locator('#add-b .lrx-bu-btn').count(), 0, 'no buttons on a row Torn has greyed out');
  await add.evaluate(() => document.querySelector('#add-a .lrx-bu-btn').click());
  await add.waitForTimeout(200);
  assert.equal(await add.inputValue('#add-price-a'), '', 'synthetic clicks do nothing');
  const settled = (row) => add.waitForFunction((r) => /\b(ok|warn|bad)\b/.test(document.querySelector(r + ' .lrx-bu-note').className), row);
  await add.locator('#add-a').getByRole('button', { name: '−5%', exact: true }).click();
  await settled('#add-a');
  assert.equal(await add.locator('#add-a .lrx-bu-note').textContent(), 'Set $722,000 · cheapest $760,000 (Cheapest) · enter the amount and confirm yourself',
    'the id comes from a relative picture path');
  assert.equal(await add.inputValue('#add-price-a'), '722000');
  assert.deepEqual(await add.evaluate(() => ({ qty: document.getElementById('qty-a').value, confirm: qa.confirm, requests: qa.requests })),
    { qty: '', confirm: 0, requests: ['https://weav3r.dev/api/marketplace/206'] }, 'the amount and Torn\'s confirm button are left to the player');
  // A long name in the narrow column: the buttons and their note stay on the item's own line.
  const onNameLine = () => add.evaluate(() => {
    const box = (s) => document.querySelector(s).getBoundingClientRect();
    const li = box('#add-c'), name = box('#add-c .name-wrap');
    return ['.lrx-bu-options', '.lrx-bu-note', '.t-overflow'].map((s) => box('#add-c ' + s))
      .every((r) => r.top >= li.top && r.bottom <= li.bottom && r.right <= name.right + 1);
  });
  assert.equal(await onNameLine(), true, 'all three buttons fit on the name line');
  await add.locator('#add-c').getByRole('button', { name: '−10%', exact: true }).click();
  await settled('#add-c');
  assert.equal(await add.locator('#add-c .lrx-bu-note').textContent(), 'Set $1 · cheapest $1 (Cheapest) · enter the amount and confirm yourself',
    'one item shown by two pictures is still one item');
  assert.equal(await add.inputValue('#add-price-c'), '1', 'the price cannot go below $1');
  assert.equal(await onNameLine(), true, 'a long note is cut short on the name line, not pushed under the row');
  assert.equal(await add.evaluate(() => [...document.querySelectorAll('#add-a .t-overflow, #add-c .t-overflow')].every((n) => n.scrollWidth <= n.clientWidth)),
    true, 'the note gives way; item names that fit are not cut');
  assert.equal(await add.locator('#add-c .lrx-bu-note').getAttribute('title'), await add.locator('#add-c .lrx-bu-note').textContent(), 'the full note is in the tooltip');
  assert.equal(await add.evaluate(() => qa.requests[1]), 'https://weav3r.dev/api/marketplace/180');
  await add.screenshot({ path: path.join(output, 'bazaar-add-fixture.png') });
  await add.evaluate(() => { location.hash = '#/personalize'; });
  await add.waitForFunction(() => document.querySelectorAll('.lrx-bu').length === 0);
  assert.deepEqual(errors, []);
  await add.close();

  // OpenMarket as the extension builds it: labels only, only while the tab has focus, no HTML from Torn's attributes
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-om-'));
  const openMarket = fs.readFileSync(path.join(buildUserscriptExtension(dir, {}), 'openmarket.js'), 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  const market = async (html, focused) => {
    marketPage = html;
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.addInitScript((f) => { window.__qaFocus = f; Document.prototype.hasFocus = function () { return window.__qaFocus; }; }, focused);
    // Chrome runs document_start content scripts once <html> exists; Playwright's init scripts run before that
    await p.addInitScript((src) => {
      new MutationObserver((_, o) => { if (!document.documentElement) return; o.disconnect(); (0, eval)(src); }).observe(document, { childList: true });
    }, openMarket);
    await p.goto('https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=1');
    await p.bringToFront();
    return p;
  };
  const xss = '<b>Expose</b><img src="/x.png" onerror="window.__qaInjected = 1">';
  const fallback = await market(marketHtml(tile({ price: 1000, damage: 20, accuracy: 58, bonus: `<i class="bonus-attachment-expose" data-bonus-attachment-title='${xss}' data-bonus-attachment-description="9% chance to expose"></i>` })), false);
  await fallback.waitForTimeout(600);
  assert.equal(await fallback.locator('.openmarket-quality-box').count(), 0, 'nothing is painted while the tab is not focused');
  await fallback.evaluate(() => { window.__qaFocus = true; window.dispatchEvent(new Event('focus')); });
  await fallback.locator('.tileImage___qa2 .openmarket-quality-box').waitFor();
  assert.equal(await fallback.locator('.openmarket-quality-box').textContent(), 'Q 60.0%', 'Hammer 20 / 58 against base 17 / 55');
  assert.equal(await fallback.locator('.om-bonus-text').textContent(), '9% Expose');
  await fallback.waitForTimeout(300);
  assert.equal(await fallback.evaluate(() => window.__qaInjected), undefined, 'markup in a bonus attribute never runs');
  assert.equal(await fallback.locator('[data-om-bonus-injected], [data-om-filter-slider]').count(), 0, 'no sort entries or filter sliders in Torn\'s controls');
  assert.equal(await fallback.evaluate(() => document.documentElement.getAttribute('data-lrx-script-openmarket')), 'loaded');
  await fallback.close();
  const fetched = await market(marketHtml(tile({ price: 2500, damage: 21.5, accuracy: 57 }),
    "<script>document.addEventListener('DOMContentLoaded', () => fetch('/page.php?sid=iMarket&step=getListing').then((r) => r.json()));</script>"), true);
  await fetched.locator('.openmarket-quality-box').waitFor();
  assert.equal(await fetched.locator('.openmarket-quality-box').textContent(), 'Q 65.0%');
  assert.equal(await fetched.locator('.om-bonus-text').textContent(), '12% Expose', 'bonuses come from the listings the page fetched');
  await fetched.screenshot({ path: path.join(output, 'openmarket-fixture.png') });
  await fetched.close();
  assert.deepEqual(errors, []);
  await context.close();
}
module.exports = { checkMarketHelpers };
