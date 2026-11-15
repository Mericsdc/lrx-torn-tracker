// Employees page: four KPI tiles, the Rehab card (only employees at addiction -8 or worse, one polite English message,
// copy only), the staff table (no Rehab column, labelled cells, card rows when narrow), TR/EN and widths 1440/1100/640.
// Synthetic data only (tests/employees-fixture.js); every request that leaves the local fixture server is aborted, so
// nothing reaches Torn.
//
// DOM contract asserted here:
//   #emp-kpis > .kpi x4 with .label Employees · Daily wages · Avg. effectiveness · Needs rehab (≤ -8).
//   #rehab-card: one [data-rehab-emp="<id>"] row per employee at -8 or worse, worst first; each row has a profile link,
//     an addiction chip and one [data-copy-rehab="<id>"] button. One .rehab-msg-box preview (the first employee's
//     message). With nobody at -8 or worse: a .rehab-clear line, no rows and no preview.
//   The copied text is always English, also in Turkish:
//     "Hi {name}, your addiction is at {addiction} right now, which lowers your work effectiveness. When you get a
//      chance, could you please fly to Switzerland and do a Rehab? Thank you!"
//   Gone everywhere: [data-rf], [data-tpl], #rehab-tpl-input, [data-send-rehab]; the old tt.rehab* localStorage keys
//     (an old custom template there never changes the message).
//   #emp-table: no "Rehab" column; tbody tr[data-emp="<id>"] per employee; every td has data-label equal to its
//     column's th text; rows at -8 or worse are tr.emp-crit; addiction cell: "-11 · Rehab" chip at -8 or worse, a
//     plain number otherwise (no "Warning" / "Clean").
//   Overview #ov-company and the nav badge (#badge-emp) count only employees at -8 or worse.
//   At 640 px the table head is display:none (rows read as cards), at 1440 px it is shown; no sideways scroll at
//   1440/1100/640 and the table fits its container.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { employeesCompany, DEFAULT_STAFF } = require('./employees-fixture');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-employees-ui-'));
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ features: { 'app.splash': false, 'app.animations': false, 'app.updates': false, 'app.newYearWelcome': false } }));
const child = fork(path.join(__dirname, 'preview-server.js'), { env: { ...process.env, TORN_DATA_DIR: temp, TORN_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
let serverErr = '';
child.stdout.resume();
child.stderr.on('data', (d) => { serverErr = (serverErr + d).slice(-20_000); });
const output = process.env.QA_OUTPUT || path.join(os.tmpdir(), 'lrx-qa-employees');
fs.mkdirSync(output, { recursive: true });

const message = (name, addiction) => `Hi ${name}, your addiction is at ${addiction} right now, which lowers your work effectiveness. When you get a chance, could you please fly to Switzerland and do a Rehab? Thank you!`;
const CRITICAL = [9000001, 9000002, 9000003];
const errors = [], tornRequests = [];
let browser, page, now;

const texts = (selector) => page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.replace(/\s+/g, ' ').trim()), selector);
const textOf = async (selector) => (await texts(selector)).join(' ');
const count = (selector) => page.locator(selector).count();
const show = (company, view = 'employees') => page.evaluate(([c, v]) => { state.company = c; renderCompany(); showView(v); }, [company, view]);
const copied = () => page.evaluate(() => window.qaCopied.slice());
const rehabIds = () => page.evaluate(() => [...document.querySelectorAll('#rehab-card [data-rehab-emp]')].map((el) => Number(el.dataset.rehabEmp)));
const heads = () => texts('#emp-table thead th');
const rows = () => page.evaluate(() => [...document.querySelectorAll('#emp-table tbody tr[data-emp]')].map((tr) => ({
  id: Number(tr.dataset.emp),
  crit: tr.classList.contains('emp-crit'),
  labels: [...tr.querySelectorAll(':scope > td')].map((td) => td.dataset.label ?? null),
  addiction: tr.querySelector('td.emp-addiction')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
})));

async function assertClean(what) {
  const found = await page.evaluate(() => {
    const view = document.querySelector('#view-employees');
    return {
      words: view.textContent.match(/NaN|undefined|Infinity|\bnull\b/g) || [],
      styles: [...view.querySelectorAll('[style]')].map((el) => el.getAttribute('style')).filter((s) => /NaN|Infinity|undefined/.test(s)),
    };
  });
  assert.deepEqual(found, { words: [], styles: [] }, what + ': no NaN, Infinity, undefined or null on the page');
}
async function assertNoOldControls(what) {
  for (const selector of ['[data-rf]', '[data-tpl]', '#rehab-tpl-input', '[data-send-rehab]']) {
    assert.equal(await count(selector), 0, `${what}: ${selector} is gone`);
  }
}
async function assertLabelled(what) {
  const columns = await heads(), list = await rows();
  assert.ok(columns.length > 0, what + ': the table has column headers');
  assert.ok(!columns.some((h) => /rehab/i.test(h)), `${what}: no Rehab column: ${JSON.stringify(columns)}`);
  for (const row of list) assert.deepEqual(row.labels, columns, `${what}: every cell of ${row.id} carries its column name as data-label`);
}
async function shot(name) {
  await page.evaluate(() => { document.querySelector('#toast')?.classList.remove('show'); scrollTo({ top: 0, behavior: 'instant' }); });
  await page.screenshot({ path: path.join(output, name), fullPage: true });
}
async function checkWidths(lang) {
  for (const width of [1440, 1100, 640]) {
    await page.setViewportSize({ width, height: 1000 });
    const fit = await page.evaluate(() => {
      const table = document.querySelector('#emp-table'), box = table?.parentElement;
      return {
        width: innerWidth, scroll: document.documentElement.scrollWidth,
        thead: table?.tHead ? getComputedStyle(table.tHead).display : 'missing',
        tableFits: !!box && box.scrollWidth <= box.clientWidth + 1,
        wide: [...document.querySelectorAll('#view-employees *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((el) => el.tagName + '.' + el.className),
      };
    });
    assert.ok(fit.scroll <= fit.width, `${lang} ${width}px: no sideways scroll ${JSON.stringify(fit)}`);
    assert.ok(fit.tableFits, `${lang} ${width}px: the staff table fits its container ${JSON.stringify(fit)}`);
    if (width === 640) assert.equal(fit.thead, 'none', `${lang} 640px: rows read as cards, the table head is not displayed`);
    if (width === 1440) assert.ok(!['none', 'missing'].includes(fit.thead), `${lang} 1440px: a table with its head (${fit.thead})`);
    await shot(`employees-${lang}-${width}.png`);
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
  // English, a recording clipboard, and the settings an older version left behind: a custom template and a filter.
  await context.addInitScript(() => {
    window.electronAPI = { tabCreate: async () => ({}) };
    window.qaCopied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.qaCopied.push(t); } } });
    try {
      localStorage.setItem('tt.lang', 'en');
      if (!sessionStorage.getItem('qa.seeded')) {
        sessionStorage.setItem('qa.seeded', '1');
        localStorage.setItem('tt.rehabTplEn', 'OLD TEMPLATE {name} {addiction}');
        localStorage.setItem('tt.rehabTplEnKey', 'custom');
        localStorage.setItem('tt.rehabFilter', 'all');
      }
    } catch {}
  });
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  page.on('request', (r) => { if (/(^|\.)torn\.com$/i.test(new URL(r.url()).hostname)) tornRequests.push(r.method() + ' ' + r.url()); });
  await page.route('**/*', (route) => (new URL(route.request().url()).origin !== base ? route.abort() : route.continue()));
  await page.goto(base);
  await page.locator('#auth-key').waitFor({ state: 'visible' });
  now = await page.evaluate(() => Date.now());
  await page.evaluate((company) => {
    document.querySelector('#auth-screen').hidden = true;
    document.body.classList.remove('auth-open');
    document.body.classList.add('no-anim');
    applyCompanyMode(true); state.company = company; renderCompany(); showView('employees');
  }, employeesCompany({ now }));

  // KPI row: four tiles; Needs rehab counts the three employees at -8 or worse.
  assert.deepEqual(await texts('#emp-kpis > .kpi .label'), ['Employees', 'Daily wages', 'Avg. effectiveness', 'Needs rehab (≤ -8)']);
  const tile = await page.evaluate(() => [...document.querySelectorAll('#emp-kpis > .kpi')].at(-1).querySelector('.value').textContent.trim());
  assert.equal(tile, '3', 'Needs rehab: 3');

  // Rehab card: only -8 or worse, worst first, one preview, copy only.
  assert.deepEqual(await rehabIds(), CRITICAL, 'rows for the three employees at -8 or worse, worst first');
  assert.equal(await count('#rehab-card [data-copy-rehab]'), 3, 'one copy button per row');
  assert.equal(await count('#rehab-card .rehab-msg-box'), 1, 'one message preview');
  assert.equal(await textOf('#rehab-card .rehab-msg-box'), message('Fixture_Ava', -11), 'the preview is the worst employee\'s message');
  assert.ok((await textOf('#rehab-card [data-rehab-emp="9000002"]')).includes('Switzerland'), 'Ben is in Switzerland: ' + await textOf('#rehab-card [data-rehab-emp="9000002"]'));
  await assertNoOldControls('EN');
  assert.deepEqual(await page.evaluate(() => ['tt.rehabTplEn', 'tt.rehabTplEnKey', 'tt.rehabFilter'].map((k) => localStorage.getItem(k))), [null, null, null], 'the old rehab settings are cleared');
  await page.locator('#rehab-card [data-copy-rehab="9000002"]').click();
  assert.deepEqual(await copied(), [message('Fixture_Ben', -9)], 'Copy puts the polite English message on the clipboard');
  assert.ok((await textOf('#toast')).includes('Fixture_Ben'), 'a toast names the employee');

  // Staff table.
  await assertLabelled('EN');
  const list = await rows();
  assert.deepEqual(list.map((r) => r.id), DEFAULT_STAFF.map((s) => s[0]), 'one row per employee, worst addiction first');
  assert.deepEqual(list.filter((r) => r.crit).map((r) => r.id), CRITICAL, 'rows at -8 or worse are marked');
  const byId = Object.fromEntries(list.map((r) => [r.id, r.addiction]));
  assert.equal(byId[9000001], '-11 · Rehab');
  assert.equal(byId[9000004], '-6', 'no Warning label');
  assert.equal(byId[9000006], '0', 'no Clean label');
  await assertClean('default fixture');

  // Overview and nav badge count only -8 or worse.
  assert.equal(await count('#ov-company [data-copy-rehab]'), 3, 'Overview: copy buttons only for -8 or worse');
  assert.equal(await textOf('#badge-emp'), '3', 'nav badge: 3');

  // Nobody at -8 or worse: one calm line.
  const calm = DEFAULT_STAFF.map((s) => [...s.slice(0, 3), Math.max(s[3], -7), ...s.slice(4)]);
  await show(employeesCompany({ now, staff: calm }));
  assert.equal(await count('#rehab-card .rehab-clear'), 1, 'empty state line');
  assert.deepEqual(await rehabIds(), [], 'no rows');
  assert.equal(await count('#rehab-card .rehab-msg-box'), 0, 'no preview');
  assert.equal(await page.evaluate(() => document.querySelector('#badge-emp').hidden), true, 'nav badge hidden');
  assert.equal(await count('#ov-company [data-copy-rehab]'), 0, 'Overview: no copy buttons');
  await assertClean('nobody at -8');
  await shot('employees-en-clear.png');

  // Widths, English.
  await show(employeesCompany({ now }));
  await checkWidths('en');

  // Turkish: Turkish labels, the copied message stays English.
  await page.locator('#lang-toggle [data-lang="tr"]').click();
  const trHeads = await heads();
  for (const head of ['Çalışan', 'Durum']) assert.ok(trHeads.some((h) => h.includes(head)), `TR header ${head}: ${JSON.stringify(trHeads)}`);
  assert.ok((await textOf('#rehab-card h3')).includes('Rehab gerekenler'), 'TR title: ' + await textOf('#rehab-card h3'));
  assert.equal(await textOf('#rehab-card .rehab-msg-box'), message('Fixture_Ava', -11), 'TR: the preview stays English');
  await page.locator('#rehab-card [data-copy-rehab="9000003"]').click();
  assert.deepEqual((await copied()).at(-1), message('Fixture_Cleo', -8), 'TR: the copied message stays English');
  await assertNoOldControls('TR');
  await assertLabelled('TR');
  await assertClean('TR');
  await checkWidths('tr');

  assert.deepEqual(errors, [], 'no page errors or CSP reports');
  assert.deepEqual(tornRequests, [], 'no request to Torn');
  console.log(JSON.stringify({ ok: true, assertions: ['four KPI tiles, Needs rehab 3', 'rehab rows only at -8 or worse, worst first', 'one English preview', 'Switzerland status', 'no filter, templates, template box or Send buttons', 'old tt.rehab* settings cleared', 'Copy puts the exact polite message on the clipboard', 'table: no Rehab column, labelled cells, crit rows, plain addiction numbers', 'Overview and nav badge count only -8 or worse', 'empty state', 'TR labels, English message', 'widths 1440/1100/640 in EN and TR without sideways scroll; cards at 640', 'no page errors, CSP reports or Torn requests'], screenshots: output }));
})().catch(async (e) => {
  console.error(e);
  if (errors.length) console.error('Page errors:', errors);
  if (serverErr.trim()) console.error('Fixture server stderr:\n' + serverErr);
  await page?.screenshot({ path: path.join(output, 'employees-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
}).finally(async () => {
  try { await browser?.close(); } catch (e) { console.error('Browser close failed:', e); process.exitCode = 1; }
  finally {
    child.kill();
    await new Promise((r) => child.exitCode !== null || child.signalCode !== null ? r() : child.once('exit', r));
    const resolved = path.resolve(temp);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('lrx-employees-ui-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
});
