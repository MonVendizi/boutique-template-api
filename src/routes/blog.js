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

function normalizePost(body = {}) {
  return {
    slug: String(body.slug || "").trim(),
    type: body.type === "narrative" ? "narrative" : "guide",
    status: ["draft", "published", "archived"].includes(body.status)
      ? body.status
      : "draft",
    title: String(body.title || "").trim(),
    excerpt: body.excerpt != null ? String(body.excerpt) : "",
    hero_image: body.hero_image != null ? String(body.hero_image) : "",
    category: body.category != null ? String(body.category) : "",
    tags: Array.isArray(body.tags) ? body.tags : [],
    seo_title: body.seo_title != null ? String(body.seo_title) : "",
    seo_description:
      body.seo_description != null ? String(body.seo_description) : "",
    seo_keywords: Array.isArray(body.seo_keywords) ? body.seo_keywords : [],
    sections: Array.isArray(body.sections) ? body.sections : [],
    faq: Array.isArray(body.faq)
      ? body.faq
          .map((item) => ({
            question: String(item?.question || "").trim(),
            answer: String(item?.answer || "").trim(),
          }))
          .filter((item) => item.question || item.answer)
          .slice(0, 6)
      : [],
    cta_text: body.cta_text != null ? String(body.cta_text) : "",
    cta_url: body.cta_url != null ? String(body.cta_url) : "",
    related_slug: body.related_slug
      ? String(body.related_slug).trim()
      : null,
  };
}

