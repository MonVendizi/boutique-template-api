import { getStripe } from "../lib/stripe.js";
import pool from "../db/pool.js";
import {
  sendOrderConfirmationEmail,
  sendLoyaltyPointsEmail,
  sendAdminOrderNotification,
} from "../lib/email.js";
import { awardLoyaltyPoints } from "./loyalty.js";
import { applyAffiliateCommission } from "./affiliates.js";
import { convertReferral } from "./referrals.js";
import { sendSMS } from "../lib/sms.js";

const FRONTEND_URL = process.env.FRONTEND_URL || "https://maboutique.fr";
const BRAND_NAME = process.env.BRAND_NAME || "Ma Boutique";

async function fulfillOrderRecord({
  stripeSessionId,
  stripePaymentIntentId,
  metadataItems,
  totalCents,
  currency,
  customerEmail,
  customerName,
  shippingAddress,
  promoCode,
  discountCents = 0,
  shippingCents = 490,
  affiliateCode = null,
  referralCode = null,
}) {
  const existing = await pool.query(
    `SELECT id, total_cents, affiliate_code FROM orders
     WHERE stripe_session_id = $1
        OR ($2::text IS NOT NULL AND stripe_payment_intent_id = $2)`,
    [stripeSessionId, stripePaymentIntentId || null]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  if (!metadataItems.length) {
    throw new Error("Aucun article dans les métadonnées");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const item of metadataItems) {
      const { rows } = await client.query(
        "SELECT stock FROM products WHERE id = $1 FOR UPDATE",
        [item.product_id]
      );

      if (rows.length === 0) {
        throw new Error(`Produit ${item.product_id} introuvable`);
      }

      if (rows[0].stock < item.quantity) {
        throw new Error(`Stock insuffisant pour ${item.slug}`);
      }
    }

    const code = String(promoCode || "")
      .trim()
      .toUpperCase();

    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (
        stripe_session_id, stripe_payment_intent_id, status,
        customer_email, customer_name, items, total_cents, currency, shipping_address,
        promo_code, discount_cents, shipping_cents
      ) VALUES ($1, $2, 'paid', $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9, $10, $11)
      RETURNING *`,
      [
        stripeSessionId,
        stripePaymentIntentId,
        customerEmail,
        customerName,
        JSON.stringify(metadataItems),
        totalCents,
        currency || "eur",
        shippingAddress ? JSON.stringify(shippingAddress) : null,
        code || null,
        Math.max(0, Math.round(Number(discountCents) || 0)),
        Math.max(0, Math.round(Number(shippingCents) || 490)),
      ]
    );

    const order = orderRows[0];

    for (const item of metadataItems) {
      await client.query(
        "UPDATE products SET stock = stock - $1 WHERE id = $2",
        [item.quantity, item.product_id]
      );

      await client.query(
        `INSERT INTO stock_movements (product_id, order_id, quantity_change, reason)
         VALUES ($1, $2, $3, 'order')`,
        [item.product_id, order.id, -item.quantity]
      );
    }

    if (code) {
      await client.query(
        `UPDATE promo_codes
         SET uses_count = uses_count + 1
         WHERE code = $1`,
        [code]
      );
    }

    const emailNorm = String(customerEmail || "")
      .trim()
      .toLowerCase();
    if (emailNorm) {
      await client.query(
        `UPDATE abandoned_carts
         SET converted = true, updated_at = NOW()
         WHERE email = $1`,
        [emailNorm]
      );
    }

    await client.query("COMMIT");

    try {
      await applyAffiliateCommission({
        orderId: order.id,
        affiliateCode:
          affiliateCode || null,
        totalCents: order.total_cents,
      });
    } catch (affErr) {
      console.error("Commission affiliée échouée:", affErr);
    }

    const refCode = String(referralCode || "").trim();
    if (refCode) {
      try {
        await convertReferral({
          code: refCode,
          orderId: order.id,
          refereeEmail: order.customer_email,
        });
      } catch (refErr) {
        console.error("Conversion parrainage échouée:", refErr);
      }
    }

    let loyaltyInfo = null;
    try {
      loyaltyInfo = await awardLoyaltyPoints({
        email: order.customer_email,
        customerName: order.customer_name,
        totalCents: order.total_cents,
      });
    } catch (loyaltyErr) {
      console.error("Attribution points fidélité échouée:", loyaltyErr);
    }

    try {
      await sendOrderConfirmationEmail({
        email: order.customer_email,
        orderId: order.id,
        items: order.items || metadataItems,
        total: order.total_cents,
        customerName: order.customer_name,
        currency: order.currency,
        loyalty: loyaltyInfo
          ? {
              pointsEarned: loyaltyInfo.pointsEarned,
              totalPoints: loyaltyInfo.totalPoints,
              pointsForReward: loyaltyInfo.pointsForReward,
            }
          : null,
      });
    } catch (emailErr) {
      console.error("Email de confirmation échoué (commande créée):", emailErr);
    }

    if (loyaltyInfo) {
      try {
        await sendLoyaltyPointsEmail({
          email: order.customer_email,
          customerName: order.customer_name,
          pointsEarned: loyaltyInfo.pointsEarned,
          totalPoints: loyaltyInfo.totalPoints,
          pointsForReward: loyaltyInfo.pointsForReward,
        });
      } catch (loyaltyEmailErr) {
        console.error("Email points fidélité échoué:", loyaltyEmailErr);
      }
    }

    try {
      const totalEuros = (order.total_cents / 100).toFixed(2);
      const adminHost = FRONTEND_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
      await sendSMS(
        `${BRAND_NAME} : Nouvelle commande ! ${totalEuros}EUR - ${order.customer_name || order.customer_email}. Admin : ${adminHost}/admin`
      );
    } catch (smsErr) {
      console.error("SMS nouvelle commande échoué:", smsErr);
    }

    await sendAdminOrderNotification({
      orderId: order.id,
      customerEmail: order.customer_email,
      customerName: order.customer_name,
      totalCents: order.total_cents,
      items: order.items || metadataItems,
    }).catch(() => {});

    return order;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function fulfillOrder(session) {
  const metadataItems = JSON.parse(session.metadata?.items || "[]");
  const discountCents = Number(session.metadata?.discount_cents || 0);
  const shippingCents = Number(session.metadata?.shipping_cents || 490);
  const totalCents =
    typeof session.amount_total === "number"
      ? session.amount_total
      : Math.max(
          0,
          metadataItems.reduce(
            (sum, item) => sum + item.unit_price_cents * item.quantity,
            0
          ) -
            discountCents +
            shippingCents
        );

  const shippingAddress = session.shipping_details?.address
    ? {
        name: session.shipping_details.name,
        line1: session.shipping_details.address.line1,
        line2: session.shipping_details.address.line2,
        city: session.shipping_details.address.city,
        postal_code: session.shipping_details.address.postal_code,
        country: session.shipping_details.address.country,
      }
    : null;

  return fulfillOrderRecord({
    stripeSessionId: session.id,
    stripePaymentIntentId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null,
    metadataItems,
    totalCents,
    currency: session.currency || "eur",
    customerEmail:
      session.customer_details?.email || session.customer_email || null,
    customerName: session.customer_details?.name || null,
    shippingAddress,
    promoCode: session.metadata?.promo_code,
    discountCents,
    shippingCents,
    affiliateCode: session.metadata?.affiliate_code || null,
    referralCode: session.metadata?.referral_code || null,
  });
}

export async function fulfillPaymentIntent(pi, extras = {}) {
  const metadataItems = JSON.parse(pi.metadata?.items || "[]");
  const shippingCents = Number(pi.metadata?.shipping_cents || 490);
  const discountCents = Number(pi.metadata?.discount_cents || 0);
  const subtotal =
    Number(pi.metadata?.subtotal_cents) ||
    metadataItems.reduce(
      (sum, item) => sum + item.unit_price_cents * item.quantity,
      0
    );

  const totalCents =
    typeof pi.amount_received === "number" && pi.amount_received > 0
      ? pi.amount_received
      : typeof pi.amount === "number"
        ? pi.amount
        : Math.max(0, subtotal - discountCents + shippingCents);

  return fulfillOrderRecord({
    stripeSessionId: pi.id,
    stripePaymentIntentId: pi.id,
    metadataItems,
    totalCents,
    currency: pi.currency || "eur",
    customerEmail: extras.customer_email || pi.receipt_email || null,
    customerName: extras.customer_name || null,
    shippingAddress: extras.shipping_address || null,
    promoCode: pi.metadata?.promo_code,
    discountCents,
    shippingCents,
    affiliateCode:
      pi.metadata?.affiliate_code || extras?.affiliate_code || null,
    referralCode:
      pi.metadata?.referral_code || extras?.referral_code || null,
  });
}

export default async function webhooksRoutes(fastify) {
  fastify.post("/webhooks/stripe", async (request, reply) => {
    const sig = request.headers["stripe-signature"];

    if (!sig) {
      return reply.code(400).send({ error: "Signature Stripe manquante" });
    }

    let event;

    try {
      event = getStripe().webhooks.constructEvent(
        request.rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Webhook signature invalide:", err.message);
      return reply.code(400).send({ error: `Webhook Error: ${err.message}` });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      if (session.payment_status === "paid") {
        try {
          await fulfillOrder(session);
        } catch (err) {
          console.error("Erreur fulfillment commande:", err);
          return reply.code(500).send({ error: "Erreur traitement commande" });
        }
      }
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;
      if (pi.metadata?.source === "commander") {
        try {
          await fulfillPaymentIntent(pi);
        } catch (err) {
          console.error("Erreur fulfillment PaymentIntent:", err);
          return reply.code(500).send({ error: "Erreur traitement commande" });
        }
      }
    }

    return { received: true };
  });
}
