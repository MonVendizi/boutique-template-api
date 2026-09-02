import dotenv from "dotenv";
import pool from "./pool.js";

dotenv.config();

const products = [
  {
    name: "Beurre de Karité",
    slug: "beurre-de-karite-brut-pure-cameroun-tinaluxe",
    category: "karite",
    description:
      "Beurre de karité 100 % pur, brut et non raffiné, récolté au Cameroun. Hydratation intense pour peau et cheveux.",
    price_cents: 1499,
    sku: "TL-KAR-100",
    stock: 42,
    images: [
      "/images/beurre-karite-tinaluxe.webp",
      "/images/beurre-de-karite-brut (1).webp",
      "/images/Majestueux-Karite.webp",
    ],
    highlights: [
      "100 % pur, extrait à froid",
      "Récolté au Cameroun",
      "Hydratation intense peau & cheveux",
      "Sans additifs ni conservateurs",
    ],
    featured: true,
  },
  {
    name: "Tina Thé Minceur",
    slug: "the-minceur-naturel-africain-infusion-bien-etre-detox",
    category: "the",
    description:
      "Infusion artisanale aux plantes sélectionnées. Formule détox et métabolisme, cure de 30 jours.",
    price_cents: 3999,
    sku: "TL-TEA-100",
    stock: 125,
    images: ["/images/Tinaluxe-the.webp"],
    highlights: [
      "Plantes sélectionnées avec soin",
      "Formule détox & métabolisme",
      "Goût délicat et raffiné",
      "Cure de 30 jours",
    ],
    featured: true,
  },
];

async function seed() {
  console.log("Insertion des produits initiaux…");

  for (const p of products) {
    await pool.query(
      `INSERT INTO products (name, slug, category, description, price_cents, sku, stock, images, highlights, featured)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         description = EXCLUDED.description,
         price_cents = EXCLUDED.price_cents,
         sku = EXCLUDED.sku,
         stock = EXCLUDED.stock,
         images = EXCLUDED.images,
         highlights = EXCLUDED.highlights,
         featured = EXCLUDED.featured`,
      [
        p.name,
        p.slug,
        p.category,
        p.description,
        p.price_cents,
        p.sku,
        p.stock,
        JSON.stringify(p.images),
        JSON.stringify(p.highlights),
        p.featured,
      ]
    );
    console.log(`  ✓ ${p.name}`);
  }

  console.log("Seed terminé.");
  await pool.end();
}

seed().catch((err) => {
  console.error("Erreur de seed:", err);
  process.exit(1);
});
