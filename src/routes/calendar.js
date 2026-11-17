import pool from "../db/pool.js";
import { checkAdmin } from "../lib/adminAuth.js";

const VALID_TYPES = ["task", "promo", "content", "restock", "event"];

export default async function calendarRoutes(fastify) {
  fastify.get("/admin/calendar/tasks", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    const { rows } = await pool.query(
      `SELECT id, title, description, date::text AS date, type, reminder_sent, created_at
       FROM calendar_tasks
       ORDER BY date ASC, created_at ASC`
    );
    return rows;
  });

  fastify.post("/admin/calendar/tasks", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
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

  fastify.patch("/admin/calendar/tasks/:id", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: "ID invalide" });
    }
    const body = request.body || {};
    const title =
      body.title !== undefined ? String(body.title || "").trim() : undefined;
    const description =
      body.description !== undefined
        ? body.description
          ? String(body.description).trim()
          : null
        : undefined;
    const date =
      body.date !== undefined ? String(body.date || "").trim() : undefined;
    const type =
      body.type !== undefined
        ? VALID_TYPES.includes(body.type)
          ? body.type
          : undefined
        : undefined;

    if (title !== undefined && !title) {
      return reply.code(400).send({ error: "Titre requis" });
    }
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: "Date invalide (YYYY-MM-DD)" });
    }

    try {
      const { rows } = await pool.query(
        `UPDATE calendar_tasks SET
           title = COALESCE($2, title),
           description = CASE WHEN $3::boolean THEN $4 ELSE description END,
           date = COALESCE($5::date, date),
           type = COALESCE($6, type),
           reminder_sent = CASE WHEN $5::date IS NOT NULL THEN false ELSE reminder_sent END
         WHERE id = $1
         RETURNING id, title, description, date::text AS date, type, reminder_sent, created_at`,
        [
          id,
          title ?? null,
          description !== undefined,
          description ?? null,
          date ?? null,
          type ?? null,
        ],
      );
      if (!rows[0]) {
        return reply.code(404).send({ error: "Tâche introuvable" });
      }
      return rows[0];
    } catch (err) {
      console.error("PATCH /admin/calendar/tasks:", err);
      return reply.code(500).send({ error: "Erreur mise à jour tâche" });
    }
  });

  fastify.delete("/admin/calendar/tasks/:id", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
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
