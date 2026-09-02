import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

async function migrate() {
  console.log("Migration settings popup newsletter…");
  await pool.query(`
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT
);

INSERT INTO settings (key, value) VALUES
  ('popup_enabled', 'true'),
  ('popup_discount', '10'),
  ('popup_title', 'Bienvenue chez TinaLuxe ✨'),
  ('popup_subtitle', 'Rejoignez notre communauté et recevez'),
  ('popup_delay', '5')
ON CONFLICT (key) DO NOTHING;
`);
  console.log("Settings popup OK — popup_enabled, popup_discount, popup_delay, popup_title, popup_subtitle.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Erreur migrate-popup-settings:", err);
  process.exit(1);
});
