/**
 * Analyse des liens internes des articles publiés.
 * Réutilise sanitizeHref / replaceMarkdownLinks / isExternalHref / extractMarkdownLinks.
 */

import pool from "../../db/pool.js";
import {
  extractMarkdownLinks,
  isExternalHref,
  sanitizeHref,
} from "../blogSanitize.js";

/** Pages boutique connues (hors produit / catégorie / article). */
export const BOUTIQUE_PAGE_PATHS = new Set([
  "/",
  "/boutique",
  "/blog",
  "/a-propos",
  "/contact",
  "/faq",
  "/livraison",
  "/retours",
  "/avis-clients",
  "/avis",
  "/fidelite",
  "/mentions-legales",
  "/cgv",
  "/politique-de-confidentialite",
]);

/**
 * @typedef {'product'|'category'|'boutique'|'article'|'external'|'other'} LinkKind
 */

/**
 * Normalise un href vers un chemin relatif boutique si possible.
 * @param {string} href
 * @param {string} [siteUrl]
 * @returns {{ path: string, search: string, external: boolean, absolute: boolean }|null}
 */
export function normalizeBoutiqueHref(href, siteUrl = "") {
  const safe = sanitizeHref(href);
  if (!safe) return null;

  if (safe.startsWith("mailto:") || safe.startsWith("#")) {
    return { path: safe, search: "", external: false, absolute: false };
  }

  if (isExternalHref(safe)) {
    try {
      const u = new URL(safe);
      const site = String(siteUrl || "").trim();
      if (site) {
        const base = new URL(site.startsWith("http") ? site : `https://${site}`);
        if (u.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "")) {
          return {
            path: u.pathname || "/",
            search: u.search || "",
            external: false,
            absolute: true,
          };
        }
      }
      return { path: safe, search: "", external: true, absolute: true };
    } catch {
      return { path: safe, search: "", external: true, absolute: true };
    }
  }

  if (safe.startsWith("?")) {
    return { path: "/boutique", search: safe, external: false, absolute: false };
  }

  const q = safe.indexOf("?");
  if (q >= 0) {
    return {
      path: safe.slice(0, q) || "/",
      search: safe.slice(q),
      external: false,
      absolute: false,
    };
  }
  return { path: safe, search: "", external: false, absolute: false };
}

/**
 * @param {string} href
 * @param {{
 *   products: Map<string,{name:string,active:boolean,featured?:boolean}>,
 *   categories: Map<string,{name:string,active:boolean}>,
 *   articles: Map<string,{title:string,status:string}>,
 *   siteUrl?: string,
 * }} catalog
 */
