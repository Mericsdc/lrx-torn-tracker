(() => {
  const dialog = $('#companion-palette'), opener = $('#companion-palette-open');
  if (!dialog || !opener) return;
  const input = dialog.querySelector('input'), results = dialog.querySelector('.companion-palette-list');
  const result = dialog.querySelector('[data-calculation]');
  const title = dialog.querySelector('h2'), close = dialog.querySelector('[data-close-palette]');
  const urls = [
    ['companies.php', 'Şirket', 'Company', 'stock employee'],
    ['factions.php?step=your', 'Faction', 'Faction', 'armory chain bank'],
    ['gym.php', 'Gym', 'Gym', 'training'],
    ['trade.php', 'Ticaret', 'Trade', 'trade buy sell'],
    ['page.php?sid=ItemMarket', 'Item Market', 'Item Market', 'market bazaar'],
    ['item.php', 'Envanter', 'Inventory', 'items'],
    ['travelagency.php', 'Seyahat', 'Travel', 'abroad'],
    ['page.php?sid=crimes', 'Suçlar', 'Crimes', 'crimes'],
    ['amarket.php#itemtab=weapons&start=0', 'Müzayede', 'Auction House', 'ah auction'],
  ];
  let hits = [], active = 0, returnFocus = null;
  const label = () => tr('Hızlı erişim', 'Quick navigation');
  const fold = (text) => text.toLocaleLowerCase(timeLocale()).normalize('NFD').replace(/\p{Diacritic}/gu, '').replaceAll('ı', 'i');

  function entries() {
    return [
      ...$$('#nav .nav-item').filter((b) => !b.hidden && !viewHidden(b.dataset.view))
        .map((b) => ({ label: VIEW_META[b.dataset.view]?.[state.lang]?.[0] ?? b.textContent.trim(), key: b.dataset.view, view: b.dataset.view })),
      ...urls.map(([path, a, b, key]) => ({ label: 'Torn · ' + tr(a, b), key, path })),
    ];
  }

  function update() {
    const q = input.value.trim(), query = fold(q);
    const n = q.startsWith('=') ? window.LRXCompanionMath.calculator(q.slice(1)) : null;
    result.hidden = !q.startsWith('=');
    if (!result.hidden) result.textContent = n == null
      ? tr('Geçerli bir işlem gir. Örnek = 200000 * 10%', 'Enter an expression. Example = 200000 * 10%')
      : Number(n).toLocaleString(timeLocale(), { maximumFractionDigits: 8 });
    hits = result.hidden ? entries().filter((x) => query.split(/\s+/).every((word) => fold(x.label + ' ' + x.key).includes(word))).slice(0, 12) : [];
    active = Math.min(active, Math.max(0, hits.length - 1));
    results.replaceChildren(...hits.map((hit, i) => {
      const button = document.createElement('button');
      button.className = 'btn ghost';
      button.type = 'button'; button.tabIndex = -1;
      button.id = 'companion-command-' + i; button.dataset.index = String(i);
      button.setAttribute('role', 'option'); button.textContent = hit.label;
      return button;
    }));
    if (!hits.length && result.hidden) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = tr('Sonuç bulunamadı.', 'No results.');
      results.append(empty);
    }
    input.setAttribute('aria-expanded', String(hits.length > 0));
    paintSelection();
  }
  function paintSelection() {
    for (const [i, node] of [...results.querySelectorAll('[role=option]')].entries()) node.setAttribute('aria-selected', String(i === active));
    if (hits.length) input.setAttribute('aria-activedescendant', 'companion-command-' + active);
    else input.removeAttribute('aria-activedescendant');
  }
  function open() {
    if (dialog.open || opener.hidden || state.activeWsTab !== 'tracker' || document.querySelector('dialog[open], #auth-screen:not([hidden]), #login-modal:not([hidden]), #update-modal:not([hidden]), #ny-welcome:not([hidden])')) return;
    returnFocus = document.activeElement;
    title.textContent = label();
    close.textContent = tr('Kapat', 'Close');
    input.placeholder = tr('Sayfa ara veya = ile hesapla', 'Search pages or start with = to calculate');
    input.setAttribute('aria-label', input.placeholder);
    input.value = ''; active = 0; update();
    dialog.showModal(); input.focus();
  }
  function activate(i) {
    const hit = hits[i];
    if (!hit) return;
    dialog.close();
    if (hit.view) showView(hit.view);
    else openInTab('https://www.torn.com/' + hit.path, { reuse: true, label: hit.label });
  }
  opener.addEventListener('click', open);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    e.preventDefault();
    dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (state.activeWsTab === 'tracker' && returnFocus?.isConnected && !returnFocus.hidden) returnFocus.focus();
  });
  input.addEventListener('input', () => { active = 0; update(); });
  results.addEventListener('click', (e) => {
    const node = e.target.closest('[data-index]');
    if (node) activate(Number(node.dataset.index));
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || !hits.length) return;
    if (e.key === 'Enter') { e.preventDefault(); activate(active); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      paintSelection();
      document.getElementById('companion-command-' + active)?.scrollIntoView({ block: 'nearest' });
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.repeat || e.isComposing || e.shiftKey || e.key.toLowerCase() !== 'k' ||
      !(e.altKey && !e.ctrlKey && !e.metaKey || (e.ctrlKey || e.metaKey) && !e.altKey) || dialog.open ||
      e.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable=false])')) return;
    open();
    if (dialog.open) e.preventDefault();
  });

  function sync() {
    opener.hidden = !feat('companion.palette');
    opener.setAttribute('aria-label', label());
    opener.title = label() + ' (Ctrl+K)';
    if (opener.hidden && dialog.open) dialog.close();
  }
  FEATURE_HOOKS.push(sync);
  const langChanged = window.onLangChanged;
  window.onLangChanged = () => { langChanged?.(); sync(); };
  sync();
})();
