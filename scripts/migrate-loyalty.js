import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

async function migrateLoyalty() {
  console.log("Migration loyalty…");
  await pool.query(`
CREATE TABLE IF NOT EXISTS loyalty_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  active BOOLEAN DEFAULT false,
  points_per_euro INTEGER DEFAULT 1,
  points_for_reward INTEGER DEFAULT 100,
  reward_cents INTEGER DEFAULT 500,
  reward_expiry_days INTEGER DEFAULT 30,
  updated_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO loyalty_config (id, active) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS loyalty_points (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  customer_name VARCHAR(100),
  points INTEGER DEFAULT 0,
  total_earned INTEGER DEFAULT 0,
  total_redeemed INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
`);
  const cfg = await pool.query(`SELECT * FROM loyalty_config WHERE id = 1`);
  const pts = await pool.query(
    `SELECT COUNT(*)::int AS count FROM loyalty_points`
  );
  console.log(
    `Loyalty OK — config active=${cfg.rows[0]?.active}, ${pts.rows[0].count} clients.`
  );
  await pool.end();
}

migrateLoyalty().catch((err) => {
  console.error("Erreur migrate-loyalty:", err);
  process.exit(1);
});
