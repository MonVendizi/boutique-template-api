import dotenv from "dotenv";

dotenv.config();

import { Resend } from "resend";
import { buildNewsletterHtml } from "../src/lib/email.js";

const TEST_EMAIL = process.env.TEST_EMAIL || "test@example.com";
const BRAND_NAME = process.env.BRAND_NAME || "Ma Boutique";
const BRAND_FOUNDER = process.env.BRAND_FOUNDER || "L'équipe";
const FRONTEND_URL = (process.env.FRONTEND_URL || "https://maboutique.fr").replace(
  /\/$/,
  ""
);
const emailDomain =
  process.env.ADMIN_EMAIL?.split("@")[1] || "maboutique.fr";

const resend = new Resend(process.env.RESEND_API_KEY);

const html = await buildNewsletterHtml({
  token: "test-token-123",
  type: "news",
  title: `Test bouton CTA ${BRAND_NAME} ✨`,
  message: `Bonjour,

Ceci est un email de test pour vérifier que :
- Le bouton CTA est visible et doré
- L'email arrive en boîte de réception (pas en spam)
- L'authentification SPF/DKIM/DMARC fonctionne

Si vous voyez un bouton doré ci-dessous et que cet email est dans votre boîte principale → tout est parfait !`,
  cta_text: `Voir la boutique ${BRAND_NAME} →`,
  cta_url: `${FRONTEND_URL}/boutique`,
});

const { data, error } = await resend.emails.send({
  from: `${BRAND_FOUNDER} — ${BRAND_NAME} <newsletter@${emailDomain}>`,
  to: TEST_EMAIL,
  subject: "🧪 Test SPF/DKIM/DMARC + bouton CTA",
  html,
});

if (error) {
  console.error("❌ Erreur:", error);
  process.exit(1);
}

console.log("✅ Email envoyé — ID:", data.id);
console.log(`→ Vérifie la boîte ${TEST_EMAIL} — boîte principale ou spam ?`);
