import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

async function migrateAnalyticsEvents() {
  console.log("Migration analytics_events…");
  await pool.query(`
CREATE TABLE IF NOT EXISTS analytics_events (
  id SERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL,
  page VARCHAR(255) NOT NULL,
  element VARCHAR(100),
  depth INTEGER,
  seconds INTEGER,
  device VARCHAR(10),
  session_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analytics_page ON analytics_events(page, type, created_at);
`);

  const count = await pool.query(
    `SELECT COUNT(*)::int AS count FROM analytics_events`
  );
  console.log(`Analytics events OK — ${count.rows[0].count} événement(s).`);
  await pool.end();
}

migrateAnalyticsEvents().catch((err) => {
  console.error("Erreur migrate-analytics-events:", err);
  process.exit(1);
});
