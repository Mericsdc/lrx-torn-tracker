/* =========================================================
   LRX Faction sayfası (events.js'ten sonra yüklenir)
   - Herkes: kendi OC'si (rol, eşya, planlama) ve OC bildirimleri
   - Lider, eş lider ve liderin "Organised Crimes" yetkisi verdiği pozisyonlar:
     OC'ye girmeyen üyeler, geciken / sorunlu OC'ler, haftalık üye raporu
   Yetkiyi Torn verir (oyun içindeki pozisyon izinleri); uygulama ayrı bir liste tutmaz.
   Torn kuralları: veriler yalnızca Torn API'den gelir; Torn sayfası okunmaz, hiçbir şeye tıklanmaz.
   ========================================================= */
(() => {
  Object.assign(I18N, { 'nav.faction': ['Faction', 'Faction'] });
  Object.assign(VIEW_META, {
    faction: { tr: ['Faction', 'Organized Crime takibi ve haftalık üye raporu'], en: ['Faction', 'Organized Crime tracking and weekly member report'] },
  });

  const T = 'https://www.torn.com/';
  const OC_URL = T + 'factions.php?step=your#/tab=crimes';
  const fac = { d: null, err: null, rep: null, repErr: null, repTimer: null };
  const nowS = () => Math.floor(nowTct() / 1000);
  const profile = (id) => `${T}profiles.php?XID=${id}`;
  const nameBtn = (id, name) => `<a class="fac-name" href="${profile(id)}">${esc(name)}</a>`; // torn.com bağlantıları uygulama içi sekmede açılır
  const hms = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 3600)}${tr('sa', 'h')} ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}${tr('dk', 'm')} ${String(s % 60).padStart(2, '0')}${tr('sn', 's')}`; };
  const dayLabel = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');
  const STATE_TR = { Traveling: ['uçakta', 'Traveling'], Abroad: ['yurt dışında', 'Abroad'], Hospital: ['hastanede', 'In Hospital'], Jail: ['hapiste', 'In Jail'], Federal: ['federal hapiste', 'In Federal Jail'], Okay: ['müsait', 'Okay'] };
  const stateText = (s) => { const t = STATE_TR[s]; return t ? tr(t[0], t[1]) : esc(s || ''); };
  const ROLE_TR = { leader: ['Lider', 'Leader'], 'co-leader': ['Eş lider', 'Co-leader'] };

  /* ---------- Veri ---------- */
  async function fetchFaction(force = false) {
    try { fac.d = await api(`/api/faction${force ? '?force=1' : ''}`); fac.err = null; }
    catch (e) { fac.err = e; }
    checkOcNotify();
    return fac.d;
  }
  async function fetchReport(start = false) {
    try { fac.rep = await api('/api/faction/report', start ? { method: 'POST' } : {}); fac.repErr = null; }
    catch (e) { fac.repErr = e; }
    // Rapor hazırlanırken sayfa açıksa 4 sn'de bir ilerlemeyi göster
    clearTimeout(fac.repTimer);
    if (fac.rep?.job?.running && state.view === 'faction') fac.repTimer = setTimeout(() => fetchReport().then(render), 4000);
  }
  async function loadFaction(force) {
    const el = $('#faction-body');
    if (!fac.d) el.innerHTML = loadingBox();
    await fetchFaction(force);
    render();
    if (fac.d?.access?.allowed) { await fetchReport(); render(); }
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
          tr(`${my.crime.name} · ${my.slot.role}: ${my.slot.item.name} gerekiyor. Yoksa OC gecikir.`, `${my.crime.name} · ${my.slot.role}: needs ${my.slot.item.name}. The OC will be delayed without it.`), OC_URL);
      }
    }
    // Lider / yetkili: geciken ya da eşyası eksik OC'ler
    if (feat('notify.factionOc') && d.access?.allowed && d.oc?.crimes) {
      for (const c of d.oc.crimes) {
        const probs = [...c.missing.map((m) => `${m.name}: ${m.item}`), ...c.away.map((a) => `${a.name}: ${stateText(a.state)}`)];
        if (!c.delayed && !c.missing.length) continue;
        notifyOnce(`lrx.foc.${c.id}.${c.missing.map((m) => m.id).join('-')}.${c.delayed ? 'd' : ''}`,
          `⏳ ${c.delayed ? tr('OC gecikiyor', 'OC delayed') : tr('OC eşyası eksik', 'OC item missing')}: ${c.name}`,
          probs.join(' · ') || tr('Planlama bitti ama OC başlamadı.', 'Planning is done but the OC has not started.'), OC_URL);
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

  /* ---------- Görünüm ---------- */
  function myOcCard(my) {
    const head = `<div class="card-head wrap"><h3>🕵️ ${tr('Senin OC\'n', 'Your OC')}</h3>
      <button class="btn sm ghost" type="button" data-open-url="${OC_URL}" data-tab-label="Organized Crimes">${tr('Torn\'da OC sayfası', 'OC page in Torn')} ↗</button></div>`;
    if (!my) return `<article class="glass card">${head}${loadingBox()}</article>`;
    if (my.error) return `<article class="glass card">${head}<div class="alert danger">${esc(my.error)}</div></article>`;
    if (!my.inOc) return `<article class="glass card">${head}<div class="fac-line"><span class="chip warn">${tr('OC\'de değilsin', 'Not in an OC')}</span> <span class="muted">${tr('Torn\'daki OC sekmesinden boş bir slota katılabilirsin.', 'You can join an open slot on the OC tab in Torn.')}</span></div></article>`;
    const c = my.crime, s = my.slot;
    const left = c.readyAt ? c.readyAt - nowS() : null;
    const item = s?.item ? (s.item.ok
      ? `<span class="chip green">✓ ${esc(s.item.name)}</span>`
      : `<span class="chip danger">✗ ${esc(s.item.name)} ${tr('eksik', 'missing')}</span>`) : `<span class="muted">${tr('eşya gerekmiyor', 'no item needed')}</span>`;
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
    const rows = oc.crimes.map((c) => {
      const probs = [
        ...c.missing.map((m) => `<span class="chip danger">🧰 ${esc(m.name)}: ${esc(m.item)}</span>`),
        ...c.away.map((a) => `<span class="chip blue">${esc(a.name)}: ${stateText(a.state)}${a.until ? ` · ${human(a.until - now)}` : ''}</span>`),
        ...(c.open ? [`<span class="chip warn">${c.open} ${tr('boş slot', c.open > 1 ? 'open slots' : 'open slot')}</span>`] : []),
      ];
      const when = c.delayed ? `<span class="chip danger">${tr('gecikiyor', 'delayed')}</span>`
        : c.status === 'Planning' && c.readyAt ? tr(`${human(c.readyAt - now)} <span class="muted">sonra hazır</span>`, `<span class="muted">ready in</span> ${human(c.readyAt - now)}`)
        : c.status === 'Recruiting' && c.expiredAt ? `<span class="muted">${tr('dolmazsa', 'expires in')}</span> ${human(c.expiredAt - now)}` : '—';
      return `<tr class="${c.delayed ? 'fac-bad' : ''}"><td><b>${esc(c.name)}</b> <span class="muted">· ${c.difficulty}</span></td>
        <td><span class="chip ${c.status === 'Planning' ? 'tq' : 'dim'}">${esc(c.status)}</span></td>
        <td class="num">${c.filled}/${c.total}</td><td>${when}</td><td class="fac-probs">${probs.join(' ') || `<span class="muted">${tr('sorun yok', 'no issues')}</span>`}</td></tr>`;
    }).join('');
    return `<article class="glass card">
      <div class="card-head wrap"><h3>⏳ ${tr('Devam eden OC\'ler', 'Ongoing OCs')} <span class="muted">(${oc.crimes.length})</span></h3>
        <span class="muted">${tr('Önce gecikenler ve eşyası eksik olanlar', 'Delayed and missing-item OCs first')}</span></div>
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
    const head = (extra = '') => `<div class="card-head wrap"><h3>📊 ${tr('Haftalık üye raporu', 'Weekly member report')}</h3>${extra}</div>`;
    if (!r) return `<article class="glass card">${head()}${fac.repErr ? errorBox(fac.repErr) : loadingBox()}</article>`;
    const j = r.job || {};
    const run = j.running;
    const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
    const range = r.range?.from ? `${dayLabel(r.range.from)} – ${dayLabel(r.range.to)}` : '';
    const btn = `<span class="fac-head-r">${range ? `<span class="muted">${range} · ${tr('son 7 gün', 'last 7 days')}</span>` : ''}
      <button class="btn sm ghost" type="button" id="fac-rep-refresh" ${run ? 'disabled' : ''}>↻ ${tr('Yenile', 'Refresh')}</button></span>`;
    const progress = run ? `<div class="fac-progress"><div class="storage-bar"><i style="width:${pct}%;background:var(--tq)"></i></div>
      <small class="muted">${tr(`Üye istatistikleri çekiliyor: ${j.done}/${j.total} · dakikada ~40 istek (Torn sınırının altında)`, `Fetching member stats: ${j.done}/${j.total} · ~40 requests a minute (below Torn's limit)`)}</small></div>` : '';
    const err = j.error ? `<div class="alert danger">${esc(j.error)}</div>` : '';
    const table = ([key, icon, title, col, fmt]) => {
      const list = r.boards?.[key] || [];
      let note = '';
      if (key === 'gym') note = r.gymRange?.error ? esc(r.gymRange.error) : !r.gymRange?.from ? tr('Gym verisi her gün kaydedilir; fark yarından itibaren görünür.', 'Gym data is recorded daily; changes show from tomorrow.') : r.gymRange.days < 7 ? tr(`Son ${r.gymRange.days} gün (7 günlük kayıt birikiyor)`, `Last ${r.gymRange.days} day${r.gymRange.days === 1 ? '' : 's'} (building up 7 days of records)`) : '';
      return `<div class="fac-board"><div class="fac-board-h">${icon} ${tr(...title)}</div>
        <table class="tbl compact"><thead><tr><th>${tr('İsim', 'Name')}</th><th class="num">${tr(...col)}</th></tr></thead>
        <tbody>${list.map((x) => `<tr><td>${nameBtn(x.id, x.name)}</td><td class="num mono">${fmt(x.value)}</td></tr>`).join('') || `<tr><td colspan="2" class="muted">${run ? tr('hazırlanıyor…', 'building…') : tr('veri yok', 'no data')}</td></tr>`}</tbody></table>
        ${note ? `<small class="muted">${note}</small>` : ''}</div>`;
    };
    return `<article class="glass card">${head(btn)}${progress}${err}
      <div class="fac-boards">${BOARDS.map(table).join('')}</div>
      <p class="muted sl-note">${tr(
        'Torn API\'deki kişisel istatistiklerin son 7 günlük farkı (Torn günlük kayıt tutar). Gym enerjisi faction katkı listesinden gelir. Natural nerve bar (NNB) Torn API\'de başka oyuncular için yok, bu yüzden listede değil. İlk hazırlık üye başına 2 istek, sonraki günler 1 istek; veriler yalnızca bu bilgisayarda saklanır.',
        'Change in personal stats over the last 7 days, from the Torn API (Torn keeps daily records). Gym Energy comes from the faction contributors list. Natural Nerve Bar (NNB) is not available in the Torn API for other players, so it is not listed. The first build takes 2 requests per member, later days 1; data stays on this computer.')}</p>
    </article>`;
  }

  function render() {
    const el = $('#faction-body'); if (!el) return;
    if (state.view !== 'faction') return;
    const d = fac.d;
    if (!d) { el.innerHTML = fac.err ? errorBox(fac.err) : loadingBox(); return; }
    const a = d.access || {};
    if (a.error) { el.innerHTML = `${myOcCard(d.myOc)}<div class="alert danger">${esc(a.error)}</div>`; return; }
    const role = a.role ? tr(...ROLE_TR[a.role]) : a.allowed ? tr('Yetkili (Organised Crimes)', 'Authorized (Organised Crimes)') : tr('Yetki yok', 'No access');
    const oc = d.oc && !d.oc.error ? d.oc : null;
    const delayed = oc ? oc.crimes.filter((c) => c.delayed).length : null;
    const kpis = a.inFaction ? `<div class="grid kpis">
      ${kpi('<span lang="en">Faction</span>', `${esc(a.faction?.name || '')} <small class="muted">[${esc(a.faction?.tag || '')}]</small>`, esc(a.position || ''))}
      ${kpi(tr('Erişim', 'Access'), role, '', a.allowed ? 'tq-text' : '')}
      ${oc ? kpi(tr('OC\'de', 'In an OC'), `${oc.totals.inOc} <small class="muted">/ ${oc.totals.members}</small>`, tr(`${oc.notInOc.length} üye OC dışında`, `${oc.notInOc.length} not in an OC`)) : ''}
      ${oc ? kpi(tr('Geciken OC', 'Delayed OCs'), String(delayed), tr(`${oc.crimes.length} devam eden OC`, `${oc.crimes.length} ongoing`), delayed ? 'neg' : '') : ''}
    </div>` : '';
    el.innerHTML = kpis + myOcCard(d.myOc)
      + (!a.allowed ? lockedCard(a)
        : d.oc?.error ? `<div class="alert danger">${esc(d.oc.error)}</div>`
          : `${notInOcCard(oc)}${crimesCard(oc)}${reportCard()}`);
  }

  $('#faction-body')?.addEventListener('click', async (e) => {
    if (e.target.closest('#fac-rep-refresh')) { await fetchReport(true); render(); }
  });
  // Sayfa açıkken dakikada bir yeniden çiz (geri sayımlar), 2 dakikada bir veriyi tazele
  setInterval(() => { if (state.view === 'faction' && trackerVisible()) render(); }, 60_000);
  setInterval(() => { if (state.view === 'faction' && trackerVisible()) loadFaction(); }, 2 * 60_000);

  Object.assign(EXTRA_LOADERS, { faction: loadFaction });
  window.lrxFaction = fac;
  applyLang();
  applyFeatures();
})();
