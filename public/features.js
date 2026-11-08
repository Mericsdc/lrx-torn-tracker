/* =========================================================
   LRX extra features
   - Ayarlar → Özellikler: her özelliği aç / kapat
   - Masaüstü bildirimleri
   - İş Asistanı, Gym & Statlar, Networth, Seyahat Kârı sayfaları
   Bu dosya app.js'ten sonra yüklenir ve onun yardımcılarını kullanır.
   ========================================================= */

/* ---------- Özellik tanımları ---------- */
const FEATURE_DEFS = [
  { group: 'pages', key: 'page.job', def: true, tr: ['İş Asistanı', 'Uygun şirket pozisyonları · bir işin varken gizlenir'], en: ['Job Assistant', 'Positions that fit your working stats · hidden while you have a job'] },
  { group: 'pages', key: 'page.gym', def: true, tr: ['Gym & Statlar', 'Battle stat geçmişi ve günlük artış'], en: ['Gym & Stats', 'Battle stat history and daily gains'] },
  { group: 'pages', key: 'page.networth', def: true, tr: ['Networth', 'Servet dökümü ve günlük değişim'], en: ['Networth', 'Wealth breakdown and daily change'] },
  { group: 'pages', key: 'page.travel', def: true, tr: ['Seyahat Kârı', 'Kâr, stok ve restock zamanları (YATA + Prometheus)'], en: ['Travel Profit', 'Profit, stock and restock times (YATA + Prometheus)'] },
  { group: 'pages', key: 'page.war', def: true, tr: ['Savaş Hedefleri', 'Fair Fight hedef önerileri'], en: ['War Targets', 'Fair Fight target suggestions'] },
  { group: 'pages', key: 'page.company', def: true, tr: ['Şirket sayfaları', 'Stok, rapor, çalışanlar, gelir (yalnızca direktör)'], en: ['Company pages', 'Stock, report, employees, income (directors only)'] },

  { group: 'notify', key: 'notify', def: true, master: true, tr: ['Masaüstü bildirimleri', 'Tümünü aç / kapat'], en: ['Desktop notifications', 'Turn all on / off'] },
  { group: 'notify', key: 'notify.energy', def: true, tr: ['Enerji doldu', ''], en: ['Energy full', ''] },
  { group: 'notify', key: 'notify.nerve', def: true, tr: ['Nerve doldu', ''], en: ['Nerve full', ''] },
  { group: 'notify', key: 'notify.drug', def: true, tr: ['Drug cooldown bitti', ''], en: ['Drug cooldown over', ''] },
  { group: 'notify', key: 'notify.booster', def: false, tr: ['Booster cooldown bitti', ''], en: ['Booster cooldown over', ''] },
  { group: 'notify', key: 'notify.medical', def: false, tr: ['Medical cooldown bitti', ''], en: ['Medical cooldown over', ''] },
  { group: 'notify', key: 'notify.education', def: true, tr: ['Eğitim bitti', ''], en: ['Education finished', ''] },
  { group: 'notify', key: 'notify.travel', def: true, tr: ['Uçak indi', ''], en: ['Plane landed', ''] },
  { group: 'notify', key: 'notify.hospital', def: true, tr: ['Hastaneden çıktın', ''], en: ['You left hospital', ''] },
  { group: 'notify', key: 'notify.restock', def: true, tr: ['Takip ettiğin ürün (★): kalkış zamanı ve restock', ''], en: ['Watched item (★): departure time and restock', ''] },
  { group: 'notify', key: 'notify.targets', def: true, tr: ['Açık sekmedeki oyuncu hastaneden çıktı', ''], en: ['Player in an open tab left hospital', ''] },

  { group: 'app', key: 'app.animations', def: true, tr: ['Animasyonlar', 'Geçişler, sayaç animasyonları, kart efektleri'], en: ['Animations', 'Transitions, counters, card effects'] },
  { group: 'app', key: 'app.splash', def: true, tr: ['Açılış ekranı', 'Uygulama açılırken LRX logosu'], en: ['Splash screen', 'LRX logo on startup'] },
  { group: 'app', key: 'app.torntools', def: true, tr: ['TornTools', 'Yerleşik Torn sekmelerinde TornTools eklentisi (yeniden başlatınca)'], en: ['TornTools', 'TornTools extension in Torn tabs (after restart)'] },
  { group: 'app', key: 'app.updates', def: true, tr: ['Otomatik güncelleme kontrolü', 'Açılışta ve 6 saatte bir'], en: ['Automatic update check', 'On startup and every 6 hours'] },
];
const FEATURE_DEF_MAP = Object.fromEntries(FEATURE_DEFS.map((f) => [f.key, f]));
const EXTRA_VIEWS = { job: 'page.job', gym: 'page.gym', networth: 'page.networth', travel: 'page.travel', war: 'page.war' };

function feat(key) {
  const v = state.config?.features?.[key];
  return typeof v === 'boolean' ? v : (FEATURE_DEF_MAP[key]?.def ?? true);
}
async function setFeature(key, val) {
  state.config ||= {};
  state.config.features = { ...(state.config.features || {}), [key]: val };
  applyFeatures();
  try { await api('/api/features', { method: 'POST', body: JSON.stringify({ features: { [key]: val } }) }); }
  catch (e) { toast(tr('Ayar kaydedilemedi: ', 'Could not save setting: ') + e.message); }
}

/* Görünürlük / tema ayarlarını uygula */
/* Bir işi var mı? (şirket çalışanı/direktörü ya da şehir işi) — İş Asistanı yalnızca işsizken görünür */
function hasJob() {
  const j = state.overview?.player?.job;
  if (!j) return false;
  return Number(j.company_id) > 0 || Boolean(j.job && j.job !== 'None');
}
function viewHidden(v) {
  if (v === 'job' && hasJob()) return true;
  if (EXTRA_VIEWS[v] && !feat(EXTRA_VIEWS[v])) return true;
  return COMPANY_VIEWS.includes(v) && !(feat('page.company') && state.companyMode !== false);
}
function applyNavVisibility() {
  for (const v of [...Object.keys(EXTRA_VIEWS), ...COMPANY_VIEWS]) {
    const b = $(`.nav-item[data-view="${v}"]`);
    if (b) b.hidden = viewHidden(v);
  }
  const ov = $('#ov-company'); if (ov) ov.hidden = viewHidden('stock');
  if (viewHidden(state.view)) showView('overview');
}
function applyFeatures() {
  applyNavVisibility();
  document.body.classList.toggle('no-anim', !feat('app.animations'));
  const tt = $('#tt-open-btn'); if (tt) tt.hidden = !feat('app.torntools');
  const ub = $('#update-btn'); if (ub) ub.hidden = !feat('app.updates');
  renderFeatureSettings();
}

