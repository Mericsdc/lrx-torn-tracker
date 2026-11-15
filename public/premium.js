(() => {
  I18N['nav.premium'] = ['Premium', 'Premium'];
  VIEW_META.premium = { tr: ['Premium', 'Üyeliğiniz ve kontrol merkeziniz'], en: ['Premium', 'Your membership and control centre'] };
  const host = $('#premium-content'), feedback = $('#premium-feedback');
  let snapshot = null, admin = null, memberPage = null, lastTest = null, firstTest = null;
  let tab = 'membership', loading = false, acting = false, selectedMember = null;
  const filters = { search: '', filter: 'all', page: 1 };
  const locale = () => state.lang === 'tr' ? 'tr-TR' : 'en-GB';
  const date = (seconds) => seconds ? new Date(seconds * 1000).toLocaleString(locale(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const dateOnly = (seconds) => new Date(seconds * 1000).toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' });
  const number = (value) => Number(Number(value || 0).toFixed(4)).toLocaleString(locale());
  const paths = { crown: 'M3 7l4 4 5-7 5 7 4-4-2 13H5z', arrow: 'M5 12h14m-6-6 6 6-6 6', check: 'm5 12 4 4L19 6', shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6', users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M13 3.13a4 4 0 0 1 0 7.75', clock: 'M12 8v4l3 2', refresh: 'M20 11a8 8 0 1 0-2 6M20 4v7h-7', flask: 'M9 3h6m-5 0v7L4 20h16l-6-10V3M8 14h8', plus: 'M12 5v14M5 12h14' };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${name === 'users' ? '<circle cx="9" cy="7" r="4"/>' : name === 'clock' ? '<circle cx="12" cy="12" r="9"/>' : ''}<path d="${paths[name] || paths.arrow}"/></svg>`;
  const button = (action, label, style = '', extra = '') => `<button type="button" class="btn pm-button ${style}" data-premium-action="${action}" ${extra}>${esc(label)}</button>`;
  const badge = (label, type = '') => `<span class="pm-badge ${type}">${esc(label)}</span>`;
  // The line sticks to the bottom of the window (premium.css), so a result is seen without scrolling; successes clear after 6 s, errors stay.
  let messageTimer = 0;
  const message = (text, error = false) => {
    clearTimeout(messageTimer);
    feedback.textContent = text; feedback.classList.toggle('premium-error', error);
    if (text && !error) messageTimer = setTimeout(() => { if (feedback.textContent === text) feedback.textContent = ''; }, 6000);
  };
  const stateName = (value) => ({ active: tr('Aktif', 'Active'), inactive: tr('Üyelik yok', 'No membership'), expired: tr('Süresi doldu', 'Expired'), applied: tr('Tanımlandı', 'Applied'), pending_identity: tr('Otomatik işleniyor', 'Processing automatically'), review: tr('İnceleme bekliyor', 'Needs review'), rejected: tr('Reddedildi', 'Rejected') })[value] || value;
  const statusBadge = (member) => badge(member.permanent ? tr('Kalıcı', 'Lifetime') : stateName(member.status), member.active || member.status === 'applied' ? 'good' : '');
  const table = (heads, rows, empty = tr('Henüz kayıt yok.', 'No records yet.')) => `<div class="pm-table-wrap"><table class="tbl pm-table"><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${heads.length}"><div class="pm-empty">${icon('clock')}<span>${esc(empty)}</span></div></td></tr>`}</tbody></table></div>`;
  const cell = (...values) => `<tr>${values.map((v) => `<td>${esc(v ?? '—')}</td>`).join('')}</tr>`;
  const field = (name, label, value = '', type = 'text', attrs = '') => `<label class="pm-field"><span>${esc(label)}</span><input class="input" name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
  const reason = () => field('reason', tr('İşlem notu', 'Reason for change'), '', 'text', 'required minlength="5" maxlength="500"');
  function errorText(error) {
    const code = error.code || error.message;
    return ({
      PREMIUM_SERVICE_UNREACHABLE: tr('Üyelik servisine ulaşılamıyor. Biraz sonra yeniden deneyin.', 'Membership service is unreachable. Please try again shortly.'),
      SESSION_EXPIRED: tr('Üyelik bağlantısı otomatik yenileniyor.', 'Membership is reconnecting automatically.'),
      PREMIUM_CONNECT_REQUIRED: tr('Üyelik bağlantısı otomatik kuruluyor. Biraz sonra yenileyin.', 'Membership is connecting automatically. Refresh shortly.'),
      SETTINGS_CHANGED: tr('Ayarlar değişti. Yenileyip tekrar deneyin.', 'Settings changed. Refresh and try again.'),
      PERMANENT_MEMBERSHIP_PROTECTED: tr('Bu kalıcı üyelik süre düzenlemelerinden korunur.', 'This lifetime membership is protected from time adjustments.'),
      IDENTITY_NOT_VERIFIED: tr('Bu oyuncu henüz uygulamaya giriş yapmamış ve ödeme de göndermemiş.', 'This player has not signed in to the app or sent a payment yet.'),
      TEST_ENDPOINT_DISABLED: tr('Bu işlem yalnızca test modunda kullanılabilir.', 'This action is available only in test mode.'),
      PAYMENT_CHECK_IN_PROGRESS: tr('Ödeme kontrolü devam ediyor. Tamamlandıktan sonra yeniden deneyin.', 'A payment check is running. Retry when it has finished.'),
      PREMIUM_DISABLED: tr('Premium bağlantısı kapalı. Ayarlar → Genel → Uygulama bölümünden açabilirsiniz.', 'Premium connection is off. You can turn it on in Settings → General → App.'),
      PREMIUM_SERVICE_ERROR: tr('Üyelik servisi şu anda yanıt vermiyor. Biraz sonra yeniden deneyin.', 'The membership service is not responding right now. Please try again shortly.'),
      TIMEOUT: tr('Üyelik servisi zamanında yanıt vermedi. Biraz sonra yeniden deneyin.', 'The membership service did not respond in time. Please try again shortly.'),
    })[code] || tr('İşlem tamamlanamadı: ', 'Action could not be completed: ') + code;
  }
  // Unknown: configured but not connected (the service is unreachable or connecting, the session is renewing, or there
  // is no key). The snapshot then carries no membership, so a paying member must never read "Not active".
  function heroState(d) {
    const sub = d?.subscription;
    if (!d?.connected || !sub) return 'unknown';
    return sub.permanent ? 'lifetime' : sub.active ? 'active' : sub.status === 'expired' ? 'expired' : 'none';
  }
  // The seal's arc is a 30-day gauge: full while a month or more is left, emptying over the last 30 days.
  const sealFraction = (sub) => sub?.permanent ? 1 : sub?.active ? Math.min(Math.max(Number(sub.remainingDays) || 0, 0), 30) / 30 : 0;
  // A plan's days extend an active membership from its expiry, otherwise from now (all in seconds).
  const extendUntil = (sub, days, now) => (sub?.active && !sub.permanent && sub.expiresAt > now ? sub.expiresAt : now) + days * 86400;
  window.PremiumView = Object.freeze({ sealFraction, heroState, extendUntil });
  const SEAL_CIRCUMFERENCE = 2 * Math.PI * 100;
  // The dash gap is two circumferences, so the entrance (pmArc moves the dash offset from one circumference to 0) starts
  // with nothing drawn and draws clockwise from the top for any fraction.
  function seal(status, sub) {
    const fraction = status === 'unknown' ? 0 : Number(sealFraction(sub).toFixed(4));
    const [value, label] = status === 'active' ? [esc(sub.remainingDays), tr('GÜN KALDI', sub.remainingDays === 1 ? 'DAY REMAINING' : 'DAYS REMAINING')]
      : status === 'lifetime' ? ['∞', tr('ÖMÜR BOYU', 'LIFETIME ACCESS')]
      : status === 'expired' ? ['0', tr('ÜYELİK SONA ERDİ', 'MEMBERSHIP EXPIRED')]
      : status === 'none' ? ['', tr('AKTİF DEĞİL', 'NOT ACTIVE')] : ['—', tr('ÜYELİK DURUMU', 'MEMBERSHIP STATUS')];
    // 1,000+ days (admin adjustments reach 36,500) take a smaller size, so the number stays inside the ring.
    const long = value.length > 4 ? ' is-longer' : value.length > 3 ? ' is-long' : '';
    return `<div class="pm-seal"><svg class="pm-seal-ring" viewBox="0 0 236 236" aria-hidden="true"><defs><linearGradient id="pm-seal-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0"/><stop offset="1"/></linearGradient></defs><circle class="pm-seal-dots" cx="118" cy="118" r="112"/><circle class="pm-seal-track" cx="118" cy="118" r="100"/><circle class="pm-seal-arc" cx="118" cy="118" r="100" transform="rotate(-90 118 118)" stroke-dasharray="${(SEAL_CIRCUMFERENCE * fraction).toFixed(2)} ${(2 * SEAL_CIRCUMFERENCE).toFixed(2)}" data-fraction="${fraction}"/></svg><div class="pm-seal-inner">${icon('crown')}<span class="pm-seal-number${long}">${value}</span><span class="pm-seal-label">${label}</span></div></div>`;
  }
  // Today's stats as three centred facts. While the status is unknown, every fact reads "—".
  function ledger(status) {
    const d = snapshot, sub = d.subscription || {}, known = status !== 'unknown';
    // The owner sees the Xanax received from every member (older services without the field fall back to their own total).
    const ownerTotal = d.account?.admin && d.receivedTotal != null;
    const facts = [
      [tr('Üyelik', 'Membership'), !known ? '—' : sub.permanent ? tr('Kalıcı Premium', 'Lifetime Premium') : sub.active ? 'Premium' : tr('Standart', 'Standard')],
      [tr('Bitiş tarihi', 'Expires'), !known ? '—' : sub.permanent ? tr('Süresiz', 'Never expires') : esc(date(sub.expiresAt))],
      [ownerTotal ? tr('Toplam alınan Xanax', 'Total Xanax received') : tr('Toplam Xanax', 'Total Xanax'), !known ? '—' : `${esc(ownerTotal ? d.receivedTotal : d.balance?.total_received || 0)} <small>Xanax</small>`],
    ];
    return `<dl class="pm-ledger">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
  }
  function hero() {
    const d = snapshot, sub = d.subscription || {}, status = heroState(d);
    const tag = { active: tr('ÜYE', 'MEMBER'), lifetime: tr('KALICI', 'LIFETIME'), expired: tr('SÜRESİ DOLDU', 'EXPIRED') }[status];
    const tools = (window.LRXFeatureCatalog?.premium || []).length;
    const headline = status === 'none' || status === 'expired' ? `${tr(`${tools} gelişmiş araç.`, `${tools} advanced tools.`)} <em>${tr('Tek üyelik.', 'One membership.')}</em>`
      : `${tr('Üyeliğiniz.', 'Your membership.')} <em>${status === 'lifetime' ? tr('Daima sizin.', 'Always yours.') : tr('Bir üst seviyede.', 'Elevated.')}</em>`;
    // Lifetime members see their own name, never another member's.
    const holder = d.account ? `<b>${esc(d.account.name || (d.account.tornId === 4037017 ? 'Ezlira' : String(d.account.tornId)))}</b><span>[${esc(d.account.tornId)}]</span>` : tr('Üyelik durumu otomatik güncellenir', 'Membership updates automatically');
    const connection = d.connected ? '' : `<p class="pm-fine-print pm-connection-status" role="status">${esc(d.connectionError ? errorText({ code: d.connectionError }) : tr('Üyeliğiniz uygulamadaki Torn hesabınızla otomatik eşleştirilir. Xanax gönderdiğinizde süre kendi Torn ID’nize tanımlanır.', 'Membership matches your Torn account automatically. Sending Xanax credits time to your own Torn ID.'))}</p>`;
    const primary = { active: tr('Üyeliği uzat', 'Extend membership'), expired: tr('Üyeliği yenile', 'Renew membership'), none: tr('Planları gör', 'See plans') }[status];
    return `<header class="pm-hero" data-state="${status}"><div class="pm-eyebrow">LRX PREMIUM${tag ? ' · ' + tag : ''}${d.mode === 'test' ? badge(tr('Test ortamı', 'Test workspace')) : ''}</div>${seal(status, sub)}<h2>${headline}</h2><div class="pm-holder"><div class="pm-profile-slot" data-pm-profile hidden></div><p class="pm-holder-text">${holder}</p></div>${connection}${ledger(status)}<div class="pm-hero-actions">${primary ? button('plans', primary, 'pm-primary') : ''}${button('refresh', tr('Yenile', 'Refresh'), 'pm-ghost', `aria-label="${esc(tr('Üyelik durumunu yenile', 'Refresh membership status'))}"`)}</div></header>`;
  }
  // The viewer's own Torn profile in the hero's holder line (profile-card.js, shared with the Overview), shown only
  // when the overview's player is the Premium account itself.
  function profileCard() {
    const p = state.overview?.player, account = snapshot?.account;
    if (!p || !account || Number(p.id) !== Number(account.tornId) || (typeof feat === 'function' && !feat('app.premiumProfile'))) return '';
    return LRXProfileCard.html(p);
  }
  // Updates only the profile slot, so open forms and module workbenches are never re-rendered by an overview refresh.
  function paintProfile() {
    const slot = host.querySelector('[data-pm-profile]'); if (!slot) return;
    const html = profileCard();
    if (!LRXProfileCard.paint(slot, html)) return;
    slot.hidden = !html;
    slot.closest('.pm-holder').classList.toggle('has-profile', !!html);
  }
  // Only owners and admins have more than one tab; a lone "My membership" tab is not shown.
  function nav() {
    const tabs = [['membership', tr('Üyeliğim', 'My membership')], ...(snapshot.account?.admin ? [['members', tr('Üyeler', 'Members')], ['payments', tr('Ödemeler', 'Payments')], ...(snapshot.mode === 'test' ? [['test', tr('Test alanı', 'Test lab')]] : []), ['settings', tr('Ayarlar', 'Settings')]] : [])];
    if (tabs.length < 2) return '';
    return `<nav class="pm-tabs" aria-label="Premium">${tabs.map(([id, label]) => `<button type="button" data-premium-tab="${id}" class="${tab === id ? 'selected' : ''}" aria-pressed="${tab === id}">${esc(label)}</button>`).join('')}</nav>`;
  }
  function sectionTitle(eyebrow, title, aside = '') { return `<div class="pm-section-heading"><div><span class="pm-eyebrow">${esc(eyebrow)}</span><h3>${esc(title)}</h3></div>${aside}</div>`; }
  // A chapter of the membership tab: a centred divider label, then a serif title. Admin tabs keep sectionTitle().
  function chapter(id, label, title, body) { return `<section class="pm-chapter" id="${id}"><div class="pm-divider"><span>${esc(label)}</span></div><h3 class="pm-chapter-title">${esc(title)}</h3>${body}</section>`; }
  // The module slots, filled by feature-access.js and numbered by premium.css.
  function collection(status) {
    const tools = window.LRXFeatureCatalog?.premium || [], n = tools.length, included = status === 'active' || status === 'lifetime';
    const title = included ? tr(`${n} gelişmiş araç, üyeliğinize dahil`, `${n} advanced tools, included`) : tr(`${n} gelişmiş araç`, `${n} advanced tools`);
    return chapter('pm-tools', tr('KOLEKSİYON', 'THE COLLECTION'), title, `${included ? '' : `<p class="pm-chapter-lead">${tr('Premium ile açılır', 'Unlocked with Premium')}</p>`}<div class="pm-collection">${tools.map((f) => `<div data-feature-slot="${f.id}"></div>`).join('')}</div>`);
  }
  // The card matching the member's latest applied payment is lit as their plan; otherwise the 2-Xanax (30-day) card stays recommended.
  const PLANS = [1, 2, 4, 10];
  function paidPlan(transactions) {
    const quantity = Number((transactions || []).find((r) => r.status === 'applied')?.quantity);
    return PLANS.includes(quantity) ? quantity : null;
  }
  // "Until" adds a plan's days to the current expiry, or to now. Lifetime has nothing to extend, and an unknown status is never guessed.
  function plans(status) {
    const d = snapshot, mine = paidPlan(d.transactions), featured = mine ?? 2, dated = status !== 'lifetime' && status !== 'unknown', now = Date.now() / 1000;
    const cards = PLANS.map((q) => {
      const days = q * d.pricing.premiumDays / d.pricing.xanaxPrice, until = dated ? dateOnly(extendUntil(d.subscription, days, now)) : '';
      return `<article class="pm-plan ${q === featured ? 'featured' : ''}" data-plan="${q}"><div class="pm-plan-label">${q === mine ? tr('SON PLANINIZ', 'YOUR PLAN') : q === featured ? tr('ÖNERİLEN', 'RECOMMENDED') : ''}</div><div class="pm-plan-days">${number(days)}</div><div class="pm-plan-price">${tr('gün', 'days')} · <b>${q} Xanax</b></div>${dated ? `<div class="pm-plan-until">${esc(tr(`${until} tarihine kadar`, `until ${until}`))}</div>` : ''}</article>`;
    }).join('');
    return chapter('pm-plans', tr('UZAT', 'EXTEND'), tr('Xanax ile süre ekleyin', 'Add time with Xanax'), `<div class="pm-plans">${cards}</div><div class="pm-receiver"><span>${tr('Alıcı', 'Send to')}</span><b>${esc(d.receiver.name || 'Torn')} [${esc(d.receiver.tornId)}]</b>${button('copy-receiver', tr('ID kopyala', 'Copy ID'), 'pm-ghost')}</div><p class="pm-fine-print">${tr('Mevcut özellikler ve Torn API verilerine erişim ücretsizdir. Premium, yukarıdaki gelişmiş analiz ve kişiselleştirme araçlarını ekler.', 'Existing features and Torn API data access remain free. Premium adds the analysis and personalization tools above.')}</p>`);
  }
  function membership() {
    const d = snapshot, status = heroState(d);
    return collection(status) + plans(status) + (d.connected ? chapter('pm-account', tr('HESAP', 'ACCOUNT'), tr('Ödeme geçmişiniz', 'Your payment history'), `<div class="pm-chapter-aside">${button('receipts', tr('CSV indir', 'Download CSV'), 'pm-ghost')}</div>${paymentTable(d.transactions, false)}`) : '') + privacy();
  }
  function privacy() {
    const d = snapshot, content = `<div class="pm-data-grid"><div><small>${tr('Saklanan veriler', 'Stored data')}</small><p>${tr('Doğrulanmış Torn ID ve oyuncu adı, transfer bilgileri, üyelik süresi ve yönetici işlem kayıtları.', 'Verified Torn ID and player name, transfer metadata, membership period and admin audit records.')}</p></div><div><small>${tr('Kimler erişebilir?', 'Who can access?')}</small><p>${tr('Hesap sahibi ve yetkili servis yöneticileri. Kayıtlar halka açık değildir.', 'The account owner and authorized service operators. Records are not public.')}</p></div><div><small>${tr('Anahtar kullanımı', 'Key usage')}</small><p>${d.mode === 'test' ? tr('Bu test bağlantısı Torn anahtarınızı göndermez; sentetik hesap kullanır.', 'This test connection sends no Torn API key; it uses a synthetic account.') : tr('Uygulamaya girişte üyeliğiniz kayıtlı Torn hesabınızla otomatik eşleştirilir. Anahtar yalnızca hesap kontrolü için kullanılır; üyelik servisinde saklanmaz. Bunu Ayarlar → Genel → Uygulama bölümünden kapatabilirsiniz.', 'App login automatically matches your membership to your saved Torn account. The key is used only for account checks and is not stored by the membership service. You can turn this off in Settings → General → App.')}</p></div><div><small>${tr('Saklama ve iletişim', 'Retention and contact')}</small><p>${esc(d.privacy.recordRetentionPolicy || tr('Canlı kullanım öncesi belirlenecek.', 'To be defined before live use.'))} ${tr('İnceleme metni: ', 'Review text: ')}${esc(d.privacy.reviewRetentionDays)} ${tr('gün.', 'days.')} ${esc(d.privacy.controller)} · ${esc(d.privacy.contact || '—')}</p></div></div><p class="pm-fine-print">${tr('Torn ID ve ilişkili üyelik kayıtları kişisel veri olarak işlenir.', 'Your Torn ID and linked membership records are treated as personal data.')}${d.privacy.termsUrl && /^https:\/\//.test(d.privacy.termsUrl) ? ` <a href="${esc(d.privacy.termsUrl)}" target="_blank" rel="noopener noreferrer">${tr('Servis koşulları', 'Service terms')}</a>` : ''}</p>`;
    return `<details class="pm-privacy" data-pm-details="privacy"><summary>${icon('shield')} ${tr('Verileriniz ve gizlilik', 'Your data and privacy')}</summary>${content}${d.connected ? `<div class="pm-actions">${button('data', tr('Verilerimi indir', 'Download my data'), 'pm-ghost')}${button('erasure-request', tr('Silme değerlendirmesi iste', 'Request erasure assessment'), 'pm-quiet')}</div><p class="pm-fine-print">${tr('Silme talepleri incelemeye alınır; bu işlem anında silme yapmaz.', 'Erasure requests are reviewed by an operator; this does not immediately erase records.')}</p>` : ''}</details>`;
  }
  function paymentTable(rows, manage) {
    return table([manage ? tr('Tarih / İşlem', 'Date / Transaction') : tr('Tarih', 'Date'), ...(manage ? [tr('Oyuncu', 'Player')] : []), 'Xanax', tr('Eklenen süre', 'Time awarded'), tr('Durum', 'Status')], rows.filter(r=>r.status!=='ignored').map((r) => {
      const id=r.eventId||r.event_id, status=r.status;
      const label=status==='review'?tr('Miktar otomatik doğrulanıyor', 'Checking the received quantity'):stateName(status);
      return '<tr><td><b>'+esc(date(r.eventTimestamp||r.event_timestamp))+'</b>'+(manage?'<small class="pm-event-id">'+esc(id)+'</small>':'')+'</td>'+(manage?'<td>'+esc(r.senderName||admin.users?.find(u=>u.tornId===r.torn_sender_id)?.name||r.torn_sender_id||'—')+'</td>':'')+'<td><b>'+esc(r.quantity??'—')+'</b></td><td>'+number(r.premiumDays??r.premium_days)+' '+tr('gün','days')+'</td><td>'+badge(label,status==='applied'?'good':'')+'</td></tr>';
    }));
  }
  function memberView() {
    const p = memberPage || admin.memberSummary, counts = p.counts;
    return `<section class="pm-surface">${sectionTitle(tr('ÜYE DİZİNİ', 'MEMBER DIRECTORY'), tr('Premium üyeleri', 'Premium members'), badge(tr('Yönetici görünümü', 'Admin view')))}<div class="pm-metrics"><div><small>${tr('Tüm hesaplar', 'All accounts')}</small><strong>${esc(counts.total)}</strong></div><div><small>${tr('Aktif Premium', 'Active Premium')}</small><strong>${esc(counts.active)}</strong></div><div><small>${tr('Kalıcı üyeler', 'Lifetime members')}</small><strong>${esc(counts.permanent)}</strong></div></div><form data-premium-form="members" class="pm-member-filters"><input class="input" type="search" name="search" placeholder="${tr('Oyuncu adı veya Torn ID ara', 'Search player name or Torn ID')}" value="${esc(filters.search)}" aria-label="${esc(tr('Üye ara', 'Search members'))}"><select class="input" name="filter" aria-label="${esc(tr('Üyelik durumu', 'Membership status'))}">${[['all', tr('Tüm hesaplar', 'All accounts')], ['active', tr('Aktif', 'Active')], ['expired', tr('Süresi dolan', 'Expired')], ['permanent', tr('Kalıcı', 'Lifetime')], ['inactive', tr('Üyeliği olmayan', 'No membership')]].map(([v, label]) => `<option value="${v}" ${filters.filter === v ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select><button class="btn pm-button pm-ghost" type="submit">${tr('Ara', 'Search')}</button></form>${table([tr('Oyuncu', 'Player'), tr('Durum', 'Status'), tr('Kalan süre', 'Time remaining'), tr('Bitiş', 'Expiry'), ''], p.members.map((m) => `<tr><td><div class="pm-member-cell"><span class="pm-avatar ${m.permanent ? 'gold' : ''}">${m.permanent ? icon('crown') : icon('users')}</span><div><b>${esc(m.name)}</b><small class="mono">[${esc(m.tornId)}]</small></div></div></td><td>${statusBadge(m)}</td><td class="pm-days-cell"><b>${m.permanent ? '∞' : esc(m.remainingDays)}</b><small>${m.permanent ? tr('Kalıcı', 'Lifetime') : tr('gün', m.remainingDays === 1 ? 'day' : 'days')}</small></td><td>${m.permanent ? tr('Süresiz', 'Never expires') : esc(date(m.expiresAt))}</td><td>${m.permanent ? `<span class="pm-protected">${icon('shield')}${tr('Korunuyor', 'Protected')}</span>` : `<button class="btn pm-button pm-ghost" type="button" data-member-id="${esc(m.tornId)}">${tr('Süre düzenle', 'Adjust time')}</button>`}</td></tr>`))}<div class="pm-pagination"><span>${esc(p.total)} ${tr('hesap', 'accounts')} · ${esc(p.page)} / ${esc(p.pages)}</span><div>${button('prev-page', '←', 'pm-quiet', p.page <= 1 ? 'disabled' : '')}${button('next-page', '→', 'pm-quiet', p.page >= p.pages ? 'disabled' : '')}</div></div></section>${selectedMember ? `<section class="pm-surface pm-edit-member">${sectionTitle(tr('ÜYELİK DÜZENLEME', 'MEMBERSHIP ADJUSTMENT'), (p.members.find((m) => m.tornId === selectedMember)?.name || selectedMember) + ' [' + selectedMember + ']', button('cancel-edit', tr('Kapat', 'Close'), 'pm-quiet'))}<form data-premium-form="subscription" class="pm-form"><input type="hidden" name="torn_id" value="${esc(selectedMember)}">${field('days', tr('Eklenecek / çıkarılacak gün', 'Days to add / remove'), '', 'number', 'required min="-36500" max="36500"')}${reason()}<button type="submit" class="btn pm-button pm-primary">${tr('Süreyi güncelle', 'Update time')}</button></form></section>` : ''}`;
  }
  function payments() {
    const pending=admin.transactions.filter(r=>['review','pending_identity'].includes(r.status));
    return '<section class="pm-surface">'+sectionTitle(tr('ÖDEME KAYITLARI','PAYMENT LEDGER'),tr('Otomatik ödemeler','Automatic payments'),badge(pending.length+' '+tr('işleniyor','processing')))+'<p class="pm-fine-print">'+tr('Gelen Xanax miktarı resmî Item receive günlüğünden okunur. Doğrulanan transferlerin Premium süresi otomatik eklenir; kabul veya ret işlemi gerekmez.','Received Xanax quantities come from the official Item receive log. Verified transfers add Premium time automatically; no approval or rejection is required.')+'</p>'+paymentTable(admin.transactions,true)+'</section>';
  }
  function testLab() {
    const result = lastTest, replayId = result?.eventId || admin.testScenarios?.[0]?.event_id;
    return `<section class="pm-surface pm-lab">${sectionTitle(tr('SANDBOX / TEST ALANI', 'SANDBOX / TEST LAB'),tr('Ödemeyi iki adımda doğrulayın', 'Verify a payment in two steps'), badge(tr('Sentetik veriler', 'Synthetic data')))}<p class="pm-muted">${tr('Test hesabı otomatik oluşturulur. Gerçek item gönderimi veya Torn API çağrısı yapılmaz.', 'A synthetic account is created automatically. No real items are sent and Torn API is not called.')}</p><div class="pm-test-steps"><article><span class="pm-step-index">01</span><h4>${tr('2 Xanax transferi', 'Transfer 2 Xanax')}</h4><p>${tr('Yeni bir test oyuncusuna mevcut fiyat üzerinden Premium tanımlayın.', 'Award Premium at the current price to a new synthetic player.')}</p>${button('test-payment', tr('2 Xanax ile test et', 'Test with 2 Xanax'), 'pm-primary')}</article><article><span class="pm-step-index">02</span><h4>${tr('Aynı eventi tekrar gönderin', 'Replay the same event')}</h4><p>${tr('Aynı event ID ile ikinci gönderim, süreyi tekrar artırmamalı.', 'Submitting the same event ID again must not award extra time.')}</p>${button('test-replay', tr('Aynı transferi tekrar gönder', 'Replay same transfer'), 'pm-ghost', replayId ? '' : 'disabled')}</article></div>${result ? `<div class="pm-test-result ${result.processing.status === 'ok' ? 'success' : ''}" id="premium-test-result"><div class="pm-result-title">${icon('shield')}<h4>${result.replay ? tr('Tekrar gönderim sonucu', 'Replay result') : tr('Transfer sonucu', 'Transfer result')}</h4>${badge(result.processing.status === 'ok' ? tr('Doğrulandı', 'Verified') : result.processing.status, result.processing.status === 'ok' ? 'good' : '')}</div><div class="pm-metrics"><div><small>${tr('Bu işlemde eklenen', 'Added this time')}</small><strong data-test-added>${number(result.addedDays)} <span>${tr('gün', 'days')}</span></strong></div><div><small>${tr('Üyenin kalan süresi', 'Member time remaining')}</small><strong data-test-remaining>${number(result.subscription.remainingDays)} <span>${tr('gün', 'days')}</span></strong></div><div><small>${tr('Bu event için kayıt', 'Records for this event')}</small><strong data-test-records>${esc(result.recordCount)}</strong></div></div><div class="pm-test-proof"><span>${result.replay && result.addedDays === 0 && result.recordCount === 1 ? icon('check') + tr('Aynı transfer ikinci kez sayılmadı.', 'The same transfer was not counted twice.') : result.addedDays > 0 ? icon('check') + tr('Premium süresi sunucu tarafından eklendi.', 'Premium time was awarded by the server.') : esc(result.processing.code || result.processing.reason || result.processing.status)}</span>${firstTest && result.replay ? `<small>${tr('İlk işlem', 'First award')}: ${number(firstTest.addedDays)} ${tr('gün', 'days')} · ${tr('Tekrar', 'Replay')}: ${number(result.addedDays)} ${tr('gün', 'days')}</small>` : ''}</div><div class="pm-result-meta"><span>Torn [${esc(result.tornId)}]</span><code>${esc(result.eventId)}</code>${button('view-test-member', tr('Üyeyi görüntüle', 'View member'), 'pm-ghost')}</div></div>` : `<div class="pm-lab-empty">${icon('flask')}<span>${tr('İlk testi başlatın; süre ve tekrar kontrolü burada görünecek.', 'Run the first test to see the time award and duplicate check here.')}</span></div>`}</section>`;
  }
  function settings() {
    const s = admin.settings;
    return `<section class="pm-surface">${sectionTitle(tr('KONTROL MERKEZİ', 'CONTROL CENTRE'), tr('Üyelik ayarları', 'Membership settings'))}${featurePermissions()}<details class="pm-setting" data-pm-details="pricing" open><summary>${tr('Fiyatlandırma', 'Pricing')}<span>${esc(s.xanax_price)} Xanax / ${esc(s.days_per_xanax)} ${tr('gün', 'days')}</span></summary><form data-premium-form="settings" class="pm-form"><input type="hidden" name="revision" value="${esc(s.revision)}">${field('xanax_price', 'Xanax', s.xanax_price, 'number', 'required min="1" max="1000"')}${field('days_per_xanax', tr('Karşılık gelen gün', 'Days per price unit'), s.days_per_xanax, 'number', 'required min="1" max="3650"')}${reason()}<button type="submit" class="btn pm-button pm-primary">${tr('Fiyatı kaydet', 'Save pricing')}</button></form><p class="pm-fine-print">${tr('Yeni fiyat bir saniye sonra yürürlüğe girer. Tamamlanan ödemeler değişmez.', 'The new price takes effect after one second. Completed awards remain unchanged.')}</p></details><details class="pm-setting" data-pm-details="automation"><summary>${tr('Otomatik kontrol', 'Automatic checks')}<span>${s.enabled ? tr('Açık', 'On') : tr('Duraklatıldı', 'Paused')}</span></summary><form data-premium-form="automation" class="pm-form"><input type="hidden" name="revision" value="${esc(s.revision)}">${field('check_interval', tr('Kontrol aralığı (saniye)', 'Interval (seconds)'), s.check_interval, 'number', 'required min="60" max="3600"')}<label class="pm-consent"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}>${tr('Otomatik kontrol açık', 'Automatic checks enabled')}</label>${reason()}<button type="submit" class="btn pm-button pm-primary">${tr('Kaydet', 'Save')}</button></form><div class="pm-actions">${button('check', tr('Şimdi kontrol et', 'Check now'), 'pm-ghost')}</div></details><details class="pm-setting" data-pm-details="errors"><summary>${tr('Hatalar ve işlem kayıtları', 'Errors and audit trail')}<span>${esc(admin.errors.length)} ${tr('hata', 'errors')}</span></summary>${table([tr('Tarih', 'Date'), tr('Hata', 'Error')], admin.errors.map((r) => cell(date(r.created_at), r.code)))}${table([tr('Tarih', 'Date'), 'Torn ID', tr('İşlem', 'Action'), tr('Gerekçe', 'Reason')], admin.audit.map((r) => cell(date(r.created_at), r.actor_torn_id, r.action, r.reason)))}</details><details class="pm-setting" data-pm-details="privacy-requests"><summary>${tr('Gizlilik talepleri', 'Privacy requests')}<span>${esc(admin.privacyRequests.length)}</span></summary>${table(['Torn ID', tr('Tarih', 'Date'), tr('Durum', 'Status')], admin.privacyRequests.map((r) => cell(r.torn_id, date(r.requested_at), r.status)))}</details><details class="pm-setting" data-pm-details="baseline"><summary>${tr('Geçmiş boşluğunu yönet', 'History gap recovery')}</summary><p class="pm-muted">${tr('Eksik transferleri inceleyin. Yeni başlangıç, görülmemiş eski eventlerin atlanmasını onaylar.', 'Reconcile missing transfers first. A new baseline acknowledges skipping unseen old events.')}</p><form data-premium-form="rebaseline" class="pm-form"><label class="pm-consent"><input type="checkbox" name="acknowledgeSkippedTransfers" required>${tr('Atlanabilecek transferleri inceledim', 'I reconciled potentially skipped transfers')}</label>${reason()}<button type="submit" class="btn pm-button pm-ghost">${tr('Yeni başlangıç oluştur', 'Set new baseline')}</button></form></details></section>`;
  }
  // The entrance (premium.css) plays once, on fresh content: the first paint after the view is shown or the identity
  // changes. With motion on, a page still in the host waits hidden (.pm-hold) until that paint replaces it, for at most
  // HOLD_MS, so a slow service never leaves the page blank.
  const HOLD_MS = 1500;
  let animateNext = true, holdTimer = 0;
  function expectEntrance() {
    animateNext = true; clearTimeout(holdTimer);
    const hold = !prefersReducedMotion() && !!host.querySelector('.pm-page');
    host.classList.toggle('pm-hold', hold);
    if (hold) holdTimer = setTimeout(release, HOLD_MS);
  }
  // No fresh paint came in time (a failed or slow refresh, no snapshot): the held page shows again, and a page already
  // in sight never plays the entrance on a later refresh. An empty host keeps it for its first real paint.
  function release() {
    clearTimeout(holdTimer); host.classList.remove('pm-hold');
    if (host.querySelector('.pm-page')) animateNext = false;
  }
  // Once the entrance has played, or was cut short (the view hidden, motion switched off), .pm-enter goes, so it never replays.
  const ENTRANCE = new Set(['pmArc', 'pmRise']);
  const settle = (event) => {
    const page = event.target.closest?.('.pm-page.pm-enter');
    if (!page || !ENTRANCE.has(event.animationName)) return;
    if (event.type === 'animationcancel' || !page.getAnimations({ subtree: true }).some((a) => ENTRANCE.has(a.animationName) && a.playState !== 'finished')) page.classList.remove('pm-enter');
  };
  host.addEventListener('animationend', settle); host.addEventListener('animationcancel', settle);
  // Re-rendering must not collapse open sections or destroy an open module workbench. A notice has nothing to animate,
  // so it takes the pending entrance without the class (which would otherwise never be dropped).
  function paintHost(html, animated = true) {
    const opened = new Map([...host.querySelectorAll('details[data-pm-details]')].map((el) => [el.dataset.pmDetails, el.open]));
    const workbenches = [...host.querySelectorAll('[data-feature-open]')];
    host.innerHTML = `<div class="pm-page${animated && animateNext && !prefersReducedMotion() ? ' pm-enter' : ''}">${html}</div>`;
    animateNext = false; clearTimeout(holdTimer); host.classList.remove('pm-hold');
    for (const el of host.querySelectorAll('details[data-pm-details]')) if (opened.has(el.dataset.pmDetails)) el.open = opened.get(el.dataset.pmDetails);
    for (const old of workbenches) {
      const slot = host.querySelector(`[data-feature-slot="${CSS.escape(old.dataset.featureSlot)}"]`);
      if (slot) slot.replaceWith(old); else window.LRXAdvanced?.close?.();
    }
  }
  // Typed but unsaved form values (search, member days, pricing…) block the automatic refresh.
  function dirty() {
    return [...host.querySelectorAll('[data-premium-form] :is(input:not([type="hidden"]),select,textarea)')].some((el) => {
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
      if (el.tagName === 'SELECT') { const def = [...el.options].findIndex((o) => o.defaultSelected); return el.selectedIndex !== (def < 0 ? 0 : def); }
      return el.value !== el.defaultValue;
    });
  }
  // Connection off / not configured: the same copy and button around a seal emblem with a muted ring.
  function notice(title, text, action) {
    return `<section class="pm-not-configured"><span class="pm-eyebrow">LRX PREMIUM</span><div class="pm-emblem"><svg class="pm-emblem-ring" viewBox="0 0 132 132" aria-hidden="true"><circle class="pm-seal-dots" cx="66" cy="66" r="62"/><circle class="pm-seal-track" cx="66" cy="66" r="53"/></svg>${icon('crown')}</div><h2>${title}</h2><p>${text}</p>${action}</section>`;
  }
  function render() {
    const d = snapshot; if (!d) return;
    if (!d.account?.admin && tab !== 'membership') tab = 'membership';
    if (d.disabled) { paintHost(notice(tr('Premium bağlantısı kapalı.', 'Premium connection is off.'), tr('Üyelik servisine hiçbir şey gönderilmiyor ve Premium modülleri kullanılamıyor. Mevcut özellikler ücretsiz kalır. Bağlantıyı Ayarlar → Genel → Uygulama bölümünden açabilirsiniz.', 'Nothing is sent to the membership service and Premium modules are unavailable. Existing features stay free. You can turn the connection on in Settings → General → App.'), button('open-settings', tr('Ayarları aç', 'Open Settings'), 'pm-primary')), false); return; }
    if (!d.configured) { paintHost(notice(tr('Üyeliğiniz için hazır.', 'Ready for your membership.'), tr('Üyelik servisi bağlandığında durumunuz ve geçmişiniz burada görünecek.', 'Your status and history will appear here once the membership service is connected.'), button('refresh', tr('Tekrar kontrol et', 'Check again'), 'pm-primary')), false); return; }
    let body = tab === 'membership' ? membership() : !admin ? `<section class="pm-surface"><p class="pm-muted">${tr('Kontrol merkezi yükleniyor…', 'Loading control centre…')}</p></section>` : tab === 'members' ? memberView() : tab === 'payments' ? payments() : tab === 'test' ? testLab() : settings();
    paintHost(hero() + nav() + `<div class="pm-tab-content" id="premium-tab-content">${body}</div><footer class="pm-service-line"><span class="pm-live-dot"></span>${tr('Son başarılı kontrol', 'Last successful check')}: ${esc(date(d.check?.lastSuccessAt))}<span>${d.mode === 'test' ? tr('Sentetik test ortamı', 'Synthetic test workspace') : d.enabled ? tr('Otomatik kontrol açık', 'Automatic checks on') : tr('Kontrol duraklatıldı', 'Checks paused')}</span>${d.check?.error ? badge(d.check.error) : ''}</footer>`);
    paintProfile();
    window.PremiumAccess?.repaint();
  }
  function featurePermissions() {
    return `<details class="pm-setting" data-pm-details="feature-permissions"><summary>${tr('Gelişmiş modül yetkileri', 'Advanced module permissions')}</summary><p class="pm-muted">${tr('Varsayılan olarak etkin Premium üyeleri bütün gelişmiş modülleri kullanır. Buradan bir modüle istisna tanımlayabilirsiniz; izin vermek bitmiş üyeliği etkinleştirmez.', 'Active Premium members can use all advanced modules by default. Set individual exceptions here; allowing a module does not activate an expired membership.')}</p><form data-premium-form="feature-permission" class="pm-form">${field('tornId', 'Torn ID', '', 'number', 'required min="1"')}<label> ${tr('Modül', 'Module')}<select name="featureId">${window.LRXFeatureCatalog.premium.map((f) => `<option value="${f.id}">${esc(f.title[state.lang === 'en' ? 1 : 0])}</option>`).join('')}</select></label><label>${tr('İzin', 'Permission')}<select name="allowed"><option value="true">${tr('İzin ver', 'Allow')}</option><option value="false">${tr('Kapat', 'Deny')}</option></select></label>${reason()}<button type="submit" class="btn pm-button pm-primary">${tr('Yetkiyi kaydet', 'Save permission')}</button></form>${table(['Torn ID', tr('Modül', 'Module'), tr('İzin', 'Permission')], (admin.featureOverrides || []).map((r) => cell(r.torn_id, r.feature_id, r.allowed ? tr('Açık', 'Allowed') : tr('Kapalı', 'Denied'))))}</details>`;
  }
  async function loadAdmin() { admin = await api('/api/premium/admin'); }
  async function loadMembers() { memberPage = await api('/api/premium/members', { method: 'POST', body: JSON.stringify(filters) }); }
  // status(true) resolves null when the account changed mid-request: keep the previous snapshot then.
  async function latest() { const next = await (window.PremiumAccess ? window.PremiumAccess.status(true) : api('/api/premium/status')); if (next) snapshot = next; return next; }
  async function refresh() {
    if (loading) return; loading = true;
    if (!snapshot && !host.childElementCount) host.innerHTML = `<p class="pm-muted" role="status">${tr('Üyelik bilgisi yükleniyor…', 'Loading membership…')}</p>`;
    try {
      if (!await latest()) return;
      if (!snapshot.account?.admin) { admin = null; memberPage = null; selectedMember = null; tab = 'membership'; }
      else if (tab !== 'membership') { await loadAdmin(); if (tab === 'members') await loadMembers(); }
      render();
      if (snapshot.disabled) message('');
    } catch (e) {
      if (e.status === 401) { admin = null; memberPage = null; tab = 'membership'; try { if (await latest()) render(); } catch {} }
      if (snapshot?.disabled || e.code === 'PREMIUM_DISABLED') { message(''); return; }
      message(errorText(e), true);
    } finally { loading = false; if (animateNext) release(); }
  }
  const scrollBehavior = () => prefersReducedMotion() ? 'auto' : 'smooth';
  // Brings the plans into view and moves focus there, so keyboard and screen reader users land on them too.
  function showPlans() {
    const plansTitle = $('#pm-plans .pm-chapter-title'); if (!plansTitle) return;
    $('#pm-plans').scrollIntoView({ block: 'start', behavior: scrollBehavior() });
    plansTitle.tabIndex = -1; plansTitle.focus({ preventScroll: true });
  }
  function download(value, filename, type) { const url = URL.createObjectURL(new Blob([value], { type })), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  host.addEventListener('click', async (event) => {
    // A locked module's "Details" opens Premium (feature-access.js); on this page it shows the plans instead, and stops
    // there so that the would-be showView() does not repaint the page and drop the focus.
    if (event.target.closest('.pm-collection .fx-entry.is-locked [data-advanced-open]')) { event.stopPropagation(); showPlans(); return; }
    const targetTab = event.target.closest('[data-premium-tab]');
    const b = event.target.closest('[data-premium-action],[data-member-id]');
    if ((!targetTab && !b) || acting || b?.disabled) return;
    acting = true; if (b) b.disabled = true; message('');
    try {
      if (targetTab) { tab = targetTab.dataset.premiumTab; selectedMember = null; if (tab !== 'membership') { await loadAdmin(); if (tab === 'members') await loadMembers(); } render(); return; }
      if (b.dataset.memberId) { selectedMember = Number(b.dataset.memberId); render(); return; }
      const action = b.dataset.premiumAction;
      if (action === 'refresh') { await refresh(); return; }
      // The plans live on the membership tab; an admin on another tab is taken there first.
      if (action === 'plans') { if (tab !== 'membership') { tab = 'membership'; selectedMember = null; render(); } showPlans(); return; }
      if (action === 'open-settings') { showView('settings'); window.showSettingsTab?.('general'); return; }
      if (action === 'cancel-edit') { selectedMember = null; render(); return; }
      if (action === 'copy-receiver') { await navigator.clipboard.writeText(String(snapshot.receiver.tornId)); message(tr('Alıcı ID kopyalandı.', 'Receiver ID copied.')); return; }
      if (action === 'data') { download(JSON.stringify(await api('/api/premium/data'), null, 2), 'premium-personal-data.json', 'application/json'); return; }
      if (action === 'receipts') { const data = await api('/api/premium/receipts'); download(data.csv, data.filename, 'text/csv'); return; }
      if (action === 'prev-page' || action === 'next-page') { filters.page += action === 'next-page' ? 1 : -1; await loadMembers(); render(); return; }
      if (action === 'view-test-member') { filters.search = String(lastTest.tornId); filters.filter = 'all'; filters.page = 1; tab = 'members'; await loadAdmin(); await loadMembers(); render(); return; }
      if (action === 'test-payment' || action === 'test-replay') {
        const body = action === 'test-payment' ? { quantity: 2 } : { event_id: lastTest?.eventId || admin.testScenarios?.[0]?.event_id };
        lastTest = await api('/api/premium/' + action, { method: 'POST', body: JSON.stringify(body) });
        if (action === 'test-payment') firstTest = lastTest;
        await loadAdmin(); await latest(); render();
        $('#premium-test-result')?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
        message(lastTest.processing.status === 'ok' ? tr('Test tamamlandı.', 'Test completed.') : errorText({ code: lastTest.processing.code || lastTest.processing.status }), lastTest.processing.status !== 'ok'); return;
      }
      const result = await api('/api/premium/' + action, { method: 'POST', body: '{}' });
      if (action === 'disconnect') { admin = null; memberPage = null; lastTest = null; firstTest = null; tab = 'membership'; }
      await refresh(); message(action === 'erasure-request' ? tr('Silme talebiniz incelemeye alındı. Veriler henüz silinmedi.', 'Your erasure request was queued for assessment. Data has not yet been erased.') : tr('İşlem tamamlandı. ', 'Action completed. ') + (result.status || ''));
    } catch (e) { message(errorText(e), true); } finally { acting = false; if (b) b.disabled = false; }
  });
  host.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-premium-form]'); if (!form) return;
    event.preventDefault(); if (acting) return; acting = true; const submit = form.querySelector('[type="submit"]'); submit.disabled = true; message('');
    try {
      const action = form.dataset.premiumForm, body = Object.fromEntries(new FormData(form));
      if (action === 'members') { Object.assign(filters, { search: body.search, filter: body.filter, page: 1 }); await loadMembers(); render(); return; }
      if (action === 'feature-permission') { body.tornId = Number(body.tornId); body.allowed = body.allowed === 'true'; }
      for (const key of ['revision', 'xanax_price', 'days_per_xanax', 'check_interval', 'torn_id', 'days', 'id']) if (key in body) body[key] = Number(body[key]);
      if (action === 'automation') body.enabled = form.elements.enabled.checked;
      if (action === 'rebaseline') body.acknowledgeSkippedTransfers = form.elements.acknowledgeSkippedTransfers.checked;
      await api('/api/premium/' + (action === 'automation' ? 'settings' : action), { method: 'POST', body: JSON.stringify(body) });
      selectedMember = null; await loadAdmin(); if (tab === 'members') await loadMembers(); await latest(); render(); message(tr('Kaydedildi.', 'Saved.'));
    } catch (e) { message(errorText(e), true); } finally { acting = false; submit.disabled = false; }
  });
  window.addEventListener('lrx-feature-identity-changed', () => {
    snapshot = admin = memberPage = lastTest = firstTest = selectedMember = null; tab = 'membership';
    Object.assign(filters, { search: '', filter: 'all', page: 1 });
    host.replaceChildren(); expectEntrance(); message('');
    if (state.view === 'premium') refresh();
  });
  // showView() also runs for the view already open (the active nav item, a locked module's link): that only refreshes.
  let shownView = state.view;
  const previousView = window.onViewShown;
  window.onViewShown = (v) => { previousView?.(v); const arrived = v === 'premium' && shownView !== 'premium'; shownView = v; if (v === 'premium') { if (arrived) expectEntrance(); refresh(); } };
  const previousOverview = window.onOverviewRendered;
  window.onOverviewRendered = () => { previousOverview?.(); if (snapshot) paintProfile(); };
  const previousLang = window.onLangChanged;
  window.onLangChanged = () => { previousLang?.(); if (state.view === 'premium') render(); };
  $('#refresh-btn').addEventListener('click', () => { if (state.view === 'premium') refresh(); });
  // The automatic refresh never cuts a running entrance short.
  setInterval(() => { if (state.view === 'premium' && document.visibilityState === 'visible' && !acting && (prefersReducedMotion() || !host.querySelector('.pm-enter')) && !host.querySelector('input:focus,select:focus,textarea:focus,[data-feature-open]') && !dirty()) refresh(); }, 15_000);  if (state.view === 'premium') refresh();
})();
