import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

await pool.query(`
  ALTER TABLE products ADD COLUMN IF NOT EXISTS badge VARCHAR(50) DEFAULT NULL;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT false;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
`);

await pool.query(
  `UPDATE products SET sort_order = 1, featured = true, badge = 'best-seller' WHERE slug LIKE '%karite-brut%'`
);
await pool.query(
  `UPDATE products SET sort_order = 2, badge = 'coup-de-coeur' WHERE slug LIKE '%chantilly%'`
);
await pool.query(
  `UPDATE products SET sort_order = 3 WHERE slug LIKE '%the-minceur%'`
);
await pool.query(
  `UPDATE products SET sort_order = 4 WHERE slug LIKE '%savon%' AND slug NOT LIKE '%pack%'`
);
await pool.query(
  `UPDATE products SET sort_order = 5, badge = 'pack' WHERE slug LIKE '%pack%'`
);

console.log("Migration products display OK");
await pool.end();