/* ---------- i18n + görünüm başlıkları ---------- */
Object.assign(I18N, {
  'nav.job': ['İş Asistanı', 'Job Assistant'],
  'nav.gym': ['Gym & Statlar', 'Gym & Stats'],
  'nav.networth': ['Networth', 'Networth'],
  'nav.travel': ['Seyahat Kârı', 'Travel Profit'],
});
Object.assign(VIEW_META, {
  job: { tr: ['İş Asistanı', 'Çalışma statlarına göre uygun pozisyonlar'], en: ['Job Assistant', 'Positions that fit your working stats'] },
  gym: { tr: ['Gym & Statlar', 'Battle stat geçmişi ve günlük artış'], en: ['Gym & Stats', 'Battle stat history and daily gains'] },
  networth: { tr: ['Networth', 'Servet dökümü ve değişim'], en: ['Networth', 'Wealth breakdown and change'] },
  travel: { tr: ['Seyahat Kârı', 'Yurt dışından alışverişte en kârlı ürünler'], en: ['Travel Profit', 'Most profitable items to buy abroad'] },
});

/* ---------- Ayarlar → Özellikler kartı ---------- */
function ensureFeatureCard() {
  let card = $('#features-card');
  if (card) return card;
  const host = $('#view-settings');
  if (!host) return null;
  card = document.createElement('article');
  card.className = 'glass card';
  card.id = 'features-card';
  host.appendChild(card);
  card.addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-feature]');
    if (!inp) return;
    const key = inp.dataset.feature;
    if (key.startsWith('notify') && inp.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    setFeature(key, inp.checked);
    if (key === 'app.torntools') toast(tr('TornTools değişikliği uygulama yeniden başlatılınca geçerli olur', 'TornTools change applies after restarting the app'));
  });
  card.addEventListener('click', (e) => {
    if (e.target.closest('#notify-test')) {
      notify('test', tr('LRX Torn Tracker', 'LRX Torn Tracker'), tr('Bildirimler çalışıyor ✓', 'Notifications are working ✓'));
    }
  });
  return card;
}
function renderFeatureSettings() {
  const card = ensureFeatureCard();
  if (!card) return;
  const L = (f) => f[state.lang === 'en' ? 'en' : 'tr'];
  const row = (f, disabled = false) => `<label class="feat-row ${f.master ? 'master' : ''} ${disabled ? 'disabled' : ''}">
      <span class="feat-text"><b>${esc(L(f)[0])}</b>${L(f)[1] ? `<small>${esc(L(f)[1])}</small>` : ''}</span>
      <span class="switch"><input type="checkbox" data-feature="${f.key}" ${feat(f.key) ? 'checked' : ''} ${disabled ? 'disabled' : ''}><i></i></span>
    </label>`;
  const group = (g) => FEATURE_DEFS.filter((f) => f.group === g);
  const notifyOn = feat('notify');
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  card.innerHTML = `
    <div class="card-head"><h3>${tr('Özellikler', 'Features')}</h3><span class="muted">${tr('Açtığın / kapattığın ayarlar bu bilgisayarda saklanır', 'Settings are stored on this computer')}</span></div>
    <div class="feat-grid">
      <section><h4>${tr('Sayfalar', 'Pages')}</h4>${group('pages').map((f) => row(f)).join('')}</section>
      <section><h4>${tr('Bildirimler', 'Notifications')}</h4>
        ${group('notify').map((f) => row(f, !f.master && !notifyOn)).join('')}
        <div class="feat-foot"><button class="btn sm ghost" id="notify-test" ${notifyOn ? '' : 'disabled'}>🔔 ${tr('Test bildirimi', 'Test notification')}</button>
        ${perm === 'denied' ? `<small class="neg">${tr('Bildirim izni engellenmiş', 'Notification permission blocked')}</small>` : ''}</div>
      </section>
      <section><h4>${tr('Uygulama', 'App')}</h4>${group('app').map((f) => row(f)).join('')}</section>
    </div>`;
}

/* ---------- Masaüstü bildirimleri ---------- */
const notified = new Map(); // "tür:id" -> olayın zamanı (ms)
try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem('tt.notified') || '{}'))) notified.set(k, v); } catch {}
function rememberNotified(key, at) {
  notified.set(key, at);
  for (const [k, t] of notified) if (Date.now() - t > 3 * 86400_000) notified.delete(k);
  try { localStorage.setItem('tt.notified', JSON.stringify(Object.fromEntries(notified))); } catch {}
}
function notify(key, title, body, { url = null } = {}) {
  if (!('Notification' in window)) return toast(`${title} · ${body}`);
  const show = () => {
    try {
      const n = new Notification(title, { body, icon: '/logo-64.png', tag: key });
      n.onclick = () => { window.focus(); if (url) openInTab(url, { activate: true, reuse: true }); };
    } catch { toast(`${title} · ${body}`); }
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => (p === 'granted' ? show() : toast(`${title} · ${body}`)));
  else toast(`${title} · ${body}`);
}

/* Olayların zamanını hesapla (ms, yerel saat) */
function notifyEvents() {
  const o = state.overview;
  const ev = [];
  if (o && state.overviewAt) {
    const base = state.overviewAt;
    const bar = (k, name, emoji) => {
      const b = o.bars?.[k];
      if (b && b.fulltime > 0) ev.push({ type: `notify.${k}`, at: base + b.fulltime * 1000, title: `${emoji} ${name}`, body: tr(`${name} doldu (${b.maximum}/${b.maximum})`, `${name} is full (${b.maximum}/${b.maximum})`) });
    };
    bar('energy', 'Energy', '⚡');
    bar('nerve', 'Nerve', '🧠');
    for (const [k, emoji, label] of [['drug', '💊', 'Drug'], ['booster', '🍬', 'Booster'], ['medical', '🩹', 'Medical']]) {
      const s = o.cooldowns?.[k];
      if (s > 0) ev.push({ type: `notify.${k}`, at: base + s * 1000, title: `${emoji} ${label} cooldown`, body: tr(`${label} cooldown bitti`, `${label} cooldown is over`) });
    }
    if (o.education?.timeLeft > 0) ev.push({ type: 'notify.education', at: base + o.education.timeLeft * 1000, title: '🎓 Education', body: tr(`${o.education.current || 'Kurs'} tamamlandı`, `${o.education.current || 'Course'} completed`) });
    if (o.trip?.timeLeft > 0) ev.push({ type: 'notify.travel', at: base + o.trip.timeLeft * 1000, title: '✈ ' + tr('Uçak indi', 'Landed'), body: tr(`${o.trip.destination} vardın`, `Arrived in ${o.trip.destination}`) });
    const st = o.player?.status;
    if (st?.state === 'Hospital' && st.until) ev.push({ type: 'notify.hospital', at: st.until * 1000 - state.skew, title: '🏥 ' + tr('Hastaneden çıktın', 'Out of hospital'), body: tr('Artık müsaitsin', 'You are okay now') });
  }
  // Açık sekmelerdeki oyuncular
  const seen = new Set();
  for (const t of state.browserTabs || []) {
    const xid = extractPlayerId(t.url);
    if (!xid || seen.has(xid)) continue;
    seen.add(xid);
    const d = state.playerInfo?.[xid]?.data;
    const st = d?.status;
    if (st?.state === 'Hospital' && st.until) {
      ev.push({ type: 'notify.targets', at: st.until * 1000 - state.skew, title: `🏥 ${decode(d.name || '#' + xid)}`, body: tr('Hastaneden çıktı — saldırılabilir', 'Left hospital — attackable'), url: `https://www.torn.com/page.php?sid=attack&user2ID=${xid}`, id: xid });
    }
  }
  // Takip edilen ürünler: restock anında inecek şekilde kalkış hatırlatması
  const td = travelState.data;
  if (td && travelState.watch.size) {
    const mult = TRAVEL_METHODS[travelMethod()] || 1;
    for (const c of td.countries) {
      if (!c.minutes) continue;
      for (const it of c.items) {
        const k = `${c.code}:${it.id}`;
        if (!travelState.watch.has(k) || it.qty > 0 || !it.nextRestock) continue;
        ev.push({
          type: 'notify.restock', id: k, at: (it.nextRestock - c.minutes * mult * 60) * 1000 - state.skew,
          title: `✈ ${tr('Kalkış zamanı', 'Time to fly')}: ${c.name}`,
          body: tr(`Şimdi uçarsan ${it.name} restock'una (${hhmm(it.nextRestock)}) yetişirsin`, `Fly now to land at the ${it.name} restock (${hhmm(it.nextRestock)})`),
          url: 'https://www.torn.com/travelagency.php',
        });
      }
    }
  }
  return ev;
}
setInterval(() => {
  if (!feat('notify')) return;
  const now = Date.now();
  for (const e of notifyEvents()) {
    if (!feat(e.type)) continue;
    if (e.at > now || now - e.at > 5 * 60_000) continue; // sadece yeni olaylar (son 5 dk)
    const key = `${e.type}:${e.id || ''}`;
    const prev = notified.get(key);
    if (prev && Math.abs(prev - e.at) < 10 * 60_000) continue; // aynı olay zaten bildirildi
    rememberNotified(key, e.at);
    notify(key, e.title, e.body, { url: e.url });
  }
}, 2000);

