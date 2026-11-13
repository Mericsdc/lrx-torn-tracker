/* Overview widget host. The Overview cards are widgets in one ordered CSS grid (#ow-grid). The rules (default
   layout, repair, access) live in overview-layout.js; each Torn player's saved set lives in the app config behind
   /api/overview-layouts. The cards keep the fixed IDs app.js renders into, whether or not their widget is shown:
   a widget outside the layout only gets the class `ow-off`. `hidden` on #ov-company belongs to company mode. */
(() => {
  const L = window.LRXOverviewLayout;
  const grid = $('#ow-grid');
  const CACHE = 'tt.cache.overviewLayouts.'; // + Torn player ID: the last set the server confirmed for that player
  const CLASSIC = ['drug', 'edu', 'day', 'bars', 'battle', 'company']; // the fixed screen shown with the switch off
  // Premium tile titles until LRXOverviewWidgets (overview-widgets.js) provides them.
  const TITLES = {
    gym: ['Gym kazancı', 'Gym gains'], networth: ['Networth', 'Networth'], travel: ['Seyahat kârı', 'Travel profit'],
    job: ['İş asistanı', 'Job assistant'], crimes: ['Suç merkezi', 'Crime hub'], jail: ['Jail bustları', 'Jail busts'],
    awards: ['Merit takibi', 'Merit tracker'], oc: ['Faction OC', 'Faction OC'], war: ['Savaş', 'War'],
    events: ['Etkinlik takvimi', 'Event calendar'], orders: ['Günlük sipariş önerisi', 'Daily order hint'],
  };
  const LOCKS = {
    premium: () => tr('Premium ile açılır', 'Unlocks with Premium'),
    checking: () => tr('Üyelik kontrol ediliyor…', 'Checking membership…'),
    unavailable: () => tr('Kullanılamıyor', 'Not available'),
  };
  I18N['ov.status'] = ['Durum', 'Status'];

  let current = L.defaultSet(), shown = null, ownerId = null;
  // unsaved: the player changed the set since it was loaded and that change is still to be saved (or is being edited)
  let loadedFor = null, loading = null, stamp = 0, unsaved = false, saving = Promise.resolve(), hint = null;

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
    const render = O.tiles[w.id];
    if (typeof render === 'function') { try { render(el, w.locked); } catch (e) { console.warn('[overview]', e); } return; }
    const [trTitle, enTitle] = window.LRXOverviewWidgets?.titles?.[w.id] || TITLES[w.id];
    const html = `<div class="card-head"><h3>${esc(tr(trTitle, enTitle))}</h3></div>${w.locked ? `<p class="ow-lock muted">${esc(LOCKS[w.locked]())}</p>` : ''}`;
    if (el.lastHtml !== html) { el.lastHtml = html; el.innerHTML = html; }
  }
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
  }

  // The player's cached copy paints at once, so the free cards never wait for the server.
  function load(id) {
    stamp++; loadedFor = id; ownerId = null; unsaved = false;
    current = (id && cached(id)) || L.defaultSet();
    apply();
    return ask(id);
  }
  // Asks the local server for the player's set (never a Torn request). The reply is used only when it is for the
  // overview's own player; otherwise (the server has not switched players yet) the default set shows and nothing is
  // saved. A failed request keeps what is shown, and the player stays unconfirmed: the next overview render and the
  // next save ask again. A set the player changed meanwhile is kept, so an edit in progress is never replaced.
  function ask(id) {
    if (!id) { loading = null; return Promise.resolve(); }
    const mine = stamp;
    const task = api('/api/overview-layouts').then((r) => {
      if (mine !== stamp) return;
      if (r.playerId !== id || playerId() !== id) { if (!unsaved) { current = L.defaultSet(); apply(); } return; }
      ownerId = id;
      if (unsaved) return; // commit() saves that newer set
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
    tiles: {}, // premium widget id → (el, locked) => void, filled by the widget definitions
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
  // Another Premium identity (sign-in, Log Out, a new key): forget the player; the next overview loads theirs.
  window.addEventListener('lrx-premium-reset', () => { stamp++; loading = null; loadedFor = null; ownerId = null; unsaved = false; current = L.defaultSet(); apply(); });
  window.addEventListener('lrx-feature-access-changed', apply);
  FEATURE_HOOKS.push(apply);
  apply();
})();
