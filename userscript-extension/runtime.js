// Included inside each userscript's closure; it does not install GM globals.
let requestSequence = 0;
const callbacks = new Map();
window.addEventListener('message', (event) => {
  const m = event.data;
  if (event.source !== window || event.origin !== location.origin || m?.channel !== 'lrx-userscript-response' || m.script !== SCRIPT_ID) return;
  const options = callbacks.get(m.id);
  if (!options) return;
  callbacks.delete(m.id);
  if (m.error) {
    const callback = m.error === 'timeout' ? options.ontimeout || options.onerror : options.onerror;
    callback?.({ error: m.error, status: 0 });
  } else {
    const response = m.response;
    response.response = response.responseText;
    if (options.responseType === 'json') { try { response.response = JSON.parse(response.responseText); } catch { response.response = null; } }
    options.onload?.(response);
  }
});
const GM_xmlhttpRequest = (options) => {
  const id = String(++requestSequence);
  callbacks.set(id, options);
  const request = { channel: 'lrx-userscript-request', action: 'request', id, script: SCRIPT_ID, url: options.url, method: options.method, data: options.data, headers: options.headers, timeout: options.timeout };
  window.postMessage(request, location.origin);
  return { abort: () => { callbacks.delete(id); window.postMessage({ channel: request.channel, action: 'abort', id, script: SCRIPT_ID }, location.origin); options.onabort?.(); } };
};
const storagePrefix = 'lrx.userscript.' + SCRIPT_ID + '.';
const GM_getValue = (key, fallback) => { try { const value = localStorage.getItem(storagePrefix + key); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } };
const GM_setValue = (key, value) => localStorage.setItem(storagePrefix + key, JSON.stringify(value));
const GM_deleteValue = (key) => localStorage.removeItem(storagePrefix + key);
const GM_listValues = () => Object.keys(localStorage).filter((key) => key.startsWith(storagePrefix)).map((key) => key.slice(storagePrefix.length));
const GM_addStyle = (css) => { const style = document.createElement('style'); style.textContent = css; (document.head || document.documentElement).append(style); return style; };
const unsafeWindow = window;
