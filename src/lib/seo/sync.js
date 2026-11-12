import pool from "../../db/pool.js";
import {
  GscAccessError,
  normalizeGscSiteUrl,
  querySearchAnalytics,
} from "./gsc.js";
import { ensureBoutiqueSeoProperty } from "./property.js";

const PAGE_SIZE = 25000;
const UPSERT_BATCH = 200;

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

function dailySyncRange() {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
}

async function tryAcquireLock(propertyId) {
  const { rows } = await pool.query(
    `UPDATE seo_properties
     SET last_sync_status = 'running', last_sync_error = NULL, updated_at = NOW()
     WHERE id = $1
       AND (last_sync_status IS DISTINCT FROM 'running'
            OR last_sync_at IS NULL
            OR last_sync_at < NOW() - INTERVAL '45 minutes')
     RETURNING id`,
    [propertyId],
  );
  return Boolean(rows[0]);
}

async function releaseLock(propertyId, status, error) {
  // $2 ne doit pas être réutilisé dans un CASE (erreur PG "inconsistent types")
  await pool.query(
    `UPDATE seo_properties
     SET last_sync_status = $2::text,
         last_sync_error = $3::text,
         last_sync_at = CASE WHEN $4::boolean THEN NOW() ELSE last_sync_at END,
         updated_at = NOW()
     WHERE id = $1`,
    [propertyId, status, error, status === "success"],
  );
}

async function fetchAllDailyRows(siteUrl, startDate, endDate) {
  const normalized = normalizeGscSiteUrl(siteUrl);
  const all = [];
  let startRow = 0;
  for (;;) {
    const data = await querySearchAnalytics({
      siteUrl: normalized,
      startDate,
      endDate,
      dimensions: ["date", "query", "page"],
      rowLimit: PAGE_SIZE,
      startRow,
      type: "web",
      dataState: "final",
    });
    const rows = data.rows || [];
    for (const row of rows) {
      all.push({
        date: row.keys?.[0] || "",
        query: row.keys?.[1] || "(inconnu)",
        page: row.keys?.[2] || "",
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
        ctr: Number(row.ctr || 0),
        position: Number(row.position || 0),
      });
    }
    if (rows.length < PAGE_SIZE) break;
    startRow += PAGE_SIZE;
  }
  return all.filter((r) => r.date && r.page);
}

async function upsertDailyRows(propertyId, rows) {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const values = [];
    const placeholders = [];
    batch.forEach((row, idx) => {
      const o = idx * 8;
      placeholders.push(
        `($${o + 1}, $${o + 2}::date, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8})`,
      );
      values.push(
        propertyId,
        row.date,
        row.query,
        row.page,
        row.clicks,
        row.impressions,
        row.ctr,
        row.position,
      );
    });
    await pool.query(
      `INSERT INTO seo_gsc_daily
        (property_id, date, query, page, clicks, impressions, ctr, position)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (property_id, date, query, page) DO UPDATE SET
         clicks = EXCLUDED.clicks,
         impressions = EXCLUDED.impressions,
         ctr = EXCLUDED.ctr,
         position = EXCLUDED.position`,
      values,
    );
    upserted += batch.length;
  }
  return upserted;
}

export async function syncBoutiqueSeo(mode = "manual") {
  const property = await ensureBoutiqueSeoProperty();
  const range = dailySyncRange();
  const base = {
    propertyId: property.id,
    siteUrl: property.site_url,
    label: property.label,
    mode,
    dateFrom: range.startDate,
    dateTo: range.endDate,
    rowsUpserted: 0,
    status: "success",
  };

  const locked = await tryAcquireLock(property.id);
  if (!locked) {
    return {
      ...base,
      status: "skipped",
      error: "Synchronisation déjà en cours",
    };
  }

  const run = await pool.query(
    `INSERT INTO seo_sync_runs
      (property_id, mode, date_from, date_to, status, rows_upserted)
     VALUES ($1, $2, $3::date, $4::date, 'running', 0)
     RETURNING id`,
    [property.id, mode, range.startDate, range.endDate],
  );
  const runId = run.rows[0]?.id;

  try {
    const rows = await fetchAllDailyRows(
      property.site_url,
      range.startDate,
      range.endDate,
    );
    const rowsUpserted = await upsertDailyRows(property.id, rows);
    await pool.query(
      `UPDATE seo_sync_runs
       SET finished_at = NOW(), status = 'success', rows_upserted = $2, error = NULL
       WHERE id = $1`,
      [runId, rowsUpserted],
    );
    await releaseLock(property.id, "success", null);

    try {
      const { computeAndStoreVisibilityIndex } = await import("./visibility.js");
      await computeAndStoreVisibilityIndex(property.id);
    } catch (iveError) {
      console.error("IVE after sync failed:", iveError);
    }

    return { ...base, rowsUpserted, status: "success" };
  } catch (error) {
    const message =
      error instanceof GscAccessError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    await pool.query(
      `UPDATE seo_sync_runs
       SET finished_at = NOW(), status = 'error', error = $2
       WHERE id = $1`,
      [runId, message],
    );
    await releaseLock(property.id, "error", message);
    return { ...base, status: "error", error: message };
  }
}
