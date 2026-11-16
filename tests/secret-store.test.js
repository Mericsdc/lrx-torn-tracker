// Saved keys are encrypted at rest in the Electron app and plain text in `npm run web` (src/server/secret-store.js).
// A stand-in cipher plays Electron safeStorage: what one "Windows account" encrypts, another can't decrypt.
// Synthetic keys only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSecretStore, defaultCipher, SECRET_FIELDS } = require('../src/server/secret-store');
const { fakeCipher } = require('./fake-secret-cipher');

const KEY = 'SecretTestKey001', FF = 'SecretTestFFKey1', LOG = 'SecretTestLogKy1', NEW_KEY = 'SecretTestKey002';
const CONNECTION = { serviceUrl: 'https://premium.example.test', session: 'synthetic-session-token' };
const SETTINGS = { lang: 'tr', theme: 'ocean', coverDays: 4, features: { 'page.travel': false } };

// What saveConfig writes: the sealed object as JSON, read back the way the next start reads it.
const roundTrip = (value) => JSON.parse(JSON.stringify(value));
const mentionsAKey = (value) => [KEY, FF, LOG, NEW_KEY, CONNECTION.session].some((secret) => JSON.stringify(value).includes(secret));
const startsWith = (store, raw) => ({ ...store.settingsOf(raw), ...store.open(raw).values });

test('without a cipher (npm run web) keys stay plain text, as before', () => {
  const store = createSecretStore(null);
  assert.equal(store.whenReady(), null, 'opens at once');
  const { values, migrate } = store.open({ ...SETTINGS, apiKey: KEY, ffscouterKey: FF });
  assert.deepEqual(values, { apiKey: KEY, ffscouterKey: FF });
  assert.equal(migrate, false);
  assert.equal(store.mode, 'plain');
  const disk = store.seal({ ...SETTINGS, apiKey: KEY, ffscouterKey: FF, logKey: '' });
  assert.deepEqual(disk, { ...SETTINGS, apiKey: KEY, ffscouterKey: FF, logKey: '' });
  assert.equal(defaultCipher(), null, 'plain Node has no safeStorage');
});

test('plain-text keys from an older version are encrypted on the first start, settings stay readable', () => {
  const store = createSecretStore(fakeCipher());
  const legacy = { ...SETTINGS, apiKey: KEY, ffscouterKey: FF, logKey: LOG, premiumConnection: CONNECTION };
  const { values, migrate } = store.open(legacy);
  assert.equal(migrate, true);
  assert.deepEqual(values, { apiKey: KEY, ffscouterKey: FF, logKey: LOG, premiumConnection: CONNECTION });
  const disk = roundTrip(store.seal({ ...store.settingsOf(legacy), ...values }));
  assert.equal(mentionsAKey(disk), false, 'no key or session in the file');
  for (const field of SECRET_FIELDS) assert.equal(field in disk, false, field + ' is not written as plain text');
  assert.deepEqual({ ...disk, secrets: undefined }, { ...SETTINGS, secrets: undefined }, 'lang, theme and features stay readable');
  assert.equal(disk.secrets.format, 'lrx-secrets'); assert.equal(disk.secrets.scheme, 'test-cipher');
  assert.equal(store.mode, 'encrypted');

  const next = createSecretStore(fakeCipher());
  const reopened = next.open(disk);
  assert.equal(reopened.migrate, false);
  assert.deepEqual(reopened.values, values, 'every key comes back');
  assert.equal(next.unreadable, false);
});

test('keys encrypted by another Windows account are reported and kept until a new key is saved', () => {
  const sealed = roundTrip(createSecretStore(fakeCipher('alice')).seal({ ...SETTINGS, apiKey: KEY, ffscouterKey: FF }));
  const store = createSecretStore(fakeCipher('bob'));
  const config = { apiKey: '', ffscouterKey: '', ...startsWith(store, sealed) };
  assert.equal(store.unreadable, true);
  assert.equal(config.apiKey, '', 'asks for the key again');
  assert.equal(store.open(sealed).migrate, false);

  // A settings change before signing in writes the unreadable entry back unchanged.
  const afterSettings = roundTrip(store.seal({ ...config, theme: 'forest' }));
  assert.deepEqual(afterSettings.secrets, sealed.secrets);
  assert.equal(afterSettings.theme, 'forest');
  assert.equal(createSecretStore(fakeCipher('alice')).open(afterSettings).values.apiKey, KEY, 'the owner can still read it');

  // Signing in with a new key replaces it with one this account can read.
  const afterSignIn = roundTrip(store.seal({ ...config, apiKey: NEW_KEY }));
  assert.equal(store.unreadable, false);
  assert.equal(mentionsAKey(afterSignIn), false);
  assert.equal(createSecretStore(fakeCipher('bob')).open(afterSignIn).values.apiKey, NEW_KEY);
});

