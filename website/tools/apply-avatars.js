'use strict';
// Adds the downloaded Torn profile pictures to the credits list in the page.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'credits-fetched.json'), 'utf8'));
const file = path.join(root, 'site', 'LRXe8-torn-tracker.html');
let html = fs.readFileSync(file, 'utf8');
for (const m of meta) {
  const re = new RegExp(`(<li data-id="${m.id}"[^>]*>.*?<span class="pic" data-initials="[A-Z0-9]+">)(?:<img[^>]*>)?(</span>)`);
  const li = html.match(new RegExp(`<li data-id="${m.id}"[^>]*>.*?<b>([^<]+)</b>`));
  if (!li) { console.log('missing in page', m.id); continue; }
  if (m.error) { console.log(`skip [${m.id}] ${m.error}`); continue; }
  if (m.name !== li[1]) console.log(`NAME DIFFERS [${m.id}] page=${li[1]} torn=${m.name}`);
  if (!m.image) { console.log(`no picture [${m.id}]`); continue; }
  html = html.replace(re, `$1<img src="/assets/${m.image}" alt="" width="200" height="200" loading="lazy">$2`);
  console.log(`ok [${m.id}] ${m.name} ${m.image}`);
}
fs.writeFileSync(file, html);
