import pool from "../db/pool.js";
import {
  sendOrderPreparationEmail,
  sendOrderShippedEmail,
  sendInactiveCustomerEmail,
} from "../lib/email.js";
import { getSettings, setSettings } from "../lib/settings.js";
import { createReferralForCustomer } from "./referrals.js";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

const VALID_ORDER_STATUSES = [
  "pending",
  "paid",
  "preparation",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
];

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

function getAnalyticsClient() {
  // Prefer ADC file path (GOOGLE_APPLICATION_CREDENTIALS)
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new BetaAnalyticsDataClient();
  }
  const raw = process.env.GOOGLE_CREDENTIALS || "{}";
  let credentials = JSON.parse(raw);
  if (typeof credentials === "string") {
    credentials = JSON.parse(credentials);
  }
  return new BetaAnalyticsDataClient({ credentials });
}

function hasGaCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  const raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw || raw === "file" || raw === "{}") return false;
  try {
    const parsed = JSON.parse(raw);
    return Boolean(parsed?.client_email || typeof parsed === "string");
  } catch {
    return false;
  }
}

async function upsertProductVariants(productId, payload) {
  const hasVariants = Boolean(payload.has_variants);
  const variantType = payload.variant_type || "size";
  const variants = Array.isArray(payload.variants) ? payload.variants : [];

  await pool.query(
    `UPDATE products
     SET has_variants = $1, variant_type = $2
     WHERE id = $3`,
    [hasVariants, variantType, productId]
  );

  await pool.query(`DELETE FROM product_variants WHERE product_id = $1`, [
    productId,
  ]);

  if (hasVariants) {
    await pool.query(
      `INSERT INTO product_variants (product_id, type, options)
       VALUES ($1, $2, $3::jsonb)`,
      [productId, variantType, JSON.stringify(variants)]
    );
  }
}

async function loadVariantsMap(productIds) {
  if (!productIds.length) return {};
  const { rows } = await pool.query(
    `SELECT product_id, type, options
     FROM product_variants
     WHERE product_id = ANY($1::uuid[])`,
    [productIds]
  );
  const map = {};
  for (const row of rows) {
    map[row.product_id] = Array.isArray(row.options) ? row.options : [];
  }
  return map;
}

async function updateProduct(id, fields, reply) {
  const { price_cents, stock, active, featured } = fields;

  if (
    price_cents === undefined &&
    stock === undefined &&
    active === undefined &&
    featured === undefined
  ) {
    return reply
      .code(400)
      .send({ error: "price_cents, stock, active ou featured requis" });
  }

  const { rows: before } = await pool.query(
    "SELECT stock FROM products WHERE id = $1",
    [id]
  );

  if (before.length === 0) {
    return reply.code(404).send({ error: "Produit introuvable" });
  }

  const previousStock = before[0].stock;
  const sets = [];
  const params = [];

  if (price_cents !== undefined) {
    params.push(Number(price_cents));
    sets.push(`price_cents = $${params.length}`);
  }
  if (stock !== undefined) {
    params.push(Number(stock));
    sets.push(`stock = $${params.length}`);
  }
  if (active !== undefined) {
    params.push(Boolean(active));
    sets.push(`active = $${params.length}`);
  }
  if (featured !== undefined) {
    params.push(Boolean(featured));
    sets.push(`featured = $${params.length}`);
  }

  params.push(id);

  const { rows } = await pool.query(
    `UPDATE products SET ${sets.join(", ")}
     WHERE id = $${params.length}
     RETURNING id, name, slug, sku, price_cents, stock, active, featured, images, updated_at`,
    params
  );

  if (stock !== undefined && Number(stock) !== previousStock) {
    await pool.query(
      `INSERT INTO stock_movements (product_id, quantity_change, reason)
       VALUES ($1, $2, 'admin_adjustment')`,
      [id, Number(stock) - previousStock]
    );
  }

  return rows[0];
}

