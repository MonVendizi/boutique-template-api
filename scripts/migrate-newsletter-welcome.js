import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

async function migrate() {
  console.log("Migration séquence bienvenue newsletter…");
  await pool.query(`
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS welcome_sent BOOLEAN DEFAULT false;
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS welcome_j3_sent BOOLEAN DEFAULT false;
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS welcome_j7_sent BOOLEAN DEFAULT false;
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
`);
  console.log(
    "Newsletter bienvenue OK — customer_name, welcome_sent, welcome_j3_sent, welcome_j7_sent."
  );
  await pool.end();
}

migrate().catch((err) => {
  console.error("Erreur migrate-newsletter-welcome:", err);
  process.exit(1);
});
