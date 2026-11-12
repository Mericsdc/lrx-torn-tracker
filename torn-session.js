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
// Put saved cookies back (best effort) so a failed import never leaves the user signed out.
async function restoreCookies(ses, names, saved) {
  try { await removeCookies(ses, (await ses.cookies.get({})).filter((c) => names.has(c.name) && TORN.test(c.domain))); } catch {}
  for (const c of saved) { try { await ses.cookies.set(cookieDetails(c)); } catch {} }
  try { await ses.cookies.flushStore(); } catch {}
}
async function replaceTornCookies(ses, incoming) {
  const valid = incoming.filter((c) => TORN.test(c.domain || 'www.torn.com') && !/^(cf_|__cf)/i.test(c.name));
  const names = new Set([...AUTH_NAMES, ...valid.map((c) => c.name)]);
  const before = (await ses.cookies.get({})).filter((c) => names.has(c.name) && TORN.test(c.domain));
  let count = 0;
  try {
    await removeCookies(ses, before);
    for (const c of valid) {
      try { await ses.cookies.set(cookieDetails(c)); count++; }
      catch (e) { if (AUTH_NAMES.has(c.name)) throw e; /* Electron rejected a non-login cookie: skip it */ }
    }
  } catch (e) {
    await restoreCookies(ses, names, before);
    throw e;
  }
  await ses.cookies.flushStore();
  return count;
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
    try {
      await removeCookies(ses, cookies);
      await ses.cookies.set(cookieDetails(winner));
    } catch (e) {
      await restoreCookies(ses, new Set([name]), cookies);
      throw e;
    }
  }
  await ses.cookies.flushStore();
}
module.exports = { replaceTornCookies, normalizeTornSession };
