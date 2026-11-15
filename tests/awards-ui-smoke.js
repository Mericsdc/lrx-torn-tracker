// Merit Tracker page: the Easy wins card, the "Show" groups with how-to lines, higher tiers, empty-list reasons,
// TR/EN and widths 1440/640. Synthetic /api/awards data only; every request that leaves the local fixture server is
// aborted, so nothing reaches Torn.
//
// DOM contract asserted here:
//   #awards-body .kpi: Honors · Medals · Total awards · Almost done (count-group next tiers at 75 %+).
//   #aw-easy: columns [data-easy="count|time|once"] with .aw-easy-item[data-award-id] (name, .aw-how); an empty
//     column shows .aw-easy-empty.
//   Controls: #aw-show (all|count|time|once|record|long|event), #aw-kind, #aw-type, #aw-q, #aw-tiers (higher tiers).
//     No "Only with progress".
//   Rows: .aw-row[data-award-id] with b.aw-name, .aw-how and a place button [data-open-url] when the page is known.
//   #aw-count: "N missing awards · M higher tiers hidden"; an empty list shows .aw-empty with the reason and, when
//     kind/type/search emptied it, #aw-clear (resets them, keeps the group).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-awards-ui-'));
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ features: { 'app.splash': false, 'app.animations': false, 'app.updates': false, 'app.newYearWelcome': false } }));
const child = fork(path.join(__dirname, 'preview-server.js'), { env: { ...process.env, TORN_DATA_DIR: temp, TORN_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
let serverErr = '';
child.stdout.resume();
child.stderr.on('data', (d) => { serverErr = (serverErr + d).slice(-20_000); });
const output = process.env.QA_OUTPUT || path.join(os.tmpdir(), 'lrx-qa-awards');
fs.mkdirSync(output, { recursive: true });

const TIME = new Date('2026-11-14T12:00:00Z'); // the day before 15 November (Torniversary)
let id = 1;
const aw = (o) => {
  const a = { id: id++, kind: 'honor', name: 'Award', description: '', type: '', rarity: '', circulation: 0, owned: false, goal: null, cur: null, pct: null, stat: null, what: null, ...o };
  if (a.goal != null && a.cur != null) a.pct = Math.min(1, a.cur / a.goal);
  return a;
};
const AWARDS = [
  aw({ name: 'Looting Luminary', description: 'Commit 4,000 Theft offenses', type: 'crime', stat: 'crimes.offenses.theft', what: 'Theft', goal: 4000, cur: 3829, circulation: 100591 }),
  aw({ name: 'Act Of Faith', description: 'Achieve 100 finishing hits with SMGs', type: 'weapons', stat: 'finishing_hits.sub_machine_guns', what: 'SMGs', goal: 100, cur: 92, circulation: 66281 }),
  aw({ name: 'Fraudster', description: 'Commit 100 Fraud offenses', type: 'crime', stat: 'crimes.offenses.fraud', what: 'Fraud', goal: 100, cur: 2, circulation: 50000 }),
  aw({ kind: 'medal', name: 'One Year of Service', description: 'Live in Torn for one year', type: 'commitment', stat: 'age', goal: 365, cur: 326, circulation: 387758 }),
  aw({ kind: 'medal', name: 'Two Years of Service', description: 'Live in Torn for two years', type: 'commitment', stat: 'age', goal: 730, cur: 326, circulation: 300000 }),
  aw({ name: 'Torniversary', description: 'Login on November 15th', type: 'commitment', circulation: 176128 }),
  aw({ name: 'Protege', description: 'Complete the mission Introduction: Duke', type: 'missions', circulation: 275340 }),
  aw({ name: 'Gone Fishing', description: 'Be defeated by a trout', type: 'weapons', circulation: 193957 }),
  aw({ name: 'RNG', description: 'Who knows?', type: 'misc', circulation: 51226 }),
  aw({ name: 'Blood Money', description: 'Make $1,000,000 from a single mugging', type: 'attacking', stat: 'attacking.networth.largest_mug', goal: 1_000_000, cur: 826_937, circulation: 100647 }),
  aw({ kind: 'medal', name: 'Level Forty Five', description: 'Reach level Forty Five', type: 'level', stat: 'level', goal: 45, cur: 42, circulation: 68973 }),
  aw({ name: 'Half Way There', description: 'Reach level 50', type: 'level', stat: 'level', goal: 50, cur: 42, circulation: 58957 }),
  aw({ kind: 'medal', name: 'Level Fifty', description: 'Reach level Fifty', type: 'level', stat: 'level', goal: 50, cur: 42, circulation: 58955 }),
  aw({ kind: 'medal', name: 'Master', description: 'Reach the rank of Master', type: 'rank', stat: 'rank', what: 'Master', goal: 16, cur: 15, circulation: 68009 }),
  aw({ name: 'Globule', description: 'Purchased from Token Shop or Points Building', type: 'competitions', circulation: 42902 }),
  aw({ name: 'Sports Bachelor', description: 'Complete all classes in Sports Science', type: 'education', circulation: 98494 }),
  aw({ name: 'Owned Thing', description: 'Commit 100 Theft offenses', type: 'crime', owned: true, circulation: 500000 }),
];
const FIXTURE = { awards: AWARDS, totals: { honors: [1, 11], medals: [0, 6], awards: 1 }, at: TIME.getTime() };
const MISSING = AWARDS.filter((a) => !a.owned).length; // 16
const errors = [], tornRequests = [];
let browser, page;

const clean = (s) => s.replace(/\s+/g, ' ').trim();
const texts = (selector) => page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.replace(/\s+/g, ' ').trim()), selector);
const textOf = async (selector) => (await texts(selector)).join(' ');
const rowNames = () => texts('#awards-body .aw-row b.aw-name');
const easy = (col) => page.evaluate((c) => [...document.querySelectorAll(`#aw-easy [data-easy="${c}"] .aw-easy-item`)].map((el) => ({
  name: el.querySelector('.aw-name')?.textContent.trim(), how: el.querySelector('.aw-how')?.textContent.replace(/\s+/g, ' ').trim(),
})), col);
const kpis = () => page.evaluate(() => [...document.querySelectorAll('#awards-body .kpi')].map((k) => ({
  label: k.querySelector('.label')?.textContent.trim(), value: k.querySelector('.value')?.textContent.replace(/\s+/g, ' ').trim(),
})));
// The page has rendered in the given language (the toggle refetches /api/awards before it repaints)
async function settle(title = 'Easy wins') { await page.waitForFunction((t) => document.querySelector('#aw-easy h3')?.textContent.includes(t), title); }
async function assertClean(what) {
  const found = await page.evaluate(() => {
    const view = document.querySelector('#view-awards');
    return { words: view.textContent.match(/NaN|undefined|Infinity|\bnull\b/g) || [],
      styles: [...view.querySelectorAll('[style]')].map((el) => el.getAttribute('style')).filter((s) => /NaN|Infinity|undefined/.test(s)) };
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
    const fit = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      wide: [...document.querySelectorAll('#view-awards *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((el) => el.tagName + '.' + el.className) }));
    assert.ok(fit.scroll <= fit.width, `${lang} ${width}px: no sideways scroll ${JSON.stringify(fit)}`);
    await shot(`awards-${lang}-${width}.png`);
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
    if (url.pathname === '/api/awards') return route.fulfill({ json: FIXTURE });
    return route.continue();
  });
  await page.clock.install({ time: TIME });
  await page.goto(base);
  await page.locator('#auth-key').waitFor({ state: 'visible' });
  await page.evaluate(() => {
    document.querySelector('#auth-screen').hidden = true;
    document.body.classList.remove('auth-open');
    document.body.classList.add('no-anim');
    showView('awards');
  });
  await settle();

  // The old checkbox is gone.
  assert.ok(!(await textOf('#view-awards')).includes('Only with progress'), 'no "Only with progress"');
  assert.equal(await page.locator('#aw-prog').count(), 0, 'no #aw-prog checkbox');

  // KPI: Almost done counts Theft 96 % and SMG 92 % (Blood Money is a record, Master is long-term).
  const k = await kpis();
  assert.deepEqual(k.map((x) => x.label), ['Honors', 'Medals', 'Total awards', 'Almost done']);
  assert.equal(k[3].value.split(' ')[0], '2', 'Almost done = 2: ' + JSON.stringify(k[3]));

  // Easy wins: closest counters, what comes by itself soon, popular one-time honors.
  const ec = await easy('count');
  assert.deepEqual(ec.map((x) => x.name), ['Looting Luminary', 'Act Of Faith', 'Fraudster']);
  assert.equal(ec[0].how, 'Commit 171 more Theft offenses.');
  assert.deepEqual((await easy('time')).map((x) => x.name), ['Torniversary', 'One Year of Service']);
  assert.ok((await easy('time'))[0].how.includes('tomorrow'), 'Torniversary: log in tomorrow');
  assert.deepEqual((await easy('once')).map((x) => x.name), ['Protege', 'Gone Fishing']);

  // The list: grouped order, every row has a how-line, higher tiers hidden and counted.
  const names = await rowNames();
  assert.equal(names[0], 'Looting Luminary', 'closest counter first: ' + JSON.stringify(names));
  assert.ok(names.includes('Level Forty Five') && !names.includes('Half Way There') && !names.includes('Two Years of Service'), 'higher tiers hidden: ' + JSON.stringify(names));
  assert.ok(!names.includes('Owned Thing'), 'owned awards are not listed');
  assert.equal(names.length, MISSING - 3, 'all missing but 3 higher tiers');
  assert.match(await textOf('#aw-count'), /13 missing awards · 3 higher tiers hidden/);
  const hows = await page.evaluate(() => [...document.querySelectorAll('#awards-body .aw-row')].map((r) => r.querySelector('.aw-how')?.textContent.trim() || ''));
  assert.ok(hows.every((h) => h.length > 0), 'every row has a how-line');
  assert.equal(await page.locator('.aw-row:has(b.aw-name:text-is("Looting Luminary")) [data-open-url="https://www.torn.com/page.php?sid=crimes"]').count(), 1, 'Theft links the Crimes page');
  // English: Torn's own text is the one-time line (no second copy under it); a counted row keeps Torn's text under the line.
  const row = (name, sel) => page.evaluate(([n, s]) => {
    const r = [...document.querySelectorAll('#awards-body .aw-row')].find((x) => x.querySelector('b.aw-name')?.textContent.trim() === n);
    const el = r?.querySelector(s);
    return el ? { text: el.textContent.replace(/\s+/g, ' ').trim(), title: el.getAttribute('title') } : null;
  }, [name, sel]);
  assert.equal((await row('Protege', '.aw-how')).text, 'Complete the mission Introduction: Duke');
  assert.equal(await row('Protege', '.aw-desc'), null, 'EN one-time row: no second copy of Torn\'s text');
  assert.equal((await row('Looting Luminary', '.aw-desc')).text, 'Commit 4,000 Theft offenses');
  assert.equal((await row('Looting Luminary', '.aw-type')).text, 'Crime', 'EN type label');
  await assertClean('EN all');
  await checkWidths('en');

  // Show groups.
  await page.selectOption('#aw-show', 'record');
  assert.deepEqual(await rowNames(), ['Blood Money']);
  await page.selectOption('#aw-show', 'event');
  assert.deepEqual(await rowNames(), ['Globule']);
  await page.selectOption('#aw-show', 'once');
  assert.deepEqual(await rowNames(), ['Protege', 'Gone Fishing', 'RNG']);

  // A search that empties a group says the filters did it; Clear filters brings the group back.
  await page.selectOption('#aw-show', 'record');
  await page.fill('#aw-q', 'zebra');
  assert.equal(clean(await textOf('#awards-body .aw-empty')).startsWith('No award matches these filters.'), true, await textOf('#awards-body .aw-empty'));
  await page.click('#aw-clear');
  assert.deepEqual(await rowNames(), ['Blood Money'], 'Clear filters keeps the group');
  assert.equal(await page.inputValue('#aw-q'), '', 'search cleared');
  assert.equal(await page.inputValue('#aw-show'), 'record', 'group kept');

  // A group with nothing in it says why, without a Clear button.
  await page.evaluate(() => { awardState.data.awards = awardState.data.awards.filter((a) => a.name !== 'Blood Money'); renderAwards(); });
  assert.equal(clean(await textOf('#awards-body .aw-empty')), 'No missing personal-best award.');
  assert.equal(await page.locator('#aw-clear').count(), 0, 'no Clear filters when no filter is set');

  // Higher tiers switch.
  await page.selectOption('#aw-show', 'all');
  await page.check('#aw-tiers');
  assert.ok((await rowNames()).includes('Half Way There'), 'tiers on: higher tiers listed');
  assert.ok(!(await textOf('#aw-count')).includes('hidden'), 'tiers on: nothing hidden');
  await page.uncheck('#aw-tiers');

  // Turkish.
  await page.locator('#lang-toggle [data-lang="tr"]').click();
  await settle('Kolay kazanımlar');
  const tk = await kpis();
  assert.deepEqual(tk.map((x) => x.label), ['Honor\'lar', 'Madalyalar', 'Toplam ödül', 'Bitmek üzere']);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#aw-kind option')].map((o) => o.textContent.trim())),
    ['Honor + Madalya', 'Honor\'lar', 'Madalyalar']);
  assert.equal(await page.locator('.aw-row:has(b.aw-name:text-is("One Year of Service")) .chip.orange').textContent(), 'Madalya');
  assert.ok((await textOf('#aw-easy h3')).includes('Kolay kazanımlar'), 'TR card title');
  const tc = await easy('count');
  assert.equal(tc[0].how, 'Hırsızlık (Theft) türünde 171 suç daha işle.');
  assert.ok((await easy('time'))[0].how.includes('Yarın'), 'TR Torniversary: Yarın');
  assert.equal((await easy('once'))[0].how, '“Introduction: Duke” görevini tamamla.');
  // Turkish: no English sentence on screen. Torn's own text moves to the how-line's tooltip; labels are Turkish.
  assert.equal(await page.locator('#awards-body .aw-desc').count(), 0, 'TR: no English Torn text under the rows');
  assert.equal((await row('Protege', '.aw-how')).title, 'Torn: Complete the mission Introduction: Duke');
  assert.equal((await row('Looting Luminary', '.aw-how')).title, 'Torn: Commit 4,000 Theft offenses');
  assert.equal((await row('Looting Luminary', '.aw-type')).text, 'Suç', 'TR type label');
  assert.equal((await row('Looting Luminary', '.aw-place')).text, 'Suçlar ↗', 'TR place button');
  assert.ok((await page.evaluate(() => [...document.querySelectorAll('#aw-type option')].map((o) => o.textContent.trim()))).includes('Suç'), 'TR type filter');
  const trHows = await texts('#awards-body .aw-how, #aw-easy .aw-how');
  assert.deepEqual(trHows.filter((h) => /Do it once|Bir kez yap|more to go|ülkesine/.test(h)), [], 'TR how-lines are Turkish');
  assert.match(await textOf('#aw-count'), /13 eksik ödül · 3 üst kademe gizli/);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#aw-show option')].map((o) => o.textContent.trim())),
    ['Tüm eksikler', 'Sayaçlı işler', 'Zamanla gelir', 'Tek seferlik', 'Kişisel rekor', 'Uzun vadeli', 'Etkinlik / mağaza']);
  await assertClean('TR all');
  await checkWidths('tr');

  assert.deepEqual(errors, [], 'no page errors or CSP reports');
  assert.deepEqual(tornRequests, [], 'no request to Torn');
  console.log(JSON.stringify({ ok: true, assertions: ['no Only with progress', 'KPI Almost done = 2', 'Easy wins: counters, time, one-time', 'grouped order with how-lines, higher tiers hidden and counted', 'Theft links Crimes', 'Show groups record/event/once', 'filtered empty reason + Clear filters keeps the group', 'empty group reason without Clear', 'higher tiers switch', 'TR texts', 'widths 1440/1100/640 EN and TR', 'no page errors or Torn requests'], screenshots: output }));
})().catch(async (e) => {
  console.error(e);
  if (errors.length) console.error('Page errors:', errors);
  if (serverErr.trim()) console.error('Fixture server stderr:\n' + serverErr);
  await page?.screenshot({ path: path.join(output, 'awards-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
}).finally(async () => {
  try { await browser?.close(); } catch (e) { console.error('Browser close failed:', e); process.exitCode = 1; }
  finally {
    child.kill();
    await new Promise((r) => (child.exitCode !== null || child.signalCode !== null ? r() : child.once('exit', r)));
    const resolved = path.resolve(temp), root = path.resolve(os.tmpdir()) + path.sep;
    if (resolved.startsWith(root) && path.basename(resolved).startsWith('lrx-awards-ui-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
});