/* ---------- Ortak: piksel doğru grafik konteyneri ---------- */
const chartRO = window.ResizeObserver ? new ResizeObserver((entries) => {
  for (const en of entries) { const el = en.target; const w = Math.round(el.clientWidth); if (w && w !== el._w && el._render) { el._w = w; el._render(w); } }
}) : null;
function mountChart(el, render) {
  if (!el) return;
  el._render = (w) => { el.innerHTML = render(Math.max(300, w)); };
  el._w = Math.round(el.clientWidth) || el._w || 900;
  el._render(el._w);
  if (chartRO && !el._observed) { chartRO.observe(el); el._observed = true; }
}
function lineChart(series, W, { height = 240, color = '#c9a96a', fmt = cmoney, fill = true } = {}) {
  const H = height, pl = 66, pr = 14, pt = 16, pb = 30;
  const vals = series.map((p) => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { hi += Math.max(1, Math.abs(hi) * 0.05); lo -= Math.max(1, Math.abs(lo) * 0.05); }
  const step = niceStep((hi - lo) / 4);
  const top = Math.ceil(hi / step) * step, bot = Math.floor(lo / step) * step;
  const x = (i) => pl + (series.length === 1 ? (W - pl - pr) / 2 : (i / (series.length - 1)) * (W - pl - pr));
  const y = (v) => pt + ((top - v) / (top - bot || 1)) * (H - pt - pb);
  let grid = '';
  for (let v = bot; v <= top + 1e-6; v += step) grid += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.05)" stroke-dasharray="3 4"/><text x="${pl - 10}" y="${y(v) + 4}" text-anchor="end" fill="#5f6870" font-size="11" font-family="JetBrains Mono, monospace">${fmt(v)}</text>`;
  const path = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = fill ? `<path d="${path} L${x(series.length - 1)},${y(bot)} L${x(0)},${y(bot)} Z" fill="url(#lcFill)"/>` : '';
  const every = Math.ceil(series.length / Math.max(1, Math.floor((W - pl - pr) / 64)));
  const labels = series.map((p, i) => (i % every === 0 || i === series.length - 1) ? `<text x="${x(i)}" y="${H - 9}" text-anchor="middle" fill="#7d8790" font-size="11">${shortDate(p.date)}</text>` : '').join('');
  const dots = series.length <= 40 ? series.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="3" fill="#0b0c0e" stroke="${color}" stroke-width="1.8"><title>${p.date}: ${fmt(p.v)}</title></circle>`).join('') : '';
  return `<svg class="ic-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="lcFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${grid}${area}<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}
