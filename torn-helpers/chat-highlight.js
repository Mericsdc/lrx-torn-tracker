(() => {
  if (window.top !== window || location.origin !== 'https://www.torn.com' || window.__lrxChatHighlight || !document.body) return;
  const channels = '[id^="public_"], [id^="private-"], [id^="faction"], [id^="company"], [id="staff"]';
  const scroll = '[class*="scrollWrapper___"], [class*="_scrollWrapper_"]';
  const message = '[class*="message___"], [class*="_message_"]';
  const translated = window.__lrxLang === 'tr';
  const label = translated ? 'Sohbet vurgusu' : 'Chat highlights';
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;top:72px;right:12px;z-index:1000;padding:.35rem;background:Canvas;color:CanvasText;border:1px solid currentColor;border-radius:6px';
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.textContent = label; toggle.setAttribute('aria-expanded', 'false');
  const input = document.createElement('input');
  input.placeholder = translated ? 'Virgülle ayır' : 'Separate with commas';
  input.setAttribute('aria-label', label);
  input.type = 'text'; input.maxLength = 200; input.hidden = true;
  panel.append(toggle, input);
  document.body.append(panel);

  let frame = null, hostActive = false;
  const marked = new Map();
  const viewed = () => hostActive && document.visibilityState === 'visible' && document.hasFocus();
  const visible = (node) => {
    const r = node.getBoundingClientRect(), s = getComputedStyle(node);
    return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight &&
      s.visibility === 'visible' && !node.closest('[hidden], [aria-hidden="true"]');
  };
  function clear() {
    for (const [node, v] of marked) if (node.style.outline === v.applied) node.style.outline = v.previous;
    marked.clear();
  }
  function paint() {
    frame = null;
    if (!viewed() || input.hidden) { clear(); return; }
    const terms = input.value.toLowerCase().split(',').map((term) => term.trim()).filter(Boolean).slice(0, 12);
    const hits = new Set();
    if (terms.length) {
      for (const scroller of document.querySelectorAll(scroll)) {
        if (!scroller.closest(channels) || !visible(scroller)) continue;
        const bounds = scroller.getBoundingClientRect();
        for (const node of [...scroller.querySelectorAll(message)].slice(-160)) {
          if (!visible(node)) continue;
          const r = node.getBoundingClientRect();
          if (r.bottom <= bounds.top || r.top >= bounds.bottom || r.right <= bounds.left || r.left >= bounds.right) continue;
          const value = node.textContent.toLowerCase();
          if (terms.some((term) => value.includes(term))) hits.add(node);
        }
      }
    }
    for (const [node, v] of marked) {
      if (hits.has(node)) continue;
      if (node.style.outline === v.applied) node.style.outline = v.previous;
      marked.delete(node);
    }
    for (const node of hits) {
      if (marked.has(node)) continue;
      const previous = node.style.outline;
      node.style.outline = '2px solid gold';
      marked.set(node, { previous, applied: node.style.outline });
    }
  }
  function schedule() {
    if (frame === null && viewed() && !input.hidden) frame = requestAnimationFrame(paint);
  }
  const observer = new MutationObserver(schedule);
  const observe = () => observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  function pause() {
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null; clear();
  }
  function visibility() {
    if (!viewed() || input.hidden) { pause(); return; }
    observe(); schedule();
  }
  toggle.addEventListener('click', () => {
    input.hidden = !input.hidden;
    toggle.setAttribute('aria-expanded', String(!input.hidden));
    if (!input.hidden) input.focus();
    visibility();
  });
  input.addEventListener('input', schedule);
  window.addEventListener('focus', visibility);
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('scroll', schedule, true);
  window.__lrxChatHighlight = {
    setActive(active) {
      hostActive = active === true;
      visibility();
    },
    stop() {
      pause();
      panel.remove();
      window.removeEventListener('focus', visibility);
      window.removeEventListener('blur', pause);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('scroll', schedule, true);
      delete window.__lrxChatHighlight;
    },
  };
})();
