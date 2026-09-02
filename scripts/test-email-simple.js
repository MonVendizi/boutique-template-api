import dotenv from "dotenv";

dotenv.config();

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const { data, error } = await resend.emails.send({
  from: "Christina TinaLuxe <newsletter@tinaluxe.fr>",
  to: "sebastien.fallet@outlook.com",
  subject: "Test email TinaLuxe",
  html: `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
      <h1 style="color:#333;">Bonjour Sébastien,</h1>
      <p>Ceci est un email de test simple de TinaLuxe.</p>
      <p>Si vous recevez cet email en boite principale, la configuration fonctionne correctement.</p>
      <p>Cordialement,<br>Christina<br>TinaLuxe</p>
    </div>
  `,
});

if (error) {
  console.error("Erreur:", error);
  process.exit(1);
}

console.log("Email envoyé — ID:", data.id);
