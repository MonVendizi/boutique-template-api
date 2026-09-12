import pool from "../db/pool.js";
import {
  sendNewsletterEmail,
  sendWelcomeEmail,
} from "../lib/email.js";
import { getLoyaltyConfig } from "./loyalty.js";
import { isBotEmail } from "../lib/botEmail.js";
import { checkAdmin } from "../lib/adminAuth.js";

const FRONTEND_URL = process.env.FRONTEND_URL || "https://maboutique.fr";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ipAttempts = new Map();

function checkSubscribeRateLimit(request, reply) {
  const ip = request.ip || "unknown";
  const now = Date.now();
  const attempts = ipAttempts.get(ip) || { count: 0, first: now };

  if (now - attempts.first > 3600000) {
    ipAttempts.set(ip, { count: 1, first: now });
    return true;
  }

  if (attempts.count >= 5) {
    reply
      .code(429)
      .send({ error: "Trop de tentatives. Réessayez dans une heure." });
    return false;
  }

  ipAttempts.set(ip, { ...attempts, count: attempts.count + 1 });
  return true;
}

function personalizeContent(content, subscriber) {
  const rawName = subscriber.customer_name?.split(" ")[0] || "";
  const firstName =
    rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();
  const hasFirstName = firstName.length > 0;

  return String(content || "")
    .replace(/\[Prénom\],?\s*/gi, hasFirstName ? `${firstName}, ` : "")
    .replace(/\{\{prenom\}\}/gi, hasFirstName ? firstName : "")
    .replace(/\{\{nom\}\}/gi, subscriber.customer_name || "")
    .replace(/\{\{email\}\}/gi, subscriber.email);
}

export default async function newsletterRoutes(fastify) {
  // ─── Public ───
  fastify.post("/newsletter/subscribe", async (request, reply) => {
    const email = String(request.body?.email || "")
      .trim()
      .toLowerCase();
    const source = String(request.body?.source || "site").slice(0, 50);
    const name = String(request.body?.name || request.body?.customerName || "")
      .trim()
      .slice(0, 100) || null;

    if (!email || !EMAIL_RE.test(email)) {
      return reply.code(400).send({ error: "E-mail invalide" });
    }
    if (isBotEmail(email)) {
      return reply.code(400).send({ error: "Email invalide" });
    }

    if (!checkSubscribeRateLimit(request, reply)) return;

    try {
      const { rows } = await pool.query(
        `INSERT INTO newsletter_subscribers (email, source, customer_name, active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (email) DO UPDATE SET
           active = true,
           unsubscribed_at = NULL,
           source = CASE
             WHEN newsletter_subscribers.active = false THEN EXCLUDED.source
             ELSE newsletter_subscribers.source
           END,
           customer_name = COALESCE(EXCLUDED.customer_name, newsletter_subscribers.customer_name),
           updated_at = NOW()
         WHERE newsletter_subscribers.active = false
         RETURNING id, (xmax = 0) AS is_new`,
        [email, source, name]
      );

      if (rows.length === 0) {
        return { success: true, already_subscribed: true };
      }

      try {
        const loyaltyConfig = await getLoyaltyConfig();
        await sendWelcomeEmail({
          email,
          customerName: name,
          loyaltyActive: Boolean(loyaltyConfig?.active),
        });
        await pool.query(
          `UPDATE newsletter_subscribers SET welcome_sent = true WHERE email = $1`,
          [email]
        );
      } catch (welcomeErr) {
        console.error("Email bienvenue newsletter échoué:", welcomeErr);
      }

      return { success: true, already_subscribed: false };
    } catch (err) {
      console.error("POST /newsletter/subscribe:", err);
      return reply.code(500).send({ error: "Inscription impossible" });
    }
  });

  fastify.get("/newsletter/unsubscribe", async (request, reply) => {
    const token = String(request.query?.token || "").trim();
    const emailParam = String(request.query?.email || "").trim();
    const successUrl = `${FRONTEND_URL.replace(/\/$/, "")}/newsletter/unsubscribe?success=true`;

    try {
      if (emailParam) {
        const email = decodeURIComponent(emailParam).toLowerCase().trim();
        if (!email || !EMAIL_RE.test(email)) {
          return reply.code(400).send({ error: "E-mail invalide" });
        }

        await pool.query(
          `UPDATE newsletter_subscribers
           SET active = false, unsubscribed_at = NOW()
           WHERE email = $1`,
          [email]
        );

        return reply.redirect(successUrl);
      }

      if (token) {
        await pool.query(
          `UPDATE newsletter_subscribers
           SET active = false, unsubscribed_at = NOW()
           WHERE token = $1`,
          [token]
        );

        return reply.redirect(successUrl);
      }

      return reply.code(400).send({ error: "Paramètre manquant" });
    } catch (err) {
      console.error("GET /newsletter/unsubscribe:", err);
      return reply.code(500).send({ error: "Une erreur est survenue" });
    }
  });

  // ─── Admin ───
  fastify.get("/admin/newsletter/subscribers", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return reply;

    const { rows } = await pool.query(
      `SELECT id, email, source, active, created_at, unsubscribed_at
       FROM newsletter_subscribers
       WHERE active = true
       ORDER BY created_at DESC`
    );

    return {
      count: rows.length,
      subscribers: rows,
    };
  });

  fastify.post("/admin/newsletter/send", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return reply;

    const {
      subject,
      type = "news",
      title,
      message,
      cta_text,
      cta_url,
    } = request.body || {};

    if (!subject?.trim() || !title?.trim() || !message?.trim()) {
      return reply
        .code(400)
        .send({ error: "subject, title et message requis" });
    }

    const { rows: subscribers } = await pool.query(
      `SELECT email, token, customer_name FROM newsletter_subscribers WHERE active = true`
    );

    let sent = 0;
    const errors = [];

    for (const sub of subscribers) {
      try {
        await sendNewsletterEmail({
          to: sub.email,
          token: sub.token,
          subject: personalizeContent(subject.trim(), sub),
          type,
          title: personalizeContent(title.trim(), sub),
          message: personalizeContent(message.trim(), sub),
          cta_text: cta_text?.trim()
            ? personalizeContent(cta_text.trim(), sub)
            : undefined,
          cta_url: cta_url?.trim() || undefined,
        });
        sent += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur envoi";
        errors.push({ email: sub.email, error: msg });
      }
    }

    if (sent > 0) {
      const campaignSubject = subject.trim();
      try {
        await pool.query(
          `INSERT INTO calendar_tasks (title, description, date, type)
           VALUES ($1, $2, CURRENT_DATE, 'content')`,
          [
            `Newsletter envoyée — ${campaignSubject}`,
            `Campagne envoyée à ${sent} abonné(s). Sujet : ${campaignSubject}`,
          ]
        );
      } catch (calendarErr) {
        console.error("calendar_tasks après campagne newsletter:", calendarErr);
      }
    }

    return { success: true, sent, errors };
  });
}
