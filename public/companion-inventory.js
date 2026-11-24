(function (root, categories) {
  const inventory = Object.freeze(categories);
  if (typeof module === 'object' && module.exports) module.exports = inventory;
  else root.LRXCompanionInventory = inventory;
})(globalThis, {
  Primary: 'Birincil silah',
  Secondary: 'İkincil silah',
  Melee: 'Yakın dövüş silahı',
  Defensive: 'Zırh',
  Temporary: 'Geçici ekipman',
  Drug: 'Uyuşturucu',
  Medical: 'Tıbbi malzeme',
  Booster: 'Güçlendirici',
  'Energy Drink': 'Enerji içeceği',
  Alcohol: 'Alkol',
  Candy: 'Şekerleme',
  Clothing: 'Kıyafet',
  Jewelry: 'Takı',
  Collectible: 'Koleksiyon eşyası',
  Tool: 'Alet',
  Material: 'Malzeme',
  Car: 'Araba',
  Book: 'Kitap',
  Special: 'Özel eşya',
  'Supply Pack': 'Malzeme paketi',
  Enhancer: 'Geliştirici',
  Artifact: 'Tarihî eser',
  Flower: 'Çiçek',
  Plushie: 'Peluş',
  Other: 'Diğer',
});
