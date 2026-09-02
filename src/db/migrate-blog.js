import dotenv from "dotenv";
import pool from "./pool.js";

dotenv.config();

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS blog_posts (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(255) UNIQUE NOT NULL,
  type VARCHAR(50) DEFAULT 'guide',
  status VARCHAR(20) DEFAULT 'draft',
  title VARCHAR(255) NOT NULL,
  excerpt TEXT,
  hero_image VARCHAR(500),
  category VARCHAR(100),
  tags JSONB DEFAULT '[]',
  seo_title VARCHAR(255),
  seo_description VARCHAR(500),
  seo_keywords JSONB DEFAULT '[]',
  sections JSONB DEFAULT '[]',
  faq JSONB DEFAULT '[]',
  cta_text VARCHAR(100),
  cta_url VARCHAR(255),
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blog_slug ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_status ON blog_posts(status);
`;

async function migrateBlog() {
  console.log("Migration blog…");
  await pool.query(CREATE_SQL);
  await pool.query(
    `ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS faq JSONB DEFAULT '[]'`
  );
  await pool.query(
    `ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS related_slug VARCHAR(255)`
  );
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM blog_posts`
  );
  console.log(`Blog OK — table prête (${rows[0].count} article(s)).`);
  await pool.end();
}

migrateBlog().catch((err) => {
  console.error("Erreur migrate-blog:", err);
  process.exit(1);
});
