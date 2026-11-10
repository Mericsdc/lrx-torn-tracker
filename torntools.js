/**
 * TornTools eklentisini Chrome Web Store'dan indirir, açar, Electron'a uyumlu hale getirir.
 * - CRX3 paketini çözer (bağımlılık yok: kendi küçük protobuf + zip okuyucusu)
 * - manifest'e Web Store public key'ini yazar → eklenti ID'si sabit kalır (ayarlar güncellemede kaybolmaz)
 * - Electron'da olmayan API'ler için tt-electron-shim.js ekler
 * - Günde bir kez güncelleme kontrolü yapar; ağ yoksa son kurulu sürümü kullanır
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const EXT_ID = 'hjpaapdjcgbmeikfnahipphknonhlhib';
const SHIM_FILE = path.join(__dirname, 'extension-shim', 'tt-electron-shim.js');
const SHIM_VERSION = 2; // shim değişirse artır → eklenti yeniden kurulur
const CHECK_EVERY_MS = 24 * 3600_000;
const EXT_PAGES = ['popup.html', 'options.html', 'targets.html', 'tos.html', 'offscreen.html'];

// Language of user-facing messages: English by default, Turkish when the app is set to TR.
// Reads the same config.json as server.js (electron-main sets TORN_DATA_DIR before loading this module).
const T = (trStr, enStr) => {
  let lang = 'en';
  try { lang = JSON.parse(fs.readFileSync(path.join(process.env.TORN_DATA_DIR || path.join(__dirname, 'data'), 'config.json'), 'utf8')).lang; } catch {}
  return lang === 'tr' ? trStr : enStr;
};

const crxUrl = () => `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${process.versions.chrome || '140.0.0.0'}&acceptformat=crx2,crx3&x=id%3D${EXT_ID}%26uc`;

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
    if (wt === 2) { const [len, p2] = varint(buf, p); p = p2; out.push({ field, data: buf.subarray(p, p + len) }); p += len; }
    else if (wt === 0) { p = varint(buf, p)[1]; }
    else if (wt === 5) p += 4;
    else if (wt === 1) p += 8;
    else throw new Error(T('CRX başlığı çözülemedi', 'Could not parse the CRX header'));
  }
  return out;
}
const idFromKey = (der) => [...crypto.createHash('sha256').update(der).digest('hex').slice(0, 32)]
  .map((ch) => String.fromCharCode(97 + parseInt(ch, 16))).join('');

function parseCrx(buf) {
  if (buf.toString('latin1', 0, 4) !== 'Cr24') throw new Error(T('İndirilen dosya CRX değil', 'The downloaded file is not a CRX'));
  const ver = buf.readUInt32LE(4);
  if (ver === 3) {
    const hs = buf.readUInt32LE(8);
    const header = buf.subarray(12, 12 + hs);
    const keys = pbFields(header)
      .filter((f) => f.field === 2 || f.field === 3)
      .map((f) => pbFields(f.data).find((x) => x.field === 1)?.data)
      .filter(Boolean);
    return { zip: buf.subarray(12 + hs), key: keys.find((k) => idFromKey(k) === EXT_ID) || null };
  }
  if (ver === 2) {
    const kl = buf.readUInt32LE(8), sl = buf.readUInt32LE(12);
    const key = buf.subarray(16, 16 + kl);
    return { zip: buf.subarray(16 + kl + sl), key: idFromKey(key) === EXT_ID ? key : null };
  }
  throw new Error(T('Desteklenmeyen CRX sürümü: ', 'Unsupported CRX version: ') + ver);
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
    if (!key) log('TornTools: Web Store anahtarı bulunamadı, eklenti ID’si farklı olabilir');
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

module.exports = { ensureTornTools, unzip };
