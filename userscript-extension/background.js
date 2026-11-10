const HOSTS = { 'ff-scouter': 'ffscouter.com', 'tornw3b-bazaars': 'weav3r.dev' };
const pending = new Map();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== 'lrx-userscript-request' || !HOSTS[message.script]) return;
  const run = async () => {
    if (new URL(sender.url || sender.origin).origin !== 'https://www.torn.com') throw new Error('Invalid userscript origin');
    const key = `${sender.tab?.id}:${message.script}:${message.id}`;
    if (message.action === 'abort') { pending.get(key)?.abort(); return {}; }
    const url = new URL(message.url);
    const managedFF = message.script === 'ff-scouter' && typeof LRX_FF_PROXY !== 'undefined';
    if (url.protocol !== 'https:' || !(url.hostname === HOSTS[message.script] || managedFF && url.hostname === 'api.torn.com') || url.username || url.password) throw new Error('Userscript host is not allowed');
    const controller = new AbortController(); pending.set(key, controller);
    const timer = setTimeout(() => controller.abort(), Math.min(60000, Math.max(1000, Number(message.timeout) || 30000)));
    try {
      if (managedFF) {
        const response = await fetch(LRX_FF_PROXY.url, { method: 'POST', credentials: 'omit', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LRX_FF_PROXY.token },
          body: JSON.stringify({ url: message.url, method: message.method, headers: message.headers, data: message.data, timeout: message.timeout }) });
        const result = await response.json();
        if (!response.ok) return { response: { status: response.status, statusText: response.statusText, responseText: JSON.stringify(result), readyState: 4, finalUrl: message.url } };
        return { response: result };
      }
      const headers = Object.fromEntries(Object.entries(message.headers || {}).filter(([name]) => !/^(cookie|origin|host|referer|sec-|proxy-)/i.test(name)));
      const method = String(message.method || 'GET').toUpperCase();
      if (!['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH'].includes(method)) throw new Error('Invalid request method');
      // Redirects are intentionally not followed to a different service.
      const response = await fetch(url.href, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : message.data, credentials: 'omit', redirect: 'error', signal: controller.signal });
      const text = await response.text();
      return { response: { status: response.status, statusText: response.statusText, responseText: text, finalUrl: response.url, readyState: 4,
        responseHeaders: [...response.headers].map(([k, v]) => `${k}: ${v}`).join('\r\n') } };
    } finally { clearTimeout(timer); pending.delete(key); }
  };
  run().then(respond, (error) => respond({ error: error.name === 'AbortError' ? 'timeout' : error.message }));
  return true;
});
