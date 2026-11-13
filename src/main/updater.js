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
const { APP_ROOT: APP_DIR, T } = require('../app-paths');

const SKIP = new Set(['data', 'node_modules', 'dist', '.git']);

// Before the code moved into src/, these files sat in the app folder itself. Installing an update only
// adds and replaces files, so installs updated from an older version still have them. Nothing loads them.
const LEGACY_FILES = [
  'battle-stats.js', 'electron-main.js', 'external-login.js', 'ff-script-proxy.js', 'preload.js', 'premium-client.js',
  'premium-url.js', 'restart.js', 'server.js', 'torn-session.js', 'torntools.js', 'updater.js', 'userscripts.js', 'war-groups.js',
  'RELEASE-NOTES-1.6.9.md', 'RELEASE-NOTES-1.6.10.md', 'RELEASE-NOTES-1.6.11.md', 'RELEASE-NOTES-1.6.12.md', 'TESTING.md', 'WEBSITE.md',
];

/** Deletes the leftovers above from an installed copy. Never runs in a Git checkout. Returns the removed names. */
function removeLegacyFiles(appDir = APP_DIR) {
  if (fs.existsSync(path.join(appDir, '.git')) || !fs.existsSync(path.join(appDir, 'src', 'main', 'electron-main.js'))) return [];
  const removed = [];
  for (const name of LEGACY_FILES) {
    const file = path.join(appDir, name);
    try { if (fs.lstatSync(file).isFile()) { fs.unlinkSync(file); removed.push(name); } } catch {}
  }
  return removed;
}

function cmpVersion(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

const currentVersion = (appDir = APP_DIR) => {
  try { return JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; }
};

async function fetchManifest(manifestUrl, fetchImpl = fetch) {
  if (!/^https:\/\//i.test(String(manifestUrl || ''))) throw new Error(T('Güncelleme adresi https:// ile başlamalı.', 'The update URL must start with https://.'));
  let res;
  try { res = await fetchImpl(manifestUrl, { headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'TornTracker-Updater' }, redirect: 'follow', signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error(T('Güncelleme sunucusuna ulaşılamadı. İnternet bağlantını kontrol et.', 'Could not reach the update server. Check your internet connection.')); }
  if (!res.ok) throw new Error(T(`Güncelleme bilgisi alınamadı (HTTP ${res.status})`, `Could not get update info (HTTP ${res.status})`));
  let m = null;
  try { m = await res.json(); } catch {}
  if (!m || typeof m !== 'object' || !m.version || typeof m.url !== 'string' || !m.url || !/^[a-f0-9]{64}$/i.test(m.sha256 || '')) throw new Error(T('Güncelleme manifesti eksik/hatalı (version, url, sha256 gerekli).', 'The update manifest is incomplete or invalid (version, url and sha256 are required).'));
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

/** Copies a folder. `written` collects every destination file (relative path) BEFORE it is replaced. */
function copyDir(src, dst, skipTop = false, written = null, base = '') {
  fs.mkdirSync(dst, { recursive: true });
  // Name order (not the file system's order): an install that fails part-way fails the same way everywhere
  const entries = fs.readdirSync(src, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const ent of entries) {
    if (skipTop && SKIP.has(ent.name)) continue;
    const s = path.join(src, ent.name), d = path.join(dst, ent.name), rel = base ? `${base}/${ent.name}` : ent.name;
    if (ent.isDirectory()) copyDir(s, d, false, written, rel);
    else { written?.push(rel); fs.copyFileSync(s, d); }
  }
}

/** Undoes a partly copied install: replaced files come back from the backup, files that are new are removed. */
function restoreFromBackup(appDir, backup, written) {
  let complete = true;
  for (const rel of [...written].reverse()) {
    const target = path.join(appDir, rel), saved = path.join(backup, rel);
    try {
      const old = fs.statSync(saved, { throwIfNoEntry: false });
      if (old?.isFile()) fs.copyFileSync(saved, target);
      else if (!old && fs.statSync(target, { throwIfNoEntry: false })?.isFile()) fs.unlinkSync(target);
    } catch { complete = false; }
  }
  return complete;
}

/**
 * İndirir, doğrular, uygular. Başarılıysa true döner; çağıran uygulamayı yeniden başlatmalı.
 * Nothing in the app folder changes until the package is downloaded, verified and unpacked; a copy that fails
 * half-way is undone. `options` exists for tests (a synthetic app folder and a stubbed download).
 */
async function applyUpdate(manifestUrl, onProgress = () => {}, { appDir = APP_DIR, fetchImpl = fetch } = {}) {
  const m = await fetchManifest(manifestUrl, fetchImpl);
  if (cmpVersion(m.version, currentVersion(appDir)) <= 0) throw new Error(T('Zaten en güncel sürümdesin.', 'You already have the latest version.'));
  onProgress({ step: 'download', message: T(`v${m.version} indiriliyor…`, `Downloading v${m.version}…`) });
  let res, buf;
  try {
    res = await fetchImpl(m.url, { redirect: 'follow', headers: { 'User-Agent': 'TornTracker-Updater' }, signal: AbortSignal.timeout(120000) });
    if (res.ok) buf = Buffer.from(await res.arrayBuffer());
  } catch {
    throw new Error(T('Paket indirilemedi: bağlantı kesildi ya da zaman aşımına uğradı. Hiçbir şey değiştirilmedi, tekrar dene.', 'Could not download the package: the connection dropped or timed out. Nothing was changed, please try again.'));
  }
  if (!res.ok) throw new Error(T(`Paket indirilemedi (HTTP ${res.status})`, `Could not download the package (HTTP ${res.status})`));
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
    const backup = path.join(path.dirname(appDir), 'app-backup');
    fs.rmSync(backup, { recursive: true, force: true });
    copyDir(appDir, backup, true);
    const written = [];
    try { copyDir(tmp, appDir, true, written); }
    catch (e) {
      // A locked or read-only file, a full disk ...: never leave a mix of two versions behind.
      throw new Error(restoreFromBackup(appDir, backup, written)
        ? T(`Güncelleme kurulamadı (${e.message}). Önceki sürüm geri yüklendi.`, `The update could not be installed (${e.message}). The previous version was restored.`)
        : T(`Güncelleme yarıda kaldı (${e.message}) ve önceki sürüm tam geri yüklenemedi. Yedek: ${backup}`, `The update stopped half-way (${e.message}) and the previous version could not be fully restored. Backup: ${backup}`));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  onProgress({ step: 'done', message: T(`v${m.version} kuruldu, yeniden başlatılıyor…`, `v${m.version} installed, restarting…`) });
  return true;
}

module.exports = { checkForUpdate, applyUpdate, currentVersion, cmpVersion, removeLegacyFiles, LEGACY_FILES };
