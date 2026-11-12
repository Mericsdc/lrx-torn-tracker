'use strict';
// Turns the downloaded Torn profile pictures into small square WebP files for the page (first frame of GIFs),
// moves the originals out of the deployable folder and rewrites credits-fetched.json to point at the WebP files.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'site', 'assets');
const originals = path.join(root, 'originals');
const metaFile = path.join(root, 'credits-fetched.json');
const OUT_W = 320, OUT_H = 440; // Torn profile pictures are 400x550

(async () => {
  fs.mkdirSync(originals, { recursive: true });
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_EXE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  for (const m of meta) {
    if (!m.image) continue;
    const srcName = m.original || m.image;
    const src = fs.existsSync(path.join(originals, srcName)) ? path.join(originals, srcName) : path.join(assets, srcName);
    if (!fs.existsSync(src)) { console.log('missing', m.image); continue; }
    const mime = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif' }[srcName.split('.').pop()];
    const b64 = fs.readFileSync(src).toString('base64');
    const out = await page.evaluate(async ([data, W, H]) => {
      const img = new Image(); img.src = data; await img.decode();
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, (W - img.naturalWidth * s) / 2, (H - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
      return { url: c.toDataURL('image/webp', 0.86), w: img.naturalWidth, h: img.naturalHeight };
    }, [`data:${mime};base64,${b64}`, OUT_W, OUT_H]);
    const name = `LRXe8-tt-credit-${m.id}.webp`;
    fs.writeFileSync(path.join(assets, name), Buffer.from(out.url.split(',')[1], 'base64'));
    if (!src.startsWith(originals)) fs.renameSync(src, path.join(originals, srcName));
    console.log(`${m.name} [${m.id}] ${out.w}x${out.h} -> ${name} ${fs.statSync(path.join(assets, name)).size} bytes`);
    m.original = srcName; m.image = name;
  }
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
