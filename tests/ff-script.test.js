const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFFScriptProxy, MANAGED_KEY } = require('../ff-script-proxy');
test('FF Scouter uses current saved key, separate-key priority and Torn fallback', async () => {
  const config = { apiKey: 'MainApiKey123456', ffscouterKey: '' };
  const seen = []; let throttled = 0;
  const proxy = createFFScriptProxy(() => config, async (url, options) => {
    seen.push({ url: new URL(url), options });
    return new Response(JSON.stringify({ echo: new URL(url).searchParams.get('key') }), { status: 200 });
  }, async () => throttled++);
  const input = { url: 'https://ffscouter.com/api/v1/check-key?key=' + MANAGED_KEY };
  const first = await proxy.run(input);
  assert.equal(seen.at(-1).url.searchParams.get('key'), config.apiKey);
  assert.ok(!JSON.stringify(first).includes(config.apiKey));
  config.ffscouterKey = 'SeparateKey12345'; await proxy.run(input);
  assert.equal(seen.at(-1).url.searchParams.get('key'), config.ffscouterKey);
  config.ffscouterKey = ''; config.apiKey = 'ChangedKey123456'; await proxy.run(input);
  assert.equal(seen.at(-1).url.searchParams.get('key'), config.apiKey);
  config.ffscouterKey = 'SeparateKey12345';
  await proxy.run({ url: 'https://api.torn.com/user/?selections=basic&key=' + MANAGED_KEY });
  assert.equal(seen.at(-1).url.searchParams.get('key'), config.apiKey); assert.equal(throttled, 1);
  await proxy.run({ url: 'https://ffscouter.com/api/v1/bounties/seller/policy/accept', method: 'POST', data: JSON.stringify({ key: MANAGED_KEY, i_have_read_rules_and_data_policy: true }) });
  assert.equal(JSON.parse(seen.at(-1).options.body).key, config.ffscouterKey);
  config.apiKey = ''; config.ffscouterKey = '';
  await assert.rejects(proxy.run(input), { status: 412 });
});
test('managed key proxy blocks other hosts, redirects and disabled scripts', async () => {
  const config = { apiKey: 'MainApiKey123456', features: {} };
  let count = 0;
  const proxy = createFFScriptProxy(() => config, async (_url, options) => { count++; assert.equal(options.redirect, 'error'); return new Response('{}'); });
  for (const url of ['https://weav3r.dev/?key=x', 'https://ffscouter.com.evil.test/?key=x', 'http://ffscouter.com/?key=x', 'https://user@ffscouter.com/?key=x']) await assert.rejects(proxy.run({ url }), { status: 403 });
  await assert.rejects(proxy.run({ url: 'https://api.torn.com/user/', method: 'POST' }), { status: 403 });
  await proxy.run({ url: 'https://ffscouter.com/api/v1/check-key?key=x' });
  config.features['torn.ffScouterScript'] = false;
  await assert.rejects(proxy.run({ url: 'https://ffscouter.com/api/v1/check-key?key=x' }), { status: 403 });
  assert.equal(count, 1);
});
test('bridge only serves the endpoints the bundled FF Scouter uses and never leaks the key', async () => {
  const config = { apiKey: 'MainApiKey123456', features: {} };
  let count = 0;
  const proxy = createFFScriptProxy(() => config, async () => { count++; return new Response('{}', { headers: { 'x-echo': 'k=MainApiKey123456' } }); });
  for (const [url, method] of [['https://ffscouter.com/api/v1/get-stats?key=x', 'DELETE'], ['https://ffscouter.com/api/v1/x', 'PUT'], ['https://ffscouter.com/account/delete', 'POST'],
    ['https://api.torn.com/user/1/2/3?key=x', 'GET'], ['https://api.torn.com/v2/user/1/extra/path?key=x', 'GET']]) {
    await assert.rejects(proxy.run({ url, method }), { status: 403 }, url);
  }
  const ok = await proxy.run({ url: 'https://ffscouter.com/api/v1/get-stats?key=' + MANAGED_KEY });
  assert.ok(!ok.responseHeaders.includes(config.apiKey));
  await proxy.run({ url: 'https://api.torn.com/v2/user/4242?selections=profile&key=x' });
  const gone = new AbortController(); gone.abort();
  await assert.rejects(proxy.run({ url: 'https://api.torn.com/user/?key=x' }, gone.signal), { status: 499 });
  assert.equal(count, 2);
});
