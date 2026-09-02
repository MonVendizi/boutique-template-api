import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

async function migrateAbandonedCarts() {
  console.log("Migration abandoned_carts…");
  await pool.query(`
CREATE TABLE IF NOT EXISTS abandoned_carts (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  customer_name VARCHAR(100),
  items JSONB NOT NULL,
  total_cents INTEGER NOT NULL,
  promo_code VARCHAR(50),
  discount_cents INTEGER DEFAULT 0,
  reminder_sent BOOLEAN DEFAULT false,
  reminder_sent_at TIMESTAMP,
  converted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_abandoned_email ON abandoned_carts(email);
CREATE INDEX IF NOT EXISTS idx_abandoned_reminder ON abandoned_carts(reminder_sent, converted, created_at);
`);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM abandoned_carts`
  );
  console.log(`Abandoned carts OK — table prête (${rows[0].count} paniers).`);
  await pool.end();
}

migrateAbandonedCarts().catch((err) => {
  console.error("Erreur migrate-abandoned-carts:", err);
  process.exit(1);
});
