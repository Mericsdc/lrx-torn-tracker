/* LRX Suç Yardımcısı — Torn Crimes 2.0 (page.php?sid=crimes)
   • Suç merkezinde ve seçenek satırlarında nerve başına ortalama para kazancı ($/N)
   • Burglary: hedef başına önerilen keşif (case) sayısı, $/N ve topluluk güvenlik notu
   • Disposal: yöntem düğmelerinde $/N ipucu; en iyi yöntem yeşil, zarar ettiren kırmızı çerçeveli
   • Düğme renkleri: her seçeneğin sağındaki düğmenin (Search, Shoplift, Disposal yöntemleri …) etrafı, ekrandaki
     seçenekler arasında $/N sırasına göre kırmızıdan (en kötü) sarıya ve yeşile (en iyi) boyanır
   • Yankesicilik: hedef adının yanında Crime XP çarpanı ve skill'e göre renkler
     (koyu yeşil = açık olan en yüksek grup, açık yeşil = bir alt grup, soluk yeşil = düşük XP,
      kırmızı = henüz zor ya da kötü vücut/aktivite)
   Yalnızca açık olan sayfayı okur ve boyar: Torn'a istek atmaz, hiçbir şeye tıklamaz, satırları gizlemez/sıralamaz.
   $/N verisi uygulama tarafından window.__lrxCV olarak verilir (Emforus'un Crime Profitability Index tablosu,
   maksimum skill varsayımıyla). XP çarpanları ve riskli kombinasyonlar topluluk verisidir; Torn resmî rakam yayımlamaz. */
