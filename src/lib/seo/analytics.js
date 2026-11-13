import pool from "../../db/pool.js";
import { SEO_PERIOD_DAYS, SEO_THRESHOLDS } from "./thresholds.js";
import { ensureBoutiqueSeoProperty } from "./property.js";

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

function parsePeriod(raw) {
  if (raw === "7d" || raw === "28d" || raw === "3m" || raw === "12m") return raw;
  return "28d";
}

export async function resolveDataEnd(propertyId) {
  const { rows } = await pool.query(
    `SELECT MAX(date)::text AS max FROM seo_gsc_daily WHERE property_id = $1`,
    [propertyId],
  );
  if (rows[0]?.max) return rows[0].max;
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  return toIsoDate(end);
}

export function buildRanges(end, period) {
  const days = SEO_PERIOD_DAYS[period] || 28;
  const endDate = new Date(`${end}T00:00:00.000Z`);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
  const prevEnd = new Date(startDate);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - (days - 1));
  return {
    days,
    current: { start: toIsoDate(startDate), end: toIsoDate(endDate) },
    previous: { start: toIsoDate(prevStart), end: toIsoDate(prevEnd) },
  };
}

function pctChange(current, previous) {
  if (!Number.isFinite(previous) || previous === 0) {
    return current === 0 ? 0 : null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

async function aggregateKpis(propertyId, range) {
  const { rows } = await pool.query(
    `SELECT
      COALESCE(SUM(clicks), 0)::text AS clicks,
      COALESCE(SUM(impressions), 0)::text AS impressions,
      CASE WHEN SUM(impressions) > 0
        THEN (SUM(clicks)::numeric / SUM(impressions))::text ELSE '0' END AS ctr,
      CASE WHEN SUM(impressions) > 0
        THEN (SUM(position * impressions) / SUM(impressions))::text ELSE '0' END AS position
     FROM seo_gsc_daily
     WHERE property_id = $1 AND date >= $2::date AND date <= $3::date`,
    [propertyId, range.start, range.end],
  );
  const row = rows[0] || {};
  return {
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    ctr: Number(row.ctr || 0),
    position: Number(row.position || 0),
  };
}

export async function getOverview(periodRaw) {
  const property = await ensureBoutiqueSeoProperty();
  const period = parsePeriod(periodRaw);
  const dataEnd = await resolveDataEnd(property.id);
  const { current, previous, days } = buildRanges(dataEnd, period);

  const [cur, prev, chartRes] = await Promise.all([
    aggregateKpis(property.id, current),
    aggregateKpis(property.id, previous),
    pool.query(
      `SELECT date::text AS date,
              COALESCE(SUM(clicks), 0)::int AS clicks,
              COALESCE(SUM(impressions), 0)::int AS impressions
       FROM seo_gsc_daily
       WHERE property_id = $1 AND date >= $2::date AND date <= $3::date
       GROUP BY date ORDER BY date ASC`,
      [property.id, current.start, current.end],
    ),
  ]);

  let ive = null;
  try {
    const { getVisibilityIndexView, computeAndStoreVisibilityIndex } =
      await import("./visibility.js");
    // Lecture cache uniquement — pas d'appel GA4 bloquant
    ive = await getVisibilityIndexView(property.id, { refresh: false });
    if (!ive?.current) {
      void computeAndStoreVisibilityIndex(property.id).catch(() => {});
    }
  } catch {
    ive = null;
  }

  return {
    property,
    period,
    days,
    dataEnd,
    ranges: { current, previous },
    kpi: {
      ...cur,
      clicksChangePct: pctChange(cur.clicks, prev.clicks),
      impressionsChangePct: pctChange(cur.impressions, prev.impressions),
      ctrChangePct: pctChange(cur.ctr, prev.ctr),
      positionChangeAbs:
        prev.impressions > 0 || prev.position > 0
          ? cur.position - prev.position
          : null,
    },
    chart: chartRes.rows,
    ive,
  };
}

export async function getRanked(dimension, periodRaw, sort = "impressions") {
  const property = await ensureBoutiqueSeoProperty();
  const period = parsePeriod(periodRaw);
  const dataEnd = await resolveDataEnd(property.id);
  const { current } = buildRanges(dataEnd, period);
  const dim = dimension === "page" ? "page" : "query";
  const sortCol =
    sort === "clicks" || sort === "ctr" || sort === "position"
      ? sort
      : "impressions";

  const { rows } = await pool.query(
    `SELECT
        ${dim} AS key,
        SUM(clicks)::int AS clicks,
        SUM(impressions)::int AS impressions,
        CASE WHEN SUM(impressions) > 0
          THEN SUM(clicks)::numeric / SUM(impressions) ELSE 0 END AS ctr,
        CASE WHEN SUM(impressions) > 0
          THEN SUM(position * impressions) / SUM(impressions) ELSE 0 END AS position
     FROM seo_gsc_daily
     WHERE property_id = $1 AND date >= $2::date AND date <= $3::date
     GROUP BY ${dim}
     ORDER BY ${sortCol} DESC NULLS LAST
     LIMIT 200`,
    [property.id, current.start, current.end],
  );

  return {
    propertyId: property.id,
    period,
    dataEnd,
    items: rows.map((r) => ({
      key: r.key,
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
      ctr: Number(r.ctr),
      position: Number(r.position),
    })),
  };
}

export async function getOpportunities() {
  const property = await ensureBoutiqueSeoProperty();
  const dataEnd = await resolveDataEnd(property.id);
  const { current } = buildRanges(dataEnd, "28d");
  const t = SEO_THRESHOLDS;

  const page2to3 = await pool.query(
    `SELECT query, page,
            SUM(impressions)::int AS impressions,
            SUM(clicks)::int AS clicks,
            CASE WHEN SUM(impressions) > 0 THEN SUM(clicks)::numeric / SUM(impressions) ELSE 0 END AS ctr,
            CASE WHEN SUM(impressions) > 0 THEN SUM(position * impressions) / SUM(impressions) ELSE 0 END AS position
     FROM seo_gsc_daily
     WHERE property_id = $1 AND date >= $2::date AND date <= $3::date
     GROUP BY query, page
     HAVING SUM(impressions) >= $4
       AND (SUM(position * impressions) / NULLIF(SUM(impressions), 0)) >= $5
       AND (SUM(position * impressions) / NULLIF(SUM(impressions), 0)) <= $6
     ORDER BY SUM(impressions) DESC
     LIMIT 25`,
    [
      property.id,
      current.start,
      current.end,
      t.page2to3.minImpressions,
      t.page2to3.positionMin,
      t.page2to3.positionMax,
    ],
  );

  const titleImprove = await pool.query(
    `SELECT page,
            SUM(impressions)::int AS impressions,
            SUM(clicks)::int AS clicks,
            CASE WHEN SUM(impressions) > 0 THEN SUM(clicks)::numeric / SUM(impressions) ELSE 0 END AS ctr,
            CASE WHEN SUM(impressions) > 0 THEN SUM(position * impressions) / SUM(impressions) ELSE 0 END AS position
     FROM seo_gsc_daily
     WHERE property_id = $1 AND date >= $2::date AND date <= $3::date
     GROUP BY page
     HAVING SUM(impressions) >= $4
       AND (SUM(position * impressions) / NULLIF(SUM(impressions), 0)) <= $5
       AND (SUM(clicks)::numeric / NULLIF(SUM(impressions), 0)) < $6
     ORDER BY SUM(impressions) DESC
     LIMIT 25`,
    [
      property.id,
      current.start,
      current.end,
      t.titleImprove.minImpressions,
      t.titleImprove.maxPosition,
      t.titleImprove.maxCtr,
    ],
  );

  return {
    propertyId: property.id,
    opportunities: {
      page2to3: page2to3.rows.map((r) => ({
        type: "page_2_3",
        query: r.query,
        page: r.page,
        impressions: Number(r.impressions),
        clicks: Number(r.clicks),
        ctr: Number(r.ctr),
        position: Number(r.position),
      })),
      titleImprove: titleImprove.rows.map((r) => ({
        type: "title_improve",
        page: r.page,
        impressions: Number(r.impressions),
        clicks: Number(r.clicks),
        ctr: Number(r.ctr),
        position: Number(r.position),
      })),
      newQueries: [],
      drops: [],
      cannibalization: [],
    },
  };
}
