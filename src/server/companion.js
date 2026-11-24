const inventoryCategories = require('../../public/companion-inventory');

const PAGE = 20;
const minute = 60_000;
const stats = ['strength', 'defense', 'speed', 'dexterity'];
const integer = (value) => Number.isSafeInteger(value) ? value : null;
const id = (value) => Number.isSafeInteger(value) && value > 0 ? value : null;
const text = (value) => typeof value === 'string' ? value.slice(0, 200) : '';
const responseError = () => Object.assign(new Error('Invalid Torn response'), { code: 'BAD_RESPONSE' });
const list = (value) => { if (!Array.isArray(value)) throw responseError(); return value; };
const at = (timestamp, observedAt) => id(timestamp) ? timestamp * 1000 : observedAt;
const next = (data) => Boolean(data._metadata?.links?.next);

function queryInt(params, name, min = 1, max = Number.MAX_SAFE_INTEGER, fallback = '') {
  const raw = params.get(name) ?? fallback;
  const value = /^\d{1,16}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw Object.assign(new Error('Invalid ' + name), { status: 400, code: 'BAD_INPUT' });
  }
  return value;
}

function participant(person) {
  return { id: id(person?.id), name: text(person?.name) };
}

function trade(row) {
  return { id: id(row.id), description: text(row.description), user: participant(row.user), trader: participant(row.trader),
    completedAt: id(row.completed_at), expiresAt: id(row.expires_at), modifiedAt: id(row.modified_at) };
}

function latestCompanyTraining(news, now = Date.now()) {
  const trained = new Map();
  for (const entry of Object.values(news || {})) {
    const timestamp = id(entry?.timestamp);
    if (!timestamp || timestamp * 1000 > now || typeof entry.news !== 'string') continue;
    const match = /<a\b[^>]*[?&]XID=(\d+)[^>]*>[^]*?<\/a>\s+has been trained\b/i.exec(entry.news);
    const player = match && id(Number(match[1]));
    if (player) trained.set(player, Math.max(trained.get(player) || 0, timestamp));
  }
  return trained;
}

async function companionData(section, params, read) {
  switch (section) {
    case 'company': {
      const type = queryInt(params, 'type', 1, 1000);
      const rating = queryInt(params, 'rating', 0, 10);
      const query = new URLSearchParams({ filters: `type:Equal:${type},rating:Equal:${rating}`, limit: '100' });
      const { data, observedAt } = await read(`company/search?${query}`, 10 * minute);
      const rows = list(data.search).filter((x) => x.type?.id === type && x.rating === rating)
        .map((x) => ({ id: id(x.id), name: text(x.name), rating, weekly: integer(x.income?.weekly) }))
        .filter((x) => x.id && x.weekly != null);
      return { type, rating, observedAt, hasMore: next(data), rows };
    }
    case 'market': {
      const item = queryInt(params, 'item');
      const { data, observedAt } = await read(`market/${item}/itemmarket?limit=${PAGE}`, minute);
      const market = data.itemmarket;
      const rows = list(market?.listings).map((x) => ({ price: integer(x.price), quantity: id(x.amount), variant: !!x.item_details }))
        .filter((x) => x.price != null && x.price >= 0 && x.quantity).sort((a, b) => a.price - b.price);
      return { item, name: text(market.item?.name), reference: integer(market.item?.average_price),
        observedAt: at(market.cache_timestamp, observedAt), hasMore: next(data), rows };
    }
    case 'trades': {
      const category = params.get('category') ?? 'ongoing';
      if (!['ongoing', 'finished'].includes(category)) throw Object.assign(new Error('Invalid category'), { status: 400, code: 'BAD_INPUT' });
      const { data, observedAt } = await read(`user/trades?cat=${category}&limit=${PAGE}`, 30_000);
      return { category, observedAt, hasMore: next(data), rows: list(data.trades).map(trade).filter((x) => x.id) };
    }
    case 'trade': {
      const tradeId = queryInt(params, 'id');
      const { data, observedAt } = await read(`user/${tradeId}/trade`, 20_000);
      if (data.trade?.id !== tradeId) throw responseError();
      const rows = list(data.trade.items).map(({ user_id, type, details }) => ({
        userId: id(user_id), type: text(type), id: id(details?.id), uid: details?.uid == null ? null : String(details.uid),
        amount: integer(details?.amount), name: text(details?.name), days: integer(details?.days),
      }));
      return { ...trade(data.trade), observedAt, rows };
    }
    case 'money': {
      const { data, observedAt } = await read('user/money', minute);
      if (!data.money || typeof data.money !== 'object') throw responseError();
      const { money } = data;
      return { observedAt, wallet: integer(money.wallet), vault: integer(money.vault),
        faction: money.faction ? { money: integer(money.faction.money), points: integer(money.faction.points) } : null };
    }
    case 'gyms': {
      const [mine, all] = await Promise.all([read('user/gym', minute), read('torn/gyms', 24 * 60 * minute)]);
      const gym = mine.data.gym;
      const available = new Set(list(gym?.unlocked_gyms).filter((x) => x.available).map((x) => x.id));
      if (id(gym.id)) available.add(gym.id);
      const gyms = list(all.data.gyms).filter((x) => available.has(x.id));
      return { active: text(gym.name), observedAt: mine.observedAt, best: Object.fromEntries(stats.map((stat) => {
        const rows = gyms.filter((x) => Number.isFinite(x.modifiers?.[stat])).sort((a, b) => b.modifiers[stat] - a.modifiers[stat] || a.id - b.id);
        const top = rows[0];
        return [stat, top ? { names: rows.filter((x) => x.modifiers[stat] === top.modifiers[stat]).map((x) => text(x.name)), modifier: top.modifiers[stat] } : null];
      })) };
    }
    case 'inventory': {
      const category = params.get('category') ?? Object.keys(inventoryCategories)[0];
      if (!Object.hasOwn(inventoryCategories, category)) {
        throw Object.assign(new Error('Invalid inventory category'), { status: 400, code: 'BAD_INPUT' });
      }
      const offset = queryInt(params, 'offset', 0, 10_000, '0');
      const query = new URLSearchParams({ cat: category, limit: String(PAGE), offset: String(offset) });
      const { data, observedAt } = await read(`user/inventory?${query}`, minute);
      return { category, offset, limit: PAGE, hasMore: next(data), observedAt: at(data.inventory?.timestamp, observedAt),
        rows: list(data.inventory?.items).map((x) => ({ id: id(x.id), name: text(x.name), amount: integer(x.amount),
          equipped: x.equipped === true, factionOwned: x.faction_owned === true })).filter((x) => x.id) };
    }
    case 'equipment': {
      const { data, observedAt } = await read('user/equipment', minute);
      return { observedAt, rows: list(data.equipment).map((x) => ({ name: text(x.name), slot: integer(x.slot),
        rarity: text(x.rarity), bonuses: list(x.bonuses).map((b) => ({ title: text(b.title), value: typeof b.value === 'number' ? b.value : null })) })) };
    }
    default: throw Object.assign(new Error('Unknown tracker module'), { status: 404 });
  }
}

module.exports = { companionData, latestCompanyTraining };
