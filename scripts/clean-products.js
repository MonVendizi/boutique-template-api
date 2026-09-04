import pool from "../src/db/pool.js";

await pool.query("DELETE FROM stock_movements");
await pool.query("DELETE FROM products");
console.log("Produits et stock_movements supprimés");
await pool.end();
