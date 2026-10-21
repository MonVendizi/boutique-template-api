import dotenv from "dotenv";
import pool from "../src/db/pool.js";

dotenv.config();

function arg(name) {
  const prefix = `--${name}=`;
  const eq = process.argv.find((a) => a.startsWith(prefix));
  if (eq) return eq.slice(prefix.length).trim();
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1].trim();
  }
  return "";
}

function siteUrlFrom(raw) {
  const value = String(raw || "").trim().replace(/\/$/, "");
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value.replace(/^www\./, "")}`;
}

const brandName = arg("brand") || arg("name") || process.env.BRAND_NAME || "";
const siteUrl =
  siteUrlFrom(arg("url") || arg("domain") || process.env.FRONTEND_URL || process.env.SITE_URL);
const replyTo =
  arg("email") ||
  process.env.ADMIN_EMAIL ||
  (siteUrl ? `contact@${new URL(siteUrl).hostname.replace(/^www\./, "")}` : "");

if (!brandName || !siteUrl || !replyTo) {
  console.error(`Usage:
  node scripts/deploy-new-client.js --brand "NomBoutique" --domain "nomboutique.fr" --email "contact@nomboutique.fr"

  ou variables d'env : BRAND_NAME, FRONTEND_URL, ADMIN_EMAIL`);
  process.exit(1);
}

const rows = [
  ["brand_name", brandName, "text", "identity", "Nom de la marque"],
  ["seo_site_url", siteUrl, "url", "seo", "URL du site"],
  ["email_reply_to", replyTo, "email", "emails", "Reply-to"],
  ["email_sender_name", brandName, "text", "emails", "Nom expéditeur"],
];

for (const [key, value, type, category, label] of rows) {
  await pool.query(
    `
    INSERT INTO brand_settings (key, value, type, category, label)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = NOW()
    `,
    [key, value, type, category, label]
  );
}

console.log("brand_settings client :");
console.log(`  brand_name        = ${brandName}`);
console.log(`  seo_site_url      = ${siteUrl}`);
console.log(`  email_reply_to    = ${replyTo}`);
console.log(`  email_sender_name = ${brandName}`);

await pool.end();
