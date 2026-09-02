import pool from "../db/pool.js";

function checkAdmin(request, reply) {
  const password = request.headers["x-admin-password"];

  if (!process.env.ADMIN_PASSWORD) {
    reply.code(500).send({ error: "ADMIN_PASSWORD non configuré" });
    return false;
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    reply.code(401).send({ error: "Non autorisé" });
    return false;
  }

  return true;
}

export default async function brandRoutes(fastify) {
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
    if (!checkAdmin(request, reply)) return reply;
    const result = await pool.query(
      `SELECT * FROM brand_settings ORDER BY category, key`
    );
    return result.rows;
  });

  fastify.put("/admin/brand/settings", async (request, reply) => {
    if (!checkAdmin(request, reply)) return reply;
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

    return { success: true };
  });
}
