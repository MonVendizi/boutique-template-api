import dotenv from "dotenv";

dotenv.config();

import { Resend } from "resend";

const TEST_EMAIL = process.env.TEST_EMAIL || "test@example.com";
const BRAND_NAME = process.env.BRAND_NAME || "Ma Boutique";
const BRAND_FOUNDER = process.env.BRAND_FOUNDER || "L'équipe";
const emailDomain =
  process.env.ADMIN_EMAIL?.split("@")[1] || "maboutique.fr";

const resend = new Resend(process.env.RESEND_API_KEY);

const { data, error } = await resend.emails.send({
  from: `${BRAND_FOUNDER} — ${BRAND_NAME} <newsletter@${emailDomain}>`,
  to: TEST_EMAIL,
  subject: `Test email ${BRAND_NAME}`,
  html: `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
      <h1 style="color:#333;">Bonjour,</h1>
      <p>Ceci est un email de test simple de ${BRAND_NAME}.</p>
      <p>Si vous recevez cet email en boite principale, la configuration fonctionne correctement.</p>
      <p>Cordialement,<br>${BRAND_FOUNDER}<br>${BRAND_NAME}</p>
    </div>
  `,
});

if (error) {
  console.error("Erreur:", error);
  process.exit(1);
}

console.log("Email envoyé — ID:", data.id);
