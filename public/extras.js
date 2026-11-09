/* =========================================================
   LRX ek sayfalar (features.js'ten sonra yüklenir)
   - Suç Merkezi: shoplifting güvenliği (API) + bildirim, nerve başına kazanç
   - Merit Takibi: eksik honor / medal ve ilerleme (API)
   Torn kuralları: veriler yalnızca Torn API'den gelir; Torn sayfası okunmaz.
   ========================================================= */

Object.assign(I18N, {
  'nav.crimes': ['Suç Merkezi', 'Crime Hub'],
  'nav.awards': ['Merit Takibi', 'Merit Tracker'],
});
Object.assign(VIEW_META, {
  crimes: { tr: ['Suç Merkezi', 'Shoplifting güvenliği ve nerve başına kazanç'], en: ['Crime Hub', 'Shoplifting security and money per nerve'] },
  awards: { tr: ['Merit Takibi', 'Eksik honor ve medal\'lar, en yakın olandan başlayarak'], en: ['Merit Tracker', 'Missing honors and medals, closest first'] },
});

/* ---------- Suç Merkezi ---------- */
const crimeState = {
  shop: null, shopErr: null,
  watch: new Set(lsList('tt.shoplift.watch')),
  lastDown: {}, // mağaza -> son bilinen "hepsi kapalı" durumu (bildirim geçişi için)
  cv: null, cvErr: null, open: null, // nerve başına kazanç tablosu, açık olan suç
  jail: null, jailErr: null,
  burgSort: 'value',
};
const saveShopWatch = () => lsSet('tt.shoplift.watch', JSON.stringify([...crimeState.watch]));

async function fetchShoplifting() {
  try { crimeState.shop = await api('/api/shoplifting'); crimeState.shopErr = null; }
  catch (e) { crimeState.shopErr = e; }
  return crimeState.shop;
}

// Takip edilen mağazada bütün güvenlik kapandığı anda bir kez bildir (veri API'den: arka planda da kurala uygun)
function checkShopliftNotify() {
  const d = crimeState.shop; if (!d) return;
  for (const s of d.stores) {
    const was = crimeState.lastDown[s.key];
    crimeState.lastDown[s.key] = s.allDown;
    if (!s.allDown || was !== false || !crimeState.watch.has(s.key)) continue; // yalnızca açık → kapalı geçişi
    if (!feat('notify') || !feat('notify.shoplift')) continue;
    notify(`shoplift:${s.key}`, `🛒 ${s.name}`, tr('Bütün güvenlik kapalı, şimdi shoplifting zamanı', 'All security is down, time to shoplift'), { url: 'https://www.torn.com/page.php?sid=crimes#/shoplifting' });
  }
}

async function loadCrimes() {
  const el = $('#crimes-body');
  // Yalnızca Ayarlar'da açık olan kartların verisi çekilir
  const need = { shop: feat('crimes.shoplift'), cv: feat('crimes.value') || feat('crimes.burglary') || feat('crimes.shoplift'), jail: feat('crimes.jail') };
  if (!el.innerHTML.trim() || (need.shop && !crimeState.shop && !crimeState.shopErr)) el.innerHTML = loadingBox();
  await Promise.all([
    need.shop ? fetchShoplifting() : null,
    need.cv ? api('/api/crime-value').then((d) => { crimeState.cv = d; crimeState.cvErr = null; }, (e) => { crimeState.cvErr = e; }) : null,
    need.jail ? api('/api/jail').then((d) => { crimeState.jail = d; crimeState.jailErr = null; }, (e) => { crimeState.jailErr = e; }) : null,
  ]);
  if (need.shop) checkShopliftNotify();
  renderCrimes();
}
// Sayfadaki bütün kartlar kapatıldıysa
const allCardsOff = () => emptyBox(tr('Bütün kartlar kapalı', 'All cards are off'),
  tr('Bu sayfadaki kartları Ayarlar → Özellikler → Sayfalar bölümünden açabilirsin.', 'Turn the cards on this page on in Settings → Features → Pages.'));
