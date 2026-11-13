(() => {
  let faction = null, data = { groups: [], assignments: {} }, filter = '*';
  let loading = false, busy = false, selected = new Set(), visible = [], error = '';
  let destination = ''; // group chosen for "Move selected"; '' = ungrouped
  const host = $('#war-groups');
  const enabled = () => feat('war.groups'); // Settings → Pages → War Targets → Target groups
  const current = () => enabled() && faction === state.factionId;
  const errorText = (e) => ({
    GROUP_FACTION_INVALID: tr('Geçersiz faction ID.', 'Invalid faction ID.'),
    GROUP_NAME_LENGTH: tr('Grup adı 1–40 karakter olmalı.', 'Group name must be 1–40 characters.'),
    GROUP_NAME_TAKEN: tr('Bu adda bir grup zaten var.', 'A group with this name already exists.'),
    GROUP_LIMIT: tr('Bir faction için en fazla 24 grup oluşturulabilir.', 'Maximum 24 groups per faction.'),
    GROUP_NOT_FOUND: tr('Grup bulunamadı.', 'Group not found.'),
    GROUP_PLAYER_COUNT: tr('1 ile 1000 arasında oyuncu seç.', 'Choose 1–1000 players.'),
    GROUP_PLAYER_INVALID: tr('Geçersiz oyuncu ID.', 'Invalid player ID.'),
    GROUP_ACTION_UNKNOWN: tr('Bilinmeyen grup işlemi.', 'Unknown group action.'),
  })[e?.code] || e?.message || tr('Hedef grupları kaydedilemedi.', 'Could not save target groups.');
  const lockRows = (on) => document.querySelectorAll('#war-table [data-group-target],#war-table [data-group-player]').forEach((el) => { el.disabled = on; });
  const options = (value, includeAll = false) =>
    (includeAll ? `<option value="*" ${value === '*' ? 'selected' : ''}>${tr('Tüm gruplar', 'All groups')}</option>` : '') +
    `<option value="" ${value === '' ? 'selected' : ''}>${tr('Grupsuz', 'Ungrouped')}</option>` +
    data.groups.map((g) => `<option value="${esc(g.id)}" ${value === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
  function render() {
    host.hidden = !enabled();
    if (!state.factionId || !enabled()) { host.innerHTML = ''; return; }
    if (!current() || loading) { host.textContent = tr('Hedef grupları yükleniyor…', 'Loading target groups…'); return; }
    if (error) {
      host.innerHTML = `<div class="alert warn">${esc(errorText(error))} <button type="button" class="btn sm" data-group-retry>${tr('Tekrar dene', 'Retry')}</button></div>`;
      return;
    }
    const draft = $('#group-name')?.value || '';
    const wasEditing = document.activeElement?.id === 'group-name';
    const editable = data.groups.some((g) => g.id === filter);
    if (destination && !data.groups.some((g) => g.id === destination)) destination = '';
    const disabled = busy ? 'disabled' : '';
    host.innerHTML = `<div class="group-controls"><strong>${tr('Hedef grupları', 'Target groups')}</strong>
      <select class="input" id="group-filter" aria-label="${tr('Grup filtresi', 'Group filter')}" ${disabled}>${options(filter, true)}</select>
      <span class="muted">${tr('Bu faction için bu bilgisayarda saklanır', 'Saved on this computer for this faction')}</span></div>
      <form class="group-create" id="group-form">
        <input class="input" id="group-name" maxlength="40" required placeholder="${tr('Grup adı (ör. Öncelikli)', 'Group name (e.g. Priority)')}" aria-label="${tr('Grup adı', 'Group name')}" ${disabled}>
        <button class="btn sm" type="submit" ${disabled}>${tr('Grup ekle', 'Add group')}</button>
        <button class="btn sm ghost" type="button" data-group-rename ${!editable || busy ? 'disabled' : ''}>${tr('Seçili grubu yeniden adlandır', 'Rename selected group')}</button>
        <button class="btn sm ghost danger" type="button" data-group-remove ${!editable || busy ? 'disabled' : ''}>${tr('Seçili grubu sil', 'Delete selected group')}</button>
      </form>
      <div class="group-bulk"><label class="check"><input type="checkbox" id="group-select-all" ${visible.length && visible.every((id) => selected.has(id)) ? 'checked' : ''} ${disabled}>${tr('Görünenleri seç', 'Select visible')}</label>
        <span id="group-selection-count">${selected.size} ${tr('seçili', 'selected')}</span>
        <select class="input" id="group-bulk-destination" aria-label="${tr('Hedef grup', 'Destination group')}" ${disabled}>${options(destination)}</select>
        <button class="btn sm" type="button" data-group-assign ${!selected.size || busy ? 'disabled' : ''}>${tr('Seçilenleri taşı', 'Move selected')}</button>
      </div>`;
    $('#group-name').value = draft;
    if (wasEditing) $('#group-name').focus();
    const all = $('#group-select-all');
    if (all) all.indeterminate = selected.size > 0 && !visible.every((id) => selected.has(id));
  }
  window.loadWarGroups = async (force = false) => {
    const fid = state.factionId;
    if (!enabled() || !fid || (faction === fid && !force)) return;
    faction = fid; filter = '*'; destination = ''; selected.clear(); data = { groups: [], assignments: {} };
    loading = true; error = null; render();
    try {
      const result = await api('/api/war-groups?faction=' + fid);
      if (faction !== fid) return;
      data = result;
    } catch (e) { if (faction === fid) error = e; }
    finally { if (faction === fid) { loading = false; render(); if (state.targets?.faction.id == fid) renderTargets(); } }
  };
  async function mutate(body) {
    if (busy || !current()) return;
    const fid = faction;
    // Row selects stay disabled while saving, so a change can't be silently dropped
    busy = true; render(); lockRows(true);
    try {
      const result = await api('/api/war-groups?faction=' + fid, { method: 'POST', body: JSON.stringify(body) });
      if (faction !== fid) return;
      data = result;
      if (filter && filter !== '*' && !data.groups.some((g) => g.id === filter)) filter = '*';
      selected.clear();
      toast(tr('Hedef grupları kaydedildi', 'Target groups saved'));
    } catch (e) { toast(errorText(e)); }
    finally { busy = false; lockRows(false); render(); if (current() && state.targets?.faction.id == faction) renderTargets(); }
  }
  window.filterWarTargets = (rows) => !current() || filter === '*' ? rows : rows.filter((m) => (data.assignments[m.id] || '') === filter);
  window.warGroupName = (id) => current() ? data.groups.find((g) => g.id === data.assignments[id])?.name || '' : '';
  window.decorateWarGroups = (rows) => {
    if (!current() || loading || error || state.targets?.faction.id != faction) return;
    visible = rows.map((m) => m.id);
    selected = new Set([...selected].filter((id) => visible.includes(id)));
    const table = $('#war-table');
    table.querySelector('thead tr')?.insertAdjacentHTML('afterbegin', `<th>${tr('Grup', 'Group')}</th>`);
    if (!rows.length) { const empty = table.querySelector('td[colspan]'); if (empty) empty.colSpan = 12; }
    else table.querySelectorAll('tbody tr').forEach((row, i) => {
      const id = rows[i].id;
      row.insertAdjacentHTML('afterbegin', `<td><div class="group-controls"><input class="group-check" type="checkbox" data-group-player="${id}" aria-label="${esc(rows[i].name)}" ${selected.has(id) ? 'checked' : ''} ${busy ? 'disabled' : ''}>
        <select class="input war-group-select" data-group-target="${id}" aria-label="${esc(rows[i].name)} ${tr('grubu', 'group')}" ${busy ? 'disabled' : ''}>${options(data.assignments[id] || '')}</select></div></td>`);
    });
    render();
  };
  host.addEventListener('submit', (e) => {
    if (e.target.id !== 'group-form') return;
    e.preventDefault(); mutate({ action: 'create', name: $('#group-name').value });
  });
  host.addEventListener('click', (e) => {
    if (e.target.closest('[data-group-retry]')) window.loadWarGroups(true);
    if (e.target.closest('[data-group-rename]')) {
      if (!$('#group-name').reportValidity()) return;
      mutate({ action: 'rename', groupId: filter, name: $('#group-name').value });
    }
    if (e.target.closest('[data-group-remove]')) mutate({ action: 'remove', groupId: filter });
    if (e.target.closest('[data-group-assign]')) mutate({ action: 'assign', groupId: destination, playerIds: [...selected] });
  });
  host.addEventListener('change', (e) => {
    if (e.target.id === 'group-filter') { filter = e.target.value; selected.clear(); renderTargets(); }
    if (e.target.id === 'group-bulk-destination') destination = e.target.value;
    if (e.target.id === 'group-select-all') { selected = e.target.checked ? new Set(visible) : new Set(); renderTargets(); }
  });
  $('#war-table').addEventListener('change', (e) => {
    if (e.target.matches('[data-group-player]')) {
      const id = Number(e.target.dataset.groupPlayer);
      if (e.target.checked) selected.add(id); else selected.delete(id);
      render();
    }
    if (e.target.matches('[data-group-target]')) mutate({ action: 'assign', groupId: e.target.value, playerIds: [Number(e.target.dataset.groupTarget)] });
  });
  const oldLang = window.onLangChanged;
  window.onLangChanged = () => { oldLang?.(); render(); };
  // Settings toggle: show / hide the group bar and the table's Group column right away
  let shown = null;
  FEATURE_HOOKS.push(() => {
    const on = enabled();
    if (on === shown) return;
    const first = shown === null; shown = on;
    if (first) { host.hidden = !on; return; }
    if (on) window.loadWarGroups();
    render();
    if (state.targets) renderTargets();
  });
})();
