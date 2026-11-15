/* LRX Bazaar undercut — bazaar.php#/manage (Bazaar → Manage items) and bazaar.php#/add (Bazaar → Add items)
   • A small "−$1" button next to each item's name. When the player clicks it, the helper reads that one item's public
     bazaar listings from weav3r.dev (a third-party site, not Torn) and writes $1 under the cheapest other seller into
     that row's price box. That is all: the player checks the price, enters the amount on Add items, and confirms on
     Torn (Update / Add) themselves.
   • On Manage the price box only exists once the row is open. A closed row is never opened for the player; the button
     asks them to open it with Torn's Manage button first. Rows Torn greys out on Add items get no button.
     Synthetic clicks (from other scripts) are ignored.
   • The item id comes from the item picture. No Torn request, no API key. weav3r.dev is reached through the
     tracker's userscript bridge (userscript-extension/), which only allows GET /api/marketplace/<id> for this helper.
   Our own code; the idea comes from swervelord's "Auto Bazaar Pricing" userscript (see userscripts/NOTICE.txt). */
(() => {
  if (window.__lrxBazaarUndercut) return;
  window.__lrxBazaarUndercut = true;
  const L = (t, e) => (window.__lrxLang === 'tr' ? t : e);
  const ROW = '[data-testid="sortable-item"], [class*="row___"]';
  const DESC = '[class*="item___"] [class*="desc___"]';
  const ADD_ROW = 'ul.items-cont li.clearfix'; // Add items keeps Torn's older list
  const ADD_NAME = '.title-wrap .name-wrap';
  const CACHE_MS = 60_000; // weav3r refreshes its own cache every 30-180 s
  const STALE_S = 3600; // a listing weav3r has not re-checked for an hour may be sold already
  const cache = new Map(); // item id -> { at, listings }
  const waiting = new Map();
  let seq = 0;

  const style = document.createElement('style');
  style.id = 'lrx-bazaar-undercut-css';
  style.textContent = `
    .lrx-bu { display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; vertical-align: middle; font-size: 11px; line-height: 16px; max-width: 100%; }
    .lrx-bu-btn { cursor: pointer; padding: 0 6px; border-radius: 4px; border: 1px solid rgba(127,127,127,.55); background: rgba(127,127,127,.14);
      color: inherit; font: inherit; font-weight: 700; line-height: 16px; }
    .lrx-bu-btn:hover { background: rgba(127,127,127,.26); }
    .lrx-bu-btn:disabled { cursor: wait; opacity: .55; }
    .lrx-bu-note { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 340px; }
    .lrx-bu-note.ok { color: #3fa52a; } .lrx-bu-note.warn { color: #d39a1f; } .lrx-bu-note.bad { color: #e04848; }
    /* Add items: the name column is narrow, so keep name, button and note on one line; the note gives way first */
    ul.items-cont .name-wrap.lrx-bu-host { display: flex; align-items: center; flex-wrap: nowrap; gap: 4px; min-width: 0; }
    ul.items-cont .name-wrap.lrx-bu-host > * { flex: 0 0 auto; }
    ul.items-cont .name-wrap.lrx-bu-host > .t-overflow { max-width: calc(100% - 60px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    ul.items-cont .name-wrap.lrx-bu-host > .lrx-bu { display: contents; }
    ul.items-cont .name-wrap.lrx-bu-host .lrx-bu-btn { flex: none; margin-left: 4px; }
    ul.items-cont .name-wrap.lrx-bu-host .lrx-bu-note { flex: 0 1 auto; min-width: 12px; margin-left: 2px; }`;
  (document.head || document.documentElement).appendChild(style);

  // 'manage' or 'add'; any other bazaar page gets no buttons
  const pageKind = () => {
    if (!location.pathname.startsWith('/bazaar.php')) return null;
    const hash = location.hash.toLowerCase();
    return hash.startsWith('#/manage') ? 'manage' : hash.startsWith('#/add') ? 'add' : null;
  };
  const money = (v) => '$' + Math.round(Number(v)).toLocaleString('en-US');

  // Item ids in these pictures. Torn writes picture paths absolute, root-relative or relative, so the browser's
  // resolved address is read (plus srcset / lazy data-src). One id per item picture.
  function idsIn(imgs) {
    const ids = [];
    for (const img of imgs) {
      const text = [img.currentSrc, img.src, img.getAttribute('srcset'), img.getAttribute('data-src')].filter(Boolean).join(' ');
      const m = text.match(/\/items\/(\d+)\//);
      if (m) ids.push(m[1]);
    }
    return ids;
  }
  // An Add items row may show its one item twice; pictures of different items mean no answer
  const oneId = (ids) => (ids.length && ids.every((id) => id === ids[0]) ? ids[0] : null);
  // The item's row: the Add items row, or the nearest Manage row around the name that holds exactly one item picture
  // (an outer Manage row around several rows of the same item must not be taken for one of them)
  function rowOf(el) {
    const li = el.closest(ADD_ROW);
    if (li) return li;
    for (let r = el.closest(ROW); r; r = r.parentElement && r.parentElement.closest(ROW)) {
      if (idsIn(r.querySelectorAll('img')).length === 1) return r;
    }
    return null;
  }
  // The row's own picture first (Add items: div.image-wrap, Manage: imgContainer___), then any picture in the row
  function itemId(row) {
    if (!row) return null;
    const own = idsIn(row.querySelectorAll(row.matches(ADD_ROW) ? '.image-wrap img' : '[class*="imgContainer___"] img'));
    return oneId(own.length ? own : idsIn(row.querySelectorAll('img')));
  }
  // The visible price box of the row (Manage: price___, phone layout: priceMobile___; Add items: div.price)
  function priceInput(row) {
    if (!row) return null;
    for (const box of row.querySelectorAll('[class*="price___"], [class*="priceMobile___"], div.price')) {
      const input = box.querySelector('input.input-money:not([type="hidden"])') || box.querySelector('input:not([type="hidden"])');
      if (input && !input.disabled && !input.readOnly && input.getClientRects().length) return input;
    }
    return null;
  }

  window.addEventListener('message', (event) => {
    const m = event.data;
    if (event.source !== window || event.origin !== location.origin || m?.channel !== 'lrx-userscript-response' || m.script !== 'lrx-bazaar-price') return;
    const done = waiting.get(m.id);
    if (done) { waiting.delete(m.id); done(m); }
  });
  function listings(id) {
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.listings);
    return new Promise((resolve, reject) => {
      const rid = 'lrx-bu-' + (++seq);
      const timer = setTimeout(() => { waiting.delete(rid); reject(new Error(L('zaman aşımı', 'timed out'))); }, 20_000);
      waiting.set(rid, (m) => {
        clearTimeout(timer);
        const r = m.response;
        if (m.error || !r) return reject(new Error(m.error || L('yanıt yok', 'no answer')));
        if (r.status !== 200) return reject(new Error('HTTP ' + r.status));
        let data = null;
        try { data = JSON.parse(r.responseText); } catch {}
        if (!data || !Array.isArray(data.listings)) return reject(new Error(L('beklenmeyen yanıt', 'unexpected answer')));
        cache.set(id, { at: Date.now(), listings: data.listings });
        resolve(data.listings);
      });
      window.postMessage({ channel: 'lrx-userscript-request', action: 'request', script: 'lrx-bazaar-price', id: rid, method: 'GET',
        url: 'https://weav3r.dev/api/marketplace/' + id, timeout: 15_000 }, location.origin);
    });
  }
  // Cheapest listing by another player; recently checked listings first
  function cheapest(list) {
    const me = String(window.__lrxMe || '');
    const now = Date.now() / 1000;
    const others = list.filter((l) => l && Number(l.price) > 0 && Number.isFinite(Number(l.price)) && (!me || String(l.player_id) !== me));
    const fresh = others.filter((l) => !(Number(l.last_checked) > 0) || now - Number(l.last_checked) < STALE_S);
    return (fresh.length ? fresh : others).reduce((best, l) => (!best || Number(l.price) < Number(best.price) ? l : best), null);
  }
  function setPrice(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, String(value)); else input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('keyup', { bubbles: true })); // Add items' older price box listens for keyup
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function run(desc, btn, note, kind) {
    const show = (text, cls) => { note.textContent = text; note.className = 'lrx-bu-note' + (cls ? ' ' + cls : ''); note.title = text; };
    const row = rowOf(desc);
    const id = itemId(row);
    if (!id) return show(L('Eşya bulunamadı', 'Item not found'), 'bad');
    if (!priceInput(row)) {
      return kind === 'manage' ? show(L("Önce Torn'un Manage düğmesiyle satırı aç", "Open the row with Torn's Manage button first"), 'warn')
        : show(L('Bu eşyanın fiyat kutusu yok', 'This item has no price box'), 'warn');
    }
    btn.disabled = true;
    show(L('weav3r.dev okunuyor…', 'Reading weav3r.dev…'));
    try {
      const best = cheapest(await listings(id));
      if (!best) return show(L('Başka bazaar ilanı yok', 'No other bazaar listings'), 'warn');
      const input = priceInput(row);
      // The list re-renders while it scrolls: write only into the same, still open row of the same item
      if (pageKind() !== kind || !row.isConnected || itemId(row) !== id || !input) return show(L('Satır değişti ya da kapandı; yeniden dene', 'The row changed or closed; try again'), 'warn');
      const price = Math.max(1, Math.floor(Number(best.price)) - 1);
      setPrice(input, price);
      const seller = String(best.player_name || '').slice(0, 24);
      const next = kind === 'manage' ? L("Update'e sen bas", 'press Update yourself') : L('miktarı gir ve onayı sen ver', 'enter the amount and confirm yourself');
      show(L(`${money(price)} yazıldı · en ucuz ${money(best.price)}${seller ? ' (' + seller + ')' : ''} · ${next}`,
        `Set ${money(price)} · cheapest ${money(best.price)}${seller ? ' (' + seller + ')' : ''} · ${next}`), 'ok');
    } catch (e) {
      show(L('weav3r.dev okunamadı: ', 'Could not read weav3r.dev: ') + (e?.message || e), 'bad');
    } finally { btn.disabled = false; }
  }

  function decorate(desc, kind) {
    if (desc.querySelector('.lrx-bu')) return;
    const wrap = document.createElement('span');
    wrap.className = 'lrx-bu';
    wrap.dataset.kind = kind;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lrx-bu-btn';
    btn.textContent = '−$1';
    btn.title = L("weav3r.dev'deki en ucuz diğer bazaar fiyatının $1 altını bu eşyanın fiyat kutusuna yazar. Torn'daki onayı sen verirsin.",
      "Writes $1 under the cheapest other bazaar on weav3r.dev into this item's price box. You confirm on Torn yourself.");
    const note = document.createElement('span');
    note.className = 'lrx-bu-note';
    // Keep the press on the button: Torn's row drag and row toggle must not see it
    for (const type of ['pointerdown', 'mousedown', 'touchstart', 'keydown']) btn.addEventListener(type, (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!e.isTrusted || btn.disabled || document.hidden || pageKind() !== kind) return; // only the player's own click
      run(desc, btn, note, kind);
    });
    wrap.append(btn, note);
    if (kind === 'add') desc.classList.add('lrx-bu-host');
    desc.appendChild(wrap);
  }

  let queued = false;
  function scan() {
    queued = false;
    const kind = pageKind();
    for (const n of document.querySelectorAll('.lrx-bu')) {
      if (n.dataset.kind !== kind) { n.parentElement?.classList.remove('lrx-bu-host'); n.remove(); }
    }
    if (!kind || document.hidden) return;
    if (kind === 'manage') for (const row of document.querySelectorAll(ROW)) for (const desc of row.querySelectorAll(DESC)) decorate(desc, kind);
    else for (const li of document.querySelectorAll(ADD_ROW)) {
      const name = !li.classList.contains('disabled') && li.querySelector(ADD_NAME);
      if (name) decorate(name, kind);
    }
  }
  const queue = () => { if (!queued) { queued = true; setTimeout(scan, 100); } };
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.target.nodeType === 1 && m.target.closest('.lrx-bu')) continue;
      if (m.addedNodes.length) return queue();
    }
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', queue);
  document.addEventListener('visibilitychange', queue);
  queue();
})();
