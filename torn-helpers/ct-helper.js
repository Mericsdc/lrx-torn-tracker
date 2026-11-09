/* LRX Christmas Town Yardımcısı — christmas_town.php
   • Haritadaki hediye, sandık (altın / gümüş / bronz / kombinasyon) ve anahtarları renkli halkayla işaretler
   • Görünen eşyaları sana uzaklığına göre listeler ("3 sağ, 2 yukarı")
   • Kombinasyon sandığı çözücü: denediğin rakamları ve renkleri sen girersin, olası şifre sayısını ve sıradaki tahmini önerir
   Yalnızca açık sayfayı okur ve boyar: Torn'a istek atmaz, karakteri yürütmez, tuşa / düğmeye basmaz,
   mini oyunlara müdahale etmez ve oyun öğelerini gizlemez. */
(() => {
  if (window.__lrxCT) return;
  window.__lrxCT = true;

  const KINDS = {
    gift: { label: 'Hediye', color: '#43a047' },
    gold: { label: 'Altın sandık', color: '#f9a825' },
    silver: { label: 'Gümüş sandık', color: '#b0bec5' },
    bronze: { label: 'Bronz sandık', color: '#a1662f' },
    combo: { label: 'Kombinasyon sandığı', color: '#8e24aa' },
    key: { label: 'Anahtar', color: '#1e88e5' },
    item: { label: 'Eşya', color: '#00acc1' },
  };
  const kindOf = (src) => {
    const s = (src || '').toLowerCase();
    if (s.includes('/combinationchest/')) return 'combo';
    if (s.includes('/chests/')) return /\/1\.gif/.test(s) ? 'gold' : /\/2\.gif/.test(s) ? 'silver' : /\/3\.gif/.test(s) ? 'bronze' : 'bronze';
    if (s.includes('/keys/')) return 'key';
    if (s.includes('/gifts/')) return 'gift';
    return 'item';
  };

  const style = document.createElement('style');
  style.id = 'lrx-ct-css';
  style.textContent = `
    .ct-item[data-lrx-ct] { border-radius: 50%; animation: lrxCtPulse 1.6s ease-in-out infinite; }
    ${Object.entries(KINDS).map(([k, v]) => `.ct-item[data-lrx-ct="${k}"] { box-shadow: 0 0 0 3px ${v.color}, 0 0 14px 4px ${v.color}; }`).join('\n')}
    @keyframes lrxCtPulse { 50% { filter: brightness(1.35); } }
    #lrx-ct { position: fixed; left: 12px; bottom: 12px; z-index: 99990; width: 240px; max-height: 60vh; overflow: auto; padding: 8px 10px;
      border-radius: 10px; background: rgba(20,22,26,.92); color: #e8e8e8; font: 12px/1.45 Arial, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.4); }
    #lrx-ct h4 { margin: 4px 0; font-size: 12px; color: #fff; display: flex; justify-content: space-between; cursor: pointer; user-select: none; }
    #lrx-ct .row { display: flex; gap: 6px; align-items: center; }
    #lrx-ct .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    #lrx-ct .muted { color: #9aa0a6; font-size: 11px; }
    #lrx-ct input { width: 100%; box-sizing: border-box; margin: 4px 0; padding: 3px 6px; border-radius: 6px; border: 1px solid #555; background: #111; color: #eee; letter-spacing: 6px; }
    #lrx-ct .fb { display: flex; gap: 4px; margin: 2px 0 6px; }
    #lrx-ct .fb button { flex: 1; padding: 3px 0; border: 0; border-radius: 6px; color: #fff; font-weight: 700; cursor: pointer; }
    #lrx-ct .fb button[data-c="g"] { background: #2e7d32; } #lrx-ct .fb button[data-c="y"] { background: #f9a825; } #lrx-ct .fb button[data-c="r"] { background: #c62828; }
    #lrx-ct .act { display: flex; gap: 6px; } #lrx-ct .act button { flex: 1; padding: 3px 0; border: 1px solid #555; border-radius: 6px; background: #222; color: #eee; cursor: pointer; }
    #lrx-ct .sug { font-size: 16px; font-weight: 700; color: #7fd18b; letter-spacing: 4px; }`;
  document.head.appendChild(style);

  /* ---------- Kombinasyon sandığı çözücü (3 farklı rakam, 1–9; her rakam için yeşil / sarı / kırmızı) ---------- */
  const ALL = [];
  for (let a = 1; a <= 9; a++) for (let b = 1; b <= 9; b++) for (let c = 1; c <= 9; c++) if (a !== b && b !== c && a !== c) ALL.push(`${a}${b}${c}`);
  const score = (guess, secret) => [...guess].map((d, i) => (secret[i] === d ? 'g' : secret.includes(d) ? 'y' : 'r')).join('');
  const solver = { guesses: [], draft: '', fb: ['r', 'r', 'r'] };
  const candidates = () => ALL.filter((s) => solver.guesses.every((g) => score(g.code, s) === g.fb));
  const suggest = (cands) => {
    if (cands.length <= 2) return cands[0] || null;
    let best = null, bestWorst = Infinity;
    for (const g of ALL) { // en kötü durumda en az olasılık bırakan tahmin; eşitlikte olası şifrelerden biri
      const parts = new Map();
      for (const s of cands) { const k = score(g, s); parts.set(k, (parts.get(k) || 0) + 1); }
      const worst = Math.max(...parts.values());
      if (worst < bestWorst || (worst === bestWorst && !cands.includes(best) && cands.includes(g))) { best = g; bestWorst = worst; }
    }
    return best;
  };

  let collapsed = { items: false, chest: true };
  const panel = () => {
    let p = document.getElementById('lrx-ct');
    if (!p) {
      p = document.createElement('div'); p.id = 'lrx-ct';
      p.addEventListener('click', (e) => {
        const h = e.target.closest('[data-toggle]');
        if (h) { collapsed[h.dataset.toggle] = !collapsed[h.dataset.toggle]; render(true); return; }
        const fb = e.target.closest('.fb button');
        if (fb) { const i = Number(fb.dataset.i); solver.fb[i] = { r: 'y', y: 'g', g: 'r' }[solver.fb[i]]; render(true); return; }
        const act = e.target.closest('[data-act]');
        if (!act) return;
        if (act.dataset.act === 'add' && /^\d{3}$/.test(solver.draft)) { solver.guesses.push({ code: solver.draft, fb: solver.fb.join('') }); solver.draft = ''; solver.fb = ['r', 'r', 'r']; }
        if (act.dataset.act === 'reset') { solver.guesses = []; solver.draft = ''; solver.fb = ['r', 'r', 'r']; }
        render(true);
      });
      // Sandık rakamları yalnızca bu kutudaki alana yazılır; oyunun klavye kontrolüne gitmesin
      p.addEventListener('keydown', (e) => e.stopPropagation(), true);
      p.addEventListener('input', (e) => {
        if (!e.target.matches('input')) return;
        solver.draft = e.target.value.replace(/[^1-9]/g, '').slice(0, 3);
        if (e.target.value !== solver.draft) e.target.value = solver.draft;
      });
      document.body.appendChild(p);
    }
    return p;
  };

  let lastItemsKey = '';
  let itemsHtml = '';
  let memo = { key: null, c: [], sug: null };
  const chestHtml = () => {
    if (collapsed.chest) return '';
    const mk = JSON.stringify(solver.guesses);
    if (memo.key !== mk) { const cs = candidates(); memo = { key: mk, c: cs, sug: suggest(cs) }; } // tahmin hesabı yalnızca giriş değişince
    const { c, sug } = memo;
    const fbNames = { g: 'yeşil', y: 'sarı', r: 'kırmızı' };
    return `<div class="muted">Sandıkta denediğin 3 rakamı yaz, her rakamın rengini oyundaki gibi seç (tıkla: kırmızı → sarı → yeşil), sonra ekle.</div>
      <input maxlength="3" inputmode="numeric" value="${solver.draft}" placeholder="örn. 123">
      <div class="fb">${solver.fb.map((f, i) => `<button data-i="${i}" data-c="${f}" title="${fbNames[f]}">${solver.draft[i] || '·'}</button>`).join('')}</div>
      <div class="act"><button data-act="add">Ekle</button><button data-act="reset">Sıfırla</button></div>
      ${solver.guesses.map((g) => `<div class="muted">${g.code} → ${[...g.fb].map((f) => ({ g: '🟩', y: '🟨', r: '🟥' }[f])).join('')}</div>`).join('')}
      <div style="margin-top:4px">Olası şifre: <b>${c.length}</b></div>
      ${c.length ? `<div>Sıradaki tahmin: <span class="sug">${sug}</span></div>` : '<div class="muted">Girilen renklerle uyuşan şifre yok; kontrol et.</div>'}`;
  };
  const render = (force) => {
    const p = panel();
    const html = `<h4 data-toggle="items"><span>🎄 LRX · yakındaki eşyalar</span><span>${collapsed.items ? '▸' : '▾'}</span></h4>${collapsed.items ? '' : itemsHtml}
      <h4 data-toggle="chest"><span>🔐 Kombinasyon sandığı</span><span>${collapsed.chest ? '▸' : '▾'}</span></h4>${chestHtml()}`;
    if (force || p.dataset.k !== html) {
      const focusInput = document.activeElement && p.contains(document.activeElement) && document.activeElement.matches('input');
      p.innerHTML = html; p.dataset.k = html;
      if (focusInput) { const i = p.querySelector('input'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }
    }
  };

  // Oyuncunun konumu: "x,y" yazısı
  const myPos = () => {
    const t = document.querySelector('[class^="position___"], [class*=" position___"]')?.textContent || '';
    const m = t.match(/(-?\d+)\s*,\s*(-?\d+)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  };
  const dirText = (dx, dy) => {
    if (!dx && !dy) return 'tam burada';
    const parts = [];
    if (dx) parts.push(`${Math.abs(dx)} ${dx > 0 ? 'sağ' : 'sol'}`);
    if (dy) parts.push(`${Math.abs(dy)} ${dy > 0 ? 'yukarı' : 'aşağı'}`);
    return parts.join(', ');
  };

  const scan = () => {
    if (document.hidden) return;
    const layer = document.querySelector('.items-layer');
    if (!layer && !document.getElementById('christmastownroot')) return;
    const me = myPos();
    const found = [];
    for (const it of document.querySelectorAll('.items-layer .ct-item')) {
      const kind = kindOf(it.querySelector('img')?.getAttribute('src'));
      if (it.getAttribute('data-lrx-ct') !== kind) it.setAttribute('data-lrx-ct', kind);
      const x = Math.round((parseFloat(it.style.left) || 0) / 30);
      const y = Math.round(-(parseFloat(it.style.top) || 0) / 30);
      found.push({ kind, x, y, d: me ? Math.abs(x - me.x) + Math.abs(y - me.y) : 0 });
    }
    found.sort((a, b) => a.d - b.d);
    const key = JSON.stringify([me, found]);
    if (key !== lastItemsKey) {
      lastItemsKey = key;
      itemsHtml = found.length
        ? found.slice(0, 10).map((f) => `<div class="row"><span class="dot" style="background:${KINDS[f.kind].color}"></span>${KINDS[f.kind].label}
            <span class="muted" style="margin-left:auto">${me ? dirText(f.x - me.x, f.y - me.y) : `${f.x}, ${f.y}`}</span></div>`).join('')
        : '<div class="muted">Görünür alanda eşya yok.</div>';
    }
    render(false);
  };
  setInterval(scan, 700);
  document.addEventListener('visibilitychange', scan);
  scan();
})();
