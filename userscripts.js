const fs = require('fs');
const path = require('path');
function buildUserscriptExtension(baseDir, features = {}, proxy = null) {
  const source = path.join(__dirname, 'userscript-extension');
  const dest = path.join(baseDir, 'extensions', 'lrx-userscripts');
  fs.mkdirSync(dest, { recursive: true });
  for (const file of ['bridge.js', 'background.js']) fs.copyFileSync(path.join(source, file), path.join(dest, file));
  if (proxy) fs.writeFileSync(path.join(dest, 'background.js'), `const LRX_FF_PROXY = ${JSON.stringify(proxy)};\n` + fs.readFileSync(path.join(source, 'background.js'), 'utf8'));
  const runtime = fs.readFileSync(path.join(source, 'runtime.js'), 'utf8');
  const content = [
    { matches: ['https://www.torn.com/*'], js: ['session-guard.js'], run_at: 'document_start', world: 'MAIN' },
    { matches: ['https://www.torn.com/*'], js: ['bridge.js'], run_at: 'document_start' },
  ];
  fs.copyFileSync(path.join(__dirname, 'torn-helpers', 'session-guard.js'), path.join(dest, 'session-guard.js'));
  for (const [id, feature, matches, runAt] of [
    ['ff-scouter', 'torn.ffScouterScript', ['https://www.torn.com/*'], 'document_start'],
    ['tornw3b-bazaars', 'torn.tornw3bScript', ['https://www.torn.com/page.php*', 'https://www.torn.com/bazaar.php*', 'https://www.torn.com/amarket.php*'], 'document_idle'],
  ]) {
    if (features[feature] === false) continue;
    let vendor = fs.readFileSync(path.join(__dirname, 'userscripts', `${id}.user.js`), 'utf8');
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
    const react = id === 'ff-scouter' ? `const reactScope = {}; (function(self, globalThis) {\n${fs.readFileSync(path.join(__dirname, 'userscripts', 'react-dom.19.2.0.js'), 'utf8')}\n}).call(reactScope, reactScope, reactScope); const globalThis = reactScope;` : '';
    const matchGuard = id === 'tornw3b-bazaars' ? `if (location.pathname === '/page.php' && new URLSearchParams(location.search).get('sid') !== 'ItemMarket') return;` : '';
    fs.writeFileSync(path.join(dest, id + '.js'), `(() => { ${matchGuard}\n const SCRIPT_ID=${JSON.stringify(id)};\n${runtime}\n${managed}\n${react}\n${vendor}\ndocument.documentElement.setAttribute('data-lrx-script-' + SCRIPT_ID, 'loaded');\n})();`);
    content.push({ matches, js: [id + '.js'], run_at: runAt, world: 'MAIN' });
  }
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'LRX Torn userscripts', version: '1.0.0',
    background: { service_worker: 'background.js' }, host_permissions: ['https://ffscouter.com/*', 'https://weav3r.dev/*', ...(proxy ? ['http://127.0.0.1/*'] : [])], content_scripts: content }));
  return dest;
}
module.exports = { buildUserscriptExtension };
