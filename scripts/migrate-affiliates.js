import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

async function migrateAffiliates() {
  console.log("Migration affiliates…");
  await pool.query(`
CREATE TABLE IF NOT EXISTS affiliates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  code VARCHAR(50) UNIQUE NOT NULL,
  commission_percent NUMERIC(5,2) DEFAULT 10.00,
  active BOOLEAN DEFAULT true,
  total_clicks INTEGER DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  total_revenue_cents INTEGER DEFAULT 0,
  total_commission_cents INTEGER DEFAULT 0,
  total_paid_cents INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id SERIAL PRIMARY KEY,
  affiliate_code VARCHAR(50) NOT NULL,
  ip_hash VARCHAR(64),
  user_agent VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_code ON affiliate_clicks(affiliate_code);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS affiliate_code VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS affiliate_commission_cents INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_paid BOOLEAN DEFAULT false;
`);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM affiliates`
  );
  console.log(`Affiliates OK — table prête (${rows[0].count} affilié(s)).`);
  await pool.end();
}

migrateAffiliates().catch((err) => {
  console.error("Erreur migrate-affiliates:", err);
  process.exit(1);
});
