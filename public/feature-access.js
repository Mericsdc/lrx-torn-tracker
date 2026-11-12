// Presentation cache only. Every paid operation is authorized again by the service.
(() => {
  const catalog = window.LRXFeatureCatalog;
  let snapshot = null, pending = null, fetched = 0, deadline = 0, generation = 0, lastSignature = '', restoreOwner = null, loadingModule = null;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/feature-access.css'; document.head.append(css);
  const owner = () => snapshot?.account?.tornId || null;
  function can(id) { const d = catalog.byId[id]; return !!d && (d.tier === 'free' || performance.now() < deadline && snapshot?.account?.verified && snapshot?.featureAccess?.permissions?.[id] === true); }
  function clearAppearance() {
    const root = document.documentElement;
    if (!root.dataset.premiumAppearance) return;
    delete root.dataset.premiumAppearance; delete root.dataset.density; delete root.dataset.cardStyle;
    for (const k of ['--bg', '--bg-2', '--panel', '--panel-end', '--field', '--workspace-chrome', '--text', '--muted', '--muted-2', '--tq', '--tq-2', '--tq-soft', '--tq-border', '--gold', '--gold-2', '--radius', '--radius-sm', 'color-scheme']) root.style.removeProperty(k);
    root.dataset.theme = state.config?.theme || 'obsidian';
  }
  function applyAppearance(p) {
    if (!can('appearance_custom_themes') || !snapshot.featureAccess.consent) return clearAppearance();
    const root = document.documentElement, c = p.palette;
    // Colors came from server validation; a strict allowlist also prevents CSS injection.
    if (!c || !['bg', 'panel', 'text', 'muted', 'accent'].every((k) => /^#[0-9a-f]{6}$/i.test(c[k]))) return;
    const vars = { '--bg': c.bg, '--bg-2': c.bg, '--panel': c.panel, '--panel-end': c.bg, '--field': c.bg, '--workspace-chrome': c.bg, '--text': c.text, '--muted': c.muted, '--muted-2': c.muted, '--tq': c.accent, '--tq-2': c.accent, '--tq-soft': c.accent + '18', '--tq-border': c.accent + '66', '--gold': c.accent, '--gold-2': c.accent, '--radius': p.radius + 'px', '--radius-sm': Math.min(p.radius, 10) + 'px' };
    for (const [k, value] of Object.entries(vars)) root.style.setProperty(k, value);
    root.style.setProperty('color-scheme', p.baseTheme === 'light' ? 'light' : 'dark'); root.dataset.theme = p.baseTheme;
    root.dataset.premiumAppearance = 'true'; root.dataset.density = p.density; root.dataset.cardStyle = p.cards;
    try { localStorage.removeItem('lrx.appearance.disabled.' + owner()); } catch {}
  }
  // Settings → General → App: "Premium membership connection" (app.premium) and "Premium module cards" (app.premiumPromos)
  const premiumOff = () => typeof feat === 'function' && !feat('app.premium');
  const promosOff = () => typeof feat === 'function' && !feat('app.premiumPromos');
  function paint() {
    const hidePromos = promosOff();
    for (const host of document.querySelectorAll('[data-feature-slot]')) {
      const hide = hidePromos && !host.closest('#premium-content');
      host.hidden = hide;
      if (hide && host.dataset.featureOpen) { window.LRXAdvanced?.close?.(); continue; }
      if (hide || host.dataset.featureOpen) continue;
      const d = catalog.byId[host.dataset.featureSlot]; if (!d) continue;
      const allowed = can(d.id), expired = snapshot?.subscription?.status === 'expired', off = !!snapshot?.disabled || premiumOff();
      host.innerHTML = `<article class="fx-entry ${allowed ? 'is-available' : 'is-locked'}"><div class="fx-entry-mark" aria-hidden="true">◇</div><div class="fx-entry-copy"><div><h3>${esc(d.title[state.lang === 'en' ? 1 : 0])}</h3><span class="fx-badge">Premium</span></div><p>${esc(d.description[state.lang === 'en' ? 1 : 0])}</p><small>${allowed ? tr('Üyeliğinize dahil', 'Included in your membership') : off ? tr('Premium bağlantısı kapalı · Ayarlar → Genel → Uygulama', 'Premium connection is off · Settings → General → App') : expired ? tr('Üyeliğiniz sona erdi. Kayıtlı profilleriniz korunuyor.', 'Membership expired. Your saved profiles are retained.') : tr('Kilitli · mevcut temel araçlar ücretsiz kalır', 'Locked · existing tools remain free')}</small></div><button type="button" class="btn sm ${allowed ? 'primary' : 'ghost'}" data-advanced-open="${d.id}">${allowed ? tr('Aç', 'Open') : tr('Detaylar', 'Details')} <span aria-hidden="true">↗</span></button></article>`;
    }
  }
  function changed() {
    const a = snapshot?.featureAccess, sub = snapshot?.subscription;
    if (a && sub?.active && !sub.permanent && a.serverNow + (performance.now() - fetched) / 1000 >= sub.expiresAt) snapshot.subscription = { ...sub, active: false, status: 'expired', remainingDays: 0 };
    const signature = JSON.stringify([owner(), !!snapshot?.featureAccess?.consent, catalog.premium.map((d) => can(d.id)), snapshot?.subscription?.status, snapshot?.featureAccess?.automations]);
    if (signature !== lastSignature) {
      lastSignature = signature; paint(); window.dispatchEvent(new CustomEvent('lrx-feature-access-changed', { detail: snapshot }));
      const automations = snapshot?.featureAccess?.automations || [];
      if (automations.some((a) => can(a.featureId))) loadModule().then(() => window.LRXAdvanced.resume(automations)).catch(() => {});
    }
    if (!can('appearance_custom_themes') || !snapshot?.featureAccess?.consent) { clearAppearance(); restoreOwner = null; }
    else if (restoreOwner !== owner()) { restoreOwner = owner(); restoreAppearance(); }
  }
  function accept(value) {
    const prev = owner(); snapshot = value; fetched = performance.now();
    const a = value?.featureAccess; deadline = a ? performance.now() + Math.max(0, Math.min(60, a.validUntil - a.serverNow)) * 1000 : 0;
    if (prev !== owner()) { generation++; clearAppearance(); restoreOwner = null; window.dispatchEvent(new Event('lrx-feature-identity-changed')); }
    changed(); return snapshot;
  }
  async function status(force = false) {
    // Connection switched off in Settings: nothing is requested; the server enforces the same rule.
    if (premiumOff()) return snapshot?.disabled ? snapshot : accept({ configured: true, connected: false, disabled: true, code: 'PREMIUM_DISABLED', freeApiAccess: true });
    if (pending) return pending;
    if (!force && snapshot && performance.now() - fetched < 15000) return snapshot;
    const stamp = generation;
    const task = api('/api/premium/status').then((data) => stamp === generation ? accept(data) : null).catch((e) => { if (stamp === generation) { deadline = 0; changed(); } throw e; }).finally(() => { if (pending === task) pending = null; });
    pending = task; return task;
  }
  // A rejected call drops cached access and refetches status at most once per 30 s. Without the limit,
  // status granting access while a call keeps failing re-triggered restoreAppearance()/resume() in a tight request loop.
  let invalidatedAt = -Infinity;
  async function call(action, body = {}) {
    try { const value = await api('/api/premium/feature-' + action, { method: 'POST', body: JSON.stringify(body) }); if (value.access && snapshot) accept({ ...snapshot, featureAccess: value.access }); return value; }
    catch (e) { if ([401, 403, 503].includes(e.status) && performance.now() - invalidatedAt >= 30000) { invalidatedAt = performance.now(); deadline = 0; changed(); status(true).catch(() => {}); } throw e; }
  }
  async function restoreAppearance() {
    try {
      if (localStorage.getItem('lrx.appearance.disabled.' + owner())) return;
      const identity = owner(), stamp = generation, w = await call('workspace', { featureId: 'appearance_custom_themes' });
      if (!w.activeProfile || identity !== owner() || stamp !== generation || !can('appearance_custom_themes')) return;
      const r = await call('run', { featureId: 'appearance_custom_themes', profileId: w.activeProfile });
      if (identity === owner() && stamp === generation) applyAppearance(r.params);
    } catch { /* A service outage never prevents use of the saved Free theme. */ }
  }
  function loadModule() {
    if (!loadingModule) loadingModule = new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = '/advanced-modules.js'; s.onload = resolve; s.onerror = () => { loadingModule = null; s.remove(); reject(new Error(tr('Modül yüklenemedi.', 'Could not load module.'))); }; document.body.append(s); });
    return loadingModule;
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-advanced-open]'); if (!b) return;
    const id = b.dataset.advancedOpen;
    if (!can(id)) { showView('premium'); return; }
    b.disabled = true;
    try { await loadModule(); await window.LRXAdvanced.open(id, b.closest('[data-feature-slot]')); } catch (error) { toast(window.LRXAdvanced?.errorText ? window.LRXAdvanced.errorText(error) : error.message); } finally { b.disabled = false; }
  });
  window.addEventListener('lrx-base-theme-selected', () => {
    clearAppearance(); try { localStorage.setItem('lrx.appearance.disabled.' + owner(), '1'); } catch {}
    if (can('appearance_custom_themes')) call('workspace', { featureId: 'appearance_custom_themes' }).then((w) => call('select', { featureId: 'appearance_custom_themes', revision: w.revision, profileId: null })).catch(() => {});
  });
  window.addEventListener('lrx-premium-reset', () => { generation++; deadline = 0; snapshot = null; pending = null; fetched = 0; restoreOwner = null; clearAppearance(); changed(); window.dispatchEvent(new Event('lrx-feature-identity-changed')); setTimeout(() => status(true).catch(() => {}), 0); });
  const previousLang = window.onLangChanged; window.onLangChanged = () => { previousLang?.(); paint(); };
  window.PremiumAccess = { can, status, accept, call, applyAppearance, clearAppearance, snapshot: () => snapshot, repaint: paint };
  if (typeof FEATURE_HOOKS !== 'undefined') FEATURE_HOOKS.push(paint);
  paint(); setTimeout(() => status().catch(() => {}), 1800);
  // While the window is hidden the snapshot is not refreshed, so an expired 60 s deadline only means "stale":
  // do not clear the theme or repaint until a fresh status has been fetched after the window is shown again.
  let resuming = false;
  const evaluate = () => { if (document.visibilityState === 'visible' && !resuming) changed(); };
  setInterval(() => { evaluate(); if (document.visibilityState === 'visible' || snapshot?.featureAccess?.automations?.length) status().catch(() => {}); }, 30000);
  setInterval(evaluate, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    resuming = true;
    status(true).catch(() => {}).finally(() => { resuming = false; changed(); });
  });
})();
