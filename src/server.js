import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import productsRoutes from "./routes/products.js";
import checkoutRoutes from "./routes/checkout.js";
import webhooksRoutes from "./routes/webhooks.js";
import adminRoutes from "./routes/admin.js";
import contactRoutes from "./routes/contact.js";
import newsletterRoutes from "./routes/newsletter.js";
import blogRoutes from "./routes/blog.js";
import reviewsRoutes from "./routes/reviews.js";
import promoRoutes from "./routes/promo.js";
import calendarRoutes from "./routes/calendar.js";
import categoriesRoutes from "./routes/categories.js";
import loyaltyRoutes from "./routes/loyalty.js";
import affiliatesRoutes from "./routes/affiliates.js";
import referralsRoutes from "./routes/referrals.js";
import analyticsRoutes from "./routes/analytics.js";
import settingsRoutes from "./routes/settings.js";
import brandRoutes from "./routes/brand.js";
import tenantsRoutes from "./routes/tenants.js";
import pool from "./db/pool.js";
import {
  sendAbandonedCartEmail,
  sendCalendarReminder,
  sendCrossSellEmail,
  sendOrderDeliveredEmail,
  sendReviewReminderEmail,
  sendReferralInviteEmail,
  sendWelcomeJ3Email,
  sendWelcomeJ7Email,
} from "./lib/email.js";
import { getCrossSellSuggestions } from "./lib/crosssell.js";
import { getGoogleReviewUrl } from "./lib/settings.js";
import { getReferralConfig } from "./routes/referrals.js";

const PORT = Number(process.env.PORT) || 3001;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function firstItemName(items) {
  const arr = Array.isArray(items) ? items : [];
  return arr[0]?.name || "votre commande";
}

const fastify = Fastify({ logger: true });

// Conserver le raw body pour la vérification de signature Stripe
fastify.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (req, body, done) => {
    try {
      req.rawBody = body;
      const json = JSON.parse(body.toString("utf8"));
      done(null, json);
    } catch (err) {
      done(err, undefined);
    }
  }
);

await fastify.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-admin-password"],
  credentials: true,
});

fastify.get("/health", async () => ({
  status: "ok",
  service: "boutique-template-api",
}));

await fastify.register(productsRoutes);
await fastify.register(checkoutRoutes);
await fastify.register(webhooksRoutes);
await fastify.register(adminRoutes);
await fastify.register(contactRoutes);
await fastify.register(newsletterRoutes);
await fastify.register(blogRoutes);
await fastify.register(reviewsRoutes);
await fastify.register(promoRoutes);
await fastify.register(calendarRoutes);
await fastify.register(categoriesRoutes);
await fastify.register(loyaltyRoutes);
await fastify.register(affiliatesRoutes);
await fastify.register(referralsRoutes);
await fastify.register(analyticsRoutes);
await fastify.register(settingsRoutes);
await fastify.register(brandRoutes);
await fastify.register(tenantsRoutes);

async function processCalendarReminders() {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, description, date::text AS date
       FROM calendar_tasks
       WHERE reminder_sent = false
         AND date = (CURRENT_DATE + INTERVAL '1 day')::date`
    );

    for (const task of rows) {
      try {
        await sendCalendarReminder({
          title: task.title,
          description: task.description,
          date: task.date,
          urgency: "veille",
        });
        await pool.query(
          `UPDATE calendar_tasks SET reminder_sent = true WHERE id = $1`,
          [task.id]
        );
        console.log(`Rappel calendrier envoyé — tâche #${task.id}`);
      } catch (err) {
        console.error(`Rappel calendrier échoué (#${task.id}):`, err.message);
      }
    }
  } catch (err) {
    console.error("Job rappels calendrier:", err.message);
  }
}

async function processAbandonedCartReminders() {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM abandoned_carts
       WHERE reminder_sent = false
         AND converted = false
         AND updated_at < NOW() - INTERVAL '1 hour'
         AND updated_at > NOW() - INTERVAL '24 hours'`
    );

    for (const cart of rows) {
      try {
        await sendAbandonedCartEmail({
          email: cart.email,
          customerName: cart.customer_name,
          items: cart.items,
          totalCents: cart.total_cents,
          promoCode: cart.promo_code,
          discountCents: cart.discount_cents,
        });
        await pool.query(
          `UPDATE abandoned_carts
           SET reminder_sent = true, reminder_sent_at = NOW()
           WHERE id = $1`,
          [cart.id]
        );
        console.log(`Rappel panier abandonné envoyé — #${cart.id} ${cart.email}`);
      } catch (err) {
        console.error(
          `Rappel panier abandonné échoué (#${cart.id}):`,
          err.message
        );
      }
    }
  } catch (err) {
    console.error("Abandoned cart job error:", err.message);
  }
}

