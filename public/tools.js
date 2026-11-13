/* =========================================================
   LRX Araçlar sayfası (extras.js'ten sonra yüklenir)
   - Alış fiyatı koruması: alış fiyatları (Torn log'u ya da elle) → Item Market / bazaar ilanında uyarı
   - Etkinlikler: Torn takvimi, kişisel başlangıç saati, yıllık etkinlik rehberleri (events.js)
   - Torn sayfa yardımcıları: ne yaptıkları ve açık / kapalı durumları
   Torn kuralları: veriler yalnızca Torn API'den gelir; sayfa yardımcıları yalnızca açık sayfayı boyar, tıklamaz.
   ========================================================= */

Object.assign(I18N, { 'nav.tools': ['Araçlar', 'Tools'] });
Object.assign(VIEW_META, {
  tools: { tr: ['Araçlar', 'Alış fiyatı koruması, etkinlikler ve Torn sayfa yardımcıları'], en: ['Tools', 'Purchase price protection, events and Torn page helpers'] },
});

const toolState = { pur: null, purErr: null, ev: null, evErr: null, cfg: null, add: { name: '', cost: '' }, busy: false };

async function loadTools() {
  const el = $('#tools-body');
  // Yalnızca Ayarlar'da açık olan kartların verisi çekilir
  const needPur = feat('tools.purchases'), needEv = feat('tools.events') || feat('event.guide');
  if (!el.innerHTML.trim() || (!toolState.pur && !toolState.ev)) el.innerHTML = loadingBox();
  await Promise.all([
    needPur ? api('/api/purchases').then((d) => { toolState.pur = d; toolState.purErr = null; }, (e) => { toolState.purErr = e; }) : null,
    needEv ? window.fetchEvents().then((d) => { toolState.ev = d; toolState.evErr = null; }, (e) => { toolState.evErr = e; }) : null,
  ]);
  renderTools();
}

