const { randomBytes } = require('crypto');
const MANAGED_KEY = 'LRXMANAGEDKEY000';
function createFFScriptProxy(getConfig, request = (...args) => fetch(...args), beforeTorn = async () => {}) {
  const token = randomBytes(32).toString('hex');
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
  async function run(input) {
    const config = getConfig();
    if (config.features?.['torn.ffScouterScript'] === false) fail('FF Scouter is disabled', 403);
    const url = new URL(input.url);
    if (url.protocol !== 'https:' || !['ffscouter.com', 'api.torn.com'].includes(url.hostname) || url.username || url.password || url.port) fail('FF Scouter host is not allowed', 403);
    const key = url.hostname === 'ffscouter.com' ? config.ffscouterKey || config.apiKey : config.apiKey;
    if (!key) fail('Save your API key in Torn Tracker Settings', 412);
    const method = String(input.method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) fail('Invalid request method');
    if (url.hostname === 'api.torn.com' && method !== 'GET') fail('The Torn API proxy is read-only', 403);
    // Only the upstream key field is replaced. No secret is returned to the page.
    if (url.searchParams.has('key')) url.searchParams.set('key', key);
    const headers = Object.fromEntries(Object.entries(input.headers || {}).filter(([name]) => !/^(cookie|authorization|origin|host|referer|sec-|proxy-)/i.test(name)));
    const body = typeof input.data === 'string' ? input.data.split(MANAGED_KEY).join(key) : undefined;
    if (url.hostname === 'api.torn.com') await beforeTorn();
    const response = await request(url.href, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : body, redirect: 'error', signal: AbortSignal.timeout(Math.min(60000, Math.max(1000, Number(input.timeout) || 30000))) });
    const text = await response.text();
    return { status: response.status, statusText: response.statusText, responseText: text.split(key).join('[saved key]'), finalUrl: input.url, readyState: 4,
      responseHeaders: [...response.headers].filter(([name]) => !/^(set-cookie|location)$/i.test(name)).map(([k, v]) => `${k}: ${v}`).join('\r\n') };
  }
  return { token, run };
}
module.exports = { createFFScriptProxy, MANAGED_KEY };
