import dotenv from "dotenv";

dotenv.config();

import { Resend } from "resend";
import { buildNewsletterHtml } from "../src/lib/email.js";

const resend = new Resend(process.env.RESEND_API_KEY);

const html = await buildNewsletterHtml({
  token: "test-token-123",
  type: "news",
  title: "Test bouton CTA TinaLuxe ✨",
  message: `Bonjour,

Ceci est un email de test pour vérifier que :
- Le bouton CTA est visible et doré
- L'email arrive en boîte de réception (pas en spam)
- L'authentification SPF/DKIM/DMARC fonctionne

Si vous voyez un bouton doré ci-dessous et que cet email est dans votre boîte principale → tout est parfait !`,
  cta_text: "Voir la boutique TinaLuxe →",
  cta_url: "https://tinaluxe.fr/boutique",
});

const { data, error } = await resend.emails.send({
  from: "Christina — TinaLuxe <newsletter@tinaluxe.fr>",
  to: "sebastien.fallet@outlook.com",
  subject: "🧪 Test SPF/DKIM/DMARC + bouton CTA",
  html,
});

if (error) {
  console.error("❌ Erreur:", error);
  process.exit(1);
}

console.log("✅ Email envoyé — ID:", data.id);
console.log("→ Vérifie ta boîte Outlook — boîte principale ou spam ?");
