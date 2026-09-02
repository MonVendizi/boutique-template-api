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

function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

/** @returns {{ valid: true, type: string, value: number, discount_cents: number, code: string } | { valid: false, error: string }} */
export function computePromoDiscount(row, cartTotalCents) {
  if (!row) {
    return { valid: false, error: "Code invalide" };
  }
  if (!row.active) {
    return { valid: false, error: "Code invalide" };
  }
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return { valid: false, error: "Code expiré" };
  }
  if (
    row.max_uses != null &&
    Number(row.uses_count) >= Number(row.max_uses)
  ) {
    return { valid: false, error: "Code épuisé" };
  }

  const cart = Math.max(0, Math.round(Number(cartTotalCents) || 0));
  const minOrder = Math.max(0, Number(row.min_order_cents) || 0);
  if (cart < minOrder) {
    return { valid: false, error: "Commande minimum non atteinte" };
  }

  const value = Number(row.value);
  let discountCents = 0;
  if (row.type === "percent") {
    discountCents = Math.round((cart * value) / 100);
  } else if (row.type === "fixed") {
    discountCents = Math.round(value * 100);
  } else {
    return { valid: false, error: "Code invalide" };
  }

  discountCents = Math.min(discountCents, cart);
  if (discountCents <= 0) {
    return { valid: false, error: "Code invalide" };
  }

  return {
    valid: true,
    type: row.type,
    value,
    discount_cents: discountCents,
    code: row.code,
  };
}

export async function loadPromoByCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const { rows } = await pool.query(
    `SELECT * FROM promo_codes WHERE code = $1`,
    [normalized]
  );
  return rows[0] || null;
}

export default async function promoRoutes(fastify) {
  fastify.post("/promo/validate", async (request, reply) => {
    const body = request.body || {};
    const code = normalizeCode(body.code);
    const cartTotalCents = Number(body.cart_total_cents);

    if (!code) {
      return reply.code(400).send({
        valid: false,
        error: "Code invalide",
      });
    }

    if (!Number.isFinite(cartTotalCents) || cartTotalCents < 0) {
      return reply.code(400).send({
        valid: false,
        error: "Montant panier invalide",
      });
    }

    try {
      const row = await loadPromoByCode(code);
      const result = computePromoDiscount(row, cartTotalCents);
      if (!result.valid) {
        return { valid: false, error: result.error };
      }
      return {
        valid: true,
        type: result.type,
        value: result.value,
        discount_cents: result.discount_cents,
        code: result.code,
      };
    } catch (err) {
      console.error("POST /promo/validate:", err);
      return reply.code(500).send({ valid: false, error: "Erreur serveur" });
    }
  });

  fastify.get("/admin/promo", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const { rows } = await pool.query(
      `SELECT * FROM promo_codes ORDER BY created_at DESC`
    );
    return rows;
  });

  fastify.post("/admin/promo", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const body = request.body || {};
    const code = normalizeCode(body.code);
    const type = body.type === "fixed" ? "fixed" : body.type === "percent" ? "percent" : null;
    const value = Number(body.value);
    const minOrderCents =
      body.min_order_cents != null
        ? Math.max(0, Math.round(Number(body.min_order_cents)))
        : body.min_order_euros != null
          ? Math.max(0, Math.round(Number(body.min_order_euros) * 100))
          : 0;
    const maxUses =
      body.max_uses === "" || body.max_uses == null
        ? null
        : Math.max(1, Math.round(Number(body.max_uses)));
    const active = body.active !== false && body.active !== "false";
    const expiresAt = body.expires_at ? new Date(body.expires_at) : null;
    const internalNote =
      body.internal_note != null
        ? String(body.internal_note).trim() || null
        : null;

    if (!code || code.length > 50) {
      return reply.code(400).send({ error: "Code requis (max 50 caractères)" });
    }
    if (!type) {
      return reply.code(400).send({ error: "Type invalide" });
    }
    if (!Number.isFinite(value) || value <= 0) {
      return reply.code(400).send({ error: "Valeur invalide" });
    }
    if (type === "percent" && value > 100) {
      return reply.code(400).send({ error: "Pourcentage max 100 %" });
    }
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      return reply.code(400).send({ error: "Date d'expiration invalide" });
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO promo_codes
          (code, type, value, min_order_cents, max_uses, active, expires_at, internal_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          code,
          type,
          value,
          minOrderCents,
          maxUses,
          active,
          expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
          internalNote,
        ]
      );
      return reply.code(201).send(rows[0]);
    } catch (err) {
      if (err.code === "23505") {
        return reply.code(409).send({ error: "Ce code existe déjà" });
      }
      console.error("POST /admin/promo:", err);
      return reply.code(500).send({ error: "Erreur création code promo" });
    }
  });

  fastify.put("/admin/promo/:id", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: "ID invalide" });
    }

    const body = request.body || {};
    const fields = [];
    const values = [];
    let i = 1;

    if (body.active !== undefined) {
      fields.push(`active = $${i++}`);
      values.push(Boolean(body.active));
    }
    if (body.expires_at !== undefined) {
      fields.push(`expires_at = $${i++}`);
      if (body.expires_at === null || body.expires_at === "") {
        values.push(null);
      } else {
        const d = new Date(body.expires_at);
        if (Number.isNaN(d.getTime())) {
          return reply.code(400).send({ error: "Date d'expiration invalide" });
        }
        values.push(d);
      }
    }
    if (body.max_uses !== undefined) {
      fields.push(`max_uses = $${i++}`);
      values.push(
        body.max_uses === null || body.max_uses === ""
          ? null
          : Math.max(1, Math.round(Number(body.max_uses)))
      );
    }
    if (body.min_order_cents !== undefined) {
      fields.push(`min_order_cents = $${i++}`);
      values.push(Math.max(0, Math.round(Number(body.min_order_cents))));
    }
    if (body.value !== undefined) {
      const v = Number(body.value);
      if (!Number.isFinite(v) || v <= 0) {
        return reply.code(400).send({ error: "Valeur invalide" });
      }
      fields.push(`value = $${i++}`);
      values.push(v);
    }
    if (body.internal_note !== undefined) {
      fields.push(`internal_note = $${i++}`);
      values.push(
        body.internal_note === null || body.internal_note === ""
          ? null
          : String(body.internal_note).trim()
      );
    }

    if (fields.length === 0) {
      return reply.code(400).send({ error: "Aucun champ à modifier" });
    }

    values.push(id);
    try {
      const { rows } = await pool.query(
        `UPDATE promo_codes SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
        values
      );
      if (!rows[0]) {
        return reply.code(404).send({ error: "Code introuvable" });
      }
      return rows[0];
    } catch (err) {
      console.error("PUT /admin/promo:", err);
      return reply.code(500).send({ error: "Erreur mise à jour" });
    }
  });

  fastify.delete("/admin/promo/:id", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: "ID invalide" });
    }
    const { rowCount } = await pool.query(
      `DELETE FROM promo_codes WHERE id = $1`,
      [id]
    );
    if (!rowCount) {
      return reply.code(404).send({ error: "Code introuvable" });
    }
    return { ok: true };
  });
}
