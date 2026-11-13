const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { removeLegacyFiles, LEGACY_FILES, cmpVersion, applyUpdate, currentVersion } = require('../src/main/updater');
const { unzip } = require('../src/main/torntools');
const { listFiles, makeZip } = require('../tools/make-update');

function fixture(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-updater-fixture-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), 'synthetic fixture');
  }
  return dir;
}
const exists = (dir, file) => fs.existsSync(path.join(dir, file));

test('an install updated from the old layout loses only the old root files', (t) => {
  const keep = ['package.json', 'src/main/electron-main.js', 'src/server/server.js', 'public/app.js', 'data/config.json', 'README.md'];
  const dir = fixture(t, [...keep, ...LEGACY_FILES]);
  fs.mkdirSync(path.join(dir, 'server.js.dir')); // a folder is never removed, whatever its name
  assert.deepEqual(removeLegacyFiles(dir).sort(), [...LEGACY_FILES].sort());
  for (const file of LEGACY_FILES) assert.equal(exists(dir, file), false, file);
  for (const file of keep) assert.equal(exists(dir, file), true, file);
  assert.equal(exists(dir, 'server.js.dir'), true);
  assert.deepEqual(removeLegacyFiles(dir), []);
});

test('legacy cleanup never touches a Git checkout or an install still on the old layout', (t) => {
  const checkout = fixture(t, ['.git/HEAD', 'src/main/electron-main.js', 'server.js', 'updater.js']);
  assert.deepEqual(removeLegacyFiles(checkout), []);
  assert.equal(exists(checkout, 'server.js'), true);
  const oldLayout = fixture(t, ['electron-main.js', 'server.js']);
  assert.deepEqual(removeLegacyFiles(oldLayout), []);
  assert.equal(exists(oldLayout, 'electron-main.js'), true);
});

test('version comparison orders releases numerically', () => {
  assert.equal(cmpVersion('1.6.13', '1.6.12'), 1);
  assert.equal(cmpVersion('1.6.9', '1.6.10'), -1);
  assert.equal(cmpVersion('1.6.12', '1.6.12'), 0);
});

/* ---- Installing a package: synthetic app folders and a stubbed download, never the real app or network ---- */
const MANIFEST = 'https://updates.example.invalid/latest.json';
const OLD = { 'package.json': JSON.stringify({ version: '1.0.0', main: 'src/main/electron-main.js' }), 'src/main/electron-main.js': 'old main', 'public/app.js': 'old app', 'data/config.json': '{"note":"synthetic user data"}' };
const NEW = { 'package.json': JSON.stringify({ version: '1.0.1', main: 'src/main/electron-main.js' }), 'src/main/electron-main.js': 'new main', 'public/app.js': 'new app', 'public/added.js': 'new file' };
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
function write(dir, files) {
  for (const [file, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), content); }
}
function tree(dir, base = '', out = {}) { // every file under dir: relative path -> content
  for (const entry of fs.readdirSync(path.join(dir, base), { withFileTypes: true })) {
    const rel = base ? base + '/' + entry.name : entry.name;
    if (entry.isDirectory()) tree(dir, rel, out); else out[rel] = fs.readFileSync(path.join(dir, rel), 'utf8');
  }
  return out;
}
function installed(t, packageFiles = NEW) {
  const root = fixture(t, []), appDir = path.join(root, 'resources', 'app'), source = path.join(root, 'package-source');
  write(appDir, OLD); write(source, packageFiles);
  const zip = makeZip(listFiles(source), source);
  return { root, appDir, zip, manifest: { version: '1.0.1', url: 'app.zip', sha256: sha(zip) } };
}
const download = (manifest, body, status = 200) => async (url) => (String(url) === MANIFEST ? new Response(JSON.stringify(manifest)) : new Response(body, { status }));
const apply = (appDir, fetchImpl, onProgress = () => {}) => applyUpdate(MANIFEST, onProgress, { appDir, fetchImpl });

