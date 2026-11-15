/* LRX Profile working stats — profiles.php?XID=<id>
   • Adds one row above "Life" in the profile's information list: the player's working stats from the Hall of Fame
     (manual labor + intelligence + endurance) and, when their Job links to a company, that company's x/10 stars.
   • The page only gives the player and company IDs (scan); the tracker looks the numbers up with its own key and
     hands them back (update). The page never sees a key and sends nothing. Text only: no HTML from anywhere.
   Our own code; the idea comes from swervelord's "Torn Profile Company Star Rating + Working Stats" userscript
   (see userscripts/NOTICE.txt). */
(() => {
  if (window.__lrxProfile) return;
  const L = (t, e) => (window.__lrxLang === 'tr' ? t : e);
  const ROW = 'lrx-pw-row';
  let data = null; // { playerId, workingStats, rating }

  const xid = () => { const m = location.search.match(/[?&]XID=(\d{1,10})(?=&|$)/i); return m ? m[1] : null; };
  const table = () => document.querySelector('.profile-left-wrapper .info-table');
  const rowOf = (t, label) => (t ? [...t.children].find((li) => li.querySelector('.bold')?.textContent.trim() === label) : null);
  function companyId(t) {
    const link = rowOf(t, 'Job')?.querySelector('a[href*="corpinfo"]');
    const m = link && (link.getAttribute('href') || '').match(/[?&#/]ID=(\d{1,10})(?!\d)/i);
    return m ? m[1] : null;
  }

  // Waits for Torn to draw the information list; without one there is nothing to show, so nothing is looked up
  function scan() {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const t = table();
        if (t && rowOf(t, 'Life')) return resolve({ playerId: xid(), companyId: companyId(t) });
        if (Date.now() - started > 10_000) return resolve(t ? { playerId: xid(), companyId: companyId(t) } : { playerId: null, companyId: null });
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  function render() {
    if (!data || data.playerId !== xid()) return;
    const t = table();
    if (!t) return;
    const old = t.querySelector(':scope > .' + ROW);
    if (data.workingStats === null && data.rating === null) { old?.remove(); return; }
    const life = rowOf(t, 'Life');
    const key = `${data.workingStats}|${data.rating}|${window.__lrxLang}`;
    if (old && old.dataset.lrx === key && (life ? old.nextElementSibling === life : old === t.lastElementChild)) return;
    old?.remove();

    const li = document.createElement('li');
    li.className = ROW;
    li.dataset.lrx = key;
    li.title = L('Hall of Fame çalışma statları (manual labor + intelligence + endurance) ve şirketin yıldızı · LRX Torn Tracker',
      'Hall of Fame working stats (manual labor + intelligence + endurance) and the company star rating · LRX Torn Tracker');
    const section = document.createElement('div');
    section.className = 'user-information-section';
    const label = document.createElement('span');
    label.className = 'bold';
    label.textContent = L('Çalışma statları', 'Working Stats');
    section.appendChild(label);
    const value = document.createElement('div');
    value.className = 'user-info-value';
    if (data.workingStats !== null) {
      const stats = document.createElement('span');
      stats.textContent = Math.round(data.workingStats).toLocaleString('en-US');
      value.appendChild(stats);
    }
    if (data.rating !== null) {
      const stars = document.createElement('span');
      stars.className = 'lrx-pw-stars';
      stars.style.whiteSpace = 'nowrap';
      if (data.workingStats !== null) stars.style.marginLeft = '10px';
      stars.textContent = `${data.rating}/10 ★`;
      stars.title = L('Şirket yıldızı', 'Company star rating');
      value.appendChild(stars);
    }
    li.append(section, value);
    if (life) t.insertBefore(li, life); else t.appendChild(li);
  }

  function update(d) {
    const ws = d && d.workingStats !== null && d.workingStats !== undefined ? Number(d.workingStats) : NaN;
    const rating = d && d.rating !== null && d.rating !== undefined ? Number(d.rating) : NaN;
    data = {
      playerId: String(d?.playerId ?? ''),
      workingStats: Number.isFinite(ws) && ws >= 0 ? ws : null,
      rating: Number.isInteger(rating) && rating >= 0 && rating <= 10 ? rating : null,
    };
    render();
  }

  // Torn redraws the list now and then: put the row back from what was already looked up (no new lookup)
  let queued = false;
  new MutationObserver((muts) => {
    if (queued || !data) return;
    if (muts.every((m) => m.target.nodeType === 1 && m.target.closest('.' + ROW))) return;
    queued = true;
    setTimeout(() => { queued = false; render(); }, 150);
  }).observe(document.body, { childList: true, subtree: true });

  window.__lrxProfile = { scan, update };
})();