const emptyBox = (title, text) => `<div class="empty-state"><b class="tq-text">${title}</b><br>${text}</div>`;
const loadingBox = () => `<div class="empty-state">${tr('Yükleniyor…', 'Loading…')}</div>`;
const errorBox = (e) => `<div class="alert danger">${esc(e.message || String(e))}</div>`;
const signed = (v, f = cmoney) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${f(v)}`);
const deltaCls = (v) => (v == null ? '' : v >= 0 ? 'pos' : 'neg');

/* ---------- İş Asistanı ---------- */
const jobState = { data: null, at: 0, q: '' };
async function loadJob(force = false) {
  const el = $('#job-body');
  if (!jobState.data) el.innerHTML = loadingBox();
  if (!force && jobState.data && Date.now() - jobState.at < 60_000) return renderJob();
  try { jobState.data = await api('/api/job'); jobState.at = Date.now(); renderJob(); }
  catch (e) { el.innerHTML = errorBox(e); }
}
function renderJob() {
  const d = jobState.data; if (!d) return;
  const w = d.workstats;
  const total = w.man + w.int + w.end;
  const rows = [];
  for (const [tid, t] of Object.entries(d.types)) {
    for (const [pos, p] of Object.entries(t.positions)) {
      const need = { man: p.man_required || 0, int: p.int_required || 0, end: p.end_required || 0 };
      const miss = { man: Math.max(0, need.man - w.man), int: Math.max(0, need.int - w.int), end: Math.max(0, need.end - w.end) };
      const missTotal = miss.man + miss.int + miss.end;
      const gain = (p.man_gain || 0) + (p.int_gain || 0) + (p.end_gain || 0);
      rows.push({ tid, company: t.name, pos, need, miss, missTotal, gain, p, ok: missTotal === 0 });
    }
  }
  const job = d.job || {};
  const jp = d.jobpoints || {};
  const jpList = [
    ...Object.entries(jp.jobs || {}).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v]),
    ...Object.values(jp.companies || {}).map((c) => [c.name, c.jobpoints]),
  ].filter(([, v]) => v > 0);
  const st = (k, v, need) => `<span class="mono ${need && v < need ? 'neg' : ''}">${n0(need)}</span>`;
  const head = `<thead><tr><th>${tr('Şirket türü', 'Company type')}</th><th>${tr('Pozisyon', 'Position')}</th><th class="num">MAN</th><th class="num">INT</th><th class="num">END</th><th class="num">${tr('Günlük kazanç', 'Daily gain')}</th><th>${tr('Özel yetenek', 'Special')}</th></tr></thead>`;
  const line = (r, missing = false) => `<tr title="${esc(r.p.description || '')}">
      <td>${esc(r.company)}</td><td><b>${esc(r.pos)}</b></td>
      <td class="num">${st('man', w.man, r.need.man)}${missing && r.miss.man ? `<div class="sub-text neg">-${n0(r.miss.man)}</div>` : ''}</td>
      <td class="num">${st('int', w.int, r.need.int)}${missing && r.miss.int ? `<div class="sub-text neg">-${n0(r.miss.int)}</div>` : ''}</td>
      <td class="num">${st('end', w.end, r.need.end)}${missing && r.miss.end ? `<div class="sub-text neg">-${n0(r.miss.end)}</div>` : ''}</td>
      <td class="num mono tq-text">+${n0(r.gain)}</td>
      <td class="muted">${esc(r.p.special_ability && r.p.special_ability !== 'None' ? r.p.special_ability : '—')}</td></tr>`;
  $('#job-body').innerHTML = `
    <div class="grid kpis">
      ${kpi('<span lang="en">Manual Labor</span>', n0(w.man))}${kpi('<span lang="en">Intelligence</span>', n0(w.int))}${kpi('<span lang="en">Endurance</span>', n0(w.end))}
      ${kpi(tr('Toplam çalışma statı', 'Total working stats'), n0(total), '', 'tq')}
      ${kpi(tr('Şu anki iş', 'Current job'), esc(jobLabel(job)), Number(job.company_id) > 0 ? `<a href="https://www.torn.com/companies.php" data-open-url="https://www.torn.com/companies.php">${tr('Şirketi aç ↗', 'Open company ↗')}</a>` : `<a href="https://www.torn.com/joblist.php" data-open-url="https://www.torn.com/joblist.php">${tr('İş ilanlarını aç ↗', 'Open job listings ↗')}</a>`, 'txt')}
    </div>
    ${jpList.length ? `<article class="glass card"><div class="card-head"><h3>${tr('İş puanları', 'Job points')}</h3><span class="muted">${tr('Şirket özel yeteneklerinde harcanır', 'Spent on company specials')}</span></div><div class="chip-row">${jpList.map(([n, v]) => `<span class="chip">${esc(n)} <b class="mono">${n0(v)}</b></span>`).join('')}</div></article>` : ''}
    <article class="glass card">
      <div class="card-head wrap"><div><h3>${tr('Girebileceğin pozisyonlar', 'Positions you qualify for')} <span class="chip green" id="job-ok-n"></span></h3><span class="muted">${tr('Günlük çalışma statı kazancına göre sıralı · satırın üzerine gel: açıklama', 'Sorted by daily working-stat gain · hover a row for details')}</span></div>
        <input class="input" id="job-search" placeholder="${tr('Şirket veya pozisyon ara…', 'Search company or position…')}" value="${esc(jobState.q)}" style="max-width:260px">
      </div>
      <div id="job-ok"></div>
    </article>
    <article class="glass card">
      <div class="card-head"><h3>${tr('En yakın hedefler', 'Closest next positions')}</h3><span class="muted">${tr('Kırmızı = eksik stat', 'Red = missing stats')}</span></div>
      <div id="job-near"></div>
    </article>`;
  const fill = () => {
    const q = jobState.q.trim().toLowerCase();
    const match = (r) => !q || r.company.toLowerCase().includes(q) || r.pos.toLowerCase().includes(q);
    const ok = rows.filter((r) => r.ok && match(r)).sort((a, b) => b.gain - a.gain || (b.need.man + b.need.int + b.need.end) - (a.need.man + a.need.int + a.need.end));
    const near = rows.filter((r) => !r.ok && match(r)).sort((a, b) => a.missTotal - b.missTotal).slice(0, 15);
    $('#job-ok-n').textContent = ok.length;
    $('#job-ok').innerHTML = ok.length ? `<div class="tbl-wrap"><table class="tbl compact">${head}<tbody>${ok.slice(0, 40).map((r) => line(r)).join('')}</tbody></table></div>` : emptyBox(tr('Uygun pozisyon yok', 'No qualifying positions'), q ? tr('Aramaya uyan sonuç yok.', 'Nothing matches the search.') : tr('Aşağıdaki en yakın pozisyonlara bak.', 'See the closest positions below.'));
    $('#job-near').innerHTML = near.length ? `<div class="tbl-wrap"><table class="tbl compact">${head}<tbody>${near.map((r) => line(r, true)).join('')}</tbody></table></div>` : emptyBox(q ? tr('Sonuç yok', 'No results') : tr('Hepsine yetiyor', 'You qualify for everything'), '');
  };
  fill();
  $('#job-search')?.addEventListener('input', (e) => { jobState.q = e.target.value; fill(); });
}

/* ---------- Gym & Statlar ---------- */
async function loadGym() {
  const el = $('#gym-body');
  if (!el.innerHTML) el.innerHTML = loadingBox();
  try { renderGym(await api('/api/stats')); } catch (e) { el.innerHTML = errorBox(e); }
}
function renderGym(d) {
  const hist = d.history || [];
  const last = hist[hist.length - 1];
  const ago = (n) => hist[hist.length - 1 - n];
  const gain = (n) => (ago(n) && last ? last.total - ago(n).total : null);
  const sumDiff = (k, n) => (ago(n) && last && last[k] != null && ago(n)[k] != null ? last[k] - ago(n)[k] : null);
  const b = d.battle;
  const total = last?.total ?? b?.totals?.base ?? 0;
  const parts = last ? [['Strength', last.str], ['Defense', last.def], ['Speed', last.spd], ['Dexterity', last.dex]] : [];
  const pal = ['#c9a96a', '#d4d9df', '#8fa3b8', '#b08d6e'];
  $('#gym-body').innerHTML = `
    <div class="grid kpis">
      ${kpi(tr('Toplam battle stat', 'Total battle stats'), n0(total), '', 'tq')}
      ${kpi(tr('Dünden beri', 'Since yesterday'), `<span class="${deltaCls(gain(1))}">${signed(gain(1), n0)}</span>`)}
      ${kpi(tr('7 günde', 'Last 7 days'), `<span class="${deltaCls(gain(7))}">${signed(gain(7), n0)}</span>`, gain(7) != null ? `${tr('günlük ort.', 'daily avg')} ${n0(gain(7) / 7)}` : tr('7 günlük kayıt gerekli', 'needs 7 days of records'))}
      ${kpi(tr('30 günde', 'Last 30 days'), `<span class="${deltaCls(gain(30))}">${signed(gain(30), n0)}</span>`)}
      ${kpi(tr('Xanax (7 gün)', 'Xanax (7 days)'), sumDiff('xantaken', 7) != null ? n0(sumDiff('xantaken', 7)) : '—', `${tr('Refill', 'Refills')}: ${sumDiff('refills', 7) != null ? n0(sumDiff('refills', 7)) : '—'}`)}
    </div>
    <article class="glass card">
      <div class="card-head"><h3>${tr('Toplam stat geçmişi', 'Total stats history')}</h3><span class="muted">${hist.length} ${tr('gün kayıtlı', 'days recorded')}</span></div>
      <div class="chart" id="gym-chart"></div>
    </article>
    ${parts.length ? `<article class="glass card"><div class="card-head"><h3>${tr('Stat dağılımı', 'Stat distribution')}</h3></div>
      <div class="storage-bar">${parts.map(([n, v], i) => `<i style="width:${(v / (last.total || 1)) * 100}%;background:${pal[i]}" title="${n}: ${n0(v)}"></i>`).join('')}</div>
      <div class="legend">${parts.map(([n, v], i) => `<span><b style="background:${pal[i]}"></b>${n} <span class="mono">${n0(v)}</span> <span class="muted">${pct(v / (last.total || 1), 1)}</span></span>`).join('')}</div></article>` : ''}
    <article class="glass card"><div class="card-head"><h3>${tr('Gün gün', 'Day by day')}</h3></div>
      <div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>${tr('Tarih', 'Date')}</th><th class="num">STR</th><th class="num">DEF</th><th class="num">SPD</th><th class="num">DEX</th><th class="num">${tr('Toplam', 'Total')}</th><th class="num">${tr('Artış', 'Gain')}</th><th class="num">Xanax</th></tr></thead><tbody>
      ${hist.slice().reverse().slice(0, 30).map((r) => {
        const i = hist.indexOf(r); const p = hist[i - 1];
        return `<tr><td class="mono">${r.date}</td><td class="num">${n0(r.str)}</td><td class="num">${n0(r.def)}</td><td class="num">${n0(r.spd)}</td><td class="num">${n0(r.dex)}</td><td class="num"><b>${n0(r.total)}</b></td><td class="num ${p ? deltaCls(r.total - p.total) : ''}">${p ? signed(r.total - p.total, n0) : '—'}</td><td class="num">${p && r.xantaken != null && p.xantaken != null ? n0(r.xantaken - p.xantaken) : '—'}</td></tr>`;
      }).join('')}</tbody></table></div></article>`;
  if (hist.length >= 2) mountChart($('#gym-chart'), (W) => lineChart(hist.map((r) => ({ date: r.date, v: r.total })), W, { fmt: (v) => compact(v) }));
  else $('#gym-chart').innerHTML = emptyBox(tr('Geçmiş birikiyor', 'Building history'), tr('Uygulama açık kaldıkça her gün stat kaydı alınır. Grafik 2. günden itibaren görünür.', 'A snapshot is saved every day while the app runs. The chart appears from day 2.'));
}

/* ---------- Networth ---------- */
const NW_PARTS = [
  ['wallet', 'Wallet'], ['bank', 'Bank'], ['cayman', 'Cayman'], ['vault', 'Vault'], ['piggybank', 'Piggy bank'], ['points', 'Points'],
  ['items', 'Items'], ['displaycase', 'Display case'], ['bazaar', 'Bazaar'], ['itemmarket', 'Item market'], ['trade', 'Trade'],
  ['auctionhouse', 'Auction house'], ['stockmarket', 'Stock market'], ['properties', 'Properties'], ['company', 'Company'],
  ['enlistedcars', 'Enlisted cars'], ['bookie', 'Bookie'], ['pending', 'Pending'], ['loan', 'Loan'], ['unpaidfees', 'Unpaid fees'],
];
async function loadNetworth(force = false) {
  const el = $('#networth-body');
  if (!el.innerHTML) el.innerHTML = loadingBox();
  try { renderNetworth(await api('/api/networth' + (force ? '?force=1' : ''))); } catch (e) { el.innerHTML = errorBox(e); }
}
function renderNetworth(d) {
  const cur = d.current || {};
  const hist = d.history || [];
  const ago = (n) => hist[hist.length - 1 - n];
  const chg = (n) => (ago(n) ? (cur.total || 0) - ago(n).total : null);
  const parts = NW_PARTS.map(([k, n]) => [n, Number(cur[k]) || 0, k]).filter(([, v]) => v !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const maxV = Math.max(...parts.map(([, v]) => Math.abs(v)), 1);
  const prev = ago(1);
  $('#networth-body').innerHTML = `
    <div class="grid kpis">
      ${kpi(tr('Toplam networth', 'Total networth'), money(cur.total), `${tr('güncellendi', 'updated')} ${new Date(d.timestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`, 'tq')}
      ${kpi(tr('Dünden beri', 'Since yesterday'), `<span class="${deltaCls(chg(1))}">${signed(chg(1))}</span>`, chg(1) != null && ago(1).total ? pct(chg(1) / ago(1).total, 2) : tr('dünkü kayıt yok', 'no record yesterday'))}
      ${kpi(tr('7 günde', 'Last 7 days'), `<span class="${deltaCls(chg(7))}">${signed(chg(7))}</span>`)}
      ${kpi(tr('30 günde', 'Last 30 days'), `<span class="${deltaCls(chg(30))}">${signed(chg(30))}</span>`)}
      ${kpi(tr('Nakit (cüzdan + banka)', 'Cash (wallet + bank)'), money((cur.wallet || 0) + (cur.bank || 0) + (cur.cayman || 0) + (cur.vault || 0) + (cur.piggybank || 0)))}
    </div>
    <div class="grid two">
      <article class="glass card"><div class="card-head"><h3>${tr('Servet dökümü', 'Wealth breakdown')}</h3><span class="muted">${tr('dünkü değişim', 'change vs yesterday')}</span></div>
        <div class="nw-list">${parts.map(([n, v, k]) => {
          const pv = prev ? Number(prev[k]) || 0 : null; const dv = pv == null ? null : v - pv;
          return `<div class="nw-row"><span>${n}</span><div class="nw-bar"><i style="width:${(Math.abs(v) / maxV) * 100}%;${v < 0 ? 'background:var(--danger)' : ''}"></i></div><span class="mono">${cmoney(v)}</span><span class="mono sub-text ${deltaCls(dv)}">${dv ? signed(dv) : ''}</span></div>`;
        }).join('')}</div></article>
      <article class="glass card"><div class="card-head"><h3>${tr('Networth geçmişi', 'Networth history')}</h3><span class="muted">${hist.length} ${tr('gün kayıtlı', 'days recorded')}</span></div><div class="chart" id="nw-chart"></div></article>
    </div>`;
  if (hist.length >= 2) mountChart($('#nw-chart'), (W) => lineChart(hist.map((r) => ({ date: r.date, v: r.total })), W));
  else $('#nw-chart').innerHTML = emptyBox(tr('Geçmiş birikiyor', 'Building history'), tr('Her gün networth kaydı alınır; grafik 2. günden itibaren görünür.', 'Networth is recorded daily; the chart appears from day 2.'));
}

/* ---------- Seyahat Kârı ---------- */
const TRAVEL_METHODS = { Standard: 1, Airstrip: 0.7, Private: 0.5, Business: 0.3 };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const lsList = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const travelState = {
  data: null, at: 0, q: '',
  cap: Number(lsGet('tt.travel.cap', 15)) || 15,
  method: lsGet('tt.travel.method', ''),
  stock: lsGet('tt.travel.stock', 'arrival'), // all | now | arrival
  type: lsGet('tt.travel.type', 'all'),
  sort: lsGet('tt.travel.sort', 'perHour'),
  minProfit: Number(lsGet('tt.travel.minProfit', 0)) || 0, // saatlik $
  maxFlight: Number(lsGet('tt.travel.maxFlight', 0)) || 0, // tek yön dk (0 = sınırsız)
  countries: new Set(lsList('tt.travel.countries')), // boş = hepsi
  watch: new Set(lsList('tt.travel.watch')),
  watchOnly: lsGet('tt.travel.watchOnly', '0') === '1',
};
function saveTravelPrefs() {
  const t = travelState;
  lsSet('tt.travel.cap', String(t.cap)); lsSet('tt.travel.method', t.method); lsSet('tt.travel.stock', t.stock);
  lsSet('tt.travel.type', t.type); lsSet('tt.travel.sort', t.sort); lsSet('tt.travel.minProfit', String(t.minProfit));
  lsSet('tt.travel.maxFlight', String(t.maxFlight)); lsSet('tt.travel.countries', JSON.stringify([...t.countries]));
  lsSet('tt.travel.watch', JSON.stringify([...t.watch])); lsSet('tt.travel.watchOnly', t.watchOnly ? '1' : '0');
}
const travelMethod = () => {
  const d = travelState.data;
  return travelState.method || (TRAVEL_METHODS[d?.method] ? d.method : 'Standard');
};
const hhmm = (sec) => new Date(sec * 1000 - state.skew).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const mins = (m) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)}${tr('sa', 'h')} ${String(Math.round(m % 60)).padStart(2, '0')}${tr('dk', 'm')}` : `${Math.round(m)}${tr('dk', 'm')}`);
function tvFmt(s) {
  if (s <= 0) return s > -900 ? tr('şimdi', 'now') : tr(`${Math.round(-s / 60)}dk gecikti`, `${Math.round(-s / 60)}m late`);
  s = Math.floor(s);
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 3600)}${tr('sa', 'h')} ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}${tr('dk', 'm')}`;
}
const tvAt = (sec) => `<span class="mono tv-cd" data-tv-at="${sec}">${tvFmt(sec - nowTct() / 1000)}</span>`;

async function fetchTravel() {
  const prev = travelState.data;
  const d = await api('/api/travel');
  travelState.data = d; travelState.at = Date.now();
  // Takip edilen ürün yeniden stoklandıysa haber ver
  if (prev && feat('notify') && feat('notify.restock') && travelState.watch.size) {
    const old = new Map(prev.countries.flatMap((c) => c.items.map((i) => [`${c.code}:${i.id}`, i.qty])));
    for (const c of d.countries) for (const i of c.items) {
      const k = `${c.code}:${i.id}`;
      if (!travelState.watch.has(k) || old.get(k) !== 0 || !(i.qty > 0)) continue;
      const key = `notify.restock.in:${k}`;
      if (Date.now() - (notified.get(key) || 0) < 20 * 60_000) continue;
      rememberNotified(key, Date.now());
      notify(key, `📦 ${i.name} ${tr('stokta', 'in stock')}`, tr(`${c.name}: ${n0(i.qty)} adet`, `${c.name}: ${n0(i.qty)} available`), { url: 'https://www.torn.com/travelagency.php' });
    }
  }
  return d;
}
async function loadTravel(force = false) {
  const el = $('#travel-body');
  if (!travelState.data) el.innerHTML = loadingBox();
  if (force || !travelState.data || Date.now() - travelState.at > 120_000) {
    try { await fetchTravel(); } catch (e) {
      if (!travelState.data) { el.innerHTML = errorBox(e); return; }
      toast(tr('Seyahat verisi yenilenemedi: ', 'Could not refresh travel data: ') + e.message);
    }
  }
  renderTravel();
}

/* Varışta stok durumu */
function stockStatus(it, now, arrive) {
  if (it.qty > 0) return it.emptyAt && it.emptyAt < arrive ? 'risk' : 'ok';
  if (it.nextRestock) {
    if (it.nextRestock <= now) return now - it.nextRestock <= 45 * 60 ? 'due' : 'stale'; // çok gecikmiş tahmin güvenilmez
    return it.nextRestock <= arrive ? 'restock' : 'later';
  }
  return 'no';
}
const STATUS_CHIP = {
  ok: ['green', '✓', ['Varışta stokta', 'In stock on arrival']],
  risk: ['warn', '⚠', ['Varışta bitebilir', 'May sell out before you land']],
  restock: ['blue', '⟳', ['Varışa kadar gelir', 'Restocks before you land']],
  due: ['warn', '⟳', ['Restock her an', 'Restock due any moment']],
  later: ['dim', '⏳', ['Varıştan sonra gelir', 'Restocks after you land']],
  stale: ['dim', '?', ['Tahmin gecikti', 'Estimate overdue']],
  no: ['danger', '✗', ['Stok yok', 'Out of stock']],
};
const statusChip = (s) => { const [cls, ic, label] = STATUS_CHIP[s]; return `<span class="chip ${cls}">${ic} ${tr(label[0], label[1])}</span>`; };

function travelRows({ ignoreStock = false } = {}) {
  const d = travelState.data, t = travelState;
  const mult = TRAVEL_METHODS[travelMethod()] || 1;
  const now = nowTct() / 1000;
  const cap = Math.max(1, t.cap);
  const q = t.q.trim().toLowerCase();
  const rows = [];
  for (const c of d.countries) {
    if (!c.minutes) continue;
    const oneWay = c.minutes * mult;
    if (t.maxFlight && oneWay > t.maxFlight) continue;
    if (t.countries.size && !t.countries.has(c.code)) continue;
    const arrive = now + oneWay * 60;
    for (const it of c.items) {
      const key = `${c.code}:${it.id}`;
      const watched = t.watch.has(key);
      if (t.watchOnly && !watched) continue;
      if (!watched && (it.profit == null || it.profit <= 0)) continue;
      if (t.type !== 'all' && it.type !== t.type) continue;
      if (q && !it.name.toLowerCase().includes(q)) continue;
      const st = stockStatus(it, now, arrive);
      if (!ignoreStock && t.stock === 'now' && it.qty <= 0) continue;
      if (!ignoreStock && t.stock === 'arrival' && (st === 'no' || st === 'later' || st === 'stale')) continue;
      const units = it.qty > 0 ? Math.min(cap, it.qty) : cap;
      const trip = units * (it.profit || 0);
      const round = 2 * oneWay;
      const perHour = trip / (round / 60);
      if (t.minProfit && perHour < t.minProfit) continue;
      rows.push({ c, it, key, watched, st, units, trip, round, oneWay, perHour, arrive });
    }
  }
  const sorters = {
    perHour: (a, b) => b.perHour - a.perHour,
    trip: (a, b) => b.trip - a.trip,
    unit: (a, b) => (b.it.profit || 0) - (a.it.profit || 0),
    restock: (a, b) => (a.it.nextRestock || Infinity) - (b.it.nextRestock || Infinity) || b.perHour - a.perHour,
    flight: (a, b) => a.oneWay - b.oneWay || b.perHour - a.perHour,
  };
  rows.sort(sorters[t.sort] || sorters.perHour);
  return rows;
}

function renderTravel() {
  const d = travelState.data; if (!d) return;
  const t = travelState;
  const method = travelMethod();
  const mult = TRAVEL_METHODS[method] || 1;
  const types = [...new Set(d.countries.flatMap((c) => c.items.map((i) => i.type)).filter(Boolean))].sort();
  const opt = (v, label, cur) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${label}</option>`;
  const countryChips = d.countries.filter((c) => c.minutes).map((c) => `<button class="tv-cbtn ${t.countries.has(c.code) ? 'active' : ''}" data-country="${c.code}" title="${esc(c.name)}"><span lang="en">${esc(c.name)}</span> <small>${mins(c.minutes * mult)}</small></button>`).join('');
  $('#travel-body').innerHTML = `
    <article class="glass card tv-controls">
      <div class="tv-row">
        <input class="input" id="tv-q" placeholder="${tr('Ürün ara… (ör. Xanax, Plushie)', 'Search items… (e.g. Xanax, Plushie)')}" value="${esc(t.q)}">
        <div class="tv-countries"><button class="tv-cbtn ${t.countries.size ? '' : 'active'}" data-country="*">${tr('Tüm ülkeler', 'All countries')}</button>${countryChips}</div>
      </div>
      <div class="tv-row tv-filters">
        <label>${tr('Kapasite', 'Capacity')} <input class="input mono" id="tv-cap" type="number" min="1" max="100" value="${t.cap}"></label>
        <label>${tr('Uçuş', 'Travel')} <select id="tv-method">${Object.keys(TRAVEL_METHODS).map((m) => opt(m, `${m} (×${TRAVEL_METHODS[m]})`, method)).join('')}</select></label>
        <label>${tr('Tür', 'Type')} <select id="tv-type">${opt('all', tr('Hepsi', 'All'), t.type)}${types.map((x) => opt(esc(x), esc(x), t.type)).join('')}</select></label>
        <label>${tr('Stok', 'Stock')} <select id="tv-stock">${opt('arrival', tr('Varışta stokta olacak', 'In stock on arrival'), t.stock)}${opt('now', tr('Şu an stokta', 'In stock now'), t.stock)}${opt('all', tr('Hepsi', 'All'), t.stock)}</select></label>
        <label>${tr('Uçuş süresi', 'Flight time')} <select id="tv-maxflight">${opt(0, tr('Hepsi', 'Any'), t.maxFlight)}${[60, 120, 180, 240].map((m) => opt(m, `≤ ${mins(m)}`, t.maxFlight)).join('')}</select></label>
        <label>${tr('Min. saatlik', 'Min. per hour')} <select id="tv-min">${[0, 50e3, 100e3, 250e3, 500e3, 1e6].map((v) => opt(v, v ? cmoney(v) : tr('Hepsi', 'Any'), t.minProfit)).join('')}</select></label>
        <label>${tr('Sırala', 'Sort')} <select id="tv-sort">${opt('perHour', tr('Saatlik kâr', 'Profit / hour'), t.sort)}${opt('trip', tr('Sefer kârı', 'Profit / trip'), t.sort)}${opt('unit', tr('Adet kârı', 'Profit / unit'), t.sort)}${opt('restock', tr('Restock zamanı', 'Restock time'), t.sort)}${opt('flight', tr('Uçuş süresi', 'Flight time'), t.sort)}</select></label>
        <label class="check"><input type="checkbox" id="tv-watchonly" ${t.watchOnly ? 'checked' : ''}> ★ ${tr('Sadece takip ettiklerim', 'Watched only')}</label>
        <button class="btn sm ghost" id="tv-reset">${tr('Filtreleri sıfırla', 'Reset filters')}</button>
      </div>
    </article>
    <div id="tv-results"></div>`;
  renderTravelResults();
}

