import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  sanitizeBlogFaq,
  sanitizeBlogSections,
  sanitizeBlogText,
  sanitizeHref,
} from "./blogSanitize.js";

describe("sanitizeHref", () => {
  it("autorise https, mailto et relatifs", () => {
    assert.ok(sanitizeHref("https://vendizi.fr/tarifs")?.startsWith("https://"));
    assert.equal(sanitizeHref("/produits/mandala"), "/produits/mandala");
    assert.equal(sanitizeHref("mailto:a@b.fr"), "mailto:a@b.fr");
    assert.equal(sanitizeHref("#faq"), "#faq");
  });

  it("rejette javascript et data", () => {
    assert.equal(sanitizeHref("javascript:alert(1)"), null);
    assert.equal(sanitizeHref("JAVASCRIPT:alert(1)"), null);
    assert.equal(sanitizeHref("data:text/html,<script>"), null);
    assert.equal(sanitizeHref("//evil.com"), null);
  });
});

describe("sanitizeBlogText", () => {
  it("conserve un lien markdown sûr (forme d’URL inchangée)", () => {
    const out = sanitizeBlogText(
      "Voir [notre boutique](/boutique) et [Vendizi](https://vendizi.fr).",
    );
    assert.equal(
      out,
      "Voir [notre boutique](/boutique) et [Vendizi](https://vendizi.fr).",
    );
  });

  it("ré-enregistrement : caractères spéciaux inchangés", () => {
    const src =
      "Prix < 50 € et > 10 ; liste [a] (b) *étoiles* ; formule a < b > c.";
    assert.equal(sanitizeBlogText(src), src);
  });

  it("ré-enregistrement : sections + faq byte-identiques", () => {
    const sections = [
      {
        id: "section-1",
        h2: "Titre <test>",
        text: "Texte avec < > [x] (y) *z* et pas de lien.",
        image: "",
        image_position: "left",
        image_alt: "",
      },
    ];
    const faq = [
      {
        question: "Q < 1 > ?",
        answer: "Rép. avec [crochets] et (parens) *ok*.",
      },
    ];
    assert.deepEqual(sanitizeBlogSections(sections), sections);
    assert.deepEqual(sanitizeBlogFaq(faq), faq);
  });

  it("neutralise javascript: (label seul, parenthèses dans l’URL)", () => {
    const out = sanitizeBlogText("Clique [ici](javascript:alert(1)) maintenant.");
    assert.equal(out, "Clique ici maintenant.");
    assert.equal(out.includes("javascript:"), false);
    assert.doesNotMatch(out, /\[ici\]\(/);
  });

  it("convertit <a> HTML sûr ; laisse <script> en texte (échappé au rendu)", () => {
    const out = sanitizeBlogText(
      'Hello <a href="/cgv">CGV</a> <script>alert(1)</script> <a href="javascript:x">bad</a>',
    );
    assert.match(out, /\[CGV\]\(\/cgv\)/);
    assert.match(out, /<script>alert\(1\)<\/script>/);
    assert.equal(out.includes("javascript:"), false);
    assert.match(out, /bad/);
  });

  it("texte sans lien inchangé (hors trim logique)", () => {
    const src = "Paragraphe simple.\n\nDeuxième ligne.";
    assert.equal(sanitizeBlogText(src), src);
  });
});
