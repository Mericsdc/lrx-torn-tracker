/* =========================================================
   LRX Geri bildirim (faction.js'ten sonra yüklenir)
   Üst çubuktaki "Geri bildirim" butonu → istek, öneri ya da hata formu.
   Mesaj uygulamanın sunucusu üzerinden e-posta olarak geliştiriciye gider (/api/feedback).
   Yalnızca formdaki alanlar ve sürüm gönderilir; API key asla eklenmez.
   ========================================================= */
(() => {
  const KINDS = [['oneri', '💡', ['Öneri', 'Suggestion']], ['istek', '🙋', ['İstek', 'Request']], ['hata', '🐞', ['Hata', 'Bug']], ['diger', '💬', ['Diğer', 'Other']]];
  const MAX = 4000;
  const DRAFT = 'lrx.feedback.draft';
  let draft = { kind: 'oneri', message: '', name: null, contact: '' };
  try { draft = { ...draft, ...JSON.parse(localStorage.getItem(DRAFT) || '{}') }; } catch {}
  const saveDraft = () => { try { localStorage.setItem(DRAFT, JSON.stringify(draft)); } catch {} };
  let busy = false;

  const modal = () => $('#feedback-modal');
  const tornName = () => {
    const p = state.overview?.player;
    return p?.name ? `${p.name} [${p.id}]` : '';
  };

  function render() {
    const m = modal(); if (!m) return;
    if (draft.name == null) draft.name = tornName();
    m.innerHTML = `<div class="glass card modal-card fb-card" role="dialog" aria-modal="true" aria-labelledby="fb-title">
      <div class="card-head"><h3 id="fb-title">💬 ${tr('Geri bildirim', 'Feedback')}</h3>
        <button class="btn sm ghost" type="button" data-fb-close aria-label="${tr('Kapat', 'Close')}">✕</button></div>
      <form class="form" id="fb-form">
        <p class="muted fb-lead">${tr('İstek, öneri ya da hata bildir. Mesajın e-posta ile doğrudan geliştiriciye gider.', 'Send a request, a suggestion or a bug report. Your message goes straight to the developer by email.')}</p>
        <div class="fb-kinds" role="radiogroup" aria-label="${tr('Konu', 'Topic')}">${KINDS.map(([k, icon, l]) => `
          <label class="fb-kind ${draft.kind === k ? 'on' : ''}"><input type="radio" name="fb-kind" value="${k}" ${draft.kind === k ? 'checked' : ''}><span>${icon} ${tr(...l)}</span></label>`).join('')}
        </div>
        <label><span>${tr('Mesaj', 'Message')}</span>
          <textarea class="input fb-msg" id="fb-msg" rows="7" maxlength="${MAX}" required placeholder="${tr('Ne eklenmeli, ne değişmeli ya da ne bozuk? Ne kadar ayrıntı, o kadar iyi.', 'What should be added or changed, or what is broken? The more detail, the better.')}">${esc(draft.message)}</textarea></label>
        <div class="row">
          <label><span>${tr('Torn adın (isteğe bağlı)', 'Torn name (optional)')}</span><input class="input" id="fb-name" maxlength="80" value="${esc(draft.name || '')}"></label>
          <label><span>${tr('Sana nasıl dönülsün? (isteğe bağlı)', 'How to reach you (optional)')}</span><input class="input" id="fb-contact" maxlength="120" value="${esc(draft.contact)}" placeholder="${tr('e-posta ya da Discord', 'email or Discord')}"></label>
        </div>
        <small class="muted fb-note">🔒 ${tr('Yalnızca bu formdaki alanlar ve uygulama sürümü gönderilir. API key\'in ve başka verin gönderilmez.', 'Only the fields in this form and the app version are sent. Your API key and other data are never sent.')}</small>
        <div class="fb-actions">
          <span class="muted mono" id="fb-count">${draft.message.length}/${MAX}</span>
          <button type="button" class="btn ghost" data-fb-close>${tr('Vazgeç', 'Cancel')}</button>
          <button type="submit" class="btn primary" id="fb-send" ${busy ? 'disabled' : ''}>${busy ? tr('Gönderiliyor…', 'Sending…') : tr('Gönder', 'Send')}</button>
        </div>
      </form></div>`;
  }

  function open() {
    const m = modal(); if (!m) return;
    render();
    m.hidden = false;
    setTimeout(() => $('#fb-msg')?.focus(), 30);
  }
  function close() { const m = modal(); if (m) m.hidden = true; }

  async function send() {
    if (busy) return;
    if (draft.message.trim().length < 5) { toast(tr('Biraz daha ayrıntı yaz.', 'Please add a bit more detail.')); $('#fb-msg')?.focus(); return; }
    busy = true; render();
    try {
      await api('/api/feedback', { method: 'POST', body: JSON.stringify({ ...draft, lang: state.lang }) });
      toast(tr('Teşekkürler! Mesajın iletildi.', 'Thanks! Your message was sent.'));
      draft = { kind: draft.kind, message: '', name: draft.name, contact: draft.contact };
      saveDraft();
      busy = false;
      close();
    } catch (e) {
      busy = false; render();
      toast(tr('Gönderilemedi: ', 'Could not send: ') + e.message);
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('#feedback-btn')) { open(); return; }
    const m = modal(); if (!m || m.hidden) return;
    if (e.target === m || e.target.closest('[data-fb-close]')) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal() && !modal().hidden) close(); });
  document.addEventListener('input', (e) => {
    if (!e.target.closest?.('#fb-form')) return;
    const id = e.target.id;
    if (id === 'fb-msg') { draft.message = e.target.value; const c = $('#fb-count'); if (c) c.textContent = `${draft.message.length}/${MAX}`; }
    else if (id === 'fb-name') draft.name = e.target.value;
    else if (id === 'fb-contact') draft.contact = e.target.value;
    saveDraft();
  });
  document.addEventListener('change', (e) => {
    if (e.target.name !== 'fb-kind') return;
    draft.kind = e.target.value; saveDraft();
    for (const l of document.querySelectorAll('.fb-kind')) l.classList.toggle('on', l.querySelector('input').checked);
  });
  document.addEventListener('submit', (e) => { if (e.target.id === 'fb-form') { e.preventDefault(); send(); } });

  // Ayarlar → Genel'den kapatılabilir; dil değişince buton yazısı güncellensin
  const sync = () => {
    const b = $('#feedback-btn'); if (!b) return;
    b.hidden = !feat('app.feedback');
    const l = $('#feedback-label'); if (l) l.textContent = tr('Geri bildirim', 'Feedback');
    b.title = tr('İstek, öneri ya da hata gönder', 'Send a request, suggestion or bug report');
    if (b.hidden) close();
  };
  FEATURE_HOOKS.push(sync);
  const prevLang = window.onLangChanged;
  window.onLangChanged = () => { prevLang?.(); sync(); if (modal() && !modal().hidden) render(); };
  sync();
})();
