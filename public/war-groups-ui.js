(() => {
  let faction = null, data = { groups: [], assignments: {} }, filter = '*';
  let loading = false, busy = false, selected = new Set(), visible = [], error = '';
  const host = $('#war-groups');
  const current = () => faction === state.factionId;
  const options = (value, includeAll = false) =>
    (includeAll ? `<option value="*" ${value === '*' ? 'selected' : ''}>${tr('Tüm gruplar', 'All groups')}</option>` : '') +
    `<option value="" ${value === '' ? 'selected' : ''}>${tr('Grupsuz', 'Ungrouped')}</option>` +
    data.groups.map((g) => `<option value="${g.id}" ${value === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
  function render() {
    if (!state.factionId) { host.innerHTML = ''; return; }
    if (!current() || loading) { host.textContent = tr('Hedef grupları yükleniyor…', 'Loading target groups…'); return; }
    if (error) {
      host.innerHTML = `<div class="alert warn">${esc(error)} <button type="button" class="btn sm" data-group-retry>${tr('Tekrar dene', 'Retry')}</button></div>`;
      return;
    }
    const draft = $('#group-name')?.value || '';
    const wasEditing = document.activeElement?.id === 'group-name';
    const editable = data.groups.some((g) => g.id === filter);
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
        <select class="input" id="group-bulk-destination" aria-label="${tr('Hedef grup', 'Destination group')}" ${disabled}>${options('')}</select>
        <button class="btn sm" type="button" data-group-assign ${!selected.size || busy ? 'disabled' : ''}>${tr('Seçilenleri taşı', 'Move selected')}</button>
      </div>`;
    $('#group-name').value = draft;
    if (wasEditing) $('#group-name').focus();
    const all = $('#group-select-all');
    if (all) all.indeterminate = selected.size > 0 && !visible.every((id) => selected.has(id));
  }
  window.loadWarGroups = async (force = false) => {
    const fid = state.factionId;
    if (!fid || (faction === fid && !force)) return;
    faction = fid; filter = '*'; selected.clear(); data = { groups: [], assignments: {} };
    loading = true; error = ''; render();
    try {
      const result = await api('/api/war-groups?faction=' + fid);
      if (faction !== fid) return;
      data = result;
    } catch (e) { if (faction === fid) error = e.message; }
    finally { if (faction === fid) { loading = false; render(); if (state.targets?.faction.id == fid) renderTargets(); } }
  };
  async function mutate(body) {
    if (busy || !current()) return;
    const fid = faction;
    busy = true; render();
    try {
      const result = await api('/api/war-groups?faction=' + fid, { method: 'POST', body: JSON.stringify(body) });
      if (faction !== fid) return;
      data = result;
      if (filter && filter !== '*' && !data.groups.some((g) => g.id === filter)) filter = '*';
      selected.clear();
      toast(tr('Hedef grupları kaydedildi', 'Target groups saved'));
    } catch (e) { toast(e.message); }
    finally { busy = false; render(); if (current() && state.targets?.faction.id == faction) renderTargets(); }
  }
  window.filterWarTargets = (rows) => !current() || filter === '*' ? rows : rows.filter((m) => (data.assignments[m.id] || '') === filter);
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
    if (e.target.closest('[data-group-assign]')) mutate({ action: 'assign', groupId: $('#group-bulk-destination').value, playerIds: [...selected] });
  });
  host.addEventListener('change', (e) => {
    if (e.target.id === 'group-filter') { filter = e.target.value; selected.clear(); renderTargets(); }
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
})();
