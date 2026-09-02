import pool from "../db/pool.js";

export async function getSetting(key, defaultValue = "") {
  const { rows } = await pool.query(
    `SELECT value FROM settings WHERE key = $1`,
    [key]
  );
  return rows[0]?.value ?? defaultValue;
}

export async function getSettings() {
  const { rows } = await pool.query(`SELECT key, value FROM settings`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""]));
}

export async function setSettings(updates) {
  for (const [key, value] of Object.entries(updates)) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value == null ? "" : String(value)]
    );
  }
}

export async function getGoogleReviewUrl() {
  const url = (await getSetting("google_review_url", "")).trim();
  return url || null;
}
