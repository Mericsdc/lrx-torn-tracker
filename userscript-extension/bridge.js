// Isolated extension world: only two declared third-party services are reachable.
// 'lrx-bazaar-price' is the tracker's own bazaar helper (torn-helpers/bazaar-undercut.js): weav3r.dev price lookups only.
window.addEventListener('message', (event) => {
  const m = event.data;
  if (event.source !== window || event.origin !== 'https://www.torn.com' || m?.channel !== 'lrx-userscript-request' || !['ff-scouter', 'tornw3b-bazaars', 'lrx-bazaar-price'].includes(m.script)) return;
  chrome.runtime.sendMessage(m, (result) => {
    const error = chrome.runtime.lastError;
    window.postMessage({ channel: 'lrx-userscript-response', script: m.script, id: m.id, ...(error ? { error: error.message } : result) }, location.origin);
  });
});