test('Log Out leaves empty plain values (so TORN_API_KEY does not come back) and drops unreadable keys', () => {
  const store = createSecretStore(fakeCipher());
  store.open({ ...SETTINGS, apiKey: KEY });
  const disk = roundTrip(store.seal({ ...SETTINGS, apiKey: '', ffscouterKey: '', logKey: '' }));
  assert.deepEqual(disk, { ...SETTINGS, apiKey: '', ffscouterKey: '', logKey: '' });
  assert.equal(createSecretStore(fakeCipher()).open(disk).values.apiKey, '', 'an empty key still overrides the env default');

  const foreign = roundTrip(createSecretStore(fakeCipher('alice')).seal({ apiKey: KEY }));
  const other = createSecretStore(fakeCipher('bob'));
  other.open(foreign);
  other.discardUnreadable();
  assert.deepEqual(roundTrip(other.seal({ apiKey: '' })), { apiKey: '' });
  assert.equal(other.unreadable, false);
});

test('without encryption available, plain keys are kept and an encrypted entry survives a plain-text sign-in', () => {
  const unavailable = createSecretStore(fakeCipher('alice', { available: false }));
  const plain = unavailable.open({ apiKey: KEY, logKey: LOG });
  assert.deepEqual(plain.values, { apiKey: KEY, logKey: LOG });
  assert.equal(plain.migrate, false, 'nothing to encrypt with: the file is left as it is');
  assert.equal(unavailable.mode, 'plain');

  // `npm run web` (or DPAPI not working) on a folder the desktop app encrypted.
  const sealed = roundTrip(createSecretStore(fakeCipher('alice')).seal({ apiKey: KEY, ffscouterKey: FF }));
  const web = createSecretStore(null);
  assert.deepEqual(web.open(sealed).values, {});
  assert.equal(web.unreadable, true);
  const afterWebSignIn = roundTrip(web.seal({ apiKey: NEW_KEY, ffscouterKey: '' }));
  assert.equal(afterWebSignIn.apiKey, NEW_KEY);
  assert.deepEqual(afterWebSignIn.secrets, sealed.secrets, 'the encrypted keys are not dropped');

  // Back in the desktop app: the newer plain key wins, the FFScouter key comes back, all of it is encrypted again.
  const desktop = createSecretStore(fakeCipher('alice'));
  const back = desktop.open(afterWebSignIn);
  assert.deepEqual(back.values, { apiKey: NEW_KEY, ffscouterKey: FF });
  assert.equal(back.migrate, true);
  assert.equal(mentionsAKey(roundTrip(desktop.seal({ ...back.values }))), false);
});

test('a key is never lost when encryption fails or does not read back', () => {
  for (const encrypt of [() => { throw new Error('DPAPI failed'); }, () => '', (text) => Buffer.from(JSON.stringify({ account: 'alice', hex: '00' })).toString('base64')]) {
    const store = createSecretStore(fakeCipher('alice', { encrypt }));
    const disk = roundTrip(store.seal({ ...SETTINGS, apiKey: KEY, logKey: LOG }));
    assert.equal(disk.apiKey, KEY); assert.equal(disk.logKey, LOG);
    assert.equal('secrets' in disk, false);
    assert.equal(store.mode, 'plain');
  }
});

test('an empty plain value never hides an encrypted key, a non-empty one is newer', () => {
  const sealed = roundTrip(createSecretStore(fakeCipher()).seal({ apiKey: KEY, ffscouterKey: FF }));
  const store = createSecretStore(fakeCipher());
  assert.deepEqual(store.open({ ...sealed, apiKey: '', logKey: '' }).values, { apiKey: KEY, ffscouterKey: FF, logKey: '' });
  const edited = store.open({ ...sealed, apiKey: NEW_KEY });
  assert.equal(edited.values.apiKey, NEW_KEY);
  assert.equal(edited.migrate, true);
});

test('unknown or damaged entries are kept as they are, and odd files never throw', () => {
  for (const entry of [{ format: 'lrx-secrets', version: 99, data: 'AAAA' }, { format: 'other', data: 'AAAA' }, 'not-an-object', { format: 'lrx-secrets', version: 1, data: 'bm90LWpzb24=' }]) {
    const store = createSecretStore(fakeCipher());
    assert.deepEqual(store.open({ secrets: entry }).values, {});
    assert.equal(store.unreadable, true);
    assert.deepEqual(roundTrip(store.seal({ apiKey: '' })).secrets, entry);
  }
  for (const raw of [null, undefined, [], 'text', 7]) {
    const store = createSecretStore(fakeCipher());
    assert.deepEqual(store.open(raw), { values: {}, migrate: false });
    assert.deepEqual(store.settingsOf(raw), {});
  }
  const throwing = createSecretStore({ ...fakeCipher(), available: () => { throw new Error('not ready'); } });
  assert.deepEqual(throwing.open({ apiKey: KEY }).values, { apiKey: KEY });
  assert.equal(throwing.mode, 'plain');
});