export function classifyLink(href, catalog) {
  const norm = normalizeBoutiqueHref(href, catalog.siteUrl || "");
  if (!norm) {
    return {
      kind: /** @type {LinkKind} */ ("other"),
      href: String(href || ""),
      slug: null,
      name: null,
      broken: true,
      reason: "lien_invalide",
    };
  }

  if (norm.external) {
    return {
      kind: /** @type {LinkKind} */ ("external"),
      href: norm.path,
      slug: null,
      name: null,
      broken: false,
      reason: null,
    };
  }

  if (norm.path.startsWith("mailto:") || norm.path.startsWith("#")) {
    return {
      kind: /** @type {LinkKind} */ ("other"),
      href: norm.path,
      slug: null,
      name: null,
      broken: false,
      reason: null,
    };
  }

  const path = norm.path.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(
    norm.search.startsWith("?") ? norm.search.slice(1) : norm.search,
  );

  // Produit
  const productMatch = path.match(/^\/produits\/([^/]+)$/);
  if (productMatch) {
    const slug = decodeURIComponent(productMatch[1]);
    const p = catalog.products.get(slug);
    if (!p) {
      return {
        kind: "product",
        href: `/produits/${slug}`,
        slug,
        name: null,
        broken: true,
        reason: "produit_inexistant",
      };
    }
    if (!p.active) {
      return {
        kind: "product",
        href: `/produits/${slug}`,
        slug,
        name: p.name,
        broken: true,
        reason: "produit_inactif",
      };
    }
    return {
      kind: "product",
      href: `/produits/${slug}`,
      slug,
      name: p.name,
      broken: false,
      reason: null,
    };
  }

  // Catégorie : /boutique?category=slug
  const catSlug = params.get("category");
  if (
    (path === "/boutique" || path === "/") &&
    catSlug &&
    String(catSlug).trim()
  ) {
    const slug = String(catSlug).trim();
    const c = catalog.categories.get(slug);
    if (!c) {
      return {
        kind: "category",
        href: `/boutique?category=${encodeURIComponent(slug)}`,
        slug,
        name: null,
        broken: true,
        reason: "categorie_inexistante",
      };
    }
    if (!c.active) {
      return {
        kind: "category",
        href: `/boutique?category=${encodeURIComponent(slug)}`,
        slug,
        name: c.name,
        broken: true,
        reason: "categorie_inactive",
      };
    }
    return {
      kind: "category",
      href: `/boutique?category=${encodeURIComponent(slug)}`,
      slug,
      name: c.name,
      broken: false,
      reason: null,
    };
  }

  // Article
  const articleMatch = path.match(/^\/blog\/([^/]+)$/);
  if (articleMatch) {
    const slug = decodeURIComponent(articleMatch[1]);
    const a = catalog.articles.get(slug);
    if (!a || a.status !== "published") {
      return {
        kind: "article",
        href: `/blog/${slug}`,
        slug,
        name: a?.title || null,
        broken: true,
        reason: a ? "article_non_publie" : "article_inexistant",
      };
    }
    return {
      kind: "article",
      href: `/blog/${slug}`,
      slug,
      name: a.title,
      broken: false,
      reason: null,
    };
  }

  // Page boutique
  if (BOUTIQUE_PAGE_PATHS.has(path) || path === "/boutique") {
    return {
      kind: "boutique",
      href: path === "/" ? "/" : path,
      slug: null,
      name: path === "/" ? "Accueil" : path.slice(1),
      broken: false,
      reason: null,
    };
  }

  // Chemin relatif inconnu → considéré boutique cassée / autre
  return {
    kind: "boutique",
    href: path + (norm.search || ""),
    slug: null,
    name: null,
    broken: true,
    reason: "page_inconnue",
  };
}

function emptyCounts() {
  return { product: 0, category: 0, boutique: 0, article: 0, total: 0 };
}

function bump(counts, kind) {
  if (kind === "product" || kind === "category" || kind === "boutique" || kind === "article") {
    counts[kind] += 1;
    counts.total += 1;
  }
}

/**
 * Analyse pure (sans DB) — utilisable en tests.
 * @param {{
 *   articles: Array<{
 *     id?: number|string,
 *     title: string,
 *     slug: string,
 *     status?: string,
 *     excerpt?: string,
 *     sections?: unknown,
 *     faq?: unknown,
 *     cta_url?: string|null,
 *     related_slug?: string|null,
 *     impressions?: number,
 *   }>,
 *   products: Array<{slug:string,name:string,active?:boolean,featured?:boolean}>,
 *   categories: Array<{slug:string,name:string,active?:boolean}>,
 *   siteUrl?: string,
 * }} input
 */
