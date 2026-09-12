import pool from "../db/pool.js";
import {
  sendReferralInviteEmail,
  sendReferralRewardEmail,
} from "../lib/email.js";
import { checkAdmin } from "../lib/adminAuth.js";

export function normalizeReferralCode(code) {
  return String(code || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 50);
}

export function generateReferralCode(customerName, email) {
  const fromName = customerName
    ?.split(" ")[0]
    ?.toLowerCase()
    ?.normalize("NFD")
    ?.replace(/[\u0300-\u036f]/g, "")
    ?.replace(/[^a-z0-9]/g, "");

  const fromEmail = email
    ?.split("@")[0]
    ?.toLowerCase()
    ?.normalize("NFD")
    ?.replace(/[\u0300-\u036f]/g, "")
    ?.replace(/[^a-z0-9]/g, "");

  const base = fromName || fromEmail || "tina";
  const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${base}-${suffix}`.substring(0, 20);
}

export async function getReferralConfig() {
  const { rows } = await pool.query(
    `SELECT active, referrer_discount_percent, referee_discount_percent, cookie_days
     FROM referral_config WHERE id = 1`
  );
  return (
    rows[0] || {
      active: false,
      referrer_discount_percent: 10,
      referee_discount_percent: 10,
      cookie_days: 30,
    }
  );
}

/** Crée un code parrainage pour une cliente (idempotent par email). */
export async function createReferralForCustomer({ email, customerName }) {
  const config = await getReferralConfig();
  if (!config.active) return null;

  const referrerEmail = String(email || "")
    .trim()
    .toLowerCase();
  if (!referrerEmail) return null;

  const { rows: existing } = await pool.query(
    `SELECT referral_code, status FROM referrals
     WHERE referrer_email = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [referrerEmail]
  );
  if (existing.length && existing[0].status === "pending") {
    return existing[0].referral_code;
  }

  let code = generateReferralCode(customerName, referrerEmail);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await pool.query(
        `INSERT INTO referrals (referrer_email, referrer_name, referral_code)
         VALUES ($1, $2, $3)`,
        [
          referrerEmail,
          customerName ? String(customerName).trim().slice(0, 100) : null,
          code,
        ]
      );
      return code;
    } catch (err) {
      if (err.code === "23505") {
        code = generateReferralCode(customerName, referrerEmail);
        continue;
      }
      throw err;
    }
  }
  return null;
}

/** Calcule la réduction filleule si le code est valide. */
export async function computeReferralDiscount(subtotalCents, code) {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return { valid: false, discount_cents: 0 };

  const config = await getReferralConfig();
  if (!config.active) {
    return { valid: false, error: "Programme de parrainage inactif" };
  }

  const { rows } = await pool.query(
    `SELECT id, referrer_email, status FROM referrals WHERE referral_code = $1`,
    [normalized]
  );
  if (!rows.length) {
    return { valid: false, error: "Code parrainage invalide" };
  }

  const percent = Math.max(
    0,
    Math.min(100, Number(config.referee_discount_percent) || 0)
  );
  const discountCents = Math.round(
    (Math.max(0, Number(subtotalCents) || 0) * percent) / 100
  );

  return {
    valid: true,
    discount_cents: discountCents,
    referral_code: normalized,
    referee_discount_percent: percent,
  };
}

/** Marque une conversion et récompense la marraine. */
export async function convertReferral({ code, orderId, refereeEmail }) {
  const normalized = normalizeReferralCode(code);
  if (!normalized || !orderId) return null;

  const refereeNorm = String(refereeEmail || "")
    .trim()
    .toLowerCase();
  if (!refereeNorm) return null;

  const config = await getReferralConfig();
  if (!config.active) return null;

  const { rows: refRows } = await pool.query(
    `SELECT * FROM referrals
     WHERE referral_code = $1
     LIMIT 1`,
    [normalized]
  );
  const referral = refRows[0];
  if (!referral) return null;

  if (
    referral.referrer_email &&
    referral.referrer_email.toLowerCase() === refereeNorm
  ) {
    return null;
  }

  if (referral.status === "converted") {
    return referral;
  }

  const { rows: updated } = await pool.query(
    `UPDATE referrals SET
       status = 'converted',
       referee_email = $1,
       referee_order_id = $2,
       converted_at = NOW()
     WHERE referral_code = $3
       AND status = 'pending'
     RETURNING *`,
    [refereeNorm, orderId, normalized]
  );

  if (!updated.length) return null;

  const row = updated[0];
  const referrerPercent = Math.max(
    0,
    Math.min(100, Number(config.referrer_discount_percent) || 10)
  );
  const referrerPromoCode = `MERCI-${normalized.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 8)}`;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await pool.query(
    `INSERT INTO promo_codes (code, type, value, max_uses, active, expires_at, internal_note)
     VALUES ($1, 'percent', $2, 1, true, $3, 'Code parrainage généré automatiquement')
     ON CONFLICT (code) DO NOTHING`,
    [referrerPromoCode, referrerPercent, expiresAt]
  );

  await pool.query(
    `UPDATE referrals SET
       referrer_discount_code = $1,
       referrer_discount_sent = true
     WHERE id = $2`,
    [referrerPromoCode, row.id]
  );

  try {
    await sendReferralRewardEmail({
      email: row.referrer_email,
      customerName: row.referrer_name,
      referrerPromoCode,
      discountPercent: referrerPercent,
    });
  } catch (err) {
    console.error("Email récompense parrainage échoué:", err);
  }

  return row;
}

