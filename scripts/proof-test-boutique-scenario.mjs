/** Scénario boutique de test (preuve E2E calcul) */
import { analyzeInternalLinks } from "../src/lib/seo/internal-links.js";
import { normalizeLinkTips } from "../src/lib/seo/ai-report.js";

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
        { h2: "Introduction", text: "Un article sans aucun lien vers la boutique." },
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

const sampleAiTips = normalizeLinkTips([
  {
    impact: 1,
    tip_type: "add_link",
    article_title: "Sans lien",
    article_slug: "sans-lien",
    section_h2: "Introduction",
    sentence: "Un article sans aucun lien vers la boutique.",
    anchor_words: "lien vers la boutique",
    target_name: "Mandala",
    target_path: "/produits/mandala",
    markdown_link: "[lien vers la boutique](/produits/mandala)",
  },
  {
    impact: 2,
    tip_type: "fix_broken",
    article_title: "Lien cassé + orphelin",
    article_slug: "casse-orphelin",
    section_h2: "Ancien produit",
    sentence: "Voir cette pièce.",
    anchor_words: "cette pièce",
    broken_href: "/produits/ghost-gone",
    broken_reason: "produit supprimé ou désactivé",
    target_name: "Mandala",
    target_path: "/produits/mandala",
    replacement_name: "Mandala",
    replacement_path: "/produits/mandala",
    markdown_link: "[cette pièce](/produits/mandala)",
  },
  {
    impact: 3,
    tip_type: "add_link",
    article_title: "Bad",
    article_slug: "bad",
    sentence: "Voir Vendizi",
    anchor_words: "Vendizi",
    target_path: "https://vendizi.fr",
    markdown_link: "[Vendizi](https://vendizi.fr)",
  },
]);

console.log(
  JSON.stringify(
    {
      bilan: {
        indicator: report.summary.indicator,
        articles_without_internal: report.articles_without_internal,
        uncited_products: report.uncited_products,
        uncited_categories: report.uncited_categories,
        broken_links: report.broken_links,
        per_article: report.per_article.map((a) => ({
          slug: a.slug,
          internal: a.internal,
          product_ok: a.product_ok,
          external: a.external,
        })),
      },
      link_tips_apres_filtre_vendizi: sampleAiTips,
      vendizi_filtre: sampleAiTips.every(
        (t) => !/vendizi/i.test(JSON.stringify(t)),
      ),
    },
    null,
    2,
  ),
);
