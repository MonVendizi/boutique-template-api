import dotenv from "dotenv";
import pool from "./pool.js";

dotenv.config();

const BRAND_NAME = process.env.BRAND_NAME || "Ma Boutique";
const WELCOME_PROMO_CODE = process.env.WELCOME_PROMO_CODE || "BIENVENUE10";
const INACTIVE_PROMO_CODE = process.env.INACTIVE_PROMO_CODE || "RETOUR10";

const category = {
  slug: "exemple",
  name: "Exemple",
  description: "Catégorie exemple pour démarrer votre catalogue.",
  color: "#D4AF37",
  nav_group: "Exemple",
  sort_order: 1,
};

const product = {
  name: "Produit Exemple",
  slug: "produit-exemple",
  category: "exemple",
  description:
    "Un produit exemple pour illustrer la structure de votre catalogue. Remplacez-le par vos propres produits.",
  price_cents: 1990,
  sku: "EXEMPLE-001",
  stock: 10,
  images: [],
  highlights: [
    "Produit de démonstration",
    "À remplacer par vos articles",
    "Configurez photos et description dans l'admin",
  ],
  featured: true,
};

const baseSettings = [
  ["popup_enabled", "true"],
  ["popup_discount", "10"],
  ["popup_title", `Bienvenue chez ${BRAND_NAME} ✨`],
  ["popup_subtitle", "Rejoignez notre communauté et recevez"],
  ["popup_delay", "5"],
  ["google_review_url", ""],
];

async function seed() {
  console.log("Seed générique — catégorie, produit et settings de base…");

  // 1. Crée un groupe de navigation "Exemple" (évite le doublon avec le lien Boutique)
  await pool.query(`
    INSERT INTO nav_groups (name, sort_order)
    VALUES ('Exemple', 1)
    ON CONFLICT (name) DO NOTHING
  `);

  const groupResult = await pool.query(
    `SELECT id, name FROM nav_groups WHERE name = 'Exemple'`
  );
  const groupName = groupResult.rows[0]?.name || "Exemple";

  // 2. Crée la catégorie "Exemple" dans ce groupe
  // Note : categories.nav_group stocke le NOM du groupe (join sur nav_groups.name)
  await pool.query(
    `
    INSERT INTO categories (slug, name, description, color, nav_group, sort_order, active)
    VALUES ($1, $2, $3, $4, $5, $6, true)
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      color = EXCLUDED.color,
      nav_group = EXCLUDED.nav_group,
      sort_order = EXCLUDED.sort_order,
      active = true
  `,
    [
      category.slug,
      category.name,
      category.description,
      category.color,
      groupName,
      category.sort_order,
    ]
  );
  console.log(`  ✓ Groupe nav + catégorie : ${groupName} / ${category.name}`);

  await pool.query(
    `INSERT INTO products (name, slug, category, description, price_cents, sku, stock, images, highlights, featured, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, true)
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
      product.name,
      product.slug,
      product.category,
      product.description,
      product.price_cents,
      product.sku,
      product.stock,
      JSON.stringify(product.images),
      JSON.stringify(product.highlights),
      product.featured,
    ]
  );
  console.log(`  ✓ Produit : ${product.name}`);

  for (const [key, value] of baseSettings) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value]
    );
  }
  console.log("  ✓ Settings de base");

  await pool.query(
    `INSERT INTO promo_codes (code, type, value, active, internal_note)
     VALUES
       ($1, 'percent', 10, true, 'Code bienvenue newsletter'),
       ($2, 'percent', 10, true, 'Code clients inactifs')
     ON CONFLICT (code) DO NOTHING`,
    [WELCOME_PROMO_CODE, INACTIVE_PROMO_CODE]
  );
  console.log(`  ✓ Codes promo : ${WELCOME_PROMO_CODE}, ${INACTIVE_PROMO_CODE}`);

  console.log("Seed terminé (0 avis — table reviews non peuplée).");
  await pool.end();
}

seed().catch((err) => {
  console.error("Erreur de seed:", err);
  process.exit(1);
});