function renderTravelResults() {
  const d = travelState.data, box = $('#tv-results');
  if (!d || !box) return;
  const t = travelState;
  const now = nowTct() / 1000;
  const rows = travelRows();
  const best = [];
  for (const r of [...rows].sort((a, b) => b.perHour - a.perHour)) if (!best.some((b) => b.c.code === r.c.code)) best.push(r);
  // Yaklaşan restocklar: stok filtresinden bağımsız, şu an stokta olmayan kârlı ürünler
  const upcoming = travelRows({ ignoreStock: true })
    .filter((r) => r.it.qty <= 0 && r.it.nextRestock && r.it.nextRestock > now - 15 * 60 && r.it.nextRestock < now + 6 * 3600)
    .sort((a, b) => a.it.nextRestock - b.it.nextRestock).slice(0, 14);
  const ages = d.countries.map((c) => c.update).filter(Boolean);
  const age = ages.length ? Math.round((now - Math.min(...ages)) / 60) : null;
  const src = [d.sources?.yata && 'YATA', d.sources?.prom && 'Prometheus'].filter(Boolean).join(' + ') || '—';
  const star = (r) => `<button class="tv-star ${r.watched ? 'on' : ''}" data-watch="${r.key}" title="${r.watched ? tr('Takipten çıkar', 'Unwatch') : tr('Takip et: restock / kalkış bildirimi', 'Watch: restock / departure alerts')}">${r.watched ? '★' : '☆'}</button>`;
  const stockCell = (r) => {
    const it = r.it;
    const sub = it.qty > 0 && it.emptyAt ? `<div class="sub-text">≈ ${tvAt(it.emptyAt)} ${tr('sonra biter', 'until empty')}${it.rate ? ` · −${n0(it.rate)}/${tr('dk', 'm')}` : ''}</div>` : '';
    return `<span class="${it.qty <= 0 ? 'neg' : ''}">${n0(it.qty)}</span>${sub}`;
  };
  const restockCell = (r) => {
    const it = r.it;
    if (it.nextRestock) return `${tvAt(it.nextRestock)}<div class="sub-text">${hhmm(it.nextRestock)} · ${it.restockSrc === 'Prometheus' ? 'Prometheus' : tr('tahmin', 'estimate')}</div>`;
    if (it.qty > 0 && it.lastRestock) return `<span class="muted">${tr('son', 'last')} ${hhmm(it.lastRestock)}</span>`;
    return '<span class="muted">—</span>';
  };
  box.innerHTML = `
    <div class="grid travel-best">${best.slice(0, 6).map((r) => `<div class="glass kpi"><div class="label"><span lang="en">${esc(r.c.name)}</span> · ${mins(r.oneWay)}</div><div class="value tq">${cmoney(r.perHour)}<span class="sub-text">/${tr('sa', 'h')}</span></div><div class="hint">${esc(r.it.name)} · ${cmoney(r.trip)} ${tr('sefer başı', 'per trip')}</div></div>`).join('') || emptyBox(tr('Filtreye uyan kârlı ürün yok', 'No profitable items match the filters'), '')}</div>
    <article class="glass card">
      <div class="card-head"><div><h3>⟳ ${tr('Yaklaşan restocklar', 'Upcoming restocks')}</h3><span class="muted">${tr('Kalkış saati = restock anında inecek şekilde · ★ ile takip edersen kalkış ve stok bildirimi gelir', 'Departure = land right at the restock · ★ an item for departure and restock alerts')}</span></div></div>
      ${upcoming.length ? `<div class="tv-up">${upcoming.map((r) => {
        const depart = r.it.nextRestock - r.oneWay * 60;
        const go = depart > now
          ? `${tr('Kalkış', 'Depart')} <b class="mono">${hhmm(depart)}</b> · ${tvAt(depart)}`
          : `<b class="pos">${tr('Şimdi kalk', 'Fly now')}</b> · ${tr('varış', 'land')} ${hhmm(now + r.oneWay * 60)}`;
        return `<div class="tv-up-row ${r.watched ? 'watched' : ''}">
          ${star(r)}
          <div class="tv-up-time"><b class="mono">${hhmm(r.it.nextRestock)}</b>${tvAt(r.it.nextRestock)}</div>
          <div class="tv-up-item"><b>${esc(r.it.name)}</b><span class="sub-text"><span lang="en">${esc(r.c.name)}</span> · ${mins(r.oneWay)} · ${r.it.restockSrc === 'Prometheus' ? 'Prometheus' : tr('tahmin', 'estimate')}</span></div>
          <div class="tv-up-profit"><span class="pos mono">${money(r.it.profit)}</span><span class="sub-text">${cmoney(r.trip)} ${tr('sefer', 'trip')}</span></div>
          <div class="tv-up-go">${go}</div>
        </div>`;
      }).join('')}</div>` : emptyBox(tr('Önümüzdeki 6 saatte beklenen restock yok', 'No restocks expected in the next 6 hours'), tr('Filtreleri genişletmeyi dene.', 'Try widening the filters.'))}
    </article>
    <article class="glass card">
      <div class="card-head wrap"><div><h3>${tr('Ürünler', 'Items')} <span class="chip">${rows.length}</span></h3><span class="muted">${tr('Kaynak', 'Source')}: ${src}${age != null ? ` · ${tr('en eski veri', 'oldest data')} ${age} ${tr('dk', 'min')}` : ''} · ${tr('uçak bileti hariç', 'excludes ticket cost')}</span></div></div>
      ${rows.length ? `<div class="tbl-wrap"><table class="tbl compact tv-table"><thead><tr><th></th><th>${tr('Ülke', 'Country')}</th><th>${tr('Ürün', 'Item')}</th><th class="num">${tr('Alış → Market', 'Cost → Market')}</th><th class="num">${tr('Adet kârı', 'Profit/unit')}</th><th class="num">${tr('Stok', 'Stock')}</th><th>${tr('Restock', 'Restock')}</th><th>${tr('Varışta', 'On arrival')}</th><th class="num">${tr('Sefer kârı', 'Per trip')}</th><th class="num">${tr('Saatlik', 'Per hour')}</th></tr></thead><tbody>
      ${rows.slice(0, 60).map((r) => `<tr class="${r.watched ? 'watched' : ''}"><td>${star(r)}</td><td><span lang="en">${esc(r.c.name)}</span><div class="sub-text">${mins(r.oneWay)}</div></td><td><b>${esc(r.it.name)}</b> <span class="sub-text">${esc(r.it.type)}</span></td><td class="num">${money(r.it.cost)}<div class="sub-text">${money(r.it.market)}</div></td><td class="num ${(r.it.profit || 0) > 0 ? 'pos' : 'neg'}">${money(r.it.profit || 0)}</td><td class="num">${stockCell(r)}</td><td>${restockCell(r)}</td><td>${statusChip(r.st)}</td><td class="num">${money(r.trip)} <span class="sub-text">×${r.units}</span></td><td class="num tq-text"><b>${cmoney(r.perHour)}</b></td></tr>`).join('')}
      </tbody></table></div>` : emptyBox(tr('Filtreye uyan ürün yok', 'No items match the filters'), tr('Stok filtresini "Hepsi" yapmayı ya da ülke seçimini genişletmeyi dene.', 'Try setting Stock to "All" or selecting more countries.'))}
    </article>`;
}

