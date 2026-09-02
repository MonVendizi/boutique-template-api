import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

async function migrateCategories() {
  console.log("Migration categories…");
  await pool.query(`
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  color VARCHAR(20) DEFAULT '#D4AF37',
  nav_group VARCHAR(100),
  active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO categories (slug, name, color, nav_group, sort_order) VALUES
  ('karite', 'Karité', '#D4AF37', 'Soins', 1),
  ('savon', 'Savon', '#81C784', 'Soins', 2),
  ('the', 'Thés & Infusions', '#64B5F6', 'Infusions', 3),
  ('cheveux', 'Extensions & Soins Cheveux', '#A78BFA', 'Cheveux', 4)
ON CONFLICT (slug) DO NOTHING;
`);
  const { rows } = await pool.query(
    `SELECT slug, name, color, nav_group, sort_order FROM categories ORDER BY sort_order`
  );
  console.log(`Categories OK — ${rows.length} catégorie(s) :`);
  for (const row of rows) {
    console.log(`  • ${row.name} (${row.slug}) — ${row.color} — ${row.nav_group || "Boutique"}`);
  }
  await pool.end();
}

migrateCategories().catch((err) => {
  console.error("Erreur migrate-categories:", err);
  process.exit(1);
});
