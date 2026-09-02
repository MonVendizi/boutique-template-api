import pool from "../db/pool.js";

/** Nombre max de groupes affichés directement dans la nav (sort_order 1–4). */
export const NAV_MAIN_GROUP_LIMIT = 3;

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

function toSlug(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const CATEGORY_SELECT = `
  SELECT
    c.id,
    c.slug,
    c.name,
    c.description,
    c.color,
    c.nav_group,
    c.active,
    c.sort_order,
    c.created_at,
    COUNT(p.id)::int AS product_count
  FROM categories c
  LEFT JOIN products p ON p.category = c.slug
`;

const CATEGORY_LIST_SQL = `${CATEGORY_SELECT}
  GROUP BY c.id
  ORDER BY c.sort_order ASC, c.name ASC`;

const NAV_GROUP_LIST_SQL = `
  SELECT
    ng.id,
    ng.name,
    ng.sort_order,
    ng.created_at,
    COUNT(c.id)::int AS category_count
  FROM nav_groups ng
  LEFT JOIN categories c ON c.nav_group = ng.name
  GROUP BY ng.id
  ORDER BY ng.sort_order ASC, ng.name ASC
`;

async function fetchNavGroupById(id) {
  const { rows } = await pool.query(
    `SELECT ng.id, ng.name, ng.sort_order, ng.created_at,
            COUNT(c.id)::int AS category_count
     FROM nav_groups ng
     LEFT JOIN categories c ON c.nav_group = ng.name
     WHERE ng.id = $1
     GROUP BY ng.id`,
    [id]
  );
  return rows[0] || null;
}

export default async function categoriesRoutes(fastify) {
  fastify.get("/categories", async () => {
    const { rows } = await pool.query(
      `${CATEGORY_SELECT}
       WHERE c.active = true
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.name ASC`
    );
    return rows;
  });

  fastify.get("/nav-groups", async () => {
    const { rows } = await pool.query(
      `SELECT id, name, sort_order
       FROM nav_groups
       ORDER BY sort_order ASC, name ASC`
    );
    return rows.map((row, index) => ({
      ...row,
      nav_tier: index < NAV_MAIN_GROUP_LIMIT ? "main" : "more",
    }));
  });

  fastify.get("/admin/categories", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const { rows } = await pool.query(CATEGORY_LIST_SQL);
    return rows;
  });

  fastify.post("/admin/categories", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const body = request.body || {};
    const name = String(body.name || "").trim();
    const slug = String(body.slug || toSlug(name)).trim();
    const description = body.description
      ? String(body.description).trim()
      : null;
    const color = String(body.color || "#D4AF37").trim() || "#D4AF37";
    const navGroup = body.nav_group ? String(body.nav_group).trim() : null;
    const sortOrder = Number.isFinite(Number(body.sort_order))
      ? Number(body.sort_order)
      : 0;
    const active = body.active !== false;

    if (!name) {
      return reply.code(400).send({ error: "Nom requis" });
    }
    if (!slug) {
      return reply.code(400).send({ error: "Slug requis" });
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO categories (slug, name, description, color, nav_group, sort_order, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [slug, name, description, color, navGroup || null, sortOrder, active]
      );
      return reply.code(201).send(rows[0]);
    } catch (err) {
      if (err.code === "23505") {
        return reply.code(409).send({ error: "Ce slug existe déjà" });
      }
      console.error("POST /admin/categories:", err);
      return reply.code(500).send({ error: "Erreur création catégorie" });
    }
  });

  fastify.put("/admin/categories/:id", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: "ID invalide" });
    }

    const body = request.body || {};
    const fields = [];
    const values = [];
    let idx = 1;

    if (body.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(String(body.name).trim());
    }
    if (body.slug !== undefined) {
      fields.push(`slug = $${idx++}`);
      values.push(String(body.slug).trim());
    }
    if (body.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(body.description ? String(body.description).trim() : null);
    }
    if (body.color !== undefined) {
      fields.push(`color = $${idx++}`);
      values.push(String(body.color || "#D4AF37").trim() || "#D4AF37");
    }
    if (body.nav_group !== undefined) {
      fields.push(`nav_group = $${idx++}`);
      values.push(body.nav_group ? String(body.nav_group).trim() : null);
    }
    if (body.sort_order !== undefined) {
      fields.push(`sort_order = $${idx++}`);
      values.push(Number(body.sort_order) || 0);
    }
    if (body.active !== undefined) {
      fields.push(`active = $${idx++}`);
      values.push(Boolean(body.active));
    }

    if (fields.length === 0) {
      return reply.code(400).send({ error: "Aucun champ à mettre à jour" });
    }

    values.push(id);

    try {
      const { rows } = await pool.query(
        `UPDATE categories SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (!rows.length) {
        return reply.code(404).send({ error: "Catégorie introuvable" });
      }
      return rows[0];
    } catch (err) {
      if (err.code === "23505") {
        return reply.code(409).send({ error: "Ce slug existe déjà" });
      }
      console.error("PUT /admin/categories/:id:", err);
      return reply.code(500).send({ error: "Erreur mise à jour catégorie" });
    }
  });

  fastify.put("/admin/categories/:id/reorder", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const id = Number(request.params.id);
    const direction = request.body?.direction === "down" ? "down" : "up";

    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: "ID invalide" });
    }

    const { rows: currentRows } = await pool.query(
      `SELECT id, sort_order FROM categories WHERE id = $1`,
      [id]
    );
    if (!currentRows.length) {
      return reply.code(404).send({ error: "Catégorie introuvable" });
    }
    const current = currentRows[0];

    const neighborSql =
      direction === "up"
        ? `SELECT id, sort_order FROM categories
           WHERE sort_order < $1 OR (sort_order = $1 AND id < $2)
           ORDER BY sort_order DESC, id DESC LIMIT 1`
        : `SELECT id, sort_order FROM categories
           WHERE sort_order > $1 OR (sort_order = $1 AND id > $2)
           ORDER BY sort_order ASC, id ASC LIMIT 1`;

    const { rows: neighborRows } = await pool.query(neighborSql, [
      current.sort_order,
      current.id,
    ]);

    if (!neighborRows.length) {
      const { rows } = await pool.query(CATEGORY_LIST_SQL);
      return rows;
    }

    const neighbor = neighborRows[0];
    await pool.query(`UPDATE categories SET sort_order = $1 WHERE id = $2`, [
      neighbor.sort_order,
      current.id,
    ]);
    await pool.query(`UPDATE categories SET sort_order = $1 WHERE id = $2`, [
      current.sort_order,
      neighbor.id,
    ]);

    const { rows } = await pool.query(CATEGORY_LIST_SQL);
    return rows;
  });

  fastify.delete("/admin/categories/:id", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: "ID invalide" });
    }

    const { rows } = await pool.query(
      `UPDATE categories SET active = false WHERE id = $1 RETURNING *`,
      [id]
    );

    if (!rows.length) {
      return reply.code(404).send({ error: "Catégorie introuvable" });
    }

    return rows[0];
  });

  fastify.put("/admin/categories/:id/reactivate", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: "ID invalide" });
    }

    const { rows } = await pool.query(
      `UPDATE categories SET active = true WHERE id = $1 RETURNING id`,
      [id]
    );

    if (!rows.length) {
      return reply.code(404).send({ error: "Catégorie introuvable" });
    }

    return { success: true };
  });

  fastify.delete("/admin/categories/:id/permanent", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: "ID invalide" });
    }

    const { rows: catRows } = await pool.query(
      `SELECT id, slug FROM categories WHERE id = $1`,
      [id]
    );
    if (!catRows.length) {
      return reply.code(404).send({ error: "Catégorie introuvable" });
    }

    // products.category stocke le slug (pas category_id)
    const { rows: productRows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM products
       WHERE category = $1 AND active = true`,
      [catRows[0].slug]
    );
    const count = Number(productRows[0]?.count) || 0;

    if (count > 0) {
      return reply.code(400).send({
        error: `Impossible de supprimer : ${count} produit(s) actif(s) utilisent cette catégorie. Désactivez ou changez leur catégorie d'abord.`,
      });
    }

    await pool.query(`DELETE FROM categories WHERE id = $1`, [id]);
    return { success: true };
  });

  fastify.get("/admin/nav-groups", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const { rows } = await pool.query(NAV_GROUP_LIST_SQL);
    return rows.map((row, index) => ({
      ...row,
      nav_tier: index < NAV_MAIN_GROUP_LIMIT ? "main" : "more",
    }));
  });

  fastify.post("/admin/nav-groups", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const name = String(request.body?.name || "").trim();
    if (!name) {
      return reply.code(400).send({ error: "Nom requis" });
    }

    try {
      const { rows: maxRows } = await pool.query(
        `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM nav_groups`
      );
      const sortOrder = Number(maxRows[0]?.next_order) || 1;

      const { rows } = await pool.query(
        `INSERT INTO nav_groups (name, sort_order)
         VALUES ($1, $2)
         RETURNING id`,
        [name, sortOrder]
      );

      const created = await fetchNavGroupById(rows[0].id);
      return reply.code(201).send(created || { id: rows[0].id, name, category_count: 0 });
    } catch (err) {
      if (err.code === "23505") {
        return reply.code(409).send({ error: "Ce groupe existe déjà" });
      }
      console.error("POST /admin/nav-groups:", err);
      return reply.code(500).send({ error: "Erreur création groupe" });
    }
  });

  fastify.put("/admin/nav-groups/:id", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const id = Number(request.params.id);
    const name = String(request.body?.name || "").trim();

    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: "ID invalide" });
    }
    if (!name) {
      return reply.code(400).send({ error: "Nom requis" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: existing } = await client.query(
        `SELECT id, name FROM nav_groups WHERE id = $1`,
        [id]
      );
      if (!existing.length) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Groupe introuvable" });
      }

      const oldName = existing[0].name;
      if (oldName !== name) {
        await client.query(
          `UPDATE categories SET nav_group = $1 WHERE nav_group = $2`,
          [name, oldName]
        );
      }

      await client.query(`UPDATE nav_groups SET name = $1 WHERE id = $2`, [
        name,
        id,
      ]);

      await client.query("COMMIT");

      const updated = await fetchNavGroupById(id);
      return updated;
    } catch (err) {
      await client.query("ROLLBACK");
      if (err.code === "23505") {
        return reply.code(409).send({ error: "Ce nom de groupe existe déjà" });
      }
      console.error("PUT /admin/nav-groups/:id:", err);
      return reply.code(500).send({ error: "Erreur renommage groupe" });
    } finally {
      client.release();
    }
  });

  fastify.delete("/admin/nav-groups/:id", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: "ID invalide" });
    }

    const { rows: groupRows } = await pool.query(
      `SELECT id, name FROM nav_groups WHERE id = $1`,
      [id]
    );
    if (!groupRows.length) {
      return reply.code(404).send({ error: "Groupe introuvable" });
    }

    const groupName = groupRows[0].name;

    // Détache les catégories du groupe avant suppression
    await pool.query(
      `UPDATE categories SET nav_group = NULL WHERE nav_group = $1`,
      [groupName]
    );
    await pool.query(`DELETE FROM nav_groups WHERE id = $1`, [id]);
    return { ok: true };
  });

  fastify.put("/admin/nav-groups/:id/reorder", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const id = Number(request.params.id);
    const direction = request.body?.direction === "down" ? "down" : "up";

    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: "ID invalide" });
    }

    const { rows: currentRows } = await pool.query(
      `SELECT id, sort_order FROM nav_groups WHERE id = $1`,
      [id]
    );
    if (!currentRows.length) {
      return reply.code(404).send({ error: "Groupe introuvable" });
    }
    const current = currentRows[0];

    const neighborSql =
      direction === "up"
        ? `SELECT id, sort_order FROM nav_groups
           WHERE sort_order < $1 OR (sort_order = $1 AND id < $2)
           ORDER BY sort_order DESC, id DESC LIMIT 1`
        : `SELECT id, sort_order FROM nav_groups
           WHERE sort_order > $1 OR (sort_order = $1 AND id > $2)
           ORDER BY sort_order ASC, id ASC LIMIT 1`;

    const { rows: neighborRows } = await pool.query(neighborSql, [
      current.sort_order,
      current.id,
    ]);

    if (!neighborRows.length) {
      const { rows } = await pool.query(NAV_GROUP_LIST_SQL);
      return rows.map((row, index) => ({
        ...row,
        nav_tier: index < NAV_MAIN_GROUP_LIMIT ? "main" : "more",
      }));
    }

    const neighbor = neighborRows[0];
    await pool.query(`UPDATE nav_groups SET sort_order = $1 WHERE id = $2`, [
      neighbor.sort_order,
      current.id,
    ]);
    await pool.query(`UPDATE nav_groups SET sort_order = $1 WHERE id = $2`, [
      current.sort_order,
      neighbor.id,
    ]);

    const { rows } = await pool.query(NAV_GROUP_LIST_SQL);
    return rows.map((row, index) => ({
      ...row,
      nav_tier: index < NAV_MAIN_GROUP_LIMIT ? "main" : "more",
    }));
  });
}
