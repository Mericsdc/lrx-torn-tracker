/* Repair stale RFC tokens on user requests only. Never retry a payment or reload
   a failed action. Capture navigation clicks before TornTools/React handlers. */
(() => {
  if (window.__lrxSessionGuard) return;
  window.__lrxSessionGuard = true;
  const isTorn = (u) => u.protocol === 'https:' && u.hostname === 'www.torn.com';
  const token = () => document.cookie.split(/;\s*/).find((s) => s.startsWith('rfc_v='))?.slice(6) || '';
  const fix = (raw) => {
    try {
      const url = new URL(raw, location.href), value = token();
      if (!isTorn(url) || !url.searchParams.has('rfcv') || !value) return raw;
      url.searchParams.set('rfcv', decodeURIComponent(value));
      return url.href;
    } catch { return raw; }
  };
  const originalFetch = window.fetch;
  const fixBody = (body) => {
    const value = token(); if (!value) return body;
    if (body instanceof URLSearchParams || typeof body === 'string' && /(^|&)rfcv=/.test(body)) {
      const copy = new URLSearchParams(body); if (copy.has('rfcv')) copy.set('rfcv', decodeURIComponent(value));
      return body instanceof URLSearchParams ? copy : copy.toString();
    }
    if (body instanceof FormData && body.has('rfcv')) {
      const copy = new FormData(); for (const [key, val] of body) copy.append(key, key === 'rfcv' ? decodeURIComponent(value) : val);
      return copy;
    }
    return body;
  };
  window.fetch = async function(input, options) {
    let local = false; try { local = isTorn(new URL(input instanceof Request ? input.url : String(input), location.href)); } catch {}
    if (local && options?.body) options = { ...options, body: fixBody(options.body) };
    if (typeof input === 'string' || input instanceof URL) input = fix(String(input));
    else if (input instanceof Request) {
      const url = fix(input.url);
      if (url !== input.url) input = new Request(url, input);
      if (local && /application\/x-www-form-urlencoded/i.test(input.headers.get('Content-Type') || '') && input.method !== 'GET' && input.method !== 'HEAD') {
        input = new Request(input, { body: fixBody(await input.clone().text()) });
      }
    }
    return originalFetch.call(this, input, options);
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    try { this.__lrxTornRequest = isTorn(new URL(String(url), location.href)); } catch { this.__lrxTornRequest = false; }
    return originalOpen.call(this, method, fix(String(url)), ...rest);
  };
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(body) { return originalSend.call(this, this.__lrxTornRequest ? fixBody(body) : body); };
  let lastNavigation = { url: '', at: 0 };
  document.addEventListener('click', (event) => {
    const sidebar = event.target.closest?.('#sidebarroot, #sidebar, [class*="sidebar___"]');
    if (!sidebar || event.button !== 0) return;
    const bar = event.target.closest('[class*="bar__"]');
    const anchor = event.target.closest('a[href]');
    let href = anchor?.href;
    if (bar?.className.includes('energy__')) href = document.body?.dataset.country === 'south-africa' ? '/index.php?page=hunting' : '/gym.php';
    if (bar?.className.includes('nerve___')) href = '/page.php?sid=crimes';
    if (!href) return;
    let url; try { url = new URL(fix(href), location.href); } catch { return; }
    if (!isTorn(url) || url.pathname === location.pathname && url.search === location.search && url.hash) return;
    // One click produces one navigation. Existing handlers must not open/reload it too.
    event.preventDefault(); event.stopImmediatePropagation();
    const now = Date.now();
    if (lastNavigation.url === url.href && now - lastNavigation.at < 750) return;
    lastNavigation = { url: url.href, at: now };
    if (event.ctrlKey || event.metaKey || event.shiftKey || anchor?.target === '_blank') window.open(url.href, '_blank');
    else location.assign(url.href);
  }, true);
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!isTorn(new URL(form.action, location.href))) return;
    const action = fix(form.action);
    if (action !== form.action) form.action = action;
    const field = form.querySelector('input[name="rfcv"]');
    if (field && token()) field.value = decodeURIComponent(token());
  }, true);
})();
