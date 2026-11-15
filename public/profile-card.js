/* The player's Torn profile card, shared by the Overview widget and the Premium page. It is built only from the
   overview the app already fetches (no extra Torn request). Torn text goes through esc(); only https photos are used. */
(() => {
  function httpsUrl(value) { try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; } }
  function html(p) {
    if (!p) return '';
    const id = Number(p.id), name = decode(p.name || String(id)), photo = httpsUrl(p.image);
    const si = typeof statusInfo === 'function' ? statusInfo(p.status) : { cls: 'dim', text: '', color: 'var(--muted)' };
    const fac = p.faction || {}, tag = fac.faction_tag && fac.faction_tag !== 'None' ? fac.faction_tag : '';
    return `<article class="pm-profile${photo ? '' : ' is-missing'}" data-open-url="https://www.torn.com/profiles.php?XID=${id}" data-tab-label="${esc(name)} [${id}]" title="${esc(tr('Profili sekmede aç', 'Open profile in a tab'))}">`
      + `<div class="pm-profile-top"><i class="pm-profile-dot" style="background:${si.color}"></i><strong>${esc(name)}</strong><span>[${id}]</span></div>`
      + `<div class="pm-profile-frame">${photo ? `<img class="pm-profile-photo" src="${esc(photo)}" alt="${esc(name)}" referrerpolicy="no-referrer" decoding="async">` : ''}<span class="pm-profile-initial" aria-hidden="true">${esc(name.trim().charAt(0).toUpperCase() || '?')}</span></div>`
      + `<div class="pm-profile-meta"><span>Lv ${Number(p.level) || '—'}</span><span class="chip ${si.cls}">${esc(p.status?.description || si.text)}</span>${tag ? `<span class="pm-profile-tag" title="${esc(fac.faction_name || tag)}">${esc(tag)}</span>` : ''}</div>`
      + details(p) + '</article>';
  }
  // Profile lines under the photo. Only the Overview's medium card shows them (overview.css), where they fill the room
  // the photo leaves; lines Torn did not send are left out.
  function details(p) {
    const n = (v) => Number(v) || 0, text = (v) => (v && v !== 'None' ? decode(String(v)) : '');
    const fac = p.faction || {}, wed = p.married || {};
    const rows = [
      [tr('Rütbe', 'Rank'), text(p.rank)],
      [tr('İş', 'Job'), p.job && typeof jobLabel === 'function' ? jobLabel(p.job) : ''],
      ['Faction', n(fac.faction_id) > 0 ? [text(fac.faction_name), text(fac.position)].filter(Boolean).join(' · ') : ''],
      [tr('Eş', 'Spouse'), n(wed.spouse_id) > 0 ? text(wed.spouse_name) : ''],
      [tr('Mülk', 'Property'), text(p.property)],
      [tr('Yaş', 'Age'), n(p.age) > 0 ? `${n(p.age).toLocaleString('en-US')} ${tr('gün', 'days')}` : ''],
      [tr('Ödül', 'Awards'), n(p.awards) > 0 ? n(p.awards).toLocaleString('en-US') : ''],
    ].filter(([, value]) => value);
    return rows.length ? `<dl class="pm-profile-more">${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd title="${esc(value)}">${esc(value)}</dd></div>`).join('')}</dl>` : '';
  }
  // Writes the card into `slot` unless it already shows exactly this markup, so a refresh never reloads the photo.
  // A photo that fails to load leaves the initial in its place. Returns whether the slot was painted.
  function paint(slot, markup) {
    if (!slot || (slot.dataset.painted === '1' && slot.lastHtml === markup)) return false;
    slot.dataset.painted = '1'; slot.lastHtml = markup;
    slot.innerHTML = markup;
    const img = slot.querySelector('img.pm-profile-photo');
    if (img) {
      const missing = () => img.closest('.pm-profile')?.classList.add('is-missing');
      if (img.complete && !img.naturalWidth) missing(); else img.addEventListener('error', missing, { once: true });
    }
    return true;
  }
  window.LRXProfileCard = Object.freeze({ html, paint });
})();
