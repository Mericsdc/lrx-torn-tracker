/* Overview edit mode. Edit gives every shown widget a dashed frame with a drag handle (a button: the arrow keys move
   the widget, Delete removes it), a × and, for Premium members, S/M/L sizes; "+ Add widget" opens the add list.
   There is no private draft: every edit is computed from LRXOverview.current() at that moment, on the layout that is
   shown, and committed without saving, because the host may replace its set with the player's saved one when it
   confirms the player late. The controls are redrawn after every apply(). stop() saves once, and only after a real
   edit: Done, leaving the view, the window hidden and the layout switch turned off all call it. A Premium identity
   reset or another player closes edit mode without saving. */
(() => {
  const L = window.LRXOverviewLayout, O = window.LRXOverview;
  const grid = $('#ow-grid'), bar = $('#ow-bar'), drawer = $('#ow-drawer');
  const GRIP = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="5.5" cy="3.5" r="1.5"/><circle cx="10.5" cy="3.5" r="1.5"/><circle cx="5.5" cy="8" r="1.5"/><circle cx="10.5" cy="8" r="1.5"/><circle cx="5.5" cy="12.5" r="1.5"/><circle cx="10.5" cy="12.5" r="1.5"/></svg>';
  const DRAG_TYPE = 'application/x-lrx-widget'; // not text: a drop on a text field inserts nothing

  const title = (id) => { const t = window.LRXOverviewWidgets.titles[id]; return t ? tr(t[0], t[1]) : id; }; // overview-widgets.js
  const defaultName = () => tr('Ana düzen', 'Main');
  const playerId = () => { const id = Number(state.overview?.player?.id); return Number.isInteger(id) && id > 0 ? id : null; };
  // Edit needs a known player (the host drops saves made before one is known) and the widget layout switched on.
  const usable = () => feat('app.overviewLayout') && playerId() != null;
  const cell = (id) => grid.querySelector(`:scope > .ow-w[data-widget="${id}"]`);
  const widgetOf = (node) => node?.closest?.('#ow-grid > .ow-w') || null;
  const layoutIds = () => O.shown().widgets.map((w) => w.id);
  const onScreen = (id) => { const el = cell(id); return !!el && !el.hidden; }; // company mode hides #ov-company
  function make(tag, props = {}, attrs = {}) {
    const el = Object.assign(document.createElement(tag), props);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    return el;
  }
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
  const setAttr = (el, name, value) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };

  let editing = false, changed = false, startedFor = null, drawerOpen = false, drawerKey = '', selectKey = '', armed = 0, dragId = null;
  // Renderers that rewrite a whole card (the company summary every company poll, Premium tiles) drop its controls.
  const watch = new MutationObserver(() => { if (editing && feat('app.overviewLayout')) decorate(); });

  /* ---------- the bar ---------- */
  const select = make('select', { id: 'ow-layout', className: 'ow-layout' });
  const editBtn = make('button', { id: 'ow-edit', type: 'button', className: 'btn sm ghost' });
  const nameInput = make('input', { id: 'ow-name', type: 'text', className: 'input ow-name', maxLength: L.MAX_NAME, autocomplete: 'off', spellcheck: false });
  const dupBtn = make('button', { id: 'ow-duplicate', type: 'button', className: 'btn sm' });
  const delBtn = make('button', { id: 'ow-delete', type: 'button', className: 'btn sm' });
  const resetBtn = make('button', { id: 'ow-reset', type: 'button', className: 'btn sm' });
  const addBtn = make('button', { id: 'ow-add', type: 'button', className: 'btn sm' }, { 'aria-controls': 'ow-drawer', 'aria-expanded': 'false' });
  const doneBtn = make('button', { id: 'ow-done', type: 'button', className: 'btn sm primary' });
  const premiumTools = [nameInput, dupBtn, delBtn], editTools = [...premiumTools, resetBtn, addBtn, doneBtn];
  bar.replaceChildren(select, editBtn, ...editTools);

  function drawBar() {
    const set = O.current(), view = O.shown(), on = usable(), premium = O.access() === 'active';
    bar.hidden = !on;
    select.hidden = !(on && premium && set.layouts.length > 1);
    if (!select.hidden) {
      const key = JSON.stringify([state.lang, set.layouts.map((l) => l.name)]);
      if (key !== selectKey) { selectKey = key; select.replaceChildren(...set.layouts.map((l, i) => make('option', { value: String(i), textContent: l.name || defaultName() }))); }
      if (select.value !== String(view.index)) select.value = String(view.index);
    }
    setAttr(select, 'aria-label', tr('Düzen', 'Layout'));
    editBtn.hidden = !on || editing;
    setText(editBtn, tr('Düzenle', 'Edit'));
    for (const el of editTools) el.hidden = !editing;
    for (const el of premiumTools) el.hidden = !(editing && premium);
    nameInput.placeholder = defaultName();
    setAttr(nameInput, 'aria-label', tr('Düzen adı', 'Layout name'));
    if (document.activeElement !== nameInput && nameInput.value !== view.name) nameInput.value = view.name;
    setText(dupBtn, tr('Çoğalt', 'Duplicate'));
    dupBtn.disabled = set.layouts.length >= L.MAX_LAYOUTS;
    setText(delBtn, tr('Sil', 'Delete'));
    delBtn.disabled = set.layouts.length < 2;
    setText(resetBtn, armed ? tr('Emin misin?', 'Sure?') : tr('Varsayılana dön', 'Reset to default'));
    resetBtn.classList.toggle('ow-armed', !!armed);
    setText(addBtn, tr('+ Widget ekle', '+ Add widget'));
    setAttr(addBtn, 'aria-expanded', String(editing && drawerOpen));
    setText(doneBtn, tr('Bitti', 'Done'));
  }

  /* ---------- the widget controls ---------- */
  function controls(el) {
    let ctl = el.querySelector(':scope > .ow-ctl');
    if (ctl) return ctl;
    const sizes = L.byId[el.dataset.widget].sizes;
    ctl = make('div', { className: 'ow-ctl' });
    ctl.append(make('button', { type: 'button', className: 'ow-handle', draggable: true, innerHTML: GRIP }));
    if (sizes.length > 1) {
      const group = make('span', { className: 'ow-sizes' }, { role: 'group' });
      for (const size of sizes) group.append(make('button', { type: 'button', textContent: size }, { 'data-ow-size': size }));
      ctl.append(group);
    }
    ctl.append(make('button', { type: 'button', className: 'ow-remove', textContent: '×' }));
    el.prepend(ctl);
    return ctl;
  }
  function decorate() {
    const premium = O.access() === 'active', remove = tr('Kaldır', 'Remove'), ids = new Set();
    grid.classList.add('ow-editing');
    for (const w of O.shown().widgets) {
      const el = cell(w.id);
      if (!el) continue;
      ids.add(w.id);
      const ctl = controls(el), handle = ctl.querySelector('.ow-handle'), x = ctl.querySelector('.ow-remove'), sizes = ctl.querySelector('.ow-sizes');
      const move = tr('Taşı: ', 'Move: ') + title(w.id);
      setAttr(handle, 'aria-label', move); setAttr(handle, 'title', move);
      setAttr(x, 'aria-label', remove); setAttr(x, 'title', remove);
      if (sizes) {
        sizes.hidden = !premium;
        setAttr(sizes, 'aria-label', tr('Boyut', 'Size'));
        for (const b of sizes.children) setAttr(b, 'aria-pressed', String(b.dataset.owSize === w.size));
      }
      watch.observe(el, { childList: true });
    }
    for (const ctl of grid.querySelectorAll(':scope > .ow-w > .ow-ctl')) if (!ids.has(ctl.parentElement.dataset.widget)) ctl.remove();
  }
  function undecorate() {
    grid.classList.remove('ow-editing');
    for (const ctl of grid.querySelectorAll(':scope > .ow-w > .ow-ctl')) ctl.remove();
    clearMarks();
  }

  /* ---------- the add list ---------- */
  function drawDrawer() {
    drawer.hidden = !drawerOpen;
    if (!drawerOpen) return;
    const access = O.access(), locked = access !== 'active', inLayout = new Set(layoutIds());
    const free = L.WIDGETS.filter((w) => w.tier === 'free' && !inLayout.has(w.id) && (w.id !== 'company' || (state.companyMode && feat('page.company'))));
    const premium = access === 'off' ? null : L.WIDGETS.filter((w) => w.tier === 'premium' && !inLayout.has(w.id));
    const key = JSON.stringify([state.lang, access, free.map((w) => w.id), premium?.map((w) => w.id)]);
    if (key === drawerKey) return;
    drawerKey = key;
    const item = (w, off) => {
      const name = title(w.id), b = make('button', { type: 'button', className: 'ow-add-item', disabled: off }, { 'data-add': w.id });
      if (off) b.append(make('span', { textContent: '🔒' }, { 'aria-hidden': 'true' }), make('span', { className: 'ow-add-name', textContent: name }), make('small', { textContent: tr('Premium', 'Premium') }));
      else { b.append(make('span', { className: 'ow-add-name', textContent: name }), make('span', { className: 'ow-add-plus', textContent: '+' }, { 'aria-hidden': 'true' })); b.setAttribute('aria-label', tr('Ekle: ', 'Add: ') + name); }
      const li = make('li'); li.append(b);
      return li;
    };
    const list = (widgets, off) => { const ul = make('ul'); ul.append(...widgets.map((w) => item(w, off))); return ul; };
    const parts = [make('h3', { id: 'ow-drawer-title', textContent: tr('Widget ekle', 'Add widget') }), make('h4', { textContent: tr('Ücretsiz', 'Free') })];
    parts.push(free.length ? list(free, false) : make('p', { className: 'ow-add-none muted', textContent: tr("Tüm ücretsiz widget'lar ekranda.", 'Every free widget is already on the Overview.') }));
    if (premium) parts.push(make('h4', { textContent: tr('Premium 👑', 'Premium 👑') }), list(premium, locked));
    drawer.setAttribute('aria-labelledby', 'ow-drawer-title');
    drawer.replaceChildren(...parts);
  }

  /* ---------- editing ---------- */
  // Applies `op` to the set as it is now, on the layout that is shown. A refused edit changes nothing and commits nothing.
  function edit(op) {
    const before = O.current(), next = op(before, O.shown().index, O.access());
    if (JSON.stringify(next) === JSON.stringify(before)) return false;
    changed = true;
    O.commit(next, { save: false });
    return true;
  }
  function focusHandle(id, options) {
    const handle = id ? cell(id)?.querySelector(':scope > .ow-ctl .ow-handle') : null;
    handle?.focus(options);
    return !!handle;
  }
  // One place earlier or later among the widgets on screen (a hidden company summary is skipped).
  function step(id, by) {
    const ids = layoutIds(), visible = ids.filter(onScreen), other = visible[visible.indexOf(id) + by];
    if (!other) return;
    edit((s, i) => L.move(s, i, id, ids.indexOf(other)));
    focusHandle(id); // moving a card drops the focus inside it
  }
  function removeWidget(id) {
    const visible = layoutIds().filter(onScreen), at = visible.indexOf(id), next = visible[at + 1] || visible[at - 1];
    if (edit((s, i) => L.remove(s, i, id)) && !focusHandle(next)) addBtn.focus();
  }
  function place(id, targetId, after) {
    const ids = layoutIds(), from = ids.indexOf(id), at = ids.indexOf(targetId);
    if (from < 0 || at < 0) return;
    const to = at + (after ? 1 : 0);
    if (edit((s, i) => L.move(s, i, id, from < to ? to - 1 : to))) focusHandle(id, { preventScroll: true });
  }
  function copyName(set, index) {
    const names = new Set(set.layouts.map((l) => l.name || defaultName()));
    const base = (set.layouts[index].name || defaultName()).replace(/ \(\d+\)$/, '').slice(0, L.MAX_NAME - 4).trimEnd();
    for (let n = 2; ; n++) if (!names.has(`${base} (${n})`)) return `${base} (${n})`;
  }
  function disarm() { clearTimeout(armed); armed = 0; }

  function draw() {
    drawBar();
    if (editing && feat('app.overviewLayout')) { decorate(); drawDrawer(); } else { undecorate(); drawer.hidden = true; }
  }
  function start() {
    if (editing || !usable() || state.view !== 'overview') return;
    editing = true; changed = false; startedFor = playerId(); drawerOpen = false; drawerKey = '';
    draw();
  }
  function close() {
    editing = false; drawerOpen = false; disarm(); endDrag(); watch.disconnect();
    draw();
  }
  // Leaves edit mode and saves the set once if anything was edited. commit() settles even when the save is refused.
  async function stop() {
    if (!editing) return;
    const save = changed;
    changed = false;
    close();
    if (save) await O.commit(O.current());
  }
  function abandon() { if (editing) { changed = false; close(); } }

  /* ---------- drag and drop (from the handle only) ---------- */
  const columns = () => getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
  // The drop goes before or after the widget under the pointer: by its horizontal midpoint on a grid with columns,
  // by its vertical midpoint in one column.
  function spot(e) {
    const el = widgetOf(e.target);
    if (!el || el.dataset.widget === dragId) return null;
    const r = el.getBoundingClientRect();
    return { el, after: columns() > 1 ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2 };
  }
  function mark(s) {
    for (const el of grid.querySelectorAll(':scope > :is(.ow-drop-before,.ow-drop-after)')) if (el !== s?.el) el.classList.remove('ow-drop-before', 'ow-drop-after');
    if (s) { s.el.classList.toggle('ow-drop-after', s.after); s.el.classList.toggle('ow-drop-before', !s.after); }
  }
  function marked() {
    const el = grid.querySelector(':scope > :is(.ow-drop-before,.ow-drop-after)');
    return el && { el, after: el.classList.contains('ow-drop-after') };
  }
  function clearMarks() { for (const el of grid.querySelectorAll(':scope > :is(.ow-drop-before,.ow-drop-after,.ow-dragging)')) el.classList.remove('ow-drop-before', 'ow-drop-after', 'ow-dragging'); }
  function endDrag() { dragId = null; clearMarks(); }

  grid.addEventListener('dragstart', (e) => {
    if (!editing) return;
    const handle = e.target.closest?.('.ow-handle'), el = widgetOf(handle);
    if (!handle || !el) { e.preventDefault(); return; } // in edit mode a drag in the grid is always a move
    dragId = el.dataset.widget;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DRAG_TYPE, dragId);
    const r = el.getBoundingClientRect();
    e.dataTransfer.setDragImage(el, e.clientX - r.left, e.clientY - r.top);
    requestAnimationFrame(() => { if (dragId === el.dataset.widget) el.classList.add('ow-dragging'); });
  });
  grid.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (widgetOf(e.target)) mark(spot(e)); // over a gap the last mark stays
  });
  grid.addEventListener('dragleave', (e) => { if (dragId && !grid.contains(e.relatedTarget)) mark(null); });
  grid.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const id = dragId, s = spot(e) || (widgetOf(e.target) ? null : marked());
    endDrag();
    if (s) place(id, s.el.dataset.widget, s.after);
  });
  grid.addEventListener('dragend', endDrag);

  /* ---------- input ---------- */
  grid.addEventListener('keydown', (e) => {
    const handle = editing && e.target.closest?.('.ow-handle'), id = widgetOf(handle)?.dataset.widget;
    if (!id || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step(id, -1);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') step(id, 1);
    else if (e.key === 'Delete' || e.key === 'Backspace') removeWidget(id);
    else return;
    e.preventDefault();
  });
  grid.addEventListener('click', (e) => {
    const b = editing && e.target.closest?.('.ow-ctl button'), id = widgetOf(b)?.dataset.widget;
    if (!id) return;
    if (b.classList.contains('ow-remove')) removeWidget(id);
    else if (b.dataset.owSize) edit((s, i, a) => L.resize(s, i, id, b.dataset.owSize, a));
  });
  drawer.addEventListener('click', (e) => {
    const b = editing && e.target.closest('[data-add]');
    if (!b || b.disabled) return;
    const items = [...drawer.querySelectorAll('[data-add]:not([disabled])')], at = items.indexOf(b);
    const next = (items[at + 1] || items[at - 1])?.dataset.add;
    edit((s, i, a) => L.add(s, i, b.dataset.add, a));
    (next && drawer.querySelector(`[data-add="${next}"]`) || addBtn).focus();
  });
  select.addEventListener('change', () => { O.commit(L.select(O.current(), Number(select.value), O.access())); });
  editBtn.addEventListener('click', () => { start(); focusHandle(layoutIds().find(onScreen)); });
  doneBtn.addEventListener('click', () => { stop(); editBtn.focus(); });
  nameInput.addEventListener('change', () => {
    if (!editing) return;
    edit((s, i, a) => L.rename(s, i, nameInput.value, a));
    nameInput.value = O.shown().name; // as cleaned and stored
  });
  dupBtn.addEventListener('click', () => {
    if (!editing || !edit((s, i, a) => L.duplicate(s, i, copyName(s, i), a))) return;
    nameInput.focus(); nameInput.select(); // the copy is shown: name it
  });
  delBtn.addEventListener('click', () => {
    if (editing && edit((s, i, a) => L.removeLayout(s, i, a)) && delBtn.disabled) nameInput.focus();
  });
  resetBtn.addEventListener('click', () => {
    if (!editing) return;
    if (!armed) { armed = setTimeout(() => { armed = 0; drawBar(); }, 4000); drawBar(); return; }
    disarm();
    edit((s, i) => L.reset(s, i));
    drawBar();
  });
  addBtn.addEventListener('click', () => {
    if (!editing) return;
    drawerOpen = !drawerOpen;
    draw();
    if (drawerOpen) drawer.querySelector('[data-add]:not([disabled])')?.focus();
  });

  /* ---------- leaving ---------- */
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stop(); });
  window.addEventListener('lrx-premium-reset', abandon);
  FEATURE_HOOKS.push(() => { if (editing && !feat('app.overviewLayout')) stop(); });
  // Another player (or none): the host shows their own layout; nothing of this edit is saved for them.
  O.onApplied.push(() => { if (editing && playerId() !== startedFor) abandon(); draw(); });
  const previousLang = window.onLangChanged;
  window.onLangChanged = () => { previousLang?.(); draw(); };

  window.LRXOverviewEdit = Object.freeze({ start, stop, active: () => editing });
  drawer.classList.add('glass');
  draw();
})();
