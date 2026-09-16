import pool from "../db/pool.js";
import { checkAdmin } from "../lib/adminAuth.js";

const CACHE_TTL_MS = 60_000;
/** @type {Map<string, { data: object; expires: number }>} */
const lookupCache = new Map();

function normalizeDomain(domain) {
  return String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .split(":")[0];
}

function invalidateLookupCache(domain) {
  if (domain) {
    lookupCache.delete(normalizeDomain(domain));
  } else {
    lookupCache.clear();
  }
}

/** Purge le cache Next/Vercel du lookup tenant (revalidateTag + revalidatePath). */
async function purgeFrontendTenantCache(domain) {
  const secret =
    process.env.ADMIN_PASSWORD || process.env.NEXT_PUBLIC_ADMIN_PASSWORD;
  if (!secret) return;

  const origins = new Set();
  const frontend = String(
    process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_SITE_URL || ""
  )
    .trim()
    .replace(/\/$/, "");
  if (frontend) origins.add(frontend);
  if (domain) origins.add(`https://${normalizeDomain(domain)}`);

  await Promise.all(
    [...origins].map((origin) =>
      fetch(`${origin}/api/revalidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      }).catch(() => {})
    )
  );
}

export default async function tenantsRoutes(fastify) {
  // Public — appelé par le middleware Next.js
  fastify.get("/tenants/lookup", async (request, reply) => {
    const domain = normalizeDomain(request.query?.domain);
    if (!domain) {
      return reply.code(400).send({ error: "Paramètre domain requis" });
    }

    const cached = lookupCache.get(domain);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    const { rows } = await pool.query(
      `SELECT api_url, brand_name, active
       FROM tenants
       WHERE domain = $1
       LIMIT 1`,
      [domain]
    );

    if (!rows.length) {
      return reply.code(404).send({ error: "Tenant introuvable" });
    }

    const data = {
      api_url: rows[0].api_url,
      brand_name: rows[0].brand_name,
      active: Boolean(rows[0].active),
    };

    lookupCache.set(domain, {
      data,
      expires: Date.now() + CACHE_TTL_MS,
    });

    return data;
  });

  fastify.get("/admin/tenants", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    const { rows } = await pool.query(
      `SELECT id, domain, api_url, brand_name, active, created_at, updated_at
       FROM tenants
       ORDER BY created_at DESC`
    );
    return rows;
  });

  fastify.post("/admin/tenants", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;

    const body = request.body || {};
    const domain = normalizeDomain(body.domain);
    const apiUrl = String(body.api_url || "").trim().replace(/\/$/, "");
    const brandName = body.brand_name ? String(body.brand_name).trim() : null;
    const active = body.active === undefined ? true : Boolean(body.active);

    if (!domain || !apiUrl) {
      return reply
        .code(400)
        .send({ error: "domain et api_url sont requis" });
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO tenants (domain, api_url, brand_name, active)
         VALUES ($1, $2, $3, $4)
         RETURNING id, domain, api_url, brand_name, active, created_at, updated_at`,
        [domain, apiUrl, brandName, active]
      );
      invalidateLookupCache(domain);
      await purgeFrontendTenantCache(domain);
      return reply.code(201).send(rows[0]);
    } catch (err) {
      if (err.code === "23505") {
        return reply.code(409).send({ error: "Ce domaine existe déjà" });
      }
      throw err;
    }
  });

  fastify.put("/admin/tenants/:id", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;

    const { id } = request.params;
    const body = request.body || {};

    const { rows: existing } = await pool.query(
      `SELECT id, domain FROM tenants WHERE id = $1`,
      [id]
    );
    if (!existing.length) {
      return reply.code(404).send({ error: "Tenant introuvable" });
    }

    const domain =
      body.domain !== undefined
        ? normalizeDomain(body.domain)
        : existing[0].domain;
    const apiUrl =
      body.api_url !== undefined
        ? String(body.api_url).trim().replace(/\/$/, "")
        : null;
    const brandName =
      body.brand_name !== undefined
        ? body.brand_name
          ? String(body.brand_name).trim()
          : null
        : undefined;
    const active =
      body.active !== undefined ? Boolean(body.active) : undefined;

    if (body.domain !== undefined && !domain) {
      return reply.code(400).send({ error: "domain invalide" });
    }
    if (body.api_url !== undefined && !apiUrl) {
      return reply.code(400).send({ error: "api_url invalide" });
    }

    try {
      const { rows } = await pool.query(
        `UPDATE tenants SET
           domain = $2,
           api_url = COALESCE($3, api_url),
           brand_name = CASE WHEN $4::boolean THEN $5 ELSE brand_name END,
           active = COALESCE($6, active),
           updated_at = NOW()
         WHERE id = $1
         RETURNING id, domain, api_url, brand_name, active, created_at, updated_at`,
        [
          id,
          domain,
          apiUrl,
          brandName !== undefined,
          brandName ?? null,
          active ?? null,
        ]
      );
      invalidateLookupCache(existing[0].domain);
      invalidateLookupCache(domain);
      await purgeFrontendTenantCache(existing[0].domain);
      await purgeFrontendTenantCache(domain);
      return rows[0];
    } catch (err) {
      if (err.code === "23505") {
        return reply.code(409).send({ error: "Ce domaine existe déjà" });
      }
      throw err;
    }
  });

  // Hard-delete : id UUID ou domaine
  fastify.delete("/admin/tenants/:idOrDomain", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;

    const idOrDomain = String(request.params.idOrDomain || "").trim();
    if (!idOrDomain) {
      return reply.code(400).send({ error: "id ou domain requis" });
    }

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        idOrDomain
      );

    const { rows } = isUuid
      ? await pool.query(
          `DELETE FROM tenants
           WHERE id = $1
           RETURNING id, domain, api_url, brand_name, active, created_at, updated_at`,
          [idOrDomain]
        )
      : await pool.query(
          `DELETE FROM tenants
           WHERE domain = $1
           RETURNING id, domain, api_url, brand_name, active, created_at, updated_at`,
          [normalizeDomain(idOrDomain)]
        );

    if (!rows.length) {
      return reply.code(404).send({ error: "Tenant introuvable" });
    }

    invalidateLookupCache(rows[0].domain);
    return { success: true, deleted: rows[0] };
  });
}