test('a verified package replaces the app files, keeps user data and leaves a backup of the old version', async (t) => {
  const { root, appDir, zip, manifest } = installed(t), steps = [];
  await apply(appDir, download(manifest, zip), (p) => steps.push(p.step));
  assert.equal(currentVersion(appDir), '1.0.1');
  assert.deepEqual(tree(appDir), { ...NEW, 'data/config.json': OLD['data/config.json'] });
  assert.equal(tree(path.join(root, 'resources', 'app-backup'))['public/app.js'], 'old app');
  assert.deepEqual(steps, ['download', 'extract', 'install', 'done']);
});

test('a damaged, cut-off, mislabeled or refused package leaves the installed app untouched', async (t) => {
  const { root, appDir, zip, manifest } = installed(t), before = tree(appDir), half = zip.subarray(0, Math.floor(zip.length / 2));
  for (const [name, m, body, status] of [
    ['hash does not match', { ...manifest, sha256: 'a'.repeat(64) }, zip],
    ['download cut short', manifest, half],
    ['corrupt archive whose hash matches', { ...manifest, sha256: sha(half) }, half],
    ['package version differs from the manifest', { ...manifest, version: '1.0.2' }, zip],
    ['download refused', manifest, 'not found', 404],
    ['not newer than the installed version', { ...manifest, version: '1.0.0' }, zip],
    ['manifest without a hash', { version: '1.0.1', url: 'app.zip' }, zip],
  ]) {
    await assert.rejects(apply(appDir, download(m, body, status)), Error, name);
    assert.deepEqual(tree(appDir), before, name);
  }
  // A dropped connection and a manifest that is not JSON give a readable message, not a raw runtime error
  const dropped = async (url) => { if (String(url) === MANIFEST) return new Response(JSON.stringify(manifest)); throw new TypeError('terminated'); };
  await assert.rejects(apply(appDir, dropped), /Could not download the package/);
  await assert.rejects(apply(appDir, async () => new Response('<html>')), /update manifest/);
  await assert.rejects(apply(appDir, async () => { throw new TypeError('fetch failed'); }), /update server/);
  assert.deepEqual(tree(appDir), before);
  assert.equal(fs.existsSync(path.join(root, 'resources', 'app-backup')), false, 'nothing was installed, so nothing was backed up');
});

test('an install that fails half-way puts the previous version back', async (t) => {
  // The package holds a FILE where the installed app has a FOLDER: copying it fails after earlier files were already
  // replaced (the updater copies in name order, so every other file of the package comes before 'zz-blocked').
  const { appDir, zip, manifest } = installed(t, { ...NEW, 'zz-blocked': 'file in the package' });
  const current = (file) => (fs.existsSync(path.join(appDir, file)) ? fs.readFileSync(path.join(appDir, file), 'utf8') : null);
  assert.ok(Object.keys(NEW).some((file) => file < 'zz-blocked' && current(file) !== NEW[file]), 'the package replaces files before the blocked one');
  write(appDir, { 'zz-blocked/keep.txt': 'folder in the installed app' });
  const before = tree(appDir);
  await assert.rejects(apply(appDir, download(manifest, zip)), /previous version was restored/);
  assert.deepEqual(tree(appDir), before, 'no file of the new version is left behind');
  assert.equal(currentVersion(appDir), '1.0.0');
});

test('archive entries cannot be written outside the target folder', (t) => {
  const stored = (entries) => { // minimal stored (uncompressed) ZIP with arbitrary entry names
    const locals = [], centrals = []; let offset = 0;
    for (const [name, content] of entries) {
      const n = Buffer.from(name), data = Buffer.from(content), lh = Buffer.alloc(30), ch = Buffer.alloc(46);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
      ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
      locals.push(lh, n, data); centrals.push(ch, n); offset += 30 + n.length + data.length;
    }
    const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, end]);
  };
  const root = fixture(t, []), dest = path.join(root, 'out');
  unzip(stored([['../escaped.txt', 'x'], ['..\\escaped-too.txt', 'x'], ['nested/../../escaped-three.txt', 'x'], ['ok/inside.txt', 'fine']]), dest);
  assert.deepEqual(fs.readdirSync(root), ['out']);
  assert.deepEqual(tree(dest), { 'ok/inside.txt': 'fine' });
});
