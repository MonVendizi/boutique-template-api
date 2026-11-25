import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeInternalLinks,
  classifyLink,
  normalizeBoutiqueHref,
} from "./internal-links.js";

const catalogBase = {
  products: new Map([
    ["mandala", { name: "Mandala", active: true, featured: true }],
    ["boite", { name: "Boîte peinte", active: true, featured: false }],
    ["supprime", { name: "Ancien", active: false, featured: false }],
  ]),
  categories: new Map([
    ["tableaux", { name: "Tableaux", active: true }],
    ["bois", { name: "Bois", active: true }],
  ]),
  articles: new Map([
    ["guide-a", { title: "Guide A", status: "published" }],
    ["guide-b", { title: "Guide B", status: "published" }],
    ["sans-lien", { title: "Sans lien", status: "published" }],
  ]),
  siteUrl: "https://exemple.fr",
};

describe("normalizeBoutiqueHref", () => {
  it("reconnaît un URL absolu de la boutique comme interne", () => {
    const n = normalizeBoutiqueHref(
      "https://exemple.fr/produits/mandala",
      "https://exemple.fr",
    );
    assert.equal(n?.external, false);
    assert.equal(n?.path, "/produits/mandala");
  });

  it("marque un autre domaine comme externe", () => {
    const n = normalizeBoutiqueHref("https://vendizi.fr/tarifs", "https://exemple.fr");
    assert.equal(n?.external, true);
  });
});

describe("classifyLink", () => {
  it("classe produit / catégorie / article / boutique", () => {
    assert.equal(classifyLink("/produits/mandala", catalogBase).kind, "product");
    assert.equal(
      classifyLink("/boutique?category=tableaux", catalogBase).kind,
      "category",
    );
    assert.equal(classifyLink("/blog/guide-b", catalogBase).kind, "article");
    assert.equal(classifyLink("/boutique", catalogBase).kind, "boutique");
    assert.equal(classifyLink("https://autre.fr", catalogBase).kind, "external");
  });

  it("détecte produit inactif / inexistant", () => {
    assert.equal(classifyLink("/produits/supprime", catalogBase).broken, true);
    assert.equal(
      classifyLink("/produits/supprime", catalogBase).reason,
      "produit_inactif",
    );
    assert.equal(
      classifyLink("/produits/ghost", catalogBase).reason,
      "produit_inexistant",
    );
  });
});

describe("analyzeInternalLinks — scénario boutique de test", () => {
  const report = analyzeInternalLinks({
    siteUrl: "https://exemple.fr",
    products: [
      { slug: "mandala", name: "Mandala", active: true, featured: true },
      { slug: "boite", name: "Boîte peinte", active: true, featured: false },
      { slug: "supprime", name: "Ancien", active: false },
    ],
    categories: [
      { slug: "tableaux", name: "Tableaux", active: true },
      { slug: "bois", name: "Bois", active: true },
    ],
    articles: [
      {
        id: 1,
        title: "Sans lien",
        slug: "sans-lien",
        status: "published",
        sections: [
          {
            h2: "Introduction",
            text: "Un article sans aucun lien vers la boutique.",
          },
        ],
        excerpt: "Extrait simple.",
        impressions: 10,
      },
      {
        id: 2,
        title: "Avec produit",
        slug: "avec-produit",
        status: "published",
        sections: [
          {
            h2: "Découvrir",
            text: "Regardez le [mandala](/produits/mandala) peint à la main.",
          },
        ],
        impressions: 100,
      },
      {
        id: 3,
        title: "CTA catégorie",
        slug: "cta-categorie",
        status: "published",
        sections: [{ h2: "Suite", text: "Texte sans lien markdown." }],
        cta_url: "/boutique?category=tableaux",
        impressions: 50,
      },
      {
        id: 4,
        title: "Lien cassé + orphelin",
        slug: "casse-orphelin",
        status: "published",
        sections: [
          {
            h2: "Ancien produit",
            text: "Voir [cette pièce](/produits/ghost-gone).",
          },
        ],
        related_slug: "article-disparu",
        impressions: 5,
      },
    ],
  });

  it("compte les articles avec lien produit valide", () => {
    assert.equal(report.summary.articles_total, 4);
    // seul « avec-produit » a un vrai lien produit ; le cassé ne compte pas pour l’indicateur
    assert.equal(report.summary.articles_with_product_link, 1);
    assert.match(
      report.summary.indicator.text,
      /Articles avec au moins un lien vers vos produits : 1 sur 4/,
    );
  });

  it("liste l'article sans lien interne", () => {
    const slugs = report.articles_without_internal.map((a) => a.slug);
    assert.ok(slugs.includes("sans-lien"));
    // cta-categorie a un lien catégorie → pas dans without
    assert.ok(!slugs.includes("cta-categorie"));
  });

  it("détecte produits jamais cités (boite) et catégories jamais citées (bois)", () => {
    assert.ok(report.uncited_products.some((p) => p.slug === "boite"));
    assert.ok(!report.uncited_products.some((p) => p.slug === "mandala"));
    assert.ok(!report.uncited_products.some((p) => p.slug === "supprime"));
    assert.ok(report.uncited_categories.some((c) => c.slug === "bois"));
    assert.ok(!report.uncited_categories.some((c) => c.slug === "tableaux"));
  });

  it("détecte lien produit cassé et related_slug orphelin", () => {
    const reasons = report.broken_links.map((b) => b.reason);
    assert.ok(reasons.includes("produit_inexistant"));
    assert.ok(reasons.includes("article_inexistant"));
    const orphan = report.broken_links.find((b) => b.source === "related_slug");
    assert.ok(orphan);
    assert.equal(orphan.article_slug, "casse-orphelin");
    assert.ok(orphan.replacement_path);
  });

  it("compte le CTA catégorie comme lien interne catégorie", () => {
    const art = report.per_article.find((a) => a.slug === "cta-categorie");
    assert.equal(art.internal.category, 1);
    assert.equal(art.internal.total, 1);
    assert.equal(art.has_product_link, false);
  });

  it("sépare les liens externes (info seulement)", () => {
    const withExt = analyzeInternalLinks({
      products: [{ slug: "mandala", name: "Mandala", active: true }],
      categories: [],
      articles: [
        {
          title: "Ext",
          slug: "ext",
          sections: [
            {
              h2: "Sources",
              text: "Voir [Vendizi](https://vendizi.fr) et [le produit](/produits/mandala).",
            },
          ],
        },
      ],
      siteUrl: "https://exemple.fr",
    });
    const art = withExt.per_article[0];
    assert.equal(art.external, 1);
    assert.equal(art.internal.product, 1);
    assert.equal(withExt.summary.external_links, 1);
  });
});
