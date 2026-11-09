/* LRX Poker Oranları — Texas Hold'em (page.php?sid=holdem)
   • Masadaki kendi kartlarını ve ortadaki kartları okur; elinin adını ve oyundaki rakip sayısına göre
     kazanma / beraberlik yüzdesini gösterir (Monte Carlo, rakip elleri rastgele varsayılır)
   Yalnızca açık sayfayı okur ve küçük bir kutu çizer: Torn'a istek atmaz, hiçbir düğmeye basmaz,
   fold / call / raise tavsiyesi vermez. Karar her zaman oyuncunundur. */
(() => {
  if (window.__lrxPoker) return;
  window.__lrxPoker = true;

  const RANKS = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, T: 10, J: 11, Q: 12, K: 13, A: 14 };
  const SUITS = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };
  const SUIT_SYM = ['♣', '♦', '♥', '♠'];
  const RANK_SYM = { 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const NAMES = [
    ['Yüksek kart', 'High card'], ['Bir çift', 'One pair'], ['İki çift', 'Two pair'], ['Üçlü', 'Three of a kind'],
    ['Kent', 'Straight'], ['Floş', 'Flush'], ['Full house', 'Full house'], ['Dörtlü', 'Four of a kind'], ['Floş kent', 'Straight flush'],
  ];

  // Kart = rank*4 + suit
  const readCard = (el) => {
    const cls = typeof el.className === 'string' ? el.className : '';
    const m = cls.match(/(clubs|spades|hearts|diamonds)-([0-9]+|[TJQKA])/i);
    if (!m) return null;
    const r = RANKS[m[2].toUpperCase()]; const s = SUITS[m[1].toLowerCase()];
    return r ? r * 4 + s : null;
  };
  const cardsIn = (root) => {
    if (!root) return [];
    const out = [];
    for (const el of root.querySelectorAll('[class*="front"] > div, [class*="front"] [role="img"]')) {
      const c = readCard(el);
      if (c != null && !out.includes(c)) out.push(c);
    }
    return out;
  };

  // 5–7 kartlık elin gücü (büyük sayı = daha iyi)
  const evaluate = (cards) => {
    const cnt = new Array(15).fill(0); const suitCnt = [0, 0, 0, 0]; const bySuit = [[], [], [], []];
    for (const c of cards) { const r = c >> 2, s = c & 3; cnt[r]++; suitCnt[s]++; bySuit[s].push(r); }
    const straightHigh = (mask) => {
      for (let h = 14; h >= 5; h--) {
        let ok = true;
        for (let k = 0; k < 5; k++) { const r = h - k === 1 ? 14 : h - k; if (!(mask & (1 << r))) { ok = false; break; } }
        if (ok) return h;
      }
      return 0;
    };
    const enc = (cat, ks) => { let v = cat; for (let i = 0; i < 5; i++) v = v * 15 + (ks[i] || 0); return v; };
    const fs = suitCnt.findIndex((n) => n >= 5);
    if (fs >= 0) {
      let m = 0; for (const r of bySuit[fs]) m |= 1 << r;
      const sh = straightHigh(m);
      if (sh) return enc(8, [sh]);
    }
    const quads = [], trips = [], pairs = [], singles = [];
    for (let r = 14; r >= 2; r--) {
      if (cnt[r] === 4) quads.push(r); else if (cnt[r] === 3) trips.push(r); else if (cnt[r] === 2) pairs.push(r); else if (cnt[r] === 1) singles.push(r);
    }
    if (quads.length) { const k = [...trips, ...pairs, ...singles].sort((a, b) => b - a)[0]; return enc(7, [quads[0], k]); }
    if (trips.length && (trips.length > 1 || pairs.length)) return enc(6, [trips[0], Math.max(trips[1] || 0, pairs[0] || 0)]);
    if (fs >= 0) return enc(5, bySuit[fs].sort((a, b) => b - a).slice(0, 5));
    let mask = 0; for (let r = 2; r <= 14; r++) if (cnt[r]) mask |= 1 << r;
    const sh = straightHigh(mask);
    if (sh) return enc(4, [sh]);
    if (trips.length) return enc(3, [trips[0], ...singles.slice(0, 2)]);
    if (pairs.length >= 2) { const k = [...pairs.slice(2), ...singles].sort((a, b) => b - a)[0]; return enc(2, [pairs[0], pairs[1], k]); }
    if (pairs.length) return enc(1, [pairs[0], ...singles.slice(0, 3)]);
    return enc(0, singles.slice(0, 5));
  };
  const category = (v) => Math.floor(v / 15 ** 5);

  const simulate = (hole, board, opponents, iters = 3000) => {
    const used = new Set([...hole, ...board]);
    const deck = []; for (let c = 8; c < 60; c++) if (!used.has(c)) deck.push(c);
    let win = 0, tie = 0;
    const need = 5 - board.length;
    for (let it = 0; it < iters; it++) {
      // Fisher–Yates ile yalnızca gereken kadar kart çek
      const take = need + opponents * 2;
      for (let i = 0; i < take; i++) { const j = i + Math.floor(Math.random() * (deck.length - i)); const t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
      const full = board.concat(deck.slice(0, need));
      const mine = evaluate(hole.concat(full));
      let best = 0, ties = 0;
      for (let o = 0; o < opponents; o++) {
        const v = evaluate([deck[need + o * 2], deck[need + o * 2 + 1], ...full]);
        if (v > best) { best = v; ties = 0; }
        if (v === best) ties++;
      }
      if (mine > best) win++;
      else if (mine === best) tie += 1 / (ties + 1);
    }
    return { win: win / iters, tie: tie / iters };
  };

  const style = document.createElement('style');
  style.id = 'lrx-poker-css';
  style.textContent = `
    #lrx-poker { position: fixed; right: 12px; bottom: 12px; z-index: 99990; min-width: 190px; padding: 8px 12px; border-radius: 10px;
      background: rgba(20,22,26,.92); color: #e8e8e8; font: 12px/1.45 Arial, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.4); }
    #lrx-poker b { color: #fff; }
    #lrx-poker .big { font-size: 18px; font-weight: 700; color: #7fd18b; }
    #lrx-poker .muted { color: #9aa0a6; font-size: 11px; }
    #lrx-poker .red { color: #ff8a80; }`;
  document.head.appendChild(style);

  const show = (html) => {
    let box = document.getElementById('lrx-poker');
    if (!html) { box?.remove(); return; }
    if (!box) { box = document.createElement('div'); box.id = 'lrx-poker'; document.body.appendChild(box); }
    if (box.innerHTML !== html) box.innerHTML = html;
  };
  const cardStr = (c) => { const r = c >> 2; return `${RANK_SYM[r] || r}<span class="${(c & 3) === 1 || (c & 3) === 2 ? 'red' : ''}">${SUIT_SYM[c & 3]}</span>`; };

  // Oyunda kalan rakipler: fold / oturmuyor / bekliyor olmayan koltuklar
  const activeOpponents = () => {
    const seats = document.querySelectorAll('[class*="opponent___"]');
    let n = 0;
    for (const s of seats) {
      const st = (s.querySelector('[class*="status"], [class*="state___"]')?.textContent || '').toLowerCase();
      if (/\b(fold|folded|sitting out|sit out|waiting)\b/.test(st)) continue;
      if (!s.querySelector('[class*="name"]') && !s.textContent.trim()) continue;
      n++;
    }
    return Math.max(1, Math.min(8, n));
  };

  let lastKey = '';
  const tick = () => {
    if (document.hidden) return;
    const me = document.querySelector('[class*="playerMeGateway"]');
    const hole = cardsIn(me).slice(0, 2);
    if (hole.length < 2) { lastKey = ''; show(null); return; }
    const board = cardsIn(document.querySelector('[class*="communityCards"]')).filter((c) => !hole.includes(c)).slice(0, 5);
    const opp = activeOpponents();
    const key = `${hole.join(',')}|${board.join(',')}|${opp}`;
    if (key === lastKey) return;
    lastKey = key;
    const hand = board.length >= 3 ? NAMES[category(evaluate(hole.concat(board)))] : (hole[0] >> 2) === (hole[1] >> 2) ? NAMES[1] : null;
    const r = simulate(hole, board, opp);
    show(`<div class="muted">LRX · poker oranları</div>
      <div>${hole.map(cardStr).join(' ')}${board.length ? ` &nbsp;|&nbsp; ${board.map(cardStr).join(' ')}` : ''}</div>
      ${hand ? `<div>Elin: <b>${hand[0]}</b> <span class="muted">(${hand[1]})</span></div>` : ''}
      <div>Kazanma: <span class="big">%${(r.win * 100).toFixed(1)}</span> &nbsp;beraberlik %${(r.tie * 100).toFixed(1)}</div>
      <div class="muted">${opp} rakibe karşı · rakip elleri rastgele varsayılır</div>`);
  };
  setInterval(tick, 700);
  document.addEventListener('visibilitychange', tick);
  tick();
})();
