/* The Overview widget catalogue: every widget's title and, for each Premium widget, what it needs, the page it opens,
   how it loads and its markup at S, M and L. A widget only reads an endpoint its own page already calls (never a new
   Torn request) and only displays it; overview-host.js decides when a tile may load. All Torn text goes through esc().
   Optional fields: `off()` is a Settings switch beyond `needs`, `note()` another reason the tile shows a note instead. */
(() => {
  const titles = {
    profile: ['Profil kartı', 'Profile card'], drug: ['Xanax / drug sayacı', 'Xanax / drug timer'],
    edu: ['Eğitim sayacı', 'Education timer'], day: ['Gün dönümü (18:00 TCT)', 'Day reset (18:00 TCT)'],
    bars: ['Barlar', 'Bars'], chips: ['Durum çipleri', 'Status chips'], battle: ['Savaş gücü', 'Battle stats'],
    company: ['Şirket özeti', 'Company summary'],
    gym: ['Gym kazancı', 'Gym gains'], networth: ['Networth', 'Networth'], travel: ['Seyahat kârı', 'Travel profit'],
    job: ['İş asistanı', 'Job assistant'], crimes: ['Suç merkezi', 'Crime hub'], jail: ['Jail bustları', 'Jail busts'],
    awards: ['Merit takibi', 'Merit tracker'], oc: ['Faction OC', 'Faction OC'], war: ['Savaş', 'War'],
    events: ['Etkinlik takvimi', 'Event calendar'], orders: ['Günlük sipariş önerisi', 'Daily order hint'],
  };

  /* ---------- markup: the one-liner (S), then the lines M and L add ---------- */
  const main = (line, sub = '') => `<p class="ow-t-main">${line}</p>${sub ? `<p class="ow-t-sub muted">${sub}</p>` : ''}`;
  const list = (rows) => (rows.length ? `<ul class="ow-t-list">${rows.map(([label, value]) => `<li><span>${label}</span><span class="mono">${value}</span></li>`).join('')}</ul>` : '');
  const more = (size, m, l = []) => (size === 'S' ? '' : list(size === 'L' ? [...m, ...l] : m));
  const delta = (v, f = cmoney) => `<span class="${deltaCls(v)}">${signed(v, f)}</span>`;
  const perHour = (v) => `${cmoney(v)}/${tr('sa', 'h')}`;

  // Gym & Stats (renderGym): the two stats that grew most since yesterday's record.
  const STATS = [['str', 'Strength'], ['def', 'Defense'], ['spd', 'Speed'], ['dex', 'Dexterity']];
  function gym(d, size) {
    const hist = d?.history || [], last = hist[hist.length - 1];
    if (!last) return main(tr('Henüz kayıt yok', 'No records yet'), tr('Uygulama açık kaldıkça her gün kayıt alınır.', 'A snapshot is saved every day while the app runs.'));
    const ago = (n) => recordBack(hist, n, n === 1);
    const gain = (n, k = 'total') => { const r = ago(n); return r && last[k] != null && r[k] != null ? last[k] - r[k] : null; };
    const stats = STATS.map(([k, name]) => [name, gain(1, k)]).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);
    const top = stats.filter(([, v]) => v > 0).slice(0, 2);
    const line = top.length ? top.map(([name, v]) => `${name} ${signed(v, n0)}`).join(' · ') : ago(1) ? tr('Dünden beri artış yok', 'No gains since yesterday') : tr('Dünkü kayıt yok', 'No record from yesterday');
    return main(line, tr('son 24 saat', 'last 24 hours')) + more(size,
      [[tr('Toplam, 24 saat', 'Total, 24 hours'), delta(gain(1), n0)], [tr('7 günde', 'Last 7 days'), delta(gain(7), n0)]],
      [...stats.slice(top.length).map(([name, v]) => [name, delta(v, n0)]), [tr('30 günde', 'Last 30 days'), delta(gain(30), n0)]]);
  }

  // Networth (renderNetworth): the total and the change since yesterday's record.
  function networth(d, size) {
    const cur = d?.current || {}, hist = d?.history || [];
    const ago = (n) => recordBack(hist, n, n === 1);
    const chg = (n) => { const r = ago(n); return r ? (Number(cur.total) || 0) - r.total : null; };
    const cash = ['wallet', 'bank', 'cayman', 'vault', 'piggybank'].reduce((sum, k) => sum + (Number(cur[k]) || 0), 0);
    return main(cmoney(cur.total), `${delta(chg(1))} ${tr('bugün', 'today')}`)
      + more(size, [[tr('7 günde', 'Last 7 days'), delta(chg(7))], [tr('30 günde', 'Last 30 days'), delta(chg(30))], [tr('Nakit', 'Cash'), money(cash)]]);
  }

  // Travel Profit (travelRows, renderTravelResults): the best item per country, in stock on arrival, by profit per hour,
  // with the capacity and travel method chosen on the Travel page.
  function travelBest(d) {
    const t = travelState, method = t.method || (TRAVEL_METHODS[d.method] ? d.method : 'Standard');
    const mult = TRAVEL_METHODS[method] || 1, now = nowTct() / 1000, cap = Math.max(1, t.cap), best = new Map();
    for (const c of d.countries || []) {
      if (!c.minutes) continue;
      const oneWay = c.minutes * mult, arrive = now + oneWay * 60;
      for (const it of c.items || []) {
        if (!(it.profit > 0) || ['no', 'later', 'stale'].includes(stockStatus(it, now, arrive))) continue;
        const { perHour: rate } = LRXTravelMath.tripMetrics(it.profit, cap, it.qty, oneWay);
        if (rate > (best.get(c.code)?.rate ?? -Infinity)) best.set(c.code, { c, it, rate });
      }
    }
    return [...best.values()].sort((a, b) => b.rate - a.rate);
  }
  function travel(d, size) {
    const [top, ...rest] = d ? travelBest(d) : [];
    if (!top) return main(tr('Varışta stokta kârlı ürün yok', 'No profitable item in stock on arrival'));
    const row = (r) => [`${esc(r.c.name)} · ${esc(r.it.name)}`, perHour(r.rate)];
    return main(`${esc(top.c.name)} · ${esc(top.it.name)}`, perHour(top.rate)) + more(size, rest.slice(0, 2).map(row), rest.slice(2, 4).map(row));
  }

  // Job Assistant (renderJob): job points and the positions the working stats already fit.
  function job(d, size) {
    const w = d?.workstats || {}, jp = d?.jobpoints || {};
    const points = [...Object.entries(jp.jobs || {}).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v]), ...Object.values(jp.companies || {}).map((c) => [c.name, c.jobpoints])]
      .filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const fits = [];
    for (const t of Object.values(d?.types || {})) {
      for (const [pos, p] of Object.entries(t.positions || {})) {
        if ((p.man_required || 0) <= (w.man || 0) && (p.int_required || 0) <= (w.int || 0) && (p.end_required || 0) <= (w.end || 0)) fits.push({ company: t.name, pos, gain: (p.man_gain || 0) + (p.int_gain || 0) + (p.end_gain || 0) });
      }
    }
    fits.sort((a, b) => b.gain - a.gain);
    return main(`${n0(points.reduce((sum, [, v]) => sum + v, 0))} ${tr('iş puanı', 'job points')}`, tr(`${fits.length} pozisyon uygun`, `${fits.length} ${fits.length === 1 ? 'position fits' : 'positions fit'}`))
      + more(size, [...points.slice(0, 2).map(([name, v]) => [esc(name), n0(v)]), ...fits.slice(0, 1).map((f) => [`${esc(f.company)} · ${esc(f.pos)}`, `+${n0(f.gain)}`])]);
  }

  // Crime Hub (shopCard, valueCard): stores with every security down, and the best money per nerve.
  function crimes(d, size) {
    const shop = d?.shop, open = shop ? (shop.stores || []).filter((s) => s.allDown) : [];
    const ranked = [...(d?.cv?.crimes || [])].filter((c) => c.value != null).sort((a, b) => b.value - a.value), best = ranked[0];
    const bestLine = best ? `${esc(best.crime)} · ${cmoney(best.value)}/N` : '';
    const line = shop ? tr(`${open.length} mağaza güvenliksiz`, `${open.length} ${open.length === 1 ? 'shop' : 'shops'} without security`) : bestLine || '—';
    return main(line, shop ? bestLine : esc(best?.best || ''))
      + more(size, open.slice(0, 3).map((s) => [esc(s.name), tr('hepsi kapalı', 'all down')]), ranked.slice(1, 4).map((c) => [esc(c.crime), `${cmoney(c.value)}/N`]));
  }

  // Jail bust tracker (jailCard): busts in the last 24 and 72 hours and the estimated penalty.
  function jail(d, size) {
    return main(`${n0(d?.last24)} / ${n0(d?.last72)}`, `${tr('bust · 24 sa / 72 sa', 'busts · 24 h / 72 h')} · ${tr('ceza', 'penalty')} ${n0(d?.score)}`)
      + more(size, [[tr('Başarılı bust', 'Successful busts'), n0(d?.total?.success)], [tr('Ceza puanı (tahmini)', 'Penalty score (est.)'), n0(d?.score)]]);
  }

  // Merit Tracker (awardRows): the missing award with the most progress.
  function awards(d, size) {
    const [top, ...rest] = (d?.awards || []).filter((a) => !a.owned && a.pct != null).sort((a, b) => b.pct - a.pct || b.circulation - a.circulation);
    if (!top) return main(tr('İlerlemesi ölçülen eksik ödül yok', 'No missing award with progress'));
    return main(esc(top.name), `${pct(top.pct)} · ${n0(top.cur)} / ${n0(top.goal)}`) + more(size, rest.slice(0, 2).map((a) => [esc(a.name), pct(a.pct)]));
  }

  // Faction (myOcCard): the player's own OC, when it is ready and whether its slot is set.
  function oc(d, size) {
    const my = d?.myOc;
    if (!my) return main(tr('OC verisi yok', 'No OC data'));
    if (my.error) return main(tr('OC okunamadı', 'OC not available'), esc(my.error));
    if (!my.inOc) return main(tr("OC'de değilsin", 'Not in an OC'), tr("Torn'daki OC sekmesinden boş bir slota katılabilirsin.", 'You can join an open slot on the OC tab in Torn.'));
    const c = my.crime || {}, s = my.slot || {}, left = c.readyAt ? c.readyAt - nowTct() / 1000 : null;
    const when = left == null ? esc(c.status) : left > 0 ? tr(`${human(left)} sonra hazır`, `ready in ${human(left)}`) : tr('Planlama bitti', 'Planning done');
    const item = s.item ? (s.item.ok ? `✓ ${esc(s.item.name)}` : `✗ ${esc(s.item.name)} ${tr('eksik', 'missing')}`) : tr('eşya gerekmiyor', 'no item needed');
    return main(when, `${n0(c.filled)}/${n0(c.total)} ${tr('slot dolu', 'slots filled')} · ${item}`)
      + more(size, [[tr('Suç', 'Crime'), `${esc(c.name)} · ${esc(c.status)}`], [tr('Rolün', 'Your role'), esc(s.role || '—')]]);
  }

  // War Targets (renderWarChips, computeTargets): the ranked war score; targets only from a list the War page loaded.
  function war(d, size) {
    const wars = d?.wars || [], w = wars.find((x) => /ranked/i.test(x.type || '')) || wars[0];
    const targets = state.targets ? computeTargets() : null;
    const fit = targets ? targets.filter((m) => m.fit === 'ideal' || m.fit === 'easy') : [];
    const count = targets ? tr(`${fit.length} uygun hedef`, `${fit.length} suitable ${fit.length === 1 ? 'target' : 'targets'}`) : tr('Hedefler Savaş sayfasında yüklenir', 'Targets load on the War page');
    const line = !w ? tr('Aktif savaş yok', 'No active war') : w.score != null ? `${n0(w.myScore ?? 0)} – ${n0(w.score)}` : esc(w.type);
    const ready = fit.filter((m) => m.status?.state === 'Okay').sort((a, b) => (b.exp ?? 0) - (a.exp ?? 0));
    return main(line, w ? `${esc(w.name)} · ${count}` : count)
      + more(size, w ? [[tr('Savaş', 'War'), esc(w.type)]] : [], ready.slice(0, 3).map((m) => [esc(m.name), fitLabel(m.fit)]));
  }

  // Event calendar (eventsCard): the next event and its countdown.
  function events(d, size) {
    const now = Date.now() / 1000;
    const [next, ...rest] = (d?.events || []).filter((e) => e.end >= now).sort((a, b) => a.start - b.start);
    if (!next) return main(tr('Yaklaşan etkinlik yok', 'No upcoming events'));
    const when = (e) => (e.start <= now ? tr(`bitişe ${human(e.end - now)}`, `ends in ${human(e.end - now)}`) : tr(`başlamasına ${human(e.start - now)}`, `starts in ${human(e.start - now)}`));
    return main(esc(next.title), when(next)) + more(size, rest.slice(0, 2).map((e) => [esc(e.title), when(e)]));
  }

  // Daily order hint (renderReport): the product closest to running out and what to order today. It reads the
  // company report app.js already keeps (state.company) and never fetches.
  function orders(_, size) {
    const c = state.company, products = c?.products || [];
    if (!products.length) return main(tr('Şirket raporu henüz yok', 'No company report yet'));
    const byDays = products.filter((p) => p.daysLeftWithOrder != null).sort((a, b) => a.daysLeftWithOrder - b.daysLeftWithOrder);
    const low = byDays[0] || products[0], need = products.filter((p) => p.need > 0).sort((a, b) => b.need - a.need);
    const days = (p) => `${daysTxt(p.daysLeftWithOrder)}${tr('g', 'd')}`;
    const today = need.length
      ? `${tr('Bugün sipariş', 'Order today')}: ${need.slice(0, 2).map((p) => `${esc(p.name)} ×${n0(p.need)}`).join(', ')}${need.length > 2 ? ` +${need.length - 2}` : ''}`
      : tr('Bugün sipariş gerekmiyor', 'Nothing to order today');
    return main(`${esc(low.name)} · ${days(low)}`, today)
      + more(size, byDays.slice(1, 4).map((p) => [esc(p.name), days(p)]), [[tr('Sipariş tutarı', 'Order cost'), money(c.totals?.orderCost)]]);
  }

  const premium = {
    gym: { needs: ['page.gym'], view: 'gym', load: () => api('/api/stats'), html: gym },
    networth: { needs: ['page.networth'], view: 'networth', load: () => api('/api/networth'), html: networth },
    travel: { needs: ['page.travel'], view: 'travel', load: () => api('/api/travel'), html: travel },
    job: { needs: ['page.job'], view: 'job', load: () => api('/api/job'), html: job },
    crimes: {
      needs: ['page.crimes'], view: 'crimes', off: () => !feat('crimes.shoplift') && !feat('crimes.value'), html: crimes,
      load: async () => {
        const [shop, cv] = await Promise.all([feat('crimes.shoplift') ? api('/api/shoplifting') : null, feat('crimes.value') ? api('/api/crime-value') : null]);
        return { shop, cv };
      },
    },
    jail: { needs: ['page.crimes', 'crimes.jail'], view: 'crimes', load: () => api('/api/jail'), html: jail },
    awards: { needs: ['page.awards'], view: 'awards', load: () => api('/api/awards'), html: awards },
    oc: { needs: ['page.faction'], view: 'faction', load: () => api('/api/faction'), html: oc },
    war: { needs: ['page.war'], view: 'war', load: () => api('/api/wars'), html: war },
    events: { needs: ['page.tools', 'tools.events'], view: 'tools', load: () => api('/api/events'), html: events },
    orders: { needs: ['page.company'], view: 'report', note: () => (state.companyMode ? null : tr('Yalnızca şirket modunda', 'Company mode only')), load: null, html: orders },
  };

  window.LRXOverviewWidgets = Object.freeze({ titles: Object.freeze(titles), premium: Object.freeze(premium) });
  // Premium page → Open: this module has no workbench; it is the Overview's edit mode.
  window.PremiumOpeners = window.PremiumOpeners || {};
  window.PremiumOpeners.overview_widgets = () => { showView('overview'); window.LRXOverviewEdit?.start(); };
})();
