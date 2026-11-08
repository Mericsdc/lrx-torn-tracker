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
  if (!/^https:\/\//i.test(String(manifestUrl || ''))) throw new Error('Güncelleme adresi https:// ile başlamalı (Ayarlar → Güncelleme adresi).');
  const res = await fetch(manifestUrl, { headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'TornTracker-Updater' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Güncelleme bilgisi alınamadı (HTTP ${res.status})`);
  const m = await res.json();
  if (!m.version || !m.url || !/^[a-f0-9]{64}$/i.test(m.sha256 || '')) throw new Error('Güncelleme manifesti eksik/hatalı (version, url, sha256 gerekli).');
  m.url = new URL(m.url, res.url || manifestUrl).toString();
  if (!/^https:\/\//i.test(m.url)) throw new Error('Güncelleme paketi https olmalı.');
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
  if (cmpVersion(m.version, currentVersion()) <= 0) throw new Error('Zaten en güncel sürümdesin.');
  onProgress({ step: 'download', message: `v${m.version} indiriliyor…` });
  const res = await fetch(m.url, { redirect: 'follow', headers: { 'User-Agent': 'TornTracker-Updater' } });
  if (!res.ok) throw new Error(`Paket indirilemedi (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  if (hash.toLowerCase() !== m.sha256.toLowerCase()) throw new Error('Paket doğrulanamadı (sha256 uyuşmuyor). Güncelleme iptal edildi.');

  onProgress({ step: 'extract', message: 'Paket açılıyor…' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'torntracker-update-'));
  try {
    unzip(buf, tmp);
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
    if (!fs.existsSync(path.join(tmp, pkg.main || 'electron-main.js'))) throw new Error('Paket geçersiz (ana dosya yok).');
    if (cmpVersion(pkg.version, m.version) !== 0) throw new Error('Paket sürümü manifestle uyuşmuyor.');

    onProgress({ step: 'install', message: 'Kuruluyor…' });
    const backup = path.join(path.dirname(APP_DIR), 'app-backup');
    fs.rmSync(backup, { recursive: true, force: true });
    copyDir(APP_DIR, backup, true);
    copyDir(tmp, APP_DIR, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  onProgress({ step: 'done', message: `v${m.version} kuruldu, yeniden başlatılıyor…` });
  return true;
}

module.exports = { checkForUpdate, applyUpdate, currentVersion, cmpVersion };
