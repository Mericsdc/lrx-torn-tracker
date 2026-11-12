'use strict';
// Screenshots + CSP/console checks of the local preview. Usage: node check.js <baseUrl> <outDir>
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:4810/torn-tracker';
const OUT = path.resolve(process.argv[3] || path.join(__dirname, '..', 'checks'));
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_EXE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const report = [];
  for (const [w, h, name] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
    for (const lang of ['en', 'tr']) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: name === 'mobile', hasTouch: name === 'mobile' });
      await ctx.addInitScript((l) => {
        try { localStorage.setItem('lrxe8-locale', l); } catch {}
        window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
      }, lang);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.type() + ': ' + m.text()); });
      page.on('requestfailed', (r) => errors.push('failed: ' + r.url()));
      page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForTimeout(3500);
      await page.screenshot({ path: path.join(OUT, `${name}-${lang}-hero.png`) });
      // walk the page so reveal animations run
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += Math.round(h * 0.7)) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(220); }
      await page.evaluate(() => document.querySelector('#credits').scrollIntoView());
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(OUT, `${name}-${lang}-credits.png`) });
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `${name}-${lang}-full.png`), fullPage: true });
      const info = await page.evaluate(() => ({
        csp: window.__csp, ready: document.querySelector('#flex').dataset.ready, lang: document.documentElement.lang,
        overflowX: document.documentElement.scrollWidth > window.innerWidth, title: document.querySelector('#flex-title').textContent,
      }));
      report.push({ name, lang, ...info, errors });
      await ctx.close();
    }
  }
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
