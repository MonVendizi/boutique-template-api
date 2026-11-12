import pool from "../../db/pool.js";
import { normalizeGscSiteUrl } from "./gsc.js";

async function readBrandSite() {
  const { rows } = await pool.query(
    `SELECT key, value FROM brand_settings
     WHERE key IN ('seo_site_url', 'brand_name')`,
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const raw =
    map.seo_site_url ||
    process.env.SITE_URL ||
    process.env.FRONTEND_URL ||
    "";
  const label =
    String(map.brand_name || "").trim() ||
    process.env.BRAND_NAME ||
    "Boutique";
  return { raw, label };
}

/** Une seule propriété active pour la boutique (créée au besoin). */
export async function ensureBoutiqueSeoProperty() {
  const { raw, label } = await readBrandSite();
  if (!raw) {
    throw new Error(
      "URL du site manquante (seo_site_url / SITE_URL). Renseignez-la dans Personnalisation → SEO.",
    );
  }
  const siteUrl = normalizeGscSiteUrl(raw);

  const existing = await pool.query(
    `SELECT id, site_url, label, is_active,
            last_sync_at::text, last_sync_status, last_sync_error
     FROM seo_properties WHERE site_url = $1 LIMIT 1`,
    [siteUrl],
  );
  if (existing.rows[0]) {
    await pool.query(
      `UPDATE seo_properties SET label = $2, is_active = true, updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, label],
    );
    return { ...existing.rows[0], label, site_url: siteUrl };
  }

  const inserted = await pool.query(
    `INSERT INTO seo_properties (site_url, label, is_active)
     VALUES ($1, $2, true)
     RETURNING id, site_url, label, is_active,
               last_sync_at::text, last_sync_status, last_sync_error`,
    [siteUrl, label],
  );
  return inserted.rows[0];
}

export async function getActiveProperty() {
  return ensureBoutiqueSeoProperty();
}