export function analyzeInternalLinks(input) {
  const siteUrl = String(input.siteUrl || "");
  const products = new Map();
  for (const p of input.products || []) {
    const slug = String(p.slug || "").trim();
    if (!slug) continue;
    products.set(slug, {
      name: String(p.name || slug),
      active: p.active !== false,
      featured: Boolean(p.featured),
    });
  }
  const categories = new Map();
  for (const c of input.categories || []) {
    const slug = String(c.slug || "").trim();
    if (!slug) continue;
    categories.set(slug, {
      name: String(c.name || slug),
      active: c.active !== false,
    });
  }
  const articlesMap = new Map();
  for (const a of input.articles || []) {
    const slug = String(a.slug || "").trim();
    if (!slug) continue;
    articlesMap.set(slug, {
      title: String(a.title || slug),
      status: String(a.status || "published"),
    });
  }

  const catalog = { products, categories, articles: articlesMap, siteUrl };

  /** @type {Set<string>} */
  const citedProducts = new Set();
  /** @type {Set<string>} */
  const citedCategories = new Set();

  const broken_links = [];
  const per_article = [];
  let articles_with_product_link = 0;
  let articles_with_any_internal = 0;
  let external_total = 0;

  const published = (input.articles || []).filter(
    (a) => !a.status || a.status === "published",
  );

  for (const article of published) {
    const counts = emptyCounts();
    let product_ok = 0;
    let external = 0;
    const links_detail = [];

    /**
     * @param {string} href
     * @param {{source:string, section_h2?:string|null, label?:string}} meta
     */
    function ingest(href, meta) {
      const raw = String(href || "").trim();
      if (!raw) return;
      const classified = classifyLink(raw, catalog);
      const entry = {
        ...classified,
        source: meta.source,
        section_h2: meta.section_h2 || null,
        label: meta.label || null,
      };
      links_detail.push(entry);

      if (classified.kind === "external") {
        external += 1;
        external_total += 1;
        return;
      }
      if (classified.kind === "other") return;

      // Intention de lien interne (y compris cassé)
      bump(counts, classified.kind);

      if (classified.broken) {
        broken_links.push({
          article_id: article.id ?? null,
          article_title: article.title,
          article_slug: article.slug,
          section_h2: meta.section_h2 || null,
          source: meta.source,
          href: classified.href,
          kind: classified.kind,
          reason: classified.reason,
          label: meta.label || null,
        });
        return;
      }

      if (classified.kind === "product" && classified.slug) {
        product_ok += 1;
        citedProducts.add(classified.slug);
      }
      if (classified.kind === "category" && classified.slug) {
        citedCategories.add(classified.slug);
      }
    }

    // Texte : excerpt
    for (const link of extractMarkdownLinks(article.excerpt || "")) {
      ingest(link.href, {
        source: "excerpt",
        section_h2: null,
        label: link.label,
      });
    }

    // Sections
    const sections = Array.isArray(article.sections) ? article.sections : [];
    for (const section of sections) {
      const h2 = String(section?.h2 || "").trim() || null;
      for (const link of extractMarkdownLinks(section?.text || "")) {
        ingest(link.href, {
          source: "section",
          section_h2: h2,
          label: link.label,
        });
      }
    }

    // FAQ
    const faq = Array.isArray(article.faq) ? article.faq : [];
    for (const item of faq) {
      for (const link of extractMarkdownLinks(item?.answer || "")) {
        ingest(link.href, {
          source: "faq",
          section_h2: String(item?.question || "").trim() || null,
          label: link.label,
        });
      }
    }

    // CTA (haut / milieu / bas = même cta_url)
    if (article.cta_url) {
      ingest(String(article.cta_url), {
        source: "cta",
        section_h2: null,
        label: null,
      });
    }

    // Article connexe
    if (article.related_slug) {
      const rel = String(article.related_slug).trim();
      if (rel) {
        ingest(`/blog/${rel}`, {
          source: "related_slug",
          section_h2: null,
          label: null,
        });
      }
    }

    if (product_ok > 0) articles_with_product_link += 1;
    if (counts.total > 0) articles_with_any_internal += 1;

    per_article.push({
      id: article.id ?? null,
      title: article.title,
      slug: article.slug,
      impressions: Number(article.impressions) || 0,
      internal: counts,
      product_ok,
      external,
      has_product_link: product_ok > 0,
      has_internal_link: counts.total > 0,
      links: links_detail,
    });
  }

  const articles_without_internal = per_article
    .filter((a) => !a.has_internal_link)
    .map((a) => ({
      id: a.id,
      title: a.title,
      slug: a.slug,
      impressions: a.impressions,
    }));

  const uncited_products_fixed = [];
  for (const [slug, p] of products.entries()) {
    if (!p.active) continue;
    if (citedProducts.has(slug)) continue;
    uncited_products_fixed.push({
      slug,
      name: p.name,
      featured: Boolean(p.featured),
      path: `/produits/${slug}`,
    });
  }
  uncited_products_fixed.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return a.name.localeCompare(b.name, "fr");
  });

  const uncited_categories = [];
  for (const [slug, c] of categories.entries()) {
    if (!c.active) continue;
    if (citedCategories.has(slug)) continue;
    uncited_categories.push({
      slug,
      name: c.name,
      path: `/boutique?category=${encodeURIComponent(slug)}`,
    });
  }
  uncited_categories.sort((a, b) => a.name.localeCompare(b.name, "fr"));

  // Suggestions de remplacement pour liens cassés
  const activeProducts = [...products.entries()]
    .filter(([, p]) => p.active)
    .map(([slug, p]) => ({ slug, name: p.name, path: `/produits/${slug}`, featured: p.featured }));
  const activeCategories = [...categories.entries()]
    .filter(([, c]) => c.active)
    .map(([slug, c]) => ({
      slug,
      name: c.name,
      path: `/boutique?category=${encodeURIComponent(slug)}`,
    }));
  const publishedArticles = [...articlesMap.entries()]
    .filter(([, a]) => a.status === "published")
    .map(([slug, a]) => ({ slug, name: a.title, path: `/blog/${slug}` }));

  function suggestReplacement(broken) {
    if (broken.kind === "product" && activeProducts.length) {
      const featured = activeProducts.find((p) => p.featured);
      return featured || activeProducts[0];
    }
    if (broken.kind === "category" && activeCategories.length) {
      return activeCategories[0];
    }
    if (broken.kind === "article" && publishedArticles.length) {
      return publishedArticles.find((a) => a.slug !== broken.article_slug) || publishedArticles[0];
    }
    if (activeProducts.length) return activeProducts[0];
    return { slug: null, name: "Boutique", path: "/boutique" };
  }

  const broken_with_suggestions = broken_links.map((b) => {
    const replacement = suggestReplacement(b);
    return {
      ...b,
      reason_label: reasonLabel(b.reason),
      replacement_name: replacement.name,
      replacement_path: replacement.path,
    };
  });

  const total_articles = per_article.length;

  return {
    summary: {
      articles_total: total_articles,
      articles_with_product_link,
      articles_with_any_internal,
      articles_without_internal: articles_without_internal.length,
      uncited_products: uncited_products_fixed.length,
      uncited_categories: uncited_categories.length,
      broken_links: broken_with_suggestions.length,
      external_links: external_total,
      // Indicateur vendeur
      indicator: {
        label:
          "Articles avec au moins un lien vers vos produits",
        x: articles_with_product_link,
        y: total_articles,
        text: `Articles avec au moins un lien vers vos produits : ${articles_with_product_link} sur ${total_articles}`,
      },
    },
    per_article,
    articles_without_internal,
    uncited_products: uncited_products_fixed,
    uncited_categories,
    broken_links: broken_with_suggestions,
    catalog_sample: {
      products: activeProducts.slice(0, 40),
      categories: activeCategories.slice(0, 30),
      articles: publishedArticles.slice(0, 30),
      boutique_pages: [...BOUTIQUE_PAGE_PATHS].map((p) => ({
        path: p,
        name: p === "/" ? "Accueil" : p.slice(1),
      })),
    },
  };
}

