const { test } = require('node:test');
const assert = require('node:assert/strict');
const { replaceTornCookies, normalizeTornSession } = require('../torn-session');
const { restartApplication } = require('../restart');
test('cookie import removes stale auth/token cookies and retains unrelated domains', async () => {
  const removed = [], set = [];
  const session = { cookies: { get: async () => [
    { name: 'PHPSESSID', domain: '.torn.com', path: '/', value: 'old' },
    { name: 'rfc_v', domain: 'www.torn.com', path: '/', value: 'old-token' },
    { name: 'PHPSESSID', domain: 'example.com', path: '/', value: 'unrelated' },
  ], remove: async (url, name) => removed.push([url, name]), set: async (c) => set.push(c), flushStore: async () => {} } };
  await replaceTornCookies(session, [{ name: 'PHPSESSID', domain: '.torn.com', path: '/', value: 'new', session: true }]);
  assert.equal(removed.length, 2); assert.equal(set.length, 1);
  assert.equal(set[0].value, 'new'); assert.equal(set[0].expirationDate, undefined);
  assert.ok(removed.every(([url]) => url.includes('torn.com')));
});
test('duplicate RFC cookie cleanup restores the preferred token after removal', async () => {
  const operations = [];
  const session = { cookies: { get: async () => [
    { name: 'rfc_v', domain: '.torn.com', path: '/', value: 'stale' },
    { name: 'rfc_v', domain: 'www.torn.com', path: '/', value: 'current' },
  ], remove: async () => operations.push('remove'), set: async (c) => operations.push(c.value), flushStore: async () => {} } };
  await normalizeTornSession(session); assert.deepEqual(operations, ['remove', 'remove', 'current']);
});
test('restart closes child views and every window before exiting old process', () => {
  const calls = [];
  restartApplication({ app: { relaunch: () => calls.push('relaunch'), exit: (code) => calls.push('exit:' + code) },
    windows: [{ isDestroyed: () => false, contentView: { children: [{ webContents: { isDestroyed: () => false, close: () => calls.push('view-close') } }] }, destroy: () => calls.push('window-destroy') }] });
  assert.deepEqual(calls, ['relaunch', 'view-close', 'window-destroy', 'exit:0']);
});