(() => {
  if (window.__lrxCrimes) return;
  window.__lrxCrimes = true;
  // Uygulama her enjeksiyonda günceller: window.__lrxCrimeOpts = { xp, value, burglary, rank }
  const opt = (k) => (window.__lrxCrimeOpts ? window.__lrxCrimeOpts[k] !== false : true);

  /* ---------------- Yankesicilik: XP ve renkler ---------------- */
  // Güvenlik grupları: [açıldığı skill, XP %, hedefler]
  const GROUPS = [
    [1, 100, ['Drunk man', 'Drunk woman', 'Elderly man', 'Elderly woman', 'Homeless person', 'Junkie']],
    [10, 150, ['Laborer', 'Postal worker', 'Young man', 'Young woman', 'Student']],
    [35, 150, ['Classy lady']],
    [35, 200, ['Rich kid', 'Sex worker']],
    [65, 200, ['Thug']],
    [65, 250, ['Businessman', 'Businesswoman', 'Jogger', 'Gang member']],
    [90, 300, ['Cyclist']],
    [100, 250, ['Mobster']],
    [100, 350, ['Police officer']],
  ];
  const TIERS = [...new Set(GROUPS.map((g) => g[0]))]; // 1, 10, 35, 65, 90, 100
  const MARKS = new Map();
  for (const [min, xp, names] of GROUPS) for (const n of names) MARKS.set(n.toLowerCase(), { name: n, xp, tier: TIERS.indexOf(min) });
  const NAMES = [...MARKS.keys()].sort((a, b) => b.length - a.length); // "Elderly woman" "Elderly man"dan önce denensin

  // Hedefe göre riskli vücut tipi ve aktiviteler
  const BAD = {
    'businessman': { build: ['skinny'], act: ['walking'] },
    'drunk man': { build: ['muscular'], act: ['distracted'] },
    'drunk woman': { act: ['distracted'] },
    'gang member': { build: ['muscular'] },
    'homeless person': { act: ['loitering'] },
    'junkie': { act: ['loitering'] },
    'laborer': { act: ['distracted'] },
    'police officer': { act: ['walking'] },
    'sex worker': { build: ['muscular'], act: ['distracted'] },
    'student': { build: ['athletic'] },
    'thug': { build: ['muscular'], act: ['loitering', 'walking'] },
  };
  const ACTIVITIES = ['listening to music', 'on phone', 'distracted', 'loitering', 'stumbling', 'soliciting', 'begging', 'walking', 'running', 'jogging', 'cycling'];
  // Mobil görünümde aktivite yazısı yok; durum ikonu sprite konumundan okunur
  const SPRITE = { 0: 'cycling', 34: 'distracted', 102: 'listening to music', 136: 'loitering', 170: 'on phone', 204: 'running', 238: 'soliciting', 272: 'stumbling', 306: 'walking', 340: 'begging' };

  /* ---------------- Burglary: topluluk notları ---------------- */
  // [açıldığı skill (yaklaşık), güvenlik notu] — wiki ve NichtGersti/SOLiNARY tabloları; "?" olanlar tahmini
  const BURG = {
    'tool shed': [1, 'Safe'], 'beach hut': [1, 'Safe'], 'mobile home': [1, 'Safe'], 'bungalow': [1, 'Moderately unsafe'],
    'cottage': [3, 'Moderately unsafe'], 'apartment': [14, 'Risky'], 'suburban home': [22, 'Moderately unsafe'],
    'secluded cabin': [30, 'Safe'], 'farmhouse': [38, 'Unsafe'], 'lake house': [46, 'Unsafe'], 'luxury villa': [69, 'Risky'],
    'manor house': [100, 'Risky'], 'postal office': [25, 'Risky'], 'funeral directors': [25, 'Unsafe'], 'market': [25, 'Risky'],
    'self-storage facility': [25, 'Dangerous'], 'cleaning agency': [29, 'Safe'], 'barbershop': [35, 'Moderately unsafe'],
    'liquor store': [43, 'Moderately unsafe'], 'dentists office': [47, 'Safe'], 'chiropractors': [56, 'Moderately unsafe'],
    'recruitment agency': [77, 'Risky'], 'advertising agency': [100, 'Risky'], 'dockside warehouse': [50, 'Dangerous'],
    'farm storage unit': [50, 'Risky'], 'shipyard': [50, 'Very dangerous'], 'printing works': [54, 'Risky'],
    'brewery': [60, 'Very dangerous'], 'truckyard': [68, 'Moderately unsafe'], 'old factory': [77, 'Safe'],
    'slaughterhouse': [84, 'Safe'], 'paper mill': [91, 'Unsafe'], 'foundry': [96, 'Moderately unsafe'], 'fertilizer plant': [100, 'Unsafe'],
  };
  const SAFETY_TR = { 'Safe': 'güvenli', 'Moderately unsafe': 'orta riskli', 'Unsafe': 'riskli', 'Risky': 'riskli', 'Dangerous': 'tehlikeli', 'Very dangerous': 'çok tehlikeli' };
  // Mobil / kısa adlar ve yazım farkları
  const ALIAS = {
    'self storage facility': 'self-storage facility', 'self storage': 'self-storage facility', 'docklands': 'dockside warehouse',
    'warehouse': 'dockside warehouse', 'farm storage': 'farm storage unit', 'ad agency': 'advertising agency',
    'cleaning firm': 'cleaning agency', 'funeral home': 'funeral directors', 'funeral parlor': 'funeral directors',
    'recruit agency': 'recruitment agency', 'temp agency': 'recruitment agency', "dentist's office": 'dentists office',
    'city centre': 'city center',
  };
  // URL'deki suç kısa adı -> tablodaki suç adı
  const SLUG = {
    searchforcash: 'search for cash', bootlegging: 'bootlegging', graffiti: 'graffiti', shoplifting: 'shoplifting',
    pickpocketing: 'pickpocketing', burglary: 'burglary', disposal: 'disposal', cracking: 'cracking', forgery: 'forgery',
  };

  // Düğme renkleri: 0 = kırmızı (en kötü) … RANKS = yeşil (en iyi), aradaki tonlar turuncu ve sarı
  const RANKS = 10;

  const style = document.createElement('style');
  style.id = 'lrx-crimes-css';
  style.textContent = `
    [data-lrx-xp]::after { content: " (" attr(data-lrx-xp) ")"; font-weight: 700; }
    [data-lrx-pp] [data-lrx-xp] { color: #5fbf3f !important; }
    [data-lrx-pp="hard"] [data-lrx-xp] { color: #f07a7a !important; }
    [data-lrx-bad] { color: #ff6b6b !important; }
    [data-lrx-pp="ideal"] [class*="commitButtonSection"] { background-color: #3fa52a !important; }
    [data-lrx-pp="easy"] [class*="commitButtonSection"] { background-color: #82c370 !important; }
    [data-lrx-pp="low"] [class*="commitButtonSection"] { background-color: #a6d499 !important; }
    [data-lrx-pp="hard"] [class*="commitButtonSection"],
    [data-lrx-pp="bad"] [class*="commitButtonSection"] { background-color: #f39a9a !important; }
    [data-lrx-cvt]::after { content: "  " attr(data-lrx-cvt); font-size: 11px; font-weight: 700; color: #5fbf3f; white-space: nowrap; }
    .lrx-cv { display: inline-block; margin-left: 6px; padding: 0 5px; border-radius: 8px; font-size: 11px; line-height: 16px;
      font-weight: 700; background: rgba(63,165,42,.16); color: #5fbf3f; white-space: nowrap; vertical-align: middle; }
    .lrx-cv.top { background: #3fa52a; color: #fff; }
    .lrx-cv.low { background: rgba(150,150,150,.18); color: #9a9a9a; }
    .lrx-cv.neg { background: rgba(240,122,122,.16); color: #f07a7a; }
    [data-lrx-best] { box-shadow: inset 0 0 0 2px #3fa52a !important; }
    [data-lrx-neg] { box-shadow: inset 0 0 0 2px #f07a7a !important; }
    ${Array.from({ length: RANKS + 1 }, (_, b) => `[data-lrx-rank="${b}"] { outline: 2px solid hsl(${b * 12}, 80%, 50%) !important; outline-offset: 1px !important; }`).join('\n    ')}`;
  document.head.appendChild(style);

  const setAttr = (el, name, val) => {
    if (!el) return;
    if (val == null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
    else if (el.getAttribute(name) !== val) el.setAttribute(name, val);
  };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const money = (v) => (v < 0 ? '-' : '') + '$' + Math.abs(Math.round(v)).toLocaleString('en-US');
  const perN = (v) => {
    if (v == null) return null;
    const a = Math.abs(v);
    const s = a >= 10000 ? `${Math.round(a / 1000)}k` : a >= 1000 ? `${(a / 1000).toFixed(1)}k` : `${Math.round(a)}`;
    return `${v < 0 ? '-' : ''}$${s}/N`;
  };
  const cv = () => window.__lrxCV || null;

  // Oyuncunun o suçtaki skill'i (sağdaki istatistik paneli: aria-label="Skill: 72.5")
  const readSkill = () => {
    const el = document.querySelector('[aria-label^="Skill:" i]');
    const v = parseFloat((el?.getAttribute('aria-label') || '').replace(/[^\d.]/g, ''));
    return Number.isFinite(v) ? v : null;
  };

  const readActivity = (row) => {
    for (const el of row.querySelectorAll('[class*="activity"]')) {
      const t = clean(el.textContent);
      const a = ACTIVITIES.find((x) => t.startsWith(x));
      if (a) return { act: a, el };
    }
    const icon = row.querySelector('[class*="timerCircle"] [class*="icon"]');
    if (icon) {
      const y = Math.abs(parseFloat(getComputedStyle(icon).backgroundPositionY) || 0);
      const a = SPRITE[Math.round(y)];
      if (a) return { act: a, el: null };
    }
    return { act: null, el: null };
  };

  const decoratePickpocket = (row, skill, topTier) => {
    const box = row.querySelector('[class*="titleAndProps"]');
    const nameEl = box?.firstElementChild;
    if (!nameEl) return;
    const key = NAMES.find((n) => clean(nameEl.textContent).startsWith(n));
    const mark = key && MARKS.get(key);
    if (!mark) { setAttr(row, 'data-lrx-pp', null); setAttr(nameEl, 'data-lrx-xp', null); return; }
    const val = opt('value') ? cv()?.crimes?.pickpocketing?.options?.[key] : null;

    if (!opt('xp')) { // yalnızca $/N açık
      setAttr(row, 'data-lrx-pp', null);
      setAttr(nameEl, 'data-lrx-xp', val != null ? perN(val) : null);
      return;
    }
    const buildEl = box.querySelector('[class*="physicalProps"]') || nameEl.nextElementSibling;
    const build = clean(buildEl?.textContent).split(' ')[0] || '';
    const { act, el: actEl } = readActivity(row);
    const bad = BAD[key] || {};
    const badBuild = !!bad.build?.includes(build);
    const badAct = !!(act && bad.act?.includes(act));

    let kind = 'neutral';
    if (badBuild || badAct) kind = 'bad';
    else if (topTier != null) kind = mark.tier > topTier ? 'hard' : mark.tier === topTier ? 'ideal' : mark.tier === topTier - 1 ? 'easy' : 'low';

    setAttr(nameEl, 'data-lrx-xp', `${mark.xp}% XP${val != null ? ` · ${perN(val)}` : ''}`);
    setAttr(row, 'data-lrx-pp', kind);
    setAttr(buildEl, 'data-lrx-bad', badBuild ? '' : null);
    setAttr(actEl, 'data-lrx-bad', badAct ? '' : null);
    const why = {
      ideal: `LRX · Skill'ine göre en çok XP veren grup (${mark.xp}%)`,
      easy: `LRX · Güvenli, biraz daha az XP (${mark.xp}%)`,
      low: `LRX · Kolay ama düşük XP (${mark.xp}%)`,
      hard: `LRX · Skill'in için henüz riskli (bu grup ~${TIERS[mark.tier]} skill'de açılır)`,
      bad: `LRX · Riskli: ${[badBuild && build, badAct && act].filter(Boolean).join(' + ')} bu hedefte başarısızlık riskini artırır`,
      neutral: `LRX · Crime XP ${mark.xp}%${skill == null ? ' (skill okunamadı)' : ''}`,
    }[kind];
    setAttr(row.querySelector('[class*="commitButtonSection"]'), 'title', why + (val != null ? ` · maks. skill'de ~${money(val)}/nerve` : ''));
  };

  /* ---------------- $/N rozetleri ---------------- */
  // Seçenek başlığı: başlık kartının ilk doğrudan yazı düğümü (masaüstü), yoksa başlık öğesi
  const optionLabel = (row) => {
    const sec = row.querySelector('[class*="crimeOptionSection"]');
    if (!sec) return null;
    for (const n of sec.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return { host: sec, after: n, text: n.textContent.trim() };
    const t = sec.querySelector('[class*="title"]') || row.querySelector('[class*="confidenceSectionTablet"] [class*="title"]');
    if (t && t.textContent.trim()) return { host: t, after: null, text: t.textContent.trim() };
    return null;
  };
  // Rozeti React düğümlerine dokunmadan, yazının hemen arkasına ayrı bir span olarak koy (varsa günceller)
  const badge = (lab, text, cls, title) => {
    let b = lab.host.querySelector(':scope > .lrx-cv');
    if (!text) { b?.remove(); return; }
    if (!b) {
      b = document.createElement('span');
      b.className = 'lrx-cv';
      if (lab.after && lab.after.parentNode === lab.host) lab.after.after(b); else lab.host.appendChild(b);
    }
    if (b.textContent !== text) b.textContent = text;
    const c = `lrx-cv ${cls || ''}`.trim();
    if (b.className !== c) b.className = c;
    if (title && b.title !== title) b.title = title;
  };
  const lookup = (map, text) => {
    const k = clean(text);
    const cands = [k, ALIAS[k], `search the ${k}`, k.replace(/ district$/, ''), ALIAS[k.replace(/ district$/, '')]].filter(Boolean);
    for (const c of cands) if (map[c] != null) return { key: c, v: map[c] };
    return null;
  };

  const scanHub = (root) => {
    const data = cv()?.crimes;
    for (const card of root.querySelectorAll('[class*="crimes-hub-crime"], .crimes-hub-crime')) {
      const t = card.querySelector('[class*="crimeTitle"]');
      if (!t) continue;
      const c = data && opt('value') ? data[clean(t.textContent).replace(/\s*\$.*$/, '')] : null;
      setAttr(t, 'data-lrx-cvt', c?.best != null ? perN(c.best) : null);
      setAttr(t, 'title', c?.best != null ? `LRX · En iyi seçenekte maks. skill'de ~${money(c.best)}/nerve (Emforus tablosu)` : null);
    }
  };

  /* ---------------- Düğme renkleri (en kötüden en iyiye) ---------------- */
  // Değerler küçükten büyüğe dizilir: en düşük 0 (kırmızı), en yüksek RANKS (yeşil); aynı değer aynı rengi alır
  const rankBuckets = (vals) => {
    const uniq = [...new Set(vals.filter((v) => v != null))].sort((a, b) => a - b);
    return vals.map((v) => {
      if (v == null) return null;
      if (uniq.length < 2) return v < 0 ? 0 : RANKS;
      return Math.round((uniq.indexOf(v) / (uniq.length - 1)) * RANKS);
    });
  };
  // "2/6": ekrandaki seçenekler arasında kaçıncı en iyi
  const place = (vals, v) => {
    const desc = [...new Set(vals.filter((x) => x != null))].sort((a, b) => b - a);
    return `${desc.indexOf(v) + 1}/${desc.length}`;
  };
  // Satırın sağındaki işlem düğmesi (Search, Shoplift, Case …); bulunamazsa düğme bölümü
  const commitBtns = (row) => {
    const btns = [...row.querySelectorAll('button[class*="commitButton"]')];
    if (btns.length) return btns;
    const sec = row.querySelector('[class*="commitButtonSection"]');
    return sec ? [sec] : [];
  };
  const ring = (els, bucket, title) => {
    for (const el of els) {
      if (bucket == null) {
        setAttr(el, 'data-lrx-rank', null);
        if (el.hasAttribute('data-lrx-rt')) { el.removeAttribute('title'); el.removeAttribute('data-lrx-rt'); }
        continue;
      }
      setAttr(el, 'data-lrx-rank', String(bucket));
      if (title) { setAttr(el, 'title', title); setAttr(el, 'data-lrx-rt', ''); }
    }
  };

  const scanOptions = (root, slug) => {
    const data = cv();
    const crime = SLUG[slug];
    if (!data || !crime) return;
    const rows = [...root.querySelectorAll('.crime-option')];
    const showV = opt('value');
    const showR = opt('rank');

    if (crime === 'burglary') {
      const items = rows.map((row) => { const lab = optionLabel(row); return { row, lab, hit: lab ? lookup(data.burglary || {}, lab.text) : null }; });
      const vals = items.map((x) => x.hit?.v?.v ?? null);
      const ranks = rankBuckets(vals);
      items.forEach(({ row, lab, hit }, i) => {
        const v = vals[i];
        ring(commitBtns(row), showR && v != null ? ranks[i] : null, v != null ? `LRX · ${place(vals, v)} en iyi · normal keşifle ~${money(v)}/nerve (maks. skill)` : null);
        if (!lab) return;
        if (!hit || (!opt('burglary') && !showV)) { badge(lab, null); return; }
        const b = hit.v; const info = BURG[hit.key];
        const parts = [];
        if (showV && b.v != null) parts.push(perN(b.v));
        if (opt('burglary') && b.c != null) parts.push(`${b.c} case`);
        const low = b.v != null && b.v < 2500;
        const tip = `LRX · ${b.d || ''} · önerilen keşif (case): ${b.c ?? '?'}, tahmini toplam nerve ${b.n ?? '?'}`
          + ` · normal keşif ${b.v != null ? money(b.v) : '?'}/N, focused ${b.f != null ? money(b.f) : '?'}/N`
          + (info ? ` · topluluk notu: ${SAFETY_TR[info[1]] || info[1]}, ~${info[0]} skill'de açılır` : '')
          + ' (maks. skill varsayımı)';
        badge(lab, parts.join(' · '), low ? 'low' : '', tip);
      });
      return;
    }
    if (crime === 'pickpocketing') return; // XP ve renkler hedef satırında (decoratePickpocket)

    const map = data.crimes?.[crime]?.options || {};
    if (crime === 'disposal') {
      // Her iş satırında yöntem düğmeleri kendi aralarında sıralanır
      for (const row of rows) {
        const lab = optionLabel(row); if (!lab) continue;
        const job = clean(lab.text);
        const btns = [...row.querySelectorAll('[class*="methodButton"]')];
        const vals = btns.map((btn) => map[`${job} : ${clean(btn.getAttribute('aria-label') || btn.textContent)}`] ?? null);
        const ranks = rankBuckets(vals);
        let best = null;
        btns.forEach((btn, i) => {
          const v = vals[i];
          setAttr(btn, 'title', v != null && (showV || showR) ? `LRX · ${place(vals, v)} en iyi · ${money(v)}/nerve (maks. skill)` : null);
          setAttr(btn, 'data-lrx-rank', showR && v != null ? String(ranks[i]) : null);
          setAttr(btn, 'data-lrx-neg', !showR && showV && v != null && v < 0 ? '' : null);
          setAttr(btn, 'data-lrx-best', null);
          if (v != null && (!best || v > best.v)) best = { btn, v };
        });
        if (!showR && showV && best && best.v > 0) setAttr(best.btn, 'data-lrx-best', '');
        badge(lab, showV && best ? perN(best.v) : null, best && best.v < 0 ? 'neg' : '', best ? 'LRX · Bu işteki en iyi yöntemin nerve başına kazancı' : null);
      }
      return;
    }
    // Genel: Search for Cash, Bootlegging, Shoplifting, Graffiti, Forgery …
    const hits = rows.map((row) => { const lab = optionLabel(row); return { row, lab, hit: lab ? lookup(map, lab.text) : null }; });
    const vals = hits.map((h) => h.hit?.v ?? null);
    const ranks = rankBuckets(vals);
    const top = Math.max(...vals.map((v) => v ?? -Infinity));
    hits.forEach(({ row, lab, hit }, i) => {
      ring(commitBtns(row), showR && hit ? ranks[i] : null, hit ? `LRX · ${place(vals, hit.v)} en iyi · maks. skill'de ~${money(hit.v)}/nerve` : null);
      if (!lab) return;
      if (!hit || !showV) { badge(lab, null); return; }
      badge(lab, perN(hit.v), hit.v < 0 ? 'neg' : hit.v === top && hits.length > 1 ? 'top' : '', `LRX · maks. skill'de ~${money(hit.v)}/nerve (Emforus tablosu)`);
    });
  };

  let queued = false;
  const scan = () => {
    queued = false;
    if (document.hidden) return;
    const hub = document.querySelector('.crimes-hub-root');
    if (hub) scanHub(hub);
    const slug = (location.hash.match(/^#\/([a-z]+)/i) || [])[1]?.toLowerCase() || '';
    const root = document.querySelector('.crime-root') || document.querySelector(`.${slug}-root`);
    if (!root || !slug) return;
    if (slug === 'pickpocketing' && (opt('xp') || opt('value'))) {
      const skill = readSkill();
      const topTier = skill == null ? null : TIERS.reduce((t, min, i) => (skill >= min ? i : t), 0);
      for (const row of root.querySelectorAll('.crime-option')) decoratePickpocket(row, skill, topTier);
    }
    scanOptions(root, slug);
  };
  const queue = () => { if (!queued) { queued = true; setTimeout(scan, 60); } };

  // Liste sanal (virtual) ve React ile yeniden çiziliyor: düğüm eklenince tara, ayrıca güvenlik için 1,5 sn'de bir.
  // Kendi eklediğimiz rozetler gözlemciyi tekrar tetiklemesin diye yalnızca başkalarının eklediği düğümlere bakılır.
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.target.nodeType === 1 && m.target.closest('.lrx-cv')) continue;
      for (const n of m.addedNodes) if (!(n.nodeType === 1 && n.classList.contains('lrx-cv'))) return queue();
    }
  }).observe(document.body, { childList: true, subtree: true });
  setInterval(queue, 1500);
  document.addEventListener('visibilitychange', queue);
  window.addEventListener('hashchange', queue);
  queue();
})();
