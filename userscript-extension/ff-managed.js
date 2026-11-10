// The upstream script uses this opaque marker, never the saved credential.
// Its real key is added by the authenticated local proxy for every request.
const LRX_MANAGED_KEY = 'LRXMANAGEDKEY000';
localStorage.removeItem('ffsv3-configkey');
const fetch = (input, options = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (new URL(url, location.href).hostname !== 'api.torn.com') return window.fetch(input, options);
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const handle = GM_xmlhttpRequest({ url, method: options.method || 'GET', headers: options.headers, timeout: 30000,
      onload: (r) => resolve(new Response(r.responseText, { status: r.status, statusText: r.statusText })),
      onerror: (e) => reject(new Error(e.error || 'Torn API request failed')), ontimeout: () => reject(new Error('Torn API request timed out')) });
    options.signal?.addEventListener('abort', () => { handle.abort(); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
};
