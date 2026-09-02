import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

async function migrateCategoriesColor() {
  console.log("Migration categories icon → color…");

  await pool.query(`
ALTER TABLE categories ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#D4AF37';
UPDATE categories SET color = '#D4AF37' WHERE color IS NULL;
UPDATE categories SET color = '#D4AF37' WHERE slug = 'karite';
UPDATE categories SET color = '#81C784' WHERE slug = 'savon';
UPDATE categories SET color = '#64B5F6' WHERE slug = 'the';
UPDATE categories SET color = '#A78BFA' WHERE slug = 'cheveux';
ALTER TABLE categories DROP COLUMN IF EXISTS icon;
`);

  const { rows } = await pool.query(
    `SELECT slug, name, color, nav_group FROM categories ORDER BY sort_order`
  );
  console.log(`Migration OK — ${rows.length} catégorie(s) :`);
  for (const row of rows) {
    console.log(`  • ${row.name} (${row.slug}) — ${row.color} — ${row.nav_group || "Boutique"}`);
  }
  await pool.end();
}

migrateCategoriesColor().catch((err) => {
  console.error("Erreur migrate-categories-color:", err);
  process.exit(1);
});
