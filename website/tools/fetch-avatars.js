'use strict';
// Downloads the public Torn profile pictures of the people credited on the Torn Tracker site.
// Uses only the official Torn API (one profile call per person). The key is read from hidden
// terminal input, kept in memory, never printed and never written to disk.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ALL = [4037017, 1844049, 1853324, 2114440, 3354782, 2402357, 2670953];
const PEOPLE = process.argv.slice(2).map(Number).filter((n) => ALL.includes(n));
if (!PEOPLE.length) PEOPLE.push(...ALL);
const OUT = path.resolve(__dirname, '..', 'site', 'assets');
const META = path.resolve(__dirname, '..', 'credits-fetched.json');
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

function askHidden(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(prompt + '\n> ');
    rl._writeToOutput = () => {};
    rl.question('', answer => { rl.close(); process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(`LRX Torn Tracker site: downloads ${PEOPLE.length} public Torn profile picture(s) via the official Torn API.`);
  let key = '';
  for (let attempt = 1; ; attempt++) {
    key = await askHidden('Paste a Torn API key (Public access is enough). Typing is hidden and the key is not saved. Then press Enter:');
    key = key.replace(/[^A-Za-z0-9]/g, '');
    if (key.length !== 16) console.log(`Got ${key.length} characters; a Torn API key has 16. Nothing was sent.`);
    else {
      const check = await (await fetch(`https://api.torn.com/user/?selections=basic&comment=LRXsite&key=${encodeURIComponent(key)}`)).json();
      if (!check.error) { console.log('Key accepted by Torn.'); break; }
      console.log(`Torn rejected this key: error ${check.error.code} (${check.error.error}).`);
    }
    if (attempt >= 3) { console.log('Stopped after 3 tries. Nothing was saved.'); process.exit(1); }
    console.log('Try again (Ctrl+C to cancel).\n');
  }
  fs.mkdirSync(OUT, { recursive: true });
  const result = [];
  for (const id of PEOPLE) {
    try {
      const res = await fetch(`https://api.torn.com/user/${id}?selections=profile&comment=LRXsite&key=${encodeURIComponent(key)}`);
      const j = await res.json();
      if (j.error) throw new Error('Torn API error ' + j.error.code);
      const entry = { id, name: j.name, level: j.level, image: null };
      const src = j.profile_image;
      if (src) {
        const u = new URL(src);
        if (u.protocol !== 'https:') throw new Error('image is not https');
        const img = await fetch(u, { redirect: 'follow' });
        const type = (img.headers.get('content-type') || '').split(';')[0].trim();
        const buf = Buffer.from(await img.arrayBuffer());
        if (!img.ok || !EXT[type] || buf.length > 20_000_000) throw new Error(`image rejected (${img.status} ${type} ${buf.length} bytes)`);
        entry.image = `LRXe8-tt-credit-${id}.${EXT[type]}`;
        entry.imageHost = u.hostname;
        fs.writeFileSync(path.join(OUT, entry.image), buf);
      }
      result.push(entry);
      console.log(`ok   ${j.name} [${id}]  ${entry.image ? entry.image : '(no profile picture)'}`);
    } catch (e) {
      result.push({ id, error: String(e.message || e) });
      console.log(`fail [${id}]  ${e.message || e}`);
    }
    await wait(800);
  }
  let merged = result;
  try { const old = JSON.parse(fs.readFileSync(META, 'utf8')); merged = old.filter((o) => !PEOPLE.includes(o.id)).concat(result); } catch {}
  merged.sort((a, b) => ALL.indexOf(a.id) - ALL.indexOf(b.id));
  fs.writeFileSync(META + '.tmp', JSON.stringify(merged, null, 2));
  fs.renameSync(META + '.tmp', META);
  console.log('\nDone. You can close this tab.');
}

main().catch(e => { console.log('Failed:', e.message || e); process.exit(1); });
