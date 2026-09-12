import pool from "../db/pool.js";

async function getAdminPasswordOverride() {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM brand_settings WHERE key = 'admin_password_override' LIMIT 1`
    );
    const value = rows[0]?.value;
    return value && String(value).trim() ? String(value) : null;
  } catch {
    return null;
  }
}

export async function resolveValidAdminPassword() {
  const override = await getAdminPasswordOverride();
  return override || process.env.ADMIN_PASSWORD || null;
}

/** Vérifie le header x-admin-password (ou cookie adminAuth). */
export async function checkAdmin(request, reply) {
  const password =
    request.headers["x-admin-password"] || request.cookies?.adminAuth;

  const validPassword = await resolveValidAdminPassword();

  if (!validPassword) {
    reply.code(500).send({ error: "ADMIN_PASSWORD non configuré" });
    return false;
  }

  if (password !== validPassword) {
    reply.code(401).send({ error: "Non autorisé" });
    return false;
  }

  return true;
}