/** Email demande d'avis J+2 après livraison */
async function processDeliveryReviewEmails() {
  try {
    const googleReviewUrl = await getGoogleReviewUrl();
    const { rows } = await pool.query(
      `SELECT id, customer_email, customer_name, items
       FROM orders
       WHERE status = 'delivered'
         AND customer_email IS NOT NULL
         AND TRIM(customer_email) <> ''
         AND delivery_review_sent_at IS NULL
         AND updated_at BETWEEN NOW() - INTERVAL '3 days' AND NOW() - INTERVAL '2 days'`
    );

    for (const order of rows) {
      try {
        await sendOrderDeliveredEmail({
          email: order.customer_email,
          customerName: order.customer_name,
          orderId: order.id,
          productName: firstItemName(order.items),
          googleReviewUrl,
        });
        await pool.query(
          `UPDATE orders SET delivery_review_sent_at = NOW() WHERE id = $1`,
          [order.id]
        );
        console.log(`Email avis J+2 envoyé — commande ${order.id}`);
      } catch (err) {
        console.error(`Email avis J+2 échoué (${order.id}):`, err.message);
      }
    }
  } catch (err) {
    console.error("Job avis J+2:", err.message);
  }
}

/** Relance avis J+7 si pas d'avis laissé */
async function processReviewReminders() {
  try {
    const googleReviewUrl = await getGoogleReviewUrl();
    const { rows } = await pool.query(
      `SELECT o.id, o.customer_email, o.customer_name
       FROM orders o
       WHERE o.status = 'delivered'
         AND o.customer_email IS NOT NULL
         AND TRIM(o.customer_email) <> ''
         AND o.updated_at BETWEEN NOW() - INTERVAL '10 days' AND NOW() - INTERVAL '7 days'
         AND NOT EXISTS (
           SELECT 1 FROM reviews r
           WHERE LOWER(r.customer_email) = LOWER(o.customer_email)
         )
         AND NOT EXISTS (
           SELECT 1 FROM review_reminders rr WHERE rr.order_id = o.id
         )`
    );

    for (const order of rows) {
      try {
        await sendReviewReminderEmail({
          email: order.customer_email,
          customerName: order.customer_name,
          orderId: order.id,
          googleReviewUrl,
        });
        await pool.query(
          `INSERT INTO review_reminders (order_id) VALUES ($1) ON CONFLICT DO NOTHING`,
          [order.id]
        );
        console.log(`Relance avis J+7 envoyée — commande ${order.id}`);
      } catch (err) {
        console.error(`Relance avis J+7 échouée (${order.id}):`, err.message);
      }
    }
  } catch (err) {
    console.error("Job relance avis J+7:", err.message);
  }
}

/** Séquence bienvenue newsletter — J+3 et J+7 si pas de commande */
async function processNewsletterWelcomeSequence() {
  try {
    const { rows: j3 } = await pool.query(
      `SELECT ns.email, ns.customer_name
       FROM newsletter_subscribers ns
       WHERE ns.active = true
         AND ns.created_at BETWEEN NOW() - INTERVAL '4 days' AND NOW() - INTERVAL '3 days'
         AND ns.welcome_j3_sent = false
         AND NOT EXISTS (
           SELECT 1 FROM orders o
           WHERE LOWER(TRIM(o.customer_email)) = LOWER(TRIM(ns.email))
         )`
    );

    for (const sub of j3) {
      try {
        await sendWelcomeJ3Email({
          email: sub.email,
          customerName: sub.customer_name,
        });
        await pool.query(
          `UPDATE newsletter_subscribers SET welcome_j3_sent = true WHERE email = $1`,
          [sub.email]
        );
        console.log(`Email bienvenue J+3 envoyé — ${sub.email}`);
      } catch (err) {
        console.error(`Email bienvenue J+3 échoué (${sub.email}):`, err.message);
      }
    }

    const { rows: j7 } = await pool.query(
      `SELECT ns.email, ns.customer_name
       FROM newsletter_subscribers ns
       WHERE ns.active = true
         AND ns.created_at BETWEEN NOW() - INTERVAL '8 days' AND NOW() - INTERVAL '7 days'
         AND ns.welcome_j7_sent = false
         AND NOT EXISTS (
           SELECT 1 FROM orders o
           WHERE LOWER(TRIM(o.customer_email)) = LOWER(TRIM(ns.email))
         )`
    );

    for (const sub of j7) {
      try {
        await sendWelcomeJ7Email({
          email: sub.email,
          customerName: sub.customer_name,
        });
        await pool.query(
          `UPDATE newsletter_subscribers SET welcome_j7_sent = true WHERE email = $1`,
          [sub.email]
        );
        console.log(`Email bienvenue J+7 envoyé — ${sub.email}`);
      } catch (err) {
        console.error(`Email bienvenue J+7 échoué (${sub.email}):`, err.message);
      }
    }
  } catch (err) {
    console.error("Job bienvenue newsletter:", err.message);
  }
}

