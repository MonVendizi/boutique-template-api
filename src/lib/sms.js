import { BrevoClient } from "@getbrevo/brevo";
import { getBrandName } from "./brandSettings.js";

let client = null;

function getClient() {
  if (!process.env.BREVO_API_KEY) return null;
  if (!client) {
    client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });
  }
  return client;
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\s/g, "");
}

export async function sendSMS(message) {
  if (!process.env.BREVO_API_KEY || !process.env.ADMIN_PHONE) return;

  const brevo = getClient();
  if (!brevo) return;

  try {
    const brandName =
      (await getBrandName()) || process.env.BRAND_NAME || "Boutique";
    await brevo.transactionalSms.sendTransacSms({
      sender: brandName.slice(0, 11),
      recipient: normalizePhone(process.env.ADMIN_PHONE),
      content: message,
      type: "transactional",
    });
    console.log("SMS envoyé:", message.substring(0, 30));
  } catch (err) {
    console.error("SMS error:", err.message);
  }
}
