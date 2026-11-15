const fs = require('fs');
const path = require('path');
const { APP_ROOT } = require('../app-paths');
/* OpenMarket (GPL-3.0) runs as published, with these local changes, all checked against the bundled version:
   - its sort-menu entries (they press Torn's dropdown button and reorder the listings) and its cloned filter sliders
     are off; the quality and bonus labels stay;
   - Display Case (it sends synthetic hover events), Inventory and Faction Armory (it rewrites Torn's Type column)
     are off; the extension only loads it on the Item Market, bazaars and the Auction House anyway;
   - bonus titles taken from Torn's attributes are read from an inert parsed document instead of innerHTML. */
const OPENMARKET_PATCHES = [
  [/enableDisplayCase: true,/, 'enableDisplayCase: false,'],
  [/enableInventory: true,/, 'enableInventory: false,'],
  [/factionArmoury: true\r?\n/, 'factionArmoury: false\n'],
  [/function initDropdownIntegration\(\) \{\r?\n\s*monitorDropdown\(\);\r?\n\s*\}/, 'function initDropdownIntegration() { /* LRX: sort menu entries off */ }'],
  [/function ensureQualitySlider\(\) \{\r?\n/, 'function ensureQualitySlider() { return; /* LRX: filter sliders off */\n'],
  // Unreachable after the switches above; removed as well so nothing can press or hover Torn's controls
  [/toggler\.click\(\);/, 'void 0; /* LRX: no clicks on Torn controls */'],
  [/el\.dispatchEvent\(new MouseEvent\('mouseenter', \{ bubbles: true \}\)\)/, 'void 0 /* LRX: no synthetic hover */'],
];
function adaptOpenMarket(vendor) {
  for (const [from, to] of OPENMARKET_PATCHES) {
    if (!from.test(vendor)) throw new Error('OpenMarket adapter no longer matches the bundled version');
    vendor = vendor.replace(from, to);
  }
  const html = /const tmp = create\('div'\);\s*tmp\.innerHTML = titleAttr;/g;
  if ((vendor.match(html) || []).length !== 3) throw new Error('OpenMarket adapter no longer matches the bundled version');
  vendor = vendor.replace(html, "const tmp = new DOMParser().parseFromString(String(titleAttr), 'text/html').body;");
  if (/innerHTML|\.click\(\)|new MouseEvent/.test(vendor)) throw new Error('OpenMarket gained page writes the adapter does not cover');
  return vendor;
}
function buildUserscriptExtension(baseDir, features = {}, proxy = null) {
  const source = path.join(APP_ROOT, 'userscript-extension');
  const dest = path.join(baseDir, 'extensions', 'lrx-userscripts');
  fs.mkdirSync(dest, { recursive: true });
  for (const file of ['bridge.js', 'background.js']) fs.copyFileSync(path.join(source, file), path.join(dest, file));
  if (proxy) fs.writeFileSync(path.join(dest, 'background.js'), `const LRX_FF_PROXY = ${JSON.stringify(proxy)};\n` + fs.readFileSync(path.join(source, 'background.js'), 'utf8'));
  const runtime = fs.readFileSync(path.join(source, 'runtime.js'), 'utf8');
  const content = [{ matches: ['https://www.torn.com/*'], js: ['bridge.js'], run_at: 'document_start' }];
  if (features['torn.sessionGuard'] !== false) {
    content.unshift({ matches: ['https://www.torn.com/*'], js: ['session-guard.js'], run_at: 'document_start', world: 'MAIN' });
    fs.copyFileSync(path.join(APP_ROOT, 'torn-helpers', 'session-guard.js'), path.join(dest, 'session-guard.js'));
  }
  for (const [id, feature, matches, runAt] of [
    ['ff-scouter', 'torn.ffScouterScript', ['https://www.torn.com/*'], 'document_start'],
    ['tornw3b-bazaars', 'torn.tornw3bScript', ['https://www.torn.com/page.php*', 'https://www.torn.com/bazaar.php*', 'https://www.torn.com/amarket.php*'], 'document_idle'],
    // document_start: OpenMarket reads the Item Market listings the page fetches for itself
    ['openmarket', 'torn.openMarketScript', ['https://www.torn.com/page.php*', 'https://www.torn.com/bazaar.php*', 'https://www.torn.com/amarket.php*'], 'document_start'],
  ]) {
    if (features[feature] === false) continue;
    let vendor = fs.readFileSync(path.join(APP_ROOT, 'userscripts', `${id}.user.js`), 'utf8');
    let managed = '';
    if (id === 'ff-scouter' && proxy) {
      const keyAccessor = /get key\(\)\s*\{[\s\S]*?\n    \}\s*set key\(key\)\s*\{[\s\S]*?\n    \}/;
      if (!keyAccessor.test(vendor)) throw new Error('FF Scouter key adapter no longer matches the bundled version');
      vendor = vendor.replace(keyAccessor, 'get key() { return LRX_MANAGED_KEY; }\n    set key(key) {}');
      managed = fs.readFileSync(path.join(source, 'ff-managed.js'), 'utf8');
      vendor = vendor.replace('id: "ff-scouter-api-key",', 'id: "ff-scouter-api-key", readOnly: true,')
        .replace('value: drafts.apiKey,', 'value: "Managed by Torn Tracker",')
        .replace('onBlur: onApiKeyBlur', 'onBlur: undefined');
      const introStart = vendor.indexOf('jsxs("div", { className: `${cls.apiExplanation} ${cls.span}`, children: [');
      const introEnd = vendor.indexOf('jsxs("div", { className: `${cls.span} ${cls.apiBlock}`', introStart);
      if (introStart < 0 || introEnd < 0) throw new Error('FF Scouter settings adapter no longer matches');
      vendor = vendor.slice(0, introStart) + 'jsx("div", { className: `${cls.apiExplanation} ${cls.span}`, children: "Your saved Torn Tracker key is used automatically. Change it in Torn Tracker Settings. A separate FFScouter key takes priority for FFScouter requests." }),\n' + vendor.slice(introEnd);
    }
    if (id === 'openmarket') vendor = adaptOpenMarket(vendor);
    const react = id === 'ff-scouter' ? `const reactScope = {}; (function(self, globalThis) {\n${fs.readFileSync(path.join(APP_ROOT, 'userscripts', 'react-dom.19.2.0.js'), 'utf8')}\n}).call(reactScope, reactScope, reactScope); const globalThis = reactScope;` : '';
    const matchGuard = ['tornw3b-bazaars', 'openmarket'].includes(id) ? `if (location.pathname === '/page.php' && new URLSearchParams(location.search).get('sid') !== 'ItemMarket') return;` : '';
    fs.writeFileSync(path.join(dest, id + '.js'), `(() => { ${matchGuard}\n const SCRIPT_ID=${JSON.stringify(id)};\n${runtime}\n${managed}\n${react}\n${vendor}\ndocument.documentElement.setAttribute('data-lrx-script-' + SCRIPT_ID, 'loaded');\n})();`);
    content.push({ matches, js: [id + '.js'], run_at: runAt, world: 'MAIN' });
  }
  // The bridge token and port change on every start. A content-derived version makes Chromium
  // replace a cached background worker (and its old token) instead of reusing it.
  const digest = require('crypto').createHash('sha256');
  for (const file of fs.readdirSync(dest).sort()) if (file.endsWith('.js')) digest.update(file).update(fs.readFileSync(path.join(dest, file)));
  digest.update(JSON.stringify(content));
  const h = digest.digest();
  const version = `1.${h.readUInt16BE(0)}.${h.readUInt16BE(2)}`;
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'LRX Torn userscripts', version,
    background: { service_worker: 'background.js' }, host_permissions: ['https://ffscouter.com/*', 'https://weav3r.dev/*', ...(proxy ? ['http://127.0.0.1/*'] : [])], content_scripts: content }));
  return dest;
}
module.exports = { buildUserscriptExtension, adaptOpenMarket };
