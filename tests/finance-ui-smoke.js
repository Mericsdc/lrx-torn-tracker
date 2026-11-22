// Finance page (public/finance.js): one sidebar item with a Networth tab and a Company tab, replacing the old
// Networth and Income Statement pages. Synthetic data only (tests/finance-fixture.js); every request that leaves the
// local fixture server is aborted, so nothing reaches Torn.
//
// DOM contract asserted here:
//   #nav .nav-item[data-view="finance"] (Finance / Finans); no networth or income items.
//   showView('networth') and showView('income') open view "finance" (hash #finance) on the Networth / Company tab.
//   .fin-tabs[role=tablist] > button.fin-tab[role=tab][data-fin-tab="wealth"|"company"][aria-selected]; arrow keys
//     move between tabs. Panels #fin-wealth / #fin-company (role=tabpanel).
//   Period pickers [data-fin-period="nw"|"co"] button[data-days][aria-pressed]: Networth 1/7/30/90/365 (default 30),
//     Company 1/7/30/all (default 7), remembered in localStorage tt.finance.nwPeriod / tt.finance.coPeriod.
//   Networth: .fin-chips (1D 7D 30D 1Y), .fin-alloc details[data-group] x4 with [data-part] rows (.fin-chg = change
//     over the period), .fin-movers .fin-mover (≤ 5), #fin-nw-chart, .fin-milestone (switch finance.milestone),
//     #fin-nw-table; "records cover N days" when the period reaches past the history.
//   Company: #fin-pnl with this / previous / change columns, [data-row="revenue"] .fin-now; .fin-products
//     [data-product] in data order; #fin-co-chart svg; #fin-funds svg; #fin-co-table tbody rows = days in the period.
//   Switches: page.networth off → Company tab only; company mode off → Networth tab only (the page falls back);
//     both off → Overview, nav item hidden.
//   One networth record and no company days: no NaN / undefined / Infinity / null text, empty states instead.
//   Holdings › Change (switch finance.priceSplit, /api/holdings `split`): #fin-holdings .fin-hold-mode
//     button[data-hold-mode="value"|"change"][aria-pressed] (remembered in tt.finance.holdingsMode);
//     .fin-hold-since (period · start date); .fin-hold-sum tiles; #fin-hold-change tbody tr[data-item].
//   EN and TR; 1440 / 1100 / 640 px without sideways scroll.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { networthData, financeCompany, holdingsData, holdingsSplit, DEFAULT_ROWS } = require('./finance-fixture');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-finance-ui-'));
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ features: { 'app.splash': false, 'app.animations': false, 'app.updates': false, 'app.newYearWelcome': false } }));
const child = fork(path.join(__dirname, 'preview-server.js'), { env: { ...process.env, TORN_DATA_DIR: temp, TORN_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
let serverErr = '';
child.stdout.resume();
child.stderr.on('data', (d) => { serverErr = (serverErr + d).slice(-20_000); });
const output = process.env.QA_OUTPUT || path.join(os.tmpdir(), 'lrx-qa-finance');
fs.mkdirSync(output, { recursive: true });

const PRODUCTS = DEFAULT_ROWS.map((row) => row[0]);
const errors = [], tornRequests = [];
let browser, page, now, networth = null, holdings = null;
const holdingsUrls = []; // the query of every /api/holdings request

async function until(fn, arg, what, timeout = 5000) {
  for (const end = Date.now() + timeout; !(await page.evaluate(fn, arg));) {
    if (Date.now() > end) throw Error('Timed out waiting for ' + what);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const textOf = (selector) => page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.replace(/\s+/g, ' ').trim()).join(' '), selector);
const count = (selector) => page.locator(selector).count();
const selectedTab = () => page.evaluate(() => document.querySelector('.fin-tab[aria-selected="true"]')?.dataset.finTab || null);
const pressed = (which) => page.evaluate((w) => document.querySelector(`[data-fin-period="${w}"] button[aria-pressed="true"]`)?.dataset.days || null, which);
const setFeat = (key, value) => page.evaluate(([k, v]) => { state.config ||= {}; state.config.features = { ...(state.config.features || {}), [k]: v }; applyFeatures(); }, [key, value]);
const wealthReady = () => until(() => !!document.querySelector('#fin-wealth .fin-alloc, #fin-wealth .empty-state'), null, 'the Networth tab');

async function assertClean(what) {
  const found = await page.evaluate(() => {
    const view = document.querySelector('#view-finance');
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
  for (const tab of ['wealth', 'company']) {
    await page.evaluate((t) => LRXFinance.setTab(t), tab);
    for (const width of [1440, 1100, 640]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(80);
      const fit = await page.evaluate(() => ({
        width: innerWidth, scroll: document.documentElement.scrollWidth,
        wide: [...document.querySelectorAll('#view-finance *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1 && !el.closest('.tbl-wrap')).slice(0, 6).map((el) => el.tagName + '.' + el.className),
      }));
      assert.ok(fit.scroll <= fit.width, `${lang} ${tab} ${width}px: no sideways scroll ${JSON.stringify(fit)}`);
      assert.deepEqual(fit.wide, [], `${lang} ${tab} ${width}px: nothing sticks out of the page`);
      await shot(`finance-${lang}-${tab}-${width}.png`);
    }
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
  await context.addInitScript(() => { try { localStorage.setItem('tt.lang', 'en'); } catch {} });
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  page.on('request', (r) => { if (/(^|\.)torn\.com$/i.test(new URL(r.url()).hostname)) tornRequests.push(r.method() + ' ' + r.url()); });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/api/holdings') { holdingsUrls.push(url.search); return typeof holdings === 'function' ? holdings(route) : holdings ? route.fulfill({ json: holdings }) : route.fulfill({ status: 500, json: { error: 'no fixture' } }); }
    if (url.pathname === '/api/networth') return networth ? route.fulfill({ json: networth }) : route.fulfill({ status: 500, json: { error: 'no fixture' } });
    return route.continue();
  });
  await page.goto(base);
  await page.locator('#auth-key').waitFor({ state: 'visible' });
  now = await page.evaluate(() => Date.now());
  networth = networthData({ now });
  holdings = holdingsData({ now });
  const company = financeCompany({ now });
  await page.evaluate((c) => {
    document.querySelector('#auth-screen').hidden = true;
    document.body.classList.remove('auth-open');
    document.body.classList.add('no-anim');
    applyCompanyMode(true); state.company = c; renderCompany();
  }, company);

  // Sidebar: one Finance item, no Networth or Income items.
  assert.equal(await count('#nav .nav-item[data-view="finance"]'), 1, 'one Finance item');
  assert.equal(await count('#nav .nav-item[data-view="networth"], #nav .nav-item[data-view="income"]'), 0, 'no Networth or Income items');
  assert.equal((await textOf('#nav .nav-item[data-view="finance"]')), 'Finance');
  assert.equal(await page.locator('#nav .nav-item[data-view="finance"]').isVisible(), true, 'the Finance item is shown');

  // The old names open Finance on the matching tab. The first networth call fails here: Holdings still load.
  networth = null;
  await page.evaluate(() => showView('networth'));
  assert.equal(await page.evaluate(() => state.view), 'finance', 'networth opens Finance');
  assert.equal(await page.evaluate(() => location.hash), '#finance');
  assert.equal(await selectedTab(), 'wealth', 'networth opens the Networth tab');
  await until(() => !!document.querySelector('#fin-holdings #fin-hold-table'), null, 'holdings while the networth failed');
  assert.equal(await count('#fin-wealth > .alert.danger'), 1, 'the networth error is shown above the card');
  assert.ok(!(await textOf('#fin-holdings .fin-hold-sum')).includes("In Torn's networth"), 'no comparison without the networth');
  networth = networthData({ now });
  await page.evaluate(() => loadFinance(true));
  await wealthReady();
  assert.equal(await textOf('#view-title'), 'Finance');

  // Tab cards carry their headline numbers.
  const cards = await page.evaluate((total) => ({ wealth: document.querySelector('.fin-tab[data-fin-tab="wealth"]').textContent, company: document.querySelector('.fin-tab[data-fin-tab="company"]').textContent, total: cmoney(total) }), networth.current.total);
  assert.ok(cards.wealth.includes(cards.total), `the Networth card shows ${cards.total}: ${cards.wealth}`);
  assert.ok(cards.company.includes('Fixture Lingerie'), 'the Company card names the company: ' + cards.company);
  assert.equal(await page.locator('.fin-tabs').getAttribute('role'), 'tablist');

  // Networth tab: 30D by default, four groups, the unknown part, movers, milestone, change chips.
  assert.equal(await pressed('nw'), '30', 'Networth period defaults to 30D');
  assert.equal(await count('.fin-alloc details[data-group]'), 4, 'four allocation groups');
  assert.ok((await textOf('.fin-alloc details[data-group="other"]')).includes('newthing'), 'a part Torn adds later is listed under its API name');
  const movers = await count('.fin-movers .fin-mover');
  assert.ok(movers >= 1 && movers <= 5, 'one to five movers: ' + movers);
  assert.ok((await textOf('.fin-milestone')).includes('$5.00B'), 'the next milestone is $5B: ' + await textOf('.fin-milestone'));
  for (const chip of ['1D', '7D', '30D', '1Y']) assert.ok((await textOf('.fin-chips')).includes(chip), 'change chip ' + chip);
  assert.ok(await count('#fin-nw-chart svg') === 1, 'a history chart');
  assert.ok(await count('#fin-nw-table tbody tr') >= 29, 'day-by-day rows for the period');
  await assertClean('EN networth');

  // 1D keeps the per-part change since yesterday.
  await page.locator('[data-fin-period="nw"] button[data-days="1"]').click();
  assert.equal(await pressed('nw'), '1');
  const bank = await page.evaluate((h) => signed(h[h.length - 1].bank - h[h.length - 2].bank), networth.history);
  assert.equal(await textOf('.fin-alloc [data-part="bank"] .fin-chg'), bank, '1D shows the bank change since yesterday');
  // 90D reaches past the 40 recorded days.
  await page.locator('[data-fin-period="nw"] button[data-days="90"]').click();
  assert.ok((await textOf('#fin-wealth')).includes('records cover 39 days'), 'the coverage note');
  assert.equal(await page.evaluate(() => localStorage.getItem('tt.finance.nwPeriod')), '90', 'the period is remembered');

  // Holdings: which items the networth sits in (/api/holdings, asked after the networth while this tab is shown).
  networth = networthData({ now });
  Object.assign(networth.current, { bazaar: 5_000_000_000, displaycase: 150_000_000 }); // Allocation lists these parts
  await page.evaluate(() => loadFinance(true));
  await until(() => !!document.querySelector('#fin-holdings #fin-hold-table'), null, 'the holdings table');
  assert.ok(holdingsUrls.length >= 1, 'holdings are asked');
  const holdChips = () => page.evaluate(() => [...document.querySelectorAll('#fin-holdings [data-hold-place]')].map((b) => b.dataset.holdPlace));
  const holdPressed = () => page.evaluate(() => document.querySelector('#fin-holdings [data-hold-place][aria-pressed="true"]')?.dataset.holdPlace || null);
  assert.deepEqual(await holdChips(), ['all', 'inventory', 'bazaar', 'display', 'stocks'], 'a chip per place with items; the failed item market has none');
  assert.equal(await holdPressed(), 'all', 'All by default');
  assert.equal(await count('#fin-hold-table tbody tr[data-item]'), 25, 'the top 25 rows first');
  await page.locator('#fin-holdings [data-hold-all]').click();
  assert.equal(await count('#fin-hold-table tbody tr[data-item]'), 36, 'Show all lists every priced row, Xanax once');
  assert.ok((await textOf('#fin-hold-table tbody tr[data-item="206"]')).includes('Bazaar'), 'All names the places an item sits in');
  assert.ok((await textOf('#fin-holdings')).includes('2 items without a market value'), 'zero-value rows are counted in a note');
  assert.ok((await textOf('#fin-holdings .fin-hold-err [data-place="itemmarket"]')).includes('Access level'), 'the item market reason is shown');
  assert.equal(await count('#fin-hold-table b'), 0, 'item names are never markup');
  assert.ok((await textOf('#fin-hold-table')).includes('<b>Bold</b> Plushie'), 'the name is shown as text');
  // Allocation › Bazaar opens the card on the bazaar.
  await page.locator('.fin-alloc .fin-part-go[data-hold-go="bazaar"]').click();
  assert.equal(await holdPressed(), 'bazaar', 'the Allocation link selects Bazaar');
  assert.equal(await page.evaluate(() => localStorage.getItem('tt.finance.holdingsPlace')), 'bazaar', 'the place is remembered');
  const holdSum = await textOf('#fin-holdings .fin-hold-sum');
  assert.ok(holdSum.includes('Xanax') && holdSum.includes('80.0%'), 'the biggest bazaar item and its share: ' + holdSum);
  assert.ok((await textOf('#fin-hold-table thead')).includes('Your price'), 'the bazaar shows the listed price');
  assert.ok(await page.evaluate(() => { const r = document.querySelector('#fin-holdings').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), 'the card is scrolled into view');
  await assertClean('EN holdings');
  // Refresh asks again with force; a refresh that fails keeps the rows and says why.
  await page.evaluate(() => loadFinance(true));
  assert.ok(holdingsUrls[holdingsUrls.length - 1].includes('force=1'), 'Refresh forces holdings: ' + holdingsUrls[holdingsUrls.length - 1]);
  const good = holdings;
  holdings = (route) => route.fulfill({ status: 500, json: { error: 'Torn API: down' } });
  await page.evaluate(() => loadFinance(true));
  assert.ok((await textOf('#fin-holdings')).includes('Torn API: down'), 'the failed refresh is explained');
  assert.ok(await count('#fin-hold-table tbody tr[data-item]') > 0, 'the last rows stay');
  // Torn refuses every place (HTTP 200, each place failed): each place keeps its last rows and says why.
  holdings = { at: now, places: Object.fromEntries(['inventory', 'bazaar', 'display', 'itemmarket', 'stocks'].map((k) => [k, { ok: false, error: 'Torn API: Too many requests', code: 5 }])) };
  await page.evaluate(() => loadFinance(true));
  assert.deepEqual(await holdChips(), ['all', 'inventory', 'bazaar', 'display', 'stocks'], 'the chips stay after a refused refresh');
  assert.ok(await count('#fin-hold-table tbody tr[data-item]') > 0, 'the rows stay after a refused refresh');
  const staleLine = await textOf('#fin-holdings .fin-hold-err [data-place="bazaar"]');
  assert.ok(staleLine.includes('showing the last list') && staleLine.includes('Too many requests'), 'the bazaar says why its list is old: ' + staleLine);
  holdings = good;
  // Switch off: no card, plain Allocation names, no request.
  await setFeat('finance.holdings', false);
  assert.equal(await count('#fin-holdings'), 0, 'switch off hides the card');
  assert.equal(await count('.fin-part-go'), 0, 'Allocation names are plain text');
  const asked = holdingsUrls.length;
  await page.evaluate(() => loadFinance(true));
  assert.equal(holdingsUrls.length, asked, 'no holdings request with the switch off');
  await setFeat('finance.holdings', true);
  assert.equal(await count('#fin-holdings'), 1, 'switch on shows it again');
  await page.locator('#fin-holdings [data-hold-place="all"]').click();
  assert.equal(await holdPressed(), 'all', 'a chip click selects its place');
  networth = networthData({ now });
  await page.evaluate(() => loadFinance(true));
  assert.ok(!(await textOf('#fin-holdings')).includes('showing the last list'), 'a good refresh clears the old-list marks');

  // Price effect vs trading: the Holdings Change view (`split` from /api/holdings, switch finance.priceSplit).
  await page.locator('[data-fin-period="nw"] button[data-days="30"]').click();
  holdings = { ...holdingsData({ now }), split: holdingsSplit({ now }) };
  await page.evaluate(() => loadFinance(true));
  await until(() => document.querySelectorAll('#fin-holdings [data-hold-mode]').length === 2, null, 'the Value | Change switch');
  const modePressed = () => page.evaluate(() => document.querySelector('#fin-holdings [data-hold-mode][aria-pressed="true"]')?.dataset.holdMode || null);
  assert.equal(await modePressed(), 'value', 'Value by default');
  await page.locator('#fin-holdings [data-hold-mode="change"]').click();
  assert.equal(await modePressed(), 'change', 'Change is selected');
  assert.equal(await page.evaluate(() => localStorage.getItem('tt.finance.holdingsMode')), 'change', 'the view is remembered');
  assert.equal(await count('#fin-hold-change'), 1, 'the change table');
  const since30 = await textOf('#fin-holdings .fin-hold-since');
  assert.ok(since30.includes('30D') && since30.includes('since'), 'the period and its start: ' + since30);
  const xanaxRow = await textOf('#fin-hold-change tbody tr[data-item="206"]');
  assert.ok(xanaxRow.includes('6,010') && xanaxRow.includes('4,010') && xanaxRow.includes('→'), 'Xanax quantity at the start → now: ' + xanaxRow);
  assert.ok((await textOf('#fin-hold-change tbody tr[data-item="206"]')).includes('-$80.0M'), 'the bazaar Xanax price effect: ' + xanaxRow);
  const noTie = await textOf('#fin-holdings');
  assert.ok(noTie.includes('Rest needs every place'), 'no Rest while the Item Market could not load: ' + noTie);
  assert.ok(!(await textOf('#fin-holdings .fin-hold-sum')).includes('Rest'), 'no Rest tile');
  assert.ok((await textOf('#fin-holdings .fin-hold-err [data-place="itemmarket"]')).includes('not counted'), 'the Item Market is named as not counted');
  assert.equal(await count('#fin-hold-change i'), 0, 'stored names are text, never markup');
  assert.ok((await textOf('#fin-hold-change')).includes('<i>Gone</i> Box'), 'the sold-out box is listed by its stored name');
  assert.ok((await textOf('#fin-holdings')).includes('unchanged'), 'unchanged items are counted in a note');
  await assertClean('EN holdings change');
  // Every place loaded and recorded: the networth tie.
  holdings = {
    ...holdings, places: { ...holdings.places, itemmarket: { ok: true, total: 0, rows: [] } },
    split: { ...holdings.split, starts: holdings.split.starts.map((s) => ({ ...s, places: { ...s.places, itemmarket: {} } })) },
  };
  await page.evaluate(() => loadFinance(true));
  const tieText = await textOf('#fin-holdings .fin-hold-sum');
  for (const w of ['Networth', 'Price effect', 'Rest']) assert.ok(tieText.includes(w), `tie tile ${w}: ${tieText}`);
  // One place: value change = price effect + bought / sold.
  await page.locator('#fin-holdings [data-hold-place="bazaar"]').click();
  const placeSum = await textOf('#fin-holdings .fin-hold-sum');
  for (const w of ['Value change', 'Price effect', 'Bought / sold']) assert.ok(placeSum.includes(w), `place tile ${w}: ${placeSum}`);
  assert.equal(await count('#fin-hold-change tbody tr[data-item]'), 1, 'only the bazaar Xanax moved in the bazaar');
  await page.locator('#fin-holdings [data-hold-place="all"]').click();
  // Each period picks its own start record; 1D has none from yesterday.
  await page.locator('[data-fin-period="nw"] button[data-days="7"]').click();
  assert.notEqual(await textOf('#fin-holdings .fin-hold-since'), since30, '7D starts at the later record');
  await page.locator('[data-fin-period="nw"] button[data-days="1"]').click();
  assert.ok((await textOf('#fin-holdings')).includes('No record from yesterday'), '1D without a record from yesterday');
  await assertClean('EN holdings change, 1D');
  await page.locator('[data-fin-period="nw"] button[data-days="30"]').click();
  // Torn refuses every place on a Refresh: nothing can be compared, never "Nothing changed" or +$0 tiles.
  const counted = holdings;
  holdings = { at: now, places: Object.fromEntries(['inventory', 'bazaar', 'display', 'itemmarket', 'stocks'].map((k) => [k, { ok: false, error: 'Torn API: Too many requests', code: 5 }])), split: counted.split };
  await page.evaluate(() => loadFinance(true));
  const refused = await textOf('#fin-holdings');
  assert.ok(refused.includes('Nothing to compare') && !refused.includes('Nothing changed'), 'every place refused: ' + refused);
  assert.equal(await count('#fin-holdings .fin-hold-sum'), 0, 'no +$0 tiles when nothing is counted');
  await page.locator('#fin-holdings [data-hold-place="bazaar"]').click();
  assert.equal(await count('#fin-holdings .fin-hold-sum'), 0, 'a place that is not counted has no tiles');
  assert.ok((await textOf('#fin-holdings')).includes('not counted'), 'and says why');
  await page.locator('#fin-holdings [data-hold-place="all"]').click();
  await assertClean('EN holdings change, nothing counted');
  holdings = counted;
  await page.evaluate(() => loadFinance(true));
  // No record at all yet.
  holdings = { ...holdings, split: { ...holdings.split, starts: [] } };
  await page.evaluate(() => loadFinance(true));
  assert.ok((await textOf('#fin-holdings')).includes('Building history'), 'the first day');
  // Switch off: the value view only.
  await setFeat('finance.priceSplit', false);
  assert.equal(await count('#fin-holdings [data-hold-mode]'), 0, 'switch off: no Value | Change switch');
  assert.equal(await count('#fin-hold-table'), 1, 'switch off: the value table');
  await setFeat('finance.priceSplit', true);
  holdings = { ...holdingsData({ now }), split: holdingsSplit({ now }) };
  await page.evaluate(() => loadFinance(true));
  assert.equal(await count('#fin-hold-change'), 1, 'switch on: back to the remembered Change view');

  // Company tab: P&L with this / previous / change, products in data order, chart, funds, day rows.
  await page.locator('.fin-tab[data-fin-tab="company"]').click();
  assert.equal(await selectedTab(), 'company');
  assert.equal(await pressed('co'), '7', 'Company period defaults to 7D');
  for (const head of ['This period', 'Previous', 'Change']) assert.ok((await textOf('#fin-pnl')).includes(head), 'P&L column ' + head);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.fin-products [data-product]')].map((r) => r.dataset.product)), PRODUCTS, 'one product row per product, in data order');
  assert.equal(await count('#fin-co-chart svg'), 1, 'income history chart');
  assert.equal(await count('#fin-funds svg'), 1, 'funds chart');
  assert.equal(await count('#fin-co-table tbody tr'), 7, 'seven day rows for 7D');
  await page.locator('[data-fin-period="co"] button[data-days="1"]').click();
  assert.equal(await textOf('#fin-pnl [data-row="revenue"] .fin-now'), await page.evaluate(() => money(state.company.income.revenue)), 'Last day revenue is the live figure');
  await page.locator('[data-fin-period="co"] button[data-days="all"]').click();
  assert.equal(await count('#fin-co-table tbody tr'), 40, 'All shows every day');
  assert.equal(await page.evaluate(() => localStorage.getItem('tt.finance.coPeriod')), 'all');
  await assertClean('EN company');

  // Re-renders (period clicks, the 2-minute company refresh) stop watching the charts they replace.
  await page.evaluate(() => {
    window.__watched = new Set();
    const observe = chartRO.observe.bind(chartRO), unobserve = chartRO.unobserve.bind(chartRO);
    chartRO.observe = (el) => { window.__watched.add(el); observe(el); };
    chartRO.unobserve = (el) => { window.__watched.delete(el); unobserve(el); };
  });
  for (const d of ['7', '30', 'all']) await page.locator(`[data-fin-period="co"] button[data-days="${d}"]`).click();
  await page.evaluate(() => renderCompany());
  assert.equal(await page.evaluate(() => [...window.__watched].filter((el) => el.id?.startsWith('fin-') && !el.isConnected).length), 0, 'no replaced Finance chart stays observed');

  // Keyboard: arrow keys move between tabs; income opens the Company tab.
  await page.locator('.fin-tab[data-fin-tab="company"]').focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await selectedTab(), 'wealth', 'ArrowLeft selects Networth');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.finTab), 'wealth', 'focus follows the tab');
  await page.evaluate(() => showView('income'));
  assert.equal(await selectedTab(), 'company', 'income opens the Company tab');

  // Switches and company mode. Coming back to the Networth tab asks for holdings again.
  const beforeReturn = holdingsUrls.length;
  await page.evaluate(() => LRXFinance.setTab('wealth'));
  for (let i = 0; i < 100 && holdingsUrls.length === beforeReturn; i++) await page.waitForTimeout(50);
  assert.ok(holdingsUrls.length > beforeReturn, 'coming back to the Networth tab asks for holdings again');
  await page.locator('[data-fin-period="nw"] button[data-days="30"]').click();
  await setFeat('finance.milestone', false);
  assert.equal(await count('.fin-milestone'), 0, 'milestone switch off hides the card');
  await setFeat('finance.milestone', true);
  assert.equal(await count('.fin-milestone'), 1, 'and on shows it again');
  await setFeat('page.networth', false);
  assert.equal(await count('.fin-tab'), 1, 'Networth off: one tab card');
  assert.equal(await selectedTab(), 'company', 'Networth off: the Company tab');
  await setFeat('page.networth', true);
  await page.evaluate(() => LRXFinance.setTab('company'));
  await page.evaluate(() => applyCompanyMode(false));
  assert.equal(await page.evaluate(() => state.view), 'finance', 'company mode off keeps Finance');
  assert.equal(await selectedTab(), 'wealth', 'and falls back to the Networth tab');
  assert.equal(await count('.fin-tab'), 1, 'one tab card without company mode');
  await setFeat('page.networth', false);
  assert.equal(await page.evaluate(() => state.view), 'overview', 'nothing left: the Overview opens');
  assert.equal(await page.locator('#nav .nav-item[data-view="finance"]').isHidden(), true, 'the Finance item is hidden');
  await setFeat('page.networth', true);
  assert.equal(await page.locator('#nav .nav-item[data-view="finance"]').isVisible(), true, 'and shown again');

  // A first-day player: one networth record and a company without day records.
  networth = networthData({ now, count: 1 });
  await page.evaluate((c) => { applyCompanyMode(true); state.company = c; renderCompany(); showView('networth'); }, { ...company, days: [] });
  await until(() => document.querySelectorAll('#fin-wealth .empty-state').length > 0, null, 'empty states');
  await assertClean('one record, networth');
  await page.evaluate(() => LRXFinance.setTab('company'));
  await assertClean('no days, company');
  await shot('finance-en-first-day.png');

  // A returning player: the record before today's is 20 days old, so 7D has no start record.
  const full = networthData({ now });
  networth = { ...full, history: [...full.history.slice(0, -20), full.history[full.history.length - 1]] };
  await page.evaluate(() => LRXFinance.setTab('wealth'));
  await page.evaluate(() => loadFinance(true));
  await page.locator('[data-fin-period="nw"] button[data-days="7"]').click();
  const gapText = await textOf('#fin-wealth');
  assert.ok(!gapText.includes('from day 2'), 'a returning player is not told history is just starting: ' + gapText);
  assert.ok(gapText.includes('No earlier record in this period'), 'the period empty state: ' + gapText);
  assert.equal(await count('#fin-nw-chart svg'), 0, '7D does not draw the whole history');
  await assertClean('returning player, 7D');
  await page.locator('[data-fin-period="nw"] button[data-days="30"]').click();

  // A new company: 9 flat days. On 7D only 2 days fall in the previous window; they are compared per day.
  const flat = { ...company, days: company.days.slice(-9).map((d) => ({ ...d, revenue: 100000, cogs: 40000, wages: 10000, ads: 20000, net: 30000, customers: 50, cogsEstimated: false })) };
  await page.evaluate((c) => { state.company = c; renderCompany(); LRXFinance.setTab('company'); }, flat);
  await page.locator('[data-fin-period="co"] button[data-days="7"]').click();
  assert.equal(await textOf('#fin-pnl [data-row="revenue"] .fin-delta'), '▲ 0.0%', 'the same revenue per day is no change');
  assert.ok(!(await textOf('#fin-company .fin-kpis')).includes('250'), 'the KPI does not compare 7 days with 2: ' + await textOf('#fin-company .fin-kpis'));
  assert.ok((await textOf('#fin-company .fin-coverage')).includes('2 of 7 days'), 'the previous period coverage is shown');
  await assertClean('new company, 7D');

  // Back to full data, TR, widths.
  networth = networthData({ now });
  await page.evaluate((c) => { state.company = c; renderCompany(); showView('networth'); }, company);
  await until(() => document.querySelectorAll('#fin-wealth .fin-mover').length > 0, null, 'movers again');
  await checkWidths('en');
  await page.locator('#lang-toggle [data-lang="tr"]').click();
  assert.equal(await textOf('#nav .nav-item[data-view="finance"]'), 'Finans');
  assert.equal(await textOf('#view-title'), 'Finans');
  assert.ok((await textOf('.fin-tab[data-fin-tab="company"]')).includes('Şirket'), 'TR Company tab');
  await page.evaluate(() => LRXFinance.setTab('company'));
  for (const head of ['Bu dönem', 'Önceki', 'Fark']) assert.ok((await textOf('#fin-pnl')).includes(head), 'TR P&L column ' + head);
  await assertClean('TR company');
  await page.evaluate(() => LRXFinance.setTab('wealth'));
  await assertClean('TR networth');
  await until(() => !!document.querySelector('#fin-holdings [data-hold-mode]'), null, 'TR Value | Change switch');
  assert.equal(await textOf('#fin-holdings [data-hold-mode="value"]'), 'Değer', 'TR Value');
  assert.equal(await textOf('#fin-holdings [data-hold-mode="change"]'), 'Değişim', 'TR Change');
  assert.ok((await textOf('#fin-holdings .fin-hold-sum')).includes('Fiyat etkisi'), 'TR price effect: ' + await textOf('#fin-holdings .fin-hold-sum'));
  await assertClean('TR holdings change');
  await page.locator('#fin-holdings [data-hold-mode="value"]').click();
  await until(() => !!document.querySelector('#fin-holdings #fin-hold-table'), null, 'TR holdings');
  assert.equal(await textOf('#fin-holdings .card-head h3'), 'Varlıklar', 'TR holdings title');
  assert.ok((await textOf('#fin-holdings [data-hold-place="all"]')).includes('Tümü'), 'TR All chip');
  await checkWidths('tr');

  assert.deepEqual(errors, [], 'no page errors or CSP reports');
  assert.deepEqual(tornRequests, [], 'no request to Torn');
  console.log(JSON.stringify({ ok: true, screenshots: output }));
})().catch(async (e) => {
  console.error(e);
  if (errors.length) console.error('Page errors:', errors);
  if (serverErr.trim()) console.error('Fixture server stderr:\n' + serverErr);
  await page?.screenshot({ path: path.join(output, 'finance-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
}).finally(async () => {
  try { await browser?.close(); } catch (e) { console.error('Browser close failed:', e); process.exitCode = 1; }
  finally {
    child.kill();
    await new Promise((r) => child.exitCode !== null || child.signalCode !== null ? r() : child.once('exit', r));
    const resolved = path.resolve(temp);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('lrx-finance-ui-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
});
