import pool from "../db/pool.js";
import { checkAdmin } from "../lib/adminAuth.js";
import {
  beginTotpSetup,
  disableTotp,
  enableTotp,
  getTotpStatus,
} from "../lib/totp.js";

async function getIssuerName() {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM brand_settings WHERE key = 'brand_name' LIMIT 1`,
    );
    const name = rows[0]?.value ? String(rows[0].value).trim() : "";
    return name || "Vendizi Admin";
  } catch {
    return "Vendizi Admin";
  }
}

export default async function totpRoutes(fastify) {
  fastify.get("/admin/2fa/status", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    return getTotpStatus();
  });

  fastify.post("/admin/2fa/setup", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    try {
      const issuer = await getIssuerName();
      const setup = await beginTotpSetup(issuer);
      return {
        secret: setup.secret,
        qrDataUrl: setup.qrDataUrl,
        otpauth: setup.otpauth,
      };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: "Impossible de démarrer le 2FA" });
    }
  });

  fastify.post("/admin/2fa/enable", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    const code = String(request.body?.code || "").trim();
    if (!code) {
      return reply.code(400).send({ error: "Code requis" });
    }
    const result = await enableTotp(code);
    if (!result.ok) {
      return reply.code(400).send({ error: result.error || "Code incorrect" });
    }
    return {
      success: true,
      backupCodes: result.backupCodes,
    };
  });

  fastify.post("/admin/2fa/disable", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    const code = String(request.body?.code || "").trim();
    if (!code) {
      return reply.code(400).send({ error: "Code requis" });
    }
    const result = await disableTotp(code);
    if (!result.ok) {
      return reply.code(400).send({ error: result.error || "Code incorrect" });
    }
    return { success: true };
  });
}