/* Filtre olayları (tek sefer bağlanır; #travel-body kalıcı) */
(() => {
  const body = $('#travel-body'); if (!body) return;
  const changed = () => { saveTravelPrefs(); renderTravelResults(); };
  body.addEventListener('input', (e) => { if (e.target.id === 'tv-q') { travelState.q = e.target.value; renderTravelResults(); } });
  body.addEventListener('change', (e) => {
    const t = travelState, v = e.target.value;
    switch (e.target.id) {
      case 'tv-cap': t.cap = Math.min(100, Math.max(1, Number(v) || 15)); e.target.value = t.cap; break;
      case 'tv-method': t.method = v; saveTravelPrefs(); return renderTravel(); // uçuş süreleri değişir
      case 'tv-type': t.type = v; break;
      case 'tv-stock': t.stock = v; break;
      case 'tv-maxflight': t.maxFlight = Number(v) || 0; break;
      case 'tv-min': t.minProfit = Number(v) || 0; break;
      case 'tv-sort': t.sort = v; break;
      case 'tv-watchonly': t.watchOnly = e.target.checked; break;
      default: return;
    }
    changed();
  });
  body.addEventListener('click', (e) => {
    const cb = e.target.closest('[data-country]');
    if (cb) {
      const code = cb.dataset.country, set = travelState.countries;
      if (code === '*') set.clear(); else if (set.has(code)) set.delete(code); else set.add(code);
      $$('[data-country]', body).forEach((b) => b.classList.toggle('active', b.dataset.country === '*' ? !set.size : set.has(b.dataset.country)));
      return changed();
    }
    const w = e.target.closest('[data-watch]');
    if (w) {
      const k = w.dataset.watch;
      if (travelState.watch.has(k)) travelState.watch.delete(k); else {
        travelState.watch.add(k);
        if (!feat('notify') || !feat('notify.restock')) toast(tr('Bildirimler kapalı — Ayarlar › Özellikler', 'Notifications are off — Settings › Features'));
        else if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      }
      return changed();
    }
    if (e.target.closest('#tv-reset')) {
      Object.assign(travelState, { q: '', type: 'all', stock: 'arrival', sort: 'perHour', minProfit: 0, maxFlight: 0, watchOnly: false });
      travelState.countries.clear();
      saveTravelPrefs(); renderTravel();
    }
  });
})();

