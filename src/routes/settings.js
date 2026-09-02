import pool from "../db/pool.js";

const POPUP_KEYS = [
  "popup_enabled",
  "popup_discount",
  "popup_delay",
  "popup_title",
  "popup_subtitle",
];

export default async function settingsRoutes(fastify) {
  fastify.get("/settings/popup", async () => {
    const { rows } = await pool.query(
      `SELECT key, value FROM settings WHERE key = ANY($1::text[])`,
      [POPUP_KEYS]
    );
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  });
}
