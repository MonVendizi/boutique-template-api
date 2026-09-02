import crypto from "crypto";
import pool from "../db/pool.js";
import { sendAffiliateRecapEmail } from "../lib/email.js";

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
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 50);
}

/** Attribue la commission affiliée à une commande (idempotent). */
export async function applyAffiliateCommission({
  orderId,
  affiliateCode,
  totalCents,
}) {
  const code = normalizeCode(affiliateCode);
  if (!code || !orderId) return null;

  const { rows: orderRows } = await pool.query(
    `SELECT id, affiliate_code, total_cents FROM orders WHERE id = $1`,
    [orderId]
  );
  const order = orderRows[0];
  if (!order) return null;
  if (order.affiliate_code) return null; // déjà attribué

  const amount = Math.max(
    0,
    Math.round(Number(totalCents ?? order.total_cents) || 0)
  );

  const { rows: affRows } = await pool.query(
    `SELECT * FROM affiliates WHERE code = $1 AND active = true`,
    [code]
  );
  if (!affRows.length) return null;

  const affiliate = affRows[0];
  const commission = Math.round(
    (amount * Number(affiliate.commission_percent)) / 100
  );

  await pool.query(
    `UPDATE orders
     SET affiliate_code = $1,
         affiliate_commission_cents = $2
     WHERE id = $3 AND affiliate_code IS NULL`,
    [code, commission, orderId]
  );

  await pool.query(
    `UPDATE affiliates SET
       total_orders = total_orders + 1,
       total_revenue_cents = total_revenue_cents + $1,
       total_commission_cents = total_commission_cents + $2
     WHERE code = $3`,
    [amount, commission, code]
  );

  return { code, commission };
}

