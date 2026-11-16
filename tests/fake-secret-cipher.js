// Stand-in for Electron safeStorage in tests (src/server/secret-store.js cipher interface): what one "Windows
// account" encrypts, another can't decrypt. Not encryption: it only keeps the key text out of the file.
function fakeCipher(account = 'alice', { available = true, encrypt = null, whenReady = null } = {}) {
  return {
    scheme: 'test-cipher',
    ...(whenReady ? { whenReady } : {}),
    available: () => available,
    encrypt: encrypt || ((text) => Buffer.from(JSON.stringify({ account, hex: Buffer.from(text).toString('hex') })).toString('base64')),
    decrypt(data) {
      const box = JSON.parse(Buffer.from(data, 'base64').toString());
      if (box.account !== account) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      return Buffer.from(box.hex, 'hex').toString();
    },
  };
}

module.exports = { fakeCipher };
