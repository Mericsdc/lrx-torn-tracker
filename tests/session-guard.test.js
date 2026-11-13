// The session guard runs inside every Torn page and sits in front of Torn's own requests. It may refresh a
// stale security token in a request the player started; it must never change anything else in that request.
// The real helper file is loaded into a stub page: no browser, no network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'torn-helpers', 'session-guard.js'), 'utf8');

function page(cookie) {
  const sent = [];
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype.open = function (_method, url) { this.url = url; };
  XMLHttpRequest.prototype.send = function (body) { sent.push({ via: 'xhr', url: this.url, body }); };
  const window = { URL, URLSearchParams, FormData, Request, Blob, XMLHttpRequest,
    location: { href: 'https://www.torn.com/index.php', pathname: '/index.php', search: '', assign() {} },
    document: { cookie, addEventListener() {}, body: { dataset: {} } },
    fetch: async (input, options) => { sent.push({ via: 'fetch', url: typeof input === 'string' ? input : input.url, body: options?.body }); return {}; } };
  window.window = window;
  vm.runInContext(source, vm.createContext(window));
  const xhr = (url, body) => { const request = new window.XMLHttpRequest(); request.open('POST', url); request.send(body); return sent.at(-1); };
  return { window, sent, xhr };
}

test('only the token changes in a form body: encoding, bare flags and field order stay as Torn sent them', async () => {
  const { window, xhr, sent } = page('PHPSESSID=x; rfc_v=fresh');
  assert.equal(xhr('/page.php?sid=x&rfcv=old', 'a=x%20y&flag&rfcv=old&b=1').body, 'a=x%20y&flag&rfcv=fresh&b=1');
  assert.equal(sent.at(-1).url, 'https://www.torn.com/page.php?sid=x&rfcv=fresh');
  await window.fetch('/properties.php?rfcv=old', { method: 'POST', body: 'rfcv=old&amount=10' });
  assert.deepEqual([sent.at(-1).url, sent.at(-1).body], ['https://www.torn.com/properties.php?rfcv=fresh', 'rfcv=fresh&amount=10']);
  assert.equal(xhr('/page.php', 'step=buy&norfcv=1&xrfcv=old').body, 'step=buy&norfcv=1&xrfcv=old', 'other fields that merely end in "rfcv" are left alone');
});

test('a JSON or other text body is never rewritten as form data', async () => {
  const { window, xhr, sent } = page('rfc_v=fresh');
  const json = '{"url":"/page.php?sid=x&rfcv=old","items":[1,2],"note":"a b&c=d"}';
  assert.equal(xhr('/page.php?sid=inventory', json).body, json);
  await window.fetch('/page.php?sid=inventory', { method: 'POST', body: json });
  assert.equal(sent.at(-1).body, json);
  const list = '[{"rfcv":"old"}]';
  assert.equal(xhr('/page.php', list).body, list);
});

test('URLSearchParams and FormData bodies still get the current token', () => {
  const { xhr } = page('rfc_v=fresh');
  assert.equal(xhr('/page.php', new URLSearchParams({ rfcv: 'old', amount: '10' })).body.toString(), 'rfcv=fresh&amount=10');
  const form = new FormData(); form.append('rfcv', 'old'); form.append('amount', '10');
  assert.deepEqual([...xhr('/page.php', form).body], [['rfcv', 'fresh'], ['amount', '10']]);
  const untouched = new URLSearchParams({ amount: '10' });
  assert.equal(xhr('/page.php', untouched).body, untouched, 'a body without the token is passed through as the same object');
});

test('a malformed token cookie never makes Torn\'s own request throw', async () => {
  const { window, xhr, sent } = page('rfc_v=%E0%A4%A');
  assert.doesNotThrow(() => xhr('/page.php?rfcv=old', 'rfcv=old&amount=10'));
  assert.equal(sent.at(-1).body.endsWith('&amount=10'), true);
  await assert.doesNotReject(window.fetch('/page.php?rfcv=old', { method: 'POST', body: new URLSearchParams({ rfcv: 'old' }) }));
  const form = new FormData(); form.append('rfcv', 'old');
  assert.doesNotThrow(() => xhr('/page.php', form));
});

test('requests to other sites and requests without a token cookie are not touched', async () => {
  const other = page('rfc_v=fresh');
  assert.deepEqual(other.xhr('https://example.invalid/x?rfcv=old', 'rfcv=old'), { via: 'xhr', url: 'https://example.invalid/x?rfcv=old', body: 'rfcv=old' });
  const none = page('PHPSESSID=x');
  assert.deepEqual(none.xhr('/page.php?rfcv=old', 'rfcv=old&a=x%20y'), { via: 'xhr', url: '/page.php?rfcv=old', body: 'rfcv=old&a=x%20y' });
});