export default async function affiliatesRoutes(fastify) {
  /** Enregistre un clic affilié */
  fastify.post("/affiliates/click", async (request) => {
    const code = normalizeCode(request.body?.code);
    if (!code) return { success: false };

    const { rows } = await pool.query(
      `SELECT id FROM affiliates WHERE code = $1 AND active = true`,
      [code]
    );
    if (!rows.length) return { success: false };

    const ip =
      request.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
      request.ip ||
      "";
    const ipHash = ip
      ? crypto.createHash("sha256").update(ip).digest("hex").slice(0, 64)
      : null;
    const ua = String(request.headers["user-agent"] || "").slice(0, 255);

    await pool.query(
      `INSERT INTO affiliate_clicks (affiliate_code, ip_hash, user_agent)
       VALUES ($1, $2, $3)`,
      [code, ipHash, ua || null]
    );
    await pool.query(
      `UPDATE affiliates SET total_clicks = total_clicks + 1 WHERE code = $1`,
      [code]
    );

    return { success: true };
  });

  /** Liste admin + stats globales */
  fastify.get("/admin/affiliates", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;

    const { rows } = await pool.query(
      `SELECT * FROM affiliates
       ORDER BY active DESC, total_commission_cents DESC, created_at DESC`
    );

    const stats = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE active)::int AS active_count,
         COUNT(*)::int AS total_count,
         COALESCE(SUM(total_revenue_cents), 0)::int AS total_revenue_cents,
         COALESCE(SUM(total_commission_cents - total_paid_cents), 0)::int AS commission_due_cents,
         COALESCE(SUM(total_commission_cents), 0)::int AS total_commission_cents,
         COALESCE(SUM(total_paid_cents), 0)::int AS total_paid_cents
       FROM affiliates`
    );

    return {
      affiliates: rows,
      stats: stats.rows[0],
    };
  });

  /** Créer un affilié */
  fastify.post("/admin/affiliates", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;

    const body = request.body || {};
    const name = String(body.name || "").trim().slice(0, 100);
    const email = body.email
      ? String(body.email).trim().toLowerCase().slice(0, 255)
      : null;
    let code = normalizeCode(body.code);
    if (!code && name) {
      code = normalizeCode(name.split(/\s+/)[0]);
    }
    const commissionPercent = Math.min(
      50,
      Math.max(0, Number(body.commission_percent) || 10)
    );

    if (!name || !code) {
      return reply.code(400).send({ error: "Nom et code requis" });
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO affiliates (name, email, code, commission_percent)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [name, email, code, commissionPercent]
      );
      return { success: true, affiliate: rows[0] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur";
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return reply.code(409).send({ error: "Code déjà utilisé" });
      }
      return reply.code(500).send({ error: msg });
    }
  });

  /** Modifier un affilié */
  fastify.put("/admin/affiliates/:id", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;

    const body = request.body || {};
    const name = String(body.name || "").trim().slice(0, 100);
    const email =
      body.email != null
        ? String(body.email).trim().toLowerCase().slice(0, 255) || null
        : undefined;
    const commissionPercent =
      body.commission_percent != null
        ? Math.min(50, Math.max(0, Number(body.commission_percent) || 10))
        : undefined;
    const active =
      body.active != null ? Boolean(body.active) : undefined;

    const { rows: existing } = await pool.query(
      `SELECT * FROM affiliates WHERE id = $1`,
      [request.params.id]
    );
    if (!existing.length) {
      return reply.code(404).send({ error: "Affilié introuvable" });
    }

    const current = existing[0];
    const { rows } = await pool.query(
      `UPDATE affiliates SET
         name = $1,
         email = $2,
         commission_percent = $3,
         active = $4
       WHERE id = $5
       RETURNING *`,
      [
        name || current.name,
        email !== undefined ? email : current.email,
        commissionPercent !== undefined
          ? commissionPercent
          : current.commission_percent,
        active !== undefined ? active : current.active,
        request.params.id,
      ]
    );

    return { success: true, affiliate: rows[0] };
  });

  /** Suppression définitive */
  fastify.delete("/admin/affiliates/:id", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;

    const { rowCount } = await pool.query(
      `DELETE FROM affiliates WHERE id = $1`,
      [request.params.id]
    );
    if (!rowCount) {
      return reply.code(404).send({ error: "Affilié introuvable" });
    }
    return { success: true };
  });

  /** Marquer commission payée */
  fastify.put("/admin/affiliates/:id/pay", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;

    const amountCents = Math.max(
      0,
      Math.round(Number(request.body?.amount_cents) || 0)
    );
    if (!amountCents) {
      return reply.code(400).send({ error: "amount_cents requis" });
    }

    const { rows } = await pool.query(
      `UPDATE affiliates
       SET total_paid_cents = total_paid_cents + $1
       WHERE id = $2
       RETURNING *`,
      [amountCents, request.params.id]
    );
    if (!rows.length) {
      return reply.code(404).send({ error: "Affilié introuvable" });
    }

    // Marque les commandes non payées de cet affilié jusqu'à concurrence
    await pool.query(
      `UPDATE orders
       SET commission_paid = true
       WHERE affiliate_code = $1
         AND commission_paid = false
         AND affiliate_commission_cents > 0`,
      [rows[0].code]
    );

    return { success: true, affiliate: rows[0] };
  });

  /** Envoyer récapitulatif email */
  fastify.post("/admin/affiliates/:id/recap", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;

    const { rows } = await pool.query(
      `SELECT * FROM affiliates WHERE id = $1`,
      [request.params.id]
    );
    if (!rows.length) {
      return reply.code(404).send({ error: "Affilié introuvable" });
    }
    const aff = rows[0];
    if (!aff.email) {
      return reply.code(400).send({ error: "Aucun email pour cet affilié" });
    }

    const month = new Date().toLocaleDateString("fr-FR", {
      month: "long",
      year: "numeric",
    });
    const due = Math.max(
      0,
      Number(aff.total_commission_cents) - Number(aff.total_paid_cents)
    );

    try {
      await sendAffiliateRecapEmail({
        email: aff.email,
        name: aff.name,
        month,
        clicks: aff.total_clicks,
        orders: aff.total_orders,
        revenueCents: aff.total_revenue_cents,
        commissionDueCents: due,
        commissionPaidCents: aff.total_paid_cents,
        code: aff.code,
      });
      return { success: true };
    } catch (err) {
      console.error("Email récap affilié:", err);
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Erreur email",
      });
    }
  });
}
