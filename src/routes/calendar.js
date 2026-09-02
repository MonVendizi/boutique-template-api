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

const VALID_TYPES = ["task", "promo", "content", "restock", "event"];

export default async function calendarRoutes(fastify) {
  fastify.get("/admin/calendar/tasks", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const { rows } = await pool.query(
      `SELECT id, title, description, date::text AS date, type, reminder_sent, created_at
       FROM calendar_tasks
       ORDER BY date ASC, created_at ASC`
    );
    return rows;
  });

  fastify.post("/admin/calendar/tasks", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const body = request.body || {};
    const title = String(body.title || "").trim();
    const description = body.description
      ? String(body.description).trim()
      : null;
    const date = String(body.date || "").trim();
    const type = VALID_TYPES.includes(body.type) ? body.type : "task";

    if (!title) {
      return reply.code(400).send({ error: "Titre requis" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: "Date invalide (YYYY-MM-DD)" });
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO calendar_tasks (title, description, date, type)
         VALUES ($1, $2, $3::date, $4)
         RETURNING id, title, description, date::text AS date, type, reminder_sent, created_at`,
        [title, description || null, date, type]
      );
      return reply.code(201).send(rows[0]);
    } catch (err) {
      console.error("POST /admin/calendar/tasks:", err);
      return reply.code(500).send({ error: "Erreur création tâche" });
    }
  });

  fastify.delete("/admin/calendar/tasks/:id", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: "ID invalide" });
    }
    const { rowCount } = await pool.query(
      `DELETE FROM calendar_tasks WHERE id = $1`,
      [id]
    );
    if (!rowCount) {
      return reply.code(404).send({ error: "Tâche introuvable" });
    }
    return { ok: true };
  });
}
