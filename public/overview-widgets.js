/* The Overview widget catalogue: every widget's title and, for each Premium widget, what it needs, the page it opens,
   how it loads and its markup at S, M and L. A widget only reads an endpoint its own page already calls (never a new
   Torn request) and only displays it; overview-host.js decides when a tile may load. All Torn text goes through esc().
   Optional fields: `off()` is a Settings switch beyond `needs`, `note()` another reason the tile shows a note instead. */
(() => {
  const titles = {
    profile: ['Profil kartı', 'Profile card'], drug: ['Xanax / drug sayacı', 'Xanax / drug timer'],
    edu: ['Eğitim sayacı', 'Education timer'], day: ['Gün dönümü (18:00 TCT)', 'Day reset (18:00 TCT)'],
    timers: ['Canlı sayaçlar', 'Live timers'],
    bars: ['Barlar', 'Bars'], chips: ['Durum çipleri', 'Status chips'], battle: ['Savaş gücü', 'Battle stats'],
    company: ['Şirket özeti', 'Company summary'],
    gym: ['Gym kazancı', 'Gym gains'], networth: ['Networth', 'Networth'], travel: ['Seyahat kârı', 'Travel profit'],
    job: ['İş asistanı', 'Job assistant'], crimes: ['Suç merkezi', 'Crime hub'], jail: ['Jail bustları', 'Jail busts'],
    awards: ['Merit takibi', 'Merit tracker'], oc: ['Faction OC', 'Faction OC'], war: ['Savaş', 'War'],
    events: ['Etkinlik takvimi', 'Event calendar'], orders: ['Günlük sipariş önerisi', 'Daily order hint'],
    faction_member: ['Faction Üye Özeti', 'Faction Member Summary'],
    faction_balance: ['Kişisel Faction Bakiyesi', 'Personal Faction Balance'],
    faction_activity: ['Faction Aktivite', 'Faction Activity'],
    faction_stats: ['Faction Stats', 'Faction Stats'],
    faction_radar: ['Faction Travel Radar', 'Faction Travel Radar'],
    travel_routes: ['Seyahat Rotaları', 'Travel Routes'],
    travel_stock: ['Yurt Dışı Stok', 'Abroad Stock'],
    travel_traffic: ['Seyahat Trafiği', 'Travel Traffic'],
    travel_planner: ['Kalkış Planlayıcı', 'Departure Planner'],
    travel_history: ['Uçuş / Alış Özeti', 'Flight / Purchase Summary'],
  };

  // Shared response cache for widgets reading the same endpoint within the same refresh cycle (50 s TTL). It is kept
  // per player and emptied on a Premium identity reset, so after an account switch no tile shows the previous account.
  const sharedCache = new Map();
  let sharedGen = 0, sharedFor = null;
  const sharedPlayer = () => Number(state.overview?.player?.id) || 0;
  function clearShared() { sharedGen++; sharedCache.clear(); sharedFor = null; }
  function sharedLoad(name, loader) {
    const who = sharedPlayer();
    if (sharedFor !== who) { clearShared(); sharedFor = who; }
    const key = `${who}:${name}`, gen = sharedGen, now = Date.now();
    const hit = sharedCache.get(key);
    if (hit && (hit.promise || now - hit.at < 50_000)) return hit.promise || Promise.resolve(hit.value);
    const promise = Promise.resolve().then(loader).then((value) => {
      if (gen === sharedGen) sharedCache.set(key, { at: Date.now(), value, promise: null });
      return value;
    }).catch((err) => {
      if (gen === sharedGen && sharedCache.get(key)?.promise === promise) sharedCache.delete(key);
      throw err;
    });
    sharedCache.set(key, { at: now, value: undefined, promise });
    return promise;
  }
  window.addEventListener?.('lrx-premium-reset', clearShared);

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
        const { perHour: rate, trip } = LRXTravelMath.tripMetrics(it.profit, cap, it.qty, oneWay);
        if (rate > (best.get(c.code)?.rate ?? -Infinity)) best.set(c.code, { c, it, rate, trip });
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

  // Merit Tracker (awardEasyCard, LRXMerit.easyWins): the easiest next award with its how-to line: the counter closest
  // to done, then what comes by itself soon, then a one-time award most players have. Long grinds (level, rank, gym)
  // never lead, whatever their percentage.
  function awards(d, size) {
    const e = window.LRXMerit ? LRXMerit.easyWins(d?.awards || [], { num: n0, money: cmoney }) : { count: [], time: [], once: [] };
    const [top, ...rest] = [e.count[0], e.time[0], e.once[0], ...e.count.slice(1)].filter(Boolean);
    if (!top) return main(tr('Şu an kolay kazanım yok', 'No easy wins right now'));
    const say = (pair) => esc(tr(pair[0], pair[1]));
    const badge = (a) => (a.g.group === 'count' ? pct(a.pct) : a.g.side ? say(a.g.side) : '');
    return main(esc(top.name), `${badge(top)} · ${say(top.g.how)}`) + more(size, rest.slice(0, 2).map((a) => [esc(a.name), badge(a)]));
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

  /* ---------- N5: Faction & Travel Workspace Overview Widgets ---------- */
  // A player without a faction: the server's (already translated) message instead of empty numbers.
  const noFaction = (d) => (d?.notInFaction ? main(esc(d.error || tr("Bir faction'da değilsin.", 'You are not in a faction.'))) : '');
  function factionMember(d, size) {
    if (d?.notInFaction) return noFaction(d);
    const meId = Number(state.overview?.player?.id) || 0;
    const rows = d?.membersTable?.rows || [];
    if (!rows.length) return main(tr('Üye verisi yok', 'No member data'));
    const me = meId ? rows.find((r) => r.playerId === meId) : null;
    if (!me) return main(tr('Üye kaydın henüz bulunamadı', 'Your member row was not found yet'), tr('Faction listesi yenilenince görünür.', 'It shows once the faction roster refreshes.'));
    const ar = d?.statsView?.activeRate;
    const rateTxt = ar?.pct != null ? tr(`%${ar.pct} aktiflik`, `${ar.pct}% active rate`) : `${me.days} ${tr('gün', 'days')}`;
    return main(`${esc(me.name)} · ${esc(me.position)}`, rateTxt)
      + more(size, [
        [tr('7g Oynama', '7d Activity'), me.activity7d != null ? human(me.activity7d) : '—'],
        [tr('7g Xanax / Gym', '7d Xanax / Gym'), `${me.xanax7d != null ? n0(me.xanax7d) : '—'} / ${me.gym7d != null ? n0(me.gym7d) : '—'}`],
        ['Battle Stats', me.battleStats?.total != null ? n0(me.battleStats.total) : '—'],
      ]);
  }

  function factionActivity(d, size) {
    if (d?.notInFaction) return noFaction(d);
    const c = d?.counts || {};
    const hm = d?.heatmap || {};
    const line = `🟢 ${n0(c.online || 0)} · 🟡 ${n0(c.idle || 0)} · ⚫ ${n0(c.offline || 0)}`;
    const sub = `${n0(c.total || 0)} ${tr('üye', 'members')} · ${n0(c.inOc || 0)} OC`;
    const mRows = [
      [tr('Müsait / Hastane', 'Okay / Hospital'), `${n0(c.okay || 0)} / ${n0(c.hospital || 0)}`],
      [tr('Uçakta / Yurt dışı', 'Flying / Abroad'), `${n0(c.traveling || 0)} / ${n0(c.abroad || 0)}`],
    ];
    const lRows = [
      [tr('En yoğun saat', 'Peak TCT hour'), hm.peakHour ? `${String(hm.peakHour.hour).padStart(2, '0')}:00 TCT` : '—'],
      [tr('24s örnek', '24h samples'), n0((d?.timeline || []).length)],
    ];
    return main(line, sub) + more(size, mRows, lRows);
  }

  function factionStats(d, size) {
    if (d?.notInFaction) return noFaction(d);
    const sv = d?.statsView || {};
    const ar = sv.activeRate || {};
    const top = [...(sv.rows || [])].filter((r) => r.activity != null).sort((a, b) => b.activity - a.activity);
    const line = ar.pct != null ? tr(`%${ar.pct} Aktiflik`, `${ar.pct}% Active`) : `${n0(ar.totalMembers || 0)} ${tr('Üye', 'Members')}`;
    const days = sv.windowDays || 7;
    const cov = sv.coverage || window.LRXFactionWorkspace?.statsCoverage?.(days, sv.range) || null;
    const span = window.LRXFactionWorkspace?.windowLabel?.(days, cov) || [`${days}g`, `${days}d`];
    const sub = `${tr('Payda', 'Denom')}: ${ar.numerator || 0}/${ar.denominator || 0} (${tr(span[0], span[1])})`;
    return main(line, sub) + more(
      size,
      [
        [tr('Toplam Süre', 'Total Time'), human(sv.totals?.activity || 0)],
        ['Xanax / Gym E', `${n0(sv.totals?.xanax || 0)} / ${n0(sv.totals?.gym || 0)}`],
      ],
      top.slice(0, 5).map((r) => [esc(r.name), human(r.activity)]),
    );
  }

  // Radar rows (travel-radar.js): travelState, destination/origin country codes and ISO etaAt / etaFrom–etaTo.
  const RADAR_STATE = { outbound: ['Gidiş', 'Outbound'], abroad: ['Yurt dışı', 'Abroad'], inbound: ['Dönüş', 'Inbound'], unknown: ['Bilinmiyor', 'Unknown'] };
  const radarState = (t) => tr(...(RADAR_STATE[t.travelState] || RADAR_STATE.unknown));
  function radarCountry(t) {
    const code = t.travelState === 'inbound' ? t.origin : t.destination;
    if (!code || code === 'torn') return null;
    return window.LRXTravelRadar?.countryName?.(code) || String(code).toUpperCase();
  }
  function radarEtaMs(t) {
    if (t.travelState !== 'outbound' && t.travelState !== 'inbound') return null;
    const ms = Date.parse(t.etaAt || t.etaFrom || '');
    return Number.isFinite(ms) ? ms : null;
  }
  function radarEta(t) {
    const ms = radarEtaMs(t);
    if (ms == null) return esc(radarState(t));
    const left = (ms - Date.now()) / 1000;
    if (left <= 0) return tr('iniyor', 'landing');
    return t.etaAt ? human(left) : `~${human(left)}`;
  }
  function factionRadar(d, size) {
    if (d?.notInFaction) return noFaction(d);
    const sum = d?.travelSummary || {};
    const trList = [...(d?.travel || [])].sort((a, b) => (radarEtaMs(a) ?? Infinity) - (radarEtaMs(b) ?? Infinity));
    const line = `🛫 ${n0(sum.outbound || 0)} · 🌍 ${n0(sum.abroad || 0)} · 🛬 ${n0(sum.inbound || 0)}`;
    const sub = `${n0(sum.totalTravel || trList.length)} ${tr('aktif seyahat', 'active travelers')}`;
    const mRows = trList.slice(0, 3).map((t) => [`${esc(t.displayName)} (${esc(radarCountry(t) || radarState(t))})`, radarEta(t)]);
    const byC = new Map();
    for (const t of trList) {
      const k = radarCountry(t) || tr('Bilinmiyor', 'Unknown');
      byC.set(k, (byC.get(k) || 0) + 1);
    }
    const lRows = [...byC.entries()].slice(0, 3).map(([c, cnt]) => [esc(c), `${cnt} ${tr('üye', 'members')}`]);
    return main(line, sub) + more(size, mRows, lRows);
  }

  function travelRoutes(d, size) {
    const [top, ...rest] = d ? travelBest(d) : [];
    if (!top) return main(tr('Uygun seyahat rotası yok', 'No eligible travel route'));
    return main(`${esc(top.c.name)} · ${esc(top.it.name)}`, `${perHour(top.rate)} · ${cmoney(top.trip)}/${tr('sefer', 'trip')}`)
      + more(
        size,
        rest.slice(0, 2).map((r) => [`${esc(r.c.name)} · ${esc(r.it.name)}`, perHour(r.rate)]),
        rest.slice(2, 5).map((r) => [`${esc(r.c.name)} · ${esc(r.it.name)}`, `${cmoney(r.trip)}/${tr('sefer', 'trip')}`]),
      );
  }

  function travelStock(d, size) {
    const countries = d?.countries || [];
    const items = countries.flatMap((c) => (c.items || []).map((it) => ({ c, it })))
      .filter(({ it }) => (it.profit || 0) > 0)
      .sort((a, b) => (b.it.profit || 0) - (a.it.profit || 0));
    const inStock = items.filter(({ it }) => it.qty > 0);
    const top = inStock[0] || items[0];
    if (!top) return main(tr('Stok verisi yok', 'No stock data'));
    return main(`${esc(top.it.name)} (${esc(top.c.name)})`, `${n0(top.it.qty)} ${tr('stok', 'in stock')} · +${cmoney(top.it.profit)}`)
      + more(
        size,
        inStock.slice(1, 3).map(({ c, it }) => [`${esc(c.name)} · ${esc(it.name)}`, `${n0(it.qty)} ${tr('adet', 'qty')}`]),
        inStock.slice(3, 6).map(({ c, it }) => [`${esc(c.name)} · ${esc(it.name)}`, `${n0(it.qty)} ${tr('adet', 'qty')}`]),
      );
  }

  function travelTraffic(d, size) {
    const ws = window.LRXTravelWorkspace;
    const tf = ws ? ws.summarizeTraffic(d?.factionTraffic || [], { countryCode: '*', windowHours: 24 }) : null;
    if (!tf) return main(tr('Trafik verisi yok', 'No traffic data'));
    const lt = tf.latest;
    const line = `🛫 ${lt.outbound} · 🌍 ${lt.abroad} · 🛬 ${lt.inbound}`;
    const sub = `${tr('Ort.', 'Avg')} ${tf.average} · ${tr('Zirve', 'Peak')} ${tf.peak.value}${tf.peak.tct ? ` (${tf.peak.tct} TCT)` : ''}`;
    return main(line, sub) + more(
      size,
      [
        [tr('Dönem değişimi', 'Period delta'), tf.periodDelta != null ? signed(tf.periodDelta, n0) : '—'],
        [tr('Bilinmeyen rota', 'Unknown route'), n0(lt.unknown)],
      ],
      [
        [tr('Örnek / Kapsama', 'Samples / Coverage'), `${tf.sampleCount} (%${tf.coveragePct})`],
      ],
    );
  }

  function travelPlannerWidget(d, size) {
    if (!d || !window.LRXTravelPlanner) return main(tr('Planlayıcı hazır değil', 'Planner not ready'));
    const nowSec = Math.floor(nowTct() / 1000);
    const method = travelState.method || (TRAVEL_METHODS[d.method] ? d.method : 'Standard');
    const plan = LRXTravelPlanner.buildDeparturePlan({
      countries: d.countries || [],
      nowSec,
      cap: travelState.cap,
      method,
      wallet: d.wallet,
      trip: d.trip || state.overview?.trip || null,
    });
    const nf = plan.nextFlight;
    if (!nf) return main(tr('Planlanabilir uçuş yok', 'No schedulable flight'));
    const left = Math.max(0, nf.departAt - nowSec);
    const when = left > 0 ? tr(`${human(left)} sonra kalkış`, `depart in ${human(left)}`) : tr('Şimdi kalk!', 'Leave now!');
    return main(`${esc(nf.countryName)} · ${esc(nf.itemName)}`, `${when} · +${cmoney(plan.summary.todayProfit)} ${tr('bugün', 'today')}`)
      + more(
        size,
        plan.stops.slice(1, 3).map((s) => [`${esc(s.countryName)} · ${esc(s.itemName)}`, `+${cmoney(s.profit)}`]),
        plan.stops.slice(3, 5).map((s) => [`${esc(s.countryName)} · ${esc(s.itemName)}`, `+${cmoney(s.profit)}`]),
      );
  }

  function travelHistoryWidget(d, size) {
    const fh = d?.flightHistory;
    const entries = fh?.entries || [];
    if (!entries.length) {
      return main(
        tr('Alış kaydı yok', 'No purchase records'),
        fh?.logAccess ? tr('Log kaynağı açık', 'Log source active') : tr('Log kapalı / manuel kayıt yok', 'Log off / no manual records'),
      );
    }
    const top = entries[0];
    return main(`${esc(top.name)} ×${n0(top.qty)}`, `${money(top.each)} ${tr('alış', 'cost')} · ${top.modeledTotalProfit != null ? signed(top.modeledTotalProfit, cmoney) : '—'} (${tr('modellenmiş', 'modeled')})`)
      + more(
        size,
        entries.slice(1, 3).map((e) => [`${esc(e.name)} ×${n0(e.qty)}`, money(e.each)]),
        entries.slice(3, 6).map((e) => [`${esc(e.name)} ×${n0(e.qty)}`, e.modeledTotalProfit != null ? signed(e.modeledTotalProfit, cmoney) : money(e.each)]),
      );
  }

  const loadTravelShared = () => sharedLoad('travel', () => api('/api/travel'));
  const loadFactionActShared = () => sharedLoad('faction:activity', () => api('/api/faction/activity'));
  const loadFactionWsShared = () => sharedLoad('faction:workspace', () => api('/api/faction/workspace?section=members'));

  const premium = {
    gym: { needs: ['page.gym'], view: 'gym', load: () => api('/api/stats'), html: gym },
    networth: { needs: ['page.networth'], view: 'networth', load: () => api('/api/networth'), html: networth },
    travel: { needs: ['page.travel'], view: 'travel', load: loadTravelShared, html: travel, open: () => window.openTravelView?.('roi') },
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
    oc: { needs: ['page.faction'], view: 'faction', load: () => api('/api/faction'), html: oc, open: () => window.openFactionTab?.('oc') },
    war: { needs: ['page.war'], view: 'war', load: () => api('/api/wars'), html: war },
    events: { needs: ['page.tools', 'tools.events'], view: 'tools', load: () => api('/api/events'), html: events },
    orders: { needs: ['page.company'], view: 'report', note: () => (state.companyMode ? null : tr('Yalnızca şirket modunda', 'Company mode only')), load: null, html: orders },
    faction_member: {
      needs: ['page.faction', 'faction.members'], view: 'faction', load: loadFactionWsShared, html: factionMember,
      open: () => {
        const meId = Number(state.overview?.player?.id) || 0;
        if (meId && window.openFactionMember) window.openFactionMember(meId);
        else window.openFactionTab?.('members');
      },
    },
    faction_activity: {
      needs: ['page.faction', 'faction.activity'], view: 'faction', load: loadFactionActShared, html: factionActivity,
      open: () => window.openFactionTab?.('activity'),
    },
    faction_balance: {
      needs: ['page.tools', 'companion.balance'], view: 'tools',
      load: () => api('/api/companion/money'),
      html: (d) => !d.faction ? main(tr('Bakiye görünmüyor', 'Balance unavailable')) :
        main(d.faction.money == null ? '—' : money(d.faction.money),
          (d.faction.points == null ? '—' : n0(d.faction.points)) + tr(' puan', ' points')),
      open: () => { showView('tools'); $('#companion-balance')?.scrollIntoView({ block: 'center' }); },
    },
    faction_stats: {
      needs: ['page.faction', 'faction.stats'], view: 'faction', load: loadFactionWsShared, html: factionStats,
      open: () => window.openFactionTab?.('stats'),
    },
    faction_radar: {
      needs: ['page.faction', 'faction.travelRadar'], view: 'faction', load: loadFactionActShared, html: factionRadar,
      open: () => window.openFactionRadar?.({ state: 'all' }),
    },
    travel_routes: {
      needs: ['page.travel'], view: 'travel', load: loadTravelShared, html: travelRoutes,
      open: () => window.openTravelView?.('roi', { block: 'destinations' }),
    },
    travel_stock: {
      needs: ['page.travel'], view: 'travel', load: loadTravelShared, html: travelStock,
      open: () => window.openTravelView?.('country', { block: 'countries' }),
    },
    travel_traffic: {
      needs: ['page.travel'], view: 'travel', load: loadTravelShared, html: travelTraffic,
      open: () => window.openTravelView?.('country', { block: 'traffic' }),
    },
    travel_planner: {
      needs: ['page.travel', 'travel.planner'], view: 'travel', load: loadTravelShared, html: travelPlannerWidget,
      open: () => window.openTravelView?.('roi', { block: 'planner' }),
    },
    travel_history: {
      needs: ['page.travel'], view: 'travel', load: loadTravelShared, html: travelHistoryWidget,
      open: () => window.openTravelView?.('item', { block: 'history' }),
    },
  };

  window.LRXOverviewWidgets = Object.freeze({ titles: Object.freeze(titles), premium: Object.freeze(premium), clearShared });
  // Premium page → Open: this module has no workbench; it is the Overview's edit mode.
  window.PremiumOpeners = window.PremiumOpeners || {};
  window.PremiumOpeners.overview_widgets = () => { showView('overview'); window.LRXOverviewEdit?.start(); };
})();
