// The Torn API and other outside services are untrusted input: sparse or broken replies, rate limits and
// timeouts must give a clear answer, never a crash or a hammering loop. Synthetic key and replies only.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-tornapi-tests-'));
process.env.TORN_DATA_DIR = temp;
process.env.TORN_API_KEY = '';
process.env.TORN_PREMIUM_SERVICE_URL = '';
const KEY = 'ResilientKey0001';
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ apiKey: KEY, features: { 'page.travel': false } }));

let torn = 'ok', tornCalls = 0, feedback = 'ok', ffscouter = 'ok';
let tornTime = null, xantaken = 1; // null: the real clock
let keyInfo = { access_level: 3, access_type: 'Limited Access' };
const feedbackPosts = [];
const realFetch = global.fetch;
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body) });
global.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname === 'formsubmit.co') {
    if (feedback === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    feedbackPosts.push({ url: url.href, body: JSON.parse(init.body), hasTimeout: !!init.signal });
    return reply(JSON.stringify({ success: 'true' }));
  }
  if (url.hostname === 'ffscouter.com') {
    if (ffscouter === 'down') return reply('<html>Service unavailable</html>', 503);
    if (ffscouter === 'unauthorized') return reply(JSON.stringify({ error: 'Invalid API key' }), 401);
    if (ffscouter === 'unregistered') return reply(JSON.stringify({ error: 'This API key is not registered' }), 400);
    return reply(JSON.stringify({ is_registered: true, is_premium: false }));
  }
  if (url.hostname !== 'api.torn.com') throw new Error('Unexpected external request: ' + url.hostname);
  tornCalls++;
  if (torn === 'null') return reply('null');
  if (torn === 'html') return reply('<html>Bad gateway</html>', 502);
  if (torn === 'http429') return reply('<html>Too many requests</html>', 429);
  if (torn === 'limit') return reply(JSON.stringify({ error: { code: 5, error: 'Too many requests' } }));
  if (url.pathname === '/torn/') return reply(JSON.stringify({ education: {} }));
  if (url.pathname === '/key/') return reply(JSON.stringify(keyInfo));
  if (torn === 'sparse') return reply(JSON.stringify({ player_id: 5, name: 'Sparse', icons: null, cooldowns: null, personalstats: null, status: null }));
  const user = { player_id: 5, name: 'Player', level: 10, timestamp: tornTime ?? Math.floor(Date.now() / 1000), cooldowns: { drug: 0 }, icons: {}, personalstats: { xantaken }, status: { state: 'Okay' } };
  for (const stat of ['strength', 'defense', 'speed', 'dexterity']) { user[stat] = 100; user[stat + '_modifier'] = 0; user[stat + '_info'] = []; }
  return reply(JSON.stringify(user));
};

