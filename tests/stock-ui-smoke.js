// Stock Status page: KPI tiles, the shared delivery line with its "Set order time" menu, one table row per product,
// TR/EN and widths 1440/1100/640. Synthetic company data only (tests/stock-fixture.js); every request that leaves the
// local fixture server is aborted, so nothing reaches Torn.
//
// DOM contract asserted here:
//   #stock-kpis > .kpi x4 with .label In stock · On order · Storage used · Company funds; with nothing in transit the
//     On order tile reads "no active orders". No "First delivery" text on the page.
//   #delivery-card: "Next delivery" / "Sonraki teslimat"; the first [data-eta] inside .stock-next counts down to the
//     earliest order; exactly one [data-eta-bar]; [data-stock-torn-sync] (Electron only) calls
//     openInTab(stock URL, { activate: true, reuse: true });
//     "No stock orders currently in transit." when nothing is on order.
//   #delivery-card details.stock-sync: closed by default; summary "Set order time" / "Sipariş zamanını ayarla"; holds
//     [data-order-sync="0".."4"] and [data-order-mode="18tct"]; Escape and a click outside close it; it stays open
//     across renderCompany().
//   #product-table: a thead th per column; tbody tr[data-product="<product name>"] per product, in data order; every
//     td has data-label equal to its column's th text; td.st-lasts reads "1.4d → 3.3d" (∞ without sales); a .st-cover
//     bar per row whose <i> widths are finite; td.st-arrives has a [data-eta] countdown for products on order and the
//     source hint ("Torn timer ✓"); the status is a .chip (Good / Low / Critical).
//   #storage-label, #storage-bar (two direct <i> per product: in stock, on order), #storage-legend.
//   At 640 px the thead is display:none (rows read as cards), at 1440 px it is shown; no sideways scroll at
//   1440/1100/640 and the table fits its container.
//   Low stock on a late order reads "Runs out ⚠" (.st-safe.bad); [data-stock-torn-sync] is .primary while any time is
//   an estimate and plain when all come from Torn; when the next delivery is the 18:00 TCT reset the line shows no
//   separate "reset" countdown.
//   The page clock is paused: opening/closing the menu (summary click, Escape, outside click, picking an option, which
//   keeps keyboard focus on the summary) and keeping it open across renderCompany() (the periodic refresh) must take
//   effect synchronously, without setTimeout or requestAnimationFrame. The language toggle is an outside click: it
//   closes the menu.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { stockCompany, DEFAULT_ROWS } = require('./stock-fixture');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-stock-ui-'));
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ features: { 'app.splash': false, 'app.animations': false, 'app.updates': false, 'app.newYearWelcome': false } }));
const child = fork(path.join(__dirname, 'preview-server.js'), { env: { ...process.env, TORN_DATA_DIR: temp, TORN_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
let serverErr = ''; // the fixture server's stderr, printed when the smoke fails
child.stdout.resume();
child.stderr.on('data', (d) => { serverErr = (serverErr + d).slice(-20_000); });
const output = process.env.QA_OUTPUT || path.join(os.tmpdir(), 'lrx-qa-stock');
fs.mkdirSync(output, { recursive: true });

// 15:12 TCT: the fixture's next reset (now + 2 h 48 min) falls on the real 18:00 TCT.
const TIME = new Date('2026-11-14T15:12:00Z');
const STOCK_URL = 'https://www.torn.com/companies.php#/option=stock';
const PRODUCTS = DEFAULT_ROWS.map((row) => row[0]);
const MENU_BUTTONS = ['0', '1', '2', '3', '4'].map((h) => `[data-order-sync="${h}"]`).concat('[data-order-mode="18tct"]');
const errors = [], tornRequests = [], posts = [];
let browser, page, now;

// Polls from Node: page.waitForFunction runs on the page's own timers, which the paused page clock stops.
async function until(fn, arg, what, timeout = 5000) {
  for (const end = Date.now() + timeout; !(await page.evaluate(fn, arg));) {
    if (Date.now() > end) throw Error('Timed out waiting for ' + what);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const texts = (selector) => page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.replace(/\s+/g, ' ').trim()), selector);
const textOf = async (selector) => (await texts(selector)).join(' ');
const show = (company) => page.evaluate((c) => { state.company = c; renderCompany(); showView('stock'); }, company);
const menuOpen = () => page.evaluate(() => document.querySelector('#delivery-card details.stock-sync')?.open ?? null);
const kpiTile = (label) => page.evaluate((l) => {
  const tile = [...document.querySelectorAll('#stock-kpis > .kpi')].find((k) => k.querySelector('.label')?.textContent.trim() === l);
  return tile ? tile.textContent.replace(/\s+/g, ' ').trim() : null;
}, label);
const rows = () => page.evaluate(() => [...document.querySelectorAll('#product-table tbody tr[data-product]')].map((tr) => {
  const clean = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
  const cells = [...tr.querySelectorAll(':scope > td')];
  return {
    name: tr.dataset.product,
    cells: cells.map(clean),
    labels: cells.map((td) => td.dataset.label ?? null),
    lasts: clean(tr.querySelector('td.st-lasts')),
    arrives: clean(tr.querySelector('td.st-arrives')),
    eta: clean(tr.querySelector('td.st-arrives [data-eta]')),
    chips: [...tr.querySelectorAll('.chip')].map(clean),
    cover: [...tr.querySelectorAll('.st-cover i')].map((i) => ({ style: i.getAttribute('style') || '', width: i.getBoundingClientRect().width, max: i.closest('.st-cover').getBoundingClientRect().width })),
  };
}));
const heads = () => texts('#product-table thead th');

function assertCover(row) {
  assert.ok(row.cover.length > 0, `${row.name}: a .st-cover bar`);
  for (const bar of row.cover) assert.ok(!/NaN|Infinity|undefined/.test(bar.style) && Number.isFinite(bar.width) && bar.width <= bar.max + 1, `${row.name}: cover bar width is finite and inside its bar ${JSON.stringify(bar)}`);
}
async function assertLabelled(what) {
  const columns = await heads(), list = await rows();
  assert.deepEqual(list.map((r) => r.name), PRODUCTS, what + ': one row per product, in data order');
  assert.ok(columns.length > 0, what + ': the table has column headers');
  for (const row of list) assert.deepEqual(row.labels, columns, `${what}: every ${row.name} cell carries its column name as data-label`);
}
// Missing data must never reach the screen as NaN, Infinity, undefined or null, in text or in a bar width.
async function assertClean(what) {
  const found = await page.evaluate(() => {
    const view = document.querySelector('#view-stock');
    return {
      words: view.textContent.match(/NaN|undefined|Infinity|\bnull\b/g) || [],
      styles: [...view.querySelectorAll('[style]')].map((el) => el.getAttribute('style')).filter((s) => /NaN|Infinity|undefined/.test(s)),
    };
  });
  assert.deepEqual(found, { words: [], styles: [] }, what + ': no NaN, Infinity, undefined or null on the page');
}
async function shot(name) {
  await page.evaluate(() => { document.querySelector('#toast')?.classList.remove('show'); scrollTo({ top: 0, behavior: 'instant' }); });
  await page.screenshot({ path: path.join(output, name), fullPage: true });
}
async function checkWidths(lang) {
  for (const width of [1440, 1100, 640]) {
    await page.setViewportSize({ width, height: 1000 });
    const fit = await page.evaluate(() => {
      const table = document.querySelector('#product-table'), box = table?.parentElement;
      return {
        width: innerWidth, scroll: document.documentElement.scrollWidth,
        thead: table?.tHead ? getComputedStyle(table.tHead).display : 'missing',
        tableFits: !!box && box.scrollWidth <= box.clientWidth + 1,
        wide: [...document.querySelectorAll('#view-stock *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((el) => el.tagName + '.' + el.className),
      };
    });
    assert.ok(fit.scroll <= fit.width, `${lang} ${width}px: no sideways scroll ${JSON.stringify(fit)}`);
    assert.ok(fit.tableFits, `${lang} ${width}px: the product table fits its container ${JSON.stringify(fit)}`);
    if (width === 640) assert.equal(fit.thead, 'none', `${lang} 640px: rows read as cards, the table head is not displayed`);
    if (width === 1440) assert.ok(!['none', 'missing'].includes(fit.thead), `${lang} 1440px: a table with its head (${fit.thead})`);
    await shot(`stock-${lang}-${width}.png`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

(async () => {
  const { port } = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Fixture server did not report its port within 15 s')), 15_000);
    child.once('message', (m) => { clearTimeout(timer); resolve(m); });
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
    child.once('exit', (code) => { clearTimeout(timer); reject(Error('Fixture server exited: ' + code)); });
  });
  const base = 'http://127.0.0.1:' + port;
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Electron's tab bridge, so "Get exact times from Torn" is offered; English unless the test switches.
  await context.addInitScript(() => {
    window.electronAPI = { tabCreate: async () => ({}) };
    try { localStorage.setItem('tt.lang', 'en'); } catch {}
  });
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  page.on('request', (r) => { if (/(^|\.)torn\.com$/i.test(new URL(r.url()).hostname)) tornRequests.push(r.method() + ' ' + r.url()); });
  await page.route('**/*', (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/api/stock-order') {
      posts.push({ method: request.method(), body: request.postDataJSON() });
      return route.fulfill({ json: stockCompany({ now, name: 'Fixture Reply' }) });
    }
    return route.continue();
  });
  await page.clock.install({ time: TIME });
  await page.clock.pauseAt(TIME);
  await page.goto(base);
  await page.locator('#auth-key').waitFor({ state: 'visible' });
  now = await page.evaluate(() => Date.now());
  // Without a key the boot stops at the sign-in screen, before it applies the fixture's Animations-off setting.
  await page.evaluate((company) => {
    document.querySelector('#auth-screen').hidden = true;
    document.body.classList.remove('auth-open');
    document.body.classList.add('no-anim');
    applyCompanyMode(true); state.company = company; renderCompany(); showView('stock');
  }, stockCompany({ now }));

  // KPI row: four tiles; the First delivery tile is gone.
  const labels = await texts('#stock-kpis > .kpi .label');
  assert.equal(await page.locator('#stock-kpis > .kpi').count(), 4, `Stock Status shows 4 KPI tiles, found ${labels.length}: ${JSON.stringify(labels)}`);
  assert.deepEqual(labels, ['In stock', 'On order', 'Storage used', 'Company funds']);
  assert.ok(!(await textOf('#view-stock')).includes('First delivery'), 'no First delivery text');

  // One delivery line: the earliest order's countdown and one progress bar.
  assert.ok((await textOf('#delivery-card')).includes('Next delivery'), 'the delivery line reads Next delivery');
  assert.equal((await texts('#delivery-card .stock-next [data-eta]'))[0], '00:28:00', 'next delivery in 28 minutes');
  assert.equal(await page.locator('#delivery-card [data-eta-bar]').count(), 1, 'one progress bar, for the next delivery');
  assert.match(await textOf('#delivery-card .stock-next'), /· 4 products ·/, 'the 4 products in the next delivery (Suspenders arrives later), not all 5 on order');
  await page.clock.runFor(1000);
  await page.evaluate(() => tick());
  assert.equal((await texts('#delivery-card .stock-next [data-eta]'))[0], '00:27:59', 'the countdown ticks');

  // Products table: one row per product, in data order, with its numbers.
  const list = await rows(), row = Object.fromEntries(list.map((r) => [r.name, r]));
  assert.deepEqual(list.map((r) => r.name), PRODUCTS, 'one row per product, in data order');
  await assertLabelled('EN');
  for (const r of list) assertCover(r);
  const has = (r, value) => r.cells.some((cell) => cell.includes(value));
  for (const value of ['22,789', '16,825', '+33,100']) assert.ok(has(row.Bra, value), `Bra row shows ${value}: ${JSON.stringify(row.Bra.cells)}`);
  assert.ok(row.Bra.lasts?.includes('1.4d → 3.3d'), 'Bra lasts 1.4d → 3.3d with the order: ' + row.Bra.lasts);
  assert.ok(row.Bra.chips.some((c) => c.includes('Good')), 'Bra status Good: ' + JSON.stringify(row.Bra.chips));
  for (const name of ['Bra', 'Thong', 'Corset', 'Knickers']) assert.equal(row[name].eta, '00:27:59', name + ' arrives with the next delivery');
  assert.ok(row.Stockings.chips.some((c) => c.includes('Low')), 'Stockings status Low: ' + JSON.stringify(row.Stockings.chips));
  assert.ok(has(row.Stockings, '5,100'), 'Stockings suggested order 5,100: ' + JSON.stringify(row.Stockings.cells));
  assert.equal(row.Stockings.eta, null, 'no arrival countdown without an order');
  assert.ok(row.Suspenders.chips.some((c) => c.includes('Critical')), 'Suspenders status Critical: ' + JSON.stringify(row.Suspenders.chips));
  assert.equal(row.Suspenders.eta, '03:11:59', 'Suspenders arrives on its Torn timer');
  assert.ok(row.Suspenders.arrives?.includes('Torn timer'), 'Suspenders arrival says Torn timer: ' + row.Suspenders.arrives);
  assert.ok((await textOf('#storage-label')).includes('135,470 / 200,000'), 'storage used / space: ' + await textOf('#storage-label'));
  assert.equal(await page.locator('#storage-bar > i').count(), PRODUCTS.length * 2, 'in stock and on order bar per product');
  assert.ok((await textOf('#storage-legend')).length > 0, 'a storage legend');
  await assertClean('default fixture');

  // "Set order time" menu: closed, opens with all six options, Escape and an outside click close it, a choice posts.
  const menu = page.locator('#delivery-card details.stock-sync'), summary = menu.locator('summary');
  assert.equal(await menu.count(), 1, 'one Set order time menu');
  assert.equal(await menuOpen(), false, 'the menu starts closed');
  assert.ok((await summary.textContent()).includes('Set order time'), 'summary reads Set order time');
  await summary.click();
  assert.equal(await menuOpen(), true, 'a click on the summary opens the menu');
  assert.equal(await menu.locator('[data-order-sync], [data-order-mode]').count(), MENU_BUTTONS.length, 'six options in the menu');
  for (const button of MENU_BUTTONS) assert.ok(await menu.locator(button).isVisible(), button + ' is visible in the open menu');
  await page.keyboard.press('Escape');
  assert.equal(await menuOpen(), false, 'Escape closes the menu');
  await summary.click();
  assert.equal(await menuOpen(), true);
  await page.locator('#view-title').click();
  assert.equal(await menuOpen(), false, 'a click outside closes the menu');
  await summary.click();
  await menu.locator('[data-order-sync="2"]').click();
  await until(() => state.company?.company?.name === 'Fixture Reply', null, 'the order reply to render');
  assert.deepEqual(posts, [{ method: 'POST', body: { hoursAgo: 2, deliveryMode: 'hours' } }], '"2h ago" posts the order time');

  // An open menu stays open when the page re-renders (the periodic company refresh).
  if (!(await menuOpen())) await summary.click();
  assert.equal(await menuOpen(), true);
  await page.evaluate(() => renderCompany());
  assert.equal(await menuOpen(), true, 'the menu stays open across renderCompany()');
  await page.locator('#view-title').click();

  // Picking an option with the keyboard closes the menu and keeps focus on its summary, also after the reply re-renders.
  await summary.click();
  await page.evaluate(() => { document.querySelector('#delivery-card details.stock-sync > summary').dataset.qaOld = '1'; });
  await menu.locator('[data-order-sync="1"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await menuOpen(), false, 'picking an option closes the menu');
  await until(() => !document.querySelector('#delivery-card details.stock-sync > summary')?.dataset.qaOld, null, 'the re-render after the keyboard pick');
  assert.equal(await page.evaluate(() => document.activeElement?.matches('#delivery-card details.stock-sync > summary') ?? false), true, 'keyboard focus stays on the Set order time summary');
  assert.deepEqual(posts.at(-1), { method: 'POST', body: { hoursAgo: 1, deliveryMode: 'hours' } }, '"1h ago" posts the order time');

  // "Get exact times from Torn" only opens the stock page tab.
  assert.equal(await page.locator('#delivery-card [data-stock-torn-sync]').count(), 1, 'Get exact times from Torn in the delivery line');
  await page.evaluate(() => { window.qaOpenInTab = window.openInTab; window.qaOpened = []; window.openInTab = (url, opts) => { window.qaOpened.push({ url, opts }); }; });
  await page.locator('#delivery-card [data-stock-torn-sync]').click();
  await until(() => window.qaOpened.length > 0, null, 'openInTab');
  assert.deepEqual(await page.evaluate(() => window.qaOpened), [{ url: STOCK_URL, opts: { activate: true, reuse: true } }], 'opens (or reuses and shows) the Torn stock page tab');
  await page.evaluate(() => { window.openInTab = window.qaOpenInTab; });

  // Unknown storage space.
  await show(stockCompany({ now, space: null }));
  await assertClean('unknown storage space');
  assert.equal(await page.locator('#stock-kpis > .kpi').count(), 4, 'unknown space: four tiles');
  assert.equal(await page.locator('#storage-bar > i').count(), PRODUCTS.length * 2, 'unknown space: the storage bar still draws');
  assert.ok((await textOf('#storage-label')).includes('135,470'), 'unknown space: the used amount is shown');

  // A product without sales: lasts forever, its cover bar stays finite.
  await show(stockCompany({ now, rows: [...DEFAULT_ROWS, ['Garters', 20, 30, 9, 500, 1000, 0, 28]] }));
  await assertClean('a product without sales');
  const garters = (await rows()).find((r) => r.name === 'Garters');
  assert.ok(garters, 'a Garters row');
  assert.ok(garters.lasts?.includes('∞'), 'without sales the stock lasts ∞: ' + garters.lasts);
  assertCover(garters);

  // Nothing in transit: the line says so, the menu is still offered, the On order tile says no active orders.
  const idle = DEFAULT_ROWS.map(([name, price, rrp, cost, inStock, , avgDaily]) => [name, price, rrp, cost, inStock, 0, avgDaily, null]);
  await show(stockCompany({ now, rows: idle }));
  await assertClean('no orders');
  assert.ok((await textOf('#delivery-card')).includes('No stock orders currently in transit.'), 'no orders: the delivery line says so');
  assert.equal(await menu.count(), 1, 'no orders: the Set order time menu is still offered');
  assert.ok((await kpiTile('On order'))?.includes('no active orders'), 'no orders: On order tile: ' + await kpiTile('On order'));
  assert.deepEqual((await rows()).map((r) => r.eta), PRODUCTS.map(() => null), 'no orders: no arrival countdowns');
  await shot('stock-en-no-orders.png');

  // Will it run out before the order lands: low stock on a late Torn timer reads "Runs out ⚠". With estimates on the
  // page "Get exact times from Torn" is the primary action.
  const late = [...DEFAULT_ROWS, ['Garters', 20, 30, 9, 300, 1000, 3000, 'torn']];
  await show(stockCompany({ now, rows: late }));
  await assertClean('runs out before the delivery');
  const lateGarters = (await rows()).find((r) => r.name === 'Garters');
  assert.ok(lateGarters?.arrives?.includes('Runs out ⚠'), 'Garters runs out before its delivery: ' + lateGarters?.arrives);
  assert.equal(await page.locator('#product-table tr[data-product="Garters"] .st-safe.bad').count(), 1, 'Garters: the runs-out mark');
  assert.equal(await page.locator('#product-table tr[data-product="Bra"] .st-safe.bad').count(), 0, 'Bra is safe until its delivery');
  assert.equal(await page.locator('#delivery-card [data-stock-torn-sync].primary').count(), 1, 'estimates: Get exact times from Torn is primary');

  // All times from Torn's own timers: the Torn button is a plain button.
  await show(stockCompany({ now, rows: DEFAULT_ROWS.map((r) => (r[7] == null ? r : [...r.slice(0, 7), 'torn'])) }));
  await assertClean('all Torn timers');
  assert.equal(await page.locator('#delivery-card [data-stock-torn-sync]').count(), 1, 'all Torn timers: the Torn button is still offered');
  assert.equal(await page.locator('#delivery-card [data-stock-torn-sync].primary').count(), 0, 'all Torn timers: the Torn button is not primary');

  // 18:00 TCT mode: the next delivery is the reset itself, so the line does not show the same time twice.
  await show(stockCompany({ now, mode: '18tct' }));
  await assertClean('18:00 TCT mode');
  const line18 = await textOf('#delivery-card .stock-next');
  assert.ok(line18.includes('Next delivery') && !/reset/i.test(line18), '18:00 TCT mode: no separate reset countdown: ' + line18);
  assert.equal(await page.locator('#delivery-card [data-order-mode="18tct"].primary').count(), 1, '18:00 TCT mode: its option is primary');

  // Widths, English.
  await show(stockCompany({ now }));
  await checkWidths('en');

  // Turkish. The language toggle is a click outside the menu, so it closes an open menu.
  await summary.click();
  assert.equal(await menuOpen(), true);
  await page.locator('#lang-toggle [data-lang="tr"]').click();
  assert.equal(await menuOpen(), false, 'the language toggle closes the menu');
  const trHeads = await heads();
  for (const head of ['Ürün', 'Siparişte']) assert.ok(trHeads.some((h) => h.includes(head)), `TR header ${head}: ${JSON.stringify(trHeads)}`);
  assert.ok((await textOf('#delivery-card details.stock-sync summary')).includes('Sipariş zamanını ayarla'), 'TR summary');
  assert.ok((await textOf('#delivery-card')).includes('Sonraki teslimat'), 'TR delivery line');
  await assertLabelled('TR');
  await assertClean('TR');
  await checkWidths('tr');
  await show(stockCompany({ now, rows: late }));
  assert.ok((await rows()).find((r) => r.name === 'Garters')?.arrives?.includes('Önce biter ⚠'), 'TR runs-out mark');

  assert.deepEqual(errors, [], 'no page errors or CSP reports');
  assert.deepEqual(tornRequests, [], 'no request to Torn');
  console.log(JSON.stringify({ ok: true, assertions: ['four KPI tiles, no First delivery', 'one delivery line: next delivery countdown ticks, one progress bar', 'one row per product in data order with labelled cells', 'Bra 22,789 / 16,825 / 1.4d → 3.3d / +33,100', 'Stockings Low, suggests 5,100', 'Suspenders Critical on a Torn timer', 'arrival countdowns only for products on order', 'storage label, bar and legend', 'Set order time menu: closed, six options, Escape and outside click close, stays open on re-render', '2h ago posts { hoursAgo: 2, deliveryMode: hours }', 'a keyboard pick keeps focus on the menu summary across the re-render', 'Runs out ⚠ on a late delivery (EN, TR)', 'Torn button primary with estimates, plain with Torn timers only', '18:00 TCT mode: no duplicate reset countdown', 'the language toggle closes the menu', 'Get exact times from Torn opens the stock tab', 'unknown storage space', 'a product without sales lasts ∞ with a finite cover bar', 'no orders: in-transit note, menu, no active orders', 'TR headers, menu and delivery line', 'widths 1440/1100/640 in EN and TR without sideways scroll; cards at 640', 'no page errors, CSP reports or Torn requests'], screenshots: output }));
})().catch(async (e) => {
  console.error(e);
  if (errors.length) console.error('Page errors:', errors);
  if (serverErr.trim()) console.error('Fixture server stderr:\n' + serverErr);
  await page?.screenshot({ path: path.join(output, 'stock-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
}).finally(async () => {
  try { await browser?.close(); } catch (e) { console.error('Browser close failed:', e); process.exitCode = 1; }
  finally {
    child.kill();
    await new Promise((r) => child.exitCode !== null || child.signalCode !== null ? r() : child.once('exit', r));
    const resolved = path.resolve(temp);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('lrx-stock-ui-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
});
