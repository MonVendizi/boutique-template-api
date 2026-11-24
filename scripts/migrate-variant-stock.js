import dotenv from "dotenv";
import pool from "../src/db/pool.js";
import { ensureVariantStockSchema } from "../src/lib/variantStock.js";

dotenv.config();

await ensureVariantStockSchema(pool);
console.log("Migration variant stock OK (stock_movements.variant_label)");
await pool.end();