const { server, flushData } = require('../src/server/server');
const ready = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
async function request(route, body, headers = {}) {
  await ready;
  const raw = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: route, method: raw === null ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let text = ''; res.on('data', (c) => text += c); res.on('end', () => { let data; try { data = JSON.parse(text); } catch { data = text; } resolve({ status: res.statusCode, data }); });
    });
    req.on('error', reject); req.end(raw);
  });
}
after(async () => {
  global.fetch = realFetch; flushData(); await new Promise((resolve) => server.close(resolve));
  const resolved = path.resolve(temp), root = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(root) || !path.basename(resolved).startsWith('lrx-tornapi-tests-')) throw new Error('Unsafe test cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});

test('a reply with missing and null fields still gives an overview', async () => {
  torn = 'sparse';
  const r = await request('/api/overview?force=1');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.player.id, 5); assert.equal(r.data.battle.totals.base, 0); assert.equal(r.data.drug.cooldown, 0);
  assert.ok(Math.abs(r.data.serverTime - Date.now() / 1000) < 60, 'without a Torn timestamp the local clock is used');
});

test('a body that is not a JSON object is reported as unreadable, never as a script error', async () => {
  for (const mode of ['null', 'html']) {
    torn = mode;
    const r = await request('/api/overview?force=1');
    assert.equal(r.status, 502, mode); assert.equal(r.data.code, 'BAD_RESPONSE', mode);
    assert.match(r.data.error, /Could not read the Torn API response/, mode);
  }
});

test('feedback sends only the form fields, the app version and the app language, with a time limit and a readable failure', async () => {
  feedback = 'timeout';
  const failed = await request('/api/feedback', { kind: 'hata', message: 'Synthetic feedback text', name: 'Tester', contact: 'tester@example.invalid', lang: 'en' });
  assert.notEqual(failed.status, 200); assert.match(failed.data.error, /did not respond in time|could not be reached/i);
  feedback = 'ok';
  const sent = await request('/api/feedback', { kind: 'hata', message: 'Synthetic feedback text', name: 'Tester', contact: 'tester@example.invalid', lang: 'en', apiKey: KEY, extra: 'ignored' });
  assert.equal(sent.status, 200, 'a failed attempt does not start the one-minute limit');
  assert.equal(feedbackPosts.length, 1);
  const { body, hasTimeout } = feedbackPosts[0];
  assert.deepEqual(Object.keys(body).sort(), ['Dil', 'Gonderen', 'Iletisim', 'Kategori', 'Mesaj', 'Surum', '_captcha', '_replyto', '_subject', '_template']);
  assert.equal(body.Mesaj, 'Synthetic feedback text'); assert.equal(body.Surum, require('../package.json').version);
  assert.ok(!JSON.stringify(feedbackPosts).includes(KEY), 'the API key never leaves with feedback');
  assert.equal(hasTimeout, true);
  assert.equal((await request('/api/feedback', { kind: 'hata', message: 'Second synthetic message' })).status, 429);
});

test('requests coming from another website are refused even without an Origin header', async () => {
  torn = 'ok';
  assert.equal((await request('/api/overview', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('/api/overview', undefined, { 'Sec-Fetch-Site': 'same-site' })).status, 403);
  assert.equal((await request('/api/overview', undefined, { 'Sec-Fetch-Site': 'same-origin' })).status, 200);
  assert.equal((await request('/api/overview', undefined, { 'Sec-Fetch-Site': 'none' })).status, 200);
  assert.equal((await request('/index.html', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 200, 'static files stay public');
});

test('a cached overview says when Torn sent it, so countdowns do not run late by the cache age', async () => {
  torn = 'ok';
  const first = (await request('/api/overview?force=1')).data;
  assert.ok(Math.abs(first.fetchedAt - Date.now()) < 5000);
  await new Promise((resolve) => setTimeout(resolve, 60));
  const cached = (await request('/api/overview')).data;
  assert.equal(cached.fetchedAt, first.fetchedAt, 'the cached reply keeps its own time');
  assert.equal(cached.serverTime, first.serverTime);
});

test('Xanax Today is exact only when the day before was seen just before 18:00 TCT, otherwise a marked bound', async () => {
  torn = 'ok';
  const at = (day, hour, minute = 0) => Date.UTC(2026, 9, day, hour, minute, 0) / 1000;
  const look = async (time, count) => { tornTime = time; xantaken = count; const d = (await request('/api/overview?force=1')).data.drug; return [d.xanToday, d.xanTodayBound, d.xanTodayExact]; };
  // Day of 10 Oct (18:00 TCT on the 10th to 18:00 on the 11th)
  assert.deepEqual(await look(at(10, 20), 10), [0, 'atLeast', false], 'no record from the day before: counted from the first value seen');
  assert.deepEqual(await look(at(10, 22), 11), [1, 'atLeast', false]);
  // Last look at 22:00, next look the following evening: the 2 new ones may have been taken before 18:00
  assert.deepEqual(await look(at(11, 20), 13), [2, 'atMost', false]);
  // Seen at 17:50 (still the day of the 11th), then 2 taken after 18:00: exact
  assert.deepEqual(await look(at(12, 17, 50), 13), [2, 'atMost', false]);
  assert.deepEqual(await look(at(12, 20), 15), [2, 'exact', true]);
  // Last seen at 09:00 (day of the 12th), hours before 18:00, but nothing taken since: none today, exactly
  assert.deepEqual(await look(at(13, 9), 15), [2, 'exact', true]);
  assert.deepEqual(await look(at(13, 21), 15), [0, 'exact', true]);
  tornTime = null; xantaken = 1;
});

test('an FFScouter outage is reported as an outage, not as "key not registered"', async () => {
  ffscouter = 'down';
  const down = await request('/api/ffscouter/check');
  assert.notEqual(down.status, 200); assert.match(down.data.error, /FFScouter is not answering/);
  for (const refused of ['unauthorized', 'unregistered']) {
    ffscouter = refused;
    const check = await request('/api/ffscouter/check');
    assert.deepEqual([check.status, check.data.registered], [200, false], `${refused}: the user is told to register, not to wait`);
  }
  ffscouter = 'ok';
  assert.deepEqual([(await request('/api/ffscouter/check')).status, (await request('/api/ffscouter/check')).data.registered], [200, true]);
});

test('a Custom key that lacks selections the overview needs is accepted with the missing ones named', async () => {
  torn = 'ok';
  keyInfo = { access_level: 0, access_type: 'Custom', selections: { user: ['profile', 'battlestats', 'bars', 'cooldowns', 'travel'] } };
  const custom = await request('/api/auth', { apiKey: KEY });
  assert.equal(custom.status, 200); assert.deepEqual(custom.data.missingSelections, ['education', 'icons', 'personalstats', 'money']);
  keyInfo = { access_level: 3, access_type: 'Limited Access' };
  assert.deepEqual((await request('/api/auth', { apiKey: KEY })).data.missingSelections, []);
});

// Last: the pause it starts would otherwise spill into the tests above.
test('after Torn answers "too many requests" the app stops asking for half a minute', async (t) => {
  const realNow = Date.now.bind(Date); let skew = 0;
  t.mock.method(Date, 'now', () => realNow() + skew);
  for (const mode of ['limit', 'http429']) {
    torn = mode;
    const limited = await request('/api/overview?force=1');
    assert.equal(limited.data.code, 5, mode); assert.match(limited.data.error, /rate limit/i, mode);
    const callsWhenLimited = tornCalls;
    torn = 'ok';
    const paused = await request('/api/overview?force=1');
    assert.equal(paused.data.code, 5, mode); assert.equal(tornCalls, callsWhenLimited, 'no request reaches Torn during the pause');
    skew += 31_000;
    assert.equal((await request('/api/overview?force=1')).status, 200, mode);
  }
});
