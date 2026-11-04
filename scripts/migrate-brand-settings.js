import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

await pool.query(`
  CREATE TABLE IF NOT EXISTS brand_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    type VARCHAR(20) DEFAULT 'text',
    category VARCHAR(50) DEFAULT 'general',
    label VARCHAR(100),
    updated_at TIMESTAMP DEFAULT NOW()
  );
`);

await pool.query(`
  ALTER TABLE products ADD COLUMN IF NOT EXISTS landing_page_enabled BOOLEAN DEFAULT false;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS landing_page_config JSONB DEFAULT '{}';
`);

const defaults = [
  // Identité
  ["brand_name", "", "text", "identity", "Nom de la marque"],
  ["brand_tagline", "Votre boutique artisanale en ligne", "text", "identity", "Slogan"],
  ["brand_founder_name", "La fondatrice", "text", "identity", "Prénom fondatrice"],
  ["brand_logo_url", "", "image", "identity", "Logo URL"],
  ["brand_favicon_url", "", "image", "identity", "Favicon URL"],
  ["admin_greeting", "Bonjour 👋", "text", "identity", "Message accueil admin"],
  ["brand_charter", "{}", "json", "identity", "Charte de marque"],

  // Couleurs
  ["color_primary", "#2D6A4F", "color", "colors", "Couleur principale"],
  ["color_primary_light", "#52B788", "color", "colors", "Couleur principale claire"],
  ["color_dark", "#1B1B2E", "color", "colors", "Couleur sombre"],
  ["color_dark_secondary", "#2A2A3E", "color", "colors", "Couleur sombre secondaire"],
  ["color_light", "#FAFAFA", "color", "colors", "Couleur claire"],
  ["color_text", "#E8E8E8", "color", "colors", "Couleur texte"],

  // Home Hero
  ["hero_supertitle", "Bien-être naturel premium", "text", "home", "Sur-titre hero"],
  ["hero_title_line1", "La qualité", "text", "home", "Titre hero ligne 1"],
  ["hero_title_line2", "artisanale", "text", "home", "Titre hero ligne 2"],
  ["hero_description", "Découvrez nos produits soigneusement sélectionnés.", "text", "home", "Description hero"],
  ["hero_cta1_text", "Découvrir nos produits", "text", "home", "CTA 1 texte"],
  ["hero_cta1_url", "/boutique", "url", "home", "CTA 1 lien"],
  ["hero_cta2_text", "", "text", "home", "CTA 2 texte"],
  ["hero_cta2_url", "", "url", "home", "CTA 2 lien"],
  ["hero_image_desktop", "", "image", "home", "Image hero desktop"],
  ["hero_image_mobile", "", "image", "home", "Image hero mobile"],

  // Section produits home
  ["products_section_title", "Nos essentiels", "text", "home", "Titre section produits"],
  ["products_section_subtitle", "Produits d'exception", "text", "home", "Sous-titre section produits"],
  ["products_section_description", "Des produits soigneusement sélectionnés pour vous.", "text", "home", "Description section produits"],

  // ADN
  ["adn_section_title", "Notre histoire", "text", "home", "Titre section ADN"],
  ["adn_page_title", "", "text", "home", "Titre page À propos"],
  ["adn_section_subtitle", "Qui sommes-nous ?", "text", "home", "Sous-titre ADN"],
  ["adn_image_url", "", "image", "home", "Photo fondatrice"],
  ["adn_image_alt", "Photo de la fondatrice", "text", "home", "Alt image ADN"],
  ["adn_blocks", "[]", "json", "home", "Blocs texte ADN"],
  ["adn_quote", "Notre engagement, sans compromis.", "text", "home", "Citation ADN"],

  // Témoignages
  ["testimonials_enabled", "true", "boolean", "home", "Afficher témoignages"],
  ["testimonials_section_title", "Ce qu'elles en disent", "text", "home", "Titre témoignages"],
  ["testimonials", "[]", "json", "home", "Témoignages manuels"],

  // Newsletter home
  ["newsletter_section_title", "Rejoignez notre communauté", "text", "home", "Titre section newsletter"],
  ["newsletter_section_subtitle", "Recevez nos actualités et offres exclusives", "text", "home", "Sous-titre newsletter"],
  ["brand_universe_title", "Explorez notre univers", "text", "home", "Titre section univers"],
  [
    "brand_universe_cards",
    JSON.stringify([
      { title: "Nos produits", description: "Découvrez notre sélection.", image: "", url: "/boutique", cta: "Voir la boutique" },
      { title: "Notre blog", description: "Conseils et actualités.", image: "", url: "/blog", cta: "Lire le blog" },
      { title: "Notre histoire", description: "Qui nous sommes.", image: "", url: "/a-propos", cta: "En savoir plus" },
    ]),
    "json",
    "home",
    "Cartes univers (3 cartes)",
  ],

  // Footer
  ["footer_description", "Votre boutique artisanale en ligne.", "text", "footer", "Description footer"],
  ["footer_email", "", "email", "footer", "Email contact"],
  ["footer_instagram", "", "url", "footer", "Instagram URL"],
  ["footer_tiktok", "", "url", "footer", "TikTok URL"],
  ["footer_facebook", "", "url", "footer", "Facebook URL"],
  ["footer_pinterest", "", "url", "footer", "Pinterest URL"],
  ["footer_whatsapp", "", "url", "footer", "WhatsApp URL"],
  [
    "trust_badges",
    '[{"icon":"🌿","text":"100% Naturel"},{"icon":"🚚","text":"Livraison rapide"},{"icon":"⭐","text":"Avis vérifiés"},{"icon":"🔒","text":"Paiement sécurisé"}]',
    "json",
    "footer",
    "Badges de confiance",
  ],

  // SEO
  ["seo_site_url", "", "url", "seo", "URL du site"],
  ["seo_title_default", "", "text", "seo", "Title SEO"],
  ["seo_description_default", "Découvrez nos produits artisanaux.", "text", "seo", "Meta description"],
  ["seo_og_image", "", "image", "seo", "Image OpenGraph"],
  ["google_site_verification", "", "text", "seo", "Google Search Console"],
  ["blog_cta_text", "", "text", "seo", "Texte CTA des articles de blog"],
  ["category_subtitles", "{}", "json", "seo", "Sous-titres par catégorie (JSON)"],

  // Checkout
  ["shipping_cents", "490", "number", "checkout", "Frais de port (centimes)"],
  ["shipping_countries", '["FR","BE","CH","LU"]', "json", "checkout", "Pays disponibles"],
  ["shipping_delay_preparation", "24-48h ouvrés", "text", "checkout", "Délai de préparation"],
  ["shipping_delay_delivery", "2-4 jours ouvrés", "text", "checkout", "Délai de livraison"],
  ["shipping_carrier", "Colissimo", "text", "checkout", "Transporteur"],
  ["welcome_promo_code", "BIENVENUE10", "text", "checkout", "Code promo bienvenue"],
  ["inactive_promo_code", "RETOUR10", "text", "checkout", "Code promo inactifs"],
  ["enable_variants", "false", "boolean", "checkout", "Activer les variantes produits"],

  // Emails
  ["email_sender_name", "", "text", "emails", "Nom expéditeur"],
  ["email_reply_to", "", "email", "emails", "Reply-to"],
  ["email_signature", "L'équipe", "text", "emails", "Signature"],

  // Légal
  ["legal_company_name", "", "text", "legal", "Nom société"],
  ["legal_company_form", "SARL", "text", "legal", "Forme juridique"],
  ["legal_address", "", "text", "legal", "Adresse siège"],
  ["legal_siret", "", "text", "legal", "SIRET"],
  ["legal_director", "", "text", "legal", "Dirigeant"],
  ["legal_email", "", "email", "legal", "Email légal"],
  ["legal_phone", "", "text", "legal", "Téléphone"],
  ["legal_host_name", "Vercel", "text", "legal", "Hébergeur"],
  [
    "legal_host_address",
    "Vercel Inc., 340 Pine Street, San Francisco, CA 94104",
    "text",
    "legal",
    "Adresse hébergeur",
  ],
  ["legal_mentions", "", "richtext", "legal", "Mentions légales"],
  ["legal_cgv", "", "richtext", "legal", "CGV"],
  ["legal_privacy", "", "richtext", "legal", "Politique confidentialité"],
  ["legal_faq", "[]", "json", "legal", "FAQ"],
  ["legal_delivery", "", "richtext", "legal", "Page livraison"],
  ["legal_returns", "", "richtext", "legal", "Page retours"],

  // Tracking
  ["facebook_pixel_id", "", "text", "tracking", "Pixel Facebook ID"],
  ["gtm_id", "", "text", "tracking", "Google Tag Manager ID"],
  ["ga4_measurement_id", "", "text", "tracking", "Google Analytics 4 ID"],
  ["google_business_url", "", "text", "tracking", "Lien Google My Business"],

  // Programme partenaire unique (−5 €, confirmation + 404, JourX + TinaLuxe)
  ["partner_jourx_enabled", "false", "boolean", "partner", "Pub JourX activée"],
  [
    "partner_jourx_placement",
    "all",
    "string",
    "partner",
    "Placement : confirmation + 404",
  ],
  [
    "partner_tinaluxe_enabled",
    "false",
    "boolean",
    "partner",
    "Pub partenaire activée",
  ],
  [
    "partner_tinaluxe_placement",
    "all",
    "string",
    "partner",
    "Placement : confirmation + 404",
  ],
  [
    "partner_category_conflict",
    "false",
    "boolean",
    "partner",
    "Conflit catégorie partenaire - info",
  ],
  [
    "partner_discount_amount",
    "0",
    "number",
    "partner",
    "Réduction mensuelle programme partenaire (€)",
  ],
  [
    "partner_activated_at",
    "",
    "string",
    "partner",
    "Date activation programme partenaire",
  ],
  [
    "partner_jourx_url",
    "https://jourx.fr",
    "string",
    "partner",
    "URL destination pub JourX",
  ],
  [
    "partner_secondary_url",
    "https://tinaluxe.fr",
    "string",
    "partner",
    "URL destination pub partenaire secondaire",
  ],
  [
    "partner_secondary_name",
    "TinaLuxe",
    "string",
    "partner",
    "Nom affiché partenaire secondaire",
  ],
  ["jourx_cart_discount", "5", "number", "partner", "JourX — legacy"],
  [
    "jourx_confirmation_discount",
    "5",
    "number",
    "partner",
    "JourX — Confirmation",
  ],
  ["jourx_not_found_discount", "5", "number", "partner", "JourX — Page 404"],
  [
    "jourx_all_discount",
    "5",
    "number",
    "partner",
    "JourX — Confirmation + 404",
  ],
  ["tinaluxe_cart_discount", "5", "number", "partner", "TinaLuxe — legacy"],
  [
    "tinaluxe_confirmation_discount",
    "5",
    "number",
    "partner",
    "TinaLuxe — Confirmation",
  ],
  [
    "tinaluxe_not_found_discount",
    "5",
    "number",
    "partner",
    "TinaLuxe — Page 404",
  ],
  [
    "tinaluxe_all_discount",
    "5",
    "number",
    "partner",
    "TinaLuxe — Confirmation + 404",
  ],
];