// Tablodaki bir suç seçeneğinin $/N değeri (büyük/küçük harf duyarsız)
const cvOption = (crime, target) => {
  const c = crimeState.cv?.crimes?.find((x) => x.crime.toLowerCase() === crime);
  return c?.options.find((o) => o.target.toLowerCase() === String(target).toLowerCase())?.value ?? null;
};

function shopCard() {
  const d = crimeState.shop;
  const head = `<div class="card-head wrap"><h3>🛒 ${tr('Shoplifting güvenliği', 'Shoplifting security')}</h3>
    <button class="btn sm ghost" data-open-url="https://www.torn.com/page.php?sid=crimes#/shoplifting" data-tab-label="Shoplifting">${tr('Shoplifting sayfası', 'Shoplifting page')} ↗</button></div>`;
  if (!d) return `<article class="glass card">${head}${crimeState.shopErr ? errorBox(crimeState.shopErr) : loadingBox()}</article>`;
  const tiles = d.stores.map((s) => {
    const watched = crimeState.watch.has(s.key);
    const val = cvOption('shoplifting', s.name);
    return `<div class="sl-tile ${s.allDown ? 'open' : ''}">
      <div class="sl-top"><b>${esc(s.name)}</b>
        <button class="tv-star ${watched ? 'on' : ''}" data-sl-watch="${esc(s.key)}" title="${tr('Güvenlik kapanınca bildir', 'Notify when security is down')}">${watched ? '★' : '☆'}</button></div>
      <div class="sl-sec">${s.security.map((x) => `<span class="chip ${x.down ? 'green' : 'dim'}" title="${x.down ? tr('Kapalı', 'Down') : tr('Aktif', 'Active')}">${x.down ? '✓' : '●'} ${esc(x.title)}</span>`).join('')}</div>
      <div class="sl-foot">${s.allDown ? `<span class="chip tq">🔓 ${tr('Hepsi kapalı', 'All down')}</span>` : `<span class="muted">${tr('Güvenlik açık', 'Security up')}</span>`}
        ${val ? `<span class="muted" title="${tr('Maksimum skill\'de nerve başına ortalama kazanç (topluluk verisi)', 'Average money per nerve at max skill (community data)')}">${cmoney(val)}/nerve</span>` : ''}</div>
    </div>`;
  }).join('');
  return `<article class="glass card">${head}
    <div class="sl-grid">${tiles}</div>
    <p class="muted sl-note">${tr(
      '★ ile takip ettiğin mağazada bütün kamera ve güvenlik kapandığında masaüstü bildirimi gelir. Veri Torn API\'den dakikada bir alınır.',
      'Star a store to get a desktop notification when all its cameras and guards are down. Data comes from the Torn API once a minute.')}
      ${crimeState.shopErr ? `<span class="neg"> · ${esc(crimeState.shopErr.message)}</span>` : ''}</p>
  </article>`;
}

// Nerve başına kazanç (para, XP değil). Kaynak: Emforus'un Crime Profitability Index tablosu (topluluk verisi, günde bir yenilenir).
const cvNote = () => {
  const d = crimeState.cv;
  return `${tr('Maksimum skill\'de nerve başına ortalama para kazancı; düşük skill\'de daha azdır. Crime XP değildir. Kaynak: Emforus\'un Crime Profitability Index tablosu (topluluk verisi).',
    'Average money per nerve at max skill; lower at low skill. This is not crime XP. Source: Emforus\' Crime Profitability Index (community data).')}
    ${d?.fetchedAt ? ` · ${tr('güncelleme', 'updated')} ${new Date(d.fetchedAt).toLocaleDateString()}` : ''}${d?.stale ? ` · <span class="neg">${tr('son kopya kullanılıyor', 'using last copy')}</span>` : ''}`;
};

