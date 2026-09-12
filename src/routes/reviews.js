import pool from "../db/pool.js";
import { checkAdmin } from "../lib/adminAuth.js";
import { sendGoogleReviewRequestEmail } from "../lib/email.js";
import { getGoogleReviewUrl } from "../lib/settings.js";

const FRONTEND_URL = process.env.FRONTEND_URL || "https://maboutique.fr";
const BRAND_NAME = process.env.BRAND_NAME || "Ma Boutique";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@maboutique.fr";

function publicReview(row) {
  return {
    id: row.id,
    product_slug: row.product_slug,
    customer_name: row.customer_name,
    rating: row.rating,
    title: row.title,
    content: row.content,
    verified_purchase: row.verified_purchase,
    published_at: row.published_at,
    created_at: row.created_at,
  };
}

export default async function reviewsRoutes(fastify) {
  // ─── Public ───
  // Liste globale (doit être avant /reviews/:product_slug)
  fastify.get("/reviews", async () => {
    const { rows } = await pool.query(
      `SELECT * FROM reviews
       WHERE status = 'published'
       ORDER BY published_at DESC NULLS LAST, created_at DESC`
    );
    const count = rows.length;
    const average =
      count === 0
        ? 0
        : Math.round(
            (rows.reduce((sum, r) => sum + Number(r.rating), 0) / count) * 10
          ) / 10;

    return {
      average,
      count,
      reviews: rows.map(publicReview),
    };
  });

  fastify.get("/reviews/order-prefill/:orderId", async (request, reply) => {
    const orderId = String(request.params.orderId || "").trim();
    if (!orderId) {
      return reply.code(400).send({ error: "order_id requis" });
    }

    const { rows } = await pool.query(
      `SELECT id, customer_email, customer_name, items, status
       FROM orders
       WHERE id = $1
         AND status IN ('delivered', 'shipped', 'paid', 'preparation')`,
      [orderId]
    );

    if (!rows.length) {
      return reply.code(404).send({ error: "Commande introuvable" });
    }

    const order = rows[0];
    const items = Array.isArray(order.items) ? order.items : [];
    const first = items[0] || {};

    return {
      order_id: order.id,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      product_slug: first.slug || "",
      product_name: first.name || `votre produit ${BRAND_NAME}`,
    };
  });

  fastify.get("/reviews/:product_slug", async (request) => {
    const slug = String(request.params.product_slug || "").trim();
    const { rows } = await pool.query(
      `SELECT * FROM reviews
       WHERE product_slug = $1 AND status = 'published'
       ORDER BY published_at DESC NULLS LAST, created_at DESC`,
      [slug]
    );

    const count = rows.length;
    const average =
      count === 0
        ? 0
        : Math.round(
            (rows.reduce((sum, r) => sum + Number(r.rating), 0) / count) * 10
          ) / 10;

    return {
      product_slug: slug,
      average,
      count,
      reviews: rows.map(publicReview),
    };
  });

  fastify.post("/reviews", async (request, reply) => {
    const body = request.body || {};
    const productSlug = String(body.product_slug || "").trim();
    const customerName = String(body.customer_name || "").trim();
    const customerEmail = String(body.customer_email || "")
      .trim()
      .toLowerCase();
    const rating = Number(body.rating);
    const title = body.title != null ? String(body.title).trim() : "";
    const content = String(body.content || "").trim();
    const orderId = body.order_id || null;

    if (!productSlug || !customerName || !customerEmail || !content) {
      return reply
        .code(400)
        .send({ error: "product_slug, customer_name, customer_email et content requis" });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return reply.code(400).send({ error: "rating doit être entre 1 et 5" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return reply.code(400).send({ error: "Email invalide" });
    }

    const { rows: products } = await pool.query(
      `SELECT id FROM products WHERE slug = $1 LIMIT 1`,
      [productSlug]
    );
    const productId = products[0]?.id || null;

    const { rows } = await pool.query(
      `INSERT INTO reviews (
         product_id, product_slug, order_id, customer_email, customer_name,
         rating, title, content, status, verified_purchase
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)
       RETURNING *`,
      [
        productId,
        productSlug,
        orderId,
        customerEmail,
        customerName.slice(0, 100),
        rating,
        title.slice(0, 200) || null,
        content,
        Boolean(orderId),
      ]
    );

    return { success: true, review: { id: rows[0].id, status: rows[0].status } };
  });

  // ─── Admin ───
  fastify.get("/admin/reviews", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return reply;
    const status = request.query?.status
      ? String(request.query.status)
      : null;

    const { rows } = await pool.query(
      status
        ? `SELECT * FROM reviews WHERE status = $1
           ORDER BY created_at DESC`
        : `SELECT * FROM reviews
           ORDER BY
             CASE status
               WHEN 'pending' THEN 0
               WHEN 'published' THEN 1
               ELSE 2
             END,
             created_at DESC`,
      status ? [status] : []
    );

    const counts = await pool.query(
      `SELECT status, COUNT(*)::int AS count FROM reviews GROUP BY status`
    );
    const byStatus = Object.fromEntries(
      counts.rows.map((r) => [r.status, r.count])
    );

    return {
      reviews: rows,
      counts: {
        pending: byStatus.pending || 0,
        published: byStatus.published || 0,
        rejected: byStatus.rejected || 0,
      },
    };
  });

  fastify.put("/admin/reviews/:id/approve", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return reply;
    try {
      const { rows } = await pool.query(
        `UPDATE reviews
         SET status = 'published',
             published_at = COALESCE(published_at, NOW())
         WHERE id = $1
         RETURNING *`,
        [request.params.id]
      );
      if (!rows.length) {
        return reply.code(404).send({ error: "Avis introuvable" });
      }

      const review = rows[0];
      if (Number(review.rating) === 5 && review.customer_email) {
        try {
          const googleReviewUrl = await getGoogleReviewUrl();
          if (googleReviewUrl) {
            await sendGoogleReviewRequestEmail({
              email: review.customer_email,
              customerName: review.customer_name,
              googleReviewUrl,
            });
          }
        } catch (err) {
          console.error("Email avis Google échoué:", err);
        }
      }

      return { success: true, review };
    } catch (err) {
      console.error("PUT /admin/reviews/:id/approve:", err);
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Erreur",
      });
    }
  });

  fastify.put("/admin/reviews/:id/reject", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return reply;
    try {
      const { rows } = await pool.query(
        `UPDATE reviews
         SET status = 'rejected', published_at = NULL
         WHERE id = $1
         RETURNING *`,
        [request.params.id]
      );
      if (!rows.length) {
        return reply.code(404).send({ error: "Avis introuvable" });
      }
      return { success: true, review: rows[0] };
    } catch (err) {
      console.error("PUT /admin/reviews/:id/reject:", err);
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Erreur",
      });
    }
  });

  fastify.delete("/admin/reviews/:id", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return reply;
    const { rows } = await pool.query(
      `DELETE FROM reviews WHERE id = $1 RETURNING id`,
      [request.params.id]
    );
    if (!rows.length) {
      return reply.code(404).send({ error: "Avis introuvable" });
    }
    return { success: true };
  });
}
