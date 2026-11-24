// Daily Report without its order list, and the sidebar highlight that glides between tabs (public/nav-motion.js).
// Synthetic company data only (tests/stock-fixture.js); every request that leaves the local fixture server is aborted,
// so nothing reaches Torn.
//
// DOM contract asserted here:
//   Daily Report: no #order-list, #order-total, .order-item or [data-i18n="report.orderList"], and no "Order List" /
//     "Sipariş Listesi" text. The rest is unchanged: the head with Target stock and Copy Report, five #report-kpis
//     tiles, the Sales by Product table (one tbody row per product and a tfoot total), and the copied report text
//     still ends with the restock order lines.
//   Sidebar: exactly one #nav > .nav-indicator, aria-hidden. After a tab switch (a real click or showView) it glides:
//     one CSS transition on transform of 150-250 ms, then it rests on the active .nav-item's box (±1 px) at opacity 1,
//     and the active item draws no highlight of its own (no background image or colour, no box-shadow).
//     It follows the DOM, not a list of views: when an item above the active one is hidden or shown, or a new item is
//     inserted, it moves with the active item at once (no glide); a newly added item can become active and the
//     highlight glides to it; when the active item is removed (or none is laid out) the highlight hides (opacity 0),
//     and it comes back on the next tab switch.
//   prefers-reduced-motion: reduce and body.no-anim: no glide (no transition longer than .01 ms), it lands at once.
//   Five themes: the highlight is drawn (a background) and the active item has none of its own.
//   640 px (the sidebar is a horizontal icon bar): the highlight sits on the active icon, no sideways scroll.
//   EN and TR.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { stockCompany, DEFAULT_ROWS } = require('./stock-fixture');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-report-nav-ui-'));
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ features: { 'app.splash': false, 'app.animations': true, 'app.updates': false, 'app.newYearWelcome': false } }));
const child = fork(path.join(__dirname, 'preview-server.js'), { env: { ...process.env, TORN_DATA_DIR: temp, TORN_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
let serverErr = ''; // the fixture server's stderr, printed when the smoke fails
child.stdout.resume();
child.stderr.on('data', (d) => { serverErr = (serverErr + d).slice(-20_000); });
const output = process.env.QA_OUTPUT || path.join(os.tmpdir(), 'lrx-qa-report-nav');
fs.mkdirSync(output, { recursive: true });

const PRODUCTS = DEFAULT_ROWS.map((row) => row[0]);
const THEMES = ['obsidian', 'ocean', 'forest', 'amethyst', 'light'];
const errors = [], tornRequests = [];
let browser, page;

const texts = (selector) => page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.replace(/\s+/g, ' ').trim()), selector);
const textOf = async (selector) => (await texts(selector)).join(' ');
// Waits for every running animation and transition in the sidebar (the glide, the items' colour fades).
const settle = () => page.evaluate(() => Promise.all(document.querySelector('#nav').getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {}))));
// Runs a change in the page and reports the transitions the highlight started. fn makes the change and returns
// qaRuns(), which lets the sidebar's MutationObserver react (a microtask) first. (The page CSP allows no eval, so
// each change is its own function.)
const change = (fn) => page.evaluate(fn);
const installQaRuns = () => page.evaluate(() => {
  window.qaRuns = async () => {
    await null; await null;
    const ind = document.querySelector('#nav > .nav-indicator');
    return ind ? ind.getAnimations().map((x) => ({ prop: x.transitionProperty, ms: Number(x.effect.getComputedTiming().duration) })) : [];
  };
});
const fit = () => page.evaluate(() => {
  const nav = document.querySelector('#nav'), ind = nav.querySelector(':scope > .nav-indicator'), act = nav.querySelector('.nav-item.active');
  const box = (el) => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; };
  const cs = act && getComputedStyle(act);
  return {
    indicators: nav.querySelectorAll('.nav-indicator').length,
    hiddenFromAT: ind?.getAttribute('aria-hidden'),
    ind: ind && box(ind), act: act && act.offsetParent ? box(act) : null, view: act?.dataset.view ?? null,
    opacity: ind ? getComputedStyle(ind).opacity : null,
    indBg: ind ? getComputedStyle(ind).backgroundImage + ' | ' + getComputedStyle(ind).backgroundColor : null,
    ownBg: cs ? [cs.backgroundImage, cs.backgroundColor, cs.boxShadow] : null,
  };
});
const near = (a, b) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) <= 1);
async function assertOnActive(what, view) {
  const f = await fit();
  assert.equal(f.view, view, `${what}: ${view} is the active item`);
  assert.equal(f.opacity, '1', `${what}: the highlight is shown ${JSON.stringify(f)}`);
  assert.ok(near(f.ind, f.act), `${what}: the highlight rests on the active item ${JSON.stringify(f)}`);
  assert.deepEqual(f.ownBg, ['none', 'rgba(0, 0, 0, 0)', 'none'], `${what}: the active item draws no highlight of its own`);
  return f;
}
const assertGlide = (what, runs) => {
  const t = runs.filter((r) => r.prop === 'transform');
  assert.equal(t.length, 1, `${what}: one transform transition ${JSON.stringify(runs)}`);
  assert.ok(t[0].ms >= 150 && t[0].ms <= 250, `${what}: the glide takes 150-250 ms ${JSON.stringify(runs)}`);
};
const assertNoGlide = (what, runs) => assert.ok(runs.every((r) => r.ms <= 0.01), `${what}: no transition longer than .01 ms ${JSON.stringify(runs)}`);
async function shot(name, clip) {
  await page.evaluate(() => { document.querySelector('#toast')?.classList.remove('show'); scrollTo({ top: 0, behavior: 'instant' }); });
  // Let the page's entrance animations finish (not the endless ones, such as the clock's pulse).
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
  await page.screenshot({ path: path.join(output, name), fullPage: !clip, clip });
}
// Missing data must never reach the screen as NaN, Infinity, undefined or null.
async function assertClean(what) {
  const words = await page.evaluate(() => document.querySelector('#view-report').textContent.match(/NaN|undefined|Infinity|\bnull\b/g) || []);
  assert.deepEqual(words, [], what + ': no NaN, Infinity, undefined or null on the page');
}
async function assertReport(lang) {
  const gone = await page.evaluate(() => ['#order-list', '#order-total', '.order-item', '[data-i18n="report.orderList"]'].map((s) => document.querySelectorAll(s).length));
  assert.deepEqual(gone, [0, 0, 0, 0], `${lang}: no order list, total, items or heading`);
  const all = await textOf('#view-report');
  for (const word of ['Order List', 'Sipariş Listesi']) assert.ok(!all.includes(word), `${lang}: no "${word}" on the Daily Report`);
  assert.deepEqual(await texts('#view-report .card-head h3'), [lang === 'en' ? 'Sales by Product' : 'Ürün Bazlı Satış'], `${lang}: one table card is left`);
  assert.equal(await page.locator('#report-kpis > .kpi').count(), 5, `${lang}: five KPI tiles`);
  assert.equal(await page.locator('#report-table tbody tr').count(), PRODUCTS.length, `${lang}: a table row per product`);
  assert.equal(await page.locator('#report-table tfoot tr').count(), 1, `${lang}: a totals row`);
  assert.equal(await page.locator('#copy-report').isVisible(), true, `${lang}: Copy Report`);
  assert.equal(await page.locator('#cover-days').isVisible(), true, `${lang}: Target stock`);
  const copied = await page.evaluate(() => reportText(state.company));
  assert.ok(copied.includes(lang === 'en' ? 'Restock Order (3-day target):' : 'Sipariş (3 günlük hedef):'), `${lang}: the copied report keeps its restock lines\n${copied}`);
  await assertClean(lang);
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  await context.addInitScript(() => { try { localStorage.setItem('tt.lang', 'en'); localStorage.removeItem('tt.theme'); } catch {} });
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  page.on('request', (r) => { if (/(^|\.)torn\.com$/i.test(new URL(r.url()).hostname)) tornRequests.push(r.method() + ' ' + r.url()); });
  await page.route('**/*', (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
  await page.goto(base);
  await page.locator('#auth-key').waitFor({ state: 'visible' });
  // Without a key the boot stops at the sign-in screen; open the tracker with the fixture company, animations on.
  await page.evaluate((company) => {
    document.querySelector('#auth-screen').hidden = true;
    document.body.classList.remove('auth-open', 'no-anim');
    applyCompanyMode(true); state.company = company; renderCompany(); showView('overview');
  }, stockCompany({ now: Date.now() }));
  await installQaRuns();
  await settle();

  // ---- Sidebar: one highlight, on the active item.
  let f = await assertOnActive('start', 'overview');
  assert.equal(f.indicators, 1, 'one highlight in the sidebar');
  assert.equal(f.hiddenFromAT, 'true', 'the highlight is hidden from assistive technology');

  // A real click glides it to Daily Report.
  const clickRuns = page.evaluate(() => new Promise((resolve) => {
    const ind = document.querySelector('#nav > .nav-indicator');
    ind.addEventListener('transitionrun', () => resolve(ind.getAnimations().map((x) => ({ prop: x.transitionProperty, ms: Number(x.effect.getComputedTiming().duration) }))), { once: true });
    setTimeout(() => resolve([]), 1000);
  }));
  await page.locator('#nav .nav-item[data-view="report"]').click();
  assertGlide('click Daily Report', await clickRuns);
  await page.mouse.move(1200, 900); // off the sidebar: a hovered item shifts 2 px
  await settle();
  await assertOnActive('after the click', 'report');
  await shot('report-en-1440.png');
  await shot('sidebar-report-obsidian.png', { x: 0, y: 40, width: 280, height: 760 });

  // ---- Daily Report, English.
  await assertReport('en');

  // showView glides it too, down and back up.
  assertGlide('showView employees', await change(() => { showView('employees'); return qaRuns(); }));
  await settle();
  await assertOnActive('employees', 'employees');
  assertGlide('showView stock', await change(() => { showView('stock'); return qaRuns(); }));
  await settle();
  await assertOnActive('stock', 'stock');
  await page.evaluate(() => showView('report'));
  await settle();

  // ---- It follows the DOM: hide and show an item above, insert one, make a new one active, remove it.
  assertNoGlide('an item above is hidden', await change(() => { document.querySelector('.nav-item[data-view="stock"]').hidden = true; return qaRuns(); }));
  await assertOnActive('an item above is hidden', 'report');
  assertNoGlide('it is shown again', await change(() => { document.querySelector('.nav-item[data-view="stock"]').hidden = false; return qaRuns(); }));
  await assertOnActive('it is shown again', 'report');
  assertNoGlide('a new item is inserted above', await change(() => {
    const b = document.createElement('button');
    b.className = 'nav-item'; b.dataset.view = 'qa-extra'; b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 12h16"/></svg><span>QA extra</span>';
    document.querySelector('#nav').insertBefore(b, document.querySelector('.nav-item[data-view="stock"]'));
    return qaRuns();
  }));
  await assertOnActive('a new item is inserted above', 'report');
  assertGlide('the new item becomes active', await change(() => { document.querySelectorAll('#nav .nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === 'qa-extra')); return qaRuns(); }));
  await settle();
  await assertOnActive('the new item', 'qa-extra');
  await change(() => { document.querySelector('.nav-item[data-view="qa-extra"]').remove(); return qaRuns(); });
  await settle();
  f = await fit();
  assert.equal(f.view, null, 'no active item after the active one is removed');
  assert.equal(f.opacity, '0', `the highlight hides with no active item ${JSON.stringify(f)}`);
  assertNoGlide('it comes back in place', await change(() => { showView('report'); return qaRuns(); }));
  await settle();
  await assertOnActive('back on Daily Report', 'report');

  // ---- Reduced motion: no glide, it lands at once.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assertNoGlide('reduced motion', await change(() => { showView('employees'); return qaRuns(); }));
  await settle();
  await assertOnActive('reduced motion', 'employees');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // ---- Animations off (body.no-anim): no transition at all, it is on the new item straight away.
  await page.evaluate(() => document.body.classList.add('no-anim'));
  const offRuns = await change(() => { showView('report'); return qaRuns(); });
  assert.deepEqual(offRuns, [], 'Animations off: no transition');
  await assertOnActive('Animations off', 'report');
  await page.evaluate(() => document.body.classList.remove('no-anim'));

  // ---- Five themes: the highlight is drawn, the active item has none of its own.
  for (const theme of THEMES) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await settle();
    f = await assertOnActive(`theme ${theme}`, 'report');
    assert.ok(!/^none \| rgba\(0, 0, 0, 0\)$/.test(f.indBg), `theme ${theme}: the highlight has a background ${f.indBg}`);
    // The themed label colour (themes.css) still applies to the active item.
    if (theme !== 'obsidian') {
      const colors = await page.evaluate(() => {
        const probe = document.createElement('i'); probe.style.color = 'var(--text)'; document.body.append(probe);
        const want = getComputedStyle(probe).color; probe.remove();
        return { want, got: getComputedStyle(document.querySelector('#nav .nav-item.active')).color };
      });
      assert.equal(colors.got, colors.want, `theme ${theme}: the active label uses the theme's text colour`);
    }
    if (theme === 'light') await shot('sidebar-report-light.png', { x: 0, y: 40, width: 280, height: 760 });
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'obsidian'; });

  const dock = page.locator('#dock-toggle');
  const mainWidth = () => page.locator('main.main').evaluate((el) => Math.round(el.getBoundingClientRect().width));
  await page.setViewportSize({ width: 1100, height: 540 });
  await page.waitForFunction(() => document.querySelector('#dock-toggle').getAttribute('aria-expanded') === 'false');
  const nav = page.locator('#nav');
  assert.deepEqual(await nav.evaluate((el) => [getComputedStyle(el).overflowX, getComputedStyle(el).scrollbarWidth]), ['hidden', 'none']);
  await nav.locator('[data-view="settings"]').focus();
  assert.ok(await nav.evaluate((el) => el.scrollTop > 0), 'keyboard focus can still scroll to the bottom of the dock');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === 236);
  const expandedWidth = await mainWidth();
  await dock.click();
  await page.waitForFunction(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === 64);
  assert.ok(await mainWidth() >= expandedWidth + 165, 'the compact dock returns the reclaimed space to the main view');
  assert.equal(await dock.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#nav [data-view="report"]').getAttribute('aria-current'), 'page');
  assert.equal(await page.evaluate(() => localStorage.getItem('tt.dock.collapsed')), '1');
  await page.locator('#nav [data-view="employees"]').click();
  await settle();
  await assertOnActive('compact dock', 'employees');
  await dock.click();
  await page.waitForFunction(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === 236);
  await page.evaluate(() => showView('report'));
  await settle();

  // ---- 640 px: a horizontal icon bar.
  await page.setViewportSize({ width: 640, height: 900 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await settle();
  await assertOnActive('640 px', 'report');
  assertGlide('640 px switch', await change(() => { showView('employees'); return qaRuns(); }));
  await settle();
  await assertOnActive('640 px employees', 'employees');
  const scroll = await page.evaluate(() => ({ w: innerWidth, s: document.documentElement.scrollWidth }));
  assert.ok(scroll.s <= scroll.w, `640 px: no sideways scroll ${JSON.stringify(scroll)}`);
  await dock.click();
  assert.equal(await page.locator('#nav').evaluate((el) => el.inert), true, 'collapsed navigation is skipped by keyboard input at 640 px');
  await dock.click();
  assert.equal(await page.locator('#nav').evaluate((el) => el.inert), false);
  await page.evaluate(() => showView('report'));
  await settle();
  await shot('report-en-640.png');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await settle();
  await assertOnActive('back at 1440 px', 'report');

  // ---- Turkish.
  await page.locator('#lang-toggle [data-lang="tr"]').click();
  await page.mouse.move(1200, 900);
  await settle();
  assert.ok((await textOf('#nav .nav-item[data-view="report"]')).includes('Günlük Rapor'), 'TR sidebar label');
  await assertOnActive('TR', 'report');
  await assertReport('tr');
  await shot('report-tr-1440.png');

  await page.route('**/api/overview', (route) => route.fulfill({ status: 504, json: { code: 'TIMEOUT', error: 'The Torn connection timed out.' } }));
  await page.evaluate(async () => { showView('overview'); await loadOverview(); applyLang(); });
  await page.locator('[data-overview-retry]').waitFor();
  assert.deepEqual(await texts('[data-sub="drug"], [data-sub="edu"]'), ['—', '—', '—', '—']);

  assert.deepEqual(errors, [], 'no page errors or CSP reports');
  assert.deepEqual(tornRequests, [], 'no request to Torn');
  console.log(JSON.stringify({ ok: true, assertions: ['Daily Report: no order list, total, items or heading (EN, TR)', 'head, five KPI tiles, a row per product, totals, Copy Report and Target stock unchanged', 'the copied report keeps its restock lines', 'one aria-hidden highlight in the sidebar', 'a click or showView glides it in 150-250 ms onto the active item', 'the active item draws no highlight of its own', 'hide/show/insert above: it moves with the item at once', 'a new item can become active; removing it hides the highlight; it comes back', 'reduced motion: no glide', 'Animations off: no transition', 'five themes', '640 px icon bar without sideways scroll', 'TR', 'no page errors, CSP reports or Torn requests'], screenshots: output }));
})().catch(async (e) => {
  console.error(e);
  if (errors.length) console.error('Page errors:', errors);
  if (serverErr.trim()) console.error('Fixture server stderr:\n' + serverErr);
  await page?.screenshot({ path: path.join(output, 'report-nav-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close().catch(() => {});
  child.kill();
  fs.rmSync(temp, { recursive: true, force: true });
});
