import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeLinkTips } from "./ai-report.js";

describe("normalizeLinkTips", () => {
  it("conserve un conseil complet boutique", () => {
    const tips = normalizeLinkTips([
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
    ]);
    assert.equal(tips.length, 1);
    assert.equal(
      tips[0].markdown_link,
      "[lien vers la boutique](/produits/mandala)",
    );
    assert.equal(tips[0].admin_path, "Admin → Blog");
  });

  it("filtre Vendizi et plafonne à 3", () => {
    const tips = normalizeLinkTips([
      {
        impact: 1,
        article_title: "X",
        article_slug: "x",
        sentence: "Vendizi",
        anchor_words: "Vendizi",
        target_path: "https://vendizi.fr",
        markdown_link: "[Vendizi](https://vendizi.fr)",
      },
      ...[1, 2, 3, 4].map((n) => ({
        impact: n,
        tip_type: "add_link",
        article_title: `A${n}`,
        article_slug: `a${n}`,
        sentence: "phrase",
        anchor_words: "mot",
        target_path: `/produits/p${n}`,
        markdown_link: `[mot](/produits/p${n})`,
      })),
    ]);
    assert.equal(tips.length, 3);
    assert.ok(tips.every((t) => !/vendizi/i.test(JSON.stringify(t))));
  });
});
