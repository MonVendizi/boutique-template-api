import dotenv from "dotenv";
import pool from "./pool.js";

dotenv.config();

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_slug VARCHAR(255),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  customer_email VARCHAR(255) NOT NULL,
  customer_name VARCHAR(100) NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title VARCHAR(200),
  content TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  verified_purchase BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  published_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_slug, status);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
`;

async function migrateReviews() {
  console.log("Migration reviews…");
  await pool.query(CREATE_SQL);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM reviews`
  );
  console.log(`Reviews OK — table prête (${rows[0].count} avis).`);
  await pool.end();
}

migrateReviews().catch((err) => {
  console.error("Erreur migrate-reviews:", err);
  process.exit(1);
});
