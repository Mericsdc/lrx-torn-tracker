const { randomBytes } = require('crypto');
const MANAGED_KEY = 'LRXMANAGEDKEY000';
function createFFScriptProxy(getConfig, request = (...args) => fetch(...args), beforeTorn = async () => {}) {
  const token = randomBytes(32).toString('hex');
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
  // These messages appear inside FF Scouter on Torn pages: app language, English by default
  const L = (trStr, enStr) => (getConfig().lang === 'tr' ? trStr : enStr);
  async function run(input, signal) {
    const config = getConfig();
    if (config.features?.['torn.ffScouterScript'] === false) fail(L('FF Scouter ayarlardan kapalı', 'FF Scouter is disabled'), 403);
    const url = new URL(input.url);
    if (url.protocol !== 'https:' || !['ffscouter.com', 'api.torn.com'].includes(url.hostname) || url.username || url.password || url.port) fail(L('Bu FF Scouter adresine izin yok', 'FF Scouter host is not allowed'), 403);
    const key = url.hostname === 'ffscouter.com' ? config.ffscouterKey || config.apiKey : config.apiKey;
    if (!key) fail(L("API key'ini Torn Tracker Ayarlar'a kaydet",'Save your API key in Torn Tracker Settings'), 412);
    const method = String(input.method || 'GET').toUpperCase();
    // Any script on a Torn page can reach this bridge, so it only serves what the bundled FF Scouter uses:
    // its /api/v1 endpoints (GET/POST) and read-only Torn API section lookups.
    if (url.hostname === 'ffscouter.com' && (!['GET', 'POST'].includes(method) || !/^\/api\/v1\/[a-z0-9/_-]+$/i.test(url.pathname))) fail(L('Bu FF Scouter isteğine izin yok', 'FF Scouter endpoint is not allowed'), 403);
    if (url.hostname === 'api.torn.com' && method !== 'GET') fail(L('Torn API köprüsü yalnızca okur', 'The Torn API proxy is read-only'), 403);
    if (url.hostname === 'api.torn.com' && !/^\/(v2\/)?[a-z]+(\/\d*)?\/?$/i.test(url.pathname)) fail(L('Bu Torn API yoluna izin yok', 'Torn API path is not allowed'), 403);
    // Only the upstream key field is replaced. No secret is returned to the page.
    if (url.searchParams.has('key')) url.searchParams.set('key', key);
    const headers = Object.fromEntries(Object.entries(input.headers || {}).filter(([name]) => !/^(cookie|authorization|origin|host|referer|sec-|proxy-)/i.test(name)));
    const body = typeof input.data === 'string' ? input.data.split(MANAGED_KEY).join(key) : undefined;
    if (url.hostname === 'api.torn.com') await beforeTorn();
    // The script gave up while this call waited for the shared Torn budget: do not spend a call on it.
    if (signal?.aborted) fail(L('İstek iptal edildi', 'Request cancelled'), 499);
    const timeout = AbortSignal.timeout(Math.min(60000, Math.max(1000, Number(input.timeout) || 30000)));
    const response = await request(url.href, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : body, redirect: 'error', signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
    const text = await response.text();
    const hide = (value) => String(value).split(key).join('[saved key]');
    return { status: response.status, statusText: response.statusText, responseText: hide(text), finalUrl: input.url, readyState: 4,
      responseHeaders: [...response.headers].filter(([name]) => !/^(set-cookie|location)$/i.test(name)).map(([k, v]) => `${k}: ${hide(v)}`).join('\r\n') };
  }
  return { token, run };
}
module.exports = { createFFScriptProxy, MANAGED_KEY };
