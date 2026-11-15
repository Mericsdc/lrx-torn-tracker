// Merit Tracker data: /api/awards tags every measurable missing award with the personal stat its rule reads (`stat`)
// and the rule's text capture (`what`), so the page can say what to do and where. Synthetic key and Torn replies only;
// any request that is not api.torn.com fails the test.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-awards-tests-'));
process.env.TORN_DATA_DIR = temp;
process.env.TORN_API_KEY = '';
process.env.TORN_PREMIUM_SERVICE_URL = '';
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ apiKey: 'AwardsKey000001', features: { 'page.travel': false } }));

const HONORS = [
  { id: 1, name: 'Looting Luminary', description: 'Commit 4,000 Theft offenses', type: { title: 'crime' }, circulation: 100591, rarity: 'Common' },
  { id: 2, name: 'Act Of Faith', description: 'Achieve 100 finishing hits with SMGs', type: { title: 'weapons' }, circulation: 66281 },
  { id: 3, name: 'Protege', description: 'Complete the mission Introduction: Duke', type: { title: 'missions' }, circulation: 275340 },
  { id: 4, name: 'Draw', description: 'Stalemate 100 times', type: { title: 'attacking' }, circulation: 30000 },
  { id: 5, name: 'Owned One', description: 'Commit 100 Theft offenses', type: { title: 'crime' }, circulation: 500000 },
  { id: 6, name: 'Workaholic', description: 'Achieve 10,000 in any working stat', type: { title: 'education' }, circulation: 20000 },
  { id: 7, name: 'Jetsetter', description: 'Travel to Japan 50 times', type: { title: 'travel' }, circulation: 15000 },
  { id: 8, name: 'Half Way There', description: 'Reach level 50', type: { title: 'level' }, circulation: 58957 },
  { id: 9, name: 'Wise Guy', description: 'Complete 50 education courses', type: { title: 'education' }, circulation: 90135 },
];
const MEDALS = [
  { id: 101, name: 'Level Forty Five', description: 'Reach level Forty Five', type: { title: 'level' }, circulation: 68973 },
  { id: 102, name: 'Master', description: 'Reach the rank of Master', type: { title: 'rank' }, circulation: 68009 },
  { id: 103, name: 'One Year of Service', description: 'Live in Torn for one year', type: { title: 'commitment' }, circulation: 387758 },
  { id: 104, name: 'Diamond Anniversary', description: 'Stay married to a single person for 300 days without divorce', type: { title: 'commitment' }, circulation: 165132 },
];
const STATS = {
  crimes: { offenses: { theft: 3829 } },
  finishing_hits: { sub_machine_guns: 92 },
  attacking: { attacks: { stalemate: 4 }, defends: { stalemate: 5 } },
  jobs: { stats: { endurance: 2000, intelligence: 9000, manual: 100 } },
  travel: { japan: 12 },
};
const PROFILE = { level: 42, age: 326, rank: 'Professional Hustler', married: { duration: 261 }, faction: { days_in_faction: 7 } };

const realFetch = global.fetch;
const reply = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });
global.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.torn.com') throw new Error('Unexpected external request: ' + url.hostname);
  if (url.pathname === '/v2/torn/honors') return reply({ honors: HONORS });
  if (url.pathname === '/v2/torn/medals') return reply({ medals: MEDALS });
  if (url.pathname === '/v2/user/honors') return reply({ honors: [{ id: 5, timestamp: 1 }] });
  if (url.pathname === '/v2/user/medals') return reply({ medals: [] });
  if (url.pathname === '/v2/user/personalstats') return reply({ personalstats: STATS });
  if (url.pathname === '/user/') return reply(PROFILE);
  return reply({});
};

const { server, flushData } = require('../src/server/server');
const ready = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
async function get(route) {
  await ready;
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: server.address().port, path: route }, (res) => {
      let text = ''; res.on('data', (c) => text += c); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text) }));
    }).on('error', reject);
  });
}
after(async () => {
  global.fetch = realFetch; flushData(); await new Promise((resolve) => server.close(resolve));
  const resolved = path.resolve(temp), root = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(root) || !path.basename(resolved).startsWith('lrx-awards-tests-')) throw new Error('Unsafe test cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});

let awards;
const byName = (name) => awards.find((a) => a.name === name);
test('/api/awards answers with the synthetic catalogue', async () => {
  const r = await get('/api/awards');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  awards = r.data.awards;
  assert.equal(awards.length, HONORS.length + MEDALS.length);
});

test('a counted rule names its personal stat and its text capture', () => {
  assert.deepEqual(pick(byName('Looting Luminary')), { stat: 'crimes.offenses.theft', what: 'Theft', cur: 3829, goal: 4000 });
  assert.deepEqual(pick(byName('Act Of Faith')), { stat: 'finishing_hits.sub_machine_guns', what: 'SMGs', cur: 92, goal: 100 });
  assert.deepEqual(pick(byName('Jetsetter')), { stat: 'travel.japan', what: 'Japan', cur: 12, goal: 50 });
});

test('a rule that reads several stats joins them with |', () => {
  assert.equal(byName('Draw').stat, 'attacking.attacks.stalemate|attacking.defends.stalemate');
  assert.equal(byName('Draw').cur, 9);
  assert.equal(byName('Workaholic').stat, 'jobs.stats.endurance|jobs.stats.intelligence|jobs.stats.manual');
  assert.equal(byName('Workaholic').what, null);
});

test('profile-based rules have their own stat ids', () => {
  assert.deepEqual(pick(byName('Level Forty Five')), { stat: 'level', what: null, cur: 42, goal: 45 });
  assert.deepEqual(pick(byName('Half Way There')), { stat: 'level', what: null, cur: 42, goal: 50 });
  assert.deepEqual(pick(byName('Master')), { stat: 'rank', what: 'Master', cur: 14, goal: 16 });
  assert.deepEqual(pick(byName('One Year of Service')), { stat: 'age', what: null, cur: 326, goal: 365 });
  assert.deepEqual(pick(byName('Diamond Anniversary')), { stat: 'married', what: null, cur: 261, goal: 300 });
  assert.equal(byName('Wise Guy').stat, 'education');
});

test('one-time and owned awards have no stat', () => {
  assert.equal(byName('Protege').stat, null);
  assert.equal(byName('Protege').what, null);
  assert.equal(byName('Owned One').owned, true);
  assert.equal(byName('Owned One').stat, null);
});

function pick(a) { return { stat: a.stat, what: a.what, cur: a.cur, goal: a.goal }; }
