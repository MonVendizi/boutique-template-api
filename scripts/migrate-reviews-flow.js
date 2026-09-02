import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

async function migrate() {
  console.log("Migration flux avis…");
  await pool.query(`
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT
);

INSERT INTO settings (key, value) VALUES ('google_review_url', '')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS review_reminders (
  order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  sent_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_review_sent_at TIMESTAMP;
`);
  console.log("Flux avis OK — settings, review_reminders, delivery_review_sent_at.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Erreur migrate-reviews-flow:", err);
  process.exit(1);
});