async function shipOrder(id, trackingNumber, reply, carrier) {
  const { rows: existing } = await pool.query(
    "SELECT * FROM orders WHERE id = $1",
    [id]
  );

  if (existing.length === 0) {
    return reply.code(404).send({ error: "Commande introuvable" });
  }

  const { rows } = await pool.query(
    `UPDATE orders
     SET status = 'shipped',
         tracking_number = COALESCE($1, tracking_number),
         carrier = COALESCE($2, carrier)
     WHERE id = $3
     RETURNING *`,
    [trackingNumber || null, carrier || null, id]
  );

  const order = rows[0];

  try {
    await sendOrderShippedEmail({
      email: order.customer_email,
      orderId: order.id,
      customerName: order.customer_name,
      trackingNumber: order.tracking_number,
      carrier: carrier || order.carrier,
    });
  } catch (err) {
    console.error("Email de suivi échoué (commande mise à jour):", err);
  }

  return order;
}

async function setOrderStatus(id, status, reply, extras = {}) {
  if (!VALID_ORDER_STATUSES.includes(status)) {
    return reply.code(400).send({
      error: `Statut invalide. Valides: ${VALID_ORDER_STATUSES.join(", ")}`,
    });
  }

  if (status === "shipped") {
    return shipOrder(
      id,
      extras.trackingNumber,
      reply,
      extras.carrier
    );
  }

  const { rows } = await pool.query(
    `UPDATE orders SET status = $1 WHERE id = $2
     RETURNING *`,
    [status, id]
  );

  if (rows.length === 0) {
    return reply.code(404).send({ error: "Commande introuvable" });
  }

  const order = rows[0];

  if (status === "preparation") {
    try {
      await sendOrderPreparationEmail({
        email: order.customer_email,
        orderId: order.id,
        customerName: order.customer_name,
      });
    } catch (err) {
      console.error("Email préparation échoué (commande mise à jour):", err);
    }
  }

  if (status === "delivered") {
    try {
      await createReferralForCustomer({
        email: order.customer_email,
        customerName: order.customer_name,
      });
    } catch (err) {
      console.error("Création code parrainage échouée:", err);
    }
  }

  return {
    id: order.id,
    status: order.status,
    tracking_number: order.tracking_number,
    updated_at: order.updated_at,
  };
}

