// Build a reviewable app payload without replacing latest.json or publishing a release.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { listFiles, makeZip } = require('./make-update');
const root = path.resolve(__dirname, '..'), output = path.resolve(root, '../../../updates/premium-feature-build');
const files = listFiles(root), html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
for (const match of html.matchAll(/<script\s+src="\/([^"?]+)"/g)) if (!files.includes('public/' + match[1])) throw Error('Missing browser script: ' + match[1]);
for (const required of ['public/feature-catalog.js', 'public/travel-math.js', 'public/feature-access.js', 'public/advanced-modules.js', 'public/advanced-modules.css', 'premium/migrations/004-feature-modules.sql']) if (!files.includes(required)) throw Error('Missing feature asset: ' + required);
const version = require('../package.json').version, name = 'torntracker-app-' + version + '-premium-preview.zip', zip = makeZip(files);
fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, name), zip);
const manifest = { version, preview: true, file: name, sha256: crypto.createHash('sha256').update(zip).digest('hex'), bytes: zip.length, files: files.length };
fs.writeFileSync(path.join(output, 'preview-build.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ ...manifest, output: path.join(output, name) }));
