/**
 * Lecture seule — bilan maillage Couleurs Enchantées via API publique.
 * Usage: node scripts/proof-internal-links-ce.mjs
 */
import { analyzeInternalLinks } from "../src/lib/seo/internal-links.js";

const BASE =
  process.env.CE_API_URL ||
  "https://couleursenchantees-api-production.up.railway.app";

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

const list = await getJson("/blog");
const products = await getJson("/products");
let categories = [];
try {
  categories = await getJson("/categories");
} catch {
  categories = [];
}

const articles = [];
for (const row of list) {
  if (row.status && row.status !== "published") continue;
  const full = await getJson(`/blog/${encodeURIComponent(row.slug)}`);
  articles.push(full);
}

const report = analyzeInternalLinks({
  siteUrl: "https://couleursenchantees.fr",
  articles,
  products: (Array.isArray(products) ? products : []).map((p) => ({
    slug: p.slug,
    name: p.name,
    active: p.active !== false,
    featured: Boolean(p.featured),
  })),
  categories: (Array.isArray(categories) ? categories : []).map((c) => ({
    slug: c.slug,
    name: c.name,
    active: c.active !== false,
  })),
});

const out = {
  source: BASE,
  fetched_at: new Date().toISOString(),
  articles_fetched: articles.length,
  products: Array.isArray(products) ? products.length : 0,
  categories: Array.isArray(categories) ? categories.length : 0,
  summary: report.summary,
  articles_without_internal: report.articles_without_internal,
  uncited_products_sample: report.uncited_products.slice(0, 10),
  uncited_categories: report.uncited_categories,
  broken_links: report.broken_links,
  per_article: report.per_article.map((a) => ({
    slug: a.slug,
    title: a.title,
    internal: a.internal,
    product_ok: a.product_ok,
    external: a.external,
    has_product_link: a.has_product_link,
    has_internal_link: a.has_internal_link,
  })),
};

console.log(JSON.stringify(out, null, 2));