export default async function adminRoutes(fastify) {
  fastify.addHook("preHandler", async (request, reply) => {
    if (!checkAdmin(request, reply)) {
      return reply;
    }
  });

  // ─── Produits : catalogue ───
  fastify.get("/admin/products", async (request) => {
    const { include_inactive } = request.query || {};
    const includeInactive =
      include_inactive === "true" || include_inactive === "1";

    const { rows } = await pool.query(
      `SELECT id, name, slug, category, sku, price_cents, stock, active, featured,
              badge, sort_order, images, highlights, description, short_description, subtitle, unit,
              origin, seo_title, seo_description, landing_page_enabled, landing_page_config,
              has_variants, variant_type, updated_at
       FROM products
       ${includeInactive ? "" : "WHERE active = true"}
       ORDER BY sort_order ASC, category, name`
    );
    const variantsMap = await loadVariantsMap(rows.map((r) => r.id));
    return rows.map((row) => ({
      ...row,
      variants: variantsMap[row.id] || [],
    }));
  });

  fastify.post("/admin/products", async (request, reply) => {
    const p = request.body || {};

    if (!p.name || !p.category || !p.sku || !p.slug) {
      return reply
        .code(400)
        .send({ error: "name, category, sku et slug requis" });
    }

    const priceCents =
      p.price_cents !== undefined
        ? Math.round(Number(p.price_cents))
        : p.price !== undefined
          ? Math.round(Number(p.price) * 100)
          : null;

    if (priceCents === null || Number.isNaN(priceCents) || priceCents < 0) {
      return reply.code(400).send({ error: "price ou price_cents requis" });
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO products (
           name, category, subtitle, short_description, description,
           price_cents, unit, sku, slug, stock, images, highlights, origin,
           seo_title, seo_description, active, featured, badge, sort_order,
           landing_page_enabled, landing_page_config,
           has_variants, variant_type
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23
         )
         RETURNING id, name, slug, sku, price_cents, stock, active, featured, badge, sort_order, images,
                   landing_page_enabled, landing_page_config, has_variants, variant_type`,
        [
          p.name,
          p.category,
          p.subtitle || "",
          p.short_description || "",
          p.description || "",
          priceCents,
          p.unit || "",
          p.sku,
          p.slug,
          Number(p.stock) || 0,
          JSON.stringify(p.images || []),
          JSON.stringify(p.highlights || []),
          p.origin || "Cameroun",
          p.seo_title || "",
          p.seo_description || "",
          p.active !== false,
          Boolean(p.featured),
          p.badge || null,
          Number(p.sort_order) || 0,
          Boolean(p.landing_page_enabled),
          JSON.stringify(p.landing_page_config || {}),
          Boolean(p.has_variants),
          p.variant_type || "size",
        ]
      );

      await upsertProductVariants(rows[0].id, p);
      const variantsMap = await loadVariantsMap([rows[0].id]);

      return {
        success: true,
        id: rows[0].id,
        product: {
          ...rows[0],
          variants: variantsMap[rows[0].id] || [],
        },
      };
    } catch (err) {
      console.error("POST /admin/products:", err);
      const msg = err instanceof Error ? err.message : "Erreur création";
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return reply.code(409).send({ error: "SKU ou slug déjà utilisé" });
      }
      return reply.code(500).send({ error: msg });
    }
  });

  fastify.put("/admin/products/:id", async (request, reply) => {
    const p = request.body || {};
    const { id } = request.params;

    // Mise à jour complète si name présent
    if (p.name !== undefined) {
      const priceCents =
        p.price_cents !== undefined
          ? Math.round(Number(p.price_cents))
          : p.price !== undefined
            ? Math.round(Number(p.price) * 100)
            : undefined;

      const sets = [
        "name = $1",
        "category = $2",
        "subtitle = $3",
        "short_description = $4",
        "description = $5",
        "unit = $6",
        "sku = $7",
        "slug = $8",
        "stock = $9",
        "images = $10::jsonb",
        "highlights = $11::jsonb",
        "origin = $12",
        "seo_title = $13",
        "seo_description = $14",
        "active = $15",
        "featured = $16",
        "badge = $17",
        "sort_order = $18",
        "landing_page_enabled = $19",
        "landing_page_config = $20::jsonb",
      ];
      const params = [
        p.name,
        p.category,
        p.subtitle || "",
        p.short_description || "",
        p.description || "",
        p.unit || "",
        p.sku,
        p.slug,
        Number(p.stock) || 0,
        JSON.stringify(p.images || []),
        JSON.stringify(p.highlights || []),
        p.origin || "Cameroun",
        p.seo_title || "",
        p.seo_description || "",
        p.active !== false,
        Boolean(p.featured),
        p.badge || null,
        Number(p.sort_order) || 0,
        Boolean(p.landing_page_enabled),
        JSON.stringify(p.landing_page_config || {}),
      ];

      if (priceCents !== undefined) {
        params.push(priceCents);
        sets.push(`price_cents = $${params.length}`);
      }

      params.push(id);

      try {
        const { rows } = await pool.query(
          `UPDATE products SET ${sets.join(", ")}
           WHERE id = $${params.length}
           RETURNING id, name, slug, sku, price_cents, stock, active, featured, badge, sort_order, images,
                     category, unit, origin, subtitle, short_description, description,
                     highlights, seo_title, seo_description, landing_page_enabled, landing_page_config,
                     has_variants, variant_type`,
          params
        );

        if (rows.length === 0) {
          return reply.code(404).send({ error: "Introuvable" });
        }

        if (p.has_variants !== undefined || p.variants !== undefined) {
          await upsertProductVariants(id, {
            has_variants:
              p.has_variants !== undefined
                ? p.has_variants
                : rows[0].has_variants,
            variant_type: p.variant_type || rows[0].variant_type || "size",
            variants: p.variants,
          });
        }

        const variantsMap = await loadVariantsMap([id]);
        return {
          success: true,
          product: {
            ...rows[0],
            variants: variantsMap[id] || [],
          },
        };
      } catch (err) {
        console.error("PUT /admin/products/:id:", err);
        const msg = err instanceof Error ? err.message : "Erreur mise à jour";
        if (msg.includes("unique") || msg.includes("duplicate")) {
          return reply.code(409).send({ error: "SKU ou slug déjà utilisé" });
        }
        return reply.code(500).send({ error: msg });
      }
    }

    // Mise à jour partielle (stock / prix / toggles)
    const { price_cents, stock, active, featured } = p;
    return updateProduct(
      id,
      { price_cents, stock, active, featured },
      reply
    );
  });

  fastify.put("/admin/products/:id/stock", async (request, reply) => {
    const { stock } = request.body || {};
    if (stock === undefined) {
      return reply.code(400).send({ error: "stock requis" });
    }
    return updateProduct(request.params.id, { stock }, reply);
  });

  fastify.put("/admin/products/:id/price", async (request, reply) => {
    const { price_cents, price } = request.body || {};
    const cents =
      price_cents !== undefined
        ? price_cents
        : price !== undefined
          ? Math.round(Number(price) * 100)
          : undefined;

    if (cents === undefined) {
      return reply.code(400).send({ error: "price_cents ou price requis" });
    }

    return updateProduct(request.params.id, { price_cents: cents }, reply);
  });

  fastify.delete("/admin/products/:id", async (request, reply) => {
    const { id } = request.params;
    // Supprime les données liées avant le produit
    await pool.query(`DELETE FROM stock_movements WHERE product_id = $1`, [id]);
    const { rows } = await pool.query(
      `DELETE FROM products WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!rows.length) {
      return reply.code(404).send({ error: "Produit introuvable" });
    }
    return { success: true };
  });

  // ─── Commandes ───
  fastify.get("/admin/orders", async (request) => {
    const { status, limit = 50, offset = 0 } = request.query;

    let query = `SELECT id, stripe_session_id, status, customer_email, customer_name,
                        items, total_cents, currency, shipping_address, tracking_number,
                        created_at, updated_at
                 FROM orders`;
    const params = [];

    if (status) {
      params.push(status);
      query += ` WHERE status = $${params.length}`;
    }

    params.push(Number(limit), Number(offset));
    query += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await pool.query(query, params);
    return rows;
  });

  fastify.get("/admin/orders/:id", async (request, reply) => {
    const { rows } = await pool.query("SELECT * FROM orders WHERE id = $1", [
      request.params.id,
    ]);

    if (rows.length === 0) {
      return reply.code(404).send({ error: "Commande introuvable" });
    }

    return rows[0];
  });

  fastify.put("/admin/orders/:id", async (request, reply) => {
    const {
      status,
      trackingNumber,
      tracking_number,
      carrier,
    } = request.body || {};

    if (!status) {
      return reply.code(400).send({ error: "status requis" });
    }

    return setOrderStatus(request.params.id, status, reply, {
      trackingNumber: trackingNumber || tracking_number,
      carrier,
    });
  });

  fastify.put("/admin/orders/:id/status", async (request, reply) => {
    const {
      status,
      trackingNumber,
      tracking_number,
      carrier,
    } = request.body || {};

    if (!status) {
      return reply.code(400).send({ error: "status requis" });
    }

    const validStatuses = [
      "pending",
      "paid",
      "preparation",
      "shipped",
      "delivered",
      "cancelled",
      "refunded",
    ];

    if (!validStatuses.includes(status)) {
      return reply.code(400).send({
        error: `Statut invalide. Valides: ${validStatuses.join(", ")}`,
      });
    }

    return setOrderStatus(request.params.id, status, reply, {
      trackingNumber: trackingNumber || tracking_number,
      carrier,
    });
  });

  // ─── Stats ───
  fastify.get("/admin/stats", async () => {
    const [dayRevenue, monthRevenue, orderCounts, lowStock] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(total_cents), 0)::int AS total_cents, COUNT(*)::int AS count
         FROM orders
         WHERE status IN ('paid', 'preparation', 'shipped', 'delivered')
           AND created_at >= CURRENT_DATE`
      ),
      pool.query(
        `SELECT COALESCE(SUM(total_cents), 0)::int AS total_cents, COUNT(*)::int AS count
         FROM orders
         WHERE status IN ('paid', 'preparation', 'shipped', 'delivered')
           AND created_at >= date_trunc('month', CURRENT_DATE)`
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM orders
         GROUP BY status`
      ),
      pool.query(
        `SELECT id, name, slug, sku, stock
         FROM products
         WHERE active = true AND stock <= 10
         ORDER BY stock ASC`
      ),
    ]);

    return {
      revenue: {
        today: {
          total_cents: dayRevenue.rows[0].total_cents,
          orders: dayRevenue.rows[0].count,
        },
        month: {
          total_cents: monthRevenue.rows[0].total_cents,
          orders: monthRevenue.rows[0].count,
        },
      },
      orders_by_status: Object.fromEntries(
        orderCounts.rows.map((r) => [r.status, r.count])
      ),
      low_stock_alerts: lowStock.rows,
    };
  });

  // ─── Analytics (GA4 Data API) ───
  fastify.get("/admin/analytics", async (request, reply) => {
    if (!checkAdmin(request, reply)) return reply;

    const periodRaw = String(request.query?.period || "30d");
    const period = ["7d", "30d", "90d"].includes(periodRaw) ? periodRaw : "30d";
    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    const propertyId = process.env.GA4_PROPERTY_ID;

    if (!propertyId || !hasGaCredentials()) {
      return {
        status: "pending",
        period,
        visitors: null,
        pageviews: null,
        bounce_rate: null,
        avg_session: null,
        top_pages: [],
        traffic_sources: [],
        devices: [],
      };
    }

    try {
      const client = getAnalyticsClient();
      const dateRange = { startDate: `${days}daysAgo`, endDate: "today" };
      const property = `properties/${propertyId}`;

      const [kpiResponse] = await client.runReport({
        property,
        dateRanges: [dateRange],
        metrics: [
          { name: "activeUsers" },
          { name: "screenPageViews" },
          { name: "bounceRate" },
          { name: "averageSessionDuration" },
        ],
      });

      const kpi = kpiResponse.rows?.[0]?.metricValues || [];

      const [pagesResponse] = await client.runReport({
        property,
        dateRanges: [dateRange],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "averageSessionDuration" },
        ],
        orderBys: [
          { metric: { metricName: "screenPageViews" }, desc: true },
        ],
        limit: 10,
      });

      const [sourcesResponse] = await client.runReport({
        property,
        dateRanges: [dateRange],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
        limit: 6,
      });

      const [devicesResponse] = await client.runReport({
        property,
        dateRanges: [dateRange],
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "activeUsers" }],
      });

      const bounceRaw = parseFloat(kpi[2]?.value || "0");
      // GA4 bounceRate is 0–1
      const bouncePct = bounceRaw <= 1 ? bounceRaw * 100 : bounceRaw;

      return {
        status: "connected",
        period,
        visitors: parseInt(kpi[0]?.value || "0", 10),
        pageviews: parseInt(kpi[1]?.value || "0", 10),
        bounce_rate: Number(bouncePct.toFixed(1)),
        avg_session: Math.round(parseFloat(kpi[3]?.value || "0")),
        top_pages:
          pagesResponse.rows?.map((r) => ({
            path: r.dimensionValues?.[0]?.value || "/",
            views: parseInt(r.metricValues?.[0]?.value || "0", 10),
            avg_time: Math.round(
              parseFloat(r.metricValues?.[1]?.value || "0")
            ),
          })) || [],
        traffic_sources:
          sourcesResponse.rows?.map((r) => ({
            source: r.dimensionValues?.[0]?.value || "Unknown",
            users: parseInt(r.metricValues?.[0]?.value || "0", 10),
          })) || [],
        devices:
          devicesResponse.rows?.map((r) => ({
            device: r.dimensionValues?.[0]?.value || "unknown",
            users: parseInt(r.metricValues?.[0]?.value || "0", 10),
          })) || [],
      };
    } catch (err) {
      console.error("GA4 error:", err.message);
      return {
        status: "error",
        error: err.message,
        period,
        visitors: null,
        pageviews: null,
        bounce_rate: null,
        avg_session: null,
        top_pages: [],
        traffic_sources: [],
        devices: [],
      };
    }
  });

  // GET /admin/analytics/realtime — visiteurs actifs + stats du jour
  fastify.get("/admin/analytics/realtime", async (request, reply) => {
    if (!checkAdmin(request, reply)) return reply;

    const propertyId = process.env.GA4_PROPERTY_ID;
    if (!propertyId || !hasGaCredentials()) {
      return { active_users: null, today_users: null, today_pageviews: null };
    }

    try {
      const client = getAnalyticsClient();
      const property = `properties/${propertyId}`;

      const [realtimeResponse] = await client.runRealtimeReport({
        property,
        metrics: [{ name: "activeUsers" }],
      });

      const [todayResponse] = await client.runReport({
        property,
        dateRanges: [{ startDate: "today", endDate: "today" }],
        metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
      });

      const activeNow = parseInt(
        realtimeResponse.rows?.[0]?.metricValues?.[0]?.value || "0",
        10
      );
      const todayKpi = todayResponse.rows?.[0]?.metricValues || [];

      return {
        active_users: activeNow,
        today_users: parseInt(todayKpi[0]?.value || "0", 10),
        today_pageviews: parseInt(todayKpi[1]?.value || "0", 10),
      };
    } catch (err) {
      console.error("GA4 realtime error:", err.message);
      return { active_users: null, today_users: null, today_pageviews: null };
    }
  });

  // GET /admin/export/orders?from=2026-01-01&to=2026-12-31
  fastify.get("/admin/export/orders", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;

    const { from, to } = request.query || {};
    const fromDate = from || "2000-01-01";
    const toDate = to || new Date().toISOString().split("T")[0];

    // Colonnes optionnelles (compat anciennes DB)
    await pool.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cents INTEGER DEFAULT 490;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cents INTEGER DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code VARCHAR(50);
    `);

    const { rows } = await pool.query(
      `SELECT
         to_char(created_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY') AS date,
         to_char(created_at AT TIME ZONE 'Europe/Paris', 'HH24:MI') AS heure,
         id::text AS reference,
         customer_email AS client,
         customer_name AS nom,
         status AS statut,
         ROUND(total_cents / 100.0, 2) AS total_ttc,
         ROUND(COALESCE(shipping_cents, 490) / 100.0, 2) AS frais_port,
         COALESCE(promo_code, '') AS code_promo,
         ROUND(COALESCE(discount_cents, 0) / 100.0, 2) AS remise
       FROM orders
       WHERE created_at >= $1::timestamptz
         AND created_at <= ($2 || ' 23:59:59')::timestamptz
       ORDER BY created_at DESC`,
      [fromDate, toDate]
    );

    const headers = [
      "Date",
      "Heure",
      "Référence",
      "Client",
      "Nom",
      "Statut",
      "Total (€)",
      "Frais de port (€)",
      "Code promo",
      "Remise (€)",
    ];

    const csvRows = rows.map((r) => [
      r.date,
      r.heure,
      r.reference,
      r.client || "",
      r.nom || "",
      r.statut,
      r.total_ttc,
      r.frais_port ?? "4.90",
      r.code_promo || "",
      r.remise ?? "0.00",
    ]);

    const csv = [headers, ...csvRows]
      .map((row) =>
        row
          .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
          .join(";")
      )
      .join("\n");

    const bom = "\uFEFF";
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="boutique-ventes-${fromDate}-${toDate}.csv"`
      )
      .send(bom + csv);
  });

  /** Liste des paniers abandonnés */
  fastify.get("/admin/abandoned-carts", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;

    const { rows } = await pool.query(
      `SELECT
         id, email, customer_name, items, total_cents, promo_code, discount_cents,
         reminder_sent, reminder_sent_at, converted, created_at, updated_at,
         CASE
           WHEN converted THEN 'converted'
           WHEN reminder_sent THEN 'reminded'
           ELSE 'pending'
         END AS status,
         (NOT converted AND NOT reminder_sent AND updated_at < NOW() - INTERVAL '1 hour') AS overdue
       FROM abandoned_carts
       ORDER BY updated_at DESC
       LIMIT 200`
    );

    const pending = rows.filter((r) => r.status === "pending").length;
    const overdue = rows.filter((r) => r.overdue).length;

    return {
      carts: rows,
      counts: { pending, overdue, total: rows.length },
    };
  });

  /** Clients inactifs (pas de commande depuis N jours) */
  fastify.get("/admin/inactive-customers", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;

    const days = Math.min(
      365,
      Math.max(1, parseInt(String(request.query.days || "60"), 10) || 60)
    );

    const { rows } = await pool.query(
      `SELECT
         customer_email,
         MAX(customer_name) AS customer_name,
         COUNT(*)::int AS total_orders,
         COALESCE(SUM(total_cents), 0)::int AS total_spent_cents,
         MAX(created_at) AS last_order_at,
         (EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 86400)::int AS days_inactive
       FROM orders
       WHERE status IN ('delivered', 'shipped', 'paid', 'preparation')
         AND customer_email IS NOT NULL
         AND TRIM(customer_email) <> ''
       GROUP BY customer_email
       HAVING MAX(created_at) < NOW() - make_interval(days => $1)
       ORDER BY MAX(created_at) ASC`,
      [days]
    );

    return rows.map((r) => ({
      email: r.customer_email,
      name: r.customer_name,
      total_orders: Number(r.total_orders) || 0,
      total_spent_cents: Number(r.total_spent_cents) || 0,
      last_order_at: r.last_order_at,
      days_inactive: Number(r.days_inactive) || 0,
    }));
  });

  /** Relancer des clients inactifs par email */
  fastify.post("/admin/inactive-customers/remind", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;

    const emails = Array.isArray(request.body?.emails)
      ? request.body.emails
          .map((e) => String(e || "").trim().toLowerCase())
          .filter(Boolean)
      : [];

    if (!emails.length) {
      return reply.code(400).send({ error: "emails requis" });
    }

    let sent = 0;
    const errors = [];

    for (const email of emails) {
      try {
        const { rows } = await pool.query(
          `SELECT
             MAX(customer_name) AS customer_name,
             (EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 86400)::int AS days_inactive
           FROM orders
           WHERE LOWER(customer_email) = $1
             AND status IN ('delivered', 'shipped', 'paid', 'preparation')
           GROUP BY LOWER(customer_email)`,
          [email]
        );
        const row = rows[0];
        await sendInactiveCustomerEmail({
          email,
          customerName: row?.customer_name || null,
          daysSince: Number(row?.days_inactive) || 60,
        });
        sent++;
      } catch (err) {
        console.error("Relance client inactive échouée:", email, err);
        errors.push(email);
      }
    }

    return { success: true, sent, failed: errors.length, errors };
  });

  /** Données graphiques KPI dashboard */
  fastify.get("/admin/stats/chart", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;

    const days = Math.min(
      365,
      Math.max(1, parseInt(String(request.query.days || "30"), 10) || 30)
    );

    const revenueChart = await pool.query(
      `SELECT
         DATE(created_at) AS date,
         COUNT(*)::int AS orders,
         COALESCE(SUM(total_cents), 0)::int AS revenue_cents
       FROM orders
       WHERE created_at >= NOW() - make_interval(days => $1)
         AND status NOT IN ('cancelled', 'refunded', 'pending')
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [days]
    );

    const topProducts = await pool.query(
      `SELECT
         COALESCE(item->>'name', 'Produit') AS name,
         SUM(COALESCE((item->>'quantity')::int, 1))::int AS qty
       FROM orders,
         jsonb_array_elements(items) AS item
       WHERE created_at >= DATE_TRUNC('month', NOW())
         AND status NOT IN ('cancelled', 'refunded', 'pending')
       GROUP BY COALESCE(item->>'name', 'Produit')
       ORDER BY qty DESC
       LIMIT 5`
    );

    return {
      revenue_chart: revenueChart.rows.map((r) => ({
        date:
          r.date instanceof Date
            ? r.date.toISOString().slice(0, 10)
            : String(r.date).slice(0, 10),
        orders: Number(r.orders) || 0,
        revenue: Math.round((Number(r.revenue_cents) || 0) / 100),
      })),
      top_products: topProducts.rows.map((r) => ({
        name: r.name,
        qty: Number(r.qty) || 0,
      })),
    };
  });

  /** Paramètres boutique (admin) */
  fastify.get("/admin/settings", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    return getSettings();
  });

  fastify.put("/admin/settings", async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const body = request.body || {};
    const updates = {};
    if (body.google_review_url !== undefined) {
      updates.google_review_url = String(body.google_review_url || "").trim();
    }
    for (const key of [
      "popup_enabled",
      "popup_discount",
      "popup_delay",
      "popup_title",
      "popup_subtitle",
    ]) {
      if (body[key] !== undefined) {
        updates[key] = String(body[key] ?? "").trim();
      }
    }
    if (!Object.keys(updates).length) {
      return reply.code(400).send({ error: "Aucun paramètre à modifier" });
    }
    await setSettings(updates);
    return getSettings();
  });
}
