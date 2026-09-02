import pool from "../src/db/pool.js";

const PRODUCTS = [
  {
    slug: "chantilly-beurre-de-karite-tinaluxe-eclat-supreme",
    category: "karite",
    name: "Chantilly de Karité Brut TinaLuxe",
    subtitle: "Éclat Suprême",
    short_description:
      "La crème iconique qui nourrit, unifie et révèle progressivement l'éclat naturel de votre peau. Texture légère, fouettée et fondante.",
    description:
      "Découvrez la Chantilly de Karité Brut TinaLuxe, un soin d'exception à la texture légère, fouettée et fondante. Enrichie en beurre de karité brut et en actifs soigneusement sélectionnés, elle nourrit intensément la peau tout en contribuant à améliorer l'apparence du teint. Au fil des applications, la peau paraît plus douce, plus souple, plus lumineuse et visiblement plus uniforme.",
    price: 39.0,
    unit: "/ 250ml",
    sku: "TL-CHAN-250",
    stock: 30,
    images: ["/images/chantilly-karite.webp"],
    highlights: [
      "Nourrit intensément la peau",
      "Hydrate durablement sans effet gras",
      "Contribue à unifier l'apparence du teint",
      "Révèle progressivement un glow naturel",
      "Convient à tous les types de peau",
    ],
    origin: "France",
    seo_title:
      "Chantilly de Karité Brut TinaLuxe – Éclat Suprême | Soin Naturel Premium",
    seo_description:
      "Chantilly de karité brut fouettée, texture légère et fondante. Nourrit, unifie et révèle l'éclat naturel de la peau. 250ml — Livraison France.",
    rating: 5.0,
    review_count: 0,
    active: true,
    featured: false,
  },
  {
    slug: "savon-tinaluxe-nicotinamide-lait-de-chevre",
    category: "savon",
    name: "Savon TinaLuxe au Lait de Chèvre",
    subtitle: "Douceur & Éclat Naturel",
    short_description:
      "Savon nettoyant au lait de chèvre. Nettoie en douceur, unifie le teint, laisse la peau douce et éclatante.",
    description:
      "Le Savon TinaLuxe au Lait de Chèvre est un soin nettoyant conçu pour nettoyer la peau tout en lui apportant douceur et confort. Sa formule associe les propriétés du nicotinamide (niacinamide) et du lait de chèvre, reconnus pour aider à préserver l'hydratation de la peau et favoriser un teint plus uniforme. Idéal pour le visage et le corps, il laisse la peau propre, douce et éclatante, sans sensation de tiraillement.",
    price: 14.9,
    unit: "/ 100g",
    sku: "TL-SAV-100",
    stock: 50,
    images: [
      "/images/savon-chevre_1.webp",
      "/images/savon-chevre_2.webp",
      "/images/savon-chevre_3.webp",
    ],
    highlights: [
      "Nettoie la peau en douceur",
      "Aide à préserver l'hydratation naturelle",
      "Contribue à unifier l'apparence du teint",
      "Convient à tous les types de peau",
      "Peaux sensibles compatibles",
    ],
    origin: "France",
    seo_title:
      "Savon TinaLuxe au Lait de Chèvre | Soin Visage & Corps",
    seo_description:
      "Savon nettoyant TinaLuxe au lait de chèvre. Peau douce, teint unifié, sans tiraillement. 100g — Convient peaux sensibles.",
    rating: 5.0,
    review_count: 0,
    active: true,
    featured: false,
  },
  {
    slug: "pack-3-savons-tinaluxe-nicotinamide-lait-de-chevre",
    category: "savon",
    name: "Pack 3 Savons TinaLuxe au Lait de Chèvre",
    subtitle: "Lait de Chèvre — Offre économique",
    short_description:
      "Le pack économique — 3 savons TinaLuxe au Lait de Chèvre pour 3 mois de rituel beauté naturel.",
    description:
      "Profitez du pack économique TinaLuxe : 3 savons au Lait de Chèvre pour 3 mois de rituel beauté complet. Idéal pour s'inscrire dans la durée et révéler progressivement l'éclat naturel de votre peau.",
    price: 39.9,
    unit: "/ 3 × 100g",
    sku: "TL-SAV-PACK3",
    stock: 20,
    images: ["/images/pack-savon-lait-chevre.webp"],
    highlights: [
      "3 savons = 3 mois de rituel",
      "Économie vs achat unitaire",
      "Lait de Chèvre",
      "Livraison France 2-4 jours",
    ],
    origin: "France",
    seo_title:
      "Pack 3 Savons TinaLuxe au Lait de Chèvre | Offre Économique",
    seo_description:
      "Pack 3 savons TinaLuxe au lait de chèvre. 3 mois de rituel beauté naturel. Offre économique — Livraison France.",
    rating: 5.0,
    review_count: 0,
    active: true,
    featured: false,
  },
];

async function ensureColumns() {
  await pool.query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS subtitle VARCHAR(255),
      ADD COLUMN IF NOT EXISTS short_description TEXT,
      ADD COLUMN IF NOT EXISTS unit VARCHAR(50),
      ADD COLUMN IF NOT EXISTS origin VARCHAR(100),
      ADD COLUMN IF NOT EXISTS seo_title VARCHAR(255),
      ADD COLUMN IF NOT EXISTS seo_description TEXT,
      ADD COLUMN IF NOT EXISTS rating NUMERIC(2,1) DEFAULT 5.0,
      ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0
  `);
}

async function main() {
  await ensureColumns();

  for (const p of PRODUCTS) {
    const price_cents = Math.round(p.price * 100);
    const result = await pool.query(
      `INSERT INTO products (
         slug, category, name, subtitle, short_description, description,
         price_cents, unit, sku, stock, images, highlights, origin,
         seo_title, seo_description, rating, review_count, active, featured
       )
       VALUES (
         $1,$2,$3,$4,$5,$6,
         $7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,
         $14,$15,$16,$17,$18,$19
       )
       ON CONFLICT (slug) DO NOTHING
       RETURNING id, name`,
      [
        p.slug,
        p.category,
        p.name,
        p.subtitle,
        p.short_description,
        p.description,
        price_cents,
        p.unit,
        p.sku,
        p.stock,
        JSON.stringify(p.images),
        JSON.stringify(p.highlights),
        p.origin,
        p.seo_title,
        p.seo_description,
        p.rating,
        p.review_count,
        p.active,
        p.featured,
      ]
    );
    console.log(
      result.rows.length ? `✅ ${p.name}` : `⚠️ ${p.name} (déjà existant)`
    );
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
