import { BrevoClient } from "@getbrevo/brevo";

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
    await brevo.transactionalSms.sendTransacSms({
      sender: "TinaLuxe",
      recipient: normalizePhone(process.env.ADMIN_PHONE),
      content: message,
      type: "transactional",
    });
    console.log("SMS envoyé:", message.substring(0, 30));
  } catch (err) {
    console.error("SMS error:", err.message);
  }
}
