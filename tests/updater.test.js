const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { removeLegacyFiles, LEGACY_FILES, cmpVersion } = require('../src/main/updater');

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
