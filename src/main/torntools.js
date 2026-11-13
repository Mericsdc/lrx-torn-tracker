/**
 * TornTools eklentisini Chrome Web Store'dan indirir, açar, Electron'a uyumlu hale getirir.
 * - CRX3 paketini çözer (bağımlılık yok: kendi küçük protobuf + zip okuyucusu)
 * - Paketin imzalarını Chrome gibi doğrular: ID'si TornTools olan anahtar imzalamış olmalı, hiçbir imza bozuk olmamalı
 * - manifest'e Web Store public key'ini yazar → eklenti ID'si sabit kalır (ayarlar güncellemede kaybolmaz)
 * - Electron'da olmayan API'ler için tt-electron-shim.js ekler
 * - Günde bir kez güncelleme kontrolü yapar; ağ yoksa son kurulu sürümü kullanır
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { APP_ROOT, T } = require('../app-paths');

const EXT_ID = 'hjpaapdjcgbmeikfnahipphknonhlhib';
const SHIM_FILE = path.join(APP_ROOT, 'extension-shim', 'tt-electron-shim.js');
const SHIM_VERSION = 2; // shim değişirse artır → eklenti yeniden kurulur
const CHECK_EVERY_MS = 24 * 3600_000;
const EXT_PAGES = ['popup.html', 'options.html', 'targets.html', 'tos.html', 'offscreen.html'];

const crxUrl = () => `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${process.versions.chrome || '140.0.0.0'}&acceptformat=crx3&x=id%3D${EXT_ID}%26uc`;

function varint(buf, p) {
  let r = 0, mul = 1, b;
  do { b = buf[p++]; r += (b & 0x7f) * mul; mul *= 128; } while (b & 0x80);
  return [r, p];
}
function pbFields(buf) {
  const out = [];
  let p = 0;
  while (p < buf.length) {
    const [tag, p1] = varint(buf, p); p = p1;
    const field = Math.floor(tag / 8), wt = tag & 7;
    if (wt === 2) {
      const [len, p2] = varint(buf, p); p = p2;
      if (p + len > buf.length) throw new Error(T('CRX başlığı çözülemedi', 'Could not parse the CRX header'));
      out.push({ field, data: buf.subarray(p, p + len) }); p += len;
    }
    else if (wt === 0) { p = varint(buf, p)[1]; }
    else if (wt === 5) p += 4;
    else if (wt === 1) p += 8;
    else throw new Error(T('CRX başlığı çözülemedi', 'Could not parse the CRX header'));
  }
  return out;
}
const idFromKey = (der) => [...crypto.createHash('sha256').update(der).digest('hex').slice(0, 32)]
  .map((ch) => String.fromCharCode(97 + parseInt(ch, 16))).join('');

// CRX3 imzası (Chromium components/crx_file): her kanıt (2 = RSA, 3 = ECDSA, ikisi de SHA-256) şu baytları imzalar:
// "CRX3 SignedData\0" + signed_header_data uzunluğu (uint32 LE) + signed_header_data + arşiv.
// signed_header_data (alan 10000) içindeki crx_id, eklenti ID'sinin ilk 16 baytıdır.
const CRX3_CONTEXT = Buffer.from('CRX3 SignedData\0', 'latin1');
const KEY_TYPE = { 2: 'rsa', 3: 'ec' };
const badSignature = () => new Error(T('TornTools paketinin imzası doğrulanamadı', 'The TornTools package signature could not be verified'));

function parseCrx(buf, expectedId = EXT_ID) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'Cr24') throw new Error(T('İndirilen dosya CRX değil', 'The downloaded file is not a CRX'));
  const ver = buf.readUInt32LE(4);
  if (ver !== 3) throw new Error(T('Desteklenmeyen CRX sürümü: ', 'Unsupported CRX version: ') + ver);
  const hs = buf.readUInt32LE(8);
  if (12 + hs > buf.length) throw new Error(T('CRX başlığı çözülemedi', 'Could not parse the CRX header'));
  const fields = pbFields(buf.subarray(12, 12 + hs));
  const zip = buf.subarray(12 + hs);

  const signedData = fields.find((f) => f.field === 10000)?.data;
  const crxId = signedData && pbFields(signedData).find((f) => f.field === 1)?.data;
  if (!crxId || crxId.length !== 16) throw badSignature();
  const declaredId = [...crxId.toString('hex')].map((ch) => String.fromCharCode(97 + parseInt(ch, 16))).join('');
  if (declaredId !== expectedId) throw badSignature();
  const size = Buffer.alloc(4);
  size.writeUInt32LE(signedData.length);

  let key = null;
  for (const f of fields) {
    if (!KEY_TYPE[f.field]) continue;
    const proof = pbFields(f.data);
    const der = proof.find((x) => x.field === 1)?.data, signature = proof.find((x) => x.field === 2)?.data;
    if (!der || !signature) throw badSignature();
    let publicKey;
    try { publicKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' }); } catch { throw badSignature(); }
    if (publicKey.asymmetricKeyType !== KEY_TYPE[f.field]) throw badSignature();
    const ok = crypto.createVerify('sha256').update(CRX3_CONTEXT).update(size).update(signedData).update(zip).verify(publicKey, signature);
    if (!ok) throw badSignature(); // Chrome gibi: bozuk tek bir imza bile paketi geçersiz kılar
    if (idFromKey(der) === expectedId) key = der;
  }
  if (!key) throw badSignature(); // TornTools'un kendi anahtarının imzası yok
  return { zip, key };
}

function unzip(buf, dest) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(T('ZIP sonu bulunamadı', 'Could not find the end of the ZIP file'));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const root = path.resolve(dest);
  fs.mkdirSync(root, { recursive: true });
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(T('ZIP dizini bozuk', 'The ZIP directory is corrupt'));
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    const out = path.resolve(root, name);
    if (!out.startsWith(root + path.sep)) continue; // zip-slip koruması
    if (name.endsWith('/')) { fs.mkdirSync(out, { recursive: true }); continue; }
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const data = buf.subarray(start, start + csize);
    let content;
    if (method === 0) content = data;
    else if (method === 8) content = zlib.inflateRawSync(data);
    else throw new Error(T('Desteklenmeyen ZIP sıkıştırması: ', 'Unsupported ZIP compression: ') + method);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, content);
  }
}

function patchExtension(dir, key) {
  const mfile = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(mfile, 'utf8'));
  if (key) manifest.key = key.toString('base64');
  delete manifest.update_url;
  fs.writeFileSync(mfile, JSON.stringify(manifest, null, 2));
  // "_" ile başlayan klasörler paketsiz yüklemede reddedilir
  fs.rmSync(path.join(dir, '_metadata'), { recursive: true, force: true });

  const shim = fs.readFileSync(SHIM_FILE, 'utf8');
  fs.writeFileSync(path.join(dir, 'tt-electron-shim.js'), shim);
  const bgName = manifest.background?.service_worker;
  if (bgName) {
    const bg = path.join(dir, bgName);
    fs.writeFileSync(bg, shim + '\n;\n' + fs.readFileSync(bg, 'utf8'));
  }
  for (const page of EXT_PAGES) {
    const f = path.join(dir, page);
    if (!fs.existsSync(f)) continue;
    const html = fs.readFileSync(f, 'utf8');
    if (html.includes('tt-electron-shim.js')) continue;
    fs.writeFileSync(f, html.replace(/<head>/i, '<head>\n\t\t<script src="/tt-electron-shim.js"></script>'));
  }
  return manifest;
}

const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };

/**
 * @returns {Promise<{dir: string, version: string, updated: boolean, error?: string}>}
 */
