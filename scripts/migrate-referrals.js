import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

async function migrateReferrals() {
  console.log("Migration parrainage…");
  await pool.query(`
CREATE TABLE IF NOT EXISTS referral_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  active BOOLEAN DEFAULT false,
  referrer_discount_percent INTEGER DEFAULT 10,
  referee_discount_percent INTEGER DEFAULT 10,
  cookie_days INTEGER DEFAULT 30,
  updated_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO referral_config (id, active) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  referrer_email VARCHAR(255) NOT NULL,
  referrer_name VARCHAR(100),
  referral_code VARCHAR(50) UNIQUE NOT NULL,
  referee_email VARCHAR(255),
  referee_order_id UUID REFERENCES orders(id),
  status VARCHAR(20) DEFAULT 'pending',
  referrer_discount_code VARCHAR(50),
  referrer_discount_sent BOOLEAN DEFAULT false,
  invite_sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  converted_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_email);
`);

  const cfg = await pool.query(`SELECT * FROM referral_config WHERE id = 1`);
  const refs = await pool.query(`SELECT COUNT(*)::int AS count FROM referrals`);
  console.log(
    `Parrainage OK — active=${cfg.rows[0]?.active}, ${refs.rows[0].count} parrainage(s).`
  );
  await pool.end();
}

migrateReferrals().catch((err) => {
  console.error("Erreur migrate-referrals:", err);
  process.exit(1);
});
