// Gym & Stats page (renderGym in public/features.js): four KPI tiles, a "Your stats" card beside a short chart, the
// day-by-day table collapsed, TR/EN and widths 1440/1100/760/520. Synthetic data only: /api/stats is routed to the
// fixture below and every request that leaves the local fixture server is aborted, so nothing reaches Torn.
//
// DOM contract asserted here:
//   #gym-body .gym-kpis > .kpi x4: Total battle stats · Since yesterday · Last 7 days · Last 30 days.
//   #gym-stats: .storage-bar > i x4; tbody tr[data-stat] for str, def, spd, dex with name, value, share, 24h, 7 days.
//     #gym-foot: [data-gym="energy"] "Energy 120/150" (from state.overview, no request); [data-gym="usage"]
//     "Last 7 days: Xanax 11 · Refills 7". No records: "No records yet" and no day table.
//   #gym-chart svg: 150-200 px tall at every width; the area fill is not stroked; x labels inside the SVG and apart;
//     y labels distinct. Under 2 records: a "Building history" box and no SVG.
//   details#gym-days: closed by default, up to 30 rows, newest first; its open state is remembered in
//     localStorage "tt.gym.days" and survives a re-render.
//   At 1440 px the stats card and the chart card share a top edge and #gym-body is under 700 px tall (table closed);
//   at 760 px the chart card sits below the stats card; no sideways page scroll at any width.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { buildBattleStats } = require('../src/server/battle-stats');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-gym-ui-'));
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ features: { 'app.splash': false, 'app.animations': false, 'app.updates': false, 'app.newYearWelcome': false } }));
const child = fork(path.join(__dirname, 'preview-server.js'), { env: { ...process.env, TORN_DATA_DIR: temp, TORN_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
let serverErr = '';
child.stdout.resume();
child.stderr.on('data', (d) => { serverErr = (serverErr + d).slice(-20_000); });
const output = process.env.QA_OUTPUT || path.join(os.tmpdir(), 'lrx-qa-gym');
fs.mkdirSync(output, { recursive: true });

// 32 days ending 2026-11-14, with two days the app did not run (30 records). Daily gains: STR 2,200-3,800, DEF 900,
// SPD 1,500-2,700, DEX 400; Xanax 1 or 2 a day, 1 refill a day.
function history() {
  const out = []; let s = { str: 1180000, def: 960000, spd: 1060000, dex: 860000 }; let xan = 760, refills = 30;
  const end = Date.parse('2026-11-14T00:00:00Z');
  for (let i = 31; i >= 0; i--) {
    if (i === 9 || i === 10) continue;
    const date = new Date(end - i * 86400000).toISOString().slice(0, 10);
    s = { str: s.str + 2200 + (i % 3) * 800, def: s.def + 900, spd: s.spd + 1500 + (i % 4) * 400, dex: s.dex + 400 };
    xan += i % 2 ? 1 : 2; refills += 1;
    out.push({ date, ...s, total: s.str + s.def + s.spd + s.dex, xantaken: xan, refills, edrinks: 40, enhancers: 0, at: 0 });
  }
  return out;
}
const BATTLE = buildBattleStats({ strength: 1250000, defense: 980000, speed: 1100000, dexterity: 870000 }); // total 4,200,000
const FULL = { history: history(), battle: BATTLE };
// The latest overview reply (as in tests/overview-ui-smoke.js), with 120/150 energy.
const OVERVIEW = () => ({
  player: { id: 3000001, name: 'Fixture', level: 20, status: { state: 'Okay', description: 'Okay', color: 'green' }, job: { position: 'None', company_id: 0, job: 'None' }, faction: { faction_id: 0 } },
  serverTime: Math.floor(Date.now() / 1000), battle: BATTLE,
  bars: { energy: { current: 120, maximum: 150, fulltime: 900 }, nerve: { current: 35, maximum: 60, fulltime: 3600 }, happy: { current: 3500, maximum: 5000, fulltime: 7200 }, life: { current: 2400, maximum: 3000, fulltime: 1200 }, chain: { current: 0 } },
  cooldowns: { drug: 0, booster: 0, medical: 0 },
  drug: { cooldown: 0, xanaxActive: false, xanToday: 0, xantaken: 812, refills: 40 },
  education: { timeLeft: 0, currentId: 0, current: null, completed: 20, totalCourses: 100 },
  bank: null,
});
const flat = (a, b) => ({ str: 1270000, def: 987000, spd: 1123000, dex: 872000 - a + b, total: 4252000 - a + b });
let stats = FULL;
const errors = [], tornRequests = [];
let browser, page;

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const texts = (selector) => page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.replace(/\s+/g, ' ').trim()), selector);
const textOf = async (selector) => (await texts(selector)).join(' ');
const count = (selector) => page.locator(selector).count();
async function render(data) {
  stats = data;
  await page.evaluate(() => { document.querySelector('#gym-body').innerHTML = ''; return loadGym(); });
  await page.locator('#gym-body .kpi').first().waitFor();
}
const chart = () => page.evaluate(() => {
  const svg = document.querySelector('#gym-chart svg');
  if (!svg) return null;
  const r = svg.getBoundingClientRect(), H = svg.viewBox.baseVal.height;
  const box = (t) => { const b = t.getBoundingClientRect(); return { text: t.textContent, left: b.left - r.left, right: b.right - r.left }; };
  const all = [...svg.querySelectorAll('text')];
  const area = svg.querySelector('path[fill^="url("]');
  return {
    w: r.width, h: r.height,
    x: all.filter((t) => Number(t.getAttribute('y')) > H - 20).map(box).sort((a, b) => a.left - b.left),
    y: all.filter((t) => Number(t.getAttribute('y')) <= H - 20).map(box),
    areaStroke: area ? getComputedStyle(area).stroke : 'missing',
  };
});
async function assertChart(what, { points = true } = {}) {
  const c = await chart();
  if (!points) {
    assert.equal(c, null, what + ': no chart under 2 records');
    assert.ok((await textOf('#gym-chart')).length > 0, what + ': the chart card explains why it is empty');
    return;
  }
  assert.ok(c, what + ': a chart');
  assert.ok(c.h >= 150 && c.h <= 200, `${what}: the chart is 150-200 px tall (${c.h})`);
  assert.equal(c.areaStroke, 'none', what + ': the area fill has no outline');
  assert.ok(c.x.length >= 2, what + ': date labels');
  for (const l of [...c.x, ...c.y]) assert.ok(l.left >= -0.5 && l.right <= c.w + 0.5, `${what}: label "${l.text}" inside the chart ${JSON.stringify(l)} w=${c.w}`);
  for (let i = 1; i < c.x.length; i++) assert.ok(c.x[i - 1].right <= c.x[i].left, `${what}: date labels apart: ${JSON.stringify(c.x.slice(i - 1, i + 1))}`);
  const ys = c.y.map((l) => l.text);
  assert.equal(new Set(ys).size, ys.length, `${what}: y labels distinct: ${JSON.stringify(ys)}`);
}
const boxes = () => page.evaluate(() => {
  const b = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
  return { stats: b(document.querySelector('#gym-stats')), chart: b(document.querySelector('#gym-chart').closest('.card')), body: Math.round(document.querySelector('#gym-body').getBoundingClientRect().height) };
});
async function assertClean(what) {
  const found = await page.evaluate(() => {
    const view = document.querySelector('#view-gym');
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
async function checkWidths(lang, widths) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(150); // the chart redraws for its new width
    const fit = await page.evaluate(() => ({
      width: innerWidth, scroll: document.documentElement.scrollWidth,
      wide: [...document.querySelectorAll('#view-gym *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1 && !el.closest('.tbl-wrap')).slice(0, 6).map((el) => el.tagName + '.' + el.className),
    }));
    assert.ok(fit.scroll <= fit.width, `${lang} ${width}px: no sideways scroll ${JSON.stringify(fit)}`);
    await assertChart(`${lang} ${width}px`);
    const b = await boxes();
    if (width === 1440) {
      assert.ok(Math.abs(b.stats.top - b.chart.top) <= 1, `${lang} 1440px: stats and chart side by side ${JSON.stringify(b)}`);
      assert.ok(b.body < 700, `${lang} 1440px: the page body is under 700 px with the table closed (${b.body})`);
    }
    if (width <= 760) assert.ok(b.chart.top >= b.stats.bottom - 1, `${lang} ${width}px: the chart sits below the stats ${JSON.stringify(b)}`);
    await shot(`gym-${lang}-${width}.png`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(150);
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
  await page.route('**/*', (route) => (new URL(route.request().url()).origin !== base ? route.abort() : route.continue()));
  await page.route((url) => url.pathname === '/api/stats', (route) => route.fulfill({ json: stats }));
  // The energy line reads the overview the app already holds; it arrives through the real loadOverview() path.
  await page.route((url) => url.pathname === '/api/overview', (route) => route.fulfill({ json: OVERVIEW() }));
  await page.goto(base);
  await page.locator('#auth-key').waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    document.querySelector('#auth-screen').hidden = true;
    document.body.classList.remove('auth-open');
    document.body.classList.add('no-anim');
    await loadOverview(true);
    showView('gym');
  });
  await page.locator('#gym-body .kpi').first().waitFor();

  // Key numbers first: four tiles.
  assert.deepEqual(await texts('#gym-body .gym-kpis > .kpi .label'), ['Total battle stats', 'Since yesterday', 'Last 7 days', 'Last 30 days']);
  assert.deepEqual(await texts('#gym-body .gym-kpis > .kpi .value'), ['4,252,000', '+5,000', '+43,400', '+179,200']);
  assert.ok((await textOf('#gym-body .gym-kpis > .kpi:nth-child(3) .hint')).includes('daily avg 6,200'), 'the 7-day tile keeps its daily average');

  // Your stats: distribution bar, per-stat values, shares and gains, then energy and 7-day usage.
  assert.equal(await count('#gym-stats .storage-bar > i'), 4, 'one distribution segment per stat');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#gym-stats tbody tr[data-stat]')].map((tr) => tr.dataset.stat)), ['str', 'def', 'spd', 'dex']);
  assert.deepEqual(await texts('#gym-stats tr[data-stat="str"] > td'), ['Strength', '1,270,000', '29.9%', '+2,200', '+20,200']);
  assert.deepEqual(await texts('#gym-stats tr[data-stat="dex"] > td'), ['Dexterity', '872,000', '20.5%', '+400', '+2,800']);
  assert.equal(norm(await textOf('#gym-foot [data-gym="energy"]')), 'Energy 120/150');
  assert.equal(norm(await textOf('#gym-foot [data-gym="usage"]')), 'Last 7 days: Xanax 11 · Refills 7');

  // The day-by-day table: collapsed, newest first, its open state remembered across a re-render.
  assert.equal(await page.evaluate(() => document.querySelector('#gym-days')?.tagName), 'DETAILS');
  assert.equal(await page.evaluate(() => document.querySelector('#gym-days').open), false, 'closed by default');
  assert.equal(await count('#gym-days tbody tr'), 30, 'all 30 records are still there');
  assert.equal(await textOf('#gym-days tbody tr:first-child td:first-child'), '2026-11-14', 'newest first');
  await assertClean('EN');
  await checkWidths('en', [1440, 1100, 760, 520]);

  await page.locator('#gym-days > summary').click();
  await page.waitForFunction(() => localStorage.getItem('tt.gym.days') === '1');
  await render(FULL);
  assert.equal(await page.evaluate(() => document.querySelector('#gym-days').open), true, 'stays open after a re-render');
  await shot('gym-en-1440-days-open.png');
  await page.locator('#gym-days > summary').click();
  await page.waitForFunction(() => localStorage.getItem('tt.gym.days') === '0');

  // Turkish.
  await page.locator('#lang-toggle [data-lang="tr"]').click();
  await page.waitForFunction(() => document.querySelector('#gym-body .gym-kpis .kpi .label')?.textContent.includes('Toplam'));
  assert.deepEqual(await texts('#gym-body .gym-kpis > .kpi .label'), ['Toplam battle stat', 'Dünden beri', '7 günde', '30 günde']);
  assert.equal(norm(await textOf('#gym-foot [data-gym="energy"]')), 'Enerji 120/150');
  assert.equal(norm(await textOf('#gym-foot [data-gym="usage"]')), 'Son 7 gün: Xanax 11 · Refill 7');
  assert.ok((await textOf('#gym-days > summary')).includes('Gün gün'), 'TR day table title');
  await assertClean('TR');
  await checkWidths('tr', [1440, 520]);
  await page.locator('#lang-toggle [data-lang="en"]').click();
  await page.waitForFunction(() => document.querySelector('#gym-body .gym-kpis .kpi .label')?.textContent.includes('Total'));

  // A nearly flat pair of records: distinct y labels, all inside the chart.
  await render({ history: [{ date: '2026-11-13', ...flat(0, 0) }, { date: '2026-11-14', ...flat(0, 300) }], battle: BATTLE });
  await assertChart('flat');
  await assertClean('flat');

  // One record: no chart yet, every gain is a dash.
  await render({ history: FULL.history.slice(-1), battle: BATTLE });
  await assertChart('one record', { points: false });
  assert.deepEqual(await texts('#gym-stats tr[data-stat="str"] > td'), ['Strength', '1,270,000', '29.9%', '—', '—']);
  await assertClean('one record');
  await shot('gym-en-1440-one-record.png');

  // Older records without Xanax / refill counts.
  await render({ history: FULL.history.map((r) => ({ ...r, xantaken: null, refills: null })), battle: BATTLE });
  assert.equal(norm(await textOf('#gym-foot [data-gym="usage"]')), 'Last 7 days: Xanax — · Refills —');
  assert.ok((await texts('#gym-days tbody tr td:last-child')).every((t) => t === '—'), 'the day table shows a dash for Xanax');
  await assertClean('no usage counts');

  // A fresh install: no records, the total from the latest overview.
  await render({ history: [], battle: BATTLE });
  assert.deepEqual(await texts('#gym-body .gym-kpis > .kpi .value'), ['4,200,000', '—', '—', '—']);
  assert.ok((await textOf('#gym-stats')).includes('No records yet'), 'the stats card says there are no records yet');
  assert.equal(await count('#gym-days'), 0, 'no day table without records');
  await assertChart('no records', { points: false });
  await assertClean('no records');
  await shot('gym-en-1440-empty.png');

  assert.deepEqual(errors, [], 'no page errors or CSP reports');
  assert.deepEqual(tornRequests, [], 'no Torn requests');
  console.log(JSON.stringify({ ok: true, assertions: ['four KPI tiles with values', 'stats card: bar, per-stat values, shares, 24h and 7-day gains', 'energy and 7-day Xanax/refills', 'chart 150-200 px, no area outline, labels inside and apart, distinct y labels', 'day table collapsed, 30 rows, open state remembered', 'side by side at 1440, stacked at 760, no sideways scroll at 1440/1100/760/520', 'TR labels', 'flat, one-record, no-usage and no-record data', 'no page errors or Torn requests'], screenshots: output }));
})().catch(async (e) => {
  console.error(e);
  if (errors.length) console.error('Page errors:', errors);
  if (serverErr) console.error('Server stderr:', serverErr);
  await page?.screenshot({ path: path.join(output, 'gym-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
}).finally(async () => {
  try { await browser?.close(); } catch (e) { console.error('Browser close failed:', e); process.exitCode = 1; }
  finally {
    child.kill();
    await new Promise((r) => child.exitCode !== null || child.signalCode !== null ? r() : child.once('exit', r));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
