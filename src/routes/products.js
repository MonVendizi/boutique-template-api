import pool from "../db/pool.js";

function formatProduct(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    description: row.description,
    price_cents: row.price_cents,
    price: row.price_cents / 100,
    currency: row.currency,
    sku: row.sku,
    stock: row.stock,
    in_stock: row.stock > 0,
    images: row.images,
    highlights: row.highlights,
    featured: row.featured,
    badge: row.badge ?? undefined,
    sort_order: row.sort_order ?? 0,
    subtitle: row.subtitle ?? undefined,
    short_description: row.short_description ?? undefined,
    unit: row.unit ?? undefined,
    origin: row.origin ?? undefined,
    seo_title: row.seo_title ?? undefined,
    seo_description: row.seo_description ?? undefined,
    rating: row.rating != null ? Number(row.rating) : undefined,
    review_count: row.review_count ?? undefined,
    landing_page_enabled: row.landing_page_enabled ?? false,
    landing_page_config: row.landing_page_config ?? {},
  };
}

const PRODUCT_FIELDS = `
  id, name, slug, category, description, price_cents, currency, sku, stock,
  images, highlights, featured, badge, sort_order, subtitle, short_description, unit, origin,
  seo_title, seo_description, rating, review_count,
  landing_page_enabled, landing_page_config
`;

export default async function productsRoutes(fastify) {
  fastify.get("/products", async (request, reply) => {
    const { category } = request.query;

    let query = `
      SELECT ${PRODUCT_FIELDS}
      FROM products
      WHERE active = true
    `;
    const params = [];

    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    query += " ORDER BY sort_order ASC, featured DESC, name ASC";

    const { rows } = await pool.query(query, params);
    return rows.map(formatProduct);
  });

  fastify.get("/products/featured", async () => {
    const { rows } = await pool.query(
      `SELECT ${PRODUCT_FIELDS}
       FROM products
       WHERE active = true AND featured = true
       ORDER BY sort_order ASC, name ASC`
    );
    return rows.map(formatProduct);
  });

  fastify.get("/products/:slug", async (request, reply) => {
    const { slug } = request.params;

    const { rows } = await pool.query(
      `SELECT ${PRODUCT_FIELDS}
       FROM products
       WHERE slug = $1 AND active = true`,
      [slug]
    );

    if (rows.length === 0) {
      return reply.code(404).send({ error: "Produit introuvable" });
    }

    return formatProduct(rows[0]);
  });
}