async function ensureTornTools({ baseDir, log = () => {}, force = false }) {
  const root = path.join(baseDir, 'extensions', 'torntools');
  fs.mkdirSync(root, { recursive: true });
  const stateFile = path.join(root, 'state.json');
  const st = readJson(stateFile, {});
  const currentDir = st.dir && fs.existsSync(path.join(root, st.dir, 'manifest.json')) ? path.join(root, st.dir) : null;
  const fresh = currentDir && st.shim === SHIM_VERSION && Date.now() - (st.checkedAt || 0) < CHECK_EVERY_MS;
  if (fresh && !force) return { dir: currentDir, version: st.version, updated: false };

  let tmp = null;
  try {
    const res = await fetch(crxUrl(), { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': `Mozilla/5.0 Chrome/${process.versions.chrome}` } });
    if (!res.ok) throw new Error(`Chrome Web Store HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const { zip, key } = parseCrx(buf);
    tmp = path.join(root, `tmp-${Date.now()}`);
    unzip(zip, tmp);
    const version = readJson(path.join(tmp, 'manifest.json'), {}).version;
    if (!version) throw new Error(T('manifest.json okunamadı', 'Could not read manifest.json'));

    if (currentDir && st.version === version && st.shim === SHIM_VERSION) {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.writeFileSync(stateFile, JSON.stringify({ ...st, checkedAt: Date.now() }, null, 2));
      return { dir: currentDir, version, updated: false };
    }
    patchExtension(tmp, key);
    const finalName = `v${version}-${Date.now()}`;
    fs.renameSync(tmp, path.join(root, finalName));
    tmp = null;
    fs.writeFileSync(stateFile, JSON.stringify({ dir: finalName, version, checkedAt: Date.now(), shim: SHIM_VERSION }, null, 2));
    for (const d of fs.readdirSync(root)) {
      if (d !== finalName && d !== 'state.json') fs.rmSync(path.join(root, d), { recursive: true, force: true });
    }
    log('TornTools kuruldu:', version);
    return { dir: path.join(root, finalName), version, updated: true };
  } catch (e) {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    log('TornTools indirme/güncelleme hatası:', e.message);
    if (currentDir) return { dir: currentDir, version: st.version, updated: false, error: e.message };
    throw e;
  }
}

module.exports = { ensureTornTools, unzip, parseCrx };
