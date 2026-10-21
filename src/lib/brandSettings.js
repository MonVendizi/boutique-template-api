import pool from "../db/pool.js";

export async function getBrandValues(keys) {
  const { rows } = await pool.query(
    `SELECT key, value FROM brand_settings WHERE key = ANY($1)`,
    [keys]
  );
  return Object.fromEntries(
    rows.map((r) => [r.key, String(r.value ?? "").trim()])
  );
}

export async function getBrandName() {
  try {
    const { brand_name } = await getBrandValues(["brand_name"]);
    return brand_name || "";
  } catch {
    return "";
  }
}

export async function getSiteUrl() {
  let url = "";
  try {
    const { seo_site_url } = await getBrandValues(["seo_site_url"]);
    url = seo_site_url || "";
  } catch {
    url = "";
  }
  return (url || process.env.FRONTEND_URL || "").trim().replace(/\/$/, "");
}
