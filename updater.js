/**
 * Uygulama içi güncelleme.
 * Güncelleme kaynağı bir JSON manifest URL'sidir (Ayarlar → Güncelleme adresi), örn.
 *   https://github.com/<kullanici>/<repo>/releases/latest/download/latest.json
 * Manifest:  { "version": "1.2.0", "url": "torntracker-app-1.2.0.zip", "sha256": "<hex>", "notes": "..." }
 * (url, manifest adresine göre göreli olabilir). Paketi tools/make-update.js üretir.
 *
 * Güncelleme yalnızca uygulama dosyalarını (resources/app) değiştirir; .exe ve kullanıcı verisi
 * (data/ klasörü) olduğu gibi kalır. Önceki sürüm resources/app-backup klasörüne yedeklenir.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { unzip } = require('./torntools');

const APP_DIR = __dirname;
const SKIP = new Set(['data', 'node_modules', 'dist', '.git']);

// Language of user-facing messages: English by default, Turkish when the app is set to TR.
// Reads the same config.json as server.js (electron-main sets TORN_DATA_DIR before loading this module).
const T = (trStr, enStr) => {
  let lang = 'en';
  try { lang = JSON.parse(fs.readFileSync(path.join(process.env.TORN_DATA_DIR || path.join(APP_DIR, 'data'), 'config.json'), 'utf8')).lang; } catch {}
  return lang === 'tr' ? trStr : enStr;
};

function cmpVersion(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

const currentVersion = () => {
  try { return JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; }
};

async function fetchManifest(manifestUrl) {
  if (!/^https:\/\//i.test(String(manifestUrl || ''))) throw new Error(T('Güncelleme adresi https:// ile başlamalı.', 'The update URL must start with https://.'));
  const res = await fetch(manifestUrl, { headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'TornTracker-Updater' }, redirect: 'follow' });
  if (!res.ok) throw new Error(T(`Güncelleme bilgisi alınamadı (HTTP ${res.status})`, `Could not get update info (HTTP ${res.status})`));
  const m = await res.json();
  if (!m.version || !m.url || !/^[a-f0-9]{64}$/i.test(m.sha256 || '')) throw new Error(T('Güncelleme manifesti eksik/hatalı (version, url, sha256 gerekli).', 'The update manifest is incomplete or invalid (version, url and sha256 are required).'));
  // Göreli paket adı, yönlendirme sonrası adrese (res.url) değil, ayarlardaki manifest adresine göre çözülür:
  // GitHub manifesti imzalı bir CDN adresine yönlendirir, oraya göre çözülen adres HTTP 618 verir.
  m.url = new URL(m.url, manifestUrl).toString();
  if (!/^https:\/\//i.test(m.url)) throw new Error(T('Güncelleme paketi https olmalı.', 'The update package must use https.'));
  return m;
}

async function checkForUpdate(manifestUrl) {
  const current = currentVersion();
  const m = await fetchManifest(manifestUrl);
  return { current, latest: m.version, available: cmpVersion(m.version, current) > 0, notes: m.notes || '', url: m.url, sha256: m.sha256 };
}

function copyDir(src, dst, skipTop = false) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (skipTop && SKIP.has(ent.name)) continue;
    const s = path.join(src, ent.name), d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** İndirir, doğrular, uygular. Başarılıysa true döner; çağıran uygulamayı yeniden başlatmalı. */
async function applyUpdate(manifestUrl, onProgress = () => {}) {
  const m = await fetchManifest(manifestUrl);
  if (cmpVersion(m.version, currentVersion()) <= 0) throw new Error(T('Zaten en güncel sürümdesin.', 'You already have the latest version.'));
  onProgress({ step: 'download', message: T(`v${m.version} indiriliyor…`, `Downloading v${m.version}…`) });
  const res = await fetch(m.url, { redirect: 'follow', headers: { 'User-Agent': 'TornTracker-Updater' } });
  if (!res.ok) throw new Error(T(`Paket indirilemedi (HTTP ${res.status})`, `Could not download the package (HTTP ${res.status})`));
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  if (hash.toLowerCase() !== m.sha256.toLowerCase()) throw new Error(T('Paket doğrulanamadı (sha256 uyuşmuyor). Güncelleme iptal edildi.', 'Package verification failed (sha256 mismatch). Update canceled.'));

  onProgress({ step: 'extract', message: T('Paket açılıyor…', 'Unpacking…') });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'torntracker-update-'));
  try {
    unzip(buf, tmp);
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
    if (!fs.existsSync(path.join(tmp, pkg.main || 'electron-main.js'))) throw new Error(T('Paket geçersiz (ana dosya yok).', 'Invalid package (main file missing).'));
    if (cmpVersion(pkg.version, m.version) !== 0) throw new Error(T('Paket sürümü manifestle uyuşmuyor.', 'The package version does not match the manifest.'));

    onProgress({ step: 'install', message: T('Kuruluyor…', 'Installing…') });
    const backup = path.join(path.dirname(APP_DIR), 'app-backup');
    fs.rmSync(backup, { recursive: true, force: true });
    copyDir(APP_DIR, backup, true);
    copyDir(tmp, APP_DIR, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  onProgress({ step: 'done', message: T(`v${m.version} kuruldu, yeniden başlatılıyor…`, `v${m.version} installed, restarting…`) });
  return true;
}

module.exports = { checkForUpdate, applyUpdate, currentVersion, cmpVersion };
