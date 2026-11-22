/* =========================================================
   LRX Travel Departure Planner UI (loaded after features.js & travel-planner.js)
   Renders the collapsible Departure Planner HUD + 24h interactive timeline inside
   #tv-planner on the Travel Profit page.
   ========================================================= */
(() => {
  const TRAVEL_URL = 'https://www.torn.com/travelagency.php';
  const plannerState = {
    hidden: lsGet('tt.dp.hidden', '0') === '1',
    optimizeFor: lsGet('tt.dp.opt', 'max_profit'),
    priceMode: lsGet('tt.dp.price', 'market_tax'),
    category: lsGet('tt.dp.cat', 'all'),
    timelineMode: lsGet('tt.dp.tmode', 'profit') === 'cash' ? 'cash' : 'profit',
    includeCurrentFlight: lsGet('tt.dp.curFlight', '1') !== '0',
    watchOnly: lsGet('tt.dp.watchOnly', '0') === '1',
    optionsOpen: false,
    excluded: new Set(),
  };

  const hhmmUtc = (sec) => {
    if (!sec) return '—';
    const d = new Date(sec * 1000);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };
  const hmsCountdown = (sec) => {
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) return `${h}${tr('sa', 'h')} ${String(m).padStart(2, '0')}${tr('dk', 'm')} ${String(r).padStart(2, '0')}${tr('sn', 's')}`;
    return `${m}${tr('dk', 'm')} ${String(r).padStart(2, '0')}${tr('sn', 's')}`;
  };
  const flightHrs = (sec) => {
    const m = Math.round((sec || 0) / 60);
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h > 0 ? `${h}${tr('sa', 'h')} ${r}${tr('dk', 'm')}` : `${r}${tr('dk', 'm')}`;
  };

  function renderTimeline(plan) {
    const start = plan.nowSec;
    const span = Math.max(3600, plan.horizonEnd - start);
    const pctX = (ts) => Math.max(0, Math.min(100, ((ts - start) / span) * 100));

    // 3-hour axis ticks
    const firstTick = Math.ceil(start / (3 * 3600)) * (3 * 3600);
    const ticks = [];
    for (let ts = firstTick; ts < plan.horizonEnd; ts += 3 * 3600) {
      ticks.push({ x: pctX(ts), label: hhmmUtc(ts) });
    }
    const midX = plan.midnight > start && plan.midnight < plan.horizonEnd ? pctX(plan.midnight) : null;

    // Active flight segment
    let activeHtml = '';
    if (plan.inFlight && plan.currentFlight) {
      const endX = pctX(plan.currentFlight.backHomeAt);
      const w = Math.max(2.5, endX);
      activeHtml = `<div class="dp-cur-flight" style="left:0%;width:${w.toFixed(2)}%" title="${esc(tr('Mevcut uçuş', 'Current flight'))}: ${esc(plan.currentFlight.destination)}">
        <span class="dp-back-pill">🏠 ${tr('dönüş', 'back home')} ~${hhmmUtc(plan.currentFlight.backHomeAt)}</span>
      </div>`;
    }

    // Planned stops (stagger labels vertically so neighboring stops never collide)
    const stopsHtml = plan.stops.map((s, idx) => {
      const x0 = pctX(s.departAt);
      const x1 = pctX(Math.min(s.returnAt, plan.horizonEnd));
      const xLand = pctX(Math.min(s.arriveAt, plan.horizonEnd));
      const width = Math.max(2.2, x1 - x0);
      const tier = idx % 2 === 0 ? 'hi' : 'lo';
      const valText = plannerState.timelineMode === 'cash'
        ? cmoney(s.carry)
        : `+${cmoney(s.profit)}`;
      const tip = `${s.itemName} · ${s.countryName} (×${s.units})\n${tr('Kalkış', 'Depart')}: ${hhmmUtc(s.departAt)} TCT → ${tr('İniş', 'Land')}: ${hhmmUtc(s.arriveAt)} → ${tr('Dönüş', 'Home')}: ${hhmmUtc(s.returnAt)}\n${tr('Kâr', 'Profit')}: +${money(s.profit)} · ${tr('Nakit', 'Cash')}: ${money(s.carry)}\n${tr('Bu durağı plandan çıkarmak için tıkla', 'Click to remove this stop from the plan')}`;
      return `<div class="dp-seg" style="left:${x0.toFixed(2)}%;width:${width.toFixed(2)}%">
          <span class="dp-seg-dep mono">✈ ${hhmmUtc(s.departAt)}</span>
          <span class="dp-seg-ret mono">${hhmmUtc(s.returnAt)} ⌂</span>
        </div>
        <button type="button" class="dp-stop dp-tier-${tier}${s.afterMidnight ? ' after-mid' : ''}" data-dp-exclude="${esc(s.key)}" style="left:${xLand.toFixed(2)}%" title="${esc(tip)}">
          <span class="dp-pill mono ${plannerState.timelineMode === 'cash' ? 'cash' : 'profit'}">${esc(valText)}${s.afterMidnight ? ' 🌙' : ''}</span>
          <span class="dp-stem" aria-hidden="true"></span>
          <span class="dp-node" style="border-color:${s.meta.color}">${esc(s.meta.abbr)}</span>
        </button>`;
    }).join('');

    const nowClock = new Date(plan.nowSec * 1000).toISOString().slice(11, 19);
    const s = plan.summary;
    return `<div class="dp-timeline-card">
      <div class="dp-tl-head">
        <div class="dp-tl-left">
          <div class="toggle" role="group" aria-label="${tr('Zaman çizelgesi görünümü', 'Timeline mode')}">
            <button type="button" data-dp-tmode="profit" class="${plannerState.timelineMode === 'profit' ? 'active' : ''}">${tr('Kâr', 'Profit')}</button>
            <button type="button" data-dp-tmode="cash" class="${plannerState.timelineMode === 'cash' ? 'active' : ''}">${tr('Gereken nakit', 'Cash to take')}</button>
          </div>
          <span class="dp-live-clock mono"><i class="dp-dot"></i>${tr('Saat', "It's")} <b id="dp-tct-now">${nowClock}</b> TCT</span>
        </div>
        <div class="dp-tl-totals">
          <span class="pos mono">${tr('bugün', 'today')} +${money(s.todayProfit)}</span>
          ${s.afterMidnightProfit > 0 ? `<span class="muted mono">🌙 ${tr('gece yarısı sonrası', 'after midnight')} +${money(s.afterMidnightProfit)}</span>` : ''}
          ${plannerState.excluded.size ? `<button class="btn sm ghost" type="button" id="dp-restore">↺ ${tr(`${plannerState.excluded.size} çıkarılanı geri al`, `Restore ${plannerState.excluded.size} removed`)}</button>` : ''}
        </div>
      </div>
      <div class="dp-tl-scroll">
        <div class="dp-tl-stage">
          ${midX != null ? `<div class="dp-midnight" style="left:${midX.toFixed(2)}%"><span>00:00</span></div>` : ''}
          <div class="dp-track" aria-hidden="true"></div>
          <div class="dp-now-pin" title="Now"><span>${tr('şimdi', 'now')}</span></div>
          ${activeHtml}
          ${stopsHtml || `<div class="dp-empty-tl muted">${tr('Mevcut filtrelerle önümüzdeki 24 saat için planlanabilir uçuş bulunamadı.', 'No flights could be scheduled in the next 24h with the current options.')}</div>`}
          <div class="dp-axis">${ticks.map((tk) => `<span class="dp-tick mono" style="left:${tk.x.toFixed(2)}%">${tk.label}</span>`).join('')}</div>
        </div>
      </div>
      <div class="dp-tl-foot">
        <span class="sub-text">✈ ${tr('kalkış', 'leave')} · ${tr('rozet = iniş', 'badge = landing')} · ⌂ ${tr('dönüş', 'home')}${plan.inFlight ? ` · <span class="dp-cur-key"></span> ${tr('mevcut uçuş', 'current flight')}` : ''}</span>
        <span class="sub-text">${tr('Bir durağa tıkla: plandan çıkar', 'Click a stop to remove it from the plan')}</span>
      </div>
    </div>`;
  }

  function renderDeparturePlanner() {
    const host = $('#tv-planner');
    if (!host) return;
    if (!feat('travel.planner') || !travelState.data || !window.LRXTravelPlanner) {
      host.innerHTML = '';
      return;
    }
    const d = travelState.data;
    const nowSec = Math.floor(nowTct() / 1000);
    const method = travelMethod();
    const cap = travelState.cap;
    const trip = d.trip || state.overview?.trip || null;
    const wallet = d.wallet != null ? d.wallet : null;

    const types = [...new Set((d.countries || []).flatMap((c) => (c.items || []).map((i) => i.type)).filter(Boolean))].sort();
    const plan = LRXTravelPlanner.buildDeparturePlan({
      countries: d.countries || [],
      nowSec,
      cap,
      method,
      wallet,
      trip,
      priceMode: plannerState.priceMode,
      optimizeFor: plannerState.optimizeFor,
      category: plannerState.category,
      watchSet: travelState.watch,
      watchOnly: plannerState.watchOnly,
      excludedKeys: plannerState.excluded,
      includeCurrentFlight: plannerState.includeCurrentFlight,
    });

    const opt = (v, label, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
    const methodMatches = d.detectedMethod && d.detectedMethod === method;
    const capHint = d.detectedBaseCap != null ? tr(`Torn temel+perk: ${d.detectedBaseCap} (+bavul)`, `Torn base+perks: ${d.detectedBaseCap} (+suitcase)`) : '';

    const head = `<div class="dp-top">
      <div class="dp-top-l">
        <span class="dp-title">✈ ${tr('KALKIŞ PLANLAYICI', 'DEPARTURE PLANNER')}</span>
        <label class="dp-ctl"><span>${tr('Hedef', 'Optimize for')}</span>
          <select id="dp-opt">
            ${opt('max_profit', tr('Maks. $', 'Max $'), plannerState.optimizeFor)}
            ${opt('max_per_hour', tr('Maks. $/sa', 'Max $/hr'), plannerState.optimizeFor)}
            ${opt('short_flights', tr('Kısa uçuşlar', 'Short flights'), plannerState.optimizeFor)}
          </select>
        </label>
        <label class="dp-ctl"><span>${tr('Satış', 'Sell price')}</span>
          <select id="dp-price">
            ${opt('market_tax', tr('Market −%5', 'Market −5%'), plannerState.priceMode)}
            ${opt('market', tr('Bazaar (%0)', 'Bazaar (0%)'), plannerState.priceMode)}
            ${opt('npc', tr('NPC (%0)', 'NPC Shop (0%)'), plannerState.priceMode)}
          </select>
        </label>
        <label class="dp-ctl"><span>${tr('Liste', 'Plan uses')}</span>
          <select id="dp-cat">
            ${opt('all', `${tr('Karışık', 'Mixed')} (${plan.eligibleCount})`, plannerState.category)}
            ${types.map((x) => opt(esc(x), esc(x), plannerState.category)).join('')}
          </select>
        </label>
        <button class="btn sm ghost" type="button" id="dp-opts-btn">⚙ ${tr('Seçenekler', 'Options')}${plannerState.watchOnly || !plannerState.includeCurrentFlight ? ' · 1' : ''}</button>
      </div>
      <div class="dp-top-r">
        <span class="dp-badge" title="${esc(capHint)}">${tr('Bilet', 'Ticket')}: <b>${esc(method)}</b> · ${tr('Kapasite', 'Carrying')}: <b class="mono">${cap}</b>${methodMatches ? ` <span class="dp-match">✦ ${tr('Torn ile eşleşti', 'Matches Torn')}</span>` : ''}</span>
        <button class="btn sm ghost" type="button" id="dp-hide">${plannerState.hidden ? tr('Göster', 'Show') : tr('Gizle', 'Hide')}</button>
      </div>
    </div>`;

    if (plannerState.hidden) {
      host.innerHTML = `<article class="glass card dp-card is-collapsed">${head}</article>`;
      return;
    }

    const optsPanel = plannerState.optionsOpen ? `<div class="dp-options-bar">
      <label class="check"><input type="checkbox" id="dp-cur-flight" ${plannerState.includeCurrentFlight ? 'checked' : ''}> ${tr('Mevcut uçuş bitince başlat', 'Start after current flight lands')}</label>
      <label class="check"><input type="checkbox" id="dp-watch-only" ${plannerState.watchOnly ? 'checked' : ''}> ★ ${tr('Yalnızca takip ettiğim ürünler', 'Watched items only')}</label>
      <span class="sub-text">${wallet != null ? `${tr('Cüzdan', 'Wallet')}: <b class="mono">${money(wallet)}</b>` : tr('Cüzdan bilgisi alınamadı', 'Wallet unavailable')}</span>
    </div>` : '';

    const flightBanner = plan.inFlight && plan.currentFlight ? `<div class="dp-banner">
      <span>✈ ${plannerState.includeCurrentFlight
        ? tr(`Şu an uçuştesin (${esc(plan.currentFlight.destination)}); plan Torn'a döndüğünde (~${hhmmUtc(plan.currentFlight.backHomeAt)} TCT) başlar.`, `You're in flight (${esc(plan.currentFlight.destination)}); the plan starts once you're back in Torn (~${hhmmUtc(plan.currentFlight.backHomeAt)} TCT).`)
        : tr(`Şu an uçuştesin (${esc(plan.currentFlight.destination)}), ancak plan şimdiden hesaplanıyor.`, `You're in flight (${esc(plan.currentFlight.destination)}), showing plan from now.`)}</span>
      <button class="btn sm ghost" type="button" id="dp-toggle-flight">${plannerState.includeCurrentFlight ? tr('Şimdiden başlat', 'Start now') : tr('Dönüşten başlat', 'Wait for return')}</button>
    </div>` : '';

    const nf = plan.nextFlight;
    const s = plan.summary;
    const bc = plan.biggestCarry;
    const todayPct = s.totalProfit > 0 ? Math.min(100, (s.todayProfit / s.totalProfit) * 100) : 0;

    const nextCard = nf ? `<div class="dp-kpi dp-kpi-next">
      <div class="dp-kpi-head"><span class="eyebrow">${tr('SONRAKİ UÇUŞ', 'NEXT FLIGHT')}</span><button class="btn sm ghost" type="button" data-open-url="${TRAVEL_URL}" data-tab-label="Travel Agency">✈ ${tr('Uç', 'Fly')} ↗</button></div>
      <div class="dp-next-cd mono" data-dp-depart="${nf.departAt}">${nf.departAt > nowSec ? `${tr('kalkışa', 'leave in')} ${hmsCountdown(nf.departAt - nowSec)}` : tr('Şimdi kalk!', 'Leave now!')}</div>
      <div class="dp-next-item"><b>${esc(nf.itemName)}</b> <span class="chip dim">${esc(nf.meta.abbr)} · ${esc(nf.countryName)}</span> <span class="mono sub-text">${hhmmUtc(nf.departAt)}–${hhmmUtc(nf.returnAt)}</span></div>
      <div class="dp-take mono">${tr('AL', 'TAKE')} <b>${money(nf.carry)}</b>${nf.cashShort > 0 ? ` <span class="dp-short">${tr('eksik', 'short')} ${money(nf.cashShort)}</span>` : ''}</div>
      ${nf.highCarryRisk ? `<div class="dp-caution">⚠ ${tr('Yüksek nakit taşıma — inişten hemen sonra alım yap', 'High cash carry — buy immediately on landing to reduce mug risk')}</div>` : ''}
    </div>` : `<div class="dp-kpi dp-kpi-next">
      <div class="dp-kpi-head"><span class="eyebrow">${tr('SONRAKİ UÇUŞ', 'NEXT FLIGHT')}</span></div>
      <div class="muted">${tr('Uygun uçuş yok', 'No eligible flight')}</div>
    </div>`;

    const profitCard = `<div class="dp-kpi">
      <div class="dp-kpi-head"><span class="eyebrow">${tr('KÂR', 'PROFIT')}</span><span class="chip warn">${tr('tahmin', 'estimate')}</span></div>
      <div class="dp-kpi-split">
        <div class="dp-big pos mono">+${money(s.todayProfit)}</div>
        ${s.afterMidnightProfit > 0 ? `<div class="dp-after mono">+${money(s.afterMidnightProfit)}</div>` : ''}
      </div>
      <div class="dp-bar"><i style="width:${todayPct.toFixed(1)}%"></i></div>
      <div class="dp-kpi-split sub-text"><span>${tr('bugün', 'today')}</span>${s.afterMidnightProfit > 0 ? `<span>${tr('gece yarısı sonrası', 'after midnight')}</span>` : ''}</div>
      <div class="sub-text dp-foot-note">${tr(`bugün ${s.todayCount} uçuş · +${s.afterMidnightCount} gece yarısı sonrası`, `${s.todayCount} ${s.todayCount === 1 ? 'flight' : 'flights'} left today · +${s.afterMidnightCount} after midnight`)}${plan.inFlight ? ` · ${tr('mevcut uçuş hariç', "not counting current trip")}` : ''}</div>
    </div>`;

    const perHrCard = `<div class="dp-kpi">
      <div class="dp-kpi-head"><span class="eyebrow">${tr('SAATLİK', 'PER HOUR')}</span></div>
      <div class="dp-big pos mono">+${money(s.perHourWhileFlying)}</div>
      <div class="sub-text">${tr('uçuş süresince', 'while flying')}</div>
      <div class="sub-text dp-foot-note">${tr('Toplam uçuş', 'Total flight time')}: <b class="mono">${flightHrs(s.totalFlightSec)}</b> (${s.totalCount} ${tr('sefer', 'trips')})</div>
    </div>`;

    const carryCard = `<div class="dp-kpi">
      <div class="dp-kpi-head"><span class="eyebrow">${tr('EN BÜYÜK NAKİT', 'BIGGEST CARRY')}</span></div>
      <div class="dp-big mono">${bc ? money(bc.carry) : '—'}</div>
      ${bc ? `<div class="sub-text">${esc(bc.itemName)} · ${esc(bc.countryName)}, ${hhmmUtc(bc.departAt)}</div>` : ''}
      ${bc && bc.cashShort > 0 ? `<div class="dp-short mono dp-foot-note">${tr('eksik', 'short')} ${money(bc.cashShort)}</div>` : bc ? `<div class="pos sub-text dp-foot-note">✓ ${tr('Cüzdandaki nakit yeterli', 'Covered by wallet')}</div>` : ''}
    </div>`;

    host.innerHTML = `<article class="glass card dp-card">
      ${head}${optsPanel}${flightBanner}
      <div class="dp-kpis">${nextCard}${profitCard}${perHrCard}${carryCard}</div>
      ${renderTimeline(plan)}
    </article>`;
  }

  // Live 1-second tick for NEXT FLIGHT countdown & TCT clock inside Departure Planner
  setInterval(() => {
    if (state.view !== 'travel' || !trackerVisible() || plannerState.hidden) return;
    const nowSec = Math.floor(nowTct() / 1000);
    const clk = $('#dp-tct-now');
    if (clk) clk.textContent = new Date(nowSec * 1000).toISOString().slice(11, 19);
    const cd = document.querySelector('[data-dp-depart]');
    if (cd) {
      const dep = Number(cd.dataset.dpDepart);
      cd.textContent = dep > nowSec ? `${tr('kalkışa', 'leave in')} ${hmsCountdown(dep - nowSec)}` : tr('Şimdi kalk!', 'Leave now!');
    }
  }, 1000);

  // Delegated listeners on #travel-body (persists across renders)
  const travelBody = $('#travel-body');
  travelBody?.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'dp-opt') { plannerState.optimizeFor = e.target.value; lsSet('tt.dp.opt', plannerState.optimizeFor); renderDeparturePlanner(); }
    else if (id === 'dp-price') { plannerState.priceMode = e.target.value; lsSet('tt.dp.price', plannerState.priceMode); renderDeparturePlanner(); }
    else if (id === 'dp-cat') { plannerState.category = e.target.value; lsSet('tt.dp.cat', plannerState.category); renderDeparturePlanner(); }
    else if (id === 'dp-cur-flight') { plannerState.includeCurrentFlight = e.target.checked; lsSet('tt.dp.curFlight', e.target.checked ? '1' : '0'); renderDeparturePlanner(); }
    else if (id === 'dp-watch-only') { plannerState.watchOnly = e.target.checked; lsSet('tt.dp.watchOnly', e.target.checked ? '1' : '0'); renderDeparturePlanner(); }
  });
  travelBody?.addEventListener('click', (e) => {
    if (e.target.closest('#dp-hide')) {
      plannerState.hidden = !plannerState.hidden;
      lsSet('tt.dp.hidden', plannerState.hidden ? '1' : '0');
      renderDeparturePlanner();
      return;
    }
    if (e.target.closest('#dp-opts-btn')) { plannerState.optionsOpen = !plannerState.optionsOpen; renderDeparturePlanner(); return; }
    if (e.target.closest('#dp-toggle-flight')) {
      plannerState.includeCurrentFlight = !plannerState.includeCurrentFlight;
      lsSet('tt.dp.curFlight', plannerState.includeCurrentFlight ? '1' : '0');
      renderDeparturePlanner();
      return;
    }
    const tm = e.target.closest('[data-dp-tmode]');
    if (tm) { plannerState.timelineMode = tm.dataset.dpTmode; lsSet('tt.dp.tmode', plannerState.timelineMode); renderDeparturePlanner(); return; }
    const ex = e.target.closest('[data-dp-exclude]');
    if (ex) { plannerState.excluded.add(ex.dataset.dpExclude); renderDeparturePlanner(); return; }
    if (e.target.closest('#dp-restore')) { plannerState.excluded.clear(); renderDeparturePlanner(); }
  });

  window.renderDeparturePlanner = renderDeparturePlanner;
  FEATURE_HOOKS.push(() => { if (state.view === 'travel') renderDeparturePlanner(); });
})();
