import { BetaAnalyticsDataClient } from "@google-analytics/data";
import pool from "../../db/pool.js";
import {
  getOpportunities,
  getOverview,
  getRanked,
} from "./analytics.js";
import { loadGoogleServiceAccountCredentials } from "./gsc.js";
import { ensureBoutiqueSeoProperty } from "./property.js";

function getModel() {
  return (process.env.SEO_AI_MODEL || process.env.ANTHROPIC_MODEL || "").trim();
}

/** Contexte GSC + Analytics pour analyse IA (sans Anthropic). Listes réduites pour éviter 504. */
export async function buildAiContext() {
  const property = await ensureBoutiqueSeoProperty();
  const brand = await brandContext();
  const [overview, opportunities, queries, pages, analytics] =
    await Promise.all([
      getOverview("28d"), // IVE en cache seul — plus d'appel GA4 ici
      getOpportunities(),
      getRanked("query", "28d"),
      getRanked("page", "28d"),
      fetchGa4Snapshot(),
    ]);

  const opp = opportunities.opportunities || {};
  return {
    propertyId: property.id,
    brand,
    period: overview.ranges.current,
    kpi: overview.kpi,
    queries: queries.items.slice(0, 40).map(slimRanked),
    pages: pages.items.slice(0, 25).map(slimRanked),
    opportunities: {
      page2to3: (opp.page2to3 || []).slice(0, 12),
      titleImprove: (opp.titleImprove || []).slice(0, 12),
    },
    analytics,
  };
}

function slimRanked(row) {
  return {
    key: row.key,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: Number(Number(row.ctr).toFixed(4)),
    position: Number(Number(row.position).toFixed(1)),
  };
}

