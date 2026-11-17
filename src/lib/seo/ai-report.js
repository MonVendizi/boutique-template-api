import { BetaAnalyticsDataClient } from "@google-analytics/data";
import pool from "../../db/pool.js";
import { withGa4Cache } from "../ga4-cache.js";
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
  // overview d'abord : la période sert au matching GSC des articles publiés
  const overview = await getOverview("28d"); // IVE en cache seul — plus d'appel GA4 ici
  const [opportunities, queries, pages, analytics, published_articles] =
    await Promise.all([
      getOpportunities(),
      getRanked("query", "28d"),
      getRanked("page", "28d"),
      fetchGa4Snapshot(),
      loadPublishedArticlesWithPerf(
        property.id,
        brand.site_url,
        overview.ranges.current,
      ),
    ]);

  const opp = opportunities.opportunities || {};
  await syncOpenIdeasWithPublishedBlog().catch(() => null);

  const { getEditorialPipeline, pruneExcessOpenIdeas } = await import(
    "./editorialPipeline.js"
  );
  await pruneExcessOpenIdeas().catch(() => null);
  const editorial_pipeline = await getEditorialPipeline();

  return {
    propertyId: property.id,
    brand: {
      ...brand,
      // Liste courte anti-doublon (détail + perf = published_articles racine)
      published_articles: published_articles.map((a) => ({
        title: a.title,
        slug: a.slug,
        url: a.url,
      })),
    },
    period: overview.ranges.current,
    kpi: overview.kpi,
    queries: queries.items.slice(0, 40).map(slimRanked),
    pages: pages.items.slice(0, 25).map(slimRanked),
    opportunities: {
      page2to3: (opp.page2to3 || []).slice(0, 12),
      titleImprove: (opp.titleImprove || []).slice(0, 12),
    },
    analytics,
    editorial_pipeline,
    published_articles,
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

/** Normalise titre/slug pour détecter doublons proches. */
export function normalizeSeoText(raw) {
  return String(raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Vrai si deux titres/slugs couvrent le même sujet (anti-cannibalisation). */
export function titlesOverlap(a, b) {
  const na = normalizeSeoText(a);
  const nb = normalizeSeoText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const stop = new Set([
    "pour",
    "avec",
    "dans",
    "une",
    "des",
    "les",
    "votre",
    "comment",
    "quel",
    "quelle",
    "quels",
    "guide",
    "complet",
    "article",
  ]);
  const wa = na.split(/[\s-]+/).filter((w) => w.length > 3 && !stop.has(w));
  const wb = nb.split(/[\s-]+/).filter((w) => w.length > 3 && !stop.has(w));
  if (wa.length === 0 || wb.length === 0) return false;
  const setA = new Set(wa);
  const hits = wb.filter((w) => setA.has(w)).length;
  const ratio = hits / Math.max(setA.size, wb.length);
  return hits >= 2 && ratio >= 0.5;
}

/**
 * Si la cliente a publié dans Blog sans passer par « À écrire »,
 * marque les idées ouvertes correspondantes comme publiées.
 */
export async function syncOpenIdeasWithPublishedBlog() {
  const property = await ensureBoutiqueSeoProperty();
  const { rows: posts } = await pool.query(
    `SELECT title, slug, published_at::text
     FROM blog_posts
     WHERE status = 'published'
     ORDER BY published_at DESC NULLS LAST
     LIMIT 40`,
  );
  if (posts.length === 0) return { matched: 0, ids: [] };

  const { rows: ideas } = await pool.query(
    `SELECT id, title, suggested_slug, target_query, status
     FROM seo_article_ideas
     WHERE property_id = $1
       AND status = ANY($2::text[])`,
    [property.id, ["proposee", "retenue", "redigee"]],
  );
  if (ideas.length === 0) return { matched: 0, ids: [] };

  const site =
    (await brandContext()).site_url.replace(/\/$/, "") ||
    (process.env.SITE_URL || "").replace(/\/$/, "");

  const matchedIds = [];
  for (const idea of ideas) {
    const hit = posts.find((p) => {
      if (
        idea.suggested_slug &&
        normalizeSeoText(idea.suggested_slug) === normalizeSeoText(p.slug)
      ) {
        return true;
      }
      if (titlesOverlap(idea.title, p.title)) return true;
      if (idea.target_query && titlesOverlap(idea.target_query, p.title)) {
        return true;
      }
      if (idea.target_query && titlesOverlap(idea.target_query, p.slug)) {
        return true;
      }
      return false;
    });
    if (!hit) continue;

    const url = site ? `${site}/blog/${hit.slug}` : `/blog/${hit.slug}`;
    await pool.query(
      `UPDATE seo_article_ideas
       SET status = 'publiee',
           published_url = COALESCE(published_url, $2),
           updated_at = NOW()
       WHERE id = $1`,
      [idea.id, url],
    );
    matchedIds.push(idea.id);
    try {
      const { deleteCalendarTaskForIdea } = await import(
        "./scheduleArticleIdeas.js"
      );
      await deleteCalendarTaskForIdea(idea.id);
    } catch {
      // ignore
    }
  }

  return { matched: matchedIds.length, ids: matchedIds };
}

function filterIdeasAgainstPublished(ideas, published) {
  const posts = Array.isArray(published) ? published : [];
  return (Array.isArray(ideas) ? ideas : []).filter((idea) => {
    const title = idea?.title || "";
    const slug = idea?.suggested_slug || "";
    const query = idea?.target_query || "";
    return !posts.some(
      (p) =>
        titlesOverlap(title, p.title) ||
        titlesOverlap(title, p.slug) ||
        (slug && titlesOverlap(slug, p.slug)) ||
        (query && titlesOverlap(query, p.title)),
    );
  });
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

  await syncOpenIdeasWithPublishedBlog().catch(() => null);
  const { getEditorialPipeline, pruneExcessOpenIdeas } = await import(
    "./editorialPipeline.js"
  );
  await pruneExcessOpenIdeas().catch(() => null);
  const pipeline = await getEditorialPipeline();

  const { rows: publishedRows } = await pool.query(
    `SELECT title, slug FROM blog_posts WHERE status = 'published' LIMIT 40`,
  );
  const freshIdeas = filterIdeasAgainstPublished(
    payload.article_ideas,
    publishedRows,
  );
  const ideasToInsert = freshIdeas.slice(
    0,
    Math.min(pipeline.slots_available, pipeline.max_new_per_report),
  );

  let report = null;
  let ideas = [];
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
    report = reportRes.rows[0];
    for (const idea of ideasToInsert) {
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
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  let calendar = { scheduled: [] };
  try {
    const { scheduleArticleIdeas, scheduleUnplannedArticleIdeas } =
      await import("./scheduleArticleIdeas.js");
    const fromReport = await scheduleArticleIdeas(ideas, {
      maxNew: pipeline.max_open,
    });
    const backfill = await scheduleUnplannedArticleIdeas();
    const seen = new Set(
      (fromReport.scheduled || []).map((s) => s.idea_id),
    );
    calendar = {
      scheduled: [
        ...(fromReport.scheduled || []),
        ...(backfill.scheduled || []).filter((s) => !seen.has(s.idea_id)),
      ],
      pipeline: await getEditorialPipeline(),
      ideas_inserted: ideas.length,
      ideas_skipped_for_queue:
        payload.article_ideas.length - ideasToInsert.length,
    };
    const refreshed = await listArticleIdeasByIds(ideas.map((i) => i.id));
    return { report, ideas: refreshed.length ? refreshed : ideas, calendar };
  } catch (schedErr) {
    console.error("scheduleArticleIdeas:", schedErr);
    return { report, ideas, calendar };
  }
}

const IDEA_STATUSES = [
  "proposee",
  "retenue",
  "redigee",
  "publiee",
  "rejetee",
];

async function listArticleIdeasByIds(ids) {
  if (!ids.length) return [];
  const { rows } = await pool.query(
    `SELECT id, title, suggested_slug, target_query, secondary_queries,
            search_intent, priority, rationale, outline, faq, source, status,
            published_url, created_at::text, updated_at::text
     FROM seo_article_ideas
     WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return rows;
}

export async function updateArticleIdea(ideaId, patch = {}) {
  if (patch.status && !IDEA_STATUSES.includes(patch.status)) {
    throw new Error("Statut invalide");
  }

  const { rows } = await pool.query(
    `UPDATE seo_article_ideas
     SET
       status = COALESCE($2, status),
       published_url = CASE WHEN $3::boolean THEN $4 ELSE published_url END,
       updated_at = NOW()
     WHERE id = $1
     RETURNING id, title, suggested_slug, target_query, secondary_queries,
               search_intent, priority, rationale, outline, faq, source, status,
               published_url, created_at::text, updated_at::text`,
    [
      ideaId,
      patch.status || null,
      patch.published_url !== undefined,
      patch.published_url ?? null,
    ],
  );
  const idea = rows[0] || null;
  if (!idea) return null;

  const {
    deleteCalendarTaskForIdea,
    postponeCalendarTaskForIdea,
    findCalendarTaskForIdea,
  } = await import("./scheduleArticleIdeas.js");

  if (idea.status === "rejetee" || idea.status === "publiee") {
    await deleteCalendarTaskForIdea(idea.id).catch(() => null);
  }

  let calendar_task = await findCalendarTaskForIdea(idea.id);
  if (patch.postpone_days != null && calendar_task) {
    calendar_task = await postponeCalendarTaskForIdea(
      idea.id,
      Number(patch.postpone_days),
    );
  }

  return {
    ...idea,
    calendar_task_id: calendar_task?.id ?? null,
    calendar_date: calendar_task?.date ?? null,
  };
}

async function brandContext() {
  const { rows } = await pool.query(
    `SELECT key, value FROM brand_settings
     WHERE key IN ('brand_name', 'seo_site_url', 'seo_title_default', 'seo_description_default')`,
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    brand_name: map.brand_name || "Boutique",
    site_url: map.seo_site_url || process.env.SITE_URL || "",
    seo_title_default: map.seo_title_default || "",
    seo_description_default: map.seo_description_default || "",
  };
}

function daysSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000)));
}

function verdictForArticle({ days_live, gsc }) {
  if (days_live != null && days_live < 14) return "too_young";
  if (!gsc || gsc.impressions <= 0) {
    return days_live != null && days_live >= 28 ? "no_signal" : "waiting";
  }
  if (gsc.position >= 11 && gsc.position <= 30 && gsc.impressions >= 20) {
    return "expand_content";
  }
  if (gsc.position <= 10 && gsc.ctr < 0.02 && gsc.impressions >= 30) {
    return "weak_ctr";
  }
  if (gsc.clicks >= 3 || gsc.impressions >= 50) return "performing";
  return "thin_signal";
}

/**
 * Articles publiés + contenu éditable + perf GSC 28j (pour corrections concrètes).
 */
async function loadPublishedArticlesWithPerf(propertyId, siteUrl, period) {
  const { rows: posts } = await pool.query(
    `SELECT title, slug, excerpt, seo_title, seo_description, seo_keywords,
            sections, faq, published_at::text
     FROM blog_posts
     WHERE status = 'published'
     ORDER BY published_at DESC NULLS LAST
     LIMIT 20`,
  );
  if (posts.length === 0) return [];

  const base = String(siteUrl || "")
    .trim()
    .replace(/\/$/, "");
  const start = period?.start;
  const end = period?.end;

  let pageRows = [];
  let queryRows = [];
  if (start && end) {
    const pagesRes = await pool.query(
      `SELECT page,
              SUM(clicks)::int AS clicks,
              SUM(impressions)::int AS impressions,
              CASE WHEN SUM(impressions) > 0
                THEN SUM(clicks)::numeric / SUM(impressions) ELSE 0 END AS ctr,
              CASE WHEN SUM(impressions) > 0
                THEN SUM(position * impressions) / SUM(impressions) ELSE 0 END AS position
       FROM seo_gsc_daily
       WHERE property_id = $1 AND date >= $2::date AND date <= $3::date
         AND page ILIKE '%/blog/%'
       GROUP BY page`,
      [propertyId, start, end],
    );
    pageRows = pagesRes.rows;

    const queriesRes = await pool.query(
      `SELECT page, query,
              SUM(clicks)::int AS clicks,
              SUM(impressions)::int AS impressions,
              CASE WHEN SUM(impressions) > 0
                THEN SUM(position * impressions) / SUM(impressions) ELSE 0 END AS position
       FROM seo_gsc_daily
       WHERE property_id = $1 AND date >= $2::date AND date <= $3::date
         AND page ILIKE '%/blog/%'
       GROUP BY page, query
       HAVING SUM(impressions) > 0
       ORDER BY SUM(impressions) DESC`,
      [propertyId, start, end],
    );
    queryRows = queriesRes.rows;
  }

  function matchPage(slug) {
    const needle = `/blog/${slug}`;
    return (
      pageRows.find((r) => {
        const p = String(r.page || "");
        try {
          const path = new URL(p).pathname.replace(/\/$/, "");
          return path === needle || path.endsWith(needle);
        } catch {
          return p.includes(needle);
        }
      }) || null
    );
  }

  function topQueriesForSlug(slug, limit = 5) {
    const needle = `/blog/${slug}`;
    return queryRows
      .filter((r) => String(r.page || "").includes(needle))
      .slice(0, limit)
      .map((r) => ({
        query: r.query,
        clicks: Number(r.clicks) || 0,
        impressions: Number(r.impressions) || 0,
        position: Number(Number(r.position).toFixed(1)),
      }));
  }

  return posts.map((p) => {
    const days_live = daysSince(p.published_at);
    const page = matchPage(p.slug);
    const gsc = page
      ? {
          page: page.page,
          clicks: Number(page.clicks) || 0,
          impressions: Number(page.impressions) || 0,
          ctr: Number(Number(page.ctr).toFixed(4)),
          position: Number(Number(page.position).toFixed(1)),
        }
      : null;
    const sections = Array.isArray(p.sections) ? p.sections : [];
    const faq = Array.isArray(p.faq) ? p.faq : [];
    const keywords = Array.isArray(p.seo_keywords) ? p.seo_keywords : [];
    return {
      title: p.title,
      slug: p.slug,
      url: base ? `${base}/blog/${p.slug}` : `/blog/${p.slug}`,
      published_at: p.published_at,
      days_live,
      seo_title: p.seo_title || p.title || "",
      seo_description: (p.seo_description || "").slice(0, 320),
      excerpt: (p.excerpt || "").slice(0, 280),
      seo_keywords: keywords
        .filter((k) => typeof k === "string")
        .slice(0, 8),
      h2: sections
        .map((s) => String(s?.h2 || "").trim())
        .filter(Boolean)
        .slice(0, 8),
      faq_questions: faq
        .map((f) => String(f?.question || "").trim())
        .filter(Boolean)
        .slice(0, 6),
      gsc_28d: gsc,
      top_queries: topQueriesForSlug(p.slug),
      verdict: verdictForArticle({ days_live, gsc }),
    };
  });
}

async function fetchGa4Snapshot() {
  const propertyRaw = (process.env.GA4_PROPERTY_ID || "").trim();
  if (!propertyRaw) return { available: false, error: "GA4_PROPERTY_ID manquant" };
  const propertyId = propertyRaw.replace(/^properties\//, "");
  try {
    return await withGa4Cache(`seo-snapshot:${propertyId}`, 10 * 60 * 1000, async () => {
      const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? undefined
        : loadGoogleServiceAccountCredentials();
      const client = credentials
        ? new BetaAnalyticsDataClient({ credentials })
        : new BetaAnalyticsDataClient();
      const callOpts = { timeout: 12_000 };
      // Séquentiel + cache : économise le quota concurrent
      const [kpiResponse] = await client.runReport(
        {
          property: `properties/${propertyId}`,
          dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
          metrics: [
            { name: "activeUsers" },
            { name: "sessions" },
            { name: "bounceRate" },
            { name: "screenPageViews" },
          ],
        },
        callOpts,
      );
      const [sourcesResponse] = await client.runReport(
        {
          property: `properties/${propertyId}`,
          dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
          dimensions: [{ name: "sessionDefaultChannelGroup" }],
          metrics: [{ name: "sessions" }, { name: "activeUsers" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 8,
        },
        callOpts,
      );
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
    });
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
  // 0 idée autorisé si la file éditoriale est pleine (slots_available = 0)
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
    article_ideas: article_ideas.slice(0, 1).map((idea) => ({
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
Ne pas proposer de sujets déjà couverts (published_articles / open_ideas).
INTERDIT de « recréer » un article déjà dans published_articles (même titre proche, même intention, ex. deux « tableau bord de mer »).
Si deux articles publiés se cannibalisent : proposer une fusion/renforcement (quick_wins), PAS un 3ᵉ article.

ARTICLES PUBLIÉS (obligatoire) — context.published_articles :
Chaque entrée a titre, slug, seo_title/meta, H2, FAQ, gsc_28d, top_queries, verdict.
Priorité ABSOLUE : corriger/renforcer ces pages AVANT de proposer un nouvel article.
- too_young : ne pas juger, pas de suppression.
- weak_ctr : title_rewrites concrets (nouveau seo_title + meta) via Admin → Blog → [slug].
- expand_content : quick_wins = ajouter H2/FAQ ciblées sur top_queries (textes proposés).
- no_signal (≥28j, 0 impr.) : quick_win = retarget titre/angle OU fusion/dépublication si hors sujet.
- performing : éventuel renforcement léger (FAQ), pas de doublon de sujet.
Cite toujours le slug et les chiffres fournis dans evidence.

FILE ÉDITORIALE — context.editorial_pipeline :
- Max 2 idées ouvertes. Proposer au plus slots_available (souvent 0 ou 1).
- Si slots_available = 0 OU s'il reste des corrections utiles sur published_articles : article_ideas = [].
- Préférer 1 sujet data plutôt que plusieurs sujets inventés.
- Boucle : écrire → publier → mesurer 2–4 sem. → corriger → seulement alors nouveau sujet.

Chaque action faisable dans l'admin (admin_path obligatoire).
AUTORISÉ : Personnalisation SEO, fiches produits, Blog, Avis, Footer (URL profil), Paramètres (lien avis Google).
INTERDIT : posts réseaux, Ads, GTM/GA4 config, Search Console technique, sitemap, DNS, code.
Schéma:
{
  "data_sufficiency":"ok|low",
  "summary":"",
  "quick_wins":[{"page":"","query":"","action":"","evidence":"","admin_path":"Admin → …"}],
  "title_rewrites":[{"page":"","current_issue":"","suggested_title":"","suggested_meta_description":"","admin_path":"Admin → …"}],
  "traffic_actions":[{"channel":"","action":"","evidence":"","priority":1,"admin_path":"Admin → …"}],
  "article_ideas":[]
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
  try {
    await syncOpenIdeasWithPublishedBlog();
  } catch {
    // ignore
  }
  try {
    const { pruneExcessOpenIdeas } = await import("./editorialPipeline.js");
    await pruneExcessOpenIdeas();
  } catch {
    // ignore
  }
  const { rows } = await pool.query(
    `SELECT id, title, suggested_slug, target_query, secondary_queries,
            search_intent, priority, rationale, outline, faq, source, status,
            published_url, created_at::text, updated_at::text
     FROM seo_article_ideas
     WHERE property_id = $1
     ORDER BY priority ASC, created_at DESC`,
    [property.id],
  );

  const { rows: tasks } = await pool.query(
    `SELECT id, date::text AS date, description
     FROM calendar_tasks
     WHERE description LIKE '%[seo-idea:%'`,
  );
  const byIdea = new Map();
  for (const t of tasks) {
    const m = String(t.description || "").match(
      /\[seo-idea:([0-9a-f-]{36})\]/i,
    );
    if (m) {
      byIdea.set(m[1].toLowerCase(), {
        calendar_task_id: t.id,
        calendar_date: t.date,
      });
    }
  }

  return rows.map((idea) => {
    const key = String(idea.id || "").toLowerCase();
    return {
      ...idea,
      calendar_task_id: byIdea.get(key)?.calendar_task_id ?? null,
      calendar_date: byIdea.get(key)?.calendar_date ?? null,
    };
  });
}
