const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), skipped = new Set(['node_modules', 'data', '.git', '.gitnexus', '.vitest', 'coverage', 'dist', 'userscripts', 'assets']);
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isSymbolicLink() || skipped.has(e.name) ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(?:js|cjs|mjs)$/.test(e.name) ? [path.join(dir, e.name)] : []); }
const files = walk(root);
for (const file of files) { const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true }); if (result.status !== 0) { process.stderr.write(result.stderr || 'Syntax check failed: ' + file); process.exit(1); } }
console.log('Syntax checked ' + files.length + ' maintained JavaScript files.');
