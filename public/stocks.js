/* =========================================================
   LRX Stock Market Tracker (loaded after features.js & stocks-math.js)
   Live Torn stock prices, benefit block ROI (cash + live item/points pricing),
   stackable increment marginal ROI, holdings P/L (net of 0.1% sell fee),
   and locally recorded 30-day price range.
   ========================================================= */
(() => {
  Object.assign(I18N, { 'nav.stocks': ['Borsa', 'Stock Market'] });
  Object.assign(VIEW_META, {
    stocks: {
      tr: ['Borsa', 'Canlı hisse fiyatları, yıllık ROI ve portföy takibi'],
      en: ['Stock Market', 'Live stock prices, annual benefit ROI and holdings P/L'],
    },
  });

  const STOCKS_URL = 'https://www.torn.com/page.php?sid=stocks';
  const st = {
    data: null,
    err: null,
    at: 0,
    q: '',
    filter: lsGet('tt.stocks.filter', 'all'),
    sort: lsGet('tt.stocks.sort', 'roi'),
    highlightId: null,
  };

  function checkPriceAlerts(data) {
    const events = data?.priceAlerts?.triggered || [];
    if (!events.length || !feat('notify') || !feat('notify.priceAlert')) return;
    for (const ev of events) {
      const key = `lrx.priceAlert.${ev.ruleId}.${ev.observedAt}`;
      let seen = null; try { seen = localStorage.getItem(key); } catch {}
      if (seen) continue;
      const dirTxt = ev.direction === 'below' ? tr('altına düştü', 'dropped below') : tr('üzerine çıktı', 'crossed above');
      // Remembered only once the notification went out: a failed one is tried again on the next refresh.
      try { notify(key, `🔔 ${ev.label || ev.assetId}`, `$${Number(ev.currentPrice).toFixed(2)} ${dirTxt} $${Number(ev.threshold).toFixed(2)}`, { url: STOCKS_URL }); }
      catch (e) { console.warn('[stocks] price alert notification failed:', e); continue; }
      try { localStorage.setItem(key, String(Date.now())); } catch {}
      prunePriceAlertKeys();
    }
  }

  // One dedupe key is kept per fired alert; keys older than 30 days can no longer match a new event.
  function prunePriceAlertKeys(now = Date.now()) {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('lrx.priceAlert.')) continue;
        const at = Number(localStorage.getItem(k));
        if (!Number.isFinite(at) || now - at > 30 * 86400_000) localStorage.removeItem(k);
      }
    } catch {}
  }

  async function fetchStocksPage(force = false) {
    if (!force && st.data && Date.now() - st.at < 45_000) return st.data;
    try {
      st.data = await api(`/api/stocks${force ? '?force=1' : ''}`);
      st.err = null;
      st.at = Date.now();
      checkPriceAlerts(st.data);
    } catch (e) {
      st.err = e;
    }
    return st.data;
  }

  async function loadStocks(force = false) {
    const el = $('#stocks-body');
    if (!el) return;
    if (!st.data) el.innerHTML = loadingBox();
    await fetchStocksPage(force);
    renderStocks();
  }

  function filteredRows(rows) {
    const q = st.q.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (q && !r.acronym.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q) && !(r.benefit?.description || '').toLowerCase().includes(q)) return false;
      if (st.filter === 'owned' && !r.holding) return false;
      if (st.filter === 'active' && r.benefit?.type !== 'active') return false;
      if (st.filter === 'passive' && r.benefit?.type !== 'passive') return false;
      if (st.filter === 'roi' && r.roiPct == null) return false;
      return true;
    });
    const sorters = {
      roi: (a, b) => (b.roiPct ?? -1) - (a.roiPct ?? -1) || (a.blockCost ?? Infinity) - (b.blockCost ?? Infinity),
      cost: (a, b) => (a.blockCost ?? Infinity) - (b.blockCost ?? Infinity),
      owned: (a, b) => (b.holding?.value || 0) - (a.holding?.value || 0) || (b.roiPct ?? -1) - (a.roiPct ?? -1),
      price: (a, b) => b.price - a.price,
      name: (a, b) => a.acronym.localeCompare(b.acronym),
    };
    list.sort(sorters[st.sort] || sorters.roi);
    return list;
  }

  function renderRange(r) {
    if (!r.range || r.range.days < 2 || !(r.range.high > r.range.low)) {
      return `<span class="sub-text">${tr('1g gözlem', '1d sample')}</span>`;
    }
    const pos = Math.max(0, Math.min(100, r.range.posPct));
    return `<div class="stk-range" title="${tr('Gözlenen aralık', 'Observed range')} (${r.range.days}${tr('g', 'd')}): $${r.range.low.toFixed(2)} – $${r.range.high.toFixed(2)}">
      <div class="stk-range-bar"><i style="left:${pos.toFixed(1)}%"></i></div>
      <div class="sub-text mono">$${r.range.low.toFixed(0)}–$${r.range.high.toFixed(0)}</div>
    </div>`;
  }

  function renderPriceAlertsCard(allRows) {
    const alerts = st.data?.priceAlerts || { rules: [], triggered: [] };
    const rules = (alerts.rules || []).filter((r) => r.assetKind === 'stock');
    const triggered = alerts.triggered || [];
    const byId = new Map(allRows.map((r) => [String(r.id), r]));
    const stockOptions = [...allRows]
      .sort((a, b) => a.acronym.localeCompare(b.acronym))
      .map((r) => `<option value="${esc(r.id)}">${esc(r.acronym)} · $${r.price.toFixed(2)}</option>`)
      .join('');

    const trigBanner = triggered.length ? `<div class="stk-alert-fired">
      ${triggered.map((ev) => `<button type="button" class="chip warn stk-alert-jump" data-stk-jump="${esc(ev.assetId)}">🔔 ${esc(ev.label || ev.assetId)}: $${Number(ev.currentPrice).toFixed(2)} (${ev.direction === 'below' ? '≤' : '≥'} $${Number(ev.threshold).toFixed(2)}) ↗</button>`).join('')}
    </div>` : '';

    const ruleChips = rules.length ? `<div class="chip-row stk-alert-list">
      ${rules.map((r) => {
        const cur = byId.get(String(r.assetId));
        return `<span class="chip dim stk-alert-chip">
          <button type="button" class="stk-alert-link" data-stk-jump="${esc(r.assetId)}"><b>${esc(r.label || cur?.acronym || `#${r.assetId}`)}</b> ${r.direction === 'below' ? '≤' : '≥'} <span class="mono">$${Number(r.threshold).toFixed(2)}</span></button>
          <button type="button" class="stk-alert-del" data-stk-del-alert="${esc(r.id)}" aria-label="${esc(tr('Uyarıyı sil', 'Delete alert'))}">×</button>
        </span>`;
      }).join('')}
    </div>` : `<span class="sub-text">${tr('İlk gözlem referans alınır; yalnızca fiyat eşiği geçildiğinde bildirim üretilir.', 'The first sample sets the baseline; alerts fire only when price crosses your threshold.')}</span>`;

    return `<article class="glass card stk-alerts-card">
      <div class="card-head wrap">
        <div><h3>🔔 ${tr('Fiyat Eşiği Uyarıları', 'Price Threshold Alerts')} <span class="chip">${rules.length}</span></h3>
          <span class="muted">${tr('Yalnızca yerel · kaynak kesintisi yanlış uyarı üretmez', 'Local only · source outage never fires false alerts')}</span></div>
        <form class="inline-form stk-alert-form" id="stk-alert-form">
          <select id="stk-alert-id" aria-label="${esc(tr('Hisse', 'Stock'))}">${stockOptions}</select>
          <select id="stk-alert-dir" aria-label="${esc(tr('Yön', 'Direction'))}">
            <option value="below">${tr('Altına düşünce (≤)', 'Drops below (≤)')}</option>
            <option value="above">${tr('Üzerine çıkınca (≥)', 'Rises above (≥)')}</option>
          </select>
          <input class="input mono" id="stk-alert-val" type="number" step="0.01" min="0.01" placeholder="$">
          <button class="btn sm ghost" type="submit">+ ${tr('Eşik ekle', 'Add alert')}</button>
        </form>
      </div>
      ${trigBanner}
      ${ruleChips}
    </article>`;
  }

  function renderStocks() {
    const el = $('#stocks-body');
    if (!el || state.view !== 'stocks') return;
    if (!st.data) { el.innerHTML = st.err ? errorBox(st.err) : loadingBox(); return; }
    const analyzed = LRXStocksMath.analyzeStocks(st.data);
    const s = analyzed.summary;
    const rows = filteredRows(analyzed.rows);

    const kpis = `<div class="grid kpis">
      ${kpi(tr('Portföy değeri', 'Portfolio value'), money(s.portfolioValue), tr(`${s.ownedCount} hisse elde`, `${s.ownedCount} ${s.ownedCount === 1 ? 'stock' : 'stocks'} held`), 'tq')}
      ${kpi(tr('Net Kâr / Zarar', 'Unrealized P/L'), s.portfolioPnl != null ? `<span class="${deltaCls(s.portfolioPnl)}">${signed(s.portfolioPnl)}</span>` : '—', tr('%0.1 satış komisyonu düşülmüş', 'net of 0.1% sell fee'))}
      ${kpi(tr('Yıllık temettü (tahmini)', 'Est. annual dividends'), money(s.annualDividends), s.readyDividends ? `<span class="pos">★ ${s.readyDividends} ${tr('temettü hazır!', 'dividend ready!')}</span>` : tr('sahip olunan bloklardan', 'from owned benefit blocks'))}
      ${kpi(tr('En yüksek ROI', 'Top benefit ROI'), s.bestRoi ? `${esc(s.bestRoi.acronym)} · ${s.bestRoi.roiPct.toFixed(1)}%` : '—', s.bestRoi ? `${tr('Blok', 'Block')}: ${cmoney(s.bestRoi.blockCost)}${s.bestBankApr ? ` · ${tr('Banka', 'Bank')} ${s.bestBankApr.toFixed(1)}%` : ''}` : '', 'pos')}
    </div>`;

    const opt = (v, label, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
    const controls = `<article class="glass card stk-controls">
      <div class="stk-bar">
        <input class="input" id="stk-q" type="search" placeholder="${tr('Hisse veya benefit ara… (ör. SYM, FHG, Bank)', 'Search stock or benefit… (e.g. SYM, FHG, Bank)')}" value="${esc(st.q)}">
        <div class="toggle" id="stk-filter" role="group" aria-label="${tr('Filtre', 'Filter')}">
          <button type="button" data-stk-filter="all" class="${st.filter === 'all' ? 'active' : ''}">${tr('Hepsi', 'All')}</button>
          <button type="button" data-stk-filter="owned" class="${st.filter === 'owned' ? 'active' : ''}">${tr('Portföyüm', 'My Holdings')} (${s.ownedCount})</button>
          <button type="button" data-stk-filter="roi" class="${st.filter === 'roi' ? 'active' : ''}">${tr('ROI Hesaplı', 'Priced ROI')}</button>
          <button type="button" data-stk-filter="active" class="${st.filter === 'active' ? 'active' : ''}">${tr('Aktif', 'Active')}</button>
          <button type="button" data-stk-filter="passive" class="${st.filter === 'passive' ? 'active' : ''}">${tr('Pasif', 'Passive')}</button>
        </div>
        <label class="stk-sort">${tr('Sırala', 'Sort')}
          <select id="stk-sort">
            ${opt('roi', tr('Yıllık ROI %', 'Annual ROI %'), st.sort)}
            ${opt('cost', tr('Blok maliyeti', 'Block cost'), st.sort)}
            ${opt('owned', tr('Portföy değeri', 'My holdings'), st.sort)}
            ${opt('price', tr('Hisse fiyatı', 'Share price'), st.sort)}
            ${opt('name', tr('Kısaltma (A-Z)', 'Acronym (A–Z)'), st.sort)}
          </select>
        </label>
        <button class="btn sm ghost" type="button" data-open-url="${STOCKS_URL}" data-tab-label="Stock Market">${tr('Torn Borsası', 'Torn Stock Market')} ↗</button>
      </div>
    </article>`;

    const alertsCard = renderPriceAlertsCard(analyzed.rows);

    const tableRows = rows.map((r) => {
      const h = r.holding;
      const p = r.progress;
      const bTypeChip = !r.benefit ? '<span class="muted">—</span>'
        : r.benefit.type === 'active'
          ? `<span class="chip green">${tr('Aktif', 'Active')}${r.benefit.frequency ? ` · ${r.benefit.frequency}${tr('g', 'd')}` : ''}</span>`
          : `<span class="chip blue">${tr('Pasif', 'Passive')}</span>`;
      const roiCell = r.roiPct != null
        ? `<b class="mono ${r.roiPct >= 20 ? 'pos' : r.roiPct >= 10 ? 'tq-text' : ''}">${r.roiPct.toFixed(1)}%</b>
           <div class="sub-text">${cmoney(r.annualPerBlock)}/${tr('yıl', 'yr')}${p.blocks >= 1 && r.marginalRoiPct != null ? ` · #${p.blocks + 1}: ${r.marginalRoiPct.toFixed(1)}%` : ''}</div>`
        : '<span class="muted">—</span>';
      const holdCell = h
        ? `<div class="mono"><b>${cmoney(h.value)}</b> <span class="sub-text">(${n0(h.shares)})</span></div>
           <div class="sub-text ${h.pnl != null ? deltaCls(h.pnl) : ''}">${h.pnl != null ? `${signed(h.pnl)} (${h.pnlPct >= 0 ? '+' : ''}${h.pnlPct.toFixed(1)}%)` : ''}${h.dividendReady ? ` · <b class="pos">★ ${tr('Al!', 'Claim!')}</b>` : ''}</div>`
        : '<span class="muted">—</span>';
      const progCell = r.benefit?.requirement
        ? `<div class="stk-prog">
            <span>${p.blocks > 0 ? `<span class="chip tq">BB ×${p.blocks}</span>` : `<span class="sub-text">${Math.round(p.progressPct)}%</span>`}</span>
            ${p.nextShares > 0 ? `<div class="sub-text">${tr('Sonraki', 'Next')}: ${cmoney(r.nextCost)}</div>` : `<div class="sub-text pos">${tr('Aktif', 'Active')}</div>`}
          </div>`
        : '<span class="muted">—</span>';
      const cls = [h ? 'stk-owned' : '', String(st.highlightId) === String(r.id) ? 'stk-highlight' : ''].filter(Boolean).join(' ');
      return `<tr id="stk-row-${esc(r.id)}" class="${cls}">
        <td><b class="mono">${esc(r.acronym)}</b><div class="sub-text">${esc(r.name)}</div></td>
        <td class="num mono">$${r.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td>${renderRange(r)}</td>
        <td>${bTypeChip}<div class="sub-text stk-desc">${esc(r.benefit?.description || '')}</div></td>
        <td class="num mono">${r.blockCost != null ? cmoney(r.blockCost) : '—'}<div class="sub-text">${r.benefit?.requirement ? `${compact(r.benefit.requirement, 1)} ${tr('hisse', 'sh')}` : ''}</div></td>
        <td class="num">${roiCell}</td>
        <td class="num">${holdCell}</td>
        <td>${progCell}</td>
      </tr>`;
    }).join('');

    const tableCard = `<article class="glass card">
      <div class="card-head wrap">
        <h3>📈 ${tr('Tüm Torn Hisseleri', 'All Torn Stocks')} <span class="chip">${rows.length}</span></h3>
        <span class="muted">${tr('Eşya temettüleri canlı Torn piyasa değeriyle hesaplanır · 30g aralık uygulama açık kaldıkça birikir', 'Item dividends are priced live from Torn market values · 30d range builds while the app runs')}</span>
      </div>
      ${rows.length ? `<div class="tbl-wrap"><table class="tbl compact stk-table">
        <thead><tr>
          <th>${tr('Hisse', 'Stock')}</th><th class="num">${tr('Fiyat', 'Price')}</th><th>${tr('30g Aralık', '30d Range')}</th>
          <th>${tr('Benefit', 'Benefit')}</th><th class="num">${tr('1. Blok', '1st Block')}</th>
          <th class="num">${tr('Yıllık ROI', 'Annual ROI')}</th><th class="num">${tr('Portföyüm', 'My Holdings')}</th><th>${tr('Blok Durumu', 'Block Progress')}</th>
        </tr></thead>
        <tbody>${tableRows}</tbody></table></div>` : emptyBox(tr('Eşleşen hisse yok', 'No matching stocks'), tr('Filtreyi veya aramayı temizle.', 'Clear the filter or search query.'))}
    </article>`;

    const ae = document.activeElement;
    const keepSearch = ae && ae.id === 'stk-q' ? { start: ae.selectionStart, end: ae.selectionEnd } : null;
    el.innerHTML = (st.err ? errorBox(st.err) : '') + kpis + controls + alertsCard + tableCard;
    if (keepSearch) {
      const next = el.querySelector('#stk-q');
      if (next) {
        next.focus({ preventScroll: true });
        try { next.setSelectionRange(keepSearch.start, keepSearch.end); } catch {}
      }
    }
  }

  function jumpToStock(stockId) {
    st.filter = 'all';
    st.q = '';
    st.highlightId = String(stockId || '');
    if (state.view !== 'stocks') showView('stocks');
    else renderStocks();
    setTimeout(() => {
      const row = document.getElementById(`stk-row-${st.highlightId}`);
      row?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 60);
  }
  window.openStockAlert = jumpToStock;

  const host = $('#stocks-body');
  host?.addEventListener('input', (e) => {
    if (e.target.id === 'stk-q') { st.q = e.target.value; renderStocks(); }
  });
  host?.addEventListener('change', (e) => {
    if (e.target.id === 'stk-sort') { st.sort = e.target.value; lsSet('tt.stocks.sort', st.sort); renderStocks(); }
  });
  host?.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-stk-filter]');
    if (f) { st.filter = f.dataset.stkFilter; lsSet('tt.stocks.filter', st.filter); renderStocks(); return; }
    const jump = e.target.closest('[data-stk-jump]');
    if (jump) { jumpToStock(jump.dataset.stkJump); return; }
    const del = e.target.closest('[data-stk-del-alert]');
    if (del) {
      try {
        const res = await api('/api/alerts/price', { method: 'POST', body: JSON.stringify({ action: 'remove', id: del.dataset.stkDelAlert }) });
        if (st.data) st.data.priceAlerts = { ...(st.data.priceAlerts || {}), rules: res.rules || [] };
        renderStocks();
      } catch (err) { toast(err.message); }
    }
  });
  host?.addEventListener('submit', async (e) => {
    if (e.target.id !== 'stk-alert-form') return;
    e.preventDefault();
    const sel = $('#stk-alert-id');
    const dir = $('#stk-alert-dir')?.value || 'below';
    const val = Number($('#stk-alert-val')?.value);
    const id = sel?.value;
    if (!id || !(val > 0)) return toast(tr('Geçerli bir eşik fiyatı gir.', 'Enter a valid threshold price.'));
    const label = sel?.options?.[sel.selectedIndex]?.textContent?.split('·')[0]?.trim() || id;
    try {
      const res = await api('/api/alerts/price', { method: 'POST', body: JSON.stringify({ action: 'add', assetKind: 'stock', assetId: id, label, direction: dir, threshold: val }) });
      if (st.data) st.data.priceAlerts = { ...(st.data.priceAlerts || {}), rules: res.rules || [] };
      renderStocks();
      toast(tr('Fiyat uyarısı eklendi', 'Price alert added'));
    } catch (err) { toast(err.message); }
  });

  Object.assign(EXTRA_LOADERS, { stocks: loadStocks });
  const prevLang = window.onLangChanged;
  window.onLangChanged = () => { prevLang?.(); if (state.view === 'stocks') renderStocks(); };
  applyLang();
})();
