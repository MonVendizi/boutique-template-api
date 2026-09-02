import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pool from "./pool.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");

  console.log("Exécution du schéma boutique…");
  await pool.query(sql);
  console.log("Migration terminée avec succès.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Erreur de migration:", err);
  process.exit(1);
});