function valueCard() {
  const head = `<div class="card-head wrap"><h3>💰 ${tr('Nerve başına kazanç', 'Money per nerve')}</h3><span class="chip dim">${tr('maks. skill', 'max skill')}</span></div>`;
  const d = crimeState.cv;
  if (!d) return `<article class="glass card">${head}${crimeState.cvErr ? errorBox(crimeState.cvErr) : loadingBox()}</article>`;
  const rows = [...d.crimes].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const max = Math.max(...rows.map((r) => r.value || 0));
  const body = rows.map((r) => {
    const open = crimeState.open === r.crime;
    const opts = open ? [...r.options].filter((o) => o.value != null).sort((a, b) => b.value - a.value) : [];
    const omax = Math.max(1, ...opts.map((o) => o.value));
    return `<tr class="cv-row" data-cv-crime="${esc(r.crime)}" style="cursor:pointer">
        <td><b>${open ? '▾' : '▸'} ${esc(r.crime)}</b></td><td class="muted">${esc(r.best || tr('veri yok', 'no data'))}</td>
        <td class="num">${r.value != null ? `${cmoney(r.value)}/N` : '—'}</td>
        <td><div class="storage-bar cv-bar"><i style="width:${max && r.value ? Math.max(2, (r.value / max) * 100) : 0}%;background:var(--tq)"></i></div></td></tr>
      ${open ? opts.map((o) => `<tr class="cv-sub"><td></td><td>${esc(o.target)}</td><td class="num ${o.value < 0 ? 'neg' : ''}">${cmoney(o.value)}/N</td>
        <td><div class="storage-bar cv-bar"><i style="width:${o.value > 0 ? Math.max(2, (o.value / omax) * 100) : 0}%;background:${o.value < 0 ? 'var(--danger)' : 'var(--ok)'}"></i></div></td></tr>`).join('')
        || `<tr class="cv-sub"><td></td><td colspan="3" class="muted">${tr('Bu suç için tabloda değer yok (hesaplanamıyor ya da henüz eklenmedi).', 'No values for this crime in the sheet (not calculable or not added yet).')}</td></tr>` : ''}`;
  }).join('');
  return `<article class="glass card">${head}
    <div class="tbl-wrap"><table class="tbl compact">
      <thead><tr><th>${tr('Suç', 'Crime')}</th><th>${tr('En iyi seçenek', 'Best option')}</th><th class="num">$/nerve</th><th style="width:34%"></th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <p class="muted sl-note">${tr('Satıra tıkla: bütün seçenekler. ', 'Click a row for every option. ')}${cvNote()}
      ${tr('Card Skimming, Hustling, Scamming ve Arson hesaplanamadığı için listede yok.', 'Card Skimming, Hustling, Scamming and Arson cannot be calculated, so they are not listed.')}</p>
  </article>`;
}

