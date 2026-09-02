import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

async function migrateCalendar() {
  console.log("Migration calendar_tasks…");
  await pool.query(`
CREATE TABLE IF NOT EXISTS calendar_tasks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  type VARCHAR(50) DEFAULT 'task',
  reminder_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calendar_tasks_date ON calendar_tasks(date);
`);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM calendar_tasks`
  );
  console.log(`Calendar OK — table prête (${rows[0].count} tâches).`);
  await pool.end();
}

migrateCalendar().catch((err) => {
  console.error("Erreur migrate-calendar:", err);
  process.exit(1);
});
