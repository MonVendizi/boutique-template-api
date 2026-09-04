import { getStripe } from "../lib/stripe.js";
import pool from "../db/pool.js";
import {
  computePromoDiscount,
  loadPromoByCode,
} from "./promo.js";

const SHIPPING_CENTS = 490; // 4,90€

export default async function checkoutRoutes(fastify) {
  fastify.post("/checkout", async (request, reply) => {
    const { items, promo_code, discount_cents: clientDiscount } = request.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return reply.code(400).send({ error: "Le panier est vide" });
    }

    for (const item of items) {
      if (!item.slug || !item.quantity || item.quantity < 1) {
        return reply
          .code(400)
          .send({ error: "Chaque article doit avoir un slug et une quantité valide" });
      }
    }

    const slugs = items.map((i) => i.slug);
    const { rows: products } = await pool.query(
      `SELECT id, name, slug, price_cents, currency, stock, sku
       FROM products
       WHERE slug = ANY($1) AND active = true`,
      [slugs]
    );

    if (products.length !== slugs.length) {
      const found = new Set(products.map((p) => p.slug));
      const missing = slugs.filter((s) => !found.has(s));
      return reply
        .code(404)
        .send({ error: "Produit(s) introuvable(s)", slugs: missing });
    }

    const productMap = Object.fromEntries(products.map((p) => [p.slug, p]));
    const lineItems = [];
    const metadataItems = [];
    let subtotalCents = 0;
    let currency = "eur";

    for (const item of items) {
      const product = productMap[item.slug];

      if (product.stock < item.quantity) {
        return reply.code(409).send({
          error: "Stock insuffisant",
          slug: product.slug,
          available: product.stock,
          requested: item.quantity,
        });
      }

      currency = product.currency || currency;
      subtotalCents += product.price_cents * item.quantity;

      lineItems.push({
        price_data: {
          currency: product.currency,
          product_data: {
            name: `${product.name}${item.variant?.label ? ` — ${item.variant.label}` : ""}`,
            metadata: { slug: product.slug, sku: product.sku },
          },
          unit_amount: product.price_cents,
        },
        quantity: item.quantity,
      });

      metadataItems.push({
        product_id: product.id,
        slug: product.slug,
        name: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unit_price_cents: product.price_cents,
        ...(item.variant
          ? {
              variant: {
                type: item.variant.type,
                label: item.variant.label,
                stock: item.variant.stock,
              },
            }
          : {}),
      });
    }

    let appliedPromo = null;
    let discountCents = 0;

    if (promo_code) {
      const row = await loadPromoByCode(promo_code);
      const result = computePromoDiscount(row, subtotalCents);
      if (!result.valid) {
        return reply.code(400).send({ error: result.error || "Code promo invalide" });
      }
      discountCents = result.discount_cents;
      // Ne pas faire confiance au client — on recalcule côté serveur
      if (
        clientDiscount != null &&
        Math.abs(Number(clientDiscount) - discountCents) > 1
      ) {
        // tolérance 1 ct : on ignore le client et on garde le recalcul
      }
      appliedPromo = result.code;
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    const sessionParams = {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      success_url: `${frontendUrl}/commande-confirmee?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/boutique`,
      metadata: {
        items: JSON.stringify(metadataItems),
        promo_code: appliedPromo || "",
        discount_cents: String(discountCents || 0),
        subtotal_cents: String(subtotalCents),
      },
      shipping_address_collection: {
        allowed_countries: ["FR", "BE", "CH", "LU", "MC"],
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: SHIPPING_CENTS, currency: "eur" },
            display_name: "Livraison France",
            delivery_estimate: {
              minimum: { unit: "business_day", value: 2 },
              maximum: { unit: "business_day", value: 4 },
            },
          },
        },
      ],
    };

    if (discountCents > 0 && appliedPromo) {
      const coupon = await getStripe().coupons.create({
        amount_off: discountCents,
        currency,
        duration: "once",
        name: `Promo ${appliedPromo}`.slice(0, 40),
      });
      sessionParams.discounts = [{ coupon: coupon.id }];
    }

    const session = await getStripe().checkout.sessions.create(sessionParams);

    return { sessionId: session.id, url: session.url };
  });

  /** Confirme une commande payée via PaymentIntent (page /commander) */
  fastify.post("/checkout/confirm-payment", async (request, reply) => {
    const body = request.body || {};
    const paymentIntentId = String(body.payment_intent_id || "").trim();
    if (!paymentIntentId) {
      return reply.code(400).send({ error: "payment_intent_id requis" });
    }

    const customer = body.customer || {};
    const shipping = body.shipping || {};

    try {
      const pi = await getStripe().paymentIntents.retrieve(paymentIntentId);
      if (pi.status !== "succeeded") {
        return reply
          .code(400)
          .send({ error: `Paiement non confirmé (${pi.status})` });
      }

      const { fulfillPaymentIntent } = await import("./webhooks.js");
      const { applyAffiliateCommission } = await import("./affiliates.js");
      const affiliateCode = body.affiliate_code
        ? String(body.affiliate_code).trim().toLowerCase()
        : null;

      const order = await fulfillPaymentIntent(pi, {
        customer_email: customer.email || pi.receipt_email,
        customer_name: customer.name || null,
        shipping_address: {
          name: customer.name || null,
          phone: customer.phone || null,
          line1: shipping.line1 || null,
          line2: shipping.line2 || null,
          city: shipping.city || null,
          postal_code: shipping.postal_code || null,
          country: shipping.country || "FR",
        },
        affiliate_code: affiliateCode,
        referral_code: body.referral_code
          ? String(body.referral_code).trim().toLowerCase()
          : null,
      });

      // Si la commande existait déjà (webhook avant confirm), rattache l'affilié
      if (affiliateCode && order?.id) {
        try {
          await applyAffiliateCommission({
            orderId: order.id,
            affiliateCode,
            totalCents: order.total_cents,
          });
        } catch (affErr) {
          console.error("Commission affiliée (confirm):", affErr);
        }
      }

      const email = String(customer.email || pi.receipt_email || "")
        .trim()
        .toLowerCase();
      if (email) {
        await pool.query(
          `UPDATE abandoned_carts SET converted = true, updated_at = NOW() WHERE email = $1`,
          [email]
        );
      }

      return { ok: true, order_id: order.id };
    } catch (err) {
      console.error("POST /checkout/confirm-payment:", err);
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Erreur confirmation",
      });
    }
  });

  /** Sauvegarde un panier abandonné (email saisi au checkout) */
  fastify.post("/checkout/save-cart", async (request) => {
    const body = request.body || {};
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    const items = body.items;
    if (!email || !Array.isArray(items) || items.length === 0) {
      return { success: false };
    }

    const customerName = body.customer_name
      ? String(body.customer_name).trim().slice(0, 100)
      : null;
    const totalCents = Math.max(0, Math.round(Number(body.total_cents) || 0));
    const promoCode = body.promo_code
      ? String(body.promo_code).trim().toUpperCase().slice(0, 50)
      : null;
    const discountCents = Math.max(
      0,
      Math.round(Number(body.discount_cents) || 0)
    );

    await pool.query(
      `INSERT INTO abandoned_carts (
         email, customer_name, items, total_cents, promo_code, discount_cents, updated_at
       ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, NOW())
       ON CONFLICT (email) DO UPDATE SET
         customer_name = EXCLUDED.customer_name,
         items = EXCLUDED.items,
         total_cents = EXCLUDED.total_cents,
         promo_code = EXCLUDED.promo_code,
         discount_cents = EXCLUDED.discount_cents,
         reminder_sent = false,
         reminder_sent_at = NULL,
         converted = false,
         updated_at = NOW()`,
      [
        email,
        customerName,
        JSON.stringify(items),
        totalCents,
        promoCode,
        discountCents,
      ]
    );

    return { success: true };
  });

  /** Marque un panier comme converti après paiement */
  fastify.post("/checkout/mark-converted", async (request) => {
    const email = String(request.body?.email || "")
      .trim()
      .toLowerCase();
    if (!email) return { success: false };

    await pool.query(
      `UPDATE abandoned_carts SET converted = true, updated_at = NOW() WHERE email = $1`,
      [email]
    );
    return { success: true };
  });
}
