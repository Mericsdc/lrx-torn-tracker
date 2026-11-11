const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listFiles } = require('../../tools/make-update');

test('update packages exclude payment databases, environment secrets and nested private data', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrx-package-fixture-'));
  t.after(() => {
    const resolved = path.resolve(temp);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); assert.ok(path.basename(resolved).startsWith('lrx-package-fixture-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const files = ['server.js', '.env', '.env.live', 'premium.env', '.gitnexus/gitnexus.json', 'data/config.json', 'premium/live.sqlite', 'premium/live.sqlite-wal', 'premium/live.sqlite-shm', 'premium/live.db', 'premium/service.log', 'premium/data/backup.json', 'premium/config.example.env', 'premium/migrations/001-premium.sql'];
  for (const file of files) { fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true }); fs.writeFileSync(path.join(temp, file), 'synthetic fixture only'); }
  assert.deepEqual(listFiles(temp).sort(), ['premium/config.example.env', 'premium/migrations/001-premium.sql', 'server.js']);
});
