/* =========================================================
   LRX Ranked War Payout Planner & CSV Export (loaded after app.js & war-payout.js)
   Renders inside #war-payout-card on the War Targets view without touching
   existing target-finder markup or controls.
   ========================================================= */
(() => {
  const st = {
    wars: null,
    warsErr: null,
    warId: null,
    report: null,
    reportErr: null,
    loadingReport: false,
    factionId: null,
    mode: lsGet('tt.wp.mode', 'pool') === 'fixed' ? 'fixed' : 'pool',
    poolRaw: lsGet('tt.wp.pool', '1b'),
    factionCutPct: Number(lsGet('tt.wp.cut', '10')) || 0,
    respectWeightPct: Number(lsGet('tt.wp.rw', '70')),
    minHits: Number(lsGet('tt.wp.minHits', '2')) || 0,
    maxCapRaw: lsGet('tt.wp.maxCap', ''),
    perHitRaw: lsGet('tt.wp.perHit', '1m'),
    perRespectRaw: lsGet('tt.wp.perResp', '250k'),
    open: lsGet('tt.wp.open', '0') === '1',
  };
  if (!Number.isFinite(st.respectWeightPct) || st.respectWeightPct < 0 || st.respectWeightPct > 100) st.respectWeightPct = 70;

  const parseDollars = (raw) => {
    const txt = String(raw || '').trim();
    if (!txt) return 0;
    const v = window.LRXTravelMath ? LRXTravelMath.parsePrice(txt) : Number(txt.replace(/[^\d]/g, ''));
    return Number.isFinite(v) && v >= 0 ? v : 0;
  };
  const dateFmt = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'tr-TR', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' }) : '—');

  async function loadWarsList(force = false) {
    if (!feat('war.payout')) return;
    if (!force && st.wars) return renderPayout();
    try {
      st.wars = await api(`/api/war/rankedwars${force ? '?force=1' : ''}`);
      st.warsErr = null;
      if (!st.warId && st.wars.wars?.length) {
        st.warId = st.wars.wars[0].id;
        await loadWarReport(st.warId);
      }
    } catch (e) {
      st.warsErr = e;
    }
    renderPayout();
  }

  async function loadWarReport(warId, force = false) {
    if (!warId) return;
    st.warId = Number(warId);
    st.loadingReport = true;
    st.reportErr = null;
    renderPayout();
    try {
      st.report = await api(`/api/war/payout?warId=${encodeURIComponent(st.warId)}${force ? '&force=1' : ''}`);
      const mine = st.report.factions?.find((f) => f.id === st.report.myFactionId) || st.report.factions?.[0];
      st.factionId = mine?.id || null;
    } catch (e) {
      st.reportErr = e;
      st.report = null;
    } finally {
      st.loadingReport = false;
      renderPayout();
    }
  }

  function currentFaction() {
    const facs = st.report?.factions || [];
    return facs.find((f) => f.id === st.factionId) || facs[0] || null;
  }

  function computeCurrent() {
    const fac = currentFaction();
    if (!fac) return null;
    return LRXWarPayout.calculatePayouts(fac.members || [], {
      mode: st.mode,
      totalPool: parseDollars(st.poolRaw),
      factionCutPct: st.factionCutPct,
      respectWeightPct: st.respectWeightPct,
      minHits: st.minHits,
      maxCap: parseDollars(st.maxCapRaw),
      perHit: parseDollars(st.perHitRaw),
      perRespect: parseDollars(st.perRespectRaw),
    });
  }

  function renderScoreComparison() {
    const facs = st.report?.factions || [];
    if (facs.length < 2) return '';
    const mine = facs.find((f) => f.id === st.report.myFactionId) || facs[0];
    const opp = facs.find((f) => f.id !== mine.id) || facs[1];
    const sA = Number(mine.score) || 0;
    const sB = Number(opp.score) || 0;
    const sum = Math.max(1, sA + sB);
    const pctA = Math.max(4, Math.min(96, (sA / sum) * 100));
    const diff = sA - sB;
    const warUrl = `https://www.torn.com/war.php?step=rankreport&rankID=${encodeURIComponent(st.warId)}`;
    return `<div class="wp-score-cmp">
      <div class="wp-score-head">
        <span><b class="tq-text">${esc(mine.name)}</b> <span class="mono">${n0(sA)}</span> <small class="sub-text">(${n0(mine.attacks)} ${tr('vuruş', 'hits')})</small></span>
        <span class="chip ${diff >= 0 ? 'green' : 'danger'} mono">War #${st.warId} · ${diff >= 0 ? '+' : ''}${n0(diff)}</span>
        <span><small class="sub-text">(${n0(opp.attacks)} ${tr('vuruş', 'hits')})</small> <span class="mono">${n0(sB)}</span> <b>${esc(opp.name)}</b></span>
      </div>
      <div class="wp-score-bar" role="img" aria-label="${esc(`${mine.name} ${sA} vs ${opp.name} ${sB}`)}">
        <i class="wp-bar-a" style="width:${pctA.toFixed(1)}%"></i>
        <i class="wp-bar-b" style="width:${(100 - pctA).toFixed(1)}%"></i>
      </div>
      <div class="wp-score-links">
        <button class="btn sm ghost" type="button" data-open-url="${warUrl}" data-tab-label="War #${st.warId}">${tr('Torn Savaş Raporu', 'Torn War Report')} ↗</button>
        ${feat('page.faction') && feat('faction.travelRadar') ? `<button class="btn sm ghost" type="button" id="wp-open-radar">🛰️ ${tr('Faction Travel Radar', 'Faction Travel Radar')}</button>` : ''}
      </div>
    </div>`;
  }

  function buildPayoutResults() {
    if (st.loadingReport) return loadingBox();
    if (st.reportErr) return errorBox(st.reportErr);
    if (!st.report) {
      return emptyBox(tr('Savaş seç', 'Select a ranked war'), tr('Ödeme hesaplamak için yukarıdan bir savaş seç veya War ID gir.', 'Choose a war above or enter a ranked war ID to calculate payouts.'));
    }
    const calc = computeCurrent();
    const s = calc.summary;
    const scoreBar = renderScoreComparison();
    const summary = `${scoreBar}<div class="grid kpis small wp-kpis">
      ${kpi(tr('Dağıtılacak', 'Distributable'), money(s.distributable), s.factionCut ? `${tr('Faction payı', 'Faction cut')}: ${money(s.factionCut)}` : '', 'tq')}
      ${kpi(tr('Toplam ödeme', 'Total paid'), money(s.totalPaid), s.unallocated ? `${tr('Dağıtılmayan', 'Unallocated')}: ${money(s.unallocated)}` : tr('Tamamı dağıtıldı', '100% allocated'), 'pos')}
      ${kpi(tr('Hak kazanan', 'Qualified'), `${s.qualifiedCount} / ${s.membersCount}`, s.cappedCount ? `${s.cappedCount} ${tr('tavanlı', 'capped')}` : `${tr('Min.', 'Min')} ${st.minHits} ${tr('vuruş', 'hits')}`)}
      ${kpi(tr('Toplam Hit / Respect', 'Total Hits / Respect'), `${n0(s.totalHits)} · ${n0(s.totalRespect)}`, s.totalHits ? `${tr('Ort.', 'Avg')} ${(s.totalRespect / s.totalHits).toFixed(2)} ${tr('resp/hit', 'resp/hit')}` : '')}
    </div>
    <div class="wp-export-bar">
      <button class="btn sm primary" type="button" id="wp-csv">⬇ ${tr('CSV indir (Excel)', 'Download CSV (Excel)')}</button>
      <button class="btn sm ghost" type="button" id="wp-copy">📋 ${tr('Özeti kopyala', 'Copy summary')}</button>
      <span class="sub-text">${tr('Banka düğmesi Torn Faction Bank ödeme ekranını tutar dolu açar (otomatik ödeme yapmaz).', 'The Bank button opens Torn Faction Bank prefilled with the amount (never auto-sends).')}</span>
    </div>`;

    const rowsHtml = calc.rows.map((r, i) => `<tr class="${!r.qualified ? 'wp-dim' : ''}">
      <td class="mono muted">${i + 1}</td>
      <td><a class="fac-name" href="https://www.torn.com/profiles.php?XID=${r.id}">${esc(r.name)}</a> <span class="sub-text mono">[${r.id}]</span></td>
      <td class="num mono">${n0(r.hits)}</td>
      <td class="num mono">${r.respect.toFixed(2)}</td>
      <td class="num mono muted">${r.hits ? r.avgRespect.toFixed(2) : '—'}</td>
      <td class="num mono">${r.sharePct.toFixed(1)}%</td>
      <td class="num mono ${r.payout ? 'pos' : 'muted'}"><b>${money(r.payout)}</b></td>
      <td>${!r.qualified ? `<span class="chip dim">${tr('Eşik altı', 'Below min')}</span>` : r.capped ? `<span class="chip warn">${tr('Tavan', 'Capped')}</span>` : `<span class="chip green">✓</span>`}</td>
      <td>${r.payUrl ? `<button class="btn sm ghost" type="button" data-open-url="${r.payUrl}" data-tab-label="Pay ${esc(r.name)}">🏦 ${tr('Banka', 'Bank')} ↗</button>` : ''}</td>
    </tr>`).join('');

    return `${summary}<div class="tbl-wrap"><table class="tbl compact">
      <thead><tr>
        <th>#</th><th>${tr('Üye', 'Member')}</th><th class="num">${tr('Vuruş', 'Hits')}</th><th class="num">Respect</th>
        <th class="num">${tr('Ort.', 'Avg')}</th><th class="num">${tr('Pay', 'Share')}</th><th class="num">${tr('Ödeme', 'Payout')}</th>
        <th>${tr('Durum', 'Status')}</th><th></th>
      </tr></thead>
      <tbody>${rowsHtml || `<tr><td colspan="9" class="muted">${tr('Üye verisi yok.', 'No member data.')}</td></tr>`}</tbody>
    </table></div>`;
  }

  function renderPayout() {
    const box = $('#war-payout-card');
    if (!box) return;
    if (!feat('war.payout') || !feat('page.war')) { box.hidden = true; return; }
    box.hidden = false;

    const head = `<div class="card-head wrap">
      <div>
        <h3>💰 ${tr('Ranked War Ödeme Planlayıcı', 'Ranked War Payout Planner')}</h3>
        <span class="muted">${tr('Respect / hit ağırlığı, min. vuruş, tavan ödeme, hazır Faction Bank linki ve CSV dışa aktarma', 'Respect / hit split, min hits, per-member cap, prefilled Faction Bank links and CSV export')}</span>
      </div>
      <div class="wp-head-actions">
        ${st.open ? `<button class="btn sm ghost" type="button" id="wp-refresh">↻ ${tr('Yenile', 'Refresh')}</button>` : ''}
        <button class="btn sm ${st.open ? 'ghost' : 'primary'}" type="button" id="wp-toggle">${st.open ? tr('Gizle', 'Hide') : tr('Planlayıcıyı aç', 'Open planner')}</button>
      </div>
    </div>`;

    if (!st.open) { box.innerHTML = head; return; }
    if (st.warsErr) { box.innerHTML = head + errorBox(st.warsErr); return; }
    if (!st.wars) { box.innerHTML = head + loadingBox(); return; }

    const wars = st.wars.wars || [];
    const warSelect = wars.length
      ? `<select id="wp-war">${wars.map((w) => `<option value="${w.id}"${w.id === st.warId ? ' selected' : ''}>#${w.id} · vs ${esc(w.oppName || '?')} (${n0(w.myScore)}–${n0(w.oppScore)} · ${dateFmt(w.start)})</option>`).join('')}</select>`
      : `<span class="muted">${tr('Geçmiş ranked war bulunamadı — manuel War ID gir:', 'No past ranked wars found — enter a War ID:')}</span>`;

    const facs = st.report?.factions || [];
    const facToggle = facs.length > 1
      ? `<div class="toggle" id="wp-fac-toggle">${facs.map((f) => `<button type="button" data-wp-fac="${f.id}" class="${f.id === st.factionId ? 'active' : ''}">${esc(f.name)} (${n0(f.score)})</button>`).join('')}</div>`
      : '';

    const controls = `<div class="wp-controls">
      <div class="wp-row">
        <label class="wp-field wide"><span>${tr('Ranked War', 'Ranked War')}</span>${warSelect}</label>
        <form class="inline-form wp-manual" id="wp-id-form">
          <input class="input mono" id="wp-manual-id" placeholder="${tr('War ID', 'War ID')}" inputmode="numeric">
          <button class="btn sm ghost" type="submit">${tr('Yükle', 'Load')}</button>
        </form>
        ${facToggle}
      </div>
      <div class="wp-row wp-formula">
        <div class="toggle" id="wp-mode-toggle">
          <button type="button" data-wp-mode="pool" class="${st.mode === 'pool' ? 'active' : ''}">${tr('Toplam Havuz', 'Total Pool')}</button>
          <button type="button" data-wp-mode="fixed" class="${st.mode === 'fixed' ? 'active' : ''}">${tr('Hit / Respect Başı', 'Per Hit / Respect')}</button>
        </div>
        ${st.mode === 'pool' ? `
          <label class="wp-field"><span>${tr('Ödül havuzu ($)', 'Total pool ($)')}</span><input class="input mono" id="wp-pool" value="${esc(st.poolRaw)}" placeholder="1b, 500m"></label>
          <label class="wp-field"><span>${tr('Faction payı (%)', 'Faction cut (%)')}</span><input class="input mono" id="wp-cut" type="number" min="0" max="100" value="${st.factionCutPct}"></label>
          <label class="wp-field"><span>${tr('Respect / Hit', 'Respect / Hits')} (<b id="wp-rw-pct">${st.respectWeightPct}% / ${100 - st.respectWeightPct}%</b>)</span><input id="wp-rw" type="range" min="0" max="100" step="5" value="${st.respectWeightPct}"></label>
        ` : `
          <label class="wp-field"><span>${tr('Hit başı ($)', 'Per hit ($)')}</span><input class="input mono" id="wp-per-hit" value="${esc(st.perHitRaw)}" placeholder="1m"></label>
          <label class="wp-field"><span>${tr('Respect başı ($)', 'Per respect ($)')}</span><input class="input mono" id="wp-per-resp" value="${esc(st.perRespectRaw)}" placeholder="250k"></label>
        `}
        <label class="wp-field"><span>${tr('Min. vuruş', 'Min hits')}</span><input class="input mono" id="wp-min-hits" type="number" min="0" max="500" value="${st.minHits}"></label>
        <label class="wp-field"><span>${tr('Üye tavanı ($)', 'Cap / member ($)')}</span><input class="input mono" id="wp-cap" value="${esc(st.maxCapRaw)}" placeholder="${tr('Limitsiz', 'No cap')}"></label>
      </div>
    </div>`;

    box.innerHTML = head + controls + `<div id="wp-results">${buildPayoutResults()}</div>`;
  }

  function downloadCsv() {
    const calc = computeCurrent();
    if (!calc) return;
    const fac = currentFaction();
    const title = `War #${st.warId} - ${fac?.name || 'Faction'}`;
    const csv = LRXWarPayout.toCsv(calc, { warTitle: title });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lrx-war-${st.warId || 'payout'}-payouts.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(tr('CSV dosyası indirildi', 'CSV file downloaded'));
  }

  const host = $('#war-payout-card');
  host?.addEventListener('click', async (e) => {
    if (e.target.closest('#wp-toggle')) {
      st.open = !st.open;
      lsSet('tt.wp.open', st.open ? '1' : '0');
      renderPayout();
      if (st.open && !st.wars) loadWarsList();
      return;
    }
    if (e.target.closest('#wp-refresh')) { await loadWarsList(true); if (st.warId) await loadWarReport(st.warId, true); return; }
    const m = e.target.closest('[data-wp-mode]');
    if (m) { st.mode = m.dataset.wpMode; lsSet('tt.wp.mode', st.mode); renderPayout(); return; }
    const f = e.target.closest('[data-wp-fac]');
    if (f) { st.factionId = Number(f.dataset.wpFac); renderPayout(); return; }
    if (e.target.closest('#wp-open-radar')) { window.openFactionRadar?.(); return; }
    if (e.target.closest('#wp-csv')) { downloadCsv(); return; }
    if (e.target.closest('#wp-copy')) {
      const calc = computeCurrent();
      if (!calc) return;
      const fac = currentFaction();
      await copyText(LRXWarPayout.toTextSummary(calc, `War #${st.warId} · ${fac?.name || ''}`), tr('Ödeme özeti kopyalandı', 'Payout summary copied'));
    }
  });
  host?.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'wp-war') { loadWarReport(Number(t.value)); return; }
    if (t.id === 'wp-pool') { st.poolRaw = t.value; lsSet('tt.wp.pool', st.poolRaw); }
    else if (t.id === 'wp-cut') { st.factionCutPct = Math.min(100, Math.max(0, Number(t.value) || 0)); lsSet('tt.wp.cut', String(st.factionCutPct)); }
    else if (t.id === 'wp-rw') { st.respectWeightPct = Math.min(100, Math.max(0, Number(t.value) || 0)); lsSet('tt.wp.rw', String(st.respectWeightPct)); }
    else if (t.id === 'wp-min-hits') { st.minHits = Math.max(0, Math.floor(Number(t.value) || 0)); lsSet('tt.wp.minHits', String(st.minHits)); }
    else if (t.id === 'wp-cap') { st.maxCapRaw = t.value; lsSet('tt.wp.maxCap', st.maxCapRaw); }
    else if (t.id === 'wp-per-hit') { st.perHitRaw = t.value; lsSet('tt.wp.perHit', st.perHitRaw); }
    else if (t.id === 'wp-per-resp') { st.perRespectRaw = t.value; lsSet('tt.wp.perResp', st.perRespectRaw); }
    else return;
    const res = $('#wp-results');
    if (res) res.innerHTML = buildPayoutResults();
    else renderPayout();
  });
  host?.addEventListener('input', (e) => {
    if (e.target.id === 'wp-rw') {
      st.respectWeightPct = Math.min(100, Math.max(0, Number(e.target.value) || 0));
      lsSet('tt.wp.rw', String(st.respectWeightPct));
      const pct = $('#wp-rw-pct');
      if (pct) pct.textContent = `${st.respectWeightPct}% / ${100 - st.respectWeightPct}%`;
      const res = $('#wp-results');
      if (res) res.innerHTML = buildPayoutResults();
      else renderPayout();
    }
  });
  host?.addEventListener('submit', (e) => {
    if (e.target.id !== 'wp-id-form') return;
    e.preventDefault();
    const id = Number($('#wp-manual-id')?.value.trim());
    if (!Number.isInteger(id) || id <= 0) return toast(tr('Geçerli bir War ID gir', 'Enter a valid War ID'));
    loadWarReport(id);
  });

  window.openWarPayout = async function openWarPayout(warId = null) {
    if (!feat('page.war') || !feat('war.payout')) return;
    st.open = true;
    lsSet('tt.wp.open', '1');
    if (state.view !== 'war') showView('war');
    renderPayout();
    if (!st.wars) await loadWarsList();
    if (Number(warId) > 0) await loadWarReport(Number(warId));
    setTimeout(() => {
      document.getElementById('war-payout-card')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  FEATURE_HOOKS.push(renderPayout);
  const prevLang = window.onLangChanged;
  window.onLangChanged = () => { prevLang?.(); renderPayout(); };
  window.renderWarPayout = () => { renderPayout(); if (st.open && !st.wars) loadWarsList(); };
  renderPayout();
})();
