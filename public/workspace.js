(() => {
  Object.assign(I18N, {
    'set.tab.appearance': ['Görünüm', 'Appearance'],
    'set.themes': ['Temalar', 'Themes'],
    'set.themeHint': ['Takip ekranı ve tarayıcı araç çubuğu için bir tema seç.', 'Choose a theme for the tracker and browser toolbar.'],
    'auth.paste': ['Yapıştır', 'Paste'],
    'auth.keyHelp': ['16 karakter · Ctrl+V veya sağ tık → Yapıştır', '16 characters · Ctrl+V or right-click → Paste'],
  });
  const themes = [
    ['obsidian', 'Obsidyen', 'Obsidian', '#0b0e12', '#d6dce3'],
    ['ocean', 'Okyanus', 'Ocean', '#091b2b', '#69c8ff'],
    ['forest', 'Orman', 'Forest', '#0c201a', '#71ddb0'],
    ['amethyst', 'Ametist', 'Amethyst', '#20162e', '#c5a1ff'],
    ['light', 'Aydınlık', 'Light', '#edf2f7', '#245c95'],
  ];
  let savingTheme = false;
  function applyTheme(theme) {
    if (!themes.some(([id]) => id === theme)) theme = 'obsidian';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('tt.theme', theme); } catch {}
    $('#theme-options').innerHTML = themes.map(([id, trName, enName, bg, accent]) =>
      `<button type="button" class="theme-choice ${id === theme ? 'selected' : ''}" data-theme-choice="${id}" aria-pressed="${id === theme}" ${savingTheme ? 'disabled' : ''}>
        <span class="theme-swatch" style="background:${bg};--swatch-accent:${accent}"><i></i><i></i><i></i></span>
        <strong>${tr(trName, enName)}</strong><span>${id === theme ? '✓' : ''}</span></button>`).join('');
  }
  $('#theme-options').addEventListener('click', async (e) => {
    const button = e.target.closest('[data-theme-choice]');
    if (!button || savingTheme) return;
    const previous = document.documentElement.dataset.theme || 'obsidian';
    const theme = button.dataset.themeChoice;
    savingTheme = true;
    applyTheme(theme);
    $('#theme-save-status').textContent = tr('Kaydediliyor…', 'Saving…');
    try {
      await api('/api/config', { method: 'POST', body: JSON.stringify({ theme }) });
      state.config ||= {}; state.config.theme = theme;
      $('#theme-save-status').textContent = tr('Tema kaydedildi', 'Theme saved');
    } catch (err) {
      applyTheme(previous);
      $('#theme-save-status').textContent = err.message;
    } finally { savingTheme = false; applyTheme(document.documentElement.dataset.theme); }
  });
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
  window.onLangChanged = () => { oldLang?.(); applyTheme(document.documentElement.dataset.theme); window.updateWorkspaceShortcuts(); };
  applyTheme(state.config?.theme || document.documentElement.dataset.theme || 'obsidian');
  window.updateWorkspaceShortcuts();
  applyLang();
})();
