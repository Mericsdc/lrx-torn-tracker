/* LRX Savaş Yardımcısı — Torn faction savaş sayfası (factions.php … #/war/rank)
   • Rakip üyelerin yanında duruma göre renklenen Attack butonu (saldırı yeni LRX sekmesinde açılır)
   • İki tarafta da hastane geri sayımı (Status sütununda)
   Üye durumları Torn API'den LRX yerel sunucusu üzerinden gelir: ana süreç `__lrxWar.update()` ile verir.
   API verisi yoksa Torn'un kendi Status yazısına göre çalışır. Harici sunucu yoktur. */
(() => {
  if (window.__lrxWar) return;
  const L = (t, e) => (window.__lrxLang === 'tr' ? t : e);

  const ROW = 'li.enemy, li.your, li[class*="enemy___"], li[class*="your___"]';
  const ENEMY = 'li.enemy, li[class*="enemy___"]';
  const STATUS = '.status, [class*="status___"]';
  const ATTACK = '.attack, [class*="attack___"]';
  const SOON_MS = 60_000;

  const data = { st: {}, groups: {}, at: 0 }; // oyuncuId -> status / local group label; at: when the statuses arrived
  const STALE_MS = 60_000;

  const style = document.createElement('style');
  style.id = 'lrx-war-css';
  style.textContent = `
    [data-lrx-hosp] { font-size: 0 !important; }
    [data-lrx-hosp]::after { content: attr(data-lrx-hosp); font: 700 11px/1 ui-monospace, Consolas, monospace; color: #ff5d5d; letter-spacing: .3px; }
    [data-lrx-hosp][data-lrx-soon]::after { color: #ffb02e; }
    .lrx-atk-cell { font-size: 0 !important; display: flex !important; align-items: center; justify-content: center; }
    .lrx-atk-cell > :not(.lrx-atk) { display: none !important; }
    .lrx-atk-col { flex: 0 0 62px; width: 62px; display: flex; align-items: center; justify-content: center; }
    .lrx-atk { display: inline-block; min-width: 46px; padding: 3px 7px; border-radius: 4px; text-align: center; text-decoration: none !important;
      font: 700 11px/14px Arial, sans-serif; letter-spacing: .3px; color: #8a8f98 !important; background: #8a8f9822; border: 1px solid #8a8f9844; cursor: pointer; }
    .lrx-atk:hover { filter: brightness(1.2); }
    .lrx-atk[data-state="ok"] { color: #04110f !important; background: #2ee6c8; border-color: #2ee6c8; box-shadow: 0 0 6px #2ee6c855; }
    .lrx-atk[data-state="soon"] { color: #1a1200 !important; background: #ffb02e; border-color: #ffb02e; }
    .lrx-atk[data-state="ready"] { color: #04110f !important; background: #2ee6c8; border-color: #2ee6c8; animation: lrx-pulse 1s ease-in-out infinite; }
    @keyframes lrx-pulse { 50% { box-shadow: 0 0 10px #2ee6c8; } }`;
  document.head.appendChild(style);

  const pad = (n) => String(n).padStart(2, '0');
  const hms = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  };
  const idOf = (row) => {
    if (!row.__lrxId) row.__lrxId = Number(row.querySelector('a[href*="profiles.php?XID="]')?.href.match(/XID=(\d+)/)?.[1]) || 0;
    return row.__lrxId;
  };

  // Üyenin şu anki durumu: API verisi öncelikli, yoksa Torn'un yazısı
  const stateOf = (row, statusCell) => {
    // Statuses older than a minute are not shown as live: Torn's own status text decides until fresh ones arrive.
    const info = Date.now() - data.at <= STALE_MS ? data.st[idOf(row)] : null;
    const domText = (statusCell?.textContent || '').trim().toLowerCase();
    if (info) {
      const left = info.u ? info.u * 1000 - Date.now() : 0;
      if (info.s === 'Hospital' && left > 0) return { kind: left <= SOON_MS ? 'soon' : 'hosp', left };
      if (info.s === 'Hospital' || info.s === 'Okay') return { kind: info.s === 'Hospital' ? 'ready' : 'ok', left: 0 };
      return { kind: 'busy', left: 0, label: info.s };
    }
    if (domText.startsWith('okay')) return { kind: 'ok', left: 0 };
    return { kind: 'busy', left: 0 };
  };

  const ensureAttack = (row) => {
    let btn = row.querySelector('a.lrx-atk');
    if (btn) return btn;
    const id = idOf(row);
    if (!id) return null;
    btn = document.createElement('a');
    btn.className = 'lrx-atk';
    btn.href = `https://www.torn.com/loader.php?sid=attack&user2ID=${id}`;
    btn.target = '_blank';
    btn.rel = 'noopener';
    btn.textContent = 'Attack';
    btn.title = L('LRX · saldırıyı yeni sekmede aç', 'LRX · open the attack in a new tab');
    const cell = row.querySelector(ATTACK);
    if (cell) {
      cell.classList.add('lrx-atk-cell');
      cell.appendChild(btn);
    } else {
      const col = document.createElement('div');
      col.className = 'lrx-atk-col';
      col.appendChild(btn);
      row.appendChild(col); // Torn bu satırda Attack sütunu göstermiyorsa kendi sütunumuz
    }
    return btn;
  };

  const tick = () => {
    if (document.hidden) return;
    const rows = document.querySelectorAll(ROW);
    for (const row of rows) {
      const group = data.groups[idOf(row)];
      let badge = row.querySelector('.lrx-group-badge');
      if (group) {
        if (!badge) {
          badge = document.createElement('span'); badge.className = 'lrx-group-badge';
          badge.style.cssText = 'display:inline-block;margin:2px 5px;padding:2px 5px;border:1px solid #69c8ff77;border-radius:4px;font:11px Arial;color:#69c8ff;background:#102b40;max-width:140px;overflow:hidden;text-overflow:ellipsis;vertical-align:middle';
          row.querySelector('a[href*="profiles.php"]')?.parentElement?.appendChild(badge);
        }
        if (badge.textContent !== group) badge.textContent = group;
        badge.title = L('LRX hedef grubu: ', 'LRX target group: ') + group;
      } else badge?.remove();
      const statusCell = row.querySelector(STATUS);
      const st = stateOf(row, statusCell);
      if (statusCell) {
        if (st.kind === 'hosp' || st.kind === 'soon') {
          statusCell.setAttribute('data-lrx-hosp', hms(st.left));
          statusCell.toggleAttribute('data-lrx-soon', st.kind === 'soon');
        } else if (statusCell.hasAttribute('data-lrx-hosp')) {
          statusCell.removeAttribute('data-lrx-hosp');
          statusCell.removeAttribute('data-lrx-soon');
        }
      }
      if (!row.matches(ENEMY)) continue;
      const btn = ensureAttack(row);
      if (!btn) continue;
      const kind = st.kind === 'hosp' || st.kind === 'busy' ? 'off' : st.kind;
      if (btn.dataset.state !== kind) {
        btn.dataset.state = kind;
        btn.textContent = kind === 'ready' ? 'Attack!' : 'Attack';
      }
    }
  };

  window.__lrxWar = {
    // Ana süreç: sayfada savaş listesi var mı, hangi faction'lar görünüyor?
    scan() {
      const factionIds = [...document.querySelectorAll('a[href*="factions.php?step=profile"][href*="ID="]')]
        .map((a) => Number(a.href.match(/[?&]ID=(\d+)/)?.[1]))
        .filter(Boolean);
      return { active: !!document.querySelector(ROW), factionIds: [...new Set(factionIds)].slice(0, 6) };
    },
    // Ana süreç: { oyuncuId: { s, u, d } }
    update(statuses, groups) {
      if (statuses && typeof statuses === 'object') { data.st = statuses; data.at = Date.now(); }
      data.groups = groups || {};
      tick();
    },
  };

  setInterval(tick, 1000);
  tick();
})();