/* ---------- Alış fiyatı koruması ---------- */
function purchaseCard() {
  const head = `<div class="card-head wrap"><h3>🛡️ ${tr('Alış fiyatı koruması', 'Purchase price protection')}</h3>
    <span class="chip ${feat('torn.sellGuard') ? 'green' : 'dim'}">${feat('torn.sellGuard') ? tr('Torn\'da açık', 'On in Torn') : tr('Torn\'da kapalı', 'Off in Torn')}</span></div>`;
  const d = toolState.pur;
  if (!d) return `<article class="glass card">${head}${toolState.purErr ? errorBox(toolState.purErr) : loadingBox()}</article>`;
  const srcName = { manual: tr('elle', 'manual'), market: 'Item Market', bazaar: 'bazaar', shop: tr('mağaza', 'shop'), abroad: tr('yurt dışı', 'abroad') };
  const logLine = d.logAccess
    ? `<span class="chip green">✓ ${tr('Torn log\'u okunuyor', 'Reading your Torn log')}</span> <span class="muted">${tr('Item Market, bazaar, mağaza ve yurt dışı alışların otomatik kaydedilir.', 'Your Item Market, bazaar, shop and abroad purchases are recorded automatically.')}</span>`
    : `<span class="chip warn">${tr('Log erişimi yok', 'No log access')}</span> <span class="muted">${d.logError === 'ACCESS'
      ? tr('Key\'in Limited seviyesinde; Torn log\'u yalnızca Full ya da "log" izinli özel key ile okunur. Böyle bir key\'i Ayarlar → Hesap\'tan ekleyebilir ya da alış fiyatını elle girebilirsin.', 'Your key is Limited; the Torn log can only be read with a Full key or a custom key with "log" access. Add one in Settings → Account, or enter purchase prices manually.')
      : esc(d.logError || '')}</span>`;
  const rows = d.items.map((it) => {
    const diff = it.market ? it.market - it.cost : null;
    return `<tr><td><b>${esc(it.name)}</b></td><td class="num">${money(it.cost)}</td>
      <td class="num muted">${it.market ? money(it.market) : '—'}</td>
      <td class="num ${diff == null ? '' : diff < 0 ? 'neg' : 'pos'}">${diff == null ? '—' : `${diff < 0 ? '' : '+'}${money(diff)}`}</td>
      <td class="muted">${srcName[it.src] || esc(it.src)}${it.n > 1 ? ` · ${tr(`${it.n} alış ort.`, `avg. of ${it.n} buys`)}` : ''}</td>
      <td class="muted">${new Date(it.at).toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'tr-TR')}</td>
      <td>${it.src === 'manual' ? `<button class="btn sm ghost" data-pur-del="${it.id}" title="${tr('Elle girileni sil', 'Remove manual price')}">✕</button>` : ''}</td></tr>`;
  }).join('');
  return `<article class="glass card">${head}
    <p style="margin:0 0 10px">${logLine}</p>
    <div class="tl-row">
      <label class="tl-field"><span class="muted">${tr('Eşya', 'Item')}</span>
        <input id="pur-name" list="pur-catalog" placeholder="${tr('örn. Xanax', 'e.g. Xanax')}" value="${esc(toolState.add.name)}"></label>
      <label class="tl-field"><span class="muted">${tr('Adet başı alış ($)', 'Cost per item ($)')}</span>
        <input id="pur-cost" inputmode="numeric" placeholder="830000" value="${esc(toolState.add.cost)}"></label>
      <button class="btn sm" id="pur-add">${tr('Kaydet', 'Save')}</button>
    </div>
    <datalist id="pur-catalog">${(d.catalog || []).map(([, n]) => `<option value="${esc(n)}">`).join('')}</datalist>
    ${rows ? `<div class="tbl-wrap"><table class="tbl compact">
      <thead><tr><th>${tr('Eşya', 'Item')}</th><th class="num">${tr('Alış', 'Cost')}</th><th class="num">${tr('Piyasa', 'Market')}</th><th class="num">${tr('Fark', 'Diff')}</th><th>${tr('Kaynak', 'Source')}</th><th>${tr('Tarih', 'Date')}</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : `<div class="muted">${tr('Henüz kayıtlı alış fiyatı yok.', 'No purchase prices recorded yet.')}</div>`}
    <p class="muted" style="margin:10px 0 0">🔑 ${d.logKeyMasked ? tr('Log key kayıtlı', 'Log key saved') : tr('Alışları otomatik kaydetmek için log izinli key ekleyebilirsin', 'You can add a key with log access to record purchases automatically')}
      <button class="btn sm ghost" data-set-go="account">${tr('Ayarlar → Hesap', 'Settings → Account')}</button></p>
    <p class="muted sl-note">${tr(
      'Item Market\'te ilan eklerken ya da bazaar\'a koyarken, alış fiyatını bildiğin eşyanın altında "alış · başa baş" yazar; girdiğin fiyat başa başın altındaysa (Item Market\'te %5 komisyon dahil) kırmızı uyarı çıkar. Uyarı yalnızca bilgi verir; ilanı engellemez.',
      'When you add an Item Market listing or put items in your bazaar, items with a known cost show "bought at · break-even"; a price below break-even (including the 5% Item Market fee) shows a red warning. The warning is informational only and never blocks the listing.')}</p>
  </article>`;
}

/* ---------- Etkinlikler ---------- */
// Torn's calendar is in Torn time (UTC): the dates are shown in it, like everywhere else in the app
const tsDate = (s) => new Date(s * 1000).toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const leftText = (sec) => {
  const s = Math.max(0, sec); const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600);
  return d ? `${d}${tr('g', 'd')} ${h}${tr('sa', 'h')}` : `${h}${tr('sa', 'h')} ${Math.floor((s % 3600) / 60)}${tr('dk', 'm')}`;
};
function eventsCard() {
  const head = `<div class="card-head wrap"><h3>📅 ${tr('Etkinlikler', 'Events')}</h3>
    ${toolState.ev?.startTime ? `<span class="chip dim" title="${tr('Kişisel başlangıçlı etkinlikler bu saatte başlar', 'Events with a personal start begin at this time')}">${tr('Kişisel başlangıç', 'Personal start')}: ${esc(toolState.ev.startTime)}</span>` : ''}</div>`;
  const d = toolState.ev;
  if (!d) return `<article class="glass card">${head}${toolState.evErr ? errorBox(toolState.evErr) : loadingBox()}</article>`;
  const now = Date.now() / 1000;
  const list = d.events.slice(0, 12).map((e) => {
    const live = e.start <= now && e.end >= now, ended = e.end < now;
    return `<div class="ev-row ${live ? 'live' : ''}">
      <div><b>${esc(e.title)}</b> ${live ? `<span class="chip green">${tr('şimdi', 'now')}</span>` : ''} ${e.fixed ? '' : `<span class="chip dim" title="${tr('Başlangıç saati oyuncuya göre değişir', 'Start time depends on the player')}">${tr('kişisel saat', 'personal time')}</span>`}
        <div class="muted aw-desc">${esc(e.description || '')}</div></div>
      <div class="ev-when"><span class="mono">${tsDate(e.start)}${e.end - e.start > 86400 ? ` – ${tsDate(e.end)}` : ''}</span>
        <span class="muted">${live ? `${tr('bitişe', 'ends in')} ${leftText(e.end - now)}` : ended ? tr('bitti', 'ended') : `${tr('başlamasına', 'starts in')} ${leftText(e.start - now)}`} · TCT</span></div>
    </div>`;
  }).join('') || `<div class="muted">${tr('Yaklaşan etkinlik yok.', 'No upcoming events.')}</div>`;
  return `<article class="glass card">${head}<div class="ev-list">${list}</div>
    <p class="muted sl-note">${tr('Torn takviminden (API); kişisel başlangıçlı etkinlikler senin saatine göre gösterilir. Easter, Trick or Treat ve Christmas Town yardımcıları yalnızca o günlerde çalışır (Ayarlar → Etkinlikler).', 'From the Torn calendar (API); events with a personal start are shown at your time. The Easter, Trick or Treat and Christmas Town helpers run only on those days (Settings → Events).')}</p>
  </article>`;
}

/* ---------- Torn sayfa yardımcıları ---------- */
const HELPER_LIST = [
  ['torn.crimeHelper', '🕵️', 'page.php?sid=crimes#/pickpocketing'], ['torn.crimeValue', '💰', 'page.php?sid=crimes'], ['torn.crimeRank', '🚦', 'page.php?sid=crimes#/searchforcash'],['torn.burglaryHelper', '🏠', 'page.php?sid=crimes#/burglary'],
  ['torn.jailHelper', '🔓', 'jailview.php'], ['torn.sellGuard', '🛡️', 'page.php?sid=ItemMarket#/addListing'], ['torn.pokerHelper', '🃏', 'page.php?sid=holdem'],
  ['torn.ctHelper', '🎄', 'christmas_town.php'], ['torn.halloweenHelper', '🎃', 'shops.php?step=candy'], ['torn.eggFinder', '🥚', ''], ['torn.warHelper', '⚔️', 'factions.php'], ['torn.fastSlots', '🎰', 'page.php?sid=slots'],
];
// Etkinlik yardımcıları yalnızca etkinlik penceresinde çalışır
function helperStatus(k, f) {
  if (!feat(k)) return `<span class="chip dim">${tr('kapalı', 'off')}</span>`;
  if (!f.event) return `<span class="chip green">${tr('açık', 'on')}</span>`;
  const s = (toolState.ev?.seasonal || []).find((x) => x.id === f.event);
  return s?.stage === 'live' || s?.stage === 'prep' ? `<span class="chip green">${tr('açık · etkinlikte', 'on · event live')}</span>` : `<span class="chip blue">${tr('etkinlik günlerinde', 'on event days')}</span>`;
}
function helpersCard() {
  const defs = Object.fromEntries(FEATURE_DEFS.map((f) => [f.key, f]));
  return `<article class="glass card">
    <div class="card-head wrap"><h3>🧩 ${tr('Torn sayfa yardımcıları', 'Torn page helpers')}</h3>
      <button class="btn sm ghost" data-view-go="settings">${tr('Ayarlar', 'Settings')}</button></div>
    <div class="ev-list">${HELPER_LIST.filter(([k]) => defs[k]).map(([k, icon, url]) => {
      const f = defs[k]; const [name, desc] = state.lang === 'en' ? f.en : f.tr;
      return `<div class="ev-row"><div><b>${icon} ${esc(name)}</b><div class="muted aw-desc">${esc(desc)}</div></div>
        <div class="ev-when">${helperStatus(k, f)}
        ${url ? `<button class="btn sm ghost" data-open-url="https://www.torn.com/${url}" data-tab-label="${esc(name)}">↗</button>` : ''}</div></div>`;
    }).join('')}</div>
    <p class="muted sl-note">${tr(
      'Torn kuralları gereği bu yardımcılar yalnızca açıp baktığın sayfayı okur ve boyar; Torn\'a fazladan istek atmaz, senin yerine tıklamaz ya da onay ekranlarını atlatmaz. Arka plandaki sekmeden uyarı vermez.',
      'To follow Torn\'s rules, these helpers only read and paint the page you are looking at; they make no extra requests to Torn, never click for you and never skip confirmation screens. They never send alerts from a background tab.')}</p>
  </article>`;
}

function renderTools() {
  const html = (feat('event.guide') && toolState.ev ? window.eventGuideCards() : '') + (feat('tools.events') ? eventsCard() : '')
    + (feat('tools.purchases') ? purchaseCard() : '') + (feat('tools.helpers') ? helpersCard() : '');
  $('#tools-body').innerHTML = html || allCardsOff();
}

async function savePurchase(id, cost) {
  await api('/api/purchases', { method: 'POST', body: JSON.stringify({ id, cost }) });
  toolState.pur = await api('/api/purchases');
  renderTools();
}

$('#tools-body')?.addEventListener('input', (e) => {
  if (e.target.id === 'pur-name') toolState.add.name = e.target.value;
  if (e.target.id === 'pur-cost') toolState.add.cost = e.target.value;
});
$('#tools-body')?.addEventListener('click', async (e) => {
  const go = e.target.closest('[data-view-go]');
  if (go) { document.querySelector(`.nav-item[data-view="${go.dataset.viewGo}"]`)?.click(); return; }
  const sg = e.target.closest('[data-set-go]');
  if (sg) { document.querySelector('.nav-item[data-view="settings"]')?.click(); window.showSettingsTab?.(sg.dataset.setGo); return; }
  if (e.target.id === 'pur-add') {
    const name = toolState.add.name.trim().toLowerCase();
    const hit = (toolState.pur?.catalog || []).find(([, n]) => n.toLowerCase() === name);
    const cost = LRXTravelMath.parsePrice(toolState.add.cost);
    if (!hit) { toast(tr('Eşya bulunamadı; listeden seç.', 'Item not found; pick one from the list.')); return; }
    if (!(cost > 0)) { toast(tr('Geçerli bir fiyat gir: 830000, 830.000, 830k ya da 1.5m.', 'Enter a valid price: 830000, 830,000, 830k or 1.5m.')); return; }
    try { await savePurchase(hit[0], cost); toolState.add = { name: '', cost: '' }; renderTools(); toast(tr('Kaydedildi', 'Saved')); }
    catch (err) { toast(err.message); }
    return;
  }
  const del = e.target.closest('[data-pur-del]');
  if (del) { try { await savePurchase(Number(del.dataset.purDel), 0); } catch (err) { toast(err.message); } return; }
});
// Sayfa açıkken 5 dakikada bir yenile (yalnızca API; log en fazla dakikada bir okunur)
setInterval(() => { if (state.view === 'tools' && trackerVisible()) loadTools(); }, 5 * 60_000);

Object.assign(EXTRA_LOADERS, { tools: loadTools });
// Ayarlardan bir kart ya da Torn yardımcısı açılıp kapanınca sayfa açıksa hemen yenilensin
let toolFeatKey = '';
FEATURE_HOOKS.push(() => {
  const k = FEATURE_DEFS.filter((x) => x.key.startsWith('tools.') || x.group === 'torn' || x.group === 'events').map((x) => +feat(x.key)).join('');
  if (k === toolFeatKey) return;
  const first = !toolFeatKey; toolFeatKey = k;
  if (!first && state.view === 'tools') loadTools();
});
applyLang();
applyFeatures();