/** Cross-sell J+14 après livraison */
async function processCrossSellEmails() {
  try {
    const { rows } = await pool.query(
      `SELECT
         o.id,
         o.customer_email,
         o.customer_name,
         o.items
       FROM orders o
       WHERE o.status = 'delivered'
         AND o.crosssell_sent = false
         AND o.updated_at BETWEEN NOW() - INTERVAL '15 days' AND NOW() - INTERVAL '14 days'
         AND o.customer_email IS NOT NULL
         AND TRIM(o.customer_email) <> ''`
    );

    for (const order of rows) {
      const items = Array.isArray(order.items) ? order.items : [];
      const slugs = items.map((i) => i.slug || "").filter(Boolean);
      const suggestions = await getCrossSellSuggestions(slugs, pool);

      if (!suggestions.length) continue;

      try {
        await sendCrossSellEmail({
          email: order.customer_email,
          customerName: order.customer_name,
          purchasedItems: items,
          suggestions,
        });
        await pool.query(
          `UPDATE orders SET crosssell_sent = true WHERE id = $1`,
          [order.id]
        );
        console.log(`Email cross-sell J+14 envoyé — commande ${order.id}`);
      } catch (err) {
        console.error(`Email cross-sell J+14 échoué (${order.id}):`, err.message);
      }
    }
  } catch (err) {
    console.error("Job cross-sell J+14:", err.message);
  }
}

/** Email invitation parrainage J+1 après livraison */
async function processReferralInviteEmails() {
  try {
    const config = await getReferralConfig();
    if (!config.active) return;

    const { rows } = await pool.query(
      `SELECT o.customer_email, o.customer_name, r.referral_code, r.id AS referral_id
       FROM orders o
       JOIN referrals r ON LOWER(r.referrer_email) = LOWER(o.customer_email)
       WHERE o.status = 'delivered'
         AND o.customer_email IS NOT NULL
         AND TRIM(o.customer_email) <> ''
         AND r.invite_sent_at IS NULL
         AND o.updated_at BETWEEN NOW() - INTERVAL '2 days' AND NOW() - INTERVAL '1 day'`
    );

    for (const row of rows) {
      try {
        await sendReferralInviteEmail({
          email: row.customer_email,
          customerName: row.customer_name,
          referralCode: row.referral_code,
          referrerDiscountPercent: config.referrer_discount_percent,
          refereeDiscountPercent: config.referee_discount_percent,
        });
        await pool.query(
          `UPDATE referrals SET invite_sent_at = NOW() WHERE id = $1`,
          [row.referral_id]
        );
        console.log(`Email parrainage J+1 envoyé — ${row.customer_email}`);
      } catch (err) {
        console.error(
          `Email parrainage J+1 échoué (${row.customer_email}):`,
          err.message
        );
      }
    }
  } catch (err) {
    console.error("Job parrainage J+1:", err.message);
  }
}

try {
  await fastify.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Boutique API → http://localhost:${PORT}`);

  // Rappels tâches J-1 — toutes les heures
  void processCalendarReminders();
  setInterval(() => {
    void processCalendarReminders();
  }, HOUR_MS);

  // Rappels paniers abandonnés — toutes les heures
  void processAbandonedCartReminders();
  setInterval(() => {
    void processAbandonedCartReminders();
  }, HOUR_MS);

  // Emails avis J+2 et relances J+7 — toutes les 24h
  void processDeliveryReviewEmails();
  void processReviewReminders();
  setInterval(() => {
    void processDeliveryReviewEmails();
    void processReviewReminders();
  }, DAY_MS);

  // Séquence bienvenue newsletter J+3 / J+7 — toutes les 24h
  void processNewsletterWelcomeSequence();
  setInterval(() => {
    void processNewsletterWelcomeSequence();
  }, DAY_MS);

  // Cross-sell J+14 après livraison — toutes les 24h
  void processCrossSellEmails();
  setInterval(() => {
    void processCrossSellEmails();
  }, DAY_MS);

  // Invitation parrainage J+1 après livraison — toutes les 24h
  void processReferralInviteEmails();
  setInterval(() => {
    void processReferralInviteEmails();
  }, DAY_MS);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
