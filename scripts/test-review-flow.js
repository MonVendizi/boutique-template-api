import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

const {
  sendOrderDeliveredEmail,
  sendReviewReminderEmail,
  sendGoogleReviewRequestEmail,
} = await import("../src/lib/email.js");

const hasResend = Boolean(process.env.RESEND_API_KEY?.trim());
console.log("RESEND_API_KEY:", hasResend ? "configurée ✓" : "absente ✗");
if (!hasResend) {
  console.error("Ajoutez RESEND_API_KEY dans .env puis relancez.");
  process.exit(1);
}

const settingsResult = await pool.query(
  `SELECT value FROM settings WHERE key = 'google_review_url'`
);
const googleReviewUrl = settingsResult.rows[0]?.value || null;

console.log("Google Review URL:", googleReviewUrl || "(non configuré)");

const tests = [
  {
    label: "J+2 livraison",
    run: () =>
      sendOrderDeliveredEmail({
        email: "sebastien.fallet@outlook.com",
        customerName: "Sébastien Fallet",
        orderId: "test-order-123",
        productName: "Beurre de Karité Brut",
        googleReviewUrl,
      }),
  },
  {
    label: "J+7 relance",
    run: () =>
      sendReviewReminderEmail({
        email: "sebastien.fallet@outlook.com",
        customerName: "Sébastien Fallet",
        orderId: "test-order-123",
        googleReviewUrl,
      }),
  },
  {
    label: "Demande avis Google",
    run: () =>
      sendGoogleReviewRequestEmail({
        email: "sebastien.fallet@outlook.com",
        customerName: "Sébastien Fallet",
        googleReviewUrl,
      }),
  },
];

let sent = 0;
for (const test of tests) {
  console.log(`Envoi email ${test.label}...`);
  try {
    const result = await test.run();
    if (result?.id && result.id !== "dev-log") {
      console.log(`  ✓ envoyé (id: ${result.id})`);
      sent++;
    } else if (result?.id === "dev-log") {
      console.log("  ✗ simulé seulement (Resend non initialisé)");
    } else {
      console.log("  ✓ envoyé");
      sent++;
    }
  } catch (err) {
    const msg =
      err && typeof err === "object" && "message" in err
        ? String(err.message)
        : String(err);
    console.error(`  ✗ échec: ${msg}`);
  }
}

console.log(`\nRésultat: ${sent}/3 emails envoyés`);
if (sent === 3) {
  console.log("✅ Vérifie ta boîte Outlook (sebastien.fallet@outlook.com)");
} else {
  process.exitCode = 1;
}

await pool.end();
