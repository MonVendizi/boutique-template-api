import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

await pool.query(`
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cents INTEGER DEFAULT 490;
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cents INTEGER DEFAULT 0;
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code VARCHAR(50);
`);
console.log("orders export columns OK");
await pool.end();
