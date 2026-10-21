import { GoogleAuth } from "google-auth-library";
import { checkAdmin } from "../lib/adminAuth.js";

function credentialsFromEnv() {
  const raw = process.env.GOOGLE_CREDENTIALS || "";
  if (!raw || raw === "{}" || raw === "file") return null;
  let credentials = JSON.parse(raw);
  if (typeof credentials === "string") credentials = JSON.parse(credentials);
  if (!credentials || typeof credentials !== "object") return null;
  if (typeof credentials.private_key === "string") {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }
  if (credentials.type !== "service_account" || !credentials.client_email) {
    return null;
  }
  return credentials;
}

function errorMessage(error) {
  const apiMessage = error?.response?.data?.error?.message;
  if (apiMessage) return String(apiMessage);
  return error instanceof Error ? error.message : String(error);
}

export default async function indexingRoutes(fastify) {
  fastify.post("/admin/indexing/notify", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return reply;

    const rawUrls = Array.isArray(request.body?.urls) ? request.body.urls : null;
    if (!rawUrls) {
      return reply.code(400).send({ error: "urls requis" });
    }
    if (rawUrls.length > 200) {
      return reply.code(400).send({ error: "200 URLs maximum" });
    }

    const urls = [
      ...new Set(
        rawUrls
          .map((url) => String(url || "").trim())
          .filter((url) => /^https?:\/\//i.test(url)),
      ),
    ];
    if (urls.length === 0) {
      return reply.code(400).send({ error: "Aucune URL http(s) valide" });
    }

    const credentials = (() => {
      try {
        return credentialsFromEnv();
      } catch {
        return null;
      }
    })();
    if (!credentials) {
      return reply.code(503).send({ error: "GOOGLE_CREDENTIALS manquant" });
    }

    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/indexing"],
    });
    const client = await auth.getClient();
    let submitted = 0;
    const errors = [];

    for (const url of urls) {
      try {
        await client.request({
          url: "https://indexing.googleapis.com/v3/urlNotifications:publish",
          method: "POST",
          data: { url, type: "URL_UPDATED" },
        });
        submitted += 1;
      } catch (error) {
        errors.push({ url, error: errorMessage(error) });
      }
    }

    return { submitted, errors };
  });
}