function reasonLabel(reason) {
  switch (reason) {
    case "produit_inexistant":
    case "produit_inactif":
      return "produit supprimé ou désactivé";
    case "categorie_inexistante":
    case "categorie_inactive":
      return "catégorie introuvable ou désactivée";
    case "article_inexistant":
      return "article inexistant";
    case "article_non_publie":
      return "article non publié";
    case "page_inconnue":
      return "page introuvable dans la boutique";
    case "lien_invalide":
      return "lien invalide";
    default:
      return reason || "lien cassé";
  }
}

/**
 * Charge le catalogue + articles et calcule le bilan.
 * @param {{ siteUrl?: string, impressionsBySlug?: Map<string,number> }} [opts]
 */
export async function buildInternalLinksReport(opts = {}) {
  const siteUrl =
    opts.siteUrl ||
    process.env.SITE_URL ||
    "";

  const [productsRes, categoriesRes, articlesRes] = await Promise.all([
    pool.query(
      `SELECT slug, name, active, featured
       FROM products
       WHERE slug IS NOT NULL AND btrim(slug) <> ''
       ORDER BY featured DESC, name ASC`,
    ),
    pool.query(
      `SELECT slug, name, COALESCE(active, true) AS active
       FROM categories
       WHERE slug IS NOT NULL AND btrim(slug) <> ''
       ORDER BY name ASC`,
    ),
    pool.query(
      `SELECT id, title, slug, status, excerpt, sections, faq,
              cta_url, related_slug
       FROM blog_posts
       WHERE status = 'published'
       ORDER BY published_at DESC NULLS LAST`,
    ),
  ]);

  // Catégories aussi présentes via products.category (legacy)
  const catMap = new Map(
    categoriesRes.rows.map((r) => [String(r.slug), r]),
  );
  try {
    const { rows: productCats } = await pool.query(
      `SELECT DISTINCT category AS slug
       FROM products
       WHERE active = true AND category IS NOT NULL AND btrim(category) <> ''`,
    );
    for (const row of productCats) {
      const slug = String(row.slug);
      if (!catMap.has(slug)) {
        catMap.set(slug, { slug, name: slug, active: true });
      }
    }
  } catch {
    // ignore
  }

  const impressionsBySlug = opts.impressionsBySlug || new Map();

  const articles = articlesRes.rows.map((a) => ({
    ...a,
    impressions: impressionsBySlug.get(String(a.slug)) || 0,
  }));

  return analyzeInternalLinks({
    articles,
    products: productsRes.rows,
    categories: [...catMap.values()],
    siteUrl,
  });
}

