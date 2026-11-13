import { BetaAnalyticsDataClient } from "@google-analytics/data";
import pool from "../../db/pool.js";
import { loadGoogleServiceAccountCredentials } from "./gsc.js";
import { buildRanges, resolveDataEnd } from "./analytics.js";

const TARGETS = {
  impressions: 5000,
  clicks: 200,
  ctr: 0.03,
  organicSessions: 150,
};
const WEIGHTS = { discovery: 0.35, attraction: 0.35, traffic: 0.3 };

function clamp(n, min = 0, max = 100) {
  return Math.min(max, Math.max(min, n));
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
function logScore(raw, target) {
  if (raw <= 0 || target <= 0) return 0;
  return clamp((Math.log10(1 + raw) / Math.log10(1 + target)) * 50);
}
function mondayOf(isoDate) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function getGa4Client() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new BetaAnalyticsDataClient();
  }
  const credentials = loadGoogleServiceAccountCredentials();
  return new BetaAnalyticsDataClient({ credentials });
}

async function fetchOrganicSessions(start, end) {
  const propertyRaw = (process.env.GA4_PROPERTY_ID || "").trim();
  if (!propertyRaw) {
    return { sessions: 0, available: false, error: "GA4_PROPERTY_ID manquant" };
  }
  const propertyId = propertyRaw.replace(/^properties\//, "");
  try {
    const client = getGa4Client();
    const [response] = await client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: start, endDate: end }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      dimensionFilter: {
        filter: {
          fieldName: "sessionDefaultChannelGroup",
          stringFilter: { matchType: "EXACT", value: "Organic Search" },
        },
      },
    });
    const sessions = parseInt(
      response.rows?.[0]?.metricValues?.[0]?.value || "0",
      10,
    );
    return { sessions: sessions || 0, available: true };
  } catch (error) {
    return {
      sessions: 0,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchGscBundle(propertyId, start, end) {
  const { rows } = await pool.query(
    `WITH by_query AS (
      SELECT query,
             SUM(impressions)::numeric AS impressions,
             SUM(clicks)::numeric AS clicks,
             CASE WHEN SUM(impressions) > 0
               THEN SUM(position * impressions) / SUM(impressions) ELSE NULL END AS position
      FROM seo_gsc_daily
      WHERE property_id = $1 AND date >= $2::date AND date <= $3::date
      GROUP BY query
    )
    SELECT
      COALESCE(SUM(impressions), 0)::text AS impressions,
      COALESCE(SUM(clicks), 0)::text AS clicks,
      CASE WHEN SUM(impressions) > 0
        THEN (SUM(clicks) / SUM(impressions))::text ELSE '0' END AS ctr,
      COUNT(*)::text AS query_count,
      COUNT(*) FILTER (WHERE position IS NOT NULL AND position <= 10)::text AS top10_count
    FROM by_query`,
    [propertyId, start, end],
  );
  const row = rows[0] || {};
  const queryCount = Number(row.query_count || 0);
  const top10Count = Number(row.top10_count || 0);
  return {
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
    ctr: Number(row.ctr || 0),
    top10Share: queryCount > 0 ? top10Count / queryCount : 0,
  };
}

function scorePillars(gsc, organicSessions) {
  const discovery = round1(
    0.6 * logScore(gsc.impressions, TARGETS.impressions) +
      0.4 * clamp(gsc.top10Share * 100),
  );
  const ctrPart = clamp((gsc.ctr / TARGETS.ctr) * 50);
  const attraction = round1(
    0.7 * logScore(gsc.clicks, TARGETS.clicks) + 0.3 * ctrPart,
  );
  const traffic = round1(logScore(organicSessions, TARGETS.organicSessions));
  const ive = round1(
    WEIGHTS.discovery * discovery +
      WEIGHTS.attraction * attraction +
      WEIGHTS.traffic * traffic,
  );
  return { discovery, attraction, traffic, ive };
}

export async function computeAndStoreVisibilityIndex(propertyId) {
  const dataEnd = await resolveDataEnd(propertyId);
  const { current } = buildRanges(dataEnd, "28d");
  const weekStart = mondayOf(dataEnd);
  const [gsc, organic] = await Promise.all([
    fetchGscBundle(propertyId, current.start, current.end),
    fetchOrganicSessions(current.start, current.end),
  ]);
  const scored = scorePillars(gsc, organic.available ? organic.sessions : 0);

  const { rows } = await pool.query(
    `INSERT INTO seo_visibility_index (
      property_id, week_start, period_start, period_end,
      ive, discovery, attraction, traffic,
      impressions, clicks, ctr, top10_share,
      organic_sessions, analytics_available, components
    ) VALUES (
      $1, $2::date, $3::date, $4::date,
      $5, $6, $7, $8,
      $9, $10, $11, $12,
      $13, $14, $15::jsonb
    )
    ON CONFLICT (property_id, week_start) DO UPDATE SET
      period_start = EXCLUDED.period_start,
      period_end = EXCLUDED.period_end,
      ive = EXCLUDED.ive,
      discovery = EXCLUDED.discovery,
      attraction = EXCLUDED.attraction,
      traffic = EXCLUDED.traffic,
      impressions = EXCLUDED.impressions,
      clicks = EXCLUDED.clicks,
      ctr = EXCLUDED.ctr,
      top10_share = EXCLUDED.top10_share,
      organic_sessions = EXCLUDED.organic_sessions,
      analytics_available = EXCLUDED.analytics_available,
      components = EXCLUDED.components,
      created_at = NOW()
    RETURNING
      id, property_id,
      week_start::text, period_start::text, period_end::text,
      ive::float8 AS ive, discovery::float8 AS discovery,
      attraction::float8 AS attraction, traffic::float8 AS traffic,
      impressions, clicks, ctr::float8 AS ctr,
      top10_share::float8 AS top10_share,
      organic_sessions, analytics_available, created_at::text`,
    [
      propertyId,
      weekStart,
      current.start,
      current.end,
      scored.ive,
      scored.discovery,
      scored.attraction,
      scored.traffic,
      gsc.impressions,
      gsc.clicks,
      gsc.ctr,
      gsc.top10Share,
      organic.sessions,
      organic.available,
      JSON.stringify({ weights: WEIGHTS, targets: TARGETS, analytics: organic }),
    ],
  );
  return rows[0];
}

async function readVisibilityRows(propertyId) {
  const { rows } = await pool.query(
    `SELECT
      week_start::text, period_start::text, period_end::text,
      ive::float8 AS ive, discovery::float8 AS discovery,
      attraction::float8 AS attraction, traffic::float8 AS traffic,
      impressions, clicks, ctr::float8 AS ctr,
      top10_share::float8 AS top10_share,
      organic_sessions, analytics_available, created_at
     FROM seo_visibility_index
     WHERE property_id = $1
     ORDER BY week_start DESC
     LIMIT 16`,
    [propertyId],
  );
  return rows;
}

/**
 * Par défaut : lecture cache uniquement (rapide).
 * refresh=true : recalcule via GSC+GA4 (après sync ou action manuelle).
 */
export async function getVisibilityIndexView(propertyId, opts = {}) {
  let rows = await readVisibilityRows(propertyId);
  if (opts.refresh) {
    try {
      await computeAndStoreVisibilityIndex(propertyId);
      rows = await readVisibilityRows(propertyId);
    } catch {
      // lecture seule si GSC vide / GA4 KO
    }
  }
  const current = rows[0] || null;
  const previous = rows[1] || null;
  const delta =
    current && previous
      ? round1(Number(current.ive) - Number(previous.ive))
      : null;
  return {
    current,
    previous,
    delta,
    history: [...rows]
      .reverse()
      .map((r) => ({
        week_start: r.week_start,
        ive: Number(r.ive),
        discovery: Number(r.discovery),
        attraction: Number(r.attraction),
        traffic: Number(r.traffic),
      })),
  };
}
