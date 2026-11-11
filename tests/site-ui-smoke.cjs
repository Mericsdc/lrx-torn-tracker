// Isolated headless regression checks; never opens the user's browser or uses API keys.
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const path=require('node:path');
const dependencyRoot=process.env.UI_VALIDATION_DEPS;
if(!dependencyRoot)throw new Error('Set UI_VALIDATION_DEPS to the directory containing playwright.');
const {chromium}=createRequire(path.join(path.resolve(dependencyRoot),'package.json'))('playwright');
const url=process.env.SITE_TEST_URL||'http://127.0.0.1:4848/torn-premium';
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const context=await browser.newContext(), page=await context.newPage(), errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    for(const width of [320,375,640,1024,1280,1440,1920]) {
      await page.setViewportSize({width,height:900}); await page.goto(url); await page.evaluate(()=>document.fonts.ready);
      const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,broken:[...document.images].filter(i=>i.complete&&!i.naturalWidth).map(i=>i.src)}));
      assert.ok(layout.scroll<=layout.width,`overflow at ${width}: ${layout.scroll}`); assert.deepEqual(layout.broken,[]);
    }
    await page.setViewportSize({width:375,height:900});
    await page.locator('[data-language="tr"]').click(); assert.match(await page.locator('h1').innerText(),/Tek tık/);
    await page.reload(); assert.equal(await page.locator('html').getAttribute('lang'),'tr');
    await page.locator('[data-language="en"]').click();
    await page.locator('[data-screen="war"]').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('[data-screen="travel"]').getAttribute('aria-selected'),'true');
    await page.locator('#feature-screen').evaluate(image=>image.decode());
    assert.match(await page.locator('#feature-screen').getAttribute('src'),/travel\.png$/);
    await page.locator('.screen-zoom').click(); assert.equal(await page.locator('#screen-dialog').evaluate(e=>e.open),true);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#screen-dialog').evaluate(e=>e.open),false);
    for(const [n,id] of ['1844049','1853324','2114440'].entries()) {
      const panel=page.locator('.credit-panel').nth(n); await panel.locator('button').click();
      assert.equal(await panel.locator('button').getAttribute('aria-expanded'),'true');
      assert.equal(await panel.locator('a').isVisible(),true); assert.match(await panel.locator('a').getAttribute('href'),new RegExp('XID='+id+'$'));
      assert.notEqual(await panel.locator('button').evaluate(e=>getComputedStyle(e,'::after').content),'none');
    }
    const downloads=await page.locator('a.button.primary').evaluateAll(links=>links.map(a=>a.href));
    assert.equal(downloads.length,2); assert.ok(downloads.every(href=>/\/torn-premium\/download\/windows$|github\.com\/Mericsdc\/lrx-torn-tracker\/releases\/latest\/download\/LRX-Torn-Tracker-Windows-x64\.zip$/.test(href)));
    assert.equal(await page.locator('a[href="https://github.com/Mericsdc/lrx-torn-tracker/blob/main/LICENSE"]').count(),1);
    await context.close();
    const noJS=await browser.newContext({javaScriptEnabled:false}), fallback=await noJS.newPage(); await fallback.goto(url);
    assert.equal(await fallback.locator('.credit-detail a:visible').count(),3); assert.equal(await fallback.locator('.screen-zoom img').isVisible(),true);
    await noJS.close();
    const reduced=await browser.newContext({reducedMotion:'reduce'}), quiet=await reduced.newPage(); await quiet.goto(url);
    await quiet.locator('.credit-panel').nth(1).locator('button').click(); assert.equal(await quiet.evaluate(()=>document.getAnimations().length),0);
    assert.deepEqual(errors,[]); await reduced.close();
    console.log('Site UI passed: 7 viewport widths, EN/TR persistence, keyboard gallery, modal, all creator links, downloads/license, no-JS and reduced motion.');
  } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
