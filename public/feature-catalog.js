/* Shared descriptions only. Permission is decided by premium/feature-service.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXFeatureCatalog = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const legacy = `page.job page.gym page.networth page.travel page.war war.groups page.crimes crimes.shoplift crimes.value crimes.burglary crimes.jail page.faction page.awards page.tools tools.events tools.purchases tools.helpers page.levelling page.company notify notify.energy notify.nerve notify.drug notify.booster notify.medical notify.education notify.travel notify.hospital notify.bank notify.oc notify.factionOc notify.restock notify.shoplift notify.events notify.targets torn.warHelper torn.liveFight torn.ffScouterScript torn.tornw3bScript torn.crimeHelper torn.crimeValue torn.crimeRank torn.burglaryHelper torn.jailHelper torn.sellGuard torn.pokerHelper torn.fastSlots torn.stockSync torn.sessionGuard torn.eggFinder torn.halloweenHelper torn.ctHelper event.guide app.animations app.splash app.newYear app.premiumProfile app.overviewLayout app.torntools app.tabSleep app.loopGuard app.feedback app.updates app.weav3r app.premium app.premiumPromos`.split(' ');
  const definitions = [
    ...legacy.map((id) => ({ id, tier: 'free', module: id.split('.')[0], legacy: true })),
    ...['travel_basic', 'merits_basic', 'appearance_basic', 'events_basic', 'helpers_basic'].map((id) => ({ id, tier: 'free', module: id.split('_')[0] })),
    { id: 'appearance_custom_themes', tier: 'premium', module: 'appearance', title: ['Görünüm stüdyosu', 'Appearance studio'], description: ['Özel paletler, tema paketleri, yoğunluk ve kaydedilmiş profiller.', 'Custom palettes, theme packs, density and saved profiles.'] },
    { id: 'helpers_advanced', tier: 'premium', module: 'helpers', title: ['Oyuncu analiz masası', 'Player analysis desk'], description: ['Birleşik filtreler, karşılaştırma panelleri ve kişisel uyarı kuralları.', 'Combined filters, comparison panels and personal alert rules.'] },
    { id: 'events_advanced', tier: 'premium', module: 'events', title: ['Etkinlik planlayıcısı', 'Event planner'], description: ['Kişisel hedefler, hatırlatıcılar ve dönemler arası ilerleme.', 'Personal goals, reminders and progress across event runs.'] },
    { id: 'travel_advanced', tier: 'premium', module: 'travel', title: ['Seyahat stratejileri', 'Travel strategies'], description: ['Senaryoları karşılaştırın, fiyat geçmişini görün ve fiyat eşikleri belirleyin.', 'Compare scenarios, record price history and set price thresholds.'] },
    { id: 'merits_optimizer', tier: 'premium', module: 'merits', title: ['Akıllı Merit planlayıcı', 'Merit allocation planner'], description: ['Bütçenize ve önceliklerinize göre dağılım, karşılaştırma ve kayıtlı planlar.', 'Budgeted allocation, comparisons and saved plans based on your priorities.'] },
  ];
  const byId = Object.freeze(Object.fromEntries(definitions.map((d) => [d.id, Object.freeze(d)])));
  return Object.freeze({ version: 1, definitions: Object.freeze(definitions), byId, premium: Object.freeze(definitions.filter((d) => d.tier === 'premium')) });
});