/** Enregistre un rapport déjà généré (ex. depuis Vercel). */
export async function persistAiReport(input) {
  const property = await ensureBoutiqueSeoProperty();
  const payload = validatePayload(input.payload);
  const model = String(input.model || "vercel-seo-ai").trim() || "vercel-seo-ai";
  const periodStart =
    String(input.period_start || "").trim() ||
    new Date().toISOString().slice(0, 10);
  const periodEnd =
    String(input.period_end || "").trim() || periodStart;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reportRes = await client.query(
      `INSERT INTO seo_ai_reports
        (property_id, period_start, period_end, model, data_sufficiency, summary, payload)
       VALUES ($1, $2::date, $3::date, $4, $5, $6, $7::jsonb)
       RETURNING id, property_id, generated_at::text, period_start::text, period_end::text,
                 model, data_sufficiency, summary, payload`,
      [
        property.id,
        periodStart,
        periodEnd,
        model,
        payload.data_sufficiency,
        payload.summary,
        JSON.stringify(payload),
      ],
    );
    const report = reportRes.rows[0];
    const ideas = [];
    for (const idea of payload.article_ideas) {
      const ideaRes = await client.query(
        `INSERT INTO seo_article_ideas
          (property_id, report_id, title, suggested_slug, target_query,
           secondary_queries, search_intent, priority, rationale, outline, faq, source, status)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11::jsonb,$12,'proposee')
         RETURNING id, title, suggested_slug, target_query, secondary_queries,
                   search_intent, priority, rationale, outline, faq, source, status,
                   published_url, created_at::text`,
        [
          property.id,
          report.id,
          idea.title,
          idea.suggested_slug,
          idea.target_query,
          JSON.stringify(idea.secondary_queries),
          idea.search_intent,
          idea.priority,
          idea.rationale,
          JSON.stringify(idea.outline),
          JSON.stringify(idea.faq),
          idea.source,
        ],
      );
      ideas.push(ideaRes.rows[0]);
    }
    await client.query("COMMIT");
    return { report, ideas };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function brandContext() {
  const { rows } = await pool.query(
    `SELECT key, value FROM brand_settings
     WHERE key IN ('brand_name', 'seo_site_url', 'seo_title_default', 'seo_description_default')`,
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const { rows: posts } = await pool.query(
    `SELECT title, slug FROM blog_posts
     WHERE status = 'published'
     ORDER BY published_at DESC NULLS LAST
     LIMIT 15`,
  );
  return {
    brand_name: map.brand_name || "Boutique",
    site_url: map.seo_site_url || process.env.SITE_URL || "",
    seo_title_default: map.seo_title_default || "",
    seo_description_default: map.seo_description_default || "",
    published_articles: posts.map((p) => ({
      title: p.title,
      slug: p.slug,
    })),
  };
}

async function fetchGa4Snapshot() {
  const propertyRaw = (process.env.GA4_PROPERTY_ID || "").trim();
  if (!propertyRaw) return { available: false, error: "GA4_PROPERTY_ID manquant" };
  try {
    const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? undefined
      : loadGoogleServiceAccountCredentials();
    const client = credentials
      ? new BetaAnalyticsDataClient({ credentials })
      : new BetaAnalyticsDataClient();
    const propertyId = propertyRaw.replace(/^properties\//, "");
    const [[kpiResponse], [sourcesResponse]] = await Promise.all([
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        metrics: [
          { name: "activeUsers" },
          { name: "sessions" },
          { name: "bounceRate" },
          { name: "screenPageViews" },
        ],
      }),
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }, { name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 8,
      }),
    ]);
    const kpi = kpiResponse.rows?.[0]?.metricValues || [];
    return {
      available: true,
      kpi: {
        users: parseInt(kpi[0]?.value || "0", 10) || 0,
        sessions: parseInt(kpi[1]?.value || "0", 10) || 0,
        bounce_rate: Number(parseFloat(kpi[2]?.value || "0").toFixed(1)),
        page_views: parseInt(kpi[3]?.value || "0", 10) || 0,
      },
      sources:
        sourcesResponse.rows?.map((row) => ({
          channel: row.dimensionValues?.[0]?.value || "Unknown",
          sessions: parseInt(row.metricValues?.[0]?.value || "0", 10),
          users: parseInt(row.metricValues?.[1]?.value || "0", 10),
        })) || [],
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractJsonObject(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() || trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Réponse IA sans JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

function validatePayload(input) {
  if (!input || typeof input !== "object") throw new Error("Payload invalide");
  const sufficiency = String(input.data_sufficiency || "");
  if (sufficiency !== "ok" && sufficiency !== "low") {
    throw new Error('data_sufficiency doit être "ok" ou "low"');
  }
  const summary = String(input.summary || "").trim();
  if (!summary) throw new Error("summary manquant");
  const article_ideas = Array.isArray(input.article_ideas)
    ? input.article_ideas.filter((x) => x && String(x.title || "").trim())
    : [];
  if (!article_ideas.length) throw new Error("Aucune idée d'article");
  return {
    data_sufficiency: sufficiency,
    summary,
    quick_wins: Array.isArray(input.quick_wins) ? input.quick_wins : [],
    title_rewrites: Array.isArray(input.title_rewrites)
      ? input.title_rewrites
      : [],
    traffic_actions: Array.isArray(input.traffic_actions)
      ? input.traffic_actions
      : [],
    article_ideas: article_ideas.slice(0, 8).map((idea) => ({
      title: String(idea.title),
      suggested_slug: String(idea.suggested_slug || ""),
      target_query: String(idea.target_query || ""),
      secondary_queries: Array.isArray(idea.secondary_queries)
        ? idea.secondary_queries.filter((x) => typeof x === "string")
        : [],
      search_intent: ["informationnelle", "comparative", "transactionnelle"].includes(
        idea.search_intent,
      )
        ? idea.search_intent
        : "informationnelle",
      priority: [1, 2, 3].includes(Number(idea.priority))
        ? Number(idea.priority)
        : 2,
      rationale: String(idea.rationale || ""),
      outline: Array.isArray(idea.outline)
        ? idea.outline.filter((x) => typeof x === "string")
        : [],
      faq: Array.isArray(idea.faq)
        ? idea.faq.filter((x) => typeof x === "string")
        : [],
      source: idea.source === "positioning" ? "positioning" : "data",
    })),
  };
}

async function callClaude(model, brand, context) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non configuré");
  if (!model) {
    throw new Error(
      "SEO_AI_MODEL manquant — définissez le modèle Claude pour l'analyse SEO",
    );
  }

  const system = `Tu es un stratège SEO pour la boutique « ${brand.brand_name} » (${brand.site_url}).
Réponds UNIQUEMENT en JSON strict (pas de markdown), en français.
S'appuyer uniquement sur les données fournies. Ne jamais inventer de chiffres.
Croiser GSC et Analytics quand analytics.available = true.
Distinguer impressions GSC ≠ sessions Analytics.
Ne pas proposer de sujets déjà couverts.
5 à 8 idées d'articles max.
Schéma:
{
  "data_sufficiency":"ok|low",
  "summary":"",
  "quick_wins":[{"page":"","query":"","action":"","evidence":""}],
  "title_rewrites":[{"page":"","current_issue":"","suggested_title":"","suggested_meta_description":""}],
  "traffic_actions":[{"channel":"","action":"","evidence":"","priority":1}],
  "article_ideas":[{"title":"","suggested_slug":"","target_query":"","secondary_queries":[],"search_intent":"informationnelle|comparative|transactionnelle","priority":1,"rationale":"","outline":[],"faq":[],"source":"data|positioning"}]
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages: [
        {
          role: "user",
          content: `Analyse ces données SEO boutique et réponds en JSON strict.\n\n${JSON.stringify(context)}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Anthropic HTTP ${res.status}${errText ? ` — ${errText.slice(0, 300)}` : ""}`,
    );
  }
  const data = await res.json();
  const text = data.content?.find((c) => c.type === "text")?.text || "";
  if (!text.trim()) throw new Error("Réponse Anthropic vide");
  return text;
}

export async function generateAiReport() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY non configuré sur l'API — lancez l'analyse depuis le front boutique",
    );
  }
  const model = getModel();
  const context = await buildAiContext();
  let payload = null;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callClaude(
        model,
        context.brand,
        attempt === 0
          ? context
          : {
              ...context,
              _retry_note:
                "Réponse précédente invalide. Renvoie UNIQUEMENT un JSON conforme.",
            },
      );
      payload = validatePayload(extractJsonObject(text));
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (!payload) throw lastError || new Error("Échec analyse IA");
  return persistAiReport({
    payload,
    model,
    period_start: context.period.start,
    period_end: context.period.end,
  });
}

export async function listAiReports(limit = 10) {
  const property = await ensureBoutiqueSeoProperty();
  const { rows } = await pool.query(
    `SELECT id, property_id, generated_at::text, period_start::text, period_end::text,
            model, data_sufficiency, summary, payload
     FROM seo_ai_reports
     WHERE property_id = $1
     ORDER BY generated_at DESC
     LIMIT $2`,
    [property.id, limit],
  );
  return rows;
}

export async function listArticleIdeas() {
  const property = await ensureBoutiqueSeoProperty();
  const { rows } = await pool.query(
    `SELECT id, title, suggested_slug, target_query, secondary_queries,
            search_intent, priority, rationale, outline, faq, source, status,
            published_url, created_at::text, updated_at::text
     FROM seo_article_ideas
     WHERE property_id = $1
     ORDER BY priority ASC, created_at DESC`,
    [property.id],
  );
  return rows;
}
