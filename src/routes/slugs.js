import pool from "../db/pool.js";
import { checkAdmin } from "../lib/adminAuth.js";

const STATIC_PAGES = [
  { label: "Accueil", slug: "/" },
  { label: "Boutique", slug: "/boutique" },
  { label: "Blog", slug: "/blog" },
  { label: "À propos", slug: "/a-propos" },
  { label: "Contact", slug: "/contact" },
  { label: "FAQ", slug: "/faq" },
  { label: "Livraison", slug: "/livraison" },
  { label: "Retours & échanges", slug: "/retours" },
  { label: "Avis clients", slug: "/avis-clients" },
  { label: "Laisser un avis", slug: "/avis" },
  { label: "Programme fidélité", slug: "/fidelite" },
  { label: "Mentions légales", slug: "/mentions-legales" },
  { label: "CGV", slug: "/cgv" },
  { label: "Politique de confidentialité", slug: "/politique-de-confidentialite" },
];

const TYPE_ORDER = {
  page: 0,
  category: 1,
  product: 2,
  article: 3,
};

function byLabel(a, b) {
  return a.label.localeCompare(b.label, "fr", { sensitivity: "base" });
}

function prefix(typeLabel, name) {
  return `${typeLabel} — ${name}`;
}

async function safeQuery(sql, params = []) {
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } catch (err) {
    console.warn("[slugs]", err.message);
    return [];
  }
}

async function listSlugs() {
  const [productRows, categoryRows, productCategoryRows, articleRows] =
    await Promise.all([
      safeQuery(
        `SELECT slug, name
         FROM products
         WHERE active = true AND slug IS NOT NULL AND btrim(slug) <> ''
         ORDER BY name ASC`
      ),
      safeQuery(
        `SELECT slug, name
         FROM categories
         WHERE active = true AND slug IS NOT NULL AND btrim(slug) <> ''`
      ),
      safeQuery(
        `SELECT DISTINCT category AS slug
         FROM products
         WHERE active = true AND category IS NOT NULL AND btrim(category) <> ''`
      ),
      safeQuery(
        `SELECT slug, title
         FROM blog_posts
         WHERE status = 'published' AND slug IS NOT NULL AND btrim(slug) <> ''
         ORDER BY title ASC`
      ),
    ]);

  const pages = STATIC_PAGES.map((p) => ({
    type: "page",
    label: prefix("Page", p.label),
    slug: p.slug,
  })).sort(byLabel);

  const categoryNames = new Map(
    categoryRows.map((r) => [String(r.slug), String(r.name || r.slug)])
  );
  for (const row of productCategoryRows) {
    const slug = String(row.slug);
    if (!categoryNames.has(slug)) categoryNames.set(slug, slug);
  }

  const categories = [...categoryNames.entries()]
    .map(([slug, name]) => ({
      type: "category",
      label: prefix("Catégorie", name),
      slug: `/boutique?category=${encodeURIComponent(slug)}`,
    }))
    .sort(byLabel);

  const products = productRows
    .map((r) => ({
      type: "product",
      label: prefix("Produit", r.name || r.slug),
      slug: `/produits/${r.slug}`,
    }))
    .sort(byLabel);

  const articles = articleRows
    .map((r) => ({
      type: "article",
      label: prefix("Article", r.title || r.slug),
      slug: `/blog/${r.slug}`,
    }))
    .sort(byLabel);

  return [...pages, ...categories, ...products, ...articles]
    .sort((a, b) => {
      const dt = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
      if (dt !== 0) return dt;
      return byLabel(a, b);
    })
    .map(({ label, slug }) => ({ label, slug }));
}

async function slugsHandler(request, reply) {
  if (!(await checkAdmin(request, reply))) return reply;
  reply.header("Cache-Control", "private, no-store");
  return listSlugs();
}

export default async function slugsRoutes(fastify) {
  fastify.get("/slugs", slugsHandler);
  fastify.get("/api/slugs", slugsHandler);
}