export default async function referralsRoutes(fastify) {
  fastify.get("/referral/config", async () => {
    const config = await getReferralConfig();
    return {
      active: Boolean(config.active),
      referee_discount_percent: Number(config.referee_discount_percent) || 10,
      referrer_discount_percent: Number(config.referrer_discount_percent) || 10,
      cookie_days: Number(config.cookie_days) || 30,
    };
  });

  /** Calcule la réduction filleule (utilisé par checkout / PaymentIntent) */
  fastify.post("/referral/discount", async (request, reply) => {
    const code = request.body?.code || request.body?.referral_code;
    const cartTotal = Number(
      request.body?.cart_total_cents ?? request.body?.subtotal_cents ?? 0
    );
    const result = await computeReferralDiscount(cartTotal, code);
    if (!result.valid) {
      return reply.code(400).send({
        valid: false,
        error: result.error || "Code parrainage invalide",
        discount_cents: 0,
      });
    }
    return {
      valid: true,
      discount_cents: result.discount_cents,
      referral_code: result.referral_code,
      referee_discount_percent: result.referee_discount_percent,
    };
  });

  fastify.get("/referral/my-code", async (request, reply) => {
    const email = String(request.query?.email || "")
      .trim()
      .toLowerCase();
    if (!email) {
      return reply.code(400).send({ error: "email requis" });
    }

    const config = await getReferralConfig();
    if (!config.active) {
      return { active: false, referral_code: null };
    }

    const { rows } = await pool.query(
      `SELECT referral_code FROM referrals
       WHERE referrer_email = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [email]
    );

    return {
      active: true,
      referral_code: rows[0]?.referral_code || null,
    };
  });

  fastify.post("/referral/register", async (request) => {
    const code = normalizeReferralCode(request.body?.code);
    if (!code) return { success: false };

    const config = await getReferralConfig();
    if (!config.active) return { success: false };

    const { rows } = await pool.query(
      `SELECT id, referee_email FROM referrals WHERE referral_code = $1`,
      [code]
    );
    if (!rows.length) return { success: false };

    const refereeEmail = String(request.body?.referee_email || "")
      .trim()
      .toLowerCase();
    if (refereeEmail && !rows[0].referee_email) {
      await pool.query(
        `UPDATE referrals SET referee_email = $1
         WHERE id = $2 AND referee_email IS NULL`,
        [refereeEmail, rows[0].id]
      );
    }

    return { success: true };
  });

  fastify.post("/referral/convert", async (request, reply) => {
    const code = normalizeReferralCode(request.body?.code);
    const orderId = request.body?.order_id;
    const refereeEmail = request.body?.referee_email;

    if (!code || !orderId || !refereeEmail) {
      return reply
        .code(400)
        .send({ error: "code, order_id et referee_email requis" });
    }

    const result = await convertReferral({
      code,
      orderId,
      refereeEmail,
    });

    if (!result) {
      return reply.code(404).send({ error: "Conversion impossible" });
    }

    return { success: true, referral: result };
  });

  fastify.get("/admin/referral/config", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    const { rows } = await pool.query(`SELECT * FROM referral_config WHERE id = 1`);
    return rows[0] || { id: 1, active: false };
  });

  fastify.put("/admin/referral/config", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    const body = request.body || {};

    const { rows } = await pool.query(
      `UPDATE referral_config SET
         active = COALESCE($1, active),
         referrer_discount_percent = COALESCE($2, referrer_discount_percent),
         referee_discount_percent = COALESCE($3, referee_discount_percent),
         cookie_days = COALESCE($4, cookie_days),
         updated_at = NOW()
       WHERE id = 1
       RETURNING *`,
      [
        body.active !== undefined ? Boolean(body.active) : null,
        body.referrer_discount_percent !== undefined
          ? Math.max(0, Math.min(100, Math.round(Number(body.referrer_discount_percent))))
          : null,
        body.referee_discount_percent !== undefined
          ? Math.max(0, Math.min(100, Math.round(Number(body.referee_discount_percent))))
          : null,
        body.cookie_days !== undefined
          ? Math.max(1, Math.round(Number(body.cookie_days)))
          : null,
      ]
    );

    return rows[0];
  });

  fastify.get("/admin/referrals", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;

    const { rows: referrals } = await pool.query(
      `SELECT r.*, o.total_cents AS order_total_cents
       FROM referrals r
       LEFT JOIN orders o ON o.id = r.referee_order_id
       ORDER BY r.created_at DESC`
    );

    const { rows: statsRows } = await pool.query(
      `SELECT
         COUNT(*)::int AS total_initiated,
         COUNT(*) FILTER (WHERE r.status = 'converted')::int AS total_converted,
         COALESCE(SUM(o.total_cents) FILTER (WHERE r.status = 'converted'), 0)::int AS revenue_cents,
         COUNT(*) FILTER (WHERE r.referrer_discount_sent = true)::int AS total_rewards_sent
       FROM referrals r
       LEFT JOIN orders o ON o.id = r.referee_order_id`
    );

    return {
      referrals,
      stats: statsRows[0] || {
        total_initiated: 0,
        total_converted: 0,
        revenue_cents: 0,
        total_rewards_sent: 0,
      },
    };
  });
}
