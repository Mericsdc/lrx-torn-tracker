/* =========================================================
   Finance page: one sidebar item with two tabs, replacing the old Networth and Income Statement pages.
   - Networth: the player's personal wealth (/api/networth, one record per day kept for 365 days).
   - Company: the director's company income (state.company, the report app.js already loads; nothing new is fetched).
   Calculations live in finance-math.js. Loaded after features.js and uses app.js / features.js helpers.
   Spec: docs/superpowers/specs/2026-11-15-finance-page-design.md
   ========================================================= */
(function () {
  const FM = window.LRXFinanceMath;
  const NW_DAYS = [1, 7, 30, 90, 365];
  const CO_DAYS = ['1', '7', '30', 'all'];
  // [API part, TR, EN]: Torn place names (Item Market, Bazaar…) stay English in both languages.
  const NW_PARTS = {
    wallet: ['Cüzdan', 'Wallet'], bank: ['Banka', 'Bank'], cayman: ['Cayman', 'Cayman'], vault: ['Vault', 'Vault'], piggybank: ['Piggy Bank', 'Piggy Bank'], points: ['Points', 'Points'],
    items: ['Eşyalar', 'Items'], displaycase: ['Display Case', 'Display Case'], bazaar: ['Bazaar', 'Bazaar'], itemmarket: ['Item Market', 'Item Market'], trade: ['Takas', 'Trade'],
    auctionhouse: ['Auction House', 'Auction House'], stockmarket: ['Stock Market', 'Stock Market'], properties: ['Mülkler', 'Properties'], company: ['Şirket', 'Company'],
    enlistedcars: ['Enlisted Cars', 'Enlisted Cars'], bookie: ['Bookie', 'Bookie'], pending: ['Bekleyen', 'Pending'], loan: ['Kredi', 'Loan'], unpaidfees: ['Ödenmemiş ücretler', 'Unpaid fees'],
  };
  const GROUPS = {
    cash: { name: ['Nakit', 'Cash'], color: '#c9a96a' },
    market: { name: ['Eşya ve piyasa', 'Items and market'], color: '#8fa3b8' },
    invest: { name: ['Yatırımlar', 'Investments'], color: '#6f8f86' },
    other: { name: ['Bekleyen ve borçlar', 'Pending and debts'], color: '#b67a6a' },
  };
  const CASH = ['wallet', 'bank', 'cayman', 'vault', 'piggybank'];

  Object.assign(I18N, { 'nav.finance': ['Finans', 'Finance'] });
  Object.assign(VIEW_META, { finance: { tr: ['Finans', 'Networth ve şirket gelir tablosu'], en: ['Finance', "Your networth and your company's income"] } });

  const st = {
    tab: lsGet('tt.finance.tab', 'wealth') === 'company' ? 'company' : 'wealth',
    nwDays: NW_DAYS.includes(Number(lsGet('tt.finance.nwPeriod', 30))) ? Number(lsGet('tt.finance.nwPeriod', 30)) : 30,
    coDays: CO_DAYS.includes(lsGet('tt.finance.coPeriod', '7')) ? lsGet('tt.finance.coPeriod', '7') : '7',
    nw: null, nwErr: null, closed: new Set(),
  };

  const L = (pair) => tr(pair[0], pair[1]);
  const partName = (k) => (NW_PARTS[k] ? L(NW_PARTS[k]) : esc(k));
  const nwLabel = (d) => ({ 1: tr('1G', '1D'), 7: tr('7G', '7D'), 30: tr('30G', '30D'), 90: tr('90G', '90D'), 365: tr('1Y', '1Y') })[d];
  const coLabel = (d) => ({ 1: tr('Son gün', 'Last day'), 7: tr('7G', '7D'), 30: tr('30G', '30D'), all: tr('Tümü', 'All') })[d];
  const coN = () => (st.coDays === 'all' ? Infinity : Number(st.coDays));
  const dayWord = (n) => tr(`${n} gün`, `${n} ${n === 1 ? 'day' : 'days'}`);
  const tabs = () => ({ wealth: feat('page.networth'), company: feat('page.company') && state.companyMode !== false });
  const anyTab = () => { const t = tabs(); return t.wealth || t.company; };
  const activeTab = () => { const t = tabs(); return t[st.tab] ? st.tab : t.wealth ? 'wealth' : t.company ? 'company' : null; };
  const arrow = (p, good = true) => (p == null ? '' : `<span class="${(p >= 0) === good ? 'pos' : 'neg'}">${p >= 0 ? '▲' : '▼'} ${pct(Math.abs(p), 1)}</span>`);
  const pctOf = (a, b) => (b ? a / b : null);
  function eta(days) {
    if (days == null) return tr('bu hızla ulaşılmıyor', 'not at the current pace');
    if (days < 60) return tr(`~${days} gün`, `~${days} ${days === 1 ? 'day' : 'days'}`);
    if (days < 730) { const m = Math.round(days / 30.4); return tr(`~${m} ay`, `~${m} months`); }
    const y = Math.round(days / 365); return tr(`~${y} yıl`, `~${y} years`);
  }
  const periodBar = (which, list, cur, label) => `<div class="toggle fin-period" data-fin-period="${which}" role="group" aria-label="${tr('Dönem', 'Period')}">${list.map((d) => `<button type="button" data-days="${d}" aria-pressed="${String(d) === String(cur)}" class="${String(d) === String(cur) ? 'active' : ''}">${label(d)}</button>`).join('')}</div>`;

  /* ---------- tab cards ---------- */
  function tabCard(id, on, label, value, sub, icon) {
    return `<button type="button" class="fin-tab glass" role="tab" id="fin-tab-${id}" data-fin-tab="${id}" aria-controls="fin-${id}" aria-selected="${on}" tabindex="${on ? 0 : -1}">
      <span class="fin-tab-label">${icon}<span>${label}</span></span><span class="fin-tab-value mono">${value}</span><span class="fin-tab-sub">${sub}</span></button>`;
  }
  function tabCards(active) {
    const t = tabs(), out = [];
    if (t.wealth) {
      const d = st.nw, hist = d?.history || [], total = d?.current?.total;
      const day = d ? FM.nwChange(hist, total, 1) : null;
      const sub = !d ? (st.nwErr ? tr('yüklenemedi', 'could not load') : tr('Yükleniyor…', 'Loading…')) : day ? `<span class="${deltaCls(day.change)}">${signed(day.change)}</span> ${tr('bugün', 'today')}` : tr('dünkü kayıt yok', 'no record from yesterday');
      out.push(tabCard('wealth', active === 'wealth', tr('Networth · kişisel', 'Networth · personal'), d ? cmoney(total) : '—', sub,
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21c1-4 4.5-6 8-6s7 2 8 6"/></svg>'));
    }
    if (t.company) {
      const c = state.company, i = c?.income;
      out.push(tabCard('company', active === 'company', c ? `${tr('Şirket', 'Company')} · ${esc(decode(c.company.name))}` : tr('Şirket', 'Company'),
        i ? `<span class="${deltaCls(i.net)}">${cmoney(i.net)}</span>` : '—',
        i ? tr(`net · gelir ${cmoney(i.revenue)} · son gün`, `net · revenue ${cmoney(i.revenue)} · last day`) : tr('Yükleniyor…', 'Loading…'),
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V9l8-5 8 5v12M9 21v-6h6v6M4 21h16"/></svg>'));
    }
    return `<div class="fin-tabs${out.length === 1 ? ' single' : ''}" role="tablist" aria-label="${tr('Finans', 'Finance')}">${out.join('')}</div>`;
  }

  /* ---------- Networth tab ---------- */
  function renderWealth(el) {
    const d = st.nw;
    if (!d) { el.innerHTML = st.nwErr ? errorBox(st.nwErr) : loadingBox(); return; }
    const cur = d.current || {}, hist = d.history || [], total = Number(cur.total) || 0, n = st.nwDays;
    const ch = FM.nwChange(hist, total, n), start = ch?.start || null;
    const prev = FM.nwPrevChange(hist, n);
    const cash = CASH.reduce((a, k) => a + (Number(cur[k]) || 0), 0);
    const when = new Date(d.timestamp * 1000).toLocaleTimeString(state.lang === 'en' ? 'en-GB' : 'tr-TR', { hour: '2-digit', minute: '2-digit' });
    const short = ch && ch.covered < n;
    const changeHint = ch
      ? [ch.pct != null ? pct(ch.pct, 2) : null, ch.perDay != null && n > 1 ? `${signed(ch.perDay)}${tr('/gün', '/day')}` : null,
        prev != null ? `${tr('önceki', 'prev')} ${nwLabel(n)} ${signed(prev)}` : null,
        short ? tr(`kayıtlar ${ch.covered} günü kapsıyor`, `records cover ${dayWord(ch.covered)}`) : null].filter(Boolean).join(' · ')
      : n === 1 ? tr('dünkü kayıt yok', 'no record from yesterday') : tr('bu dönem için kayıt yok', 'no record for this period yet');
    const chips = [1, 7, 30, 365].map((k) => { const c = FM.nwChange(hist, total, k); return `<span class="fin-chip"><b>${nwLabel(k)}</b> <span class="mono ${c ? deltaCls(c.change) : ''}">${c ? signed(c.change) : '—'}</span></span>`; }).join('');

    const groups = FM.nwGroups(cur, start);
    const posSum = groups.reduce((a, g) => a + Math.max(0, g.total), 0) || 1;
    const alloc = `<article class="glass card fin-alloc">
        <div class="card-head"><h3>${tr('Servet dağılımı', 'Allocation')}</h3><span class="muted">${tr('değişim', 'change')} · ${nwLabel(n)}</span></div>
        <div class="storage-bar fin-stack">${groups.filter((g) => g.total > 0).map((g) => `<i style="width:${(g.total / posSum) * 100}%;background:${GROUPS[g.key].color}" title="${L(GROUPS[g.key].name)}"></i>`).join('')}</div>
        ${groups.map((g) => `<details data-group="${g.key}"${st.closed.has(g.key) ? '' : ' open'}>
          <summary><b class="fin-dot" style="background:${GROUPS[g.key].color}"></b><span class="fin-g-name">${L(GROUPS[g.key].name)}</span><span class="muted mono">${total > 0 && g.total > 0 ? pct(g.total / total, 1) : ''}</span><span class="mono fin-g-val">${cmoney(g.total)}</span><span class="mono fin-chg ${deltaCls(g.change)}">${g.change ? signed(g.change) : ''}</span></summary>
          ${g.parts.length ? g.parts.map((p) => `<div class="fin-part" data-part="${esc(p.key)}"><span>${partName(p.key)}</span><span class="muted mono">${total > 0 && p.value > 0 ? pct(p.value / total, 1) : ''}</span><span class="mono ${p.value < 0 ? 'neg' : ''}">${cmoney(p.value)}</span><span class="mono fin-chg ${deltaCls(p.change)}">${p.change ? signed(p.change) : ''}</span></div>`).join('') : `<div class="fin-part muted">${tr('Bu grupta değer yok', 'Nothing in this group')}</div>`}
        </details>`).join('')}
      </article>`;

    const movers = FM.nwMovers(cur, start);
    const maxM = Math.max(1, ...movers.map((m) => Math.abs(m.change)));
    const moved = `<article class="glass card fin-movers">
        <div class="card-head"><h3>${tr('Ne değişti?', 'What moved')}</h3><span class="muted">${nwLabel(n)}</span></div>
        ${movers.length ? movers.map((m) => `<div class="fin-mover"><span>${partName(m.key)}</span><div class="fin-bar"><i class="${m.change < 0 ? 'neg' : ''}" style="width:${(Math.abs(m.change) / maxM) * 100}%"></i></div><span class="mono ${deltaCls(m.change)}">${signed(m.change)}</span></div>`).join('')
          : emptyBox(tr('Henüz karşılaştırma yok', 'Nothing to compare yet'), start ? tr('Bu dönemde hiçbir kalem değişmedi.', 'No part changed in this period.') : tr('Dönemin başından bir kayıt gerekiyor; kayıtlar her gün birikir.', 'A record from the start of the period is needed; one is saved every day.'))}
      </article>`;

    const m30 = FM.nwChange(hist, total, 30);
    const ms = feat('finance.milestone') ? FM.nextMilestone(total, m30?.perDay) : null;
    const milestone = !ms ? '' : `<article class="glass card fin-milestone">
        <div class="card-head"><h3>${tr('Sonraki networth eşiği', 'Next networth milestone')}</h3><span class="muted">${tr('Torn rank eşikleri', "Torn's rank triggers")}</span></div>
        ${ms.done ? `<p class="fin-ms-done">${tr('Bütün networth rank eşiklerine ulaşıldı', 'Every networth rank trigger reached')}</p>` : `
        <div class="fin-ms-head"><span class="fin-ms-target mono">${cmoney(ms.target)}</span><span class="mono">${pct(ms.progress, 0)}</span></div>
        <div class="fin-bar big"><i style="width:${ms.progress * 100}%"></i></div>
        <div class="sub-text">${tr(`${cmoney(ms.from)} → ${cmoney(ms.target)} · 30 günlük hızla ${eta(ms.days)}`, `${cmoney(ms.from)} → ${cmoney(ms.target)} · at the 30-day pace ${eta(ms.days)}`)}</div>`}
        <div class="sub-text fin-ms-list">${FM.NW_TRIGGERS.map((x) => `<span class="${total >= x ? 'pos' : ''}">${cmoney(x)}</span>`).join(' · ')}</div>
      </article>`;

    const stats = FM.nwStats(hist, start);
    const histSince = start ? hist.filter((r) => r.date >= start.date) : [];
    // No start record but older history: the app was off during the period (or since yesterday for 1D).
    const noStart = () => (hist.length >= 2 ? emptyBox(tr('Bu dönemde önceki kayıt yok', 'No earlier record in this period'), tr('Uygulama o günlerde açık değildi; karşılaştırmak için daha uzun bir dönem seçin.', 'The app was not running then. Pick a longer period to compare.')) : null);
    const history = `<article class="glass card">
        <div class="card-head"><h3>${tr('Networth geçmişi', 'Networth history')}</h3><span class="muted">${hist.length} ${tr('gün kayıtlı', hist.length === 1 ? 'day recorded' : 'days recorded')}</span></div>
        <div class="ic-summary">
          <div><small>${tr('En iyi gün', 'Best day')}</small><strong class="mono ${stats.best ? 'pos' : ''}">${stats.best ? signed(stats.best.change) : '—'}</strong><em>${stats.best ? shortDate(stats.best.date) : tr('yükselen gün yok', 'no rising day')}</em></div>
          <div><small>${tr('En kötü gün', 'Worst day')}</small><strong class="mono ${stats.worst ? 'neg' : ''}">${stats.worst ? signed(stats.worst.change) : '—'}</strong><em>${stats.worst ? shortDate(stats.worst.date) : tr('düşen gün yok', 'no falling day')}</em></div>
          <div><small>${tr('Yükselen günler', 'Days up')}</small><strong class="mono">${stats.count ? `${stats.up} / ${stats.count}` : '—'}</strong><em>${tr('ardışık günlük kayıtlar', 'back-to-back daily records')}</em></div>
          <div><small>${tr('Günlük ortalama', 'Average per day')}</small><strong class="mono ${ch?.perDay != null ? deltaCls(ch.perDay) : ''}">${ch?.perDay != null ? signed(ch.perDay) : '—'}</strong><em>${nwLabel(n)}</em></div>
        </div>
        <div class="chart fin-chart" id="fin-nw-chart"></div>
      </article>`;

    const rows = start ? FM.recordChanges(hist).filter((r) => r.date > start.date).reverse() : [];
    const table = `<article class="glass card">
        <div class="card-head"><h3>${tr('Gün gün', 'Day by day')}</h3><span class="muted">${nwLabel(n)}</span></div>
        ${rows.length ? `<div class="tbl-wrap"><table class="tbl compact" id="fin-nw-table"><thead><tr><th>${tr('Tarih', 'Date')}</th><th class="num">${tr('Toplam', 'Total')}</th><th class="num">${tr('Değişim', 'Change')}</th><th>${tr('En çok değişen', 'Biggest move')}</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td class="mono">${esc(r.date)}${r.span > 1 ? ` <span class="sub-text">(${dayWord(r.span)})</span>` : ''}</td><td class="num">${money(r.total)}</td><td class="num ${deltaCls(r.change)}">${signed(r.change)}</td><td>${r.mover ? `${partName(r.mover.key)} <span class="mono ${deltaCls(r.mover.change)}">${signed(r.mover.change)}</span>` : '<span class="muted">—</span>'}</td></tr>`).join('')}
        </tbody></table></div>` : noStart() || emptyBox(tr('Geçmiş birikiyor', 'Building history'), tr('Her gün networth kaydı alınır; tablo 2. günden itibaren dolar.', 'Networth is recorded daily; the table fills from day 2.'))}
      </article>`;

    el.innerHTML = `${st.nwErr ? errorBox(st.nwErr) : ''}
      <div class="fin-bar-row"><span class="eyebrow">${tr('Kişisel servetin', 'Your personal wealth')}</span>${periodBar('nw', NW_DAYS, n, nwLabel)}</div>
      <div class="grid kpis fin-kpis">
        ${kpi(tr('Toplam networth', 'Total networth'), money(total), `${tr('güncellendi', 'updated')} ${when}`, 'tq')}
        ${kpi(`${tr('Değişim', 'Change')} · ${nwLabel(n)}`, ch ? `<span class="${deltaCls(ch.change)}">${signed(ch.change)}</span>` : '—', changeHint)}
        ${kpi(tr('Nakit', 'Cash'), money(cash), tr('cüzdan, banka, Cayman, vault, piggy bank', 'wallet, bank, Cayman, vault, piggy bank'))}
      </div>
      <div class="fin-chips">${chips}</div>
      <div class="grid fin-split">${alloc}<div class="stack fin-side">${moved}${milestone}</div></div>
      ${history}${table}`;
    if (histSince.length >= 2) mountChart($('#fin-nw-chart'), (W) => lineChart(histSince.map((r) => ({ date: r.date, v: r.total })), W));
    else $('#fin-nw-chart').innerHTML = noStart() || emptyBox(tr('Geçmiş birikiyor', 'Building history'), tr('Her gün networth kaydı alınır; grafik 2. günden itibaren görünür.', 'Networth is recorded daily; the chart appears from day 2.'));
  }

  /* ---------- Company tab ---------- */
  function lastDayTotals(i) {
    return { days: 1, revenue: i.revenue, cogs: i.cogs, gross: i.revenue - i.cogs, wages: i.wages, ads: i.ads, net: i.net, customers: i.customers, estimated: false };
  }
  function renderCompanyTab(el) {
    const c = state.company;
    if (!c) { el.innerHTML = loadingBox(); return; }
    const i = c.income, days = c.days || [], n = coN();
    const now = n === 1 ? lastDayTotals(i) : FM.coTotals(FM.coWindow(days, n));
    const prevRows = n === 1 ? days.slice(-2, -1) : FM.coPrevWindow(days, n);
    const prev = prevRows.length ? FM.coTotals(prevRows) : null;
    const has = now.days > 0;
    const be = has ? FM.breakEven(now) : null;
    const rpc = has && now.customers ? now.revenue / now.customers : null;
    const est = now.estimated || prev?.estimated;
    const tilde = (t) => (t?.estimated ? '~' : '');
    const name = esc(decode(c.company.name));
    // Changes compare revenue / costs per recorded day (FM.coChange), so a window with fewer day records
    // (a new company, days the app was off) is not shown as a drop or a jump.
    const uneven = has && prev && prev.days !== now.days;
    const cover = n === Infinity || n === 1 ? [] : [
      now.days < n ? tr(`bu dönem: ${now.days}/${n} gün kayıtlı`, `this period: ${now.days} of ${n} days recorded`) : null,
      prev && prev.days < n ? tr(`önceki dönem: ${prev.days}/${n} gün kayıtlı`, `previous period: ${prev.days} of ${n} days recorded`) : null,
    ].filter(Boolean);
    const revChange = has && prev ? FM.coChange(now, prev, 'revenue') : null;
    const revHint = !has ? '' : !prev ? tr('önceki dönem yok', 'no previous period')
      : revChange == null ? tr('önceki dönemde gelir yok', 'no revenue in the previous period')
      : `${arrow(revChange)} ${uneven ? tr('günlük ort., önceki döneme göre', 'per day vs previous period') : tr('önceki döneme göre', 'vs previous period')}`;

    const kpis = `<div class="grid kpis fin-kpis">
        ${kpi(`${tr('Gelir', 'Revenue')} · ${coLabel(st.coDays)}`, has ? money(now.revenue) : '—', revHint, 'tq')}
        ${kpi(`${tr('Net kâr', 'Net profit')} · ${coLabel(st.coDays)}`, has ? `<span class="${deltaCls(now.net)}">${tilde(now)}${money(now.net)}</span>` : '—', has && now.revenue ? `${pct(now.net / now.revenue, 1)} ${tr('marj', 'margin')}` : '')}
        ${kpi(tr('Müşteri başı gelir', 'Revenue per customer'), rpc != null ? money(rpc) : '—', has ? `${n0(now.customers)} ${tr('müşteri', 'customers')}` : '')}
        ${kpi(tr('Başa baş geliri / gün', 'Break-even revenue / day'), be ? money(be.perDay) : '—', be ? (be.gap >= 0 ? `<span class="pos">${tr('karşılanıyor', 'covered')}</span> · ${tr('ort.', 'avg')} ${cmoney(be.avgRevenue)}` : `<span class="neg">${tr(`günde ${cmoney(-be.gap)} eksik`, `short by ${cmoney(-be.gap)} a day`)}</span>`) : '')}
      </div>`;

    const row = (key, label, a, b, good = true, cls = '') => {
      const p = b == null ? null : FM.coChange(now, prev, key);
      return `<tr data-row="${key}" class="${cls}"><td>${label}</td><td class="num fin-now">${a == null ? '—' : money(a)}</td><td class="num fin-prev muted">${b == null ? '—' : money(b)}</td><td class="num fin-delta">${p == null ? '<span class="muted">—</span>' : arrow(p, good)}</td></tr>`;
    };
    const emp = c.employees.length;
    const pnl = `<article class="glass card fin-pnl-card">
        <div class="card-head"><h3>${tr('Kâr ve zarar', 'Profit and loss')}</h3><span class="muted">${coLabel(st.coDays)}${est ? ' · ~' : ''}</span></div>
        ${has ? `<div class="tbl-wrap"><table class="tbl compact fin-pnl" id="fin-pnl"><thead><tr><th></th><th class="num">${tr('Bu dönem', 'This period')}</th><th class="num">${tr('Önceki', 'Previous')}</th><th class="num">${tr('Fark', 'Change')}</th></tr></thead><tbody>
          ${row('revenue', tr('Satış geliri', 'Sales revenue'), now.revenue, prev?.revenue)}
          ${row('cogs', `${tr('Ürün maliyeti', 'Cost of goods')} <span class="sub-text">${pct(pctOf(now.cogs, now.revenue), 0)}</span>`, now.cogs, prev?.cogs, false, 'minus')}
          ${row('gross', `<b>${tr('Brüt kâr', 'Gross profit')}</b>`, now.gross, prev?.gross)}
          ${row('wages', `${tr(`Maaşlar (${emp} çalışan)`, `Wages (${emp} ${emp === 1 ? 'employee' : 'employees'})`)} <span class="sub-text">${pct(pctOf(now.wages, now.revenue), 0)}</span>`, now.wages, prev?.wages, false, 'minus')}
          ${row('ads', `${tr('Reklam', 'Advertising')} <span class="sub-text">${pct(pctOf(now.ads, now.revenue), 0)}</span>`, now.ads, prev?.ads, false, 'minus')}
          ${row('net', `<b>${tr('Net kâr', 'Net profit')}</b>`, now.net, prev?.net, true, `total ${now.net >= 0 ? 'pos' : 'neg'}`)}
        </tbody></table></div>
        <div class="fin-sub">
          <div><span>${tr('Müşteri (gün / hafta)', 'Customers (day / week)')}</span><span class="mono">${n0(i.customers)} / ${n0(i.weeklyCustomers)}</span></div>
          <div><span>${tr('7 günlük gelir (Torn) · günlük ortalama', '7-day revenue (Torn) · daily average')}</span><span class="mono">${money(i.weeklyRevenue)} · ${money(i.weeklyAvg)}</span></div>
          <div><span>${tr('Aylık net projeksiyon (günlük ort. ×30)', 'Monthly net projection (daily avg ×30)')}</span><span class="mono ${deltaCls(now.net)}">${money((now.net / now.days) * 30)}</span></div>
        </div>
        ${cover.length ? `<p class="sub-text fin-note fin-coverage">${cover.join(' · ')}${uneven ? ` · ${tr('fark sütunu günlük ortalamaları karşılaştırır', 'the change column compares daily averages')}` : ''}</p>` : ''}
        ${est ? `<p class="sub-text fin-note">~ ${tr('tahmini: stok kaydı olmayan günlerde ürün maliyeti bugünkü orandan hesaplanır', 'estimate: for days without a stock record the cost of goods is worked out from the current ratio')}</p>` : ''}`
        : emptyBox(tr('Geçmiş birikiyor', 'Building history'), tr('Bu dönem için günlük kayıt yok. Sunucu açık kaldıkça her gün otomatik kayıt alınır.', 'No day records for this period yet. Daily snapshots are recorded automatically while the app is running.'))}
      </article>`;

    const sold = c.products.reduce((a, p) => a + (p.sold_worth || 0), 0);
    const products = `<article class="glass card fin-products">
        <div class="card-head"><h3>${tr('Ürünler', 'Products')}</h3><span class="muted">${tr('son gün · 30 günlük satış', 'last day · 30-day sales')}</span></div>
        <div class="fin-prod-list">${c.products.map((p, idx) => {
          const color = PALETTE[idx % PALETTE.length], share = sold ? (p.sold_worth || 0) / sold : 0;
          const series = FM.productSeries(days, p.name, 30);
          return `<div class="fin-prod${p.sold_worth ? '' : ' muted'}" data-product="${esc(p.name)}">
            <span class="fin-prod-name"><b class="fin-dot" style="background:${color}"></b>${esc(p.name)}</span>
            <span class="fin-prod-share"><span class="fin-bar"><i style="width:${share * 100}%;background:${color}"></i></span><span class="mono">${pct(share, 1)}</span></span>
            <span class="mono">${money(p.sold_worth)}</span>
            <span class="mono ${deltaCls(p.profit)}">${money(p.profit)}</span>
            <span class="mono muted">${pct(p.margin, 0)}</span>
            ${spark(series, color)}
          </div>`;
        }).join('')}</div>
        <div class="fin-prod-foot sub-text">${tr('Gelir · pay · kâr · marj · son 30 gün', 'Revenue · share · profit · margin · last 30 days')}<span class="mono">${tr('Toplam', 'Total')} ${money(sold)}</span></div>
      </article>`;

    const chartRows = FM.chartDays(days, n);
    const fundsRows = FM.coWindow(days, Math.max(7, n)).filter((r) => r.funds != null);
    const firstF = fundsRows[0], lastF = fundsRows[fundsRows.length - 1];
    const popNow = lastF?.popularity, popThen = firstF?.popularity;
    const funds = `<article class="glass card">
        <div class="card-head"><h3>${tr('Şirket fonu ve popülerlik', 'Company funds and popularity')}</h3><span class="muted">${fundsRows.length > 1 ? dayWord(FM.daysApart(firstF, lastF)) : ''}</span></div>
        <div class="fin-sub fin-sub-row">
          <div><span>${tr('Fon', 'Funds')}</span><span class="mono">${money(c.company.funds)}</span>${fundsRows.length > 1 ? `<span class="mono ${deltaCls(lastF.funds - firstF.funds)}">${signed(lastF.funds - firstF.funds)}</span>` : ''}</div>
          <div><span>${tr('Popülerlik', 'Popularity')}</span><span class="mono">${c.company.popularity ?? '—'}</span>${popNow != null && popThen != null ? `<span class="mono ${deltaCls(popNow - popThen)}">${signed(popNow - popThen, (v) => String(Math.round(v)))}</span>` : ''}</div>
        </div>
        <div class="chart fin-chart small" id="fin-funds"></div>
      </article>`;

    const tRows = (n === Infinity ? days : FM.coWindow(days, n)).slice().reverse();
    const table = `<article class="glass card">
        <div class="card-head"><h3>${tr('Gün gün', 'Day by day')}</h3><span class="muted">${coLabel(st.coDays)}</span></div>
        ${tRows.length ? `<div class="tbl-wrap"><table class="tbl" id="fin-co-table"><thead><tr><th>${tr('Tarih', 'Date')}</th><th class="num">${tr('Müşteri', 'Customers')}</th><th class="num">${tr('Gelir', 'Revenue')}</th><th class="num">${tr('Ürün maliyeti', 'COGS')}</th><th class="num">${tr('Maaş', 'Wages')}</th><th class="num">${tr('Reklam', 'Ads')}</th><th class="num">Net</th><th class="num">${tr('Müşteri başı', 'Per customer')}</th><th class="num">${tr('Marj', 'Margin')}</th><th class="num">${tr('Popülerlik', 'Popularity')}</th></tr></thead><tbody>
          ${tRows.map((d) => `<tr><td class="mono">${esc(d.date)}</td><td class="num">${n0(d.customers)}</td><td class="num">${money(d.revenue)}</td><td class="num muted">${d.cogsEstimated ? '~' : ''}${money(d.cogs)}</td><td class="num muted">${money(d.wages)}</td><td class="num muted">${money(d.ads)}</td><td class="num ${d.net >= 0 ? 'pos' : 'neg'}">${d.cogsEstimated ? '~' : ''}${money(d.net)}</td><td class="num">${d.customers ? money(d.revenue / d.customers) : '—'}</td><td class="num">${d.revenue ? pct(d.net / d.revenue, 1) : '—'}</td><td class="num">${d.popularity ?? '—'}</td></tr>`).join('')}
        </tbody></table></div>${tRows.some((d) => d.cogsEstimated) ? `<p class="sub-text fin-note">~ ${tr('tahmini: stok kaydı olmayan günlerde ürün maliyeti bugünkü orandan hesaplanır', 'estimate: for days without a stock record the cost of goods is worked out from the current ratio')}</p>` : ''}`
        : emptyBox(tr('Geçmiş birikiyor', 'Building history'), tr('Sunucu açık kaldıkça her gün otomatik kayıt alınır.', 'Daily snapshots are recorded automatically while the app is running.'))}
      </article>`;

    el.innerHTML = `<div class="fin-bar-row"><span class="eyebrow">${tr('Şirket', 'Company')} · ${name}</span>${periodBar('co', CO_DAYS, st.coDays, coLabel)}</div>
      ${kpis}
      <div class="grid fin-split">${pnl}${products}</div>
      <article class="glass card"><div class="card-head"><h3>${tr('Gelir geçmişi', 'Income history')}</h3><span class="muted">${tr(`${days.length} gün kayıtlı`, `${days.length} ${days.length === 1 ? 'day' : 'days'} recorded`)}</span></div><div class="chart fin-chart" id="fin-co-chart"></div></article>
      ${funds}${table}`;
    if (chartRows.length >= 2) mountChart($('#fin-co-chart'), (W) => incomeChart(chartRows, W));
    else $('#fin-co-chart').innerHTML = emptyBox(tr('Geçmiş birikiyor', 'Building history'), `${tr('Sunucu açık kaldıkça her gün otomatik kayıt alınır.', 'Daily snapshots are recorded automatically while the app is running.')}<br><span class="muted">${tr('Şimdilik 7 günlük ortalama:', '7-day average for now:')} ${money(i.weeklyAvg)} / ${tr('gün', 'day')}</span>`);
    if (fundsRows.length >= 2) mountChart($('#fin-funds'), (W) => lineChart(fundsRows.map((r) => ({ date: r.date, v: r.funds })), W, { height: 170, color: '#8fa3b8' }));
    else $('#fin-funds').innerHTML = emptyBox(tr('Geçmiş birikiyor', 'Building history'), tr('Fon grafiği 2. günden itibaren görünür.', 'The funds chart appears from day 2.'));
  }
  // 30-day revenue sparkline; the global svg rule (17 px stroked icon) is reset in styles.css (.fin-spark).
  function spark(series, color) {
    if (series.length < 2) return '<span class="fin-spark-empty muted">—</span>';
    const vals = series.map((p) => p.v), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const d = series.map((p, k) => `${k ? 'L' : 'M'}${((k / (series.length - 1)) * 100).toFixed(1)},${(22 - ((p.v - lo) / span) * 20).toFixed(1)}`).join(' ');
    return `<svg class="fin-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" style="stroke:${color}"/></svg>`;
  }

  /* ---------- page ---------- */
  function renderFinance() {
    const body = $('#finance-body');
    if (!body || state.view !== 'finance') return;
    const active = activeTab();
    if (!active) return;
    const refocus = !!document.activeElement?.closest?.('.fin-tabs');
    // mountChart() (features.js) observes every chart element; stop watching the ones about to be replaced,
    // or each re-render (period click, the 2-minute company refresh) would keep the old charts in memory.
    body.querySelectorAll('.chart').forEach((el) => { if (el._observed) { chartRO?.unobserve(el); el._observed = false; } });
    body.innerHTML = `${tabCards(active)}
      <div class="stack fin-panel" id="fin-wealth" role="tabpanel" aria-labelledby="fin-tab-wealth"${active === 'wealth' ? '' : ' hidden'}></div>
      <div class="stack fin-panel" id="fin-company" role="tabpanel" aria-labelledby="fin-tab-company"${active === 'company' ? '' : ' hidden'}></div>`;
    if (active === 'wealth') renderWealth($('#fin-wealth'));
    else renderCompanyTab($('#fin-company'));
    if (refocus) $(`.fin-tab[data-fin-tab="${active}"]`)?.focus();
  }
  async function loadFinance(force = false) {
    if (!anyTab()) return;
    renderFinance();
    if (!tabs().wealth) return;
    try {
      st.nw = await api('/api/networth' + (force ? '?force=1' : ''));
      st.nwErr = null;
    } catch (e) { st.nwErr = e; }
    renderFinance();
  }
  function setTab(tab) {
    if (tab !== 'wealth' && tab !== 'company') return;
    st.tab = tab;
    lsSet('tt.finance.tab', tab);
    renderFinance();
  }
  // Old page names open Finance on the matching tab (sidebar links, Overview tiles, #networth / #income hashes).
  function alias(view) {
    if (view === 'networth' || view === 'income') { st.tab = view === 'income' ? 'company' : 'wealth'; lsSet('tt.finance.tab', st.tab); return 'finance'; }
    return view;
  }
  // Company mode or a switch changed: show / hide the sidebar item and fall back when the open tab is gone.
  function syncFinance() {
    const nav = $('.nav-item[data-view="finance"]');
    if (nav) nav.hidden = !anyTab();
    if (state.view !== 'finance') return;
    if (!anyTab()) { showView('overview'); try { history.replaceState(null, '', '#overview'); } catch {} return; }
    if (tabs().wealth && !st.nw && !st.nwErr) loadFinance();
    else renderFinance();
  }

  const body = $('#finance-body');
  body?.addEventListener('click', (e) => {
    const t = e.target.closest('.fin-tab');
    if (t) { setTab(t.dataset.finTab); return; }
    const b = e.target.closest('[data-fin-period] button[data-days]');
    if (!b) return;
    if (b.parentElement.dataset.finPeriod === 'nw') { st.nwDays = Number(b.dataset.days); lsSet('tt.finance.nwPeriod', String(st.nwDays)); }
    else { st.coDays = b.dataset.days; lsSet('tt.finance.coPeriod', st.coDays); }
    renderFinance();
  });
  body?.addEventListener('keydown', (e) => {
    const t = e.target.closest?.('.fin-tab');
    if (!t || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const list = [...body.querySelectorAll('.fin-tab')];
    const k = list.indexOf(t);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (k + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
    e.preventDefault();
    list[next].focus();
    setTab(list[next].dataset.finTab);
  });
  // <details> toggle does not bubble: listen in the capture phase and remember closed groups across re-renders.
  body?.addEventListener('toggle', (e) => {
    const g = e.target.dataset?.group;
    if (!g) return;
    if (e.target.open) st.closed.delete(g); else st.closed.add(g);
  }, true);

  FEATURE_HOOKS.push(syncFinance);
  window.loadFinance = loadFinance;
  window.renderFinanceCompany = () => { if (state.view === 'finance') renderFinance(); };
  window.syncFinance = syncFinance;
  window.LRXFinance = Object.freeze({ alias, setTab, tabs, anyTab });
})();
