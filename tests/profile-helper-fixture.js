// Profile helper on a fixture profile page (run from ui-smoke.js). The tracker side (scan → lookup → update) is
// played by the test: the page must only report IDs, show the numbers it is given as text, and keep its row when
// Torn redraws the list. Nothing here talks to Torn.
const path = require('path');
const assert = require('assert/strict');

const PROFILE_HTML = `<!doctype html><html><head><title>Profile</title></head><body class="dark-mode">
<div class="profile-wrapper"><div class="profile-left-wrapper"><div class="basic-information"><ul class="info-table" id="info"></ul></div></div></div>
<script>
  const row = (label, value) => '<li><div class="user-information-section"><span class="bold">' + label + '</span></div><div class="user-info-value">' + value + '</div></li>';
  window.qaDraw = () => { document.getElementById('info').innerHTML = row('Name', '<span>Someone [1001]</span>')
    + row('Job', '<span>Director at <a href="/joblist.php#/p=corpinfo&ID=105422">Shine Co</a></span>') + row('Life', '<span>100 / 100</span>'); };
  setTimeout(qaDraw, 600); // Torn draws the list after the page has loaded
</script></body></html>`;

async function checkProfileHelper(browser, output) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'www.torn.com') return route.abort();
    if (url.pathname === '/profiles.php') return route.fulfill({ contentType: 'text/html', body: PROFILE_HTML });
    return route.fulfill({ status: 404, body: '' });
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('https://www.torn.com/profiles.php?XID=1001');
  await page.evaluate(() => { window.__lrxLang = 'en'; });
  await page.addScriptTag({ path: path.join(__dirname, '../torn-helpers/profile-work-stats.js') });
  // The page reports IDs only, once Torn has drawn the list
  assert.deepEqual(await page.evaluate(() => window.__lrxProfile.scan()), { playerId: '1001', companyId: '105422' });
  await page.evaluate(() => window.__lrxProfile.update({ playerId: '1001', workingStats: 152340, rating: 7 }));
  const row = page.locator('#info > li.lrx-pw-row');
  assert.equal(await row.textContent(), 'Working Stats152,3407/10 ★');
  assert.equal(await row.evaluate((li) => li.nextElementSibling.querySelector('.bold').textContent), 'Life', 'the row sits above Life');
  await page.screenshot({ path: path.join(output, 'profile-work-stats-fixture.png') });
  // Torn redraws the list: the row comes back from what was already given, once
  await page.evaluate(() => qaDraw());
  await page.waitForFunction(() => document.querySelectorAll('#info > li.lrx-pw-row').length === 1);
  assert.equal(await row.evaluate((li) => li.nextElementSibling.querySelector('.bold').textContent), 'Life');
  // Anything but numbers is dropped; markup is never parsed
  await page.evaluate(() => window.__lrxProfile.update({ playerId: '1001', workingStats: '<img src=x onerror="window.__qaInjected=1">', rating: '7<b>' }));
  assert.equal(await row.count(), 0, 'nothing valid to show');
  await page.evaluate(() => window.__lrxProfile.update({ playerId: '1001', workingStats: null, rating: 3 }));
  assert.equal(await row.textContent(), 'Working Stats3/10 ★');
  // Numbers for another profile are not shown here
  await page.evaluate(() => window.__lrxProfile.update({ playerId: '2002', workingStats: 999, rating: 9 }));
  assert.equal(await row.textContent(), 'Working Stats3/10 ★');
  // Turkish label
  await page.evaluate(() => { window.__lrxLang = 'tr'; window.__lrxProfile.update({ playerId: '1001', workingStats: 152340, rating: 7 }); });
  assert.equal(await row.textContent(), 'Çalışma statları152,3407/10 ★');
  assert.equal(await page.evaluate(() => window.__qaInjected), undefined);
  assert.equal(await page.locator('img').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
}
module.exports = { checkProfileHelper };
