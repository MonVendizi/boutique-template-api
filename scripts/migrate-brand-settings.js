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
  ["brand_name", "Ma Boutique", "text", "identity", "Nom de la marque"],
  ["brand_tagline", "Votre boutique artisanale en ligne", "text", "identity", "Slogan"],
  ["brand_founder_name", "La fondatrice", "text", "identity", "Prénom fondatrice"],
  ["brand_logo_url", "", "image", "identity", "Logo URL"],
  ["brand_favicon_url", "", "image", "identity", "Favicon URL"],
  ["admin_greeting", "Bonjour 👋", "text", "identity", "Message accueil admin"],

  // Couleurs
  ["color_primary", "#D4AF37", "color", "colors", "Couleur principale"],
  ["color_primary_light", "#E6C766", "color", "colors", "Couleur principale claire"],
  ["color_dark", "#0B0B0B", "color", "colors", "Couleur sombre"],
  ["color_dark_secondary", "#161616", "color", "colors", "Couleur sombre secondaire"],
  ["color_light", "#FFFDF8", "color", "colors", "Couleur claire"],
  ["color_text", "#EAEAEA", "color", "colors", "Couleur texte"],

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

  // Footer
  ["footer_description", "Votre boutique artisanale en ligne.", "text", "footer", "Description footer"],
  ["footer_email", "contact@maboutique.fr", "email", "footer", "Email contact"],
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
  ["seo_site_url", "https://maboutique.fr", "url", "seo", "URL du site"],
  ["seo_title_default", "Ma Boutique — Boutique artisanale en ligne", "text", "seo", "Title SEO"],
  ["seo_description_default", "Découvrez nos produits artisanaux.", "text", "seo", "Meta description"],
  ["seo_og_image", "", "image", "seo", "Image OpenGraph"],

  // Checkout
  ["shipping_cents", "490", "number", "checkout", "Frais de port (centimes)"],
  ["shipping_countries", '["FR","BE","CH","LU"]', "json", "checkout", "Pays disponibles"],
  ["welcome_promo_code", "BIENVENUE10", "text", "checkout", "Code promo bienvenue"],
  ["inactive_promo_code", "RETOUR10", "text", "checkout", "Code promo inactifs"],

  // Emails
  ["email_sender_name", "Ma Boutique", "text", "emails", "Nom expéditeur"],
  ["email_reply_to", "contact@maboutique.fr", "email", "emails", "Reply-to"],
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

console.log("Migration brand_settings OK");
await pool.end();
