const CROSS_SELL_MAP = {
  "beurre-de-karite-brut-pure-cameroun-tinaluxe": [
    {
      name: "Chantilly de Karité",
      slug: "chantilly-beurre-de-karite-tinaluxe-eclat-supreme",
      price: 39.0,
      reason:
        "La chantilly légère parfaite pour compléter votre routine karité",
    },
    {
      name: "Savon au Lait de Chèvre",
      slug: "savon-tinaluxe-nicotinamide-lait-de-chevre",
      price: 14.9,
      reason: "Le duo karité + savon pour une peau parfaitement nourrie",
    },
  ],
  "chantilly-beurre-de-karite-tinaluxe-eclat-supreme": [
    {
      name: "Beurre de Karité Brut",
      slug: "beurre-de-karite-brut-pure-cameroun-tinaluxe",
      price: 14.99,
      reason: "La version brute pour un soin en profondeur",
    },
    {
      name: "Tina Thé Minceur",
      slug: "the-minceur-naturel-africain-infusion-bien-etre-detox",
      price: 39.99,
      reason: "Pour prendre soin de vous de l'intérieur aussi",
    },
  ],
  "the-minceur-naturel-africain-infusion-bien-etre-detox": [
    {
      name: "Beurre de Karité Brut",
      slug: "beurre-de-karite-brut-pure-cameroun-tinaluxe",
      price: 14.99,
      reason:
        "Le soin naturel parfait pour accompagner votre cure minceur",
    },
    {
      name: "Chantilly de Karité",
      slug: "chantilly-beurre-de-karite-tinaluxe-eclat-supreme",
      price: 39.0,
      reason: "Hydratez votre peau pendant votre cure bien-être",
    },
  ],
  "savon-tinaluxe-nicotinamide-lait-de-chevre": [
    {
      name: "Chantilly de Karité",
      slug: "chantilly-beurre-de-karite-tinaluxe-eclat-supreme",
      price: 39.0,
      reason: "Complétez votre routine avec notre chantilly hydratante",
    },
    {
      name: "Beurre de Karité Brut",
      slug: "beurre-de-karite-brut-pure-cameroun-tinaluxe",
      price: 14.99,
      reason: "Le duo savon + karité pour une peau rayonnante",
    },
  ],
  "pack-3-savons-tinaluxe-nicotinamide-lait-de-chevre": [
    {
      name: "Chantilly de Karité",
      slug: "chantilly-beurre-de-karite-tinaluxe-eclat-supreme",
      price: 39.0,
      reason: "La chantilly idéale pour sublimer les bienfaits du savon",
    },
    {
      name: "Tina Thé Minceur",
      slug: "the-minceur-naturel-africain-infusion-bien-etre-detox",
      price: 39.99,
      reason: "Prenez soin de vous de l'intérieur et de l'extérieur",
    },
  ],
};

export function getCrossSellSuggestions(slugs) {
  const suggestions = [];
  for (const slug of slugs) {
    const related = CROSS_SELL_MAP[slug] || [];
    for (const s of related) {
      if (!slugs.includes(s.slug) && !suggestions.find((x) => x.slug === s.slug)) {
        suggestions.push(s);
      }
    }
  }
  return suggestions.slice(0, 2);
}
