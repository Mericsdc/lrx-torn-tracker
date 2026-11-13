const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parseCrx } = require('../src/main/torntools');

// Synthetic CRX3 packages signed with throwaway keys; nothing is downloaded.
const varint = (n) => { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return Buffer.from(out); };
const field = (no, data) => Buffer.concat([varint(no * 8 + 2), varint(data.length), data]);
const der = (keyPair) => keyPair.publicKey.export({ type: 'spki', format: 'der' });
const idOf = (keyPair) => [...crypto.createHash('sha256').update(der(keyPair)).digest('hex').slice(0, 32)]
  .map((ch) => String.fromCharCode(97 + parseInt(ch, 16))).join('');
const rsa = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = () => crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

function crx({ archive = Buffer.from('synthetic archive'), developer, proofs, signedFor = developer, wrongField = false }) {
  const signedData = field(1, crypto.createHash('sha256').update(der(signedFor)).digest().subarray(0, 16));
  const size = Buffer.alloc(4); size.writeUInt32LE(signedData.length);
  const message = Buffer.concat([Buffer.from('CRX3 SignedData\0', 'latin1'), size, signedData, archive]);
  const header = Buffer.concat([
    ...proofs.map(({ keyPair, signWith = keyPair }) => {
      const type = keyPair.publicKey.asymmetricKeyType;
      const no = (type === 'rsa') !== wrongField ? 2 : 3;
      return field(no, Buffer.concat([field(1, der(keyPair)), field(2, crypto.sign('sha256', message, signWith.privateKey))]));
    }),
    field(10000, signedData),
  ]);
  const head = Buffer.alloc(12); head.write('Cr24', 0, 'latin1'); head.writeUInt32LE(3, 4); head.writeUInt32LE(header.length, 8);
  return Buffer.concat([head, header, archive]);
}

const developer = rsa(), store = rsa(), stranger = rsa(), ecdsa = ec();

test('a package signed by the extension key, with a second store signature, is accepted', () => {
  const out = parseCrx(crx({ developer, proofs: [{ keyPair: developer }, { keyPair: store }, { keyPair: ecdsa }] }), idOf(developer));
  assert.equal(out.zip.toString(), 'synthetic archive');
  assert.deepEqual(out.key, der(developer));
});

test('a changed archive, a forged signature or a missing extension signature is rejected', () => {
  const id = idOf(developer);
  const good = crx({ developer, proofs: [{ keyPair: developer }, { keyPair: store }] });
  const tampered = Buffer.from(good); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => parseCrx(tampered, id), /signature/);
  assert.throws(() => parseCrx(crx({ developer, proofs: [{ keyPair: developer }, { keyPair: store, signWith: stranger }] }), id), /signature/);
  assert.throws(() => parseCrx(crx({ developer, proofs: [{ keyPair: store }] }), id), /signature/);
});

test('a validly signed package for another extension is rejected', () => {
  const other = crx({ developer: stranger, proofs: [{ keyPair: stranger }] });
  assert.doesNotThrow(() => parseCrx(other, idOf(stranger)));
  assert.throws(() => parseCrx(other, idOf(developer)), /signature/);
});

test('a key in the wrong proof list, an old CRX2 file and a truncated header are rejected', () => {
  assert.throws(() => parseCrx(crx({ developer, proofs: [{ keyPair: developer }], wrongField: true }), idOf(developer)), /signature/);
  const crx2 = Buffer.alloc(16); crx2.write('Cr24', 0, 'latin1'); crx2.writeUInt32LE(2, 4);
  assert.throws(() => parseCrx(crx2, idOf(developer)), /CRX version/);
  const good = crx({ developer, proofs: [{ keyPair: developer }] });
  assert.throws(() => parseCrx(good.subarray(0, 40), idOf(developer)), /CRX header/);
  assert.throws(() => parseCrx(Buffer.from('PK\x03\x04 not a crx'), idOf(developer)), /not a CRX/);
});
