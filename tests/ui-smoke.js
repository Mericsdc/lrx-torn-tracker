const fs = require('fs');
const path = require('path');
const os = require('os');
const { fork } = require('child_process');
const assert = require('assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { buildBattleStats } = require('../src/server/battle-stats');
const { checkMarketHelpers } = require('./market-helpers-fixture');
const { checkProfileHelper } = require('./profile-helper-fixture');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-ui-'));
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ features: { 'page.travel': false, 'app.splash': false, 'app.animations': false, 'app.newYearWelcome': false } }));
const child = fork(path.join(__dirname, 'preview-server.js'), { env: { ...process.env, TORN_DATA_DIR: temp, TORN_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
const output = process.env.QA_OUTPUT || path.join(os.tmpdir(), 'lrx-qa');
fs.mkdirSync(output, { recursive: true });
let browser;
async function checkUpdateNotifications(browser, base, output) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
  await context.addInitScript(() => {
    window.qaUpdateChecks = 0;
    window.qaUpdateInstalls = 0;
    window.qaUpdateReply = { configured: true, current: '1.6.7', latest: '1.6.8', available: true, notes: '## Update notifications\n\n- Notify on startup and while using the app.' };
    if (new URL(location.href).searchParams.get('qaUpdate') === 'none') window.qaUpdateReply = { configured: true, current: '1.6.7', latest: '1.6.7', available: false };
    window.electronAPI = {
      updateCheck: async () => { window.qaUpdateChecks++; return { ...window.qaUpdateReply }; },
      updateApply: async () => { window.qaUpdateInstalls++; return { ok: true }; },
    };
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/api/bootstrap') {
      const response = await route.fetch(), data = await response.json();
      data.config.hasKey = false;
      data.config.features = { ...data.config.features, 'app.updates': true, 'app.animations': true };
      return route.fulfill({ json: data });
    }
    return route.continue();
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) errors.push(m.text()); }); // a blocked script or handler is a failure
  const time = new Date('2026-11-10T12:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  await page.goto(base);
  await page.locator('#auth-key').waitFor({ state: 'visible' });
  await page.clock.runFor(1001);
  await page.locator('#update-modal').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => window.qaUpdateChecks), 1);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'update-dialog-cancel', 'a notice that opens by itself never puts Install under the next key press');
  assert.equal(await page.locator('#update-dialog-title').textContent(), 'Update released');
  assert.ok((await page.locator('#update-dialog-description').textContent()).includes('Would you like to update now?'));
  assert.ok(await page.locator('#update-modal').evaluate((el) => Number(getComputedStyle(el).zIndex) > Number(getComputedStyle(document.querySelector('#auth-screen')).zIndex)));
  assert.equal(await page.evaluate(() => window.qaUpdateInstalls), 0);
  await page.screenshot({ path: path.join(output, 'update-notification-first-launch.png') });
  await page.locator('#update-dialog-cancel').click();
  assert.equal(await page.locator('#auth-key').evaluate((el) => document.activeElement === el), true);
  await page.clock.runFor(60_000);
  assert.equal(await page.evaluate(() => window.qaUpdateChecks), 2);
  assert.equal(await page.locator('#update-modal').isVisible(), false, 'Later does not repeat the same prompt');
  assert.ok(await page.locator('#update-btn').evaluate((el) => el.classList.contains('update-attention')));
  await page.evaluate(() => document.body.classList.remove('no-anim'));
  assert.equal(await page.locator('#update-btn').evaluate((el) => getComputedStyle(el).animationName), 'update-attention');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('#update-btn').evaluate((el) => getComputedStyle(el).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // The attention button remains reachable while a Torn browser tab is active.
  await page.evaluate(() => {
    document.querySelector('#auth-screen').hidden = true;
    document.body.classList.remove('auth-open');
    openInTab('https://www.torn.com/index.php', { activate: true });
  });
  assert.equal(await page.locator('#workspace-update-btn').isVisible(), true);
  assert.equal(await page.locator('#workspace-update-btn').evaluate((el) => getComputedStyle(el).animationName), 'update-attention');
  await page.locator('#workspace-update-btn').click();
  await page.locator('#update-modal').waitFor({ state: 'visible' });
  await page.locator('#update-dialog-cancel').click();
  assert.equal(await page.locator('#workspace-update-btn').evaluate((el) => document.activeElement === el), true);
  await page.evaluate(() => activateWorkspaceTab('tracker'));
  assert.equal(await page.locator('#workspace-update-btn').isVisible(), false);

  // A release arriving during use is announced after the current dialog closes.
  await page.evaluate(() => { window.qaUpdateReply.latest = '1.6.9'; document.querySelector('#login-modal').hidden = false; });
  await page.clock.runFor(60_000);
  assert.equal(await page.locator('#update-modal').isVisible(), false);
  await page.evaluate(() => { document.querySelector('#login-modal').hidden = true; });
  await page.clock.runFor(1001);
  await page.locator('#update-modal').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#update-dialog-latest').textContent(), 'v1.6.9');
  await page.locator('#update-dialog-cancel').click();

  // A minimized/hidden window waits until the user returns.
  await page.evaluate(() => {
    window.qaVisibility = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.qaVisibility });
    window.qaUpdateReply.latest = '1.6.10';
  });
  await page.clock.runFor(60_000);
  assert.equal(await page.locator('#update-modal').isVisible(), false);
  await page.evaluate(() => { window.qaVisibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  await page.locator('#update-modal').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#update-dialog-latest').textContent(), 'v1.6.10');
  await page.locator('#update-dialog-cancel').click();

  // Network failures retain the pending release and its attention indicator.
  await page.evaluate(async () => { window.qaUpdateReply = { error: 'Fixture offline' }; await checkUpdate(false); });
  assert.equal(await page.evaluate(() => state.update.latest), '1.6.10');
  assert.ok(await page.locator('#update-btn').evaluate((el) => el.classList.contains('update-attention')));
  assert.equal(await page.locator('#update-modal').isVisible(), false);

  // Concurrent checks share one request, then clear the indicator when up to date.
  const checks = await page.evaluate(() => window.qaUpdateChecks);
  await page.evaluate(() => {
    window.electronAPI.updateCheck = () => { window.qaUpdateChecks++; return new Promise((resolve) => { window.qaResolveUpdate = resolve; }); };
    window.qaCheckOne = checkUpdate(false); window.qaCheckTwo = checkUpdate(false);
  });
  assert.equal(await page.evaluate(() => window.qaUpdateChecks), checks + 1);
  await page.evaluate(async () => {
    window.qaResolveUpdate({ configured: true, current: '1.6.10', latest: '1.6.10', available: false });
    await Promise.all([window.qaCheckOne, window.qaCheckTwo]);
  });
  assert.equal(await page.locator('#update-btn').evaluate((el) => el.classList.contains('update-attention')), false);
  assert.equal(await page.evaluate(() => window.qaUpdateInstalls), 0);

  // Returning after sleep or regaining connectivity checks immediately.
  await page.evaluate(() => {
    window.electronAPI.updateCheck = async () => { window.qaUpdateChecks++; return { configured: true, current: '1.6.10', latest: '1.6.11', available: true }; };
  });
  await page.clock.setSystemTime(new Date((await page.evaluate(() => Date.now())) + 300_000));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.locator('#update-modal').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#update-dialog-latest').textContent(), 'v1.6.11');
  await page.locator('#update-dialog-cancel').click();

  // Respect the existing automatic-check preference; manual checks still work.
  await page.evaluate(() => { state.config.features['app.updates'] = false; });
  const disabledChecks = await page.evaluate(() => window.qaUpdateChecks);
  await page.clock.runFor(60_000);
  assert.equal(await page.evaluate(() => window.qaUpdateChecks), disabledChecks);
  await page.evaluate(() => checkUpdate(true));
  await page.locator('#update-modal').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => window.qaUpdateChecks), disabledChecks + 1);
  await page.locator('#update-dialog-cancel').click();

  // A fresh launch asks again for a still-pending release, but never when current.
  await page.reload();
  await page.locator('#auth-key').waitFor({ state: 'visible' });
  await page.clock.runFor(1001);
  await page.locator('#update-modal').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => window.qaUpdateChecks), 1);
  assert.equal(await page.locator('#update-dialog-latest').textContent(), 'v1.6.8');
  const current = await context.newPage();
  await current.clock.install({ time }); await current.clock.pauseAt(time);
  await current.goto(base + '?qaUpdate=none');
  await current.locator('#auth-key').waitFor({ state: 'visible' });
  await current.clock.runFor(1001);
  assert.equal(await current.evaluate(() => window.qaUpdateChecks), 1);
  assert.equal(await current.locator('#update-modal').isVisible(), false);
  assert.equal(await current.locator('#update-btn').evaluate((el) => el.classList.contains('update-attention')), false);
  assert.deepEqual(errors, []);
  await context.close();
}
(async () => {
  const { port } = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', (code) => reject(new Error('Fixture server exited: ' + code))); });
  const base = 'http://127.0.0.1:' + port;
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript(() => {
    window.electronAPI = { onUpdateProgress: (callback) => { window.qaUpdateProgress = callback; } };
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  let signedIn = false, sentKeys = [], overviewFails = false;
  // Baldr's Levelling Targets: hospital and jail targets are left out; the player's stats are 100,000 each.
  const lvNow = Math.floor(Date.now() / 1000), lvOkay = { state: 'Okay', until: 0, description: 'Okay' };
  const lvRow = (id, lvl, each, status) => ({ id, name: 'Target ' + id, lvl, total: each * 4, str: each, def: each, spd: each, dex: each, status, checkedAt: status ? Date.now() : 0 });
  const levelling = { lists: ['QA list'], list: 'QA list', checked: 7, error: null, myLevel: 25, targets: [
    lvRow(701, 90, 50, { state: 'Hospital', until: lvNow + 3600, description: 'In hospital' }), lvRow(702, 80, 50, lvOkay),
    lvRow(703, 85, 200000, lvOkay), lvRow(704, 70, 50, lvOkay), lvRow(705, 60, 50, lvOkay), lvRow(706, 50, 50, lvOkay),
    lvRow(707, 95, 50, { state: 'Jail', until: lvNow + 600, description: 'In jail' }), lvRow(708, 99, 50, null),
  ] };
  const attackedPosts = [];
  const battle = buildBattleStats({ strength: 100000, defense: 100000, speed: 100000, dexterity: 100000 });
  const overview = { player: { id: 123, name: 'QA Player', level: 25, job: {}, faction: { faction_id: 5 }, status: { state: 'Okay' } }, serverTime: Math.floor(Date.now() / 1000), battle, bars: {}, cooldowns: {}, drug: { cooldown: 0, xanaxActive: false }, education: { timeLeft: 0, completed: 0, totalCourses: 100 } };
  const targetData = (id) => ({ faction: { id, name: 'Faction ' + id, members: 3, respect: 1000 }, me: { totals: battle.totals }, members: [1, 2, 3].map((n) => ({ id: id * 100 + n, name: ['Alpha', 'Bravo', 'Charlie'][n - 1], level: 20, bs: n * 50000, status: { state: 'Okay' }, source: 'ffscouter' })), ffscouter: { ok: true } });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    const p = url.pathname;
    const json = (obj, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (p === '/api/bootstrap') {
      const result = await route.fetch(); const b = await result.json(); b.config.hasKey = signedIn;
      b.overview = signedIn ? overview : null; return json(b);
    }
    if (p === '/api/auth') { sentKeys.push(route.request().postDataJSON().apiKey); signedIn = true; return json({ player: overview.player }); }
    if (p === '/api/logout') { signedIn = false; return json({ ok: true }); }
    if (p === '/api/overview') return overviewFails ? json({ error: 'Torn API: fixture outage', code: 17 }, 502) : json(overview);
    if (p === '/api/wars') return json({ faction: { name: 'QA faction' }, wars: [] });
    if (p === '/api/levelling') return json(levelling);
    if (p === '/api/levelling/attacked') { attackedPosts.push(route.request().postDataJSON()); return json({ ok: true }); }
    if (p === '/api/targets') { const id = Number(url.searchParams.get('faction')); if (id === 5) await new Promise((r) => setTimeout(r, 150)); return json(targetData(id)); }
    if (p.startsWith('/api/') && !['/api/config', '/api/features', '/api/lang', '/api/war-groups'].includes(p)) return json({ error: 'Not available in QA' }, 412);
    return route.continue();
  });
  await page.goto(base);
  await page.locator('#auth-key').waitFor({ state: 'visible' });
  // The slowly turning glow behind the card must never make the sign-in screen scrollable: a scrollbar that comes and
  // goes with the turn narrows the screen and redraws the town every few seconds (seen at the default 1348x787 window).
  // This fixture runs with Animations off, so the glow turns only while no-anim is lifted for this check.
  await page.evaluate(() => document.body.classList.remove('no-anim'));
  for (const [width, height] of [[1348, 787], [1280, 720], [1100, 700]]) {
    await page.setViewportSize({ width, height });
    for (const deg of [0, 30, 45, 60]) {
      const auth = await page.evaluate((deg) => {
        const glow = document.querySelector('.auth-glow');
        const spin = glow.getAnimations().find((a) => a.animationName === 'spinSlow');
        spin.pause(); spin.currentTime = (22000 * deg) / 360;
        const a = document.querySelector('#auth-screen');
        const out = { scroll: a.scrollHeight, client: a.clientHeight };
        spin.play();
        return out;
      }, deg);
      assert.ok(auth.scroll <= auth.client, `sign-in screen at ${width}x${height} scrolls when the glow is at ${deg}deg (${auth.scroll} > ${auth.client})`);
    }
  }
  await page.evaluate(() => document.body.classList.add('no-anim'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  // New Year logo (forced with ?newyear=1): a Santa hat, an ice frame and lights all around the sign-in logo. It stays
  // inside the card and clear of the key field, never takes clicks, rests lit with Animations off, and is plain with
  // its switch off or outside Christmas Town.
  const dressed = await page.evaluate(() => {
    const scr = document.querySelector('#auth-screen');
    const box = (sel, root = document) => root.querySelector(sel).getBoundingClientRect();
    history.replaceState(null, '', '/?newyear=1');
    startAuthNewYear('login');
    const svg = document.querySelector('#auth-logo-stage > .auth-logo-xmas');
    if (!svg) return { missing: true };
    const out = {
      dressed: scr.classList.contains('ny-dressed'),
      shown: getComputedStyle(svg).display !== 'none',
      hat: svg.querySelectorAll('.nyl-hat').length,
      bulbs: svg.querySelectorAll('.nyl-bulb').length,
      aroundLogo: box('.auth-logo-xmas').left < box('.auth-logo-wrap').left && box('.auth-logo-xmas').right > box('.auth-logo-wrap').right,
      clearOfKey: box('.nyl-ice').bottom < box('#auth-key').top && box('.auth-logo-xmas').bottom < box('#auth-key').top,
      insideCard: box('.nyl-hat').top > box('#auth-card').top && box('.nyl-hat').right < box('#auth-card').right,
      clickThrough: getComputedStyle(svg).pointerEvents === 'none',
      stillLights: getComputedStyle(svg.querySelector('.nyl-glass')).animationName,
      // The app's global `svg { stroke: currentColor }` must not ring every bulb and halo in white.
      unoutlined: ['.nyl-glass', '.nyl-glow', '.nyl-ice path'].every((sel) => getComputedStyle(svg.querySelector(sel)).stroke === 'none'),
    };
    startAuthNewYear('login');
    out.insertedOnce = document.querySelectorAll('.auth-logo-xmas').length === 1;
    state.config.features = { ...state.config.features, 'app.newYear': false };
    startAuthNewYear('login');
    out.plainWhenOff = !scr.classList.contains('ny-dressed') && getComputedStyle(svg).display === 'none';
    delete state.config.features['app.newYear'];
    history.replaceState(null, '', '/');
    // Outside Christmas Town (whatever today's date is) the logo is plain.
    const realNewYear = window.LRXNewYear;
    window.LRXNewYear = { ...realNewYear, isSeason: () => false };
    startAuthNewYear('login');
    out.plainOutOfSeason = !scr.classList.contains('ny-dressed');
    window.LRXNewYear = realNewYear;
    return out;
  });
  assert.deepEqual(dressed, { dressed: true, shown: true, hat: 1, bulbs: 28, aroundLogo: true, clearOfKey: true, insideCard: true, clickThrough: true, stillLights: 'none', unoutlined: true, insertedOnce: true, plainWhenOff: true, plainOutOfSeason: true });
  // Dressed, in a 1100x700 window: the login card fits without a scrollbar, and in both the login form and the
  // splash (a 168 px logo) the hat stays on screen and the icicles and bulbs stay above the title.
  await page.setViewportSize({ width: 1100, height: 700 });
  const dressedFit = await page.evaluate(() => {
    history.replaceState(null, '', '/?newyear=1');
    startAuthNewYear('login');
    const a = document.querySelector('#auth-screen');
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    const lowest = () => Math.max(box('.nyl-ice').bottom, ...[...document.querySelectorAll('.nyl-glass')].map((g) => g.getBoundingClientRect().bottom));
    const place = () => ({ logo: Math.round(box('.auth-logo-wrap').width), hatOnScreen: box('.nyl-hat').top >= 0, clearOfTitle: lowest() < box('.auth-title').top });
    const out = { dressed: a.classList.contains('ny-dressed'), scroll: a.scrollHeight, client: a.clientHeight, login: place() };
    a.classList.replace('login', 'splash');
    out.splash = place();
    a.classList.replace('splash', 'login');
    history.replaceState(null, '', '/');
    startAuthNewYear('login');
    return out;
  });
  assert.ok(dressedFit.dressed && dressedFit.scroll <= dressedFit.client, `dressed sign-in screen scrolls at 1100x700 (${dressedFit.scroll} > ${dressedFit.client})`);
  assert.deepEqual([dressedFit.login, dressedFit.splash], [{ logo: 132, hatOnScreen: true, clearOfTitle: true }, { logo: 168, hatOnScreen: true, clearOfTitle: true }]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const key = 'AbCdEfGh12345678';
  await page.locator('#auth-key').pressSequentially(key);
  assert.equal(await page.locator('#auth-key').inputValue(), key);
  // Editing in the middle must keep the caret and the rest of the key intact.
  await page.locator('#auth-key').press('Home'); await page.locator('#auth-key').press('Delete'); await page.locator('#auth-key').pressSequentially('A');
  assert.equal(await page.locator('#auth-key').inputValue(), key);
  await page.locator('#auth-submit').click(); await page.locator('#auth-screen').waitFor({ state: 'hidden' });
  assert.equal(sentKeys[0], key);
  page.once('dialog', (dialog) => dialog.accept());
  await page.evaluate(() => logout()); await page.locator('#auth-key').waitFor({ state: 'visible' });
  await page.evaluate((key) => navigator.clipboard.writeText(key), key);
  await page.locator('#auth-key').focus(); await page.locator('#auth-key').press('Control+V');
  assert.equal(await page.locator('#auth-key').inputValue(), key);
  // A celebration that fails to start must not leave the sign-in button stuck.
  await page.evaluate(() => { window.realNewYearWelcome = window.LRXNewYearWelcome; window.LRXNewYearWelcome = { mount() { throw new Error('broken on purpose'); } }; });
  await page.locator('#auth-submit').click(); await page.locator('#auth-screen').waitFor({ state: 'hidden' });
  assert.deepEqual(sentKeys, [key, key]);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.querySelector('#auth-submit').disabled), false, 'sign-in button stays disabled when the celebration fails to start');
  await page.evaluate(() => { window.LRXNewYearWelcome = window.realNewYearWelcome; });
  // New Year snow in the app (forced with ?newyear=1): it falls inside the page background, behind the cards, and
  // stops with Animations off or with its own switch off.
  const snow = await page.evaluate(async () => {
    const canvas = document.querySelector('#app-snow');
    if (!canvas || typeof syncAppSnow !== 'function') return { missing: true };
    const lit = () => { const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    history.replaceState(null, '', '/?newyear=1');
    document.body.classList.remove('no-anim'); syncAppSnow(); await wait(300);
    const out = { falling: lit(), inBackground: canvas.parentElement.classList.contains('bg'), behindCards: Number(getComputedStyle(document.querySelector('.bg')).zIndex) < Number(getComputedStyle(document.querySelector('.app')).zIndex), clickThrough: getComputedStyle(canvas).pointerEvents === 'none' };
    document.body.classList.add('no-anim'); syncAppSnow(); await wait(100);
    out.stillAnimationsOff = lit();
    document.body.classList.remove('no-anim'); state.config.features = { ...state.config.features, 'app.newYearSnow': false }; syncAppSnow(); await wait(100);
    out.stillSwitchOff = lit();
    delete state.config.features['app.newYearSnow']; document.body.classList.add('no-anim'); syncAppSnow();
    history.replaceState(null, '', '/');
    return out;
  });
  assert.deepEqual(snow, { falling: true, inBackground: true, behindCards: true, clickThrough: true, stillAnimationsOff: false, stillSwitchOff: false });
  // New Year celebration (forced with ?newyear=1): over the app and under the sign-in screen; Esc closes it
  // without reaching the page underneath; with its switch off an open celebration closes.
  const party = await page.evaluate(async () => {
    const root = document.querySelector('#ny-welcome');
    if (!root || typeof startNewYearWelcome !== 'function') return { missing: true };
    window.nyEscLeaks = 0;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.nyEscLeaks++; });
    history.replaceState(null, '', '/?newyear=1');
    document.body.classList.remove('no-anim');
    state.config.features = { ...state.config.features, 'app.newYearWelcome': true };
    startNewYearWelcome();
    await new Promise((r) => setTimeout(r, 1500));
    const canvas = root.querySelector('canvas');
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = false;
    for (let i = 3; i < d.length; i += 4) if (d[i]) { lit = true; break; }
    const z = (sel) => Number(getComputedStyle(document.querySelector(sel)).zIndex);
    return { shown: !root.hidden, greeting: root.querySelector('.ny-greet').textContent === LRXNewYear.greeting(new Date(), 'en'), drawing: lit, overApp: z('#ny-welcome') > z('.app'), underSignIn: z('#ny-welcome') < z('#auth-screen') };
  });
  assert.deepEqual(party, { shown: true, greeting: true, drawing: true, overApp: true, underSignIn: true });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  const partyClosed = await page.evaluate(async () => {
    const root = document.querySelector('#ny-welcome');
    const out = { hidden: root.hidden, escLeaks: window.nyEscLeaks };
    // Switching to another workspace tab (a Torn page) closes it, so it never sits over the tab bar.
    nyWelcome.overlay.show();
    activateWorkspaceTab('ny-elsewhere');
    await new Promise((r) => setTimeout(r, 700));
    out.hiddenOnTabSwitch = root.hidden;
    activateWorkspaceTab('tracker');
    nyWelcome.overlay.show();
    state.config.features = { ...state.config.features, 'app.newYearWelcome': false };
    checkNewYearWelcome();
    await new Promise((r) => setTimeout(r, 700));
    out.hiddenWhenOff = root.hidden;
    history.replaceState(null, '', '/');
    document.body.classList.add('no-anim');
    return out;
  });
  assert.deepEqual(partyClosed, { hidden: true, escLeaks: 0, hiddenOnTabSwitch: true, hiddenWhenOff: true });
  await page.evaluate(() => openInTab('https://weav3r.dev/', { activate: false }));
  assert.equal(await page.locator('#quick-toggle').getAttribute('aria-expanded'), 'true');
  await page.evaluate(() => openInTab('https://www.torn.com/index.php', { activate: false }));
  assert.equal(await page.locator('#quick-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#workspace-shortcuts').evaluate((e) => e.inert), true);
  await page.locator('#quick-toggle').click();
  assert.equal(await page.locator('#quick-toggle').getAttribute('aria-expanded'), 'true');
  await page.evaluate(() => closeBrowserTab(state.browserTabs[1].id));
  assert.equal(await page.locator('#quick-toggle').getAttribute('aria-expanded'), 'true');
  await page.locator('[data-open-url="https://weav3r.dev/"]').click();
  assert.equal(await page.evaluate(() => state.browserTabs.length), 1);
  // A middle click closes a tab, also when the strip is redrawn between press and release (a loading page changes its
  // title and spinner); the press starts no auto-scroll; a press released off the tab closes nothing.
  await page.evaluate(() => { openInTab('https://www.torn.com/index.php', { activate: false }); openInTab('https://www.torn.com/factions.php', { activate: false }); });
  const tabIds = () => page.evaluate(() => state.browserTabs.map((t) => t.id));
  const tabsBefore = await tabIds();
  assert.equal(tabsBefore.length, 3);
  const pressMiddle = async (id) => {
    const box = await page.locator(`#browser-tabs [data-ws-tab="${id}"] .ws-tab-title`).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'middle' });
    return box;
  };
  await page.evaluate(() => { window.qaMiddleDefault = null; addEventListener('mousedown', (e) => { if (e.button === 1) window.qaMiddleDefault = e.defaultPrevented; }, { once: true }); });
  await pressMiddle(tabsBefore[1]);
  await page.evaluate(() => { const t = state.browserTabs[1]; t.loading = true; t.title = 'Just a moment...'; renderBrowserTabs(); });
  await page.mouse.up({ button: 'middle' });
  assert.deepEqual(await tabIds(), [tabsBefore[0], tabsBefore[2]], 'a middle click closes the tab even when the strip is redrawn between press and release');
  assert.equal(await page.evaluate(() => window.qaMiddleDefault), true, 'the middle press starts no auto-scroll');
  await pressMiddle(tabsBefore[2]); await page.mouse.up({ button: 'middle' });
  assert.deepEqual(await tabIds(), [tabsBefore[0]], 'a plain middle click closes the tab');
  const kept = await pressMiddle(tabsBefore[0]);
  await page.mouse.move(kept.x + kept.width / 2, kept.y + 300); await page.mouse.up({ button: 'middle' });
  assert.deepEqual(await tabIds(), [tabsBefore[0]], 'a middle press released off the tab closes nothing');
  await page.locator('#tab-btn-tracker').click();
  // Baldr's Levelling Targets: hospital and jail targets are not listed; the three highest-level targets you can beat get
  // Best EXP; one whose stats beat yours is marked Strong and listed after them; Attack reports the target for a re-check.
  await page.evaluate(() => showView('level'));
  await page.locator('#lv-tbody .attack-btn').first().waitFor();
  assert.deepEqual(await page.locator('#lv-tbody .attack-btn').evaluateAll((els) => els.map((a) => Number(a.dataset.lvId))), [702, 704, 705, 706, 703, 708], 'levelling: who is listed, in order');
  assert.deepEqual(await page.locator('#lv-tbody tr.lv-best .attack-btn').evaluateAll((els) => els.map((a) => Number(a.dataset.lvId))), [702, 704, 705], 'levelling: Best EXP');
  assert.match(await page.locator('#lv-tbody tr:has([data-lv-id="703"]) .chip.warn').getAttribute('title'), /DEF ≥ your STR/, 'levelling: the strong target says which stat');
  assert.match(await page.locator('#lv-progress').textContent(), /\(hidden\): 2\b/, 'levelling: the hidden targets are counted');
  await page.screenshot({ path: path.join(output, 'levelling.png') });
  await page.evaluate(() => { const a = document.querySelector('#lv-tbody [data-lv-id="702"]'); a.addEventListener('click', (e) => e.preventDefault(), { once: true }); a.click(); });
  for (let i = 0; i < 20 && !attackedPosts.length; i++) await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(attackedPosts, [{ id: 702 }], 'levelling: Attack reports the target');
  await page.evaluate(() => { for (const t of [...state.browserTabs]) closeBrowserTab(t.id); activateWorkspaceTab('tracker'); showView('overview'); });
  // Beginner Guide (under level 15): the roadmap, the Happy jump card and the topic cards, personal steps from the
  // overview, an opened Details that stays open across overview refreshes and language switches, Turkish texts.
  const ovBefore = await page.evaluate(() => JSON.stringify({ player: state.overview.player, bars: state.overview.bars, cooldowns: state.overview.cooldowns, fetchedAt: state.overview.fetchedAt }));
  await page.evaluate(() => {
    Object.assign(state.overview.player, { level: 10, faction: { faction_id: 0 }, property: 'Shack', status: { state: 'Okay' } });
    state.overview.bars = { energy: { current: 1000, maximum: 150, fulltime: 0 }, nerve: { current: 60, maximum: 60, fulltime: 0 }, happy: { current: 5000, maximum: 5000, fulltime: 0 }, life: { current: 100, maximum: 100, fulltime: 0 } };
    state.overview.cooldowns = { drug: 0, booster: 0, medical: 0 };
    state.overview.fetchedAt = Date.now();
    renderOverview(); showView('guide');
  });
  await page.locator('#guide-body .hj-card').waitFor({ timeout: 5000 });
  assert.deepEqual(await page.locator('#guide-body [data-gd-section]').evaluateAll((els) => els.map((e) => e.dataset.gdSection)), ['energy', 'gym', 'crimes', 'faction', 'job', 'education', 'buy', 'tools', 'after15'], 'guide: the topic cards in order');
  assert.match(await page.locator('#guide-body .gd-road').textContent(), /Day 1/, 'guide: the roadmap');
  assert.match(await page.locator('#guide-body .hj-card [data-hj-live]').textContent(), /next tick/, 'guide: the jump card says what to do next');
  const guideSteps = await page.locator('#gd-steps').textContent();
  for (const want of ['Nerve is full', 'Not in a faction', 'Shack', 'stacked above your max']) assert.ok(guideSteps.includes(want), 'guide step: ' + want);
  await page.locator('#guide-body [data-gd-id="energy"] > summary').click();
  await page.evaluate(() => renderOverview());
  assert.equal(await page.locator('#guide-body [data-gd-id="energy"]').evaluate((d) => d.open), true, 'guide: an opened Details stays open after an overview refresh');
  await page.screenshot({ path: path.join(output, 'guide.png'), fullPage: true });
  await page.locator('#lang-toggle [data-lang="tr"]').click();
  assert.match(await page.locator('#guide-body .gd-road').textContent(), /İlk gün/, 'guide: Turkish roadmap');
  assert.match(await page.locator('#gd-steps').textContent(), /Nerve'ün dolu/, 'guide: Turkish steps');
  assert.match(await page.locator('#guide-body .hj-checks').textContent(), /Müsait/, 'guide: the jump status row in Turkish');
  assert.equal(await page.locator('#guide-body [data-gd-id="energy"]').evaluate((d) => d.open), true, 'guide: an opened Details stays open after a language switch');
  await page.screenshot({ path: path.join(output, 'guide-tr.png'), fullPage: true });
  await page.locator('#lang-toggle [data-lang="en"]').click();
  // Tools: the same Happy jump card from level 15, behind its own switch.
  const toolsDrawn = () => page.waitForFunction(() => document.querySelector('#tools-body article'), null, { timeout: 5000 });
  await page.evaluate(() => showView('tools')); await toolsDrawn();
  assert.equal(await page.locator('#tools-body .hj-card').count(), 0, 'tools: no jump card under level 15 (it is in the guide)');
  await page.evaluate(() => { state.overview.player.level = 25; renderOverview(); showView('tools'); });
  await page.locator('#tools-body .hj-card [data-hj-live]').waitFor({ timeout: 5000 });
  assert.match(await page.locator('#tools-body .hj-card [data-hj-live]').textContent(), /next tick/, 'tools: the live jump checklist');
  await page.evaluate(async () => { await setFeature('tools.happyJump', false); showView('tools'); });
  await page.waitForFunction(() => !document.querySelector('#tools-body .hj-card'), null, { timeout: 5000 });
  await page.evaluate(async () => { await setFeature('tools.happyJump', true); });
  await page.evaluate((s) => { const o = JSON.parse(s); Object.assign(state.overview, { bars: o.bars, cooldowns: o.cooldowns, fetchedAt: o.fetchedAt }); state.overview.player = o.player; renderOverview(); showView('overview'); }, ovBefore);
  await page.locator('[data-view="settings"]').click(); await page.locator('[data-set-tab="appearance"]').click();
  for (const theme of ['ocean', 'forest', 'amethyst', 'light', 'obsidian']) {
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    await page.waitForFunction(() => document.querySelector('#theme-save-status').textContent.includes('saved'));
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
  }
  // Theme picker preview: [data-preview-theme] gives an element the same colours the whole app gets with that theme,
  // whatever theme the page itself is in (here Obsidian, and again under Light).
  const previewDrift = await page.evaluate(() => {
    const vars = ['--bg', '--bg-2', '--panel', '--panel-end', '--workspace-chrome', '--field', '--text', '--muted', '--muted-2', '--tq', '--tq-2', '--tq-soft', '--tq-border', '--stroke', '--stroke-2', '--ok', '--warn', '--danger', '--gold', '--gold-2', '--gold-soft', '--gold-border', '--surface', '--surface-2'];
    const ids = ['obsidian', 'ocean', 'forest', 'amethyst', 'light'], root = document.documentElement, saved = root.dataset.theme;
    const probe = document.createElement('div'), paint = document.createElement('span');
    document.querySelector('.app').append(probe, paint);
    const norm = (v) => { paint.style.color = ''; paint.style.color = v.trim(); return getComputedStyle(paint).color; };
    const read = (el) => vars.map((v) => norm(getComputedStyle(el).getPropertyValue(v)));
    const drift = [];
    for (const pageTheme of ['obsidian', 'light']) {
      for (const id of ids) {
        root.dataset.theme = id; const real = read(root);
        root.dataset.theme = pageTheme; probe.dataset.previewTheme = id; const shown = read(probe);
        vars.forEach((v, i) => { if (real[i] !== shown[i]) drift.push(`${id} on ${pageTheme}: ${v} ${shown[i]} != ${real[i]}`); });
      }
    }
    probe.remove(); paint.remove(); root.dataset.theme = saved;
    return drift;
  });
  assert.deepEqual(previewDrift, [], 'theme preview colours match the real themes');
  // Theme picker: a list with Dark/Light labels and an Active badge beside a large preview. The preview follows the
  // pointer and the keyboard focus, arrow keys move through the list, and the save status clears and follows the language.
  const choices = page.locator('#theme-options .theme-choice');
  const pickerState = () => page.evaluate(() => ({
    pressed: [...document.querySelectorAll('#theme-options [aria-pressed="true"]')].map((b) => b.dataset.themeChoice),
    tabbable: [...document.querySelectorAll('#theme-options .theme-choice')].filter((b) => b.tabIndex === 0).map((b) => b.dataset.themeChoice),
    badge: [...document.querySelectorAll('#theme-options .theme-active')].map((b) => b.textContent.trim() + '@' + b.closest('[data-theme-choice]').dataset.themeChoice),
    preview: document.querySelector('#theme-preview')?.dataset.previewTheme,
    caption: document.querySelector('#theme-caption')?.textContent || '',
    focused: document.activeElement?.dataset?.themeChoice || null,
    page: document.documentElement.dataset.theme,
  }));
  assert.deepEqual(await choices.locator('.theme-name strong').allTextContents(), ['Obsidian', 'Ocean', 'Forest', 'Amethyst', 'Light']);
  assert.deepEqual(await choices.locator('.theme-kind').allTextContents(), ['Dark', 'Dark', 'Dark', 'Dark', 'Light']);
  let picker = await pickerState();
  assert.deepEqual([picker.pressed, picker.tabbable, picker.badge, picker.preview], [['obsidian'], ['obsidian'], ['Active@obsidian'], 'obsidian']);
  assert.match(picker.caption, /Graphite and gold, the original look/);
  assert.ok(await page.evaluate(() => document.querySelector('#theme-preview').getBoundingClientRect().left >= document.querySelector('#theme-options').getBoundingClientRect().right), 'the preview sits beside the list');
  await page.locator('[data-theme-choice="forest"]').hover();
  picker = await pickerState();
  assert.deepEqual([picker.preview, picker.page], ['forest', 'obsidian'], 'hovering previews without applying');
  assert.match(picker.caption, /Dark green, easy on the eyes at night/);
  await page.locator('article:has(#theme-options) .card-head h3').hover();
  assert.equal((await pickerState()).preview, 'obsidian', 'the preview returns to the active theme');
  await page.locator('[data-theme-choice="obsidian"]').focus();
  await page.keyboard.press('ArrowDown'); picker = await pickerState();
  assert.deepEqual([picker.focused, picker.preview, picker.page], ['ocean', 'ocean', 'obsidian'], 'arrow keys move and preview');
  await page.keyboard.press('End'); assert.equal((await pickerState()).focused, 'light');
  await page.keyboard.press('ArrowDown'); assert.equal((await pickerState()).focused, 'obsidian', 'arrow keys wrap');
  await page.keyboard.press('ArrowUp'); assert.equal((await pickerState()).focused, 'light');
  await page.keyboard.press('Home'); assert.equal((await pickerState()).focused, 'obsidian');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#theme-save-status').textContent === 'Theme saved');
  picker = await pickerState();
  assert.deepEqual([picker.page, picker.focused, picker.pressed, picker.tabbable], ['forest', 'forest', ['forest'], ['forest']], 'Enter applies the theme and keeps the focus');
  await page.waitForFunction(() => document.querySelector('#theme-save-status').textContent === '', null, { timeout: 6000 });
  await page.locator('[data-theme-choice="amethyst"]').click();
  await page.waitForFunction(() => document.querySelector('#theme-save-status').textContent === 'Theme saved');
  await page.locator('#lang-toggle [data-lang="tr"]').click();
  await page.waitForFunction(() => document.querySelector('#theme-save-status').textContent === 'Tema kaydedildi');
  assert.deepEqual(await choices.locator('.theme-name strong').allTextContents(), ['Obsidyen', 'Okyanus', 'Orman', 'Ametist', 'Aydınlık']);
  assert.deepEqual(await choices.locator('.theme-kind').allTextContents(), ['Koyu', 'Koyu', 'Koyu', 'Koyu', 'Açık']);
  assert.equal(await page.locator('#theme-options .theme-active').textContent(), 'Aktif');
  assert.match(await page.locator('#theme-caption').textContent(), /Mürdüm tonları ve yumuşak mor vurgular/);
  await page.screenshot({ path: path.join(output, 'themes-picker-tr.png') });
  await page.locator('#lang-toggle [data-lang="en"]').click();
  await page.waitForFunction(() => document.querySelector('#theme-options .theme-active')?.textContent === 'Active');
  // Longest transition on a preview tile, in ms (the global reduced-motion rule in styles.css leaves .01ms). The
  // Animations class is set and read in one step: a feature re-render (features.js) may restore it at any moment.
  const previewFade = (animations) => page.evaluate((on) => {
    const body = document.body, had = body.classList.contains('no-anim');
    body.classList.toggle('no-anim', !on);
    const ms = Math.max(...getComputedStyle(document.querySelector('#theme-preview .tp-card')).transitionDuration.split(',').map((s) => parseFloat(s) * 1000));
    body.classList.toggle('no-anim', had);
    return ms;
  }, animations);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.ok(await previewFade(true) >= 150, 'the preview cross-fades');
  assert.ok(await previewFade(false) < 1, 'no cross-fade with Animations off');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.ok(await previewFade(true) < 1, 'no cross-fade with reduced motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // A click while a save is still running is ignored; the mouse focus it leaves on that row must not hold the preview.
  let releaseSave, markSaveSeen;
  const saveSeen = new Promise((resolve) => { markSaveSeen = resolve; });
  await page.route('**/api/config', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await new Promise((resolve) => { releaseSave = resolve; markSaveSeen(); });
    return route.continue();
  });
  await page.locator('[data-theme-choice="forest"]').click();
  await saveSeen;
  await page.locator('[data-theme-choice="light"]').click();
  await page.locator('article:has(#theme-options) .card-head h3').hover();
  picker = await pickerState();
  assert.deepEqual([picker.page, picker.preview], ['forest', 'forest'], 'a click ignored during a save does not hold the preview');
  releaseSave();
  await page.waitForFunction(() => document.querySelector('#theme-save-status').textContent === 'Theme saved');
  await page.unroute('**/api/config');
  picker = await pickerState();
  assert.deepEqual([picker.page, picker.preview], ['forest', 'forest']);
  // Under a Premium appearance profile no base theme is "Active", the caption says what choosing one does, and the
  // preview still shows the plain themes (the profile's inline colours on <html> do not reach it).
  await page.evaluate(() => { const r = document.documentElement; r.dataset.premiumAppearance = 'true'; r.style.setProperty('--bg', '#ff0000'); window.onLangChanged(); });
  picker = await pickerState();
  assert.deepEqual(picker.badge, [], 'no base theme is marked Active under a Premium appearance');
  assert.match(picker.caption, /Premium appearance is on · choosing a theme turns it off/);
  assert.equal(await page.locator('#theme-preview').evaluate((el) => getComputedStyle(el).getPropertyValue('--bg').trim()), '#091710');
  await page.evaluate(() => { const r = document.documentElement; delete r.dataset.premiumAppearance; r.style.removeProperty('--bg'); window.onLangChanged(); });
  assert.deepEqual((await pickerState()).badge, ['Active@forest']);
  await page.locator('[data-theme-choice="ocean"]').click();
  await page.waitForFunction(() => document.querySelector('#theme-save-status').textContent.includes('saved'));
  await page.reload(); await page.locator('[data-set-tab="appearance"]').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'ocean');
  await page.screenshot({ path: path.join(output, 'themes-ocean.png') });
  await page.evaluate(() => { state.overview.bars = { energy: { current: 120, maximum: 150, fulltime: 900 }, nerve: { current: 35, maximum: 60, fulltime: 3600 }, happy: { current: 3500, maximum: 5000, fulltime: 7200 }, life: { current: 2400, maximum: 3000, fulltime: 1200 } }; renderOverview(); showView('overview'); window.scrollTo({ top: 0, behavior: 'instant' }); });
  await page.screenshot({ path: path.join(output, 'overview-ocean.png') });
  await page.evaluate(() => { showView('settings'); showSettingsTab('appearance'); });
  await page.locator('[data-view="war"]').click();
  await page.evaluate(() => { state.factionId = 5; state.targets = null; loadTargets(); state.factionId = 6; loadTargets(); });
  await page.waitForFunction(() => state.targets?.faction.id === 6);
  await page.locator('#group-name').fill('<Priority>'); await page.locator('#group-form button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#group-filter').options.length === 3);
  const groupId = await page.locator('#group-filter option').last().getAttribute('value');
  // Choosing the destination first and the players second used to send them to "Ungrouped": every re-render
  // (ticking a player, the periodic target refresh) reset the destination.
  await page.locator('#group-bulk-destination').selectOption(groupId);
  await page.locator('[data-group-player]').first().check();
  assert.equal(await page.locator('#group-bulk-destination').inputValue(), groupId, 'destination kept after ticking a player');
  await page.evaluate(() => renderTargets());
  assert.equal(await page.locator('#group-bulk-destination').inputValue(), groupId, 'destination kept after a target refresh');
  await page.locator('[data-group-assign]').click();
  await page.waitForFunction((id) => document.querySelector('[data-group-target]').value === id, groupId);
  assert.equal(await page.locator('[data-group-target]').evaluateAll((items, id) => items.filter((e) => e.value === id).length, groupId), 1);
  await page.locator('#group-select-all').check();
  await page.locator('#group-bulk-destination').selectOption(groupId); await page.locator('[data-group-assign]').click();
  await page.waitForFunction((id) => [...document.querySelectorAll('[data-group-target]')].every((e) => e.value === id), groupId);
  await page.locator('#group-filter').selectOption(groupId);
  assert.equal(await page.locator('#war-table tbody tr').count(), 3);
  await page.screenshot({ path: path.join(output, 'war-groups.png') });
  await page.reload(); await page.waitForFunction(() => !!document.querySelector('[data-group-target]'));
  assert.equal(await page.locator('[data-group-target]').first().inputValue(), groupId);
  await page.locator('#group-filter').selectOption(groupId);
  await page.locator('#group-name').fill('Renamed'); await page.locator('[data-group-rename]').click();
  await page.waitForFunction(() => document.querySelector('#group-filter').selectedOptions[0].textContent === 'Renamed');
  await page.locator('[data-group-remove]').click();
  await page.waitForFunction(() => document.querySelector('#group-filter').options.length === 2);
  assert.ok(await page.locator('[data-group-target]').evaluateAll((items) => items.every((e) => e.value === '')));
  await page.setViewportSize({ width: 640, height: 700 });
  await page.locator('[data-view="settings"]').click(); await page.locator('[data-set-tab="appearance"]').click();
  await page.locator('[data-theme-choice="light"]').click();
  await page.waitForFunction(() => document.querySelector('#theme-save-status').textContent.includes('saved'));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await page.evaluate(() => document.querySelector('#theme-preview').getBoundingClientRect().top >= document.querySelector('#theme-options').getBoundingClientRect().bottom), 'the theme list stacks above the preview on a narrow window');
  await page.screenshot({ path: path.join(output, 'compact-light.png') });
  await page.locator('[data-view="overview"]').click(); await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, 'overview-light.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { document.body.classList.remove('no-anim'); openInTab('https://weav3r.dev/', { activate: false }); openInTab('https://www.torn.com/index.php', { activate: false }); });
  assert.ok(await page.locator('#workspace-shortcuts').evaluate((e) => parseFloat(getComputedStyle(e).transitionDuration) > 0));
  // Light theme: the controls that used to keep a dark surface or near-white text are readable (WCAG AA, 4.5:1).
  const contrast = await page.evaluate(() => {
    const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const rgba = (text) => { const m = text.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1]; };
    const over = (base, top) => base.map((v, i) => v * (1 - top[3]) + top[i] * top[3]);
    const background = (el) => {
      const chain = []; for (let n = el; n; n = n.parentElement) chain.unshift(n);
      return chain.reduce((c, n) => { const cs = getComputedStyle(n), image = cs.backgroundImage !== 'none' && cs.backgroundImage.match(/rgba?\([^)]+\)/); c = over(c, rgba(cs.backgroundColor)); return image ? over(c, rgba(image[0])) : c; }, [255, 255, 255]);
    };
    const ratio = (el) => { const bg = background(el), a = lum(over(bg, rgba(getComputedStyle(el).color))), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    setAlert('qa-contrast', '<b>Notice</b> <span class="muted" id="qa-muted">note</span> <button class="btn sm" id="qa-btn">Retry</button>', 'warn');
    const out = {};
    for (const [name, selector] of [['language toggle', '#lang-toggle button:not(.active)'], ['war mode toggle', '#mode-toggle button:not(.active)'], ['target stock select', '#cover-days'], ['button in an alert', '#qa-btn'], ['muted text in an alert', '#qa-muted']]) out[name] = ratio(document.querySelector(selector));
    setAlert('qa-contrast', null);
    return { theme: document.documentElement.dataset.theme, out };
  });
  assert.equal(contrast.theme, 'light');
  for (const [name, ratio] of Object.entries(contrast.out)) assert.ok(ratio >= 4.5, `${name}: contrast ${ratio.toFixed(2)} in the Light theme`);
  // A refresh that fails while older data is on screen says so and says how old the data is; it clears on success.
  overviewFails = true;
  await page.evaluate(() => loadOverview(false));
  await page.waitForFunction(() => /Could not refresh:.*fixture outage.*The data on screen is from/.test(document.querySelector('#alert-area').textContent));
  overviewFails = false;
  await page.evaluate(() => loadOverview(false));
  await page.waitForFunction(() => !/Could not refresh/.test(document.querySelector('#alert-area').textContent));
  // The reply's own time sets the clocks, not the moment it arrived (the server can answer from a 25 s cache).
  assert.deepEqual(await page.evaluate(() => { const at = Date.now() - 20000; stampOverview({ serverTime: 1800000000, fetchedAt: at }); return [state.overviewAt === at, state.skew === 1800000000 * 1000 - at]; }), [true, true]);
  await page.evaluate(() => loadOverview(false));
  // A second count-up pass during the first one must end on the real figure, not on a half-animated frame.
  const counted = await page.evaluate(async () => {
    const host = document.querySelector('#bs-totals');
    host.innerHTML = '<div class="bs-total"><strong>2.35B</strong></div><div class="bs-total"><strong>$5,000,000</strong></div>';
    animateNumbers(host);
    await new Promise((resolve) => setTimeout(resolve, 150));
    animateNumbers();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    return [...host.querySelectorAll('strong')].map((el) => el.textContent);
  });
  assert.deepEqual(counted, ['2.35B', '$5,000,000']);
  assert.deepEqual(errors, []);
  const releaseNotes = "## What's new\n\n- **FF Scouter** uses the saved key.\n- Added `Weav3r` and target groups.\n\n## Fixes\n\n" + Array.from({ length: 12 }, (_, i) => '- Update improvement ' + (i + 1)).join('\n') + '\n\n<img src=x onerror="window.qaUnsafeNotes = true">';
  await page.evaluate((notes) => {
    window.electronAPI = {
      updateApply: () => new Promise((resolve) => { window.qaFinishUpdate = resolve; }),
      updateCheck: async () => state.update,
    };
    state.update = { available: true, current: '1.6.6', latest: '1.6.7', notes };
    document.querySelector('#update-btn').hidden = false;
  }, releaseNotes);
  await page.locator('#update-btn').click();
  await page.locator('#update-modal').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#update-dialog-notes h4').count(), 2);
  assert.equal(await page.locator('#update-dialog-notes strong').textContent(), 'FF Scouter');
  assert.equal(await page.locator('#update-dialog-notes code').textContent(), 'Weav3r');
  assert.equal(await page.locator('#update-dialog-notes img').count(), 0);
  assert.equal(await page.evaluate(() => window.qaUnsafeNotes), undefined);
  for (const theme of ['obsidian', 'ocean', 'forest', 'amethyst', 'light']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    const colors = await page.locator('#update-modal [role="dialog"]').evaluate((el) => {
      const card = document.querySelector('.sidebar.glass');
      return { dialog: getComputedStyle(el).backgroundImage, app: getComputedStyle(card).backgroundImage, font: getComputedStyle(el).fontFamily, appFont: getComputedStyle(card).fontFamily };
    });
    assert.equal(colors.dialog, colors.app, theme + ' uses the normal card surface');
    assert.equal(colors.font, colors.appFont);
    await page.screenshot({ path: path.join(output, 'update-dialog-' + theme + '.png') });
  }
  await page.setViewportSize({ width: 480, height: 400 });
  const fits = await page.locator('#update-modal [role="dialog"]').evaluate((el) => {
    const card = el.getBoundingClientRect(), footer = el.querySelector('footer').getBoundingClientRect(), notes = document.querySelector('#update-dialog-notes');
    return card.left >= 0 && card.top >= 0 && card.right <= innerWidth && card.bottom <= innerHeight && footer.bottom <= card.bottom && notes.scrollHeight > notes.clientHeight;
  });
  assert.ok(fits, '480x400 keeps actions visible and scrolls long notes');
  await page.screenshot({ path: path.join(output, 'update-dialog-compact.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#update-dialog-install').press('Tab');
  assert.equal(await page.locator('#update-dialog-close').evaluate((el) => el === document.activeElement), true);
  await page.locator('#update-dialog-close').press('Tab');
  assert.equal(await page.locator('#update-dialog-notes').evaluate((el) => el === document.activeElement), true);
  await page.locator('#update-dialog-install').click();
  await page.evaluate(() => window.qaUpdateProgress({ step: 'download', message: 'Downloading update…' }));
  assert.equal(await page.locator('#update-dialog-progress').evaluate((el) => el.value), 1);
  assert.equal(await page.locator('#update-dialog-install').isDisabled(), true);
  await page.locator('#update-dialog-notes').press('Escape');
  assert.equal(await page.locator('#update-modal').isVisible(), true);
  await page.evaluate(() => window.qaFinishUpdate({ ok: false, error: 'QA download failure' }));
  await page.waitForFunction(() => document.querySelector('#update-dialog-status').textContent.includes('QA download failure'));
  assert.ok(await page.locator('#update-dialog-feedback').evaluate((el) => el.classList.contains('is-error')));
  assert.equal(await page.locator('#update-dialog-install').isEnabled(), true);
  await page.locator('#update-dialog-cancel').click();
  await page.locator('#update-modal').waitFor({ state: 'hidden' });
  await page.locator('[data-view="settings"]').click();
  await page.locator('[data-set-tab="general"]').click();
  await page.locator('#set-update-check').click();
  await page.locator('#update-modal').waitFor({ state: 'visible' });
  await page.locator('#update-dialog-close').press('Escape');
  assert.equal(await page.locator('#set-update-check').evaluate((el) => el === document.activeElement), true);
  await page.evaluate(() => { state.update.available = false; state.update.current = state.update.latest; });
  await page.locator('#set-update-check').click();
  assert.equal(await page.locator('#update-dialog-title').textContent(), "You're up to date");
  assert.equal(await page.locator('#update-dialog-install').isVisible(), false);
  await page.locator('#update-dialog-cancel').click();
  const guard = await context.newPage();
  const guardRequests = [];
  await context.addCookies([{ name: 'rfc_v', value: 'fresh-token', domain: 'www.torn.com', path: '/', secure: true }]);
  await guard.route('https://www.torn.com/**', async (route) => {
    const req = route.request(); guardRequests.push({ url: req.url(), method: req.method(), body: req.postData() });
    if (req.method() === 'POST') return route.fulfill({ status: 403, body: 'fixture failure' });
    return route.fulfill({ contentType: 'text/html', body: '<div id="sidebarroot"><div class="bar___qa energy___qa">Energy</div><a href="/gym.php?rfcv=old" id="sidebar-link">Gym</a></div>' });
  });
  await guard.goto('https://www.torn.com/index.php');
  await guard.addScriptTag({ path: path.join(__dirname, '../torn-helpers/session-guard.js') });
  await guard.evaluate(async () => {
    await fetch('/properties.php?rfcv=old', { method: 'POST', body: 'rfcv=old&amount=10' });
    await fetch(new Request('https://www.torn.com/properties.php?rfcv=old', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'rfcv=old&amount=10' }));
    await new Promise((resolve) => { const xhr=new XMLHttpRequest(); xhr.open('POST','/properties.php?rfcv=old'); xhr.onload=resolve; xhr.send('rfcv=old&amount=10'); });
  });
  const payments = guardRequests.filter((r) => r.method === 'POST');
  assert.equal(payments.length, 3);
  assert.ok(payments.every((r) => r.url.includes('rfcv=fresh-token') && r.body.includes('rfcv=fresh-token')));
  await guard.evaluate(() => { document.querySelector('.energy___qa').onclick=()=>{throw Error('Duplicate handler must not run')}; });
  await guard.locator('.energy___qa').click(); await guard.waitForURL('**/gym.php');
  assert.equal(guardRequests.filter((r) => new URL(r.url).pathname === '/gym.php').length, 1);
  // Real helper, fixture markup using TornTools' current player selectors.
  const fight = await context.newPage();
  await fight.route('https://www.torn.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<div class="topSection___qa"></div><div id="attacker"><span class="life___qa">1,000 / 1,000</span></div><div id="defender"><span class="life___qa">800 / 800</span></div>' }));
  await fight.goto('https://www.torn.com/loader.php?sid=attack&user2ID=601');
  await fight.bringToFront();
  await fight.addScriptTag({ path: path.join(__dirname, '../torn-helpers/fight-helper.js') });
  await fight.locator('#lrx-live-fight').waitFor();
  await fight.locator('#defender span').evaluate((e) => e.textContent = '600 / 800');
  await fight.waitForFunction(() => document.querySelector('#lrx-live-fight').textContent.includes('Observed loss: 200'));
  await fight.locator('#attacker span').evaluate((e) => e.textContent = '900 / 1,000');
  await fight.waitForFunction(() => document.querySelector('#lrx-live-fight').textContent.includes('Observed loss: 100'));
  await fight.locator('#attacker span').evaluate((e) => e.textContent = '950 / 1,000');
  await fight.waitForFunction(() => document.querySelector('#lrx-live-fight').textContent.includes('Recovery: 50'));
  // Hidden changes must not be attributed to observed combat.
  await fight.evaluate(() => { Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false }); dispatchEvent(new Event('blur')); document.querySelector('#attacker span').textContent = '400 / 1,000'; });
  await fight.evaluate(() => { Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true }); dispatchEvent(new Event('focus')); });
  assert.ok((await fight.locator('#lrx-live-fight').textContent()).includes('partial observation'));
  assert.ok((await fight.locator('#lrx-live-fight').textContent()).includes('Observed loss: 100'));
  await fight.route('**/page.php?sid=attackData*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ DB: { defenderUser: { userID: 602 }, usersLife: { attacker: { currentLife: 300, maxLife: 1000 }, defender: { currentLife: 500, maxLife: 800 } } } }) }));
  await fight.evaluate(() => { history.pushState({}, '', '/loader.php?sid=attack&user2ID=602'); document.querySelector('#attacker span').remove(); document.querySelector('#defender span').remove(); window.__lrxFight.refresh(); });
  await fight.evaluate(() => fetch('/page.php?sid=attackData').then((r) => r.json()));
  await fight.waitForFunction(() => document.querySelector('#lrx-live-fight').textContent.includes('300 / 1,000'));
  await fight.addScriptTag({ path: path.join(__dirname, '../torn-helpers/fight-helper.js') });
  assert.equal(await fight.locator('#lrx-live-fight').count(), 1);
  await fight.screenshot({ path: path.join(output, 'fight-analysis-fixture.png') });
  await checkMarketHelpers(browser, output);
  await checkProfileHelper(browser, output);
  await checkUpdateNotifications(browser, base, output);
  console.log(JSON.stringify({ result: 'PASS', checked: ['manual entry and caret', 'Ctrl+V identical key', 'shortcut collapse and restore', 'Weav3r tab reuse', 'five themes and persistence', 'faction request race', 'group bulk assignment and reload', '640px layout', 'fight life loss and recovery', 'themed update dialog and error recovery', 'startup and per-minute update prompts', 'deferred prompts and one notice per release', 'pending-update pulse and reduced motion', 'offline recovery and shared checks', 'automatic-check preference and manual override', 'RFC refresh in fetch/Request/XHR', 'no failed-action replay', 'one sidebar navigation per click', 'bazaar undercut fills one open row on a real click', 'OpenMarket quality labels on focused Item Market tiles', 'profile working stats row from looked-up numbers', 'no frontend exceptions'], screenshots: output }));
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); child.kill();
  await new Promise((r) => child.exitCode !== null ? r() : child.once('exit', r));
  const resolved = path.resolve(temp);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('lrx-ui-')) fs.rmSync(resolved, { recursive: true, force: true });
});
