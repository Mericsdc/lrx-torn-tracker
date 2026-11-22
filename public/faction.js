/* =========================================================
   LRX Faction sayfası (events.js ve faction-tools.js'ten sonra yüklenir)
   Sekmeler:
   - OC & Özet: kendi OC'n, OC'ye girmeyenler, devam eden OC'ler (eksik eşyalı satır -> Armory Utilities), 7g/30g üye raporu
   - Aktivite: canlı Online/Idle/Offline dağılımı, 7x24 TCT aktivite ısı haritası, tam üye tablosu, 2 üye karşılaştırma
   - Armory: 30 günlük armory geçmişi (kim ne kullandı/ödünç aldı/doldurdu)
   - Chain: canlı chain durumu ve geçmiş chain bonus raporları
   - Yükseltme Simülatörü: respect harcamadan dal sıralaması (1×/2×/4×/8×/16×/32×) maliyet hesabı
   Torn kuralları: veriler yalnızca Torn API'den gelir; Torn sayfası okunmaz, hiçbir şeye tıklanmaz.
   ========================================================= */
(() => {
  Object.assign(I18N, { 'nav.faction': ['Faction', 'Faction'] });
  Object.assign(VIEW_META, {
    faction: {
      tr: ['Faction', 'OC takibi, aktivite ısı haritası, armory, chain ve yükseltme simülatörü'],
      en: ['Faction', 'OC tracking, activity heatmap, armory history, chains and upgrade simulator'],
    },
  });

  const T = 'https://www.torn.com/';
  const OC_URL = T + 'factions.php?step=your#/tab=crimes';
  const ARMORY_UTILITIES_URL = T + 'factions.php?step=your#/tab=armoury&start=0&sub=utilities';
  const CHAIN_URL = T + 'factions.php?step=your#/war/chain';
  const UPGRADES_URL = T + 'factions.php?step=your#/tab=upgrades';

  const fac = {
    tab: lsGet('tt.fac.tab', 'oc'),
    d: null, err: null,
    rep: null, repErr: null, repTimer: null, repDays: Number(lsGet('tt.fac.repDays', '7')) === 30 ? 30 : 7,
    act: null, actErr: null, actQ: '', actFilter: 'all', actSort: 'last', cmpA: 0, cmpB: 0,
    arm: null, armErr: null, armCat: 'all', armQ: '',
    ch: null, chErr: null,
    upg: null, upgErr: null, upgSel: null, upgRespectOverride: null, upgBranch: 'all',
  };

  const nowS = () => Math.floor(nowTct() / 1000);
  const profile = (id) => `${T}profiles.php?XID=${id}`;
  const nameBtn = (id, name) => `<a class="fac-name" href="${profile(id)}">${esc(name)}</a>`; // torn.com bağlantıları uygulama içi sekmede açılır
  const hms = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 3600)}${tr('sa', 'h')} ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}${tr('dk', 'm')} ${String(s % 60).padStart(2, '0')}${tr('sn', 's')}`; };
  const dayLabel = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');
  const tsFmt = (ts) => (ts ? new Date(ts * 1000).toLocaleString(state.lang === 'en' ? 'en-GB' : 'tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '—');
  const STATE_TR = { Traveling: ['uçakta', 'Traveling'], Abroad: ['yurt dışında', 'Abroad'], Hospital: ['hastanede', 'In Hospital'], Jail: ['hapiste', 'In Jail'], Federal: ['federal hapiste', 'In Federal Jail'], Okay: ['müsait', 'Okay'] };
  const stateText = (s) => { const t = STATE_TR[s]; return t ? tr(t[0], t[1]) : esc(s || ''); };
  const ROLE_TR = { leader: ['Lider', 'Leader'], 'co-leader': ['Eş lider', 'Co-leader'] };
  const DOW_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const ARM_LABELS = {
    all: ['Hepsi', 'All'], used: ['Kullandı', 'Used'], loaned: ['Ödünç', 'Loaned'], returned: ['İade', 'Returned'],
    filled: ['Doldurdu', 'Filled'], deposited: ['Yatırdı', 'Deposited'], retrieved: ['Aldı', 'Retrieved'], other: ['Diğer', 'Other'],
  };

  function visibleTabs() {
    const out = [['oc', '🕵️', tr('OC & Özet', 'OC & Overview')]];
    if (feat('faction.activity')) out.push(['activity', '📊', tr('Aktivite', 'Activity')]);
    if (feat('faction.armory')) out.push(['armory', '🧰', tr('Armory', 'Armory')]);
    if (feat('faction.chains')) out.push(['chains', '⛓', tr('Chain', 'Chains')]);
    if (feat('faction.upgrades')) out.push(['upgrades', '🌳', tr('Yükseltmeler', 'Upgrades')]);
    return out;
  }
  function activeTab() {
    const tabs = visibleTabs();
    return tabs.some(([k]) => k === fac.tab) ? fac.tab : 'oc';
  }

  /* ---------- Veri ---------- */
  async function fetchFaction(force = false) {
    try { fac.d = await api(`/api/faction${force ? '?force=1' : ''}`); fac.err = null; }
    catch (e) { fac.err = e; }
    checkOcNotify();
    return fac.d;
  }
  async function fetchReport(start = false) {
    try { fac.rep = await api(`/api/faction/report?days=${fac.repDays}`, start ? { method: 'POST' } : {}); fac.repErr = null; }
    catch (e) { fac.repErr = e; }
    // Rapor hazırlanırken sayfa açıksa 4 sn'de bir ilerlemeyi göster
    clearTimeout(fac.repTimer);
    if (fac.rep?.job?.running && state.view === 'faction') fac.repTimer = setTimeout(() => fetchReport().then(render), 4000);
  }
  async function fetchActivity(force = false) {
    try { fac.act = await api(`/api/faction/activity${force ? '?force=1' : ''}`); fac.actErr = null; }
    catch (e) { fac.actErr = e; }
    return fac.act;
  }
  async function fetchArmory(force = false) {
    try { fac.arm = await api(`/api/faction/armory${force ? '?force=1' : ''}`); fac.armErr = null; }
    catch (e) { fac.armErr = e; }
    return fac.arm;
  }
  async function fetchChains(force = false) {
    try { fac.ch = await api(`/api/faction/chains${force ? '?force=1' : ''}`); fac.chErr = null; }
    catch (e) { fac.chErr = e; }
    return fac.ch;
  }
  async function fetchUpgrades(force = false) {
    try {
      fac.upg = await api(`/api/faction/upgrades${force ? '?force=1' : ''}`);
      fac.upgErr = null;
      if (!fac.upgSel || force) fac.upgSel = { ...(fac.upg.currentLevels || {}) };
    } catch (e) { fac.upgErr = e; }
    return fac.upg;
  }
  async function loadTabData(tab, force = false) {
    if (tab === 'activity' && (force || !fac.act)) { await fetchActivity(force); render(); }
    else if (tab === 'armory' && (force || !fac.arm)) { await fetchArmory(force); render(); }
    else if (tab === 'chains' && (force || !fac.ch)) { await fetchChains(force); render(); }
    else if (tab === 'upgrades' && (force || !fac.upg)) { await fetchUpgrades(force); render(); }
  }
  async function loadFaction(force = false) {
    const el = $('#faction-body');
    if (!fac.d && el) el.innerHTML = loadingBox();
    await fetchFaction(force);
    render();
    const tab = activeTab();
    if (fac.d?.access?.allowed) { fetchReport().then(render); }
    if (fac.d?.access?.inFaction && tab !== 'oc') await loadTabData(tab, force);
  }

  /* ---------- Bildirimler ---------- */
  function notifyOnce(key, title, body, url) {
    let seen = null; try { seen = localStorage.getItem(key); } catch {}
    if (seen) return;
    try { localStorage.setItem(key, String(Date.now())); } catch {}
    if (feat('notify')) notify(key, title, body, url ? { url } : {});
  }
  function checkOcNotify() {
    const d = fac.d; if (!d || !feat('page.faction')) return;
    const my = d.myOc;
    if (feat('notify.oc') && my && !my.error) {
      let prev = null; try { prev = localStorage.getItem('lrx.oc.prev'); } catch {}
      const cur = my.inOc ? String(my.crime.id) : 'none';
      if (prev && prev !== 'none' && cur === 'none') {
        notifyOnce(`lrx.oc.done.${prev}`, '🕵️ ' + tr('OC\'n bitti', 'Your OC has ended'), tr('Şu an bir OC\'de değilsin: yeni bir OC\'ye katılabilirsin.', 'You are no longer in an OC: you can join a new one.'), OC_URL);
      }
      try { localStorage.setItem('lrx.oc.prev', cur); } catch {}
      if (my.inOc && my.slot?.item && !my.slot.item.ok) {
        notifyOnce(`lrx.oc.item.${my.crime.id}`, '🧰 ' + tr('OC eşyan eksik', 'OC item missing'),
          tr(`${my.crime.name} · ${my.slot.role}: ${my.slot.item.name} gerekiyor. Yoksa OC gecikir.`, `${my.crime.name} · ${my.slot.role}: needs ${my.slot.item.name}. The OC will be delayed without it.`), ARMORY_UTILITIES_URL);
      }
    }
    // Lider / yetkili: geciken ya da eşyası eksik OC'ler
    if (feat('notify.factionOc') && d.access?.allowed && d.oc?.crimes) {
      for (const c of d.oc.crimes) {
        const probs = [...c.missing.map((m) => `${m.name}: ${m.item}`), ...c.away.map((a) => `${a.name}: ${stateText(a.state)}`)];
        if (!c.delayed && !c.missing.length) continue;
        notifyOnce(`lrx.foc.${c.id}.${c.missing.map((m) => m.id).join('-')}.${c.delayed ? 'd' : ''}`,
          `⏳ ${c.delayed ? tr('OC gecikiyor', 'OC delayed') : tr('OC eşyası eksik', 'OC item missing')}: ${c.name}`,
          probs.join(' · ') || tr('Planlama bitti ama OC başlamadı.', 'Planning is done but the OC has not started.'), c.delayed ? OC_URL : ARMORY_UTILITIES_URL);
      }
    }
  }
  // Kendi OC'nin planlaması bittiğinde (ready_at) bir kez bildir
  setInterval(() => {
    const my = fac.d?.myOc;
    if (!my?.inOc || !my.crime.readyAt || !feat('page.faction') || !feat('notify.oc')) return;
    const left = my.crime.readyAt - nowS();
    if (left <= 0 && left > -600) notifyOnce(`lrx.oc.ready.${my.crime.id}`, '🕵️ ' + tr('OC planlaması bitti', 'OC planning finished'), tr(`${my.crime.name} başlamaya hazır.`, `${my.crime.name} is ready to start.`), OC_URL);
  }, 30_000);
  // Arka planda 5 dakikada bir (yalnızca bildirimler açıksa): OC verisi API'den, Torn sayfası okunmaz
  setInterval(() => {
    if (!feat('page.faction') || !feat('notify') || !(feat('notify.oc') || feat('notify.factionOc'))) return;
    if (state.overview?.player?.faction && !Number(state.overview.player.faction.faction_id)) return;
    fetchFaction().then(() => { if (state.view === 'faction') render(); });
  }, 5 * 60_000);
  setTimeout(() => { if (feat('page.faction') && !fac.d) fetchFaction(); }, 20_000);

  /* ---------- Sekme 1: OC & Özet ---------- */
  function myOcCard(my) {
    const head = `<div class="card-head wrap"><h3>🕵️ ${tr('Senin OC\'n', 'Your OC')}</h3>
      <button class="btn sm ghost" type="button" data-open-url="${OC_URL}" data-tab-label="Organized Crimes">${tr('Torn\'da OC sayfası', 'OC page in Torn')} ↗</button></div>`;
    if (!my) return `<article class="glass card">${head}${loadingBox()}</article>`;
    if (my.error) return `<article class="glass card">${head}<div class="alert danger">${esc(my.error)}</div></article>`;
    if (!my.inOc) return `<article class="glass card">${head}<div class="fac-line"><span class="chip warn">${tr('OC\'de değilsin', 'Not in an OC')}</span> <span class="muted">${tr('Torn\'daki OC sekmesinden boş bir slota katılabilirsin.', 'You can join an open slot on the OC tab in Torn.')}</span></div></article>`;
    const c = my.crime, s = my.slot;
    const left = c.readyAt ? c.readyAt - nowS() : null;
    const armoryTitle = esc(tr('Faction Armory → Utilities sayfasını aç', 'Open Faction Armory → Utilities'));
    const item = s?.item ? (s.item.ok
      ? `<span class="chip green">✓ ${esc(s.item.name)}</span>`
      : `<button class="chip danger fac-armory-link" type="button" data-open-url="${ARMORY_UTILITIES_URL}" data-tab-label="Armory · Utilities" title="${armoryTitle}">✗ ${esc(s.item.name)} ${tr('eksik', 'missing')} ↗</button>`) : `<span class="muted">${tr('eşya gerekmiyor', 'no item needed')}</span>`;
    return `<article class="glass card">${head}
      <div class="fac-grid">
        <div><small class="muted">${tr('Suç', 'Crime')}</small><b>${esc(c.name)}</b> <span class="muted">· ${tr('zorluk', 'difficulty')} ${c.difficulty}</span></div>
        <div><small class="muted">${tr('Durum', 'Status')}</small><b>${esc(c.status)}</b> <span class="muted">· ${c.filled}/${c.total} ${tr('slot dolu', 'slots filled')}</span></div>
        <div><small class="muted">${tr('Rolün', 'Your role')}</small><b>${esc(s?.role || '—')}</b>${s?.cpr != null ? ` <span class="muted">· CPR ${s.cpr}</span>` : ''}</div>
        <div><small class="muted">${tr('Eşya', 'Item')}</small>${item}</div>
        <div><small class="muted">${tr('Planlama', 'Planning')}</small>${left == null ? '—' : left > 0 ? `<b>${human(left)}</b> ${tr('kaldı', 'left')}` : `<span class="chip warn">${tr('bitti', 'done')}</span>`}</div>
      </div></article>`;
  }

  function lockedCard(a) {
    const why = !a.inFaction ? tr('Bir faction\'da değilsin.', 'You are not in a faction.')
      : a.apiAccess === false
        ? tr(`Pozisyonun (${esc(a.position)}) için "Faction API Access" izni yok. Torn bu izin olmadan OC verisini vermez.`, `Your position (${esc(a.position)}) does not have the "Faction API Access" permission. Torn does not share OC data without it.`)
        : tr(`Pozisyonun (${esc(a.position)}) için "Organised Crimes" yetkisi yok.`, `Your position (${esc(a.position)}) does not have the "Organised Crimes" permission.`);
    return `<article class="glass card fac-lock">
      <div class="card-head"><h3>🔒 ${tr('OC takibi ve haftalık rapor', 'OC tracking and weekly report')}</h3></div>
      <p>${tr('Bu bölüm yalnızca faction liderine, eş lidere ve liderin pozisyonuna <b>Organised Crimes</b> yetkisi verdiği üyelere açık. O pozisyonda <b>Faction API Access</b> de açık olmalı.', 'This section is only for the faction leader, the co-leader and members in positions the leader has given the <b>Organised Crimes</b> permission. That position also needs <b>Faction API Access</b>.')}</p>
      <p class="muted">${why} ${tr('Yetkiyi lider oyunda verir: Faction → Controls → Positions. İzin verildikten sonra en geç 10 dakikada burada açılır.', 'The leader grants it in game: Faction → Controls → Positions. Once granted, it unlocks here within 10 minutes.')}</p>
    </article>`;
  }

  function notInOcCard(oc) {
    const rows = oc.notInOc.map((m) => `<tr>
      <td>${nameBtn(m.id, m.name)}</td><td class="num">${m.level}</td><td>${esc(m.position)}</td>
      <td><i class="fac-dot ${m.lastStatus === 'Online' ? 'on' : m.lastStatus === 'Idle' ? 'idle' : ''}"></i>${esc(m.lastRel)}</td>
      <td>${m.state && m.state !== 'Okay' ? `<span class="chip ${m.state === 'Hospital' || m.state === 'Jail' ? 'danger' : 'blue'}">${stateText(m.state)}</span>` : `<span class="muted">${stateText('Okay')}</span>`}</td>
      <td class="num">${m.days}</td></tr>`).join('');
    return `<article class="glass card">
      <div class="card-head wrap"><h3>🚫 ${tr('OC\'ye girmeyenler', 'Not in an OC')} <span class="muted">(${oc.notInOc.length})</span></h3>
        <span class="muted">${tr('Son görülene göre sıralı · isme tıkla: profil', 'Sorted by last seen · click a name to open the profile')}</span></div>
      ${oc.notInOc.length ? `<div class="tbl-wrap"><table class="tbl compact">
        <thead><tr><th>${tr('Üye', 'Member')}</th><th class="num">Lv</th><th>${tr('Pozisyon', 'Position')}</th><th>${tr('Son görülme', 'Last seen')}</th><th>${tr('Durum', 'Status')}</th><th class="num">${tr('Gün', 'Days')}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : `<div class="muted">${tr('Herkes bir OC\'de 🎉', 'Everyone is in an OC 🎉')}</div>`}
    </article>`;
  }

  function crimesCard(oc) {
    const now = nowS();
    const hasMissing = oc.crimes.some((c) => c.missing.length);
    const armoryTitle = esc(tr('Faction Armory → Utilities sayfasını aç', 'Open Faction Armory → Utilities'));
    const rows = oc.crimes.map((c) => {
      const probs = [
        ...c.missing.map((m) => `<span class="chip danger">🧰 ${esc(m.name)}: ${esc(m.item)}</span>`),
        ...c.away.map((a) => `<span class="chip blue">${esc(a.name)}: ${stateText(a.state)}${a.until ? ` · ${human(a.until - now)}` : ''}</span>`),
        ...(c.open ? [`<span class="chip warn">${c.open} ${tr('boş slot', c.open > 1 ? 'open slots' : 'open slot')}</span>`] : []),
      ];
      const when = c.delayed ? `<span class="chip danger">${tr('gecikiyor', 'delayed')}</span>`
        : c.status === 'Planning' && c.readyAt ? tr(`${human(c.readyAt - now)} <span class="muted">sonra hazır</span>`, `<span class="muted">ready in</span> ${human(c.readyAt - now)}`)
        : c.status === 'Recruiting' && c.expiredAt ? `<span class="muted">${tr('dolmazsa', 'expires in')}</span> ${human(c.expiredAt - now)}` : '—';
      const cls = [c.delayed ? 'fac-bad' : '', c.missing.length ? 'fac-armory-row' : ''].filter(Boolean).join(' ');
      const armory = c.missing.length
        ? ` data-open-url="${ARMORY_UTILITIES_URL}" data-tab-label="Armory · Utilities" tabindex="0" role="link" title="${armoryTitle}"`
        : '';
      return `<tr${cls ? ` class="${cls}"` : ''}${armory}><td><b>${esc(c.name)}</b> <span class="muted">· ${c.difficulty}</span></td>
        <td><span class="chip ${c.status === 'Planning' ? 'tq' : 'dim'}">${esc(c.status)}</span></td>
        <td class="num">${c.filled}/${c.total}</td><td>${when}</td><td class="fac-probs">${probs.join(' ') || `<span class="muted">${tr('sorun yok', 'no issues')}</span>`}</td></tr>`;
    }).join('');
    const hint = hasMissing
      ? tr('Önce gecikenler ve eşyası eksik olanlar · eşyası eksik satıra tıkla: Armory Utilities', 'Delayed and missing-item OCs first · click a missing-item row: Armory Utilities')
      : tr('Önce gecikenler ve eşyası eksik olanlar', 'Delayed and missing-item OCs first');
    return `<article class="glass card">
      <div class="card-head wrap"><h3>⏳ ${tr('Devam eden OC\'ler', 'Ongoing OCs')} <span class="muted">(${oc.crimes.length})</span></h3>
        <span class="muted">${hint}</span></div>
      ${oc.crimes.length ? `<div class="tbl-wrap"><table class="tbl compact">
        <thead><tr><th>${tr('Suç', 'Crime')}</th><th>${tr('Durum', 'Status')}</th><th class="num">${tr('Slot', 'Slots')}</th><th>${tr('Zaman', 'Time')}</th><th>${tr('Sorunlar', 'Issues')}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : `<div class="muted">${tr('Şu an devam eden OC yok.', 'No ongoing OCs right now.')}</div>`}
    </article>`;
  }

  const BOARDS = [
    ['activity', '⏱', ['En aktif 10', 'Top 10 most active'], ['Oynama süresi', 'Time played'], hms],
    ['gym', '🏋', ['En çok gym yapan 10', 'Top 10 bodybuilders'], ['Harcanan E', 'Energy spent'], n0],
    ['xanax', '💊', ['En çok Xanax alan 10', 'Top 10 Xanax users'], ['Xanax', 'Xanax'], n0],
    ['crimes', '🕵️', ['En çok suç işleyen 10', 'Top 10 criminals'], ['Suç', 'Crimes'], n0],
    ['blood', '🩸', ['En çok kan bağışlayan 10', 'Top 10 blood donors'], ['Torba', 'Bags filled'], n0],
    ['oc', '🎯', ['En çok OC yapan 10', 'Top 10 OC participants'], ['OC', 'OCs'], n0],
    ['idle', '💤', ['En az oynayan 10', '10 least active'], ['Oynama süresi', 'Time played'], hms],
  ];
  function reportCard() {
    const r = fac.rep;
    const head = (extra = '') => `<div class="card-head wrap"><h3>📊 ${tr('Üye performans raporu', 'Member performance report')}</h3>${extra}</div>`;
    if (!r) return `<article class="glass card">${head()}${fac.repErr ? errorBox(fac.repErr) : loadingBox()}</article>`;
    const j = r.job || {};
    const run = j.running;
    const pctDone = j.total ? Math.round((j.done / j.total) * 100) : 0;
    const range = r.range?.from ? `${dayLabel(r.range.from)} – ${dayLabel(r.range.to)}` : '';
    const periodToggle = `<div class="toggle" role="group" aria-label="${tr('Dönem', 'Period')}">
      <button type="button" data-fac-rep-days="7" class="${fac.repDays === 7 ? 'active' : ''}">7${tr('G', 'D')}</button>
      <button type="button" data-fac-rep-days="30" class="${fac.repDays === 30 ? 'active' : ''}">30${tr('G', 'D')}</button>
    </div>`;
    const btn = `<span class="fac-head-r">${periodToggle}${range ? `<span class="muted">${range}${r.range?.actualDays ? ` · ${r.range.actualDays}${tr('g', 'd')}` : ''}</span>` : ''}
      <button class="btn sm ghost" type="button" id="fac-rep-refresh" ${run ? 'disabled' : ''}>↻ ${tr('Yenile', 'Refresh')}</button></span>`;
    const progress = run ? `<div class="fac-progress"><div class="storage-bar"><i style="width:${pctDone}%;background:var(--tq)"></i></div>
      <small class="muted">${tr(`Üye istatistikleri çekiliyor: ${j.done}/${j.total} · dakikada ~40 istek (Torn sınırının altında)`, `Fetching member stats: ${j.done}/${j.total} · ~40 requests a minute (below Torn's limit)`)}</small></div>` : '';
    const err = j.error ? `<div class="alert danger">${esc(j.error)}</div>` : '';
    const table = ([key, icon, title, col, fmt]) => {
      const list = r.boards?.[key] || [];
      let note = '';
      if (key === 'gym') note = r.gymRange?.error ? esc(r.gymRange.error) : !r.gymRange?.from ? tr('Gym verisi her gün kaydedilir; fark yarından itibaren görünür.', 'Gym data is recorded daily; changes show from tomorrow.') : r.gymRange.days < fac.repDays ? tr(`Son ${r.gymRange.days} gün (${fac.repDays} günlük kayıt birikiyor)`, `Last ${r.gymRange.days} day${r.gymRange.days === 1 ? '' : 's'} (building ${fac.repDays}d history)`) : '';
      return `<div class="fac-board"><div class="fac-board-h">${icon} ${tr(...title)}</div>
        <table class="tbl compact"><thead><tr><th>${tr('İsim', 'Name')}</th><th class="num">${tr(...col)}</th></tr></thead>
        <tbody>${list.map((x) => `<tr><td>${nameBtn(x.id, x.name)}</td><td class="num mono">${fmt(x.value)}</td></tr>`).join('') || `<tr><td colspan="2" class="muted">${run ? tr('hazırlanıyor…', 'building…') : tr('veri yok', 'no data')}</td></tr>`}</tbody></table>
        ${note ? `<small class="muted">${note}</small>` : ''}</div>`;
    };
    return `<article class="glass card">${head(btn)}${progress}${err}
      <div class="fac-boards">${BOARDS.map(table).join('')}</div>
      <p class="muted sl-note">${tr(
        'Torn API\'deki kişisel istatistiklerin dönem farkı (Torn günlük kayıt tutar; 40 güne kadar saklanır). Gym enerjisi faction katkı listesinden gelir. Veriler yalnızca bu bilgisayarda saklanır.',
        'Change in personal stats over the chosen period from the Torn API (daily records kept up to 40 days). Gym Energy comes from the faction contributors list. Data stays on this computer.')}</p>
    </article>`;
  }

  /* ---------- Sekme 2: Aktivite Dashboard (/dashboard/activity) ---------- */
  function renderActivityTab() {
    if (!fac.act) return fac.actErr ? errorBox(fac.actErr) : loadingBox();
    const d = fac.act;
    const c = d.counts || {};
    const total = Math.max(1, c.total || 0);
    const hm = d.heatmap || { grid: [], maxAvg: 0, totalSamples: 0 };
    const dows = state.lang === 'en' ? DOW_EN : DOW_TR;

    const repById = new Map((fac.rep?.rows || []).map((r) => [r.id, r]));

    // Live distribution + stacked bar
    const dist = `<article class="glass card">
      <div class="card-head wrap">
        <h3>🟢 ${tr('Canlı Faction Aktivitesi', 'Live Faction Activity')}</h3>
        <span class="fac-head-r">
          <span class="chip green">● ${tr('Çevrimiçi', 'Online')}: ${c.online}</span>
          <span class="chip warn">● ${tr('Beklemede', 'Idle')}: ${c.idle}</span>
          <span class="chip dim">● ${tr('Çevrimdışı', 'Offline')}: ${c.offline}</span>
          <button class="btn sm ghost" type="button" id="fac-act-refresh">↻ ${tr('Yenile', 'Refresh')}</button>
        </span>
      </div>
      <div class="storage-bar fac-act-bar">
        <i style="width:${(c.online / total) * 100}%;background:var(--ok)" title="Online: ${c.online}"></i>
        <i style="width:${(c.idle / total) * 100}%;background:var(--warn)" title="Idle: ${c.idle}"></i>
        <i style="width:${(c.offline / total) * 100}%;background:var(--muted-2)" title="Offline: ${c.offline}"></i>
      </div>
      <div class="chip-row fac-state-chips">
        <span class="chip ok">✓ ${tr('Müsait', 'Okay')}: ${c.okay}</span>
        <span class="chip danger">🏥 ${tr('Hastane', 'Hospital')}: ${c.hospital}</span>
        <span class="chip blue">✈ ${tr('Uçakta', 'Traveling')}: ${c.traveling}</span>
        <span class="chip blue">🌍 ${tr('Yurt dışı', 'Abroad')}: ${c.abroad}</span>
        <span class="chip warn">⛓ ${tr('Hapis', 'Jail')}: ${c.jail}</span>
        <span class="chip tq">🕵️ ${tr('OC\'de', 'In OC')}: ${c.inOc}/${c.total}</span>
      </div>
    </article>`;

    // 7x24 UTC/TCT Activity Heatmap
    const hoursHead = Array.from({ length: 24 }, (_, h) => `<th class="mono">${String(h).padStart(2, '0')}</th>`).join('');
    const hmRows = hm.grid.map((row, dayIdx) => `<tr><th class="fac-hm-dow">${dows[dayIdx]}</th>${row.map((cell) => {
      const ratio = hm.maxAvg > 0 && cell.samples ? Math.min(1, cell.avgActive / hm.maxAvg) : 0;
      const lvl = !cell.samples ? 0 : ratio >= 0.75 ? 4 : ratio >= 0.5 ? 3 : ratio >= 0.25 ? 2 : 1;
      const tip = cell.samples
        ? `${dows[dayIdx]} ${String(cell.hour).padStart(2, '0')}:00 TCT · ${tr('Ort. çevrimiçi', 'Avg online')}: ${cell.avgOnline.toFixed(1)} · ${tr('Beklemede', 'Idle')}: ${cell.avgIdle.toFixed(1)} (${cell.samples} ${tr('örnek', 'samples')})`
        : `${dows[dayIdx]} ${String(cell.hour).padStart(2, '0')}:00 TCT · ${tr('henüz örnek yok', 'no sample yet')}`;
      return `<td class="fac-hm-cell lvl-${lvl}" title="${esc(tip)}"></td>`;
    }).join('')}</tr>`).join('');

    const hmMeta = [
      hm.peakHour ? `${tr('En yoğun saat', 'Peak hour')}: <b class="mono">${String(hm.peakHour.hour).padStart(2, '0')}:00 TCT</b> (${hm.peakHour.avg.toFixed(1)})` : null,
      hm.quietHour ? `${tr('En sakin saat', 'Quietest hour')}: <b class="mono">${String(hm.quietHour.hour).padStart(2, '0')}:00 TCT</b> (${hm.quietHour.avg.toFixed(1)})` : null,
      `${hm.totalSamples} ${tr('örnek kaydedildi', 'snapshots recorded')}`,
    ].filter(Boolean).join(' · ');

    const heatmapCard = `<article class="glass card">
      <div class="card-head wrap">
        <div><h3>🔥 ${tr('Saatlik Aktivite Isı Haritası (TCT)', 'Hourly Activity Heatmap (TCT)')}</h3>
          <span class="muted">${hmMeta}</span></div>
        <span class="sub-text">${tr('Uygulama açık kaldıkça her 15 dk\'da bir otomatik birikir', 'Builds automatically every 15 min while the app runs')}</span>
      </div>
      <div class="tbl-wrap"><table class="fac-hm"><thead><tr><th></th>${hoursHead}</tr></thead><tbody>${hmRows}</tbody></table></div>
    </article>`;

    // Side-by-side Member Comparison
    const members = d.members || [];
    const mA = members.find((m) => m.id === fac.cmpA) || members[0];
    const mB = members.find((m) => m.id === fac.cmpB) || members[1] || members[0];
    const rA = mA ? repById.get(mA.id) : null;
    const rB = mB ? repById.get(mB.id) : null;
    const cmpMetric = (label, a, b, fmt = n0) => {
      const aWin = a != null && b != null && a > b;
      const bWin = a != null && b != null && b > a;
      return `<tr><td>${label}</td><td class="num mono ${aWin ? 'pos' : ''}">${a != null ? fmt(a) : '—'}</td><td class="num mono ${bWin ? 'pos' : ''}">${b != null ? fmt(b) : '—'}</td></tr>`;
    };
    const cmpCard = members.length >= 2 ? `<article class="glass card">
      <div class="card-head wrap">
        <h3>⚖️ ${tr('Üye Karşılaştırma', 'Member Comparison')}</h3>
        <div class="fac-cmp-pick">
          <select id="fac-cmp-a">${members.map((m) => `<option value="${m.id}"${m.id === mA?.id ? ' selected' : ''}>${esc(m.name)} (Lv ${m.level})</option>`).join('')}</select>
          <span class="muted">vs</span>
          <select id="fac-cmp-b">${members.map((m) => `<option value="${m.id}"${m.id === mB?.id ? ' selected' : ''}>${esc(m.name)} (Lv ${m.level})</option>`).join('')}</select>
        </div>
      </div>
      <div class="tbl-wrap"><table class="tbl compact">
        <thead><tr><th>${tr('Metrik', 'Metric')}</th><th class="num">${mA ? nameBtn(mA.id, mA.name) : '—'}</th><th class="num">${mB ? nameBtn(mB.id, mB.name) : '—'}</th></tr></thead>
        <tbody>
          ${cmpMetric(tr('Seviye', 'Level'), mA?.level, mB?.level)}
          ${cmpMetric(tr('Faction günü', 'Days in faction'), mA?.days, mB?.days)}
          ${cmpMetric(`${tr('Oynama süresi', 'Time played')} (${fac.repDays}${tr('g', 'd')})`, rA?.activity, rB?.activity, hms)}
          ${cmpMetric(`Xanax (${fac.repDays}${tr('g', 'd')})`, rA?.xanax, rB?.xanax)}
          ${cmpMetric(`Gym E (${fac.repDays}${tr('g', 'd')})`, rA?.gym, rB?.gym)}
          ${cmpMetric(`${tr('Suç', 'Crimes')} (${fac.repDays}${tr('g', 'd')})`, rA?.crimes, rB?.crimes)}
          ${cmpMetric(`OC (${fac.repDays}${tr('g', 'd')})`, rA?.oc, rB?.oc)}
        </tbody>
      </table></div>
    </article>` : '';

    // Filterable full member roster
    const q = fac.actQ.trim().toLowerCase();
    let list = members.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.position.toLowerCase().includes(q)) return false;
      if (fac.actFilter === 'online' && m.lastStatus !== 'Online') return false;
      if (fac.actFilter === 'idle' && m.lastStatus !== 'Idle') return false;
      if (fac.actFilter === 'offline' && m.lastStatus !== 'Offline') return false;
      if (fac.actFilter === 'away' && m.state === 'Okay') return false;
      return true;
    });
    const sorters = {
      last: (a, b) => b.last - a.last,
      level: (a, b) => b.level - a.level,
      days: (a, b) => b.days - a.days,
      activity: (a, b) => (repById.get(b.id)?.activity ?? -1) - (repById.get(a.id)?.activity ?? -1),
      xanax: (a, b) => (repById.get(b.id)?.xanax ?? -1) - (repById.get(a.id)?.xanax ?? -1),
      gym: (a, b) => (repById.get(b.id)?.gym ?? -1) - (repById.get(a.id)?.gym ?? -1),
    };
    list.sort(sorters[fac.actSort] || sorters.last);
    const hasStats = repById.size > 0;
    const opt = (v, label, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;

    const rosterRows = list.map((m) => {
      const r = repById.get(m.id);
      return `<tr>
        <td>${nameBtn(m.id, m.name)}</td>
        <td class="num mono">${m.level}</td>
        <td>${esc(m.position)}</td>
        <td><i class="fac-dot ${m.lastStatus === 'Online' ? 'on' : m.lastStatus === 'Idle' ? 'idle' : ''}"></i>${esc(m.lastRel)}</td>
        <td>${m.state && m.state !== 'Okay' ? `<span class="chip ${m.state === 'Hospital' || m.state === 'Jail' ? 'danger' : 'blue'}">${stateText(m.state)}</span>` : `<span class="muted">${stateText('Okay')}</span>`}</td>
        <td class="num mono">${m.days}</td>
        <td>${m.inOc ? `<span class="chip green">OC</span>` : `<span class="chip dim">—</span>`}</td>
        ${hasStats ? `<td class="num mono">${r?.activity != null ? hms(r.activity) : '—'}</td><td class="num mono">${r?.xanax != null ? n0(r.xanax) : '—'}</td><td class="num mono">${r?.gym != null ? n0(r.gym) : '—'}</td>` : ''}
      </tr>`;
    }).join('');

    const rosterCard = `<article class="glass card">
      <div class="card-head wrap">
        <h3>👥 ${tr('Tüm Üyeler', 'All Members')} <span class="chip">${list.length} / ${members.length}</span></h3>
        <div class="fac-act-tools">
          <input class="input" id="fac-act-q" type="search" placeholder="${tr('Üye veya pozisyon ara…', 'Search member or position…')}" value="${esc(fac.actQ)}">
          <div class="toggle" role="group">
            <button type="button" data-fac-af="all" class="${fac.actFilter === 'all' ? 'active' : ''}">${tr('Hepsi', 'All')}</button>
            <button type="button" data-fac-af="online" class="${fac.actFilter === 'online' ? 'active' : ''}">${tr('Çevrimiçi', 'Online')}</button>
            <button type="button" data-fac-af="idle" class="${fac.actFilter === 'idle' ? 'active' : ''}">${tr('Beklemede', 'Idle')}</button>
            <button type="button" data-fac-af="offline" class="${fac.actFilter === 'offline' ? 'active' : ''}">${tr('Çevrimdışı', 'Offline')}</button>
            <button type="button" data-fac-af="away" class="${fac.actFilter === 'away' ? 'active' : ''}">${tr('Müsait değil', 'Away')}</button>
          </div>
          <select id="fac-act-sort">
            ${opt('last', tr('Son görülme', 'Last seen'), fac.actSort)}
            ${opt('level', tr('Seviye', 'Level'), fac.actSort)}
            ${opt('days', tr('Faction günü', 'Days'), fac.actSort)}
            ${hasStats ? opt('activity', `${tr('Oynama süresi', 'Time played')} (${fac.repDays}d)`, fac.actSort) : ''}
            ${hasStats ? opt('xanax', `Xanax (${fac.repDays}d)`, fac.actSort) : ''}
            ${hasStats ? opt('gym', `Gym E (${fac.repDays}d)`, fac.actSort) : ''}
          </select>
        </div>
      </div>
      <div class="tbl-wrap"><table class="tbl compact">
        <thead><tr>
          <th>${tr('Üye', 'Member')}</th><th class="num">Lv</th><th>${tr('Pozisyon', 'Position')}</th>
          <th>${tr('Son görülme', 'Last seen')}</th><th>${tr('Durum', 'Status')}</th><th class="num">${tr('Gün', 'Days')}</th><th>OC</th>
          ${hasStats ? `<th class="num">${tr('Süre', 'Played')} (${fac.repDays}d)</th><th class="num">Xanax</th><th class="num">Gym E</th>` : ''}
        </tr></thead>
        <tbody>${rosterRows || `<tr><td colspan="${hasStats ? 10 : 7}" class="muted">${tr('Eşleşen üye yok.', 'No matching members.')}</td></tr>`}</tbody>
      </table></div>
    </article>`;

    return dist + heatmapCard + cmpCard + rosterCard;
  }

  /* ---------- Sekme 3: Armory Geçmişi ---------- */
  function renderArmoryTab() {
    if (!fac.arm) return fac.armErr ? errorBox(fac.armErr) : loadingBox();
    const a = fac.arm;
    if (!a.allowed) {
      return `<article class="glass card fac-lock">
        <div class="card-head wrap"><h3>🔒 ${tr('Armory Geçmişi', 'Armory History')}</h3>
          <button class="btn sm ghost" type="button" data-open-url="${ARMORY_UTILITIES_URL}" data-tab-label="Armory · Utilities">🧰 ${tr('Armory Utilities', 'Armory Utilities')} ↗</button></div>
        <p>${esc(a.error || tr('Faction API Access izni gerekiyor.', 'Faction API Access permission required.'))}</p>
      </article>`;
    }
    const q = fac.armQ.trim().toLowerCase();
    const list = (a.entries || []).filter((e) => {
      if (fac.armCat !== 'all' && e.category !== fac.armCat) return false;
      if (q && !e.text.toLowerCase().includes(q)) return false;
      return true;
    });
    const catChip = (cat) => {
      const cls = { used: 'blue', loaned: 'warn', returned: 'green', filled: 'tq', deposited: 'green', retrieved: 'orange', other: 'dim' }[cat] || 'dim';
      return `<span class="chip ${cls}">${tr(...(ARM_LABELS[cat] || [cat, cat]))}</span>`;
    };
    const topUsers = (a.topActors || []).length
      ? `<div class="chip-row fac-arm-top">${a.topActors.map((u) => `<span class="chip">${u.id ? nameBtn(u.id, u.name) : esc(u.name)} · <b class="mono">${u.total}</b></span>`).join('')}</div>`
      : '';

    return `<article class="glass card">
      <div class="card-head wrap">
        <div><h3>🧰 ${tr('Faction Armory Geçmişi', 'Faction Armory History')} <span class="chip">${list.length}</span></h3>
          <span class="muted">${tr('Son 100 armory hareketi · kim ne kullandı, ödünç aldı veya doldurdu', 'Last 100 armory events · who used, loaned, returned or filled items')}</span></div>
        <div class="fac-head-r">
          <button class="btn sm ghost" type="button" id="fac-arm-refresh">↻ ${tr('Yenile', 'Refresh')}</button>
          <button class="btn sm ghost" type="button" data-open-url="${ARMORY_UTILITIES_URL}" data-tab-label="Armory · Utilities">${tr('Armory Utilities', 'Armory Utilities')} ↗</button>
        </div>
      </div>
      ${topUsers}
      <div class="fac-act-tools">
        <input class="input" id="fac-arm-q" type="search" placeholder="${tr('Oyuncu veya eşya ara…', 'Search player or item…')}" value="${esc(fac.armQ)}">
        <div class="toggle" role="group">
          ${['all', 'used', 'loaned', 'returned', 'filled', 'deposited', 'retrieved'].map((k) => `<button type="button" data-fac-arm-cat="${k}" class="${fac.armCat === k ? 'active' : ''}">${tr(...ARM_LABELS[k])}${k !== 'all' && a.counts?.[k] ? ` (${a.counts[k]})` : ''}</button>`).join('')}
        </div>
      </div>
      ${list.length ? `<div class="tbl-wrap"><table class="tbl compact">
        <thead><tr><th>${tr('Zaman (TCT)', 'Time (TCT)')}</th><th>${tr('İşlem', 'Action')}</th><th>${tr('Detay', 'Event')}</th></tr></thead>
        <tbody>${list.map((e) => `<tr>
          <td class="mono sub-text">${tsFmt(e.timestamp)}</td>
          <td>${catChip(e.category)}</td>
          <td class="fac-arm-txt">${esc(e.text)}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : emptyBox(tr('Kayıt yok', 'No armory entries'), tr('Filtreye uyan armory hareketi bulunamadı.', 'No matching armory events found.'))}
    </article>`;
  }

  /* ---------- Sekme 4: Chain Raporları ---------- */
  function renderChainsTab() {
    if (!fac.ch) return fac.chErr ? errorBox(fac.chErr) : loadingBox();
    const cur = fac.ch.current;
    const list = fac.ch.chains || [];
    const activeBanner = cur && Number(cur.current) > 0 ? `<article class="glass card">
      <div class="card-head wrap"><h3>🔥 ${tr('Aktif Chain', 'Active Chain')}</h3>
        <button class="btn sm ghost" type="button" data-open-url="${CHAIN_URL}" data-tab-label="Faction Chain">${tr('Torn\'da aç', 'Open in Torn')} ↗</button></div>
      <div class="grid kpis small">
        ${kpi(tr('Vuruş', 'Hits'), `${n0(cur.current)} / ${n0(cur.max)}`, '', 'tq')}
        ${kpi(tr('Zaman aşımı', 'Timeout'), cur.timeout > 0 ? human(cur.timeout) : '—', cur.timeout > 0 && cur.timeout < 90 ? tr('Dikkat! Chain düşebilir', 'Warning! Chain expiring soon') : '', cur.timeout > 0 && cur.timeout < 90 ? 'neg' : '')}
        ${kpi(tr('Çarpan', 'Modifier'), cur.modifier != null ? `×${Number(cur.modifier).toFixed(2)}` : '—')}
        ${kpi(tr('Cooldown', 'Cooldown'), cur.cooldown > 0 ? human(cur.cooldown) : tr('Yok', 'None'))}
      </div>
    </article>` : '';

    const rows = list.map((c) => `<tr>
      <td class="mono"><b>${n0(c.chain)}</b>${c.milestone ? ` <span class="chip tq">${compact(c.milestone, 0)}</span>` : ''}</td>
      <td class="num mono pos">${n0(Math.round(c.respect))}</td>
      <td class="num mono">${c.respectPerHit.toFixed(2)}</td>
      <td class="mono sub-text">${c.duration ? hms(c.duration) : '—'}</td>
      <td class="mono sub-text">${tsFmt(c.start)}</td>
      <td class="mono sub-text">${tsFmt(c.end)}</td>
    </tr>`).join('');

    return `${activeBanner}<article class="glass card">
      <div class="card-head wrap">
        <div><h3>⛓ ${tr('Geçmiş Chain Raporları', 'Past Chain Reports')} <span class="chip">${list.length}</span></h3>
          <span class="muted">${tr('Son 25 chain · bonus eşikleri, respect ve hit başına respect', 'Last 25 chains · bonus milestones, total respect and respect per hit')}</span></div>
        <div class="fac-head-r">
          <button class="btn sm ghost" type="button" id="fac-ch-refresh">↻ ${tr('Yenile', 'Refresh')}</button>
          <button class="btn sm ghost" type="button" data-open-url="${CHAIN_URL}" data-tab-label="Faction Chain">${tr('Chain sayfası', 'Chain page')} ↗</button>
        </div>
      </div>
      ${list.length ? `<div class="tbl-wrap"><table class="tbl compact">
        <thead><tr>
          <th>${tr('Chain', 'Chain')}</th><th class="num">Respect</th><th class="num">${tr('Hit başı', 'Resp/hit')}</th>
          <th>${tr('Süre', 'Duration')}</th><th>${tr('Başlangıç (TCT)', 'Start (TCT)')}</th><th>${tr('Bitiş (TCT)', 'End (TCT)')}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : emptyBox(tr('Chain kaydı yok', 'No chains recorded'), tr('Bu faction için geçmiş chain verisi bulunamadı.', 'No past chain history found for this faction.'))}
    </article>`;
  }

  /* ---------- Sekme 5: Yükseltme Simülatörü ---------- */
  function renderUpgradesTab() {
    if (!fac.upg) return fac.upgErr ? errorBox(fac.upgErr) : loadingBox();
    const u = fac.upg;
    const avail = fac.upgRespectOverride != null ? fac.upgRespectOverride : (u.faction?.respect || 0);
    const sim = LRXFactionTools.simulateUpgrades(u.tree || [], fac.upgSel || {}, avail);
    const baseSim = LRXFactionTools.simulateUpgrades(u.tree || [], u.currentLevels || {}, avail);
    const deltaCost = sim.totalRespectCost - baseSim.totalRespectCost;

    const kpis = `<div class="grid kpis small" id="fac-upg-kpis">
      ${kpi(tr('Faction Respect', 'Faction Respect'), n0(avail), u.hasUpgradesAccess ? tr('Mevcut yükseltmeler yüklendi', 'Current upgrades loaded') : tr('Simülasyon modu (respect düzenlenebilir)', 'Sandbox mode (editable respect)'))}
      ${kpi(tr('Simülasyon Maliyeti', 'Simulated Cost'), n0(sim.totalRespectCost), deltaCost !== 0 ? `${deltaCost > 0 ? '+' : ''}${n0(deltaCost)} ${tr('mevcuda göre', 'vs current')}` : tr('mevcutla aynı', 'matches current'), 'tq')}
      ${kpi(tr('Kalan / Açık', 'Remaining / Deficit'), `${sim.remainingRespect >= 0 ? '+' : ''}${n0(sim.remainingRespect)}`, sim.affordable ? tr('Bütçe yeterli ✓', 'Within respect budget ✓') : tr('Respect yetersiz', 'Over respect budget'), sim.affordable ? 'pos' : 'neg')}
      ${kpi(tr('Aktif Dal', 'Active Branches'), String(sim.activeNonCoreCount), tr('Core 1× · diğerleri 1×→32×', 'Core 1× · others 1×→32×'))}
    </div>`;

    const branchTabs = `<div class="fac-upg-bar">
      <div class="toggle" role="group">
        <button type="button" data-fac-ub="all" class="${fac.upgBranch === 'all' ? 'active' : ''}">${tr('Tüm Dallar', 'All Branches')}</button>
        ${sim.breakdown.map((b) => `<button type="button" data-fac-ub="${esc(b.branch)}" class="${fac.upgBranch === b.branch ? 'active' : ''}">${esc(b.branch)}${b.respectCost ? ` (${b.multiplier}×)` : ''}</button>`).join('')}
      </div>
      <div class="fac-head-r">
        <label class="fac-upg-resp"><span>Respect</span><input class="input mono" id="fac-upg-respect" type="number" min="0" step="1000" value="${avail}"></label>
        <button class="btn sm ghost" type="button" id="fac-upg-reset">${tr('Mevcuda dön', 'Reset')}</button>
        <button class="btn sm ghost" type="button" id="fac-upg-clear">${tr('Sıfırla', 'Clear')}</button>
        <button class="btn sm ghost" type="button" data-open-url="${UPGRADES_URL}" data-tab-label="Faction Upgrades">${tr('Torn\'da aç', 'Open in Torn')} ↗</button>
      </div>
    </div>`;

    const shown = sim.breakdown.filter((b) => fac.upgBranch === 'all' || b.branch === fac.upgBranch);
    const branchCards = shown.map((b) => `<article class="glass card fac-upg-branch" data-fac-branch="${esc(b.branch)}">
      <div class="card-head wrap">
        <div><h3>${esc(b.branch)} <span data-fac-bchip>${b.isCore ? '<span class="chip dim">Core · 1×</span>' : b.baseCost > 0 ? `<span class="chip tq">#${b.order} · ${b.multiplier}×</span>` : '<span class="chip dim">—</span>'}</span></h3>
          <span class="muted" data-fac-bcost>${tr('Taban', 'Base')}: ${n0(b.baseCost)} · ${tr('Toplam', 'Total')}: <b class="mono">${n0(b.respectCost)}</b> respect</span></div>
      </div>
      <div class="fac-upg-grid">${b.items.map((it) => {
        const curLv = u.currentLevels?.[it.key] || 0;
        const diff = it.level - curLv;
        return `<div class="fac-upg-item${it.level > 0 ? ' on' : ''}" data-fac-item="${esc(it.key)}">
          <div class="fac-upg-top">
            <b>${esc(it.name)}</b>
            <span class="mono" data-fac-lvl>${it.level} / ${it.maxLevel}${diff !== 0 ? ` <small class="${diff > 0 ? 'pos' : 'neg'}">(${diff > 0 ? '+' : ''}${diff})</small>` : ''}</span>
          </div>
          <div class="fac-upg-ctrl">
            <input type="range" min="0" max="${it.maxLevel}" value="${it.level}" data-fac-upg="${esc(it.key)}" aria-label="${esc(it.name)}">
            <span class="mono sub-text" data-fac-icost>${n0(it.baseCost * b.multiplier)}</span>
          </div>
          ${it.ability ? `<small class="sub-text">${esc(it.ability)}</small>` : ''}
        </div>`;
      }).join('')}</div>
    </article>`).join('');

    return `${kpis}<article class="glass card">${branchTabs}</article>${branchCards}`;
  }

  const cssEsc = (s) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'));

  // Update Upgrade Simulator numbers in-place while dragging a range slider so pointer capture never drops
  function patchUpgradeMetrics() {
    const u = fac.upg;
    const kpiBox = $('#fac-upg-kpis');
    if (!u || !kpiBox) return false;
    const avail = fac.upgRespectOverride != null ? fac.upgRespectOverride : (u.faction?.respect || 0);
    const sim = LRXFactionTools.simulateUpgrades(u.tree || [], fac.upgSel || {}, avail);
    const baseSim = LRXFactionTools.simulateUpgrades(u.tree || [], u.currentLevels || {}, avail);
    const deltaCost = sim.totalRespectCost - baseSim.totalRespectCost;

    kpiBox.innerHTML = [
      kpi(tr('Faction Respect', 'Faction Respect'), n0(avail), u.hasUpgradesAccess ? tr('Mevcut yükseltmeler yüklendi', 'Current upgrades loaded') : tr('Simülasyon modu (respect düzenlenebilir)', 'Sandbox mode (editable respect)')),
      kpi(tr('Simülasyon Maliyeti', 'Simulated Cost'), n0(sim.totalRespectCost), deltaCost !== 0 ? `${deltaCost > 0 ? '+' : ''}${n0(deltaCost)} ${tr('mevcuda göre', 'vs current')}` : tr('mevcutla aynı', 'matches current'), 'tq'),
      kpi(tr('Kalan / Açık', 'Remaining / Deficit'), `${sim.remainingRespect >= 0 ? '+' : ''}${n0(sim.remainingRespect)}`, sim.affordable ? tr('Bütçe yeterli ✓', 'Within respect budget ✓') : tr('Respect yetersiz', 'Over respect budget'), sim.affordable ? 'pos' : 'neg'),
      kpi(tr('Aktif Dal', 'Active Branches'), String(sim.activeNonCoreCount), tr('Core 1× · diğerleri 1×→32×', 'Core 1× · others 1×→32×')),
    ].join('');

    const host = $('#faction-body');
    for (const b of sim.breakdown) {
      const tabBtn = host?.querySelector(`[data-fac-ub="${cssEsc(b.branch)}"]`);
      if (tabBtn) tabBtn.textContent = `${b.branch}${b.respectCost ? ` (${b.multiplier}×)` : ''}`;
      const card = host?.querySelector(`[data-fac-branch="${cssEsc(b.branch)}"]`);
      if (!card) continue;
      const chip = card.querySelector('[data-fac-bchip]');
      if (chip) chip.innerHTML = b.isCore ? '<span class="chip dim">Core · 1×</span>' : b.baseCost > 0 ? `<span class="chip tq">#${b.order} · ${b.multiplier}×</span>` : '<span class="chip dim">—</span>';
      const bcost = card.querySelector('[data-fac-bcost]');
      if (bcost) bcost.innerHTML = `${tr('Taban', 'Base')}: ${n0(b.baseCost)} · ${tr('Toplam', 'Total')}: <b class="mono">${n0(b.respectCost)}</b> respect`;
      for (const it of b.items) {
        const box = card.querySelector(`[data-fac-item="${cssEsc(it.key)}"]`);
        if (!box) continue;
        box.classList.toggle('on', it.level > 0);
        const curLv = u.currentLevels?.[it.key] || 0;
        const diff = it.level - curLv;
        const lvlEl = box.querySelector('[data-fac-lvl]');
        if (lvlEl) lvlEl.innerHTML = `${it.level} / ${it.maxLevel}${diff !== 0 ? ` <small class="${diff > 0 ? 'pos' : 'neg'}">(${diff > 0 ? '+' : ''}${diff})</small>` : ''}`;
        const icost = box.querySelector('[data-fac-icost]');
        if (icost) icost.textContent = n0(it.baseCost * b.multiplier);
      }
    }
    return true;
  }

  function preserveFocus(root, fn) {
    const ae = document.activeElement;
    const saved = ae && typeof root.contains === 'function' && root.contains(ae) ? {
      id: ae.id || null,
      upg: ae.dataset?.facUpg || null,
      start: typeof ae.selectionStart === 'number' ? ae.selectionStart : null,
      end: typeof ae.selectionEnd === 'number' ? ae.selectionEnd : null,
    } : null;
    fn();
    if (!saved || typeof root.querySelector !== 'function') return;
    const next = saved.id ? root.querySelector('#' + cssEsc(saved.id))
      : saved.upg ? root.querySelector(`[data-fac-upg="${cssEsc(saved.upg)}"]`)
      : null;
    if (!next) return;
    next.focus?.({ preventScroll: true });
    if (saved.start != null && typeof next.setSelectionRange === 'function') {
      try { next.setSelectionRange(saved.start, saved.end ?? saved.start); } catch {}
    }
  }

  /* ---------- Ana Render ---------- */
  function render() {
    const el = $('#faction-body'); if (!el) return;
    if (state.view !== 'faction') return;
    const d = fac.d;
    if (!d) { el.innerHTML = fac.err ? errorBox(fac.err) : loadingBox(); return; }
    const a = d.access || {};
    if (a.error) { el.innerHTML = `${myOcCard(d.myOc)}<div class="alert danger">${esc(a.error)}</div>`; return; }
    const role = a.role ? tr(...ROLE_TR[a.role]) : a.allowed ? tr('Yetkili (Organised Crimes)', 'Authorized (Organised Crimes)') : tr('Üye', 'Member');
    const oc = d.oc && !d.oc.error ? d.oc : null;
    const delayed = oc ? oc.crimes.filter((c) => c.delayed).length : null;
    const kpis = a.inFaction ? `<div class="grid kpis">
      ${kpi('<span lang="en">Faction</span>', `${esc(a.faction?.name || '')} <small class="muted">[${esc(a.faction?.tag || '')}]</small>`, esc(a.position || ''))}
      ${kpi(tr('Erişim', 'Access'), role, '', a.allowed ? 'tq-text' : '')}
      ${oc ? kpi(tr('OC\'de', 'In an OC'), `${oc.totals.inOc} <small class="muted">/ ${oc.totals.members}</small>`, tr(`${oc.notInOc.length} üye OC dışında`, `${oc.notInOc.length} not in an OC`)) : kpi(tr('Üye sayısı', 'Members'), n0(a.members || 0))}
      ${oc ? kpi(tr('Geciken OC', 'Delayed OCs'), String(delayed), tr(`${oc.crimes.length} devam eden OC`, `${oc.crimes.length} ongoing`), delayed ? 'neg' : '') : ''}
    </div>` : '';

    const tab = activeTab();
    const tabs = visibleTabs();
    const tabBar = a.inFaction && tabs.length > 1
      ? `<nav class="set-tabs fac-tabs" role="tablist" aria-label="Faction">${tabs.map(([id, icon, label]) => `<button type="button" class="set-tab${id === tab ? ' active' : ''}" role="tab" aria-selected="${id === tab}" data-fac-tab="${id}">${icon} <span>${label}</span></button>`).join('')}</nav>`
      : '';

    let content = '';
    if (tab === 'oc') {
      content = myOcCard(d.myOc)
        + (!a.allowed ? lockedCard(a)
          : d.oc?.error ? `<div class="alert danger">${esc(d.oc.error)}</div>`
            : `${notInOcCard(oc)}${crimesCard(oc)}${reportCard()}`);
    } else if (tab === 'activity') content = renderActivityTab();
    else if (tab === 'armory') content = renderArmoryTab();
    else if (tab === 'chains') content = renderChainsTab();
    else if (tab === 'upgrades') content = renderUpgradesTab();

    preserveFocus(el, () => { el.innerHTML = kpis + tabBar + content; });
  }

  /* ---------- Olaylar ---------- */
  const host = $('#faction-body');
  host?.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-fac-tab]');
    if (t) {
      fac.tab = t.dataset.facTab;
      lsSet('tt.fac.tab', fac.tab);
      render();
      await loadTabData(fac.tab);
      return;
    }
    if (e.target.closest('#fac-rep-refresh')) { await fetchReport(true); render(); return; }
    const rd = e.target.closest('[data-fac-rep-days]');
    if (rd) { fac.repDays = Number(rd.dataset.facRepDays) === 30 ? 30 : 7; lsSet('tt.fac.repDays', String(fac.repDays)); await fetchReport(false); render(); return; }
    if (e.target.closest('#fac-act-refresh')) { await fetchActivity(true); render(); return; }
    if (e.target.closest('#fac-arm-refresh')) { await fetchArmory(true); render(); return; }
    if (e.target.closest('#fac-ch-refresh')) { await fetchChains(true); render(); return; }
    const af = e.target.closest('[data-fac-af]');
    if (af) { fac.actFilter = af.dataset.facAf; render(); return; }
    const ac = e.target.closest('[data-fac-arm-cat]');
    if (ac) { fac.armCat = ac.dataset.facArmCat; render(); return; }
    const ub = e.target.closest('[data-fac-ub]');
    if (ub) { fac.upgBranch = ub.dataset.facUb; render(); return; }
    if (e.target.closest('#fac-upg-reset')) { fac.upgSel = { ...(fac.upg?.currentLevels || {}) }; fac.upgRespectOverride = null; render(); return; }
    if (e.target.closest('#fac-upg-clear')) { fac.upgSel = {}; render(); return; }
  });
  host?.addEventListener('input', (e) => {
    if (e.target.id === 'fac-act-q') { fac.actQ = e.target.value; render(); return; }
    if (e.target.id === 'fac-arm-q') { fac.armQ = e.target.value; render(); return; }
    if (e.target.id === 'fac-upg-respect') {
      fac.upgRespectOverride = Math.max(0, Number(e.target.value) || 0);
      if (!patchUpgradeMetrics()) render();
      return;
    }
    const up = e.target.closest('[data-fac-upg]');
    if (up) {
      fac.upgSel ||= {};
      fac.upgSel[up.dataset.facUpg] = Number(up.value) || 0;
      if (!patchUpgradeMetrics()) render();
    }
  });
  host?.addEventListener('change', (e) => {
    if (e.target.id === 'fac-act-sort') { fac.actSort = e.target.value; render(); }
    else if (e.target.id === 'fac-cmp-a') { fac.cmpA = Number(e.target.value) || 0; render(); }
    else if (e.target.id === 'fac-cmp-b') { fac.cmpB = Number(e.target.value) || 0; render(); }
  });
  host?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('tr.fac-armory-row[data-open-url]');
    if (!row) return;
    e.preventDefault();
    openInTab(row.dataset.openUrl, { activate: true, label: row.dataset.tabLabel || null, reuse: true });
  });

  // Sayfa açıkken dakikada bir yeniden çiz (geri sayımlar), 2 dakikada bir veriyi tazele
  setInterval(() => { if (state.view === 'faction' && trackerVisible() && activeTab() === 'oc') render(); }, 60_000);
  setInterval(() => { if (state.view === 'faction' && trackerVisible()) loadFaction(); }, 2 * 60_000);

  Object.assign(EXTRA_LOADERS, { faction: loadFaction });
  FEATURE_HOOKS.push(() => { if (state.view === 'faction') render(); });
  const prevLang = window.onLangChanged;
  window.onLangChanged = () => { prevLang?.(); if (state.view === 'faction') render(); };
  window.lrxFaction = fac;
  applyLang();
  applyFeatures();
})();
