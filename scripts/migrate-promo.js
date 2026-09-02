import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

async function migratePromo() {
  console.log("Migration promo_codes…");
  await pool.query(`
CREATE TABLE IF NOT EXISTS promo_codes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('percent', 'fixed')),
  value NUMERIC(10,2) NOT NULL,
  min_order_cents INTEGER DEFAULT 0,
  max_uses INTEGER DEFAULT NULL,
  uses_count INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  expires_at TIMESTAMP DEFAULT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS internal_note TEXT;
UPDATE promo_codes
SET internal_note = 'Code utilisé dans les emails de relance clients inactifs (60+ jours sans commande). Ne pas supprimer — les clientes reçoivent ce code automatiquement par email. Le laisser actif en permanence.'
WHERE code = 'RETOUR10'
  AND (internal_note IS NULL OR TRIM(internal_note) = '');
`);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM promo_codes`
  );
  console.log(`Promo OK — table prête (${rows[0].count} codes).`);
  await pool.end();
}

migratePromo().catch((err) => {
  console.error("Erreur migrate-promo:", err);
  process.exit(1);
});
