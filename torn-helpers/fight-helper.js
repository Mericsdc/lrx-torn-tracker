/* Passive fight analysis: reads the viewed attack page and responses already requested
   by Torn. No requests, clicks, API keys, automation or background observation. */
(() => {
  if (window.__lrxFight) { window.__lrxFight.refresh(); return; }
  const L = (tr, en) => window.__lrxLang === 'tr' ? tr : en;
  const focused = () => !document.hidden && document.hasFocus();
  const isAttack = () => /\/(loader|page)\.php$/.test(location.pathname) && new URLSearchParams(location.search).get('sid') === 'attack';
  const panel = document.createElement('section');
  panel.id = 'lrx-live-fight';
  panel.style.cssText = 'position:relative;box-sizing:border-box;margin:8px 0;padding:10px 12px;border:1px solid #69c8ff77;border-radius:6px;background:#101b26;color:#e5f3ff;font:12px/1.5 Arial,sans-serif;clear:both;';
  const title = document.createElement('strong');
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.textContent = '−'; toggle.setAttribute('aria-expanded', 'true');
  toggle.style.cssText = 'float:right;background:transparent;color:#e5f3ff;border:1px solid #7893ab;border-radius:3px;cursor:pointer;width:24px';
  const body = document.createElement('div');
  const status = document.createElement('div');
  status.setAttribute('role', 'status'); status.style.color = '#a7c4da';
  const metrics = document.createElement('div');
  metrics.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;margin:8px 0;';
  const note = document.createElement('small');
  note.style.color = '#a7c4da';
  body.append(status, metrics, note); panel.append(toggle, title, body);
  toggle.onclick = () => { body.hidden = !body.hidden; toggle.textContent = body.hidden ? '+' : '−'; toggle.setAttribute('aria-expanded', String(!body.hidden)); };
  let targetId = '', last = null, lost = [0, 0], healed = [0, 0], samples = 0, paused = false, gap = false;
  let lastAt = 0, frame = null, source = null;
  const numbers = (s) => Number(String(s).replace(/[,\s]/g, ''));
  function life(current, max) {
    if (current == null || max == null || current === '' || max === '') return null;
    current = numbers(current); max = numbers(max);
    return Number.isFinite(current) && Number.isFinite(max) && max > 0 && current >= 0 && current <= max ? { current, max } : null;
  }
  function reset() {
    last = null; lost = [0, 0]; healed = [0, 0]; samples = 0; gap = false; lastAt = 0; source = null;
  }
  function mount() {
    if (!focused() || !isAttack()) return false;
    const root = document.querySelector('[class*="topSection___"], [class*="playerArea__"], #attacker');
    if (!root) return false;
    if (!panel.isConnected) root.insertAdjacentElement('beforebegin', panel);
    const id = new URLSearchParams(location.search).get('user2ID') || '';
    if (targetId !== id) { targetId = id; reset(); }
    return true;
  }
  function accept(pair, from) {
    if (!focused() || !isAttack() || !pair.every(Boolean) || !mount()) return;
    // Keep one source for a fight: a response can precede the DOM repaint.
    // Alternating sources would falsely count that repaint as recovery/damage.
    if (source && source !== from) return;
    source = from;
    if (paused) { last = null; paused = false; gap = true; }
    if (last) pair.forEach((v, i) => {
      const delta = v.current - last[i].current;
      if (delta < 0) lost[i] += -delta;
      else if (delta > 0) healed[i] += delta;
    });
    if (!last || pair.some((v, i) => v.current !== last[i].current || v.max !== last[i].max)) samples++;
    last = pair; lastAt = Date.now(); render();
  }
  function readDomLife(side, index) {
    const roots = [document.querySelector('#' + side), document.querySelectorAll('[class*="playersModelWrap___"] [class*="player___"]')[index],
      document.querySelector(`[class*="headerWrapper___"][class*="${index === 0 ? 'green' : 'rose'}___"]`) ].filter(Boolean);
    // Only health/life labels, never arbitrary numbers from weapons or stats.
    const nodes = roots.flatMap((root) => [...root.querySelectorAll('[class*="life" i], [class*="health" i], [aria-label*="life" i], [aria-label*="health" i]')]);
    for (const node of nodes) {
      if (!node.getClientRects().length || getComputedStyle(node).visibility === 'hidden') continue;
      const match = (node.getAttribute('aria-label') || node.textContent).match(/([\d,]+)\s*\/\s*([\d,]+)/);
      if (match) { const value = life(match[1], match[2]); if (value) return value; }
      if (node.hasAttribute('aria-valuenow')) {
        const value = life(node.getAttribute('aria-valuenow'), node.getAttribute('aria-valuemax'));
        if (value) return value;
      }
    }
    return null;
  }
  function render() {
    title.textContent = 'LRX · ' + L('Canlı savaş analizi', 'Live fight analysis');
    toggle.title = L('Analizi daralt / genişlet', 'Collapse / expand analysis');
    note.textContent = L('Gözlem süresindeki can değişimi; grup saldırıları ve etkiler de dahildir. Vuruş veya kazanma tahmini değildir.', 'Life changes during observation, including group attacks and effects. These are not hit counts or win predictions.');
    if (!last) {
      status.textContent = L('Can bilgisi bekleniyor. Sayfa desteklenmiyorsa değer gösterilmez.', 'Waiting for life data. Unsupported page layouts show no values.');
      metrics.replaceChildren(); return;
    }
    status.textContent = !focused() ? L('Duraklatıldı · savaş sekmesine dön', 'Paused · return to the fight tab')
      : last.some((v) => v.current === 0) ? L('Can sıfırlandı · sonucu Torn ekranından doğrula', 'Life reached zero · confirm the result on Torn')
      : L('Canlı', 'Live');
    if (gap) status.textContent += L(' · kısmi gözlem', ' · partial observation');
    status.textContent += ' · ' + new Date(lastAt).toLocaleTimeString('en-GB');
    metrics.replaceChildren(...last.map((v, i) => {
      const card = document.createElement('div');
      card.style.cssText = 'flex:1;min-width:170px;padding:8px;background:#0a141e;border-radius:4px;';
      const label = document.createElement('strong');
      label.textContent = i === 0 ? L('Sen', 'You') : L('Rakip', 'Opponent');
      const value = document.createElement('div');
      value.textContent = `${v.current.toLocaleString('en-US')} / ${v.max.toLocaleString('en-US')} (${Math.round(v.current / v.max * 100)}%)`;
      value.style.color = v.current / v.max <= .25 ? '#ff8799' : '#8be2b9';
      const summary = document.createElement('div');
      summary.textContent = `${L('Gözlenen kayıp', 'Observed loss')}: ${lost[i].toLocaleString('en-US')} · ${L('İyileşme', 'Recovery')}: ${healed[i].toLocaleString('en-US')}`;
      card.append(label, value, summary); return card;
    }));
  }
  function refresh() {
    if (!focused()) { paused = true; return; }
    if (!isAttack()) { panel.remove(); reset(); return; }
    if (!mount()) return;
    const pair = [readDomLife('attacker', 0), readDomLife('defender', 1)];
    if (pair.every(Boolean)) accept(pair, 'dom'); else render();
  }
  function receive(url, json) {
    if (!focused() || !isAttack()) return;
    try {
      const u = new URL(url, location.href);
      if (u.origin !== location.origin || u.searchParams.get('sid') !== 'attackData') return;
      const db = json?.DB;
      if (!db) return;
      const id = new URLSearchParams(location.search).get('user2ID');
      if (db.defenderUser?.userID != null && String(db.defenderUser.userID) !== id) return;
      const values = db.usersLife;
      if (values) accept([life(values.attacker?.currentLife, values.attacker?.maxLife), life(values.defender?.currentLife, values.defender?.maxLife)], 'network');
    } catch {}
  }
  const originalFetch = window.fetch;
  async function observedFetch(...args) {
    const response = await originalFetch.apply(this, args);
    const url = response.url || (typeof args[0] === 'string' ? args[0] : args[0]?.url);
    if (focused() && isAttack() && /[?&]sid=attackData(?:&|$)/.test(url || '')) {
      response.clone().json().then((json) => receive(url, json)).catch(() => {});
    }
    return response;
  }
  window.fetch = observedFetch;
  const originalSend = XMLHttpRequest.prototype.send;
  function observedSend(...args) {
    this.addEventListener('load', () => {
      if (!focused() || !isAttack() || !/[?&]sid=attackData(?:&|$)/.test(this.responseURL || '')) return;
      try { receive(this.responseURL, this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch {}
    }, { once: true });
    return originalSend.apply(this, args);
  }
  XMLHttpRequest.prototype.send = observedSend;
  const observer = new MutationObserver((records) => {
    if (!focused() || frame || records.every((r) => panel.contains(r.target) || [...r.addedNodes, ...r.removedNodes].every((n) => n === panel) && r.type === 'childList')) return;
    frame = setTimeout(() => { frame = null; refresh(); }, 150);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-valuenow'] });
  const pause = () => { if (!focused()) { paused = true; render(); } else refresh(); };
  window.addEventListener('blur', pause); window.addEventListener('focus', pause);
  document.addEventListener('visibilitychange', pause);
  window.addEventListener('popstate', refresh); window.addEventListener('hashchange', refresh);
  window.__lrxFight = { refresh };
  refresh();
})();
