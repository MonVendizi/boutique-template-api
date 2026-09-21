import pool from "../db/pool.js";
import { notifyIndexNow } from "../lib/indexnow.js";

export default async function brandRoutes(fastify) {
  fastify.get("/indexnow-key", async (request, reply) => {
    const key = process.env.INDEXNOW_KEY || "";
    if (!key) {
      return reply.code(404).send({ error: "IndexNow non configuré" });
    }
    return { key };
  });
  /** Config publique programme partenaire (bannières + grille réductions) */
  fastify.get("/partner-config", async () => {
    const { rows } = await pool.query(`
      SELECT key, value FROM brand_settings
      WHERE category = 'partner'
    `);
    const config = {};
    for (const row of rows) config[row.key] = row.value;

    const defaults = {
      jourx_cart_discount: "10",
      jourx_confirmation_discount: "15",
      jourx_not_found_discount: "5",
      jourx_all_discount: "20",
      tinaluxe_cart_discount: "15",
      tinaluxe_confirmation_discount: "20",
      tinaluxe_not_found_discount: "5",
      tinaluxe_all_discount: "25",
    };
    for (const [key, value] of Object.entries(defaults)) {
      if (config[key] === undefined || config[key] === null || config[key] === "") {
        config[key] = value;
      }
    }
    return config;
  });

  fastify.get("/brand/settings", async () => {
    const result = await pool.query(
      `SELECT key, value, type FROM brand_settings ORDER BY category, key`
    );
    const settings = {};
    for (const row of result.rows) {
      try {
        if (row.type === "json") {
          settings[row.key] = JSON.parse(row.value || "{}");
        } else if (row.type === "boolean") {
          settings[row.key] = row.value === "true";
        } else if (row.type === "number") {
          settings[row.key] = parseFloat(row.value) || 0;
        } else {
          settings[row.key] = row.value || "";
        }
      } catch {
        settings[row.key] = row.value || "";
      }
    }
    return settings;
  });

  fastify.get("/admin/brand/settings", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return reply;
    const result = await pool.query(
      `SELECT * FROM brand_settings ORDER BY category, key`
    );
    return result.rows;
  });

  fastify.put("/admin/brand/settings", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return reply;
    const updates = request.body;

    for (const [key, value] of Object.entries(updates)) {
      const strValue =
        typeof value === "object" ? JSON.stringify(value) : String(value);
      await pool.query(
        `
      INSERT INTO brand_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
        [key, strValue]
      );
    }

    void notifyIndexNow(["/"]);
    return { success: true };
  });
}
