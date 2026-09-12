import pool from "../db/pool.js";
import {
  sendLoyaltyRewardEmail,
} from "../lib/email.js";
import { checkAdmin } from "../lib/adminAuth.js";

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function randomLoyaltySuffix(len = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export async function getLoyaltyConfig() {
  const { rows } = await pool.query(
    `SELECT * FROM loyalty_config WHERE id = 1`
  );
  if (rows[0]) return rows[0];
  const inserted = await pool.query(
    `INSERT INTO loyalty_config (id, active) VALUES (1, false)
     ON CONFLICT (id) DO NOTHING
     RETURNING *`
  );
  if (inserted.rows[0]) return inserted.rows[0];
  const again = await pool.query(`SELECT * FROM loyalty_config WHERE id = 1`);
  return again.rows[0];
}

/** Attribue des points après une commande payée. Retourne null si inactif. */
export async function awardLoyaltyPoints({
  email,
  customerName,
  totalCents,
}) {
  const config = await getLoyaltyConfig();
  if (!config?.active) return null;

  const emailNorm = normalizeEmail(email);
  if (!emailNorm) return null;

  const totalEuros = Math.floor(Number(totalCents || 0) / 100);
  const pointsPerEuro = Math.max(1, Number(config.points_per_euro) || 1);
  const pointsEarned = pointsPerEuro * totalEuros;
  if (pointsEarned <= 0) return null;

  const name = customerName
    ? String(customerName).trim().slice(0, 100)
    : null;

  const { rows } = await pool.query(
    `INSERT INTO loyalty_points (email, customer_name, points, total_earned, updated_at)
     VALUES ($1, $2, $3, $3, NOW())
     ON CONFLICT (email) DO UPDATE SET
       customer_name = COALESCE(EXCLUDED.customer_name, loyalty_points.customer_name),
       points = loyalty_points.points + EXCLUDED.points,
       total_earned = loyalty_points.total_earned + EXCLUDED.total_earned,
       updated_at = NOW()
     RETURNING *`,
    [emailNorm, name, pointsEarned]
  );

  return {
    pointsEarned,
    totalPoints: rows[0].points,
    pointsForReward: Number(config.points_for_reward) || 100,
    config,
    row: rows[0],
  };
}

export default async function loyaltyRoutes(fastify) {
  /** Config publique (sans détails admin inutiles) */
  fastify.get("/loyalty/config", async () => {
    const config = await getLoyaltyConfig();
    return {
      active: Boolean(config?.active),
      points_per_euro: Number(config?.points_per_euro) || 1,
      points_for_reward: Number(config?.points_for_reward) || 100,
      reward_cents: Number(config?.reward_cents) || 500,
      reward_expiry_days: Number(config?.reward_expiry_days) || 30,
    };
  });

  /** Solde points client */
  fastify.get("/loyalty/:email", async (request, reply) => {
    const email = normalizeEmail(request.params.email);
    if (!email || !email.includes("@")) {
      return reply.code(400).send({ error: "Email invalide" });
    }

    const config = await getLoyaltyConfig();
    const { rows } = await pool.query(
      `SELECT email, customer_name, points, total_earned, total_redeemed, updated_at
       FROM loyalty_points WHERE email = $1`,
      [email]
    );

    const row = rows[0] || {
      email,
      customer_name: null,
      points: 0,
      total_earned: 0,
      total_redeemed: 0,
      updated_at: null,
    };

    return {
      ...row,
      points_for_reward: Number(config?.points_for_reward) || 100,
      reward_cents: Number(config?.reward_cents) || 500,
      active: Boolean(config?.active),
    };
  });

  /** Échange points → code promo */
  fastify.post("/loyalty/redeem", async (request, reply) => {
    const email = normalizeEmail(request.body?.email);
    if (!email || !email.includes("@")) {
      return reply.code(400).send({ error: "Email invalide" });
    }

    const config = await getLoyaltyConfig();
    if (!config?.active) {
      return reply.code(400).send({ error: "Programme fidélité inactif" });
    }

    const pointsNeeded = Math.max(1, Number(config.points_for_reward) || 100);
    const rewardCents = Math.max(100, Number(config.reward_cents) || 500);
    const expiryDays = Math.max(7, Number(config.reward_expiry_days) || 30);
    const rewardEuros = rewardCents / 100;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `SELECT * FROM loyalty_points WHERE email = $1 FOR UPDATE`,
        [email]
      );
      const account = rows[0];
      if (!account || Number(account.points) < pointsNeeded) {
        await client.query("ROLLBACK");
        return reply.code(400).send({
          error: "Points insuffisants",
          points: account?.points || 0,
          required: pointsNeeded,
        });
      }

      let code;
      for (let attempt = 0; attempt < 8; attempt++) {
        code = `FIDELITE-${randomLoyaltySuffix(5)}`;
        const exists = await client.query(
          `SELECT 1 FROM promo_codes WHERE code = $1`,
          [code]
        );
        if (exists.rows.length === 0) break;
        code = null;
      }
      if (!code) {
        await client.query("ROLLBACK");
        return reply.code(500).send({ error: "Impossible de générer un code" });
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiryDays);

      await client.query(
        `INSERT INTO promo_codes
          (code, type, value, min_order_cents, max_uses, active, expires_at)
         VALUES ($1, 'fixed', $2, 0, 1, true, $3)`,
        [code, rewardEuros, expiresAt]
      );

      const { rows: updated } = await client.query(
        `UPDATE loyalty_points
         SET points = points - $1,
             total_redeemed = total_redeemed + $1,
             updated_at = NOW()
         WHERE email = $2
         RETURNING *`,
        [pointsNeeded, email]
      );

      await client.query("COMMIT");

      try {
        await sendLoyaltyRewardEmail({
          email,
          customerName: updated[0].customer_name,
          code,
          rewardEuros,
          expiryDays,
        });
      } catch (emailErr) {
        console.error("Email bon fidélité échoué:", emailErr);
      }

      return {
        success: true,
        code,
        reward_cents: rewardCents,
        reward_euros: rewardEuros,
        points_remaining: updated[0].points,
        expires_at: expiresAt.toISOString(),
      };
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("POST /loyalty/redeem:", err);
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Erreur échange",
      });
    } finally {
      client.release();
    }
  });

  /** Admin — liste clients */
  fastify.get("/admin/loyalty", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;

    const { rows } = await pool.query(
      `SELECT id, email, customer_name, points, total_earned, total_redeemed,
              created_at, updated_at
       FROM loyalty_points
       ORDER BY points DESC, updated_at DESC
       LIMIT 500`
    );

    const stats = await pool.query(
      `SELECT
         COUNT(*)::int AS total_clients,
         COALESCE(SUM(total_earned), 0)::int AS total_points_earned,
         COALESCE(SUM(total_redeemed), 0)::int AS total_points_redeemed,
         COALESCE(SUM(points), 0)::int AS total_points_balance
       FROM loyalty_points`
    );

    const rewards = await pool.query(
      `SELECT COUNT(*)::int AS total_rewards
       FROM promo_codes
       WHERE code LIKE 'FIDELITE-%'`
    );

    return {
      clients: rows,
      stats: {
        ...stats.rows[0],
        total_rewards: rewards.rows[0]?.total_rewards || 0,
      },
    };
  });

  /** Admin — config complète */
  fastify.get("/admin/loyalty/config", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    return getLoyaltyConfig();
  });

  /** Admin — modifier config */
  fastify.put("/admin/loyalty/config", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;

    const body = request.body || {};
    const active = Boolean(body.active);
    const pointsPerEuro = Math.min(
      10,
      Math.max(1, Math.round(Number(body.points_per_euro) || 1))
    );
    const pointsForReward = Math.max(
      10,
      Math.round(Number(body.points_for_reward) || 100)
    );
    const rewardCents = Math.max(
      100,
      Math.round(Number(body.reward_cents) || 500)
    );
    const rewardExpiryDays = Math.min(
      365,
      Math.max(7, Math.round(Number(body.reward_expiry_days) || 30))
    );

    const { rows } = await pool.query(
      `INSERT INTO loyalty_config (
         id, active, points_per_euro, points_for_reward, reward_cents, reward_expiry_days, updated_at
       ) VALUES (1, $1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id) DO UPDATE SET
         active = EXCLUDED.active,
         points_per_euro = EXCLUDED.points_per_euro,
         points_for_reward = EXCLUDED.points_for_reward,
         reward_cents = EXCLUDED.reward_cents,
         reward_expiry_days = EXCLUDED.reward_expiry_days,
         updated_at = NOW()
       RETURNING *`,
      [active, pointsPerEuro, pointsForReward, rewardCents, rewardExpiryDays]
    );

    return rows[0];
  });

  /** Admin — ajouter points manuellement */
  fastify.post("/admin/loyalty/add", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;

    const body = request.body || {};
    const email = normalizeEmail(body.email);
    const points = Math.round(Number(body.points) || 0);
    const reason = String(body.reason || "").trim().slice(0, 200);

    if (!email || !email.includes("@")) {
      return reply.code(400).send({ error: "Email invalide" });
    }
    if (!points || points === 0) {
      return reply.code(400).send({ error: "Points invalides" });
    }

    const { rows } = await pool.query(
      `INSERT INTO loyalty_points (email, points, total_earned, updated_at)
       VALUES ($1, GREATEST(0, $2), GREATEST(0, $2), NOW())
       ON CONFLICT (email) DO UPDATE SET
         points = GREATEST(0, loyalty_points.points + $2),
         total_earned = CASE
           WHEN $2 > 0 THEN loyalty_points.total_earned + $2
           ELSE loyalty_points.total_earned
         END,
         updated_at = NOW()
       RETURNING *`,
      [email, points]
    );

    console.log(
      `Loyalty admin +${points} → ${email}${reason ? ` (${reason})` : ""}`
    );

    return { success: true, client: rows[0], reason: reason || null };
  });
}
