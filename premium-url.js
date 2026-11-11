// Publisher-controlled service address. Paths allow an API alongside an existing site.
function serviceUrl(value, { allowLoopbackHttp = false } = {}) {
  if (typeof value !== 'string') throw Error('Invalid service URL');
  const url = new URL(value);
  const rawPath = value.match(/^[a-z]+:\/\/[^/?#]+(\/[^?#]*)?/i)?.[1] || '/';
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]*$/.test(rawPath) || !(url.protocol === 'https:' || allowLoopbackHttp && loopback && url.protocol === 'http:')) throw Error('Invalid service URL');
  url.pathname = url.pathname.replace(/\/$/, '') + '/';
  return url;
}
module.exports = { serviceUrl };