/**
 * Version allégée pour le contexte IA (tokens).
 */
export function slimInternalLinksForAi(report, articlesWithSections = []) {
  if (!report) return null;

  const sectionBySlug = new Map(
    (articlesWithSections || []).map((a) => [a.slug, a]),
  );

  const articles_needing_links = (report.per_article || [])
    .filter((a) => !a.has_product_link || !a.has_internal_link)
    .sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
    .slice(0, 12)
    .map((a) => {
      const full = sectionBySlug.get(a.slug);
      const sections = Array.isArray(full?.sections) ? full.sections : [];
      return {
        title: a.title,
        slug: a.slug,
        impressions: a.impressions,
        has_product_link: a.has_product_link,
        has_internal_link: a.has_internal_link,
        internal: a.internal,
        sections: sections.slice(0, 6).map((s) => ({
          h2: String(s?.h2 || "").trim(),
          text: String(s?.text || "").slice(0, 600),
        })),
      };
    });

  return {
    summary: report.summary,
    articles_without_internal: (report.articles_without_internal || []).slice(0, 15),
    uncited_products: (report.uncited_products || []).slice(0, 20),
    uncited_categories: (report.uncited_categories || []).slice(0, 15),
    broken_links: (report.broken_links || []).slice(0, 15),
    catalog_sample: report.catalog_sample,
    articles_needing_links,
  };
}
