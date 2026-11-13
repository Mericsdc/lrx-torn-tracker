/* Overview widget host. The Overview cards are widgets in one ordered CSS grid (#ow-grid). The rules (default
   layout, repair, access) live in overview-layout.js; each Torn player's saved set lives in the app config behind
   /api/overview-layouts. The cards keep the fixed IDs app.js renders into, whether or not their widget is shown:
   a widget outside the layout only gets the class `ow-off`. `hidden` on #ov-company belongs to company mode.
   Premium tiles are created here and drawn from LRXOverviewWidgets (overview-widgets.js); each loads from its page's
   endpoint only while the Overview is on screen, at most once a minute (see refresh()). */
(() => {
  const L = window.LRXOverviewLayout, W = window.LRXOverviewWidgets;
  const grid = $('#ow-grid');
  const CACHE = 'tt.cache.overviewLayouts.'; // + Torn player ID: the last set the server confirmed for that player
  const CLASSIC = ['drug', 'edu', 'day', 'bars', 'battle', 'company']; // the fixed screen shown with the switch off
  const EVERY = 15_000, AGAIN = 60_000; // the refresh check; the least time between two loads of one tile
  const LOCKS = {
    premium: () => tr('Premium ile açılır', 'Unlocks with Premium'),
    checking: () => tr('Üyelik kontrol ediliyor…', 'Checking membership…'),
    unavailable: () => tr('Kullanılamıyor', 'Not available'),
  };
  I18N['ov.status'] = ['Durum', 'Status'];

  let current = L.defaultSet(), shown = null, ownerId = null;
  // unsaved: the player changed the set since it was loaded and that change is still to be saved (or is being edited).
  // fallback: `current` grew from the default set, not from the player's cached or confirmed copy.
  let loadedFor = null, loading = null, stamp = 0, unsaved = false, fallback = true, saving = Promise.resolve(), hint = null;
  const tiles = {}; // Premium widget id → (el, locked) => void: draws that tile

  const playerId = () => { const id = Number(state.overview?.player?.id); return Number.isInteger(id) && id > 0 ? id : null; };
  const cell = (id) => grid.querySelector(`:scope > .ow-w[data-widget="${id}"]`);
  function cached(id) { try { const raw = localStorage.getItem(CACHE + id); return raw == null ? null : L.normalize(JSON.parse(raw)); } catch { return null; } }
  function remember(id, set) { try { localStorage.setItem(CACHE + id, JSON.stringify(set)); } catch {} }

  // 'off' without the Premium connection or its cards; a fresh grant without this module is a lapse; no fresh
  // answer from the membership service yet (or a stale one) is 'unknown', never a lapse.
  function access() {
    if (!feat('app.premium') || !feat('app.premiumPromos')) return 'off';
    if (window.PremiumAccess?.can('overview_widgets')) return 'active';
    if (!window.PremiumAccess?.fresh()) return 'unknown';
    return 'lapsed';
  }

  function premiumTile(id) {
    const el = document.createElement('article');
    el.className = 'glass card ow-w ow-premium'; el.dataset.widget = id;
    return el;
  }
  function paintTile(el, w) {
    const render = tiles[w.id];
    if (typeof render === 'function') { try { render(el, w.locked); } catch (e) { console.warn('[overview]', e); } }
  }

  /* ---------- Premium tiles ---------- */
  // id → { at: last load attempt (Date.now()), busy, has, value, error }. Emptied for another player.
  let slots = {}, epoch = 0, timer = 0;
  const slot = (id) => (slots[id] ||= { at: -Infinity, busy: false, has: false, value: undefined, error: null });
  // Why an unlocked tile shows a note instead of data (and loads nothing), or null.
  function noteFor(def) {
    if (def.needs.some((key) => !feat(key)) || def.off?.()) return tr('Ayarlarda kapalı', 'Turned off in Settings');
    const note = def.note?.();
    if (note) return note;
    if (viewHidden(def.view)) return tr('Bu sayfa şu an senin için gizli', 'This page is hidden for you right now');
    return null;
  }
  // The tile body: [html, opens its page on a click].
  function tileBody(id, def, locked, size) {
    if (locked === 'premium') return [`<p class="ow-lock muted">${esc(LOCKS.premium())}</p><button type="button" class="btn sm ghost ow-t-cta" data-goto-view="premium">${esc(tr('Premium’a bak', 'See Premium'))}</button>`, false];
    if (locked) return [`<p class="ow-lock muted">${esc(LOCKS[locked]())}</p>`, false];
    const note = noteFor(def);
    if (note) return [`<p class="ow-t-note muted">${esc(note)}</p>`, false];
    const s = slot(id);
    if (def.load && !s.has && !s.error) return [`<p class="ow-t-note muted">${esc(tr('Yükleniyor…', 'Loading…'))}</p>`, true];
    let html = '', error = s.error;
    try { if (!def.load || s.has) html = def.html(s.value, size); } catch (e) { error = e?.message || String(e); }
    return [html + (error ? `<p class="ow-t-err" title="${esc(error)}">⚠ ${esc(error)}</p>` : ''), true];
  }
  // The title and body are made once and then only updated, so edit mode's controls (prepended) stay in place.
  function renderTile(id, el, locked) {
    const def = W.premium[id], [trTitle, enTitle] = W.titles[id];
    let head = el.querySelector(':scope > .card-head'), body = el.querySelector(':scope > .ow-t');
    if (!head || !body) {
      head?.remove(); body?.remove();
      head = Object.assign(document.createElement('div'), { className: 'card-head' });
      head.append(document.createElement('h3'));
      body = Object.assign(document.createElement('div'), { className: 'ow-t' });
      el.append(head, body);
    }
    const title = tr(trTitle, enTitle), h3 = head.firstElementChild;
    if (h3.textContent !== title) h3.textContent = title;
    const [html, opens] = tileBody(id, def, locked, el.dataset.size);
    if (body.lastHtml !== html) { body.lastHtml = html; body.innerHTML = html; }
    if (opens) {
      el.dataset.owView = def.view;
      body.setAttribute('role', 'link'); body.tabIndex = 0;
      body.setAttribute('aria-label', tr(`${title}: sayfayı aç`, `${title}: open the page`));
    } else if (el.dataset.owView) {
      delete el.dataset.owView;
      body.removeAttribute('role'); body.removeAttribute('tabindex'); body.removeAttribute('aria-label');
    }
  }
  for (const id of Object.keys(W.premium)) tiles[id] = (el, locked) => renderTile(id, el, locked);
  const repaint = (id) => { const w = shown?.widgets.find((x) => x.id === id), el = w && cell(id); if (el?.classList.contains('ow-premium')) paintTile(el, w); };
  const repaintAll = () => { for (const w of shown?.widgets || []) if (W.premium[w.id]) repaint(w.id); };

  // Loads the tiles that are due: only while the Overview is on screen, for an unlocked tile whose page is on, at most
  // once a minute each. The attempt time is kept whether the load succeeds or fails; a failure keeps the last data.
  function refresh() {
    if (state.view !== 'overview' || !trackerVisible() || !shown) return;
    for (const w of shown.widgets) {
      const def = W.premium[w.id];
      if (!def?.load || w.locked || noteFor(def)) continue;
      const s = slot(w.id), now = Date.now();
      if (s.busy || now - s.at < AGAIN) continue;
      s.at = now; s.busy = true;
      const mine = epoch;
      let task;
      try { task = Promise.resolve(def.load()); } catch (e) { task = Promise.reject(e); }
      task.then((value) => { if (mine === epoch) { s.value = value; s.has = true; s.error = null; } },
        (e) => { if (mine === epoch) s.error = e?.message || String(e); })
        .finally(() => { s.busy = false; if (mine === epoch) repaint(w.id); });
    }
  }
  // Every 15 s while the app runs; restarted when the Overview is shown, so a tile loads again a minute after it was shown.
  function cycle() { clearTimeout(timer); timer = setTimeout(() => { if (state.view === 'overview') { repaintAll(); refresh(); } cycle(); }, EVERY); }
  function forget() { epoch++; slots = {}; }

  // A click on a tile with data (not on edit controls, a button or a link) opens its page; so does Enter on its body.
  grid.addEventListener('click', (e) => {
    const el = e.target.closest?.('#ow-grid > .ow-premium[data-ow-view]');
    if (!el || e.target.closest('.ow-ctl, button, a, input, select, [data-goto-view], [data-open-url]')) return;
    showView(el.dataset.owView);
  });
  grid.addEventListener('keydown', (e) => {
    const body = e.target.closest?.('#ow-grid > .ow-premium[data-ow-view] > .ow-t');
    if (e.key !== 'Enter' || body !== e.target) return;
    e.preventDefault();
    showView(body.parentElement.dataset.owView);
  });
  // The daily order hint follows the company report app.js draws (it never fetches).
  const reportKpis = $('#report-kpis');
  if (reportKpis) new MutationObserver(() => repaint('orders')).observe(reportKpis, { childList: true });
  function showHint(on) {
    if (!on) { hint?.remove(); return; }
    hint ||= Object.assign(document.createElement('p'), { className: 'ow-empty' });
    hint.textContent = tr("Bu düzende widget yok. Eklemek için Düzenle'ye bas.", 'This layout has no widgets. Press Edit to add some.');
    grid.append(hint);
  }

  function apply() {
    const classic = !feat('app.overviewLayout');
    grid.classList.toggle('ow-classic', classic);
    const mini = $('#mini-row'), home = cell(classic ? 'bars' : 'chips');
    if (mini.parentElement !== home) home.append(mini);
    const v = L.view(current, access());
    // Premium tiles exist while their widget is in the layout (hidden by the classic switch, not removed).
    const inLayout = new Set(v.widgets.map((w) => w.id));
    for (const el of grid.querySelectorAll(':scope > .ow-premium')) if (!inLayout.has(el.dataset.widget)) el.remove();
    // What is on screen. With the switch off that is today's fixed screen, so no Premium widget counts as shown.
    shown = classic ? { index: v.index, name: v.name, widgets: CLASSIC.map((id) => ({ id, size: L.byId[id].size, locked: null })) } : v;
    const ids = new Set(shown.widgets.map((w) => w.id));
    showHint(!classic && !shown.widgets.length);
    shown.widgets.forEach((w, i) => {
      const el = cell(w.id) || premiumTile(w.id);
      // Only a card out of place is moved: moving a card restarts its entrance animation and drops focus inside it.
      if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
      el.classList.remove('ow-off');
      el.dataset.size = w.size;
      if (el.classList.contains('ow-premium')) paintTile(el, w);
    });
    for (const el of grid.querySelectorAll(':scope > .ow-w')) if (!ids.has(el.dataset.widget)) el.classList.add('ow-off');
    LRXProfileCard.paint(cell('profile'), LRXProfileCard.html(state.overview?.player));
    for (const fn of O.onApplied) { try { fn(); } catch (e) { console.warn('[overview]', e); } }
    refresh();
  }

  // The player's cached copy paints at once, so the free cards never wait for the server.
  function load(id) {
    if (id !== loadedFor) forget(); // another player: none of the loaded tile data is theirs
    stamp++; loadedFor = id; ownerId = null; unsaved = false;
    const own = id && cached(id);
    current = own || L.defaultSet(); fallback = !own;
    apply();
    return ask(id);
  }
  // Asks the local server for the player's set (never a Torn request). The reply is used only when it is for the
  // overview's own player; otherwise (the server has not switched players yet) the default set shows and nothing is
  // saved. A failed request keeps what is shown, and the player stays unconfirmed: the next overview render and the
  // next save ask again. A set the player changed meanwhile is kept, so an edit in progress is never replaced, unless
  // that edit began on the default set while the player has saved layouts: it never replaces them.
  function ask(id) {
    if (!id) { loading = null; return Promise.resolve(); }
    const mine = stamp;
    const task = api('/api/overview-layouts').then((r) => {
      if (mine !== stamp) return;
      if (r.playerId !== id || playerId() !== id) { if (!unsaved) { current = L.defaultSet(); fallback = true; apply(); } return; }
      ownerId = id;
      if (unsaved && fallback && r.layouts != null) {
        unsaved = false; // persist() sends nothing now
        toast(tr('Kayıtlı düzenin yüklendi; varsayılan ekranda yaptığın değişiklik kaydedilmedi.', 'Your saved layout was loaded; the change you made on the default screen was not saved.'));
      } else if (unsaved) { fallback = false; return; } // commit() saves that newer set
      fallback = false;
      current = L.normalize(r.layouts);
      remember(id, current);
      apply();
    }).catch(() => {}).finally(() => { if (loading === task) loading = null; });
    loading = task;
    return task;
  }

  // Shows `set` at once; with `save`, stores it for the confirmed player. Saves run one at a time, each sending the
  // whole current set (a request without one would store the default set over the player's layouts).
  function commit(set, { save = true } = {}) {
    current = L.normalize(set); unsaved = true;
    apply();
    if (!save) return Promise.resolve();
    const run = saving.then(persist);
    saving = run.catch(() => {});
    return run;
  }
  async function persist() {
    if (loading) await loading;
    if (ownerId == null && playerId() && loadedFor === playerId()) await ask(playerId()); // not confirmed yet: ask once more
    const id = ownerId;
    if (id == null || id !== playerId()) {
      // Never a quiet no-op: the player is told, and the next confirmed reply shows their saved layout again.
      if (playerId()) { unsaved = false; toast(tr('Düzen kaydedilemedi: bu oyuncunun kayıtlı düzenleri yüklenemedi.', 'Could not save the layout: the saved layouts for this player could not be loaded.')); }
      return;
    }
    if (!unsaved) return; // the change gave way to the player's saved layout (they were told) or to a reload
    try {
      const r = await api('/api/overview-layouts', { method: 'POST', body: JSON.stringify({ playerId: id, layouts: current }) });
      if (ownerId === id) remember(id, L.normalize(r.layouts));
    } catch (e) {
      if (e.status === 409) {
        toast(tr('Düzen başka bir oyuncuya ait; yeniden yüklendi.', 'The layout belonged to another player; reloaded.'));
        await load(playerId());
        return;
      }
      toast(tr('Düzen kaydedilemedi: ', 'Could not save the layout: ') + e.message);
    }
  }

  const O = window.LRXOverview = {
    current: () => current, access, shown: () => shown, owner: () => ownerId,
    commit, apply,
    tiles, // Premium widget id → (el, locked) => void, one for each widget in LRXOverviewWidgets.premium
    onApplied: [], // run after every apply(), e.g. to redraw edit controls
  };

  const previousRendered = window.onOverviewRendered;
  window.onOverviewRendered = () => {
    previousRendered?.();
    const id = playerId();
    if (id !== loadedFor) { load(id); return; }
    apply();
    if (id && ownerId == null && !loading) ask(id); // the last request failed or answered for another player
  };
  const previousLang = window.onLangChanged;
  window.onLangChanged = () => { previousLang?.(); apply(); };
  const previousShown = window.onViewShown;
  window.onViewShown = (v) => { previousShown?.(v); if (v === 'overview') { refresh(); cycle(); } };
  // Another Premium identity (sign-in, Log Out, a new key): forget the player; the next overview loads theirs.
  window.addEventListener('lrx-premium-reset', () => { forget(); stamp++; loading = null; loadedFor = null; ownerId = null; unsaved = false; fallback = true; current = L.defaultSet(); apply(); });
  window.addEventListener('lrx-feature-access-changed', apply);
  FEATURE_HOOKS.push(apply);
  apply();
  cycle();
})();
