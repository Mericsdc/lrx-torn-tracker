#!/usr/bin/env node
/**
 * Güncelleme paketi üretir.
 *   node tools/make-update.js "Bu sürümde neler var"
 *
 * Çıktı (resources/app'in iki üst klasöründe değil, TornTracker klasörünün yanında):
 *   ../../../updates/torntracker-app-<sürüm>.zip
 *   ../../../updates/latest.json
 * İkisini de aynı yere yükle (örn. GitHub Release'e asset olarak). Uygulamada
 * Ayarlar → Güncelleme adresi = .../latest.json olmalı. Önce package.json'daki "version"u artır.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const APP = path.resolve(__dirname, '..');
const OUT = path.resolve(APP, '..', '..', '..', 'updates');
// Not part of the installed app: local data and tooling caches, plus the repository's docs, tests, CI and website.
const SKIP = new Set(['data', 'node_modules', 'dist', '.git', '.fallow', '.hallmark', '.sites-state', '.openai', '.gitnexus', '.vitest', 'coverage', '.github', 'docs', 'tests', 'website']);

function listFiles(dir, base = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(ent.name) || ent.name === '.env' || ent.name.startsWith('.env.') || ent.name.endsWith('.env') && ent.name !== 'config.example.env' || /\.(?:sqlite(?:-\w+)?|db|log)$/i.test(ent.name) || ent.isSymbolicLink()) continue;
    const rel = base ? `${base}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...listFiles(path.join(dir, ent.name), rel));
    else out.push(rel);
  }
  return out;
}

function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const rel of files) {
    const data = fs.readFileSync(path.join(APP, rel));
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const name = Buffer.from(rel, 'utf8');
    const crc = zlib.crc32(data) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

if (require.main === module) {
const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
const files = listFiles(APP);
const zip = makeZip(files);
fs.mkdirSync(OUT, { recursive: true });
const zipName = `torntracker-app-${pkg.version}.zip`;
fs.writeFileSync(path.join(OUT, zipName), zip);
// GitHub Release'te manifest, imzalı ve süreli bir indirme adresine yönlenir; göreli paket adı oraya
// göre çözülürse imzasız adres oluşur (HTTP 618 jwt-not-provided). Bu yüzden tam adres yazıyoruz.
const gh = String(pkg.updateUrl || '').match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\//i);
const manifest = {
  version: pkg.version,
  url: gh ? `https://github.com/${gh[1]}/${gh[2]}/releases/download/v${pkg.version}/${zipName}` : zipName,
  sha256: crypto.createHash('sha256').update(zip).digest('hex'),
  notes: process.argv.slice(2).join(' ') || '',
  publishedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(manifest, null, 2));
console.log(`✓ ${files.length} dosya → ${path.join(OUT, zipName)} (${(zip.length / 1024).toFixed(0)} KB)`);
console.log(`✓ ${path.join(OUT, 'latest.json')}`);
console.log('Bu iki dosyayı aynı yere yükle; uygulamada Güncelleme adresi = <o yer>/latest.json');
}
module.exports = { listFiles, makeZip };
