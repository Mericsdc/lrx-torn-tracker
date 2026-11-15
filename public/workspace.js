(() => {
  Object.assign(I18N, {
    'set.tab.appearance': ['Görünüm', 'Appearance'],
    'set.themes': ['Temalar', 'Themes'],
    'set.themeHint': ['Takip ekranı ve tarayıcı araç çubuğu için bir görünüm seç. Önizlemek için bir temanın üzerine gel.', 'Choose a look for the tracker and the browser toolbar. Point at a theme to preview it.'],
    'auth.paste': ['Yapıştır', 'Paste'],
    'auth.keyHelp': ['16 karakter · Ctrl+V veya sağ tık → Yapıştır', '16 characters · Ctrl+V or right-click → Paste'],
  });
  // Theme picker: a list beside a large preview. The preview is painted by themes.css through data-preview-theme, so
  // the colours here are never copied: [id, Turkish name, English name, kind, Turkish description, English description].
  const themes = [
    ['obsidian', 'Obsidyen', 'Obsidian', 'dark', 'Grafit ve altın; uygulamanın özgün görünümü', 'Graphite and gold, the original look'],
    ['ocean', 'Okyanus', 'Ocean', 'dark', 'Gece mavisi üzerinde gök mavisi vurgular', 'Deep navy with sky-blue highlights'],
    ['forest', 'Orman', 'Forest', 'dark', 'Koyu yeşil; gece kullanımında göz yormaz', 'Dark green, easy on the eyes at night'],
    ['amethyst', 'Ametist', 'Amethyst', 'dark', 'Mürdüm tonları ve yumuşak mor vurgular', 'Plum with soft violet accents'],
    ['light', 'Aydınlık', 'Light', 'light', 'Gündüz kullanımı için aydınlık ve sade', 'Bright and clean for daytime use'],
  ];
  const themeList = $('#theme-options'), themePreview = $('#theme-preview');
  let savingTheme = false, activeTheme = 'obsidian', themeStatus = { kind: '', message: '' }, themeStatusTimer = 0;
  const themeRow = (id) => themes.find(([t]) => t === id) || themes[0];
  const themeKind = (kind) => (kind === 'light' ? tr('Açık', 'Light') : tr('Koyu', 'Dark'));
  const focusedTheme = () => (themeList.contains(document.activeElement) ? document.activeElement.dataset.themeChoice : null);
  // Only keyboard focus holds the preview. A mouse click leaves focus on its row too, and that row may not be the
  // applied theme (a click ignored while a save runs, or a save that failed).
  const keyboardTheme = () => (document.activeElement?.matches?.(':focus-visible') ? focusedTheme() : null);
  const hoveredTheme = () => themeList.querySelector('[data-theme-choice]:hover')?.dataset.themeChoice || null;
  // A Premium appearance profile paints its own palette over the saved base theme: no base theme is "Active" then.
  const premiumLook = () => !!document.documentElement.dataset.premiumAppearance;
  function renderThemeChoices() {
    const focused = focusedTheme(), premium = premiumLook();
    themeList.setAttribute('role', 'group');
    themeList.setAttribute('aria-label', tr('Temalar', 'Themes'));
    themeList.setAttribute('aria-busy', String(savingTheme));
    themeList.innerHTML = themes.map(([id, trName, enName, kind]) => {
      const on = id === activeTheme && !premium;
      return `<button type="button" class="theme-choice${on ? ' selected' : ''}" data-theme-choice="${id}" aria-pressed="${on}" tabindex="${id === activeTheme ? 0 : -1}">`
        + `<span class="theme-dots" data-preview-theme="${id}" aria-hidden="true"><i></i><i></i><i></i></span>`
        + `<span class="theme-name"><strong>${tr(trName, enName)}</strong><span class="theme-kind">${themeKind(kind)}</span></span>`
        + (on ? `<span class="theme-active">${tr('Aktif', 'Active')}</span>` : '') + '</button>';
    }).join('');
    // Rebuilding the list must not drop the keyboard focus to the page.
    if (focused) themeList.querySelector(`[data-theme-choice="${focused}"]`)?.focus();
  }
  function renderThemePreview() {
    const kpi = (value) => `<div class="tp-card"><i class="tp-label"></i><b>${value}</b><span class="tp-meter"><i></i></span></div>`;
    themePreview.innerHTML = '<div class="tp-bar"><span class="tp-tab on"></span><span class="tp-tab"></span><span class="tp-tab"></span></div>'
      + '<div class="tp-body"><div class="tp-side"><div class="tp-brand"><b>LRX</b><i></i></div>'
      + '<span class="tp-nav on"></span><span class="tp-nav"></span><span class="tp-nav"></span><span class="tp-nav"></span><span class="tp-nav"></span><span class="tp-nav"></span></div>'
      + `<div class="tp-main"><div class="tp-head"><div><strong>${tr(...I18N['nav.overview'])}</strong><i></i></div><span class="tp-btn">${tr('Yenile', 'Refresh')}</span></div>`
      + `<div class="tp-kpis">${kpi('120/150')}${kpi('35/60')}${kpi('3,500')}</div>`
      + `<div class="tp-card tp-table">${'<span class="tp-row"><i></i><i></i><b></b></span>'.repeat(4)}</div></div></div>`;
  }
  function showThemePreview(id) {
    const [themeId, trName, enName, kind, trText, enText] = themeRow(id);
    themePreview.dataset.previewTheme = themeId;
    $('#theme-caption').innerHTML = `<div class="theme-caption-title"><strong>${tr(trName, enName)}</strong><span class="theme-kind">${themeKind(kind)}</span></div>`
      + `<p>${tr(trText, enText)}</p><small>${premiumLook() ? tr('Premium görünüm açık · bir tema seçmek onu kapatır', 'Premium appearance is on · choosing a theme turns it off')
        : themeId === activeTheme ? tr('Etkin tema', 'Active theme') : tr('Önizleme · uygulamak için seç', 'Preview · select to apply')}</small>`;
  }
  function paintThemeStatus() {
    const el = $('#theme-save-status'), { kind, message } = themeStatus;
    el.textContent = kind === 'saving' ? tr('Kaydediliyor…', 'Saving…') : kind === 'saved' ? tr('Tema kaydedildi', 'Theme saved') : message;
    el.classList.toggle('is-saved', kind === 'saved');
    el.classList.toggle('is-error', kind === 'error');
  }
  function setThemeStatus(kind, message = '') {
    clearTimeout(themeStatusTimer);
    themeStatus = { kind, message };
    paintThemeStatus();
    if (kind === 'saved') themeStatusTimer = setTimeout(() => setThemeStatus(''), 4000);
  }
  function applyTheme(theme) {
    if (!themes.some(([id]) => id === theme)) theme = 'obsidian';
    if (document.documentElement.dataset.premiumAppearance) theme = state.config?.theme || 'obsidian';
    else document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('tt.theme', theme); } catch {}
    activeTheme = theme;
    renderThemeChoices();
    showThemePreview(keyboardTheme() || hoveredTheme() || theme);
  }
  themeList.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-theme-choice]');
    if (!button || savingTheme) return;
    window.dispatchEvent(new Event('lrx-base-theme-selected'));
    const previous = document.documentElement.dataset.theme || 'obsidian';
    const theme = button.dataset.themeChoice;
    savingTheme = true;
    applyTheme(theme);
    setThemeStatus('saving');
    try {
      await api('/api/config', { method: 'POST', body: JSON.stringify({ theme }) });
      state.config ||= {}; state.config.theme = theme;
      setThemeStatus('saved');
    } catch (err) {
      applyTheme(previous);
      setThemeStatus('error', err.message);
    } finally { savingTheme = false; applyTheme(document.documentElement.dataset.theme); }
  });
  // The preview follows the pointer and the keyboard focus; leaving the list shows the active theme again.
  themeList.addEventListener('pointerover', (e) => { const b = e.target.closest('[data-theme-choice]'); if (b) showThemePreview(b.dataset.themeChoice); });
  themeList.addEventListener('pointerleave', () => showThemePreview(keyboardTheme() || activeTheme));
  themeList.addEventListener('focusin', (e) => { const b = e.target.closest('[data-theme-choice]'); if (b) showThemePreview(b.dataset.themeChoice); });
  themeList.addEventListener('focusout', (e) => { if (!themeList.contains(e.relatedTarget)) showThemePreview(hoveredTheme() || activeTheme); });
  themeList.addEventListener('keydown', (e) => {
    const current = e.target.closest('[data-theme-choice]');
    const buttons = [...themeList.querySelectorAll('[data-theme-choice]')], at = buttons.indexOf(current);
    const next = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: buttons.length - 1 }[e.key];
    if (!current || next == null) return;
    e.preventDefault();
    const target = buttons[(next + buttons.length) % buttons.length];
    for (const b of buttons) b.tabIndex = b === target ? 0 : -1;
    target.focus();
  });
  renderThemePreview();
  let lastCount = 0, override = null;
  window.updateWorkspaceShortcuts = () => {
    const count = state.browserTabs.length;
    if (count !== lastCount) { override = null; lastCount = count; }
    const closed = override === null ? count > 1 || window.innerWidth < 1100 : override;
    const shortcuts = $('#workspace-shortcuts');
    shortcuts.classList.toggle('collapsed', closed);
    shortcuts.inert = closed;
    shortcuts.setAttribute('aria-hidden', String(closed));
    const toggle = $('#quick-toggle');
    toggle.setAttribute('aria-expanded', String(!closed));
    toggle.title = tr(closed ? 'Kısayolları göster' : 'Kısayolları gizle', closed ? 'Show shortcuts' : 'Hide shortcuts');
    toggle.setAttribute('aria-label', toggle.title);
    $('#workspace-bar').classList.toggle('shortcuts-open', !closed);
  };
  $('#quick-toggle').addEventListener('click', () => {
    override = !$('#workspace-shortcuts').classList.contains('collapsed');
    window.updateWorkspaceShortcuts();
  });
  window.addEventListener('resize', () => { override = null; window.updateWorkspaceShortcuts(); });
  FEATURE_HOOKS.push(() => {
    if (!savingTheme) applyTheme(state.config?.theme || document.documentElement.dataset.theme || 'obsidian');
    window.updateWorkspaceShortcuts();
  });
  const oldLang = window.onLangChanged;
  window.onLangChanged = () => { oldLang?.(); renderThemePreview(); applyTheme(document.documentElement.dataset.theme); paintThemeStatus(); window.updateWorkspaceShortcuts(); };
  applyTheme(state.config?.theme || document.documentElement.dataset.theme || 'obsidian');
  window.updateWorkspaceShortcuts();
  applyLang();
})();