export default async function blogRoutes(fastify) {
  // ─── Public ───
  fastify.get("/blog", async () => {
    const { rows } = await pool.query(
      `SELECT id, slug, type, status, title, excerpt, hero_image, category,
              tags, seo_title, seo_description, published_at, created_at, updated_at
       FROM blog_posts
       WHERE status = 'published'
       ORDER BY published_at DESC NULLS LAST, created_at DESC`
    );
    return rows;
  });

  // Public + aperçu admin (header x-admin-password)
  fastify.get("/blog/:slug", async (request, reply) => {
    const { slug } = request.params;
    const preview =
      Boolean(process.env.ADMIN_PASSWORD) &&
      request.headers["x-admin-password"] === process.env.ADMIN_PASSWORD;

    const { rows } = await pool.query(
      preview
        ? `SELECT b.*, r.title AS related_title
           FROM blog_posts b
           LEFT JOIN blog_posts r ON r.slug = b.related_slug
           WHERE b.slug = $1`
        : `SELECT b.*, r.title AS related_title
           FROM blog_posts b
           LEFT JOIN blog_posts r ON r.slug = b.related_slug
           WHERE b.slug = $1 AND b.status = 'published'`,
      [slug]
    );
    if (!rows.length) {
      return reply.code(404).send({ error: "Article introuvable" });
    }
    return rows[0];
  });

  // ─── Admin ───
  fastify.get("/admin/blog", async (request, reply) => {
    if (!checkAdmin(request, reply)) return reply;
    const { rows } = await pool.query(
      `SELECT * FROM blog_posts
       WHERE status != 'archived'
       ORDER BY updated_at DESC, created_at DESC`
    );
    return rows;
  });

  fastify.post("/admin/blog", async (request, reply) => {
    if (!checkAdmin(request, reply)) return reply;
    const p = normalizePost(request.body);

    if (!p.title || !p.slug) {
      return reply.code(400).send({ error: "title et slug requis" });
    }

    const publishNow = p.status === "published";

    try {
      const { rows } = await pool.query(
        `INSERT INTO blog_posts (
           slug, type, status, title, excerpt, hero_image, category,
           tags, seo_title, seo_description, seo_keywords, sections, faq,
           cta_text, cta_url, related_slug, published_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,
           $8::jsonb,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,
           $14,$15,$16,$17
         )
         RETURNING *`,
        [
          p.slug,
          p.type,
          p.status,
          p.title,
          p.excerpt,
          p.hero_image,
          p.category,
          JSON.stringify(p.tags),
          p.seo_title || p.title,
          p.seo_description || p.excerpt,
          JSON.stringify(p.seo_keywords),
          JSON.stringify(p.sections),
          JSON.stringify(p.faq),
          p.cta_text,
          p.cta_url,
          p.related_slug,
          publishNow ? new Date() : null,
        ]
      );
      return { success: true, post: rows[0] };
    } catch (err) {
      console.error("POST /admin/blog:", err);
      const msg = err instanceof Error ? err.message : "Erreur création";
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return reply.code(409).send({ error: "Slug déjà utilisé" });
      }
      return reply.code(500).send({ error: msg });
    }
  });

  fastify.put("/admin/blog/:id", async (request, reply) => {
    if (!checkAdmin(request, reply)) return reply;
    const p = normalizePost(request.body);
    const { id } = request.params;

    if (!p.title || !p.slug) {
      return reply.code(400).send({ error: "title et slug requis" });
    }

    try {
      const { rows: existing } = await pool.query(
        `SELECT status, published_at FROM blog_posts WHERE id = $1`,
        [id]
      );
      if (!existing.length) {
        return reply.code(404).send({ error: "Article introuvable" });
      }

      let publishedAt = existing[0].published_at;
      if (p.status === "published" && !publishedAt) {
        publishedAt = new Date();
      }
      if (p.status === "draft") {
        // keep published_at history if any; status is what matters
      }

      const { rows } = await pool.query(
        `UPDATE blog_posts SET
           slug = $1, type = $2, status = $3, title = $4, excerpt = $5,
           hero_image = $6, category = $7, tags = $8::jsonb,
           seo_title = $9, seo_description = $10, seo_keywords = $11::jsonb,
           sections = $12::jsonb, faq = $13::jsonb, cta_text = $14, cta_url = $15,
           related_slug = $16, published_at = $17, updated_at = NOW()
         WHERE id = $18
         RETURNING *`,
        [
          p.slug,
          p.type,
          p.status,
          p.title,
          p.excerpt,
          p.hero_image,
          p.category,
          JSON.stringify(p.tags),
          p.seo_title || p.title,
          p.seo_description || p.excerpt,
          JSON.stringify(p.seo_keywords),
          JSON.stringify(p.sections),
          JSON.stringify(p.faq),
          p.cta_text,
          p.cta_url,
          p.related_slug,
          publishedAt,
          id,
        ]
      );
      return { success: true, post: rows[0] };
    } catch (err) {
      console.error("PUT /admin/blog/:id:", err);
      const msg = err instanceof Error ? err.message : "Erreur mise à jour";
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return reply.code(409).send({ error: "Slug déjà utilisé" });
      }
      return reply.code(500).send({ error: msg });
    }
  });

  fastify.delete("/admin/blog/:id", async (request, reply) => {
    if (!checkAdmin(request, reply)) return reply;
    const { rows } = await pool.query(
      `UPDATE blog_posts SET status = 'archived', updated_at = NOW()
       WHERE id = $1 RETURNING id`,
      [request.params.id]
    );
    if (!rows.length) {
      return reply.code(404).send({ error: "Article introuvable" });
    }
    return { success: true };
  });

  fastify.put("/admin/blog/:id/publish", async (request, reply) => {
    if (!checkAdmin(request, reply)) return reply;
    try {
      const { rows } = await pool.query(
        `UPDATE blog_posts
         SET status = 'published',
             published_at = COALESCE(published_at, NOW()),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [request.params.id]
      );
      if (!rows.length) {
        return reply.code(404).send({ error: "Article introuvable" });
      }
      return { success: true, post: rows[0] };
    } catch (err) {
      console.error("PUT /admin/blog/:id/publish:", err);
      const msg = err instanceof Error ? err.message : "Erreur publication";
      return reply.code(500).send({ error: msg });
    }
  });

  fastify.put("/admin/blog/:id/unpublish", async (request, reply) => {
    if (!checkAdmin(request, reply)) return reply;
    try {
      const { rows } = await pool.query(
        `UPDATE blog_posts
         SET status = 'draft', updated_at = NOW()
         WHERE id = $1
         RETURNING id, slug, status, updated_at`,
        [request.params.id]
      );
      if (!rows.length) {
        return reply.code(404).send({ error: "Article introuvable" });
      }
      return { success: true, post: rows[0] };
    } catch (err) {
      console.error("PUT /admin/blog/:id/unpublish:", err);
      const msg = err instanceof Error ? err.message : "Erreur dépublication";
      return reply.code(500).send({ error: msg });
    }
  });
}
