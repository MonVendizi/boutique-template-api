import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

async function migrate() {
  console.log("Migration cross-sell J+14…");
  await pool.query(`
ALTER TABLE orders ADD COLUMN IF NOT EXISTS crosssell_sent BOOLEAN DEFAULT false;
`);
  console.log("Cross-sell OK — colonne crosssell_sent ajoutée.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Erreur migrate-crosssell:", err);
  process.exit(1);
});
