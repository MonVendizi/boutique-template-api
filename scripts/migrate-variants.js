import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

await pool.query(`
  CREATE TABLE IF NOT EXISTS product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL DEFAULT 'size',
    options JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW()
  )
`);

await pool.query(
  `CREATE UNIQUE INDEX IF NOT EXISTS product_variants_product_id_uidx
   ON product_variants (product_id)`
);

await pool.query(
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS has_variants BOOLEAN DEFAULT false`
);
await pool.query(
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_type VARCHAR(20) DEFAULT 'size'`
);

await pool.query(`
  INSERT INTO brand_settings (key, value, type, category, label)
  VALUES ('enable_variants', 'false', 'boolean', 'checkout', 'Activer les variantes produits')
  ON CONFLICT (key) DO NOTHING
`);

console.log("Migration variants OK");
await pool.end();
