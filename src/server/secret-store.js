'use strict';
/**
 * Saved secrets in config.json: the Torn API key, the FFScouter key, the log key and the remembered Premium
 * connection.
 *
 * Inside the Electron app they are kept in one encrypted `secrets` entry, sealed with Electron safeStorage (on Windows
 * DPAPI: only this Windows account, with this app profile, can read it). Every other setting stays readable JSON;
 * the Electron main process reads `lang` and `features` from the same file. The plain Node server (`npm run web`) has
 * no safeStorage and keeps the secrets as plain text, as before.
 *
 * A key is never dropped because it could not be encrypted or decrypted:
 * - plain-text keys leave the file only in the same write that adds their encrypted copy, and only after that copy
 *   has been decrypted again and matched;
 * - when encryption fails, the keys are written as plain text instead;
 * - an encrypted entry that can't be read here (another Windows account or PC, a reset app profile, or no
 *   encryption available) stays in the file until new keys are encrypted or the user logs out.
 * A key found as plain text (written by `npm run web`, an older version or by hand) is newer than the encrypted copy.
 */

const SECRET_FIELDS = Object.freeze(['apiKey', 'ffscouterKey', 'logKey', 'premiumConnection']);
const SECRETS_ENTRY = 'secrets';
const FORMAT = 'lrx-secrets';
const VERSION = 1;

/** A value that holds a secret: a non-empty string or a remembered connection object. */
const isSet = (value) => (typeof value === 'string' ? value.length > 0 : value != null && typeof value === 'object');
const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

/** Electron safeStorage (main process only). Encryption is available once the app is ready. */
function electronCipher() {
  const { app, safeStorage } = require('electron');
  return {
    scheme: 'electron-safestorage',
    whenReady: () => app.whenReady(),
    available() {
      if (!safeStorage.isEncryptionAvailable()) return false;
      // Linux without a keyring falls back to a fixed password: that is not protection, keep plain text instead.
      return !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text');
    },
    encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
    decrypt: (data) => safeStorage.decryptString(Buffer.from(data, 'base64')),
  };
}

/** The cipher for this process: safeStorage in the Electron main process, none (plain text) in plain Node. */
function defaultCipher() {
  return process.versions.electron && process.type === 'browser' ? electronCipher() : null;
}

/**
 * @param {null|{scheme:string, whenReady?:()=>Promise<unknown>, available:()=>boolean, encrypt:(text:string)=>string, decrypt:(data:string)=>string}} cipher
 * @param {{log?: (...args: unknown[]) => void}} [options]
 */
function createSecretStore(cipher, { log = () => {} } = {}) {
  let locked = null; // encrypted entry that can't be read here; written back unchanged
  let unreadable = false;
  let mode = 'plain'; // how the secrets are (or will be) stored: 'encrypted' | 'plain'

  const usable = () => {
    if (!cipher) return false;
    try { return cipher.available() === true; } catch (e) { log('encryption check failed:', e.message); return false; }
  };

  /** Reads an encrypted entry. Returns the secrets it holds, or null when it can't be read here. */
  function readEntry(entry) {
    if (!isPlainObject(entry) || entry.format !== FORMAT || typeof entry.data !== 'string' || !entry.data) {
      log('the saved secrets entry has an unknown format; it is kept as it is');
      return null;
    }
    if (entry.version !== VERSION) { log('the saved secrets entry has version', entry.version, '; it is kept as it is'); return null; }
    if (!usable()) { log('encryption is not available; the encrypted keys are kept but cannot be read'); return null; }
    try {
      const values = JSON.parse(cipher.decrypt(entry.data));
      if (!isPlainObject(values)) throw new Error('not an object');
      return values;
    } catch (e) {
      log('the encrypted keys cannot be read here:', e.message);
      return null;
    }
  }

  return {
    /** Cipher that becomes usable later (Electron: after the app is ready), or null when `open` can run now. */
    whenReady: () => (cipher?.whenReady ? cipher.whenReady() : null),

    /** The settings of a config read from disk, without any secret: they are known before the secrets are. */
    settingsOf(raw) {
      const out = {};
      for (const [key, value] of Object.entries(isPlainObject(raw) ? raw : {})) {
        if (key !== SECRETS_ENTRY && !SECRET_FIELDS.includes(key)) out[key] = value;
      }
      return out;
    },

    /**
     * The secrets of a config read from disk. `migrate` is true when plain-text keys should be encrypted now.
     * Never throws: anything it can't read stays on disk as it is.
     */
    open(raw) {
      const disk = isPlainObject(raw) ? raw : {};
      const values = {};
      locked = null; unreadable = false;
      mode = usable() ? 'encrypted' : 'plain';
      const entry = disk[SECRETS_ENTRY];
      if (entry !== undefined) {
        const read = readEntry(entry);
        if (read) {
          for (const field of SECRET_FIELDS) if (read[field] !== undefined) values[field] = read[field];
        } else {
          locked = entry; unreadable = true;
        }
      }
      for (const field of SECRET_FIELDS) {
        const plain = disk[field];
        if (isSet(plain)) values[field] = plain; // newer than the encrypted copy
        else if (plain !== undefined && values[field] === undefined) values[field] = plain; // "no key" (overrides TORN_API_KEY)
      }
      const migrate = mode === 'encrypted' && SECRET_FIELDS.some((field) => isSet(disk[field]));
      return { values, migrate };
    },

    /** The object to write to config.json for this in-memory config. */
    seal(config) {
      const out = {};
      const secrets = {};
      for (const [key, value] of Object.entries(config)) {
        if (SECRET_FIELDS.includes(key)) { if (value !== undefined) secrets[key] = value; }
        else if (key !== SECRETS_ENTRY) out[key] = value;
      }
      const anySet = SECRET_FIELDS.some((field) => isSet(secrets[field]));
      if (anySet && usable()) {
        try {
          const text = JSON.stringify(secrets);
          const data = cipher.encrypt(text);
          if (typeof data !== 'string' || !data) throw new Error('empty result');
          if (cipher.decrypt(data) !== text) throw new Error('read-back mismatch');
          out[SECRETS_ENTRY] = { format: FORMAT, version: VERSION, scheme: cipher.scheme, data };
          locked = null; unreadable = false; mode = 'encrypted';
          return out;
        } catch (e) {
          log('encrypting the keys failed; they are saved as plain text:', e.message);
        }
      }
      // No key to protect (empty values say "no key"), or no encryption here: plain text, as in the plain Node server.
      Object.assign(out, secrets);
      if (anySet) mode = 'plain';
      if (locked) out[SECRETS_ENTRY] = locked; // stays for the account or app that can read it
      return out;
    },

    /** Log Out: forget the encrypted keys this computer can't read as well. */
    discardUnreadable() { locked = null; unreadable = false; },

    /** True while an encrypted entry that can't be read here is kept. */
    get unreadable() { return unreadable; },
    /** 'encrypted' when saved keys are encrypted (or will be), 'plain' when they are saved as plain text. */
    get mode() { return mode; },
  };
}

module.exports = { SECRET_FIELDS, FORMAT, VERSION, isSet, createSecretStore, defaultCipher, electronCipher };