for (const [key, value, type, category, label] of defaults) {
  await pool.query(
    `
    INSERT INTO brand_settings (key, value, type, category, label)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (key) DO NOTHING
  `,
    [key, value, type, category, label]
  );
}

// Placements → always confirmation + 404
await pool.query(`
  UPDATE brand_settings
  SET value = 'all',
      label = 'Placement : confirmation + 404',
      updated_at = NOW()
  WHERE key IN ('partner_jourx_placement', 'partner_tinaluxe_placement');
`);

// Grille → 5 € partout
await pool.query(`
  UPDATE brand_settings
  SET value = '5', updated_at = NOW()
  WHERE key LIKE '%_discount'
    AND key ~ '^(jourx|tinaluxe|secondary)_';
`);

// Si un partenaire était ON → les deux ON + remise 5
await pool.query(`
  UPDATE brand_settings
  SET value = 'true', updated_at = NOW()
  WHERE key IN ('partner_jourx_enabled', 'partner_tinaluxe_enabled')
    AND EXISTS (
      SELECT 1 FROM brand_settings b2
      WHERE b2.key IN ('partner_jourx_enabled', 'partner_tinaluxe_enabled')
        AND b2.value = 'true'
    );
`);
await pool.query(`
  UPDATE brand_settings
  SET value = '5', updated_at = NOW()
  WHERE key = 'partner_discount_amount'
    AND EXISTS (
      SELECT 1 FROM brand_settings b2
      WHERE b2.key IN ('partner_jourx_enabled', 'partner_tinaluxe_enabled')
        AND b2.value = 'true'
    );
`);
await pool.query(`
  UPDATE brand_settings
  SET value = '0', updated_at = NOW()
  WHERE key = 'partner_discount_amount'
    AND NOT EXISTS (
      SELECT 1 FROM brand_settings b2
      WHERE b2.key IN ('partner_jourx_enabled', 'partner_tinaluxe_enabled')
        AND b2.value = 'true'
    );
`);

// URLs partenaires : remplir si vides
await pool.query(`
  INSERT INTO brand_settings (key, value, type, category, label)
  VALUES
    ('partner_jourx_url', 'https://jourx.fr', 'string', 'partner', 'URL destination pub JourX'),
    ('partner_secondary_url', 'https://tinaluxe.fr', 'string', 'partner', 'URL destination pub partenaire secondaire'),
    ('partner_secondary_name', 'TinaLuxe', 'string', 'partner', 'Nom affiché partenaire secondaire')
  ON CONFLICT (key) DO UPDATE
  SET value = CASE
        WHEN brand_settings.value IS NULL OR TRIM(brand_settings.value) = ''
        THEN EXCLUDED.value
        ELSE brand_settings.value
      END,
      updated_at = NOW()
`);

console.log("Migration brand_settings OK");
await pool.end();
