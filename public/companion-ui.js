(() => {
  const math = window.LRXCompanionMath;
  const slots = {
    market: '#companion-market', trade: '#companion-trade', balance: '#companion-balance',
    gyms: '#companion-gyms', inventory: '#companion-inventory', chat: '#companion-chat',
    equipment: '#companion-equipment',
  };
  const flag = (section) => feat('companion.' + section);
  const heading = (title) => '<div class="card-head"><h3>' + esc(title) + '</h3></div>';
  const input = (name, label, initial = '', mode = 'decimal') =>
    '<label class="tl-field"><span>' + esc(label) + '</span><input class="input" name="' + name +
    '" value="' + esc(initial) + '" inputmode="' + mode + '" autocomplete="off" maxlength="64"></label>';
  const button = (action, label) => '<button class="btn sm" type="button" data-companion="' + action + '">' + esc(label) + '</button>';
  const link = (path, label) => '<button class="btn sm ghost" type="button" data-open-url="https://www.torn.com/' +
    path + '">' + esc(label) + ' ↗</button>';
  const fields = (html) => '<div class="tl-row companion-fields">' + html + '</div>';
  const note = (html) => '<p class="muted">' + html + '</p>';
  const status = () => '<div class="companion-result" data-companion-status role="status" aria-live="polite"></div>';
  const select = (name, label, options) => '<label class="tl-field"><span>' + esc(label) +
    '</span><select class="input" name="' + name + '">' + options.map(([value, caption]) =>
      '<option value="' + value + '">' + esc(caption) + '</option>').join('') + '</select></label>';
  const table = (labels, rows) => rows.length
    ? '<div class="tbl-wrap"><table class="tbl compact"><thead><tr>' + labels.map((x) => '<th scope="col">' + esc(x) + '</th>').join('') +
      '</tr></thead><tbody>' + rows.map((row) => '<tr>' + row.map((x) => '<td>' + esc(x ?? '—') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'
    : note(tr('Kayıt bulunamadı.', 'No records found.'));
  const seen = (d) => note(tr('Torn API · Veri zamanı ', 'Torn API · Data time ') +
    esc(new Date(d.observedAt).toLocaleString(timeLocale())));
  const cash = (n) => n == null ? '—' : money(n);
  const counter = (n) => n == null ? '—' : n0(n);
  const own = () => Number(state.overview?.player?.id) || null;

  const panels = {
    market: () => heading(tr('Pazar ve bazaar karşılaştırması', 'Market and bazaar comparison')) +
      fields(input('item', tr('Eşya ID', 'Item ID'), '', 'numeric') + button('market', tr('Item Market tekliflerini getir', 'Load Item Market offers')) +
        link('page.php?sid=ItemMarket', 'Item Market')) +
      note(tr('Liste, ilk API sayfasındaki teklifleri gösterir. Eşya varyantlarını ve ücretleri kontrol et.',
        'Listings come from the first API page. Check item variants and fees.')) +
      fields(input('cost', tr('Alış veya bazaar fiyatı', 'Buy or bazaar price')) + input('price', tr('Satış fiyatı', 'Sale price')) +
        input('fee', tr('Senaryo kesintisi %', 'Scenario fee %'), '0') + button('sale', tr('Net tutarı hesapla', 'Calculate net proceeds'))) + status(),
    trade: () => heading(tr('Ticaret', 'Trades')) + fields(
      button('ongoing', tr('Açık işlemler', 'Open trades')) + button('finished', tr('Tamamlanan işlemler', 'Completed trades')) +
      input('tradeId', tr('İşlem ID', 'Trade ID'), '', 'numeric') + button('trade', tr('İşlemi oku', 'Read trade')) +
      button('receipt', tr('Özeti kopyala', 'Copy receipt')) + link('trade.php', tr('Torn ticaret sayfası', 'Torn trade page'))) +
      note(tr('Para planı için güncel cüzdanı ve kendi teklifini gir. Yüzde, mevcut teklif üzerinden hesaplanır.',
        'Enter your current wallet and your own offer. Percentages use the current offer as the base.')) +
      fields(input('wallet', tr('Cüzdan', 'Wallet')) + input('current', tr('Mevcut teklif', 'Current offer')) +
        input('reserve', tr('Cüzdanda kalacak minimum', 'Wallet reserve'), '0') + input('amount', tr('Tutar veya yüzde', 'Amount or percent')) +
        select('mode', tr('Birim', 'Unit'), [['money', '$'], ['percent', '%']]) +
        select('direction', tr('İşlem', 'Operation'), [['add', tr('Ekle', 'Add')], ['withdraw', tr('Çıkar', 'Withdraw')]]) +
        button('plan', tr('Önizle', 'Preview'))) + status(),
    balance: () => heading(tr('Kişisel faction bakiyesi', 'Personal faction balance')) +
      fields(button('balance', tr('Bakiyemi göster', 'Show my balance'))) + status(),
    gyms: () => heading(tr('Kullanılabilir gym karşılaştırması', 'Available gym comparison')) +
      fields(button('gyms', tr('Gym katsayılarını göster', 'Compare gym modifiers')) + link('gym.php', tr('Torn Gym', 'Torn Gym'))) +
      note(tr('Karşılaştırma gym katsayısını kullanır. Kişisel antrenman kazanımı değişebilir.',
        'The comparison uses each gym’s modifier. Personal training gains can vary.')) + status(),
    inventory: () => heading(tr('Envanter', 'Inventory')) + fields(
      select('inventoryCategory', tr('Kategori', 'Category'), Object.entries(window.LRXCompanionInventory)
        .map(([value, label]) => [value, tr(label, value)])) + button('inventory', tr('Envanteri getir', 'Load inventory')) +
      button('inventory-prev', tr('Önceki sayfa', 'Previous page')) + button('inventory-next', tr('Sonraki sayfa', 'Next page')) +
      link('item.php', tr('Torn envanteri', 'Torn inventory'))) + status(),
    chat: () => heading(tr('Sohbet taslağı', 'Chat draft')) + fields(
      '<label class="tl-field"><span>' + tr('Mesaj', 'Message') +
      '</span><textarea class="input" name="chatText" maxlength="500" rows="3"></textarea></label>' +
      button('chat', tr('Metni kopyala', 'Copy message'))) + status(),
    equipment: () => heading(tr('Ekipman ve kasa', 'Equipment and vault')) + fields(
      button('equipment', tr('Takılı ekipmanı göster', 'Show equipped items')) + button('vault', tr('Kasa ve cüzdanı göster', 'Show vault and wallet')) +
      link('properties.php', tr('Torn mülkleri', 'Torn properties'))) + status(),
  };

  let lastTrade = null, copiedReceipt = '', inventoryPage = null, generation = 0, renderedOwner = own();
  function render() {
    for (const [section, selector] of Object.entries(slots)) {
      const panel = $(selector);
      if (!panel) continue;
      panel.hidden = !flag(section);
      if (panel.hidden || panel.dataset.lang === state.lang) continue;
      if (section === 'inventory') inventoryPage = null;
      delete panel.dataset.busy;
      const values = Object.fromEntries([...panel.querySelectorAll('[name]')].map((x) => [x.name, x.value]));
      panel.innerHTML = panels[section]();
      for (const [name, value] of Object.entries(values)) {
        const field = panel.querySelector('[name="' + name + '"]');
        if (field) field.value = value;
      }
      panel.dataset.lang = state.lang;
    }
    renderDirector();
  }

  function renderDirector() {
    const panel = $('#companion-director'), c = state.company;
    if (!panel) return;
    panel.hidden = !flag('director') || !c?.hasDirectorAccess || viewHidden('report');
    if (panel.hidden) return;
    const context = [c.company.id, c.company.type, c.company.rating, state.lang].join(':');
    const key = [context, c.fetchedAt].join(':');
    if (panel.dataset.stamp === key) return;
    const oldStatus = panel.dataset.context === context && panel.querySelector('[data-companion-status]');
    const d = math.directorSummary(c);
    const warning = [
      d.environmentBelowGoal && tr('Ortam %100 altında', 'Environment below 100%'),
      d.efficiencyBelowGoal && tr('Verim %90 altında', 'Efficiency below 90%'),
    ].filter(Boolean).join(' · ');
    const trained = c.employees.filter((x) => x.lastTrainedAt).sort((a, b) => b.lastTrainedAt - a.lastTrainedAt);
    panel.innerHTML = heading(tr('Direktör özeti', 'Director summary')) +
      note(esc(tr('1,5 günün altında stok ', 'Under 1.5 days of stock ') + d.lowStock)) +
      note(esc(tr('Son iki gelir kaydı arasındaki fark ', 'Revenue change across the last two records ') + cash(d.dailyChange))) +
      (warning ? note(esc(warning)) : '') +
      note(tr('Şirket haberlerindeki son train kayıtları', 'Latest training entries in company news')) +
      table([tr('Çalışan', 'Employee'), tr('Son kayıt', 'Last recorded training')], trained.map((x) => [x.name, new Date(x.lastTrainedAt * 1000).toLocaleString(timeLocale())])) +
      fields(button('company', tr('Benzer şirketleri getir', 'Load comparable companies'))) + status();
    if (oldStatus) panel.querySelector('[data-companion-status]').replaceWith(oldStatus);
    else delete panel.dataset.busy;
    panel.dataset.stamp = key;
    panel.dataset.context = context;
  }

  const read = (name, params = {}) => api('/api/companion/' + name + (Object.keys(params).length ? '?' + new URLSearchParams(params) : ''));
  const tradesTable = (d) => seen(d) + table(['ID', tr('Karşı taraf', 'Counterparty'), tr('Açıklama', 'Description')], d.rows.map((x) =>
    [x.id, x.user.id === own() ? x.trader.name : x.trader.id === own() ? x.user.name : [x.user.name, x.trader.name].filter(Boolean).join(' / '), x.description])) +
    (d.hasMore ? note(tr('İlk 20 kayıt gösteriliyor.', 'Showing the first 20 records.')) : '');

  function receipt(d) {
    const stamp = JSON.stringify([d.id, d.modifiedAt, d.completedAt, d.rows.map((x) => JSON.stringify(x)).sort()]);
    const changed = lastTrade?.id === d.id && lastTrade.stamp !== stamp;
    lastTrade = { id: d.id, stamp };
    const rows = d.rows.map((x) => [x.userId, x.type, x.name || x.id || '—', x.type === 'Money' ? cash(x.amount) : x.amount ?? x.days ?? '—']);
    copiedReceipt = ['Trade #' + d.id + ' · ' + new Date(d.observedAt).toISOString(),
      d.user.name + ' [' + d.user.id + '] / ' + d.trader.name + ' [' + d.trader.id + ']', ...rows.map((r) => r.join(' · '))].join('\n');
    return seen(d) + note(esc('#' + d.id + ' · ' + d.description)) +
      (changed ? '<p class="alert warn">' + tr('İşlem son okunan veriden beri değişti.', 'This trade has changed since the last read.') + '</p>' : '') +
      table([tr('Oyuncu ID', 'Player ID'), tr('Tür', 'Type'), tr('Ad / ID', 'Name / ID'), tr('Miktar', 'Amount')], rows);
  }

  async function action(name, values, current) {
    switch (name) {
      case 'company': {
        const c = state.company.company, d = await read('company', { type: c.type, rating: c.rating });
        const peers = d.rows.slice().sort((a, b) => b.weekly - a.weekly || a.id - b.id);
        const ranked = peers.map((x) => ({ ...x, place: 1 + peers.findIndex((p) => p.weekly === x.weekly) }));
        return seen(d) + note(d.hasMore
          ? tr('Aynı tür ve yıldız seviyesindeki ilk 100 sonuç. Sıra bu sonuçların içindedir.', 'First 100 results of the same type and rating. Rank is within these results.')
          : tr('Aynı tür ve yıldız seviyesinde haftalık gelire göre sıra.', 'Weekly income rank within the same company type and star rating.')) +
          table([tr('Sıra', 'Rank'), tr('Şirket', 'Company'), tr('Haftalık gelir', 'Weekly income')],
            ranked.map((x) => [x.place, x.name + (x.id === c.id ? tr(' · Senin şirketin', ' · Your company') : ''), cash(x.weekly)]));
      }
      case 'market': {
        const d = await read('market', { item: values.item.trim() });
        return seen(d) + note(esc(d.name + ' · ' + tr('Ortalama fiyat ', 'Average price ') + cash(d.reference))) +
          table([tr('Teklif', 'Offer'), tr('Adet', 'Quantity'), tr('Varyant', 'Variant')], d.rows.map((x) =>
            [cash(x.price), counter(x.quantity), x.variant ? tr('Var', 'Yes') : '—']));
      }
      case 'sale': {
        const d = math.salePlan(values);
        return note(d ? esc(tr('Net ', 'Net ') + cash(d.net) + ' · ' + tr('Kâr ', 'Profit ') + cash(d.profit)) :
          tr('Alış, satış ve %0–100 arası kesinti gir.', 'Enter buy and sale prices and a fee from 0–100%.'));
      }
      case 'ongoing': case 'finished': return tradesTable(await read('trades', { category: name }));
      case 'trade': {
        const detail = await read('trade', { id: values.tradeId.trim() });
        return current() ? receipt(detail) : null;
      }
      case 'receipt':
        if (!copiedReceipt || lastTrade?.id !== Number(values.tradeId)) return note(tr('Önce bu işlemi oku.', 'Read this trade first.'));
        await copyText(copiedReceipt);
        return null;
      case 'plan': {
        const d = math.tradePlan(values);
        if (d.error === 'funds' || d.error === 'withdraw') return note(tr('Eksik tutar $', 'Shortfall $') +
          BigInt(d.shortfall).toLocaleString(timeLocale()));
        if (d.error === 'percentage') return note(tr('Yüzde için mevcut teklif sıfırdan büyük olmalı. Üst sınır eklemede %999, çıkarmada %100.',
          'Percentages require a positive current offer. The limit is 999% for additions and 100% for withdrawals.'));
        if (d.error) return note(tr('Tutarı ve başlangıç bakiyelerini kontrol et.', 'Check the amount and starting balances.'));
        return note(esc(tr('Değişim ', 'Change ') + cash(d.delta) + ' · ' + tr('Yeni teklif ', 'New offer ') + cash(d.offer) +
          ' · ' + tr('Kalan cüzdan ', 'Remaining wallet ') + cash(d.wallet)));
      }
      case 'balance': case 'vault': {
        const d = await read('money');
        if (name === 'vault') return seen(d) + note(esc(tr('Kasa ', 'Vault ') + cash(d.vault) + ' · ' + tr('Cüzdan ', 'Wallet ') + cash(d.wallet)));
        return seen(d) + note(d.faction ? esc(cash(d.faction.money) + ' · ' + counter(d.faction.points) + tr(' puan', ' points')) :
          tr('Kişisel faction bakiyesi görünmüyor.', 'Personal faction balance unavailable.'));
      }
      case 'gyms': {
        const d = await read('gyms');
        return seen(d) + note(esc(tr('Etkin gym ', 'Active gym ') + d.active)) +
          table([tr('Stat', 'Stat'), 'Gym', tr('Katsayı', 'Modifier')], Object.entries(d.best).map(([stat, x]) =>
            [stat, x?.names.join(', '), x?.modifier]));
      }
      case 'inventory': case 'inventory-next': case 'inventory-prev': {
        const category = values.inventoryCategory;
        let offset = 0;
        if (name !== 'inventory') {
          if (inventoryPage?.category !== category) return null;
          const forward = name === 'inventory-next';
          if (forward ? !inventoryPage.hasMore : inventoryPage.offset === 0) return null;
          offset = inventoryPage.offset + (forward ? inventoryPage.limit : -inventoryPage.limit);
        }
        const d = await read('inventory', { category, offset });
        if (!current()) return null;
        inventoryPage = { category: d.category, offset: d.offset, limit: d.limit, hasMore: d.hasMore };
        return seen(d) + note(tr('Sayfa ', 'Page ') + (1 + d.offset / d.limit)) +
          table(['ID', tr('Eşya', 'Item'), tr('Adet', 'Quantity'), tr('Durum', 'Status')], d.rows.map((x) =>
            [x.id, x.name, counter(x.amount), [x.equipped && tr('Takılı', 'Equipped'), x.factionOwned && tr('Faction eşyası', 'Faction-owned')].filter(Boolean).join(' · ') || '—']));
      }
      case 'chat':
        if (!values.chatText.trim()) return note(tr('Kopyalamak için mesaj gir.', 'Enter a message to copy.'));
        await copyText(values.chatText);
        return '';
      case 'equipment': {
        const d = await read('equipment');
        return seen(d) + table([tr('Yuva', 'Slot'), tr('Eşya', 'Item'), tr('Nadirlik', 'Rarity'), tr('Bonuslar', 'Bonuses')],
          d.rows.map((x) => [x.slot, x.name, x.rarity || '—', x.bonuses.map((b) => [b.title, b.value].filter((y) => y != null).join(' ')).join(', ') || '—']));
      }
      default: return null;
    }
  }

  const inventoryPanel = $(slots.inventory);
  inventoryPanel?.addEventListener('change', (e) => {
    if (e.target.name !== 'inventoryCategory') return;
    inventoryPage = null;
    inventoryPanel.querySelector('[data-companion-status]').replaceChildren();
  });

  for (const selector of ['#companion-director', ...Object.values(slots)]) {
    const panel = $(selector);
    panel?.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-companion]');
      if (!b || panel.dataset.busy || panel.hidden) return;
      const output = panel.querySelector('[data-companion-status]');
      const values = Object.fromEntries([...panel.querySelectorAll('[name]')].map((x) => [x.name, x.value]));
      const turn = String(++generation), player = own();
      panel.dataset.busy = turn;
      const current = () => panel.dataset.busy === turn && own() === player && !panel.hidden;
      b.disabled = true;
      const inventoryCategory = panel.querySelector('[name="inventoryCategory"]');
      if (inventoryCategory) inventoryCategory.disabled = true;
      output.setAttribute('aria-busy', 'true');
      try {
        const html = await action(b.dataset.companion, values, current);
        if (html !== null && current()) output.innerHTML = html;
      } catch (err) {
        if (current()) output.innerHTML = note(esc(err.message));
      } finally {
        if (panel.dataset.busy === turn) {
          delete panel.dataset.busy;
          b.disabled = false;
          if (inventoryCategory) inventoryCategory.disabled = false;
          output.removeAttribute('aria-busy');
        }
      }
    });
  }

  function reset() {
    lastTrade = null; copiedReceipt = ''; inventoryPage = null;
    for (const selector of ['#companion-director', ...Object.values(slots)]) {
      const panel = $(selector);
      if (!panel) continue;
      delete panel.dataset.busy;
      for (const output of panel.querySelectorAll('[data-companion-status]')) { output.replaceChildren(); output.removeAttribute('aria-busy'); }
      for (const button of panel.querySelectorAll('[data-companion]')) button.disabled = false;
      for (const field of panel.querySelectorAll('input, textarea, select')) {
        if (field.tagName === 'SELECT') {
          field.selectedIndex = 0;
          if (field.name === 'inventoryCategory') field.disabled = false;
        }
        else field.value = field.defaultValue;
      }
    }
  }
  FEATURE_HOOKS.push(render);
  const langChanged = window.onLangChanged;
  window.onLangChanged = () => { langChanged?.(); render(); };
  const overviewRendered = window.onOverviewRendered;
  window.onOverviewRendered = () => {
    overviewRendered?.();
    if (own() !== renderedOwner) { renderedOwner = own(); reset(); }
  };
  window.addEventListener('lrx-premium-reset', reset);
  window.LRXCompanion = { renderDirector, render };
  render();
})();
