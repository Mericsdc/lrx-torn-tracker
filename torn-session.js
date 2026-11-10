// Cookie imports replace a Torn session, rather than mixing two accounts/tokens.
const TORN = /(^|\.)torn\.com$/i;
const AUTH_NAMES = new Set(['PHPSESSID', 'uid', 'pass', 'rfc_v']);
function cookieDetails(c) {
  const domain = c.domain || '.torn.com';
  const details = { url: `https://${domain.replace(/^\./, '')}${c.path || '/'}`, name: c.name, value: c.value, path: c.path || '/', secure: true, httpOnly: !!c.httpOnly };
  if (domain.startsWith('.')) details.domain = domain;
  const expires = c.expirationDate || c.expires;
  if (!c.session && expires > 0) details.expirationDate = expires;
  const ss = String(c.sameSite || '').toLowerCase();
  details.sameSite = ['lax', 'strict'].includes(ss) ? ss : ss === 'none' || ss === 'no_restriction' ? 'no_restriction' : 'lax';
  return details;
}
async function removeCookies(ses, cookies) {
  for (const c of cookies) {
    if (!TORN.test(c.domain)) continue;
    await ses.cookies.remove(`https://${c.domain.replace(/^\./, '')}${c.path || '/'}`, c.name);
  }
}
async function replaceTornCookies(ses, incoming) {
  const valid = incoming.filter((c) => TORN.test(c.domain || 'www.torn.com') && !/^(cf_|__cf)/i.test(c.name));
  const names = new Set([...AUTH_NAMES, ...valid.map((c) => c.name)]);
  await removeCookies(ses, (await ses.cookies.get({})).filter((c) => names.has(c.name)));
  for (const c of valid) {
    const domain = c.domain || '.torn.com';
    const details = {
      url: `https://${domain.replace(/^\./, '')}${c.path || '/'}`,
      name: c.name, value: c.value, path: c.path || '/', secure: true, httpOnly: !!c.httpOnly,
    };
    if (domain.startsWith('.')) details.domain = domain;
    const expires = c.expirationDate || c.expires;
    if (!c.session && expires > 0) details.expirationDate = expires;
    const ss = String(c.sameSite || '').toLowerCase();
    details.sameSite = ['lax', 'strict'].includes(ss) ? ss : ss === 'none' || ss === 'no_restriction' ? 'no_restriction' : 'lax';
    await ses.cookies.set(details);
  }
  await ses.cookies.flushStore();
  return valid.length;
}
// Preserve the host-specific cookie chosen by Chrome, then remove duplicates.
// Do this at startup, before a page can capture an obsolete RFC token.
async function normalizeTornSession(ses) {
  const all = (await ses.cookies.get({})).filter((c) => TORN.test(c.domain));
  for (const name of AUTH_NAMES) {
    const cookies = all.filter((c) => c.name === name);
    if (cookies.length < 2) continue;
    const winner = cookies.find((c) => c.domain === 'www.torn.com' && c.path === '/')
      || cookies.find((c) => c.domain === '.torn.com' && c.path === '/') || cookies[0];
    await removeCookies(ses, cookies);
    await ses.cookies.set(cookieDetails(winner));
  }
  await ses.cookies.flushStore();
}
module.exports = { replaceTornCookies, normalizeTornSession };
