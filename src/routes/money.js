import { checkAdmin } from "../lib/adminAuth.js";
import { getStripe } from "../lib/stripe.js";
import { getTotpStatus, verifyTotpOrBackup } from "../lib/totp.js";

function centsToEuros(cents) {
  return Math.round(Number(cents || 0)) / 100;
}

function parseAmountToCents(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(",", ".").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function mapPayout(p) {
  return {
    id: p.id,
    amount_cents: p.amount,
    amount_euros: centsToEuros(p.amount),
    currency: p.currency,
    status: p.status,
    arrival_date: p.arrival_date
      ? new Date(p.arrival_date * 1000).toISOString()
      : null,
    created: p.created
      ? new Date(p.created * 1000).toISOString()
      : null,
    method: p.method || null,
    failure_message: p.failure_message || null,
  };
}

export default async function moneyRoutes(fastify) {
  fastify.get("/admin/money/balance", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    try {
      const stripe = getStripe();
      const balance = await stripe.balance.retrieve();
      const available = (balance.available || []).map((b) => ({
        amount_cents: b.amount,
        amount_euros: centsToEuros(b.amount),
        currency: b.currency,
      }));
      const pending = (balance.pending || []).map((b) => ({
        amount_cents: b.amount,
        amount_euros: centsToEuros(b.amount),
        currency: b.currency,
      }));
      const totp = await getTotpStatus();
      return {
        available,
        pending,
        totp_enabled: totp.enabled,
      };
    } catch (err) {
      request.log.error(err);
      const msg =
        err?.message?.includes("STRIPE_SECRET_KEY")
          ? "Stripe non configuré"
          : "Impossible de récupérer le solde";
      return reply.code(500).send({ error: msg });
    }
  });

  fastify.get("/admin/money/payouts", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    try {
      const stripe = getStripe();
      const limit = Math.min(
        50,
        Math.max(1, Number(request.query?.limit) || 20),
      );
      const list = await stripe.payouts.list({ limit });
      return {
        payouts: (list.data || []).map(mapPayout),
        has_more: Boolean(list.has_more),
      };
    } catch (err) {
      request.log.error(err);
      return reply
        .code(500)
        .send({ error: "Impossible de récupérer les virements" });
    }
  });

  fastify.post("/admin/money/payout", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;

    const body = request.body || {};
    const code = String(body.code || "").trim();
    const currency = String(body.currency || "eur").toLowerCase().trim();
    const amountCents = parseAmountToCents(body.amount);

    if (!amountCents) {
      return reply
        .code(400)
        .send({ error: "Montant invalide (minimum 0,01 €)" });
    }
    if (!code) {
      return reply
        .code(400)
        .send({ error: "Code de sécurité requis pour un virement" });
    }

    const verified = await verifyTotpOrBackup(code);
    if (!verified.ok) {
      return reply
        .code(401)
        .send({ error: verified.error || "Code incorrect" });
    }

    try {
      const stripe = getStripe();
      const balance = await stripe.balance.retrieve();
      const availableEntry = (balance.available || []).find(
        (b) => b.currency === currency,
      );
      const available = availableEntry?.amount ?? 0;
      if (amountCents > available) {
        return reply.code(400).send({
          error: `Solde disponible insuffisant (${centsToEuros(available).toFixed(2)} €)`,
        });
      }

      const payout = await stripe.payouts.create({
        amount: amountCents,
        currency,
        statement_descriptor: "Vendizi",
      });

      return {
        success: true,
        payout: mapPayout(payout),
      };
    } catch (err) {
      request.log.error(err);
      const stripeMsg =
        err?.raw?.message || err?.message || "Échec du virement";
      return reply.code(400).send({ error: stripeMsg });
    }
  });
}
