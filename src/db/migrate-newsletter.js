import dotenv from "dotenv";
import pool from "./pool.js";

dotenv.config();

const EXISTING_EMAILS = [
  { email: "nganeomie@gmail.com", source: "wp-import" },
  { email: "michellemvondo92@gmail.com", source: "wp-import" },
  { email: "mogue.alida1@gmail.com", source: "wp-import" },
  { email: "lgerard@club-internet.fr", source: "wp-import" },
  { email: "ngahclaudine0@gmail.com", source: "wp-import" },
];

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  token VARCHAR(64) UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  source VARCHAR(50) DEFAULT 'site',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  unsubscribed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_newsletter_email ON newsletter_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_newsletter_active ON newsletter_subscribers(active) WHERE active = true;
`;

async function migrateNewsletter() {
  console.log("Migration newsletter…");
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
  await pool.query(CREATE_SQL);

  let inserted = 0;
  for (const row of EXISTING_EMAILS) {
    const result = await pool.query(
      `INSERT INTO newsletter_subscribers (email, source)
       VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [row.email.toLowerCase(), row.source]
    );
    if (result.rows.length) inserted += 1;
  }

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM newsletter_subscribers WHERE active = true`
  );
  console.log(
    `Newsletter OK — ${inserted} importé(s), ${rows[0].count} abonné(s) actif(s).`
  );
  await pool.end();
}

migrateNewsletter().catch((err) => {
  console.error("Erreur migrate-newsletter:", err);
  process.exit(1);
});