/* Geri sayımlar + otomatik yenileme */
setInterval(() => {
  if (state.view !== 'travel') return;
  const now = nowTct() / 1000;
  $$('[data-tv-at]').forEach((el) => { const s = Number(el.dataset.tvAt) - now; el.textContent = tvFmt(s); el.classList.toggle('due', s <= 0); });
}, 1000);
setInterval(() => {
  const bg = travelState.watch.size && feat('page.travel') && feat('notify') && feat('notify.restock');
  if (state.view !== 'travel' && !bg) return;
  fetchTravel().then(() => { if (state.view === 'travel') renderTravelResults(); }).catch(() => {});
}, 120_000);

/* ---------- Görünüm kancaları ---------- */
const EXTRA_LOADERS = { job: loadJob, gym: loadGym, networth: loadNetworth, travel: loadTravel };
window.onViewShown = (v) => {
  if (v === 'settings') renderFeatureSettings();
  if (EXTRA_LOADERS[v]) EXTRA_LOADERS[v]();
};
$('#refresh-btn')?.addEventListener('click', () => { if (EXTRA_LOADERS[state.view]) EXTRA_LOADERS[state.view](true); });
window.onLangChanged = () => { renderFeatureSettings(); if (EXTRA_LOADERS[state.view]) EXTRA_LOADERS[state.view](); };

applyLang();
applyFeatures();