function burglaryCard() {
  const d = crimeState.cv;
  if (!d?.burglary?.length) return '';
  const key = crimeState.burgSort;
  const list = [...d.burglary].sort((a, b) => (key === 'district' ? a.district.localeCompare(b.district) || b.value - a.value : (b[key] ?? -1) - (a[key] ?? -1)));
  const th = (k, label, cls = '') => `<th class="sortable ${cls}" data-burg-sort="${k}">${label}${key === k ? ' ▾' : ''}</th>`;
  return `<article class="glass card">
    <div class="card-head wrap"><h3>🏠 ${tr('Burglary hedefleri', 'Burglary targets')}</h3>
      <button class="btn sm ghost" data-open-url="https://www.torn.com/page.php?sid=crimes#/burglary" data-tab-label="Burglary">${tr('Burglary sayfası', 'Burglary page')} ↗</button></div>
    <div class="tbl-wrap"><table class="tbl compact">
      <thead><tr>${th('target', tr('Hedef', 'Target'))}${th('district', tr('Bölge', 'District'))}${th('cases', tr('Keşif (case)', 'Casings'), 'num')}${th('nerve', 'Nerve', 'num')}
        ${th('value', '$/N', 'num')}${th('focused', 'Focused $/N', 'num')}${th('incidence', tr('Çıkma oranı', 'Incidence'), 'num')}</tr></thead>
      <tbody>${list.map((b) => `<tr><td><b>${esc(b.target)}</b></td><td class="muted">${esc(b.district)}</td><td class="num">${b.cases ?? '—'}</td>
        <td class="num">${b.nerve ?? '—'}</td><td class="num ${b.value >= 3500 ? 'pos' : ''}">${cmoney(b.value)}</td><td class="num muted">${b.focused != null ? cmoney(b.focused) : '—'}</td>
        <td class="num muted">${b.incidence != null ? `${b.incidence}%` : '—'}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="muted sl-note">${tr(
      'Keşif (case) = burglarize öncesi önerilen casing sayısı; nerve = scout 3 + burglarize 6 + casing başına ~2,5. Çıkma oranı: o bölgede scout yapınca bu hedefin gelme sıklığı. Torn sayfasında da her hedefin yanında bu bilgiler görünür (Ayarlar → Torn yardımcıları).',
      'Casings = recommended casings before burglarizing; nerve = scout 3 + burglarize 6 + ~2.5 per casing. Incidence: how often this target comes up when you scout that district. The same info appears next to each target on the Torn page (Settings → Torn helpers).')}
      ${cvNote()}</p>
  </article>`;
}

function jailCard() {
  const head = `<div class="card-head wrap"><h3>🔓 ${tr('Jail bust takibi', 'Jail bust tracker')}</h3>
    <button class="btn sm ghost" data-open-url="https://www.torn.com/jailview.php" data-tab-label="Jail">${tr('Jail sayfası', 'Jail page')} ↗</button></div>`;
  const d = crimeState.jail;
  if (!d) return `<article class="glass card">${head}${crimeState.jailErr ? errorBox(crimeState.jailErr) : loadingBox()}</article>`;
  const peak = Math.max(1, ...d.decay.map((x) => x.score));
  return `<article class="glass card">${head}
    <div class="grid kpis">
      ${kpi(tr('Başarılı bust', 'Successful busts'), n0(d.total.success), `${n0(d.total.fails)} ${tr('başarısız', 'failed')}`)}
      ${kpi(tr('Son 24 saat', 'Last 24 hours'), n0(d.last24), tr('bust', 'busts'))}
      ${kpi(tr('Son 72 saat', 'Last 72 hours'), n0(d.last72), d.lastBust ? `${tr('son', 'last')}: ${new Date(d.lastBust).toLocaleString()}` : '')}
      ${kpi(tr('Ceza puanı (tahmini)', 'Penalty score (est.)'), n0(d.score), tr('her bust +128, zamanla azalır', '+128 per bust, decays over time'))}
    </div>
    ${d.score > 0 ? `<div class="muted" style="margin:8px 0 4px">${tr('Önümüzdeki 72 saatte puanın', 'Your score over the next 72 hours')}</div>
      <div class="jail-decay">${d.decay.map((x) => `<div title="+${x.h} ${tr('saat', 'h')}: ${x.score}"><i style="height:${Math.max(2, (x.score / peak) * 100)}%"></i><span>${x.h}</span></div>`).join('')}</div>` : ''}
    <p class="muted sl-note">${d.source === 'log'
      ? tr('Bust zamanları Torn log\'undan okunuyor.', 'Bust times are read from your Torn log.')
      : tr('Key\'in log okuyamadığı için bustlar, uygulama açıkken istatistiğindeki artıştan sayılır (önceki bustlar bilinmez). Tam takip için Araçlar sayfasına "log" izinli bir key ekleyebilirsin.',
        'Your key cannot read logs, so busts are counted from your stats while the app is open (earlier busts are unknown). For full tracking, add a key with "log" access on the Tools page.')}
      ${tr('Ceza modeli topluluk tahminidir (BUSTR / Bustr+): her başarılı bust 128 puan ekler, 128/(1+saat/10) ile azalır ve 72 saatte düşer. Torn resmî rakam yayımlamaz. Jail sayfasında her mahkûmun yanında zorluk puanı görünür.',
        'The penalty model is a community estimate (BUSTR / Bustr+): each successful bust adds 128 points, decays as 128/(1+hours/10) and drops off after 72 hours. Torn publishes no official numbers. The jail page shows a difficulty score next to each inmate.')}</p>
  </article>`;
}

function renderCrimes() {
  const html = (feat('crimes.shoplift') ? shopCard() : '') + (feat('crimes.value') ? valueCard() : '')
    + (feat('crimes.burglary') ? burglaryCard() : '') + (feat('crimes.jail') ? jailCard() : '');
  $('#crimes-body').innerHTML = html || allCardsOff();
}

$('#crimes-body')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sl-watch]');
  if (b) {
    const k = b.dataset.slWatch;
    if (crimeState.watch.has(k)) crimeState.watch.delete(k); else crimeState.watch.add(k);
    saveShopWatch(); renderCrimes(); return;
  }
  const row = e.target.closest('[data-cv-crime]');
  if (row) { crimeState.open = crimeState.open === row.dataset.cvCrime ? null : row.dataset.cvCrime; renderCrimes(); return; }
  const th = e.target.closest('[data-burg-sort]');
  if (th) { crimeState.burgSort = th.dataset.burgSort; renderCrimes(); }
});
// Sayfa açıkken ya da takip edilen mağaza varken dakikada bir güncelle (yalnızca API)
setInterval(() => {
  const open = state.view === 'crimes' && trackerVisible();
  const shopOn = feat('page.crimes') && feat('crimes.shoplift');
  const bg = crimeState.watch.size && shopOn && feat('notify') && feat('notify.shoplift');
  if (shopOn && (open || bg)) fetchShoplifting().then(() => { checkShopliftNotify(); if (state.view === 'crimes') renderCrimes(); });
  if (open && feat('crimes.jail')) api('/api/jail').then((d) => { crimeState.jail = d; if (state.view === 'crimes') renderCrimes(); }, () => {});
}, 60_000);

/* ---------- Merit Takibi ---------- */
const awardState = { data: null, err: null, kind: 'all', type: '', q: '', progressOnly: false, limit: 120 };

async function loadAwards(force) {
  const el = $('#awards-body');
  if (!awardState.data || force) el.innerHTML = awardState.data ? el.innerHTML : loadingBox();
  try { awardState.data = await api('/api/awards'); awardState.err = null; }
  catch (e) { awardState.err = e; }
  renderAwards();
}

function awardRows() {
  const d = awardState.data; if (!d) return [];
  const q = awardState.q.trim().toLowerCase();
  return d.awards
    .filter((a) => !a.owned)
    .filter((a) => awardState.kind === 'all' || a.kind === awardState.kind)
    .filter((a) => !awardState.type || a.type === awardState.type)
    .filter((a) => !awardState.progressOnly || a.pct != null)
    .filter((a) => !q || `${a.name} ${a.description}`.toLowerCase().includes(q))
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.circulation - a.circulation);
}

function renderAwards() {
  const el = $('#awards-body');
  const d = awardState.data;
  if (!d) { el.innerHTML = awardState.err ? errorBox(awardState.err) : loadingBox(); return; }
  const types = [...new Set(d.awards.filter((a) => !a.owned).map((a) => a.type))].filter(Boolean).sort();
  const rows = awardRows();
  const [hOwn, hAll] = d.totals.honors, [mOwn, mAll] = d.totals.medals;
  const prev = document.activeElement?.id === 'aw-q';
  el.innerHTML = `
    <div class="grid kpis">
      ${kpi('Honors', `${n0(hOwn)} <small class="muted">/ ${n0(hAll)}</small>`)}
      ${kpi('Medals', `${n0(mOwn)} <small class="muted">/ ${n0(mAll)}</small>`)}
      ${kpi(tr('Toplam ödül', 'Total awards'), n0(d.totals.awards))}
      ${kpi(tr('İlerlemesi ölçülen', 'With progress'), n0(d.awards.filter((a) => !a.owned && a.pct != null).length), tr('eksik ödüllerden', 'of the missing awards'))}
    </div>
    <article class="glass card">
      <div class="card-head wrap">
        <div class="aw-controls">
          <select id="aw-kind"><option value="all">${tr('Hepsi', 'All')}</option><option value="honor" ${awardState.kind === 'honor' ? 'selected' : ''}>Honors</option><option value="medal" ${awardState.kind === 'medal' ? 'selected' : ''}>Medals</option></select>
          <select id="aw-type"><option value="">${tr('Tüm türler', 'All types')}</option>${types.map((t) => `<option ${t === awardState.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
          <input id="aw-q" type="search" placeholder="${tr('Ara…', 'Search…')}" value="${esc(awardState.q)}">
          <label class="check"><input type="checkbox" id="aw-prog" ${awardState.progressOnly ? 'checked' : ''}> ${tr('Sadece ilerlemesi olanlar', 'Only with progress')}</label>
        </div>
        <span class="muted">${n0(rows.length)} ${tr('eksik ödül', 'missing awards')}</span>
      </div>
      <div class="aw-list">${rows.slice(0, awardState.limit).map((a) => `
        <div class="aw-row">
          <div class="aw-main">
            <div><b>${esc(a.name)}</b> <span class="chip ${a.kind === 'honor' ? 'blue' : 'orange'}">${a.kind === 'honor' ? 'Honor' : 'Medal'}</span> <span class="muted aw-type">${esc(a.type)}</span></div>
            <div class="aw-desc">${esc(a.description)}</div>
          </div>
          <div class="aw-prog">${a.pct != null
            ? `<div class="storage-bar"><i style="width:${(a.pct * 100).toFixed(1)}%;background:${a.pct >= 0.9 ? 'var(--ok)' : 'var(--tq)'}"></i></div>
               <span class="mono">${n0(a.cur)} / ${n0(a.goal)} · <b>${(a.pct * 100).toFixed(a.pct >= 0.995 ? 1 : 0)}%</b></span>`
            : `<span class="muted">${a.circulation ? tr(`${n0(a.circulation)} oyuncuda var`, `${n0(a.circulation)} players have it`) : ''}${a.rarity ? ` · ${esc(a.rarity)}` : ''}</span>`}</div>
        </div>`).join('') || `<div class="muted">${tr('Eşleşen eksik ödül yok.', 'No matching missing awards.')}</div>`}</div>
      ${rows.length > awardState.limit ? `<button class="btn sm ghost aw-more" id="aw-more">${tr('Daha fazla göster', 'Show more')} (${n0(rows.length - awardState.limit)})</button>` : ''}
      <p class="muted sl-note">${tr(
        'İlerleme, Torn API\'deki kişisel istatistiklerinden hesaplanır; bazı ödüllerin (tek seferlik olaylar, yarışmalar) ölçülebilir bir istatistiği yoktur. Sıralama: hedefe en yakın olanlar önce, sonra en çok oyuncuda olanlar (en kolaylar).',
        'Progress comes from your personal stats in the Torn API; some awards (one-off events, competitions) have no measurable stat. Order: closest to the goal first, then the ones most players have (the easiest).')}</p>
    </article>`;
  if (prev) { const q = $('#aw-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}

$('#awards-body')?.addEventListener('change', (e) => {
  const id = e.target.id;
  if (id === 'aw-kind') awardState.kind = e.target.value;
  else if (id === 'aw-type') awardState.type = e.target.value;
  else if (id === 'aw-prog') awardState.progressOnly = e.target.checked;
  else return;
  awardState.limit = 120; renderAwards();
});
$('#awards-body')?.addEventListener('input', (e) => { if (e.target.id === 'aw-q') { awardState.q = e.target.value; awardState.limit = 120; renderAwards(); } });
$('#awards-body')?.addEventListener('click', (e) => { if (e.target.id === 'aw-more') { awardState.limit += 120; renderAwards(); } });

/* ---------- Kancalar ---------- */
Object.assign(EXTRA_LOADERS, { crimes: loadCrimes, awards: loadAwards });
// Ayarlardan bir kart açılıp kapanınca sayfa açıksa hemen yenilensin
let crimeFeatKey = '';
FEATURE_HOOKS.push(() => {
  const k = ['crimes.shoplift', 'crimes.value', 'crimes.burglary', 'crimes.jail'].map((x) => +feat(x)).join('');
  if (k === crimeFeatKey) return;
  const first = !crimeFeatKey; crimeFeatKey = k;
  if (!first && state.view === 'crimes') loadCrimes();
});
applyLang();
applyFeatures();
