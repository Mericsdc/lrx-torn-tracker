/* =========================================================
   LRX sidebar motion: one highlight (.nav-indicator) under
   the active #nav item, which glides to the newly active
   item when the tab changes. It follows the DOM, not a list
   of views: a MutationObserver sees the active class move and
   items being added, removed, shown or hidden; a
   ResizeObserver sees layout changes (window width, language,
   the narrow horizontal sidebar). styles.css owns the timing;
   the reduced-motion rule and body.no-anim turn the glide off.
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXNavMotion = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  // An item's box inside the nav, or null when it is not laid out (hidden, display:none or detached).
  function boxOf(item) {
    if (!item || item.hidden || !item.offsetParent || !item.offsetWidth || !item.offsetHeight) return null;
    return { x: item.offsetLeft, y: item.offsetTop, w: item.offsetWidth, h: item.offsetHeight };
  }

  // hide: no laid-out active item. glide: the highlight is showing on another item (a tab switch).
  // jump: the first placement, or the same item moved (resize, an item above it shown or hidden).
  function moveFor(last, active, box) {
    if (!box) return 'hide';
    return last && last.shown && last.item && last.item !== active ? 'glide' : 'jump';
  }

  function styleFor(box) {
    return { transform: 'translate(' + box.x + 'px, ' + box.y + 'px)', width: box.w + 'px', height: box.h + 'px' };
  }

  const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

  function attach(nav) {
    if (!nav || typeof MutationObserver !== 'function') return null;
    const doc = nav.ownerDocument;
    const ind = nav.querySelector(':scope > .nav-indicator') || doc.createElement('span');
    ind.className = 'nav-indicator';
    ind.setAttribute('aria-hidden', 'true');
    if (ind.parentNode !== nav) nav.prepend(ind); // first child: the items paint above it
    let last = { shown: false, item: null, box: null };

    function sync() {
      const active = nav.querySelector('.nav-item.active');
      const box = boxOf(active);
      const move = moveFor(last, active, box);
      if (move === 'hide') {
        nav.classList.toggle('nav-glide', false);
        last = { shown: false, item: null, box: null };
        return;
      }
      if (move === 'jump' && last.item === active && same(last.box, box)) return; // nothing moved
      const s = styleFor(box);
      if (move === 'jump') ind.style.transition = 'none';
      ind.style.transform = s.transform;
      ind.style.width = s.width;
      ind.style.height = s.height;
      nav.classList.toggle('nav-glide', true);
      if (move === 'jump') { void ind.offsetWidth; ind.style.transition = ''; } // land without a transition
      last = { shown: true, item: active, box };
    }

    const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
    const watch = () => { if (sizes) nav.querySelectorAll('.nav-item').forEach((b) => sizes.observe(b)); };
    new MutationObserver((records) => {
      let mine = true;
      for (const r of records) {
        if (r.target === nav && r.type === 'attributes') continue; // our own nav-glide class
        mine = false;
        if (sizes) r.removedNodes.forEach((n) => { if (n.nodeType === 1) sizes.unobserve(n); });
      }
      if (mine) return;
      watch();
      sync();
    }).observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    if (sizes) sizes.observe(nav);
    watch();
    sync();
    return { indicator: ind, sync };
  }

  function attachDock(nav, toggle) {
    if (!nav || !toggle) return;
    const app = nav.closest('.app');
    const compact = window.matchMedia('(max-width: 900px)');
    const storageKey = 'tt.dock.collapsed';
    let collapsed = false;
    try { collapsed = localStorage.getItem(storageKey) === '1'; } catch {}
    function render() {
      app.classList.toggle('dock-collapsed', collapsed);
      if (collapsed && compact.matches && nav.contains(document.activeElement)) toggle.focus();
      nav.inert = collapsed && compact.matches;
      const label = collapsed ? tr('Menüyü genişlet', 'Expand navigation') : tr('Menüyü daralt', 'Collapse navigation');
      toggle.title = label;
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('aria-expanded', String(!collapsed));
    }
    toggle.addEventListener('click', () => {
      collapsed = !collapsed;
      try { localStorage.setItem(storageKey, collapsed ? '1' : '0'); } catch {}
      render();
    });
    compact.addEventListener('change', render);
    new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    render();
  }

  if (typeof document === 'object' && document) {
    const nav = document.getElementById('nav');
    attachDock(nav, document.getElementById('dock-toggle'));
    attach(nav);
  }
  return Object.freeze({ boxOf, moveFor, styleFor, attach });
});
