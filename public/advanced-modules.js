/* Loaded on demand. All paid calculations and profile mutations go to the
   existing membership service; this file only gathers inputs and renders results. */
(() => {
  const gate = window.PremiumAccess, catalog = window.LRXFeatureCatalog;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/advanced-modules.css'; document.head.append(css);
  let current = null, busy = false, epoch = 0, backgroundBusy = false;
  const workspaces = new Map();
  const manualTracks = [ ['education', 'Education Length'], ['bank', 'Bank Interest'], ['nerve', 'Nerve Bar'], ['crime', 'Crime Progression'], ['life', 'Life Points'], ['critical', 'Critical Hit Rate'], ['brawn', 'Brawn'], ['protection', 'Protection'], ['sharpness', 'Sharpness'], ['evasion', 'Evasion'], ['employee', 'Employee Effectiveness'] ].map(([id, name]) => ({ id, name, level: 0, description: '' }));
  const palettes = { eclipse: ['#101019', '#1c1c2a', '#f1efff', '#b3b0ce', '#b5a0ff'], aurora: ['#071c20', '#0f2b30', '#e2fff5', '#9bc6c4', '#68e0c2'], rose: ['#1d1017', '#301c26', '#ffeef4', '#d4acbc', '#ffacc9'] };
  const label = (a, b) => tr(a, b), title = (id) => catalog.byId[id].title[state.lang === 'en' ? 1 : 0];
  const num = (v) => v == null || !Number.isFinite(v) ? '—' : new Intl.NumberFormat(state.lang === 'en' ? 'en-GB' : 'tr-TR', { maximumFractionDigits: 2 }).format(v);
  const when = (t) => t ? new Date(t * 1000).toLocaleString(state.lang === 'en' ? 'en-GB' : 'tr-TR') : '—';
  const field = (key, name, value, attrs = '') => `<label class="fx-field"><span>${esc(name)}</span><input class="input" name="${key}" value="${esc(value ?? '')}" ${attrs}></label>`;
  const numeric = (key, name, value, min = 0, max = 1e12, step = 'any') => field(key, name, value, `type="number" min="${min}" max="${max}" step="${step}" required`);
  const select = (key, name, value, options) => `<label class="fx-field"><span>${esc(name)}</span><select name="${key}">${options.map(([id, n]) => `<option value="${esc(id)}" ${String(id) === String(value) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`;
  const check = (key, name, value) => `<label class="fx-check"><input type="checkbox" name="${key}" ${value ? 'checked' : ''}>${esc(name)}</label>`;
  const table = (headers, rows) => `<div class="fx-table-wrap"><table class="tbl"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length}" class="muted">${tr('Henüz veri yok.', 'No data yet.')}</td></tr>`}</tbody></table></div>`;
  const pill = (text) => `<span class="fx-badge">${esc(text)}</span>`;
  const kpis = (items) => `<div class="fx-kpis">${items.map(([name, value, note]) => `<div><small>${esc(name)}</small><strong>${esc(value)}</strong>${note ? `<span>${esc(note)}</span>` : ''}</div>`).join('')}</div>`;
  function errorText(e) {
    const messages = {
      PREMIUM_REQUIRED: ['Üyeliğiniz etkin değil. Profilleriniz korunuyor.', 'Membership is inactive. Your profiles are retained.'], FEATURE_NOT_GRANTED: ['Bu modül hesabınıza açık değil.', 'This module is not enabled for your account.'],
      FEATURE_PROFILE_CONFLICT: ['Profil başka bir yerde değişti. Paneli kapatıp yeniden açın.', 'This profile changed elsewhere. Close and reopen the panel.'], PALETTE_CONTRAST: ['Yazı veya vurgu rengi arka planda okunamıyor. Daha yüksek kontrast seçin.', 'Text or accents lack contrast. Choose more readable colors.'],
      INVALID_FEATURE_INPUT: ['Alanları kontrol edin; veri eksik veya sınır dışında.', 'Check the fields: a value is missing or out of range.'], EVENT_NOT_AVAILABLE: ['Torn takviminden bir etkinlik seçin.', 'Choose an event from the Torn calendar.'], MERIT_TRACK_CHANGED: ['Merit listesi değişti. Yeni plan oluşturun veya dağılımı güncelleyin.', 'The merit list changed. Create a new plan or update its allocation.'], FEATURE_RATE_LIMIT: ['Çok sık işlem yaptınız. Bir dakika sonra tekrar deneyin.', 'Too many operations. Try again in a minute.'],
    }; return messages[e.code] ? tr(...messages[e.code]) : e.message;
  }
  function feedback(message, bad = false) { const el = current?.host.querySelector('.fx-feedback'); if (el) { el.textContent = message; el.classList.toggle('neg', bad); } }
  function defaults(id) {
    if (id === 'appearance_custom_themes') return { preset: 'eclipse', palette: Object.fromEntries(['bg', 'panel', 'text', 'muted', 'accent'].map((k, i) => [k, palettes.eclipse[i]])), baseTheme: state.config?.theme || 'obsidian', density: 'comfortable', cards: 'glass', radius: 16 };
    if (id === 'travel_advanced') return { capacity: travelState.cap, method: travelMethod(), waitMinutes: 0, feePercent: 0, sellChangePercent: 0, fixedCosts: 0, countries: [], maxFlight: 0, minProfit: 0, onlyInStock: true, watchKey: '', rule: { enabled: false, metric: 'buyPrice', operator: 'lte', threshold: 0 } };
    if (id === 'helpers_advanced') return { minLevel: 0, maxLevel: 100, minStats: 0, maxStats: 1e18, minFF: 0, maxFF: 100, status: 'all', group: '', sort: 'stats', includeUnknown: true, compare: [], columns: ['level', 'stats', 'ff', 'status'], rule: { enabled: false, metric: 'energyPercent', operator: 'gte', threshold: 80 } };
    if (id === 'events_advanced') return { eventKey: '', goal: 100, useManual: false, manualProgress: 0, reminderMinutes: 60, notifyPercent: 90, notifications: false };
    return { budget: 20, goal: 'balanced', priorities: {}, targets: {}, comparison: {}, manual: false, manualLevels: {} };
  }
  function travelInput() {
    const d = travelState.data; if (!d) return null;
    return { items: d.countries.filter((c) => c.minutes).flatMap((c) => c.items.map((r) => ({ key: c.code + ':' + r.id, name: r.name, country: c.name, code: c.code, cost: Number(r.cost), market: Number(r.market) > 0 ? Number(r.market) : null, qty: Number(r.qty), minutes: c.minutes, at: c.update, source: c.source }))).slice(0, 500) };
  }
  function helpersInput() {
    const o = state.overview, t = state.targets;
    const pct = (b) => b?.maximum > 0 ? b.current / b.maximum * 100 : null;
    return { observedAt: Number(t?.serverTime || o?.serverTime) || Math.floor(Date.now() / 1000), metricsObservedAt: Number(o?.serverTime) || null, hasPlayerData: !!t, ownStats: t?.me?.totals?.[state.mode] ?? null,
      players: (t ? computeTargets() : []).slice(0, 250).map((r) => ({ id: r.id, name: r.name, level: r.level, stats: r.bs, ff: r.ffRemote ?? r.ff, status: r.status?.state || '', group: window.warGroupName?.(r.id) || '', lastAction: r.lastAction?.timestamp ?? null, estimated: true })),
      metrics: { energyPercent: pct(o?.bars?.energy), lifePercent: pct(o?.bars?.life), drugSeconds: o?.drug?.cooldown ?? null } };
  }
  function eventInput(d) {
    if (!d) return null;
    return { events: d.events.slice(0, 100).map((e) => {
      let progress = null, at = Math.floor(d.at / 1000);
      const active = e.start <= nowTct() / 1000 && e.end >= nowTct() / 1000;
      if (active && /halloween|trick or treat/i.test(e.title) && d.halloween) { progress = d.halloween.treats?.total ?? null; at = Math.floor(d.halloween.at / 1000); }
      if (active && /easter/i.test(e.title) && d.easter) { progress = d.easter.score ?? null; }
      return { key: (e.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60) + ':' + e.start), title: e.title, start: e.start, end: e.end, exact: e.exact, progress, at };
    }) };
  }
  let meritCache = null, meritAt = 0, eventCache = null;
  async function loadInput(id, refresh = true) {
    if (id === 'appearance_custom_themes') return {};
    if (id === 'helpers_advanced') return helpersInput();
    if (id === 'travel_advanced') { if (refresh && (!travelState.data || Date.now() - travelState.at > 120000)) await fetchTravel(); return travelInput(); }
    if (id === 'events_advanced') { if (refresh) eventCache = await window.fetchEvents(); return eventInput(window.cachedEventData?.() || eventCache || toolState.ev); }
    if (id === 'merits_optimizer') {
      if (!meritCache || Date.now() - meritAt > 300000) {
        try { meritCache = await api('/api/merit-allocation'); meritAt = Date.now(); }
        catch { return { tracks: manualTracks.map((r) => ({ ...r })), available: null, awards: null, observedAt: Math.floor(Date.now() / 1000), source: 'manual' }; }
      }
      return { tracks: meritCache.tracks, available: meritCache.available, awards: meritCache.awards, observedAt: Math.floor(meritCache.at / 1000), source: meritCache.source };
    }
  }
  function ruleFields(p, metrics) {
    const r = p.rule || {};
    return `<details class="fx-detail"><summary>${tr('Kişisel bildirim kuralı', 'Personal notification rule')}</summary><div class="fx-fields">${check('rule.enabled', tr('Bu kuralı etkinleştir', 'Enable this rule'), r.enabled)}${select('rule.metric', tr('Ölçüm', 'Metric'), r.metric, metrics)}${select('rule.operator', tr('Koşul', 'Condition'), r.operator, [['gte', '≥'], ['lte', '≤']])}${numeric('rule.threshold', tr('Eşik', 'Threshold'), r.threshold || 0)}</div><p class="fx-note">${tr('Kaydettiğiniz etkin profilde çalışır. Uygulama açık ve veri güncel olmalı; saatte en fazla bir uyarı.', 'Runs for the active saved profile while the app is open and data is fresh; at most one alert per hour.')}</p></details>`;
  }
  function appearanceForm(p) {
    return `<div class="fx-packs">${Object.entries(palettes).map(([name, colors]) => `<button type="button" data-fx-preset="${name}" class="fx-pack ${p.preset === name ? 'selected' : ''}"><span style="background:${colors[0]}">${colors.slice(1).map((c) => `<i style="background:${c}"></i>`).join('')}</span><b>${name[0].toUpperCase() + name.slice(1)}</b></button>`).join('')}</div><div class="fx-fields">${select('preset', tr('Palet', 'Palette'), p.preset, [['custom', tr('Özel', 'Custom')], ...Object.keys(palettes).map((n) => [n, n])])}${select('baseTheme', tr('Temel tema', 'Base theme'), p.baseTheme, ['obsidian', 'ocean', 'forest', 'amethyst', 'light'].map((s) => [s, s]))}${select('density', tr('Yoğunluk', 'Density'), p.density, [['comfortable', tr('Normal', 'Comfortable')], ['compact', tr('Sıkı', 'Compact')], ['spacious', tr('Geniş', 'Spacious')]])}${select('cards', tr('Kart görünümü', 'Card style'), p.cards, [['glass', tr('Cam', 'Glass')], ['flat', tr('Düz', 'Flat')], ['outlined', tr('Çerçeveli', 'Outlined')]])}${numeric('radius', tr('Köşe yarıçapı', 'Corner radius'), p.radius, 0, 24, 1)}</div><div class="fx-colors">${['bg', 'panel', 'text', 'muted', 'accent'].map((k, i) => field('palette.' + k, [tr('Arka plan', 'Background'), tr('Panel', 'Panel'), tr('Yazı', 'Text'), tr('İkincil yazı', 'Muted text'), tr('Vurgu', 'Accent')][i], p.palette?.[k] || palettes.eclipse[i], 'type="color"')).join('')}</div><p class="fx-note">${tr('Bir renge dokunduğunuzda özel palete geçilir. Okunabilirlik sunucuda kontrol edilir. Mevcut beş tema ücretsizdir.', 'Editing a color selects a custom palette. Readability is checked by the service. All five existing themes remain free.')}</p>`;
  }
  function travelForm(p, input) {
    const items = input?.items || [], countries = [...new Map(items.map((r) => [r.code, r.country]))];
    return `<div class="fx-fields">${numeric('capacity', tr('Taşıma kapasitesi', 'Capacity'), p.capacity, 1, 100, 1)}${select('method', tr('Uçuş türü', 'Flight method'), p.method, ['Standard', 'Airstrip', 'Private', 'Business'].map((s) => [s, s]))}${numeric('waitMinutes', tr('Toplam bekleme (dk)', 'Total delay (minutes)'), p.waitMinutes, 0, 1440)}${numeric('feePercent', tr('Satış kesintisi %', 'Sale fee %'), p.feePercent, 0, 100)}${numeric('sellChangePercent', tr('Satış fiyatı senaryosu %', 'Sale-price change %'), p.sellChangePercent, -100, 100)}${numeric('fixedCosts', tr('Sefer masrafı $', 'Trip costs $'), p.fixedCosts)}${numeric('maxFlight', tr('Azami tek yön dk (0 = tümü)', 'Max one-way minutes (0 = any)'), p.maxFlight, 0, 1000)}${numeric('minProfit', tr('Asgari saatlik kâr $', 'Minimum hourly profit $'), p.minProfit)}</div><div class="fx-country-picks">${countries.map(([id, n]) => check('country.' + id, n, p.countries.includes(id))).join('')}</div>${check('onlyInStock', tr('Yalnızca gözlenen stokta olanlar', 'Only items with observed stock'), p.onlyInStock)}${select('watchKey', tr('Fiyat grafiği / uyarı ürünü', 'Price chart / alert item'), p.watchKey, [['', tr('En iyi rota', 'Best route')], ...items.map((r) => [r.key, r.country + ' · ' + r.name])])}${ruleFields(p, [['buyPrice', tr('Alış fiyatı $', 'Buy price $')], ['sellPrice', tr('Piyasa değeri $', 'Market value $')], ['hourlyProfit', tr('Senaryo kârı $/saat', 'Scenario profit $/hour')]])}<p class="fx-note">${tr('YATA / Prometheus gözlemleri ve Torn piyasa değeri kullanılır. Fiyat, stok ve satış geliri garanti değildir. Geçmiş, kaydettiğiniz ölçümlerle başlar.', 'Uses YATA / Prometheus observations and Torn market value. Prices, stock and proceeds are not guaranteed. History starts with your recorded observations.')}</p>`;
  }
  function helpersForm(p, input) {
    const labels = { level: tr('Seviye', 'Level'), stats: tr('Tahmini stat', 'Estimated stats'), ff: 'Fair Fight', status: tr('Durum', 'Status'), ratio: tr('Stat oranı', 'Stat ratio'), lastAction: tr('Son etkinlik', 'Last action') };
    return `<p class="fx-note">${tr('Önce Savaş Hedefleri sayfasında bir faction yükleyin. Karşılaştırma bu açık veriyi kullanır; ek oyuncu taraması yapmaz.', 'Load a faction on War Targets first. Comparison uses that loaded data without additional player scans.')} <button type="button" class="btn sm ghost" data-goto-view="war">${tr('Savaş Hedefleri', 'War Targets')} ↗</button></p><div class="fx-fields">${numeric('minLevel', tr('En az seviye', 'Min level'), p.minLevel, 0, 100, 1)}${numeric('maxLevel', tr('En çok seviye', 'Max level'), p.maxLevel, 1, 100, 1)}${numeric('minStats', tr('En az stat', 'Min stats'), p.minStats, 0, 1e18)}${numeric('maxStats', tr('En çok stat', 'Max stats'), p.maxStats, 0, 1e18)}${numeric('minFF', 'Min FF', p.minFF, 0, 100)}${numeric('maxFF', 'Max FF', p.maxFF, 0, 100)}${select('status', tr('Durum', 'Status'), p.status, ['all', 'Okay', 'Hospital', 'Traveling', 'Abroad', 'Jail'].map((s) => [s, s]))}${field('group', tr('Grup adı içerir', 'Group contains'), p.group, 'maxlength="60"')}${select('sort', tr('Sıralama', 'Sort'), p.sort, ['stats', 'level', 'ff'].map((s) => [s, labels[s]]))}</div>${check('includeUnknown', tr('Bilinmeyen değerleri dahil et', 'Include unknown values'), p.includeUnknown)}<div class="fx-country-picks">${Object.entries(labels).map(([k, n]) => check('column.' + k, n, p.columns.includes(k))).join('')}</div><div class="fx-fields">${[0, 1, 2, 3].map((i) => select('compare.' + i, tr('Karşılaştırma', 'Compare') + ' ' + (i + 1), p.compare[i] || '', [['', '—'], ...(input?.players || []).map((r) => [r.id, r.name + ' [' + r.id + ']'])])).join('')}</div>${ruleFields(p, [['energyPercent', tr('Enerji %', 'Energy %')], ['lifePercent', tr('Can %', 'Life %')], ['drugSeconds', tr('İlaç bekleme saniyesi', 'Drug cooldown seconds')], ['matchingPlayers', tr('Filtreye uyan oyuncu', 'Matching players')]])}`;
  }
  function eventsForm(p, input) {
    return `<div class="fx-fields">${select('eventKey', tr('Torn takvimindeki etkinlik', 'Event in Torn calendar'), p.eventKey, [['', tr('Seçin', 'Choose')], ...(input?.events || []).map((e) => [e.key, e.title + ' · ' + when(e.start)])])}${numeric('goal', tr('Hedef miktar', 'Target amount'), p.goal, 1, 1e10)}${numeric('manualProgress', tr('Elle girilen ilerleme', 'Manual progress'), p.manualProgress, 0, 1e10)}${numeric('reminderMinutes', tr('Başlangıçtan kaç dk önce', 'Minutes before start'), p.reminderMinutes, 0, 10080, 1)}${numeric('notifyPercent', tr('İlerleme uyarı eşiği %', 'Progress alert threshold %'), p.notifyPercent, 1, 100)}</div>${check('useManual', tr('API ölçümü yerine kendi ilerlememi kullan', 'Use my entered progress instead of the API measurement'), p.useManual)}${check('notifications', tr('Kaydedilen profil için hatırlatıcıları aç', 'Enable reminders for the saved profile'), p.notifications)}<p class="fx-note">${tr('API ölçümü olmayan etkinliklerde ilerleme bilinmiyor olarak gösterilir. Elle girilen değerler ayrıca işaretlenir. Kesin olmayan başlangıç saati için zaman bildirimi gönderilmez.', 'Progress stays unknown when the API provides no measurement. Entered values are marked manual. Start reminders are skipped when the start time is uncertain.')}</p>`;
  }
  function meritsForm(p, input) {
    const manual = p.manual || input?.source === 'manual';
    return `<div class="fx-fields">${numeric('budget', tr('Harcanabilir merit bütçesi', 'Merit budget'), p.budget, 0, 1000, 1)}${select('goal', tr('Öncelikli hedef', 'Primary goal'), p.goal, [['balanced', tr('Dengeli', 'Balanced')], ['education', tr('Eğitim', 'Education')], ['income', tr('Gelir', 'Income')], ['combat', tr('Savaş', 'Combat')], ['crime', tr('Suç', 'Crime')], ['work', tr('İş', 'Work')]])}</div>${check('manual', tr('Mevcut rankları elle gir (senaryo)', 'Enter current ranks manually (scenario)'), manual)}<p class="fx-note">${input?.source === 'manual' ? tr('API okunamadı; aşağıdaki ranklar elle girilen bir senaryodur.', 'The API was unavailable; ranks below are a manual scenario.') : tr(`API: ${input?.available ?? '—'} harcanabilir merit · ${when(input?.observedAt)}`, `API: ${input?.available ?? '—'} available merits · ${when(input?.observedAt)}`)}<br>${tr('Öncelik 0–10: boşsa hedefe göre belirlenir. A ve B iki ayrı hedef dağılımıdır. Sıfırlama veya dağıtım yapılmaz.', 'Priority 0–10: leave empty to use the goal. A and B are alternative target allocations. Nothing is reset or allocated in-game.')}</p>${table([tr('Merit', 'Merit'), tr('Mevcut rank', 'Current rank'), tr('Öncelik', 'Priority'), tr('Hedef A', 'Target A'), tr('Hedef B', 'Target B')], (input?.tracks || []).map((t) => {
      const currentRank = manual ? p.manualLevels[t.id] ?? t.level : t.level;
      return [`<strong title="${esc(t.description)}">${esc(t.name)}</strong>`, `<input class="input fx-rank" aria-label="${esc(t.name)} current" type="number" name="rank.${t.id}" min="0" max="10" step="1" value="${currentRank}" ${manual ? '' : 'readonly'}>`, `<input class="input fx-rank" aria-label="${esc(t.name)} priority" type="number" name="priority.${t.id}" min="0" max="10" step="1" value="${p.priorities[t.id] ?? ''}">`, ...['targets', 'comparison'].map((k) => `<input class="input fx-rank" aria-label="${esc(t.name)} ${k}" type="number" name="${k}.${t.id}" min="${currentRank}" max="10" step="1" required value="${Math.max(currentRank, p[k][t.id] ?? currentRank)}">`)];
    }))}<p class="fx-note"><a href="https://wiki.torn.com/wiki/Merit" target="_blank" rel="noopener">${tr('Resmî Merit mekaniği', 'Official merit mechanics')}</a> · ${tr('1…10 rank maliyeti, toplam 55. Öneri seçtiğiniz öncelik puanını en yüksek yapar; evrensel bir en iyi dağılım iddiası değildir.', 'Ranks cost 1…10, totaling 55. The recommendation maximizes your priority score, not a universal best allocation.')}</p>`;
  }
  const forms = { appearance_custom_themes: appearanceForm, travel_advanced: travelForm, helpers_advanced: helpersForm, events_advanced: eventsForm, merits_optimizer: meritsForm };
  function chart(rows, fieldName) {
    const points = rows.filter((r) => Number.isFinite(r[fieldName]));
    if (points.length < 2) return `<p class="fx-note">${tr('Grafik için en az iki farklı ölçüm gerekiyor. Aynı veriyi tekrar okumak yeni nokta eklemez.', 'At least two distinct observations are needed. Reading the same data again adds no point.')}</p>`;
    const lo = Math.min(...points.map((r) => r[fieldName])), hi = Math.max(...points.map((r) => r[fieldName])), t0 = points[0].at, t1 = points.at(-1).at;
    const coords = points.map((r) => `${20 + (r.at - t0) / (t1 - t0 || 1) * 660},${140 - (r[fieldName] - lo) / (hi - lo || 1) * 110}`).join(' ');
    return `<figure class="fx-chart"><svg viewBox="0 0 700 160" role="img" aria-label="${tr('Kaydedilmiş ölçümler', 'Recorded observations')}"><path d="M20 15V145H680" fill="none" stroke="var(--stroke-2)"/><polyline points="${coords}" fill="none" stroke="var(--tq)" stroke-width="2.5"/>${coords.split(' ').map((c) => `<circle cx="${c.split(',')[0]}" cy="${c.split(',')[1]}" r="3" fill="var(--tq)"/>`).join('')}</svg><figcaption>${esc(when(t0))} → ${esc(when(t1))} · ${num(lo)} – ${num(hi)} · ${tr('yalnızca gözlemler', 'observations only')}</figcaption></figure>`;
  }
  function renderResult(id, r) {
    if (!r) return '';
    if (id === 'appearance_custom_themes') return `<div class="fx-success">✓ ${tr('Görünüm uygulandı. Kaydederek sonraki açılışta geri yükleyebilirsiniz.', 'Appearance applied. Save the profile to restore it next time.')}</div>`;
    if (id === 'travel_advanced') return `${kpis([[tr('Karşılaştırılan rota', 'Compared routes'), r.routes.length], [tr('Ülke', 'Countries'), r.countries.length], [tr('En yüksek senaryo kârı/saat', 'Best scenario profit/hour'), r.routes[0] ? '$' + num(r.routes[0].scenario.perHour) : '—']])}${table([tr('Ülke / ürün', 'Country / item'), tr('Normal $/saat', 'Baseline $/hour'), tr('Senaryo $/saat', 'Scenario $/hour'), tr('Sefer kârı', 'Trip profit'), tr('Veri zamanı', 'Observed at')], r.routes.map((x) => [esc(x.country + ' · ' + x.name) + (x.stale ? ' ' + pill(tr('Eski veri', 'Stale')) : '') + (x.stockAssumed ? ' ' + pill(tr('Stok varsayımı', 'Assumed stock')) : ''), '$' + num(x.baseline.perHour), '$' + num(x.scenario.perHour), '$' + num(x.scenario.trip), esc(when(x.at))]))}<h4>${tr('Gözlenen alış fiyatı', 'Observed buy price')} · ${esc(r.chartKey || '—')}</h4>${chart(r.history, 'cost')}${table([tr('Gözlem zamanı', 'Observed at'), tr('Alış', 'Buy'), tr('Piyasa değeri', 'Market value'), tr('Stok', 'Stock')], r.history.slice(-12).reverse().map((h) => [esc(when(h.at)), '$' + num(h.cost), '$' + num(h.market), num(h.qty)]))}`;
    if (id === 'helpers_advanced') {
      const names = { level: tr('Seviye', 'Level'), stats: tr('Tahmini stat', 'Estimated stats'), ff: 'FF', status: tr('Durum', 'Status'), ratio: tr('Stat oranı', 'Ratio'), lastAction: tr('Son etkinlik', 'Last action') };
      const cells = (p) => [esc(p.name) + ` <small>[${p.id}]</small>`, ...r.columns.map((k) => k === 'status' ? esc(p[k]) : k === 'lastAction' ? esc(when(p[k])) : num(p[k]))];
      return `${kpis([[tr('Eşleşen oyuncu', 'Matching players'), r.matches.length], [tr('Karşılaştırma', 'Comparison'), r.comparison.length], [tr('Veri', 'Data'), r.stale ? tr('Eski', 'Stale') : tr('Önbellek ölçümü', 'Cached observation')]])}${r.comparison.length ? `<h4>${tr('Yan yana karşılaştırma', 'Player comparison')}</h4>${table([tr('Oyuncu', 'Player'), ...r.columns.map((k) => names[k])], r.comparison.map(cells))}` : ''}<h4>${tr('Birleşik filtre sonuçları', 'Combined filter results')}</h4>${table([tr('Oyuncu', 'Player'), ...r.columns.map((k) => names[k])], r.matches.map(cells))}`;
    }
    if (id === 'events_advanced') return `${kpis([[tr('İlerleme', 'Progress'), r.current == null ? tr('Bilinmiyor', 'Unknown') : num(r.current) + ' / ' + num(r.goal), r.source === 'manual' ? tr('Elle girildi', 'Manually entered') : tr('API ölçümü', 'API observation')], [tr('Kalan', 'Remaining'), num(r.remaining)], [tr('Gereken / gün', 'Required / day'), num(r.requiredPerDay)], [tr('Gözlenen hız / saat', 'Observed rate / hour'), num(r.perHour)]])}<p class="fx-note">${tr('Hız için en az bir saat arayla iki ölçüm gerekir. Günlük hedef ve tamamlanma tahmini mevcut hız varsayımına dayanır.', 'Rate needs observations at least one hour apart. Required pace and completion estimates depend on the observed rate.')} ${r.estimatedHours != null ? tr(`Tahmini kalan: ${num(r.estimatedHours)} saat.`, `Estimated time remaining: ${num(r.estimatedHours)} hours.`) : ''} ${!r.event.exact ? tr('Başlangıç saati kesin değil.', 'Start time is uncertain.') : ''}</p>${r.source === 'desktop-api-snapshot' && /halloween|trick or treat/i.test(r.event.title) ? `<p class="fx-note">${tr('API toplam treat sayacı gösterilir; bu dönemde kazanılan treat miktarı hesaplanmaz. Hedefinizi toplam sayaca göre belirleyin.', 'This is the total treats counter from the API, not treats earned in this event. Set your goal against the total counter.')}</p>` : ''}${chart(r.history.map((h) => ({ at: h.at, current: h.data.current })), 'current')}<h4>${tr('Kaydedilmiş etkinlik dönemleri', 'Recorded event runs')}</h4>${table([tr('Etkinlik', 'Event'), tr('Son ilerleme', 'Latest progress'), tr('Hedef', 'Goal'), tr('Kaynak', 'Source')], r.comparisons.map((h) => [esc(h.title) + '<small> ' + esc(when(h.at)) + '</small>', num(h.current), num(h.goal), esc(h.source)]))}`;
    if (id === 'merits_optimizer') return `${kpis([[tr('Öneri maliyeti', 'Recommended cost'), r.recommended.cost], [tr('A için eksik merit', 'Merits missing for A'), r.planned.missing], [tr('B için eksik merit', 'Merits missing for B'), r.comparison.missing], [tr('Öneriden kalan', 'Budget left'), r.recommended.remaining]])}${r.budgetExceedsAvailable ? `<p class="fx-warning">${tr('Bu bir gelecek bütçesi senaryosu: bütçe mevcut API bakiyesinden yüksek.', 'Future-budget scenario: your budget exceeds the available API balance.')}</p>` : ''}${table([tr('Merit', 'Merit'), tr('Mevcut', 'Current'), tr('Öneri (maliyet)', 'Recommended (cost)'), tr('A (maliyet)', 'A (cost)'), tr('B (maliyet)', 'B (cost)')], r.recommended.rows.map((t, i) => [esc(t.name), num(t.level), `${t.target} (${t.cost})`, `${r.planned.rows[i].target} (${r.planned.rows[i].cost})`, `${r.comparison.rows[i].target} (${r.comparison.rows[i].cost})`]))}<h4>${tr('Merit gelişim geçmişi', 'Merit progress history')}</h4>${table([tr('Tarih', 'Date'), tr('Harcanabilir', 'Available'), tr('Toplam ödül', 'Total awards'), tr('Kaynak', 'Source')], r.history.slice(-12).reverse().map((h) => [esc(when(h.at)), num(h.data.available), num(h.data.awards), esc(h.data.source)]))}<p class="fx-note">${tr('Öneriler yalnızca analizdir. Gerçek merit dağılımınız değiştirilmedi.', 'Recommendations are analysis only. Your actual merit allocation was not changed.')}</p>`;
    return '';
  }
  function render() {
    const c = current; if (!c) return;
    const allowed = gate.can(c.id), consent = gate.snapshot()?.featureAccess?.consent;
    c.host.dataset.featureOpen = c.id;
    const intro = `<header class="fx-header"><div><span class="fx-eyebrow">LRX / ${esc(catalog.byId[c.id].module.toUpperCase())}</span><h3>${esc(title(c.id))} <span class="fx-badge">Premium</span></h3></div><button type="button" class="btn sm ghost" data-fx-action="close" aria-label="${tr('Kapat', 'Close')}">✕</button></header>`;
    let body;
    if (!allowed) body = `<p>${tr('Premium erişimi şu anda doğrulanamıyor veya üyelik sona erdi. Kayıtlı ayarlarınız korunuyor.', 'Premium access cannot currently be verified, or membership has expired. Saved settings are retained.')}</p><button class="btn" type="button" data-goto-view="premium">${tr('Üyeliği görüntüle', 'View membership')}</button>`;
    else if (!consent) body = `<div class="fx-consent"><h4>${tr('Analiz verilerini sizin seçiminizle işleriz.', 'You choose which data to analyze.')}</h4><p>${tr('Bu araçlar seçtiğiniz fiyatları, oyuncu tahminlerini, merit veya etkinlik ölçümlerini üyelik sunucusuna gönderir. Profiller ve kaydettiğiniz ölçümler hesabınıza bağlı tutulur (modül başına en fazla 1000 ölçüm, en fazla iki yıl). API anahtarınız analizlere eklenmez. Ücretsiz araçlar bu izin olmadan çalışır.', 'These tools send selected prices, player estimates, merit or event observations to the membership server. Profiles and recorded observations are associated with your account (up to 1000 observations per module, up to two years). Your API key is not included. Free tools work without this permission.')}</p>${check('analysis-consent', tr('Seçtiğim verilerin analizini ve saklanmasını kabul ediyorum', 'I agree to analysis and storage of my selected data'), false)}<button type="button" class="btn primary" data-fx-action="consent">${tr('Etkinleştir', 'Enable')}</button></div>`;
    else body = `<div class="fx-profile-bar"><label>${tr('Kaydedilmiş profiller', 'Saved profiles')}<select data-fx-profile><option value="">${tr('Yeni profil', 'New profile')}</option>${c.workspace.profiles.map((p) => `<option value="${p.id}" ${p.id === c.profileId ? 'selected' : ''}>${esc(p.name)}${p.id === c.workspace.activeProfile ? ' · ✓' : ''}</option>`).join('')}</select></label><button type="button" class="btn sm ghost" data-fx-action="delete" ${c.profileId ? '' : 'disabled'}>${tr('Sil', 'Delete')}</button></div><form class="fx-form" data-fx-form><fieldset ${busy ? 'disabled' : ''}>${forms[c.id](c.params, c.input)}<div class="fx-actions">${field('profileName', tr('Profil adı', 'Profile name'), c.name, 'maxlength="60"')}<button class="btn primary" type="submit">${c.id === 'appearance_custom_themes' ? tr('Görünümü uygula', 'Apply appearance') : tr('Analiz et ve ölçümü kaydet', 'Analyze and record observation')}</button><button type="button" class="btn ghost" data-fx-action="save">${tr('Profili kaydet', 'Save profile')}</button>${c.id === 'appearance_custom_themes' ? `<button type="button" class="btn ghost" data-fx-action="restore-free">${tr('Temel temaya dön', 'Use base theme')}</button>` : ''}</div></fieldset></form><div class="fx-result" aria-live="polite">${renderResult(c.id, c.result)}</div><details class="fx-detail fx-privacy"><summary>${tr('Veri paylaşımı', 'Data sharing')}</summary><p class="fx-note">${tr('Paylaşımı durdurmak profilleri silmez. Kişisel verilerinizi Premium sayfasından dışa aktarabilirsiniz.', 'Stopping sharing keeps saved profiles. Export personal data from the Premium page.')}</p><button type="button" class="btn sm ghost" data-fx-action="revoke">${tr('Gelişmiş analiz paylaşımını durdur', 'Stop advanced data sharing')}</button></details>`;
    c.host.innerHTML = `<article class="fx-workbench">${intro}<div class="fx-workbody">${body}<p class="fx-feedback" role="status"></p></div></article>`;
  }
  function readParams() {
    const c = current, f = c.host.querySelector('[data-fx-form]'); if (!f) return c.params;
    const p = structuredClone(c.params), data = new FormData(f);
    const n = (k) => Number(data.get(k)), s = (k) => String(data.get(k) || ''), b = (k) => data.has(k);
    c.name = s('profileName');
    if (c.id === 'appearance_custom_themes') { for (const k of ['preset', 'baseTheme', 'density', 'cards']) p[k] = s(k); p.radius = n('radius'); p.palette = Object.fromEntries(['bg', 'panel', 'text', 'muted', 'accent'].map((k) => [k, s('palette.' + k)])); }
    if (c.id === 'travel_advanced') { for (const k of ['capacity', 'waitMinutes', 'feePercent', 'sellChangePercent', 'fixedCosts', 'maxFlight', 'minProfit']) p[k] = n(k); p.method = s('method'); p.watchKey = s('watchKey'); p.onlyInStock = b('onlyInStock'); p.countries = [...data.keys()].filter((k) => k.startsWith('country.')).map((k) => k.slice(8)); }
    if (c.id === 'helpers_advanced') { for (const k of ['minLevel', 'maxLevel', 'minStats', 'maxStats', 'minFF', 'maxFF']) p[k] = n(k); for (const k of ['status', 'group', 'sort']) p[k] = s(k); p.includeUnknown = b('includeUnknown'); p.columns = [...data.keys()].filter((k) => k.startsWith('column.')).map((k) => k.slice(7)); p.compare = [...new Set([0, 1, 2, 3].map((i) => n('compare.' + i)).filter(Boolean))]; }
    if (p.rule) p.rule = { enabled: b('rule.enabled'), metric: s('rule.metric'), operator: s('rule.operator'), threshold: n('rule.threshold') };
    if (c.id === 'events_advanced') { p.eventKey = s('eventKey'); for (const k of ['goal', 'manualProgress', 'reminderMinutes', 'notifyPercent']) p[k] = n(k); p.useManual = b('useManual'); p.notifications = b('notifications'); }
    if (c.id === 'merits_optimizer') { p.budget = n('budget'); p.goal = s('goal'); p.manual = b('manual'); for (const k of ['priorities', 'targets', 'comparison', 'manualLevels']) p[k] = {}; for (const t of c.input?.tracks || []) { if (s('priority.' + t.id) !== '') p.priorities[t.id] = n('priority.' + t.id); p.targets[t.id] = n('targets.' + t.id); p.comparison[t.id] = n('comparison.' + t.id); if (p.manual) p.manualLevels[t.id] = n('rank.' + t.id); } }
    c.params = p; return p;
  }
  function effectiveInput(c) {
    if (c.id !== 'merits_optimizer' || !c.params.manual) return c.input;
    return { ...c.input, source: 'manual', observedAt: Math.floor(Date.now() / 1000), available: null, awards: null, tracks: c.input.tracks.map((t) => ({ ...t, level: c.params.manualLevels[t.id] ?? t.level })) };
  }
  function alerts(id, result, profileId) {
    if (!profileId || !feat('notify') || !gate.can(id) || !gate.snapshot()?.featureAccess?.consent) return;
    for (const a of result.alerts || []) {
      const key = `advanced:${gate.snapshot().account.tornId}:${id}:${profileId}:${a.key}`, elapsed = Date.now() - (notified.get(key) || 0);
      if (elapsed < a.cooldown * 1000) continue; rememberNotified(key, Date.now());
      const metricNames = { energyPercent: tr('Enerji %', 'Energy %'), lifePercent: tr('Can %', 'Life %'), drugSeconds: tr('Drug cooldown (sn)', 'Drug cooldown (s)'), matchingPlayers: tr('Eşleşen oyuncu', 'Matching players'), buyPrice: tr('Alış fiyatı', 'Buy price'), sellPrice: tr('Piyasa değeri', 'Market value'), hourlyProfit: tr('Saatlik kâr', 'Hourly profit'), eventStartsMinutes: tr('Etkinliğe kalan dakika', 'Minutes until event'), goalPercent: tr('Hedef ilerlemesi %', 'Goal progress %') };
      const message = (metricNames[a.metric] || a.metric) + ': ' + num(a.value);
      if ('Notification' in window && Notification.permission === 'granted') notify(key, title(id), message); else toast(title(id) + ' · ' + message);
    }
  }
  async function runCurrent() {
    const c = current, stamp = epoch; readParams();
    c.input = await loadInput(c.id);
    if (!c.input) throw new Error(tr('Önce temel modülün verisini yükleyin.', 'Load the basic module data first.'));
    const result = await gate.call('run', { featureId: c.id, params: c.params, input: effectiveInput(c), record: true });
    if (stamp !== epoch || c !== current) return;
    c.result = result.result; c.params = result.params;
    if (c.id === 'appearance_custom_themes') gate.applyAppearance(result.params);
    // Draft analyses do not send notifications; only saved active profiles do.
    render(); feedback(tr('Analiz tamamlandı.', 'Analysis completed.'));
  }
  async function open(id, host) {
    if (current) close();
    const stamp = ++epoch; host.dataset.featureOpen = id;
    const workspace = await gate.call('workspace', { featureId: id }); if (stamp !== epoch) return;
    workspaces.set(id, workspace);
    const selected = workspace.profiles.find((p) => p.id === workspace.activeProfile);
    current = { id, host, workspace, profileId: selected?.id || null, params: selected ? structuredClone(selected.params) : defaults(id), name: selected?.name || '', input: null, result: null };
    render();
    if (gate.snapshot()?.featureAccess?.consent) {
      try { current.input = await loadInput(id); if (current?.id !== id || stamp !== epoch) return; if (id === 'merits_optimizer' && current.input.source === 'manual') current.params.manual = true; render(); }
      catch (e) { feedback(errorText(e), true); }
    }
  }
  function close() { epoch++; if (current) { delete current.host.dataset.featureOpen; current = null; gate.repaint(); } }
  document.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-fx-form]') || busy) return;
    e.preventDefault(); busy = true;
    const submit = e.target.querySelector('[type="submit"]'); submit.disabled = true;
    try { await runCurrent(); } catch (error) { feedback(errorText(error), true); } finally { busy = false; current?.host.querySelector('fieldset')?.removeAttribute('disabled'); submit.disabled = false; }
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fx-action],[data-fx-preset]'); if (!b || !current || !current.host.contains(b) || busy) return;
    const action = b.dataset.fxAction;
    if (action === 'close') { close(); return; }
    const c = current, stamp = epoch; busy = true; b.disabled = true;
    try {
      if (b.dataset.fxPreset) { readParams(); c.params.preset = b.dataset.fxPreset; c.params.palette = Object.fromEntries(['bg', 'panel', 'text', 'muted', 'accent'].map((k, i) => [k, palettes[b.dataset.fxPreset][i]])); render(); return; }
      if (action === 'consent') {
        if (!c.host.querySelector('[name="analysis-consent"]').checked) throw new Error(tr('Veri paylaşımı onayını işaretleyin.', 'Please acknowledge data sharing.'));
        await gate.call('consent', { accepted: true }); c.input = await loadInput(c.id); if (c.id === 'merits_optimizer' && c.input?.source === 'manual') c.params.manual = true; render(); return;
      }
      if (action === 'revoke') { await gate.call('consent', { accepted: false }); workspaces.clear(); c.result = null; render(); return; }
      if (action === 'restore-free') { c.workspace = await gate.call('select', { featureId: c.id, revision: c.workspace.revision, profileId: null }); workspaces.set(c.id, c.workspace); gate.clearAppearance(); render(); return; }
      if (action === 'save') {
        const f = c.host.querySelector('[data-fx-form]'); if (!f.reportValidity()) return; readParams();
        c.workspace = await gate.call('save', { featureId: c.id, revision: c.workspace.revision, profileId: c.profileId, name: c.name, params: c.params, activate: true });
        c.profileId = c.workspace.savedId; c.params = c.workspace.profiles.find((p) => p.id === c.profileId).params;
        workspaces.set(c.id, c.workspace); if (c.id === 'appearance_custom_themes') await runCurrent();
        render(); feedback(tr('Profil kaydedildi ve etkinleştirildi.', 'Profile saved and activated.')); await gate.status(true); return;
      }
      if (action === 'delete') { c.workspace = await gate.call('remove', { featureId: c.id, revision: c.workspace.revision, profileId: c.profileId }); c.profileId = null; c.params = defaults(c.id); c.name = ''; c.result = null; workspaces.set(c.id, c.workspace); if (c.id === 'appearance_custom_themes') gate.clearAppearance(); render(); }
    } catch (error) { if (stamp === epoch) feedback(errorText(error), true); }
    finally { busy = false; b.disabled = false; current?.host.querySelector('fieldset')?.removeAttribute('disabled'); }
  });
  document.addEventListener('change', async (e) => {
    if (!current?.host.contains(e.target) || busy) return;
    const c = current;
    if (e.target.matches('[data-fx-profile]')) {
      busy = true;
      try {
        const selected = c.workspace.profiles.find((p) => p.id === e.target.value);
        if (selected) { c.workspace = await gate.call('select', { featureId: c.id, revision: c.workspace.revision, profileId: selected.id }); workspaces.set(c.id, c.workspace); }
        c.profileId = selected?.id || null; c.params = selected ? structuredClone(selected.params) : defaults(c.id); c.name = selected?.name || ''; c.result = null;
        if (selected && c.id === 'appearance_custom_themes') { const r = await gate.call('run', { featureId: c.id, profileId: selected.id }); gate.applyAppearance(r.params); }
        render();
      } catch (error) { feedback(errorText(error), true); } finally { busy = false; current?.host.querySelector('fieldset')?.removeAttribute('disabled'); }
    } else if (e.target.name === 'manual') { readParams(); render(); }
    else if (e.target.name?.startsWith('palette.')) { c.host.querySelector('[name="preset"]').value = 'custom'; }
    else if (['rule.enabled', 'notifications'].includes(e.target.name) && e.target.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  });
  window.addEventListener('lrx-feature-identity-changed', () => { workspaces.clear(); meritCache = null; eventCache = null; close(); });
  window.addEventListener('lrx-feature-access-changed', () => { if (current) { readParams(); render(); } });
  const prevLang = window.onLangChanged; window.onLangChanged = () => { prevLang?.(); if (current) { readParams(); render(); } };
  async function background() {
    if (backgroundBusy || !gate.snapshot()?.featureAccess?.consent) return; backgroundBusy = true;
    try {
      for (const [id, w] of workspaces) {
        if (!gate.can(id)) continue;
        const p = w.profiles.find((p) => p.id === w.activeProfile);
        if (!p || !(p.params.rule?.enabled || p.params.notifications)) continue;
        const input = await loadInput(id, false); if (!input) continue;
        try { const result = await gate.call('run', { featureId: id, profileId: p.id, input, record: false }); alerts(id, result.result, p.id); } catch { /* Skip this failed module without stopping other opted-in rules. */ }
      }
    } catch { /* No alerts based on an unverified or failed analysis. */ } finally { backgroundBusy = false; }
  }
  window.LRXAdvanced = { open, background, resume: async (items) => { for (const item of items || []) { if (!gate.can(item.featureId) || workspaces.get(item.featureId)?.revision === item.revision) continue; workspaces.set(item.featureId, await gate.call('workspace', { featureId: item.featureId })); } } };
  setInterval(background, 60000);
})();
