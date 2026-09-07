import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

await pool.query(`
  CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain VARCHAR(255) NOT NULL UNIQUE,
    api_url VARCHAR(255) NOT NULL,
    brand_name VARCHAR(255),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );
`);

await pool.query(`
  CREATE INDEX IF NOT EXISTS idx_tenants_domain ON tenants(domain);
`);

await pool.query(`
  INSERT INTO tenants (domain, api_url, brand_name)
  VALUES (
    'boutique-template-eight.vercel.app',
    'https://boutique-template-api-production.up.railway.app',
    'Ma Boutique'
  )
  ON CONFLICT (domain) DO NOTHING
`);

console.log("Migration tenants OK");
await pool.end();
