import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

async function migrateNavGroups() {
  console.log("Migration nav_groups…");

  await pool.query(`
CREATE TABLE IF NOT EXISTS nav_groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO nav_groups (name, sort_order) VALUES
  ('Soins', 1),
  ('Infusions', 2),
  ('Cheveux', 3)
ON CONFLICT (name) DO NOTHING;
`);

  const { rows } = await pool.query(
    `SELECT ng.name, ng.sort_order,
            COUNT(c.id)::int AS category_count
     FROM nav_groups ng
     LEFT JOIN categories c ON c.nav_group = ng.name
     GROUP BY ng.id
     ORDER BY ng.sort_order, ng.name`
  );

  console.log(`Nav groups OK — ${rows.length} groupe(s) :`);
  for (const row of rows) {
    console.log(
      `  • ${row.name} (${row.category_count} catégorie(s)) — ordre ${row.sort_order}`
    );
  }
  await pool.end();
}

migrateNavGroups().catch((err) => {
  console.error("Erreur migrate-nav-groups:", err);
  process.exit(1);
});
