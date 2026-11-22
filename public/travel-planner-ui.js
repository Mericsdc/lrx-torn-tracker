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

  // Line icons in the app's style (stroke = currentColor). Sized by .dp-i, never by the global 17px svg rule.
  const svg = (body) => `<svg class="dp-i" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  const ICON = {
    plane: svg('<path d="M2 16l20-7-4-2-6 2-6-4-2 1 4 5-4 1-2-1-1 1 3 3z"/>'), // same plane as the Travel Profit nav item
    home: svg('<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'),
    moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
    trend: svg('<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    wallet: svg('<path d="M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v3"/><path d="M3 6v12a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-3"/><path d="M21 12h-4a2 2 0 0 0 0 4h4z"/>'),
    sliders: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
    alert: svg('<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4M12 17h.01"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    undo: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
    out: svg('<path d="M7 17 17 7M8 7h9v9"/>'),
  };

  function renderTimeline(plan) {
    const start = plan.nowSec;
    const span = Math.max(3600, plan.horizonEnd - start);
    const pctX = (ts) => Math.max(0, Math.min(100, ((ts - start) / span) * 100));
    const at = (x) => `left:${x.toFixed(2)}%`;
    const cash = plannerState.timelineMode === 'cash';

    // 3-hour axis ticks. Midnight is always one of them (TCT = UTC), so it is marked on its tick, not with a second label.
    const firstTick = Math.ceil(start / (3 * 3600)) * (3 * 3600);
    const ticks = [];
    for (let ts = firstTick; ts < plan.horizonEnd; ts += 3 * 3600) ticks.push({ x: pctX(ts), label: hhmmUtc(ts), mid: ts === plan.midnight });
    const midX = plan.midnight > start && plan.midnight < plan.horizonEnd ? pctX(plan.midnight) : null;

    // Time labels and value pills carry data-x (percent) and are spread into rows/lanes by layoutTimeline() after render.
    const timeLabel = (x, anchor, pri, html, cls = '') => `<span class="dp-time mono${cls}" data-x="${x.toFixed(3)}" data-anchor="${anchor}" data-pri="${pri}" style="${at(x)}">${html}</span>`;

    let activeHtml = '';
    if (plan.inFlight && plan.currentFlight) {
      const endX = pctX(plan.currentFlight.backHomeAt);
      activeHtml = `<div class="dp-cur-flight" style="left:0%;width:${Math.max(2.5, endX).toFixed(2)}%" title="${esc(tr('Mevcut uçuş', 'Current flight'))}: ${esc(plan.currentFlight.destination)} · ${esc(tr('dönüş', 'back home'))} ~${hhmmUtc(plan.currentFlight.backHomeAt)} TCT"></div>
        ${timeLabel(endX, 'end', 3, `~${hhmmUtc(plan.currentFlight.backHomeAt)} ${ICON.home}`, ' is-cur')}`;
    }

    const stopsHtml = plan.stops.map((s, idx) => {
      const x0 = pctX(s.departAt);
      const x1 = pctX(Math.min(s.returnAt, plan.horizonEnd));
      const xLand = pctX(Math.min(s.arriveAt, plan.horizonEnd));
      const valText = cash ? cmoney(s.carry) : `+${cmoney(s.profit)}`;
      const tip = `${s.itemName} · ${s.countryName} (×${s.units})\n${tr('Kalkış', 'Depart')}: ${hhmmUtc(s.departAt)} TCT → ${tr('İniş', 'Land')}: ${hhmmUtc(s.arriveAt)} → ${tr('Dönüş', 'Home')}: ${hhmmUtc(s.returnAt)}\n${tr('Kâr', 'Profit')}: +${money(s.profit)} · ${tr('Nakit', 'Cash')}: ${money(s.carry)}\n${tr('Bu durağı plandan çıkarmak için tıkla', 'Click to remove this stop from the plan')}`;
      const next = idx === 0 ? ' is-next' : '';
      return `<div class="dp-seg${next}" style="${at(x0)};width:${Math.max(0.8, x1 - x0).toFixed(2)}%"></div>
        ${timeLabel(x0, 'start', 2, `${ICON.plane} ${hhmmUtc(s.departAt)}`, next)}
        ${timeLabel(x1, 'end', 1, `${hhmmUtc(s.returnAt)} ${ICON.home}`)}
        <button type="button" class="dp-stop${next}${s.afterMidnight ? ' after-mid' : ''}" data-lane="0" data-x="${xLand.toFixed(3)}" data-dp-exclude="${esc(s.key)}" style="${at(xLand)}" title="${esc(tip)}" aria-label="${esc(`${s.itemName} · ${s.countryName} · ${hhmmUtc(s.departAt)}`)}">
          <span class="dp-pill mono ${cash ? 'cash' : 'profit'}">${esc(valText)}</span>
          <span class="dp-stem" aria-hidden="true"></span>
          <span class="dp-node mono" style="--dp-c:${esc(s.meta.color)}">${esc(s.meta.abbr)}</span>
        </button>`;
    }).join('');

    const nowClock = new Date(plan.nowSec * 1000).toISOString().slice(11, 19);
    const s = plan.summary;
    return `<div class="dp-timeline-card">
      <div class="dp-tl-head">
        <div class="dp-tl-left">
          <div class="toggle" role="group" aria-label="${tr('Zaman çizelgesi görünümü', 'Timeline mode')}">
            <button type="button" data-dp-tmode="profit" class="${!cash ? 'active' : ''}">${tr('Kâr', 'Profit')}</button>
            <button type="button" data-dp-tmode="cash" class="${cash ? 'active' : ''}">${tr('Gereken nakit', 'Cash to take')}</button>
          </div>
          <span class="dp-live-clock"><i class="dp-dot"></i>${tr('Saat', "It's")} <b id="dp-tct-now" class="mono">${nowClock}</b> TCT</span>
        </div>
        <div class="dp-tl-totals">
          <span class="dp-total"><small>${tr('bugün', 'today')}</small> <b class="pos mono">+${money(s.todayProfit)}</b></span>
          ${s.afterMidnightProfit > 0 ? `<span class="dp-total">${ICON.moon}<small>${tr('gece yarısı sonrası', 'after midnight')}</small> <b class="mono">+${money(s.afterMidnightProfit)}</b></span>` : ''}
          ${plannerState.excluded.size ? `<button class="btn sm ghost" type="button" id="dp-restore">${ICON.undo} ${tr(`${plannerState.excluded.size} çıkarılanı geri al`, `Restore ${plannerState.excluded.size} removed`)}</button>` : ''}
        </div>
      </div>
      <div class="dp-tl-scroll">
        <div class="dp-tl-stage">
          ${midX != null ? `<div class="dp-midnight" style="${at(midX)}" aria-hidden="true"></div>` : ''}
          <div class="dp-track" aria-hidden="true"></div>
          <div class="dp-now-pin" aria-hidden="true"></div>
          ${activeHtml}
          ${stopsHtml || `<div class="dp-empty-tl muted">${tr('Mevcut filtrelerle önümüzdeki 24 saat için planlanabilir uçuş bulunamadı.', 'No flights could be scheduled in the next 24h with the current options.')}</div>`}
          <div class="dp-axis"><span class="dp-now-label">${tr('şimdi', 'now')}</span>${ticks.map((tk) => `<span class="dp-tick mono${tk.mid ? ' is-mid' : ''}" style="${at(tk.x)}">${tk.mid ? ICON.moon : ''}${tk.label}</span>`).join('')}</div>
        </div>
      </div>
      <div class="dp-tl-foot">
        <span class="dp-legend"><span>${ICON.plane}${tr('kalkış', 'leave')}</span><span><i class="dp-legend-node">CA</i>${tr('iniş', 'landing')}</span><span>${ICON.home}${tr('dönüş', 'home')}</span>${plan.inFlight ? `<span><i class="dp-cur-key"></i>${tr('mevcut uçuş', 'current flight')}</span>` : ''}</span>
        <span>${tr('Bir durağa tıkla: plandan çıkar', 'Click a stop to remove it from the plan')}</span>
      </div>
    </div>`;
  }

  // Spread labels so none overlap: value pills go to the lowest free lane above the track (3 lanes), time labels to
  // the first free row below it (2 rows; departures first, a return time that still collides is left to the tooltip),
  // and axis ticks that would run into the "now" label are hidden. Needs real widths, so it runs after render and on resize.
  const GAP = 6;
  const overlaps = (row, a, b) => row.some(([l, r]) => a < r + GAP && b > l - GAP);
  function layoutTimeline(stage) {
    const W = stage?.clientWidth;
    if (!W) return;
    const laneEnd = [-Infinity, -Infinity, -Infinity];
    for (const stop of stage.querySelectorAll('.dp-stop')) {
      const pill = stop.querySelector('.dp-pill');
      const w = pill.offsetWidth, cx = Number(stop.dataset.x) / 100 * W;
      const left = Math.min(Math.max(cx - w / 2, 0), Math.max(0, W - w));
      let lane = laneEnd.findIndex((end) => left >= end + GAP);
      if (lane < 0) lane = laneEnd.indexOf(Math.min(...laneEnd));
      laneEnd[lane] = left + w;
      stop.dataset.lane = String(lane);
      // Clamped at the stage edges: shift only the pill, the stem and badge stay on the landing time.
      pill.style.transform = Math.abs(left - (cx - w / 2)) > 0.5 ? `translateX(${(left - (cx - w / 2)).toFixed(1)}px)` : '';
    }
    const rows = [[], []];
    const labels = [...stage.querySelectorAll('.dp-time')].map((el) => {
      el.hidden = false;
      const w = el.offsetWidth, x = Number(el.dataset.x) / 100 * W;
      const left = Math.min(Math.max(el.dataset.anchor === 'end' ? x - w : x, 0), Math.max(0, W - w));
      return { el, left, right: left + w, x, pri: Number(el.dataset.pri) || 0 };
    }).sort((a, b) => b.pri - a.pri || a.x - b.x);
    for (const l of labels) {
      const row = rows.findIndex((r) => !overlaps(r, l.left, l.right));
      if (row < 0) { l.el.hidden = true; continue; }
      rows[row].push([l.left, l.right]);
      l.el.dataset.row = String(row);
      l.el.style.left = `${l.left.toFixed(1)}px`;
    }
    // Only reserve height for the lanes and rows actually used (see .dp-tl-stage in styles.css).
    const lanesUsed = Math.max(0, ...[...stage.querySelectorAll('.dp-stop')].map((s) => Number(s.dataset.lane) || 0)) + 1;
    stage.style.setProperty('--lift', `${(3 - lanesUsed) * 23}px`);
    stage.style.setProperty('--rowlift', rows[1].length ? '0px' : '16px');
    const nowLabel = stage.querySelector('.dp-now-label');
    const nowEnd = nowLabel ? nowLabel.offsetWidth : 0;
    for (const tick of stage.querySelectorAll('.dp-tick')) {
      tick.hidden = false;
      tick.hidden = tick.offsetLeft - tick.offsetWidth / 2 < nowEnd + GAP;
    }
  }
  let stageObserver = null;
  function watchTimeline(host) {
    const stage = host.querySelector?.('.dp-tl-stage');
    stageObserver?.disconnect();
    if (!stage) return;
    layoutTimeline(stage);
    if (typeof ResizeObserver === 'function') {
      // Only a width change moves labels. The layout also changes the stage height, so it runs in the next frame,
      // never inside the observer callback (that would raise a ResizeObserver loop error).
      let width = stage.clientWidth;
      stageObserver = new ResizeObserver(() => {
        if (stage.clientWidth === width) return;
        width = stage.clientWidth;
        requestAnimationFrame(() => layoutTimeline(stage));
      });
      stageObserver.observe(stage);
    }
  }
  // Mono/sans web fonts can finish loading after the first layout and change label widths.
  document.fonts?.ready?.then(() => { const stage = document.querySelector('#tv-planner .dp-tl-stage'); if (stage) layoutTimeline(stage); });

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
    const optionCount = (plannerState.watchOnly ? 1 : 0) + (plannerState.includeCurrentFlight ? 0 : 1);

    const head = `<div class="card-head dp-head">
      <div class="dp-head-text">
        <h3><span class="dp-head-ico">${ICON.plane}</span>${tr('Kalkış planlayıcı', 'Departure planner')}</h3>
        <span class="muted" title="${esc(capHint)}">${tr('Önümüzdeki 24 saatin uçuşları', 'Your flights for the next 24 hours')} · ${tr('Bilet', 'Ticket')} <b>${esc(method)}</b> · ${tr('Kapasite', 'Carrying')} <b class="mono">${cap}</b>${methodMatches ? ` <span class="dp-match">${ICON.check}${tr('Torn ile aynı', 'matches Torn')}</span>` : ''}</span>
      </div>
      <div class="dp-head-actions">
        ${plannerState.hidden ? '' : `<button class="btn sm ghost${plannerState.optionsOpen ? ' active' : ''}" type="button" id="dp-opts-btn" aria-expanded="${plannerState.optionsOpen}">${ICON.sliders} ${tr('Seçenekler', 'Options')}${optionCount ? ` <span class="dp-count">${optionCount}</span>` : ''}</button>`}
        <button class="btn sm ghost" type="button" id="dp-hide">${plannerState.hidden ? tr('Göster', 'Show') : tr('Gizle', 'Hide')}</button>
      </div>
    </div>`;

    if (plannerState.hidden) {
      host.innerHTML = `<article class="glass card dp-card is-collapsed">${head}</article>`;
      return;
    }

    const controls = `<div class="dp-controls">
      <label>${tr('Hedef', 'Optimize for')}
        <select id="dp-opt">
          ${opt('max_profit', tr('Maks. $', 'Max $'), plannerState.optimizeFor)}
          ${opt('max_per_hour', tr('Maks. $/sa', 'Max $/hr'), plannerState.optimizeFor)}
          ${opt('short_flights', tr('Kısa uçuşlar', 'Short flights'), plannerState.optimizeFor)}
        </select>
      </label>
      <label>${tr('Satış', 'Sell price')}
        <select id="dp-price">
          ${opt('market_tax', tr('Market −%5', 'Market −5%'), plannerState.priceMode)}
          ${opt('market', tr('Bazaar (%0)', 'Bazaar (0%)'), plannerState.priceMode)}
          ${opt('npc', tr('NPC (%0)', 'NPC Shop (0%)'), plannerState.priceMode)}
        </select>
      </label>
      <label>${tr('Liste', 'Plan uses')}
        <select id="dp-cat">
          ${opt('all', `${tr('Karışık', 'Mixed')} (${plan.eligibleCount})`, plannerState.category)}
          ${types.map((x) => opt(esc(x), esc(x), plannerState.category)).join('')}
        </select>
      </label>
    </div>`;

    const optsPanel = plannerState.optionsOpen ? `<div class="dp-options-bar">
      <label class="check"><input type="checkbox" id="dp-cur-flight" ${plannerState.includeCurrentFlight ? 'checked' : ''}> ${tr('Mevcut uçuş bitince başlat', 'Start after current flight lands')}</label>
      <label class="check"><input type="checkbox" id="dp-watch-only" ${plannerState.watchOnly ? 'checked' : ''}> ★ ${tr('Yalnızca takip ettiğim ürünler', 'Watched items only')}</label>
      <span class="sub-text">${wallet != null ? `${tr('Cüzdan', 'Wallet')}: <b class="mono">${money(wallet)}</b>` : tr('Cüzdan bilgisi alınamadı', 'Wallet unavailable')}</span>
    </div>` : '';

    const flightBanner = plan.inFlight && plan.currentFlight ? `<div class="dp-banner">
      <span>${ICON.plane} ${plannerState.includeCurrentFlight
        ? tr(`Şu an uçuştesin (${esc(plan.currentFlight.destination)}); plan Torn'a döndüğünde (~${hhmmUtc(plan.currentFlight.backHomeAt)} TCT) başlar.`, `You're in flight (${esc(plan.currentFlight.destination)}); the plan starts once you're back in Torn (~${hhmmUtc(plan.currentFlight.backHomeAt)} TCT).`)
        : tr(`Şu an uçuştesin (${esc(plan.currentFlight.destination)}), ancak plan şimdiden hesaplanıyor.`, `You're in flight (${esc(plan.currentFlight.destination)}), showing plan from now.`)}</span>
      <button class="btn sm ghost" type="button" id="dp-toggle-flight">${plannerState.includeCurrentFlight ? tr('Şimdiden başlat', 'Start now') : tr('Dönüşten başlat', 'Wait for return')}</button>
    </div>` : '';

    const nf = plan.nextFlight;
    const s = plan.summary;
    const bc = plan.biggestCarry;
    const todayPct = s.totalProfit > 0 ? Math.min(100, (s.todayProfit / s.totalProfit) * 100) : 0;
    const eyebrow = (icon, text, extra = '') => `<div class="dp-kpi-head"><span class="dp-eyebrow"><span class="dp-kpi-ico">${icon}</span>${text}</span>${extra}</div>`;

    const nextCard = nf ? `<div class="dp-kpi dp-kpi-next">
      ${eyebrow(ICON.plane, tr('Sonraki uçuş', 'Next flight'), `<button class="btn sm ghost dp-fly" type="button" data-open-url="${TRAVEL_URL}" data-tab-label="Travel Agency">${tr('Uç', 'Fly')} ${ICON.out}</button>`)}
      <div class="dp-kpi-value dp-next-cd" data-dp-depart="${nf.departAt}">${countdownHtml(nf.departAt, nowSec)}</div>
      <div class="dp-next-item"><b>${esc(nf.itemName)}</b><span class="dp-country"><i style="--dp-c:${esc(nf.meta.color)}"></i>${esc(nf.countryName)}</span><span class="mono">${hhmmUtc(nf.departAt)}–${hhmmUtc(nf.returnAt)}</span></div>
      <div class="dp-take">${tr('Yanına al', 'Take')} <b class="mono">${money(nf.carry)}</b>${nf.cashShort > 0 ? ` <span class="dp-short mono">${tr('eksik', 'short')} ${money(nf.cashShort)}</span>` : ''}</div>
      ${nf.highCarryRisk ? `<div class="dp-caution">${ICON.alert}<span>${tr('Yüksek nakit taşıma — inişten hemen sonra alım yap', 'High cash carry — buy immediately on landing to reduce mug risk')}</span></div>` : ''}
    </div>` : `<div class="dp-kpi dp-kpi-next">
      ${eyebrow(ICON.plane, tr('Sonraki uçuş', 'Next flight'))}
      <div class="dp-kpi-value dp-kpi-empty">${tr('Uygun uçuş yok', 'No eligible flight')}</div>
    </div>`;

    const profitCard = `<div class="dp-kpi">
      ${eyebrow(ICON.trend, tr('Kâr', 'Profit'), `<span class="chip dim">${tr('tahmin', 'estimate')}</span>`)}
      <div class="dp-kpi-value pos">+${money(s.todayProfit)}</div>
      <div class="dp-kpi-hint">${tr('bugün', 'today')}</div>
      <div class="dp-bar" title="${esc(tr('Bugün / toplam', 'Today / total'))}"><i style="width:${todayPct.toFixed(1)}%"></i></div>
      ${s.afterMidnightProfit > 0 ? `<div class="dp-kpi-hint dp-after">${ICON.moon}${tr('gece yarısı sonrası', 'after midnight')} <b class="mono">+${money(s.afterMidnightProfit)}</b></div>` : ''}
      <div class="dp-foot-note">${tr(`bugün ${s.todayCount} uçuş · +${s.afterMidnightCount} gece yarısı sonrası`, `${s.todayCount} ${s.todayCount === 1 ? 'flight' : 'flights'} left today · +${s.afterMidnightCount} after midnight`)}${plan.inFlight ? ` · ${tr('mevcut uçuş hariç', 'not counting current trip')}` : ''}</div>
    </div>`;

    const perHrCard = `<div class="dp-kpi">
      ${eyebrow(ICON.clock, tr('Saatlik', 'Per hour'))}
      <div class="dp-kpi-value pos">+${money(s.perHourWhileFlying)}</div>
      <div class="dp-kpi-hint">${tr('uçuş süresince', 'while flying')}</div>
      <div class="dp-foot-note">${tr('Toplam uçuş', 'Total flight time')} <b class="mono">${flightHrs(s.totalFlightSec)}</b> · ${s.totalCount} ${tr('sefer', 'trips')}</div>
    </div>`;

    const carryCard = `<div class="dp-kpi">
      ${eyebrow(ICON.wallet, tr('En büyük nakit', 'Biggest carry'))}
      <div class="dp-kpi-value">${bc ? money(bc.carry) : '—'}</div>
      ${bc ? `<div class="dp-kpi-hint">${esc(bc.itemName)} · ${esc(bc.countryName)} · <span class="mono">${hhmmUtc(bc.departAt)}</span></div>` : ''}
      ${bc && bc.cashShort > 0 ? `<div class="dp-foot-note dp-short mono">${tr('eksik', 'short')} ${money(bc.cashShort)}</div>` : bc ? `<div class="dp-foot-note dp-covered">${ICON.check}${tr('Cüzdandaki nakit yeterli', 'Covered by wallet')}</div>` : ''}
    </div>`;

    host.innerHTML = `<article class="glass card dp-card">
      ${head}${controls}${optsPanel}${flightBanner}
      <div class="dp-kpis">${nextCard}${profitCard}${perHrCard}${carryCard}</div>
      ${renderTimeline(plan)}
    </article>`;
    watchTimeline(host);
  }

  function countdownHtml(departAt, nowSec) {
    return departAt > nowSec
      ? `<small>${tr('kalkışa', 'leave in')}</small> <span class="mono">${hmsCountdown(departAt - nowSec)}</span>`
      : `<span class="dp-go">${tr('Şimdi kalk!', 'Leave now!')}</span>`;
  }

  // Live 1-second tick for NEXT FLIGHT countdown & TCT clock inside Departure Planner
  setInterval(() => {
    if (state.view !== 'travel' || !trackerVisible() || plannerState.hidden) return;
    const nowSec = Math.floor(nowTct() / 1000);
    const clk = $('#dp-tct-now');
    if (clk) clk.textContent = new Date(nowSec * 1000).toISOString().slice(11, 19);
    const cd = document.querySelector('[data-dp-depart]');
    if (cd) cd.innerHTML = countdownHtml(Number(cd.dataset.dpDepart), nowSec);
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
