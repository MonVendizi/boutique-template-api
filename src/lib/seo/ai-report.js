import { BetaAnalyticsDataClient } from "@google-analytics/data";
import pool from "../../db/pool.js";
import { withGa4Cache } from "../ga4-cache.js";
import {
  getOpportunities,
  getOverview,
  getRanked,
} from "./analytics.js";
import { loadGoogleServiceAccountCredentials } from "./gsc.js";
import {
  buildInternalLinksReport,
  slimInternalLinksForAi,
} from "./internal-links.js";
import { ensureBoutiqueSeoProperty } from "./property.js";
import { IVE_TARGETS, IVE_WEIGHTS } from "./visibility.js";

function getModel() {
  return (process.env.SEO_AI_MODEL || process.env.ANTHROPIC_MODEL || "").trim();
}

/** Bloc IVE compact pour le prompt IA (objectif = faire monter le score). */
export function slimIveForAi(iveView) {
  const current = iveView?.current;
  if (!current) {
    return {
      available: false,
      score: null,
      delta: null,
      pillars: null,
      weakest_pillar: null,
      targets: IVE_TARGETS,
      weights: IVE_WEIGHTS,
      note: "Pas encore de mesure — prioriser la découverte Google puis les clics.",
    };
  }
  const pillars = {
    discovery: Number(current.discovery),
    attraction: Number(current.attraction),
    traffic: Number(current.traffic),
  };
  const weakest_pillar = Object.entries(pillars).sort(
    (a, b) => a[1] - b[1],
  )[0]?.[0];
  return {
    available: true,
    score: Number(current.ive),
    delta: iveView.delta,
    week_start: current.week_start,
    pillars,
    weakest_pillar,
    raw: {
      impressions: current.impressions,
      clicks: current.clicks,
      ctr: current.ctr,
      top10_share: current.top10_share,
      organic_sessions: current.organic_sessions,
    },
    analytics_available: Boolean(current.analytics_available),
    targets: IVE_TARGETS,
    weights: IVE_WEIGHTS,
    objective:
      "Faire monter le score de visibilité vers 100 en priorisant le pilier le plus faible.",
  };
}

/** Contexte GSC + Analytics pour analyse IA (sans Anthropic). Listes réduites pour éviter 504. */
export async function buildAiContext() {
  const property = await ensureBoutiqueSeoProperty();
  const brand = await brandContext();
  // overview d'abord : la période sert au matching GSC des articles publiés
  const overview = await getOverview("28d"); // IVE en cache seul — plus d'appel GA4 ici
  const impressionsBySlug = new Map();
  const [opportunities, queries, pages, analytics, published_articles, internalLinksRaw] =
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
      buildInternalLinksReport({ siteUrl: brand.site_url }).catch((err) => {
        console.warn("[seo] internal-links:", err?.message || err);
        return null;
      }),
    ]);

  for (const a of published_articles) {
    const imp = Number(a?.gsc_28d?.impressions) || 0;
    if (a?.slug) impressionsBySlug.set(String(a.slug), imp);
  }

  // Réinjecter impressions GSC dans le bilan si disponible
  let internal_links = null;
  if (internalLinksRaw) {
    if (impressionsBySlug.size) {
      for (const row of internalLinksRaw.per_article || []) {
        row.impressions = impressionsBySlug.get(String(row.slug)) || 0;
      }
      for (const row of internalLinksRaw.articles_without_internal || []) {
        row.impressions = impressionsBySlug.get(String(row.slug)) || 0;
      }
    }
    const { rows: sectionRows } = await pool
      .query(
        `SELECT slug, sections FROM blog_posts WHERE status = 'published'`,
      )
      .catch(() => ({ rows: [] }));
    internal_links = slimInternalLinksForAi(internalLinksRaw, sectionRows);
  }

  const opp = opportunities.opportunities || {};
  await syncOpenIdeasWithPublishedBlog().catch(() => null);

  const { getEditorialPipeline, pruneExcessOpenIdeas } = await import(
    "./editorialPipeline.js"
  );
  await pruneExcessOpenIdeas().catch(() => null);
  const editorial_pipeline = await getEditorialPipeline();
  const similar_article_pairs = findSimilarPublishedPairs(
    published_articles,
    brand.brand_name || "",
  );

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
    ive: slimIveForAi(overview.ive),
    queries: queries.items.slice(0, 40).map(slimRanked),
    pages: pages.items.slice(0, 25).map(slimRanked),
    opportunities: {
      page2to3: (opp.page2to3 || []).slice(0, 12),
      titleImprove: (opp.titleImprove || []).slice(0, 12),
    },
    analytics,
    editorial_pipeline,
    published_articles,
    similar_article_pairs,
    internal_links,
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

const TITLE_STOP = new Set([
  "pour",
  "avec",
  "dans",
  "une",
  "des",
  "les",
  "votre",
  "notre",
  "comment",
  "quel",
  "quelle",
  "quels",
  "choisir",
  "guide",
  "complet",
  "article",
  "compte",
  "ouvre",
  "ouvrir",
  "ligne",
  "boutique",
]);

function titleTokens(raw, extraStop = []) {
  const stop = new Set([...TITLE_STOP, ...extraStop]);
  return normalizeSeoText(raw)
    .split(/[\s-]+/)
    .filter((w) => w.length > 3 && !stop.has(w));
}

/** Vrai si deux titres/slugs couvrent le même sujet (anti-cannibalisation). */
export function titlesOverlap(a, b, brandName = "") {
  const na = normalizeSeoText(a);
  const nb = normalizeSeoText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  // Mots de la marque exclus : sinon « Atelier des Couleurs… » matche tous les titres
  const brandTokens = titleTokens(brandName).filter((w) => w.length > 3);
  const wa = titleTokens(a, brandTokens);
  const wb = titleTokens(b, brandTokens);
  if (wa.length === 0 || wb.length === 0) return false;

  // Un titre contenu dans l'autre seulement hors marque
  const sa = wa.join(" ");
  const sb = wb.join(" ");
  if (sa && sb && (sa.includes(sb) || sb.includes(sa))) return true;

  const setA = new Set(wa);
  const hits = wb.filter((w) => setA.has(w)).length;
  const ratio = hits / Math.max(setA.size, wb.length);
  return hits >= 2 && ratio >= 0.45;
}

function articleKeepScore(a) {
  const h2 = Array.isArray(a.h2) ? a.h2.length : 0;
  const faq = Array.isArray(a.faq_questions) ? a.faq_questions.length : 0;
  const titleLen = String(a.title || "").length;
  // Plus riche + titre plus précis (souvent plus long) gagne — pas « le plus récent »
  return h2 * 3 + faq * 2 + Math.min(titleLen, 100) / 25;
}

function pickArticleToKeep(a, b) {
  const sa = articleKeepScore(a);
  const sb = articleKeepScore(b);
  if (sa !== sb) return sa >= sb ? a : b;
  if (String(a.title || "").length !== String(b.title || "").length) {
    return String(a.title || "").length >= String(b.title || "").length ? a : b;
  }
  const da = Number(a.days_live) || 0;
  const db = Number(b.days_live) || 0;
  return da >= db ? a : b;
}

/** Paires d'articles publiés trop proches (à fusionner / distinguer). */
export function findSimilarPublishedPairs(articles, brandName = "") {
  const list = Array.isArray(articles) ? articles : [];
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (
        titlesOverlap(a.title, b.title, brandName) ||
        titlesOverlap(a.slug, b.slug, brandName) ||
        titlesOverlap(a.title, b.slug, brandName) ||
        titlesOverlap(a.slug, b.title, brandName)
      ) {
        const keep = pickArticleToKeep(a, b);
        const merge = keep.slug === a.slug ? b : a;
        pairs.push({
          a: { title: a.title, slug: a.slug, url: a.url },
          b: { title: b.title, slug: b.slug, url: b.url },
          keep_slug: keep.slug,
          keep_title: keep.title,
          merge_slug: merge.slug,
          merge_title: merge.title,
          reason: "titres_ou_sujets_tres_proches",
          keep_rule:
            "Garder l'article le plus complet / précis (contenu + titre), y fusionner l'autre. Ne pas choisir seulement parce qu'il est plus récent.",
        });
      }
    }
  }
  return pairs.slice(0, 8);
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

const VENDIZI_RE = /vendizi\.fr|vendizi\b/i;

/** Normalise ≤3 conseils de liens (pages boutique uniquement). */
export function normalizeLinkTips(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const tip of raw) {
    if (!tip || typeof tip !== "object") continue;
    const article_slug = String(tip.article_slug || "").trim();
    const article_title = String(tip.article_title || "").trim();
    const sentence = String(tip.sentence || "").trim();
    const anchor_words = String(tip.anchor_words || "").trim();
    const target_path = String(tip.target_path || tip.replacement_path || "").trim();
    const markdown_link = String(tip.markdown_link || "").trim();
    const blob = [
      article_title,
      sentence,
      anchor_words,
      tip.target_name,
      target_path,
      markdown_link,
      tip.broken_href,
      tip.replacement_name,
      tip.replacement_path,
      tip.action,
    ]
      .map((x) => String(x || ""))
      .join(" ");
    if (VENDIZI_RE.test(blob)) continue;
    // Cible = chemin relatif boutique uniquement (sauf idée d'article sans cible)
    if (
      tip.tip_type !== "new_article_idea" &&
      (!target_path.startsWith("/") || /^https?:\/\//i.test(target_path))
    ) {
      continue;
    }
    if (!article_title && !article_slug && tip.tip_type !== "new_article_idea") {
      continue;
    }
    out.push({
      impact: [1, 2, 3].includes(Number(tip.impact)) ? Number(tip.impact) : out.length + 1,
      tip_type: String(tip.tip_type || "add_link"),
      article_title,
      article_slug,
      section_h2: String(tip.section_h2 || "").trim(),
      sentence,
      anchor_words,
      target_name: String(tip.target_name || tip.replacement_name || "").trim(),
      target_path: target_path.startsWith("/") ? target_path : "",
      markdown_link:
        markdown_link ||
        (anchor_words && target_path.startsWith("/")
          ? `[${anchor_words}](${target_path})`
          : ""),
      broken_href: String(tip.broken_href || "").trim(),
      broken_reason: String(tip.broken_reason || "").trim(),
      replacement_name: String(tip.replacement_name || "").trim(),
      replacement_path: String(tip.replacement_path || "").trim(),
      new_article_idea: String(tip.new_article_idea || "").trim(),
      admin_path: "Admin → Blog",
    });
    if (out.length >= 3) break;
  }
  return out.sort((a, b) => a.impact - b.impact);
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
    link_tips: normalizeLinkTips(input.link_tips),
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

  const system = `Tu es un conseiller boutique pour « ${brand.brand_name} » (${brand.site_url}).
JSON strict, français simple, zéro jargon. 1 conseil = 1 action + chemin admin exact.

OBJECTIF VISIBILITÉ (context.ive) — priorité absolue :
But : faire monter le score de visibilité (0–100) chaque semaine, vers 100.
Piliers : découverte (Google te montre), attraction (les gens cliquent), trafic (visiteurs depuis Google).
Toujours prioriser le pilier le plus faible (weakest_pillar) dans summary + actions.
Si delta négatif ou nul : le dire simplement et proposer 1–3 actions pour remonter.
Textes client : « score de visibilité », « découverte / attraction / visiteurs Google » — jamais IVE, GSC, CTR.
Cibles internes (~milieu d'échelle) : ~5000 affichages, ~200 clics, ~3 % de clics, ~150 visiteurs Google.

LANGUE — INTERDIT : GSC, CTR, SEO, GA4, organic, ranking, cannibalisation, too_young, meta (→ texte sous le lien Google), impressions (→ fois où Google a montré…), position (→ place dans Google).
Ne pas inventer de chiffres. Pas de sujet déjà publié / ouvert.
INTERDIT textes client : title_rewrites, quick_wins, action_id, « position 58 » (dire « encore loin dans Google »). Renvoi : « voir Meilleurs titres pour Google ci-dessous ».
Ne fusionner QUE les paires de similar_article_pairs.

DOUBLONS — similar_article_pairs : si non vide, priorité 1. quick_wins blog_article : garder keep_title (keep_slug), fusionner merge_title, dépublier le doublon. Suivre keep_rule (pas « le plus récent »).

summary 4–6 phrases ; commencer par le score de visibilité + pilier à renforcer ; rassurer si accueil bas sur boutique jeune ; si article_ideas=[] expliquer l'attente 2–4 semaines.

CHEMINS : FAQ = Admin → Personnalisation → Légal → FAQ ; accueil texte Google = Admin → Personnalisation → SEO + title_rewrites home_meta obligatoire ; blog = Admin → Blog. Jamais Admin → Pages.
AUTORISÉ : Personnalisation, produits, Blog, Avis, Footer URL, Paramètres avis Google.
INTERDIT : réseaux, Ads, GTM/GA4, Search Console, sitemap, DNS, code.
channel : Google ou Blog. Max 3 quick_wins, 2 title_rewrites, 2 traffic_actions.

LIENS DANS LES ARTICLES (context.internal_links) — max 3 link_tips, impact 1 = plus utile :
- Uniquement vers des pages de CETTE boutique (produit /boutique?category=… /blog/… /boutique /a-propos…).
- INTERDIT : recommander un lien vers Vendizi (vendizi.fr) ou toute page hors boutique.
- INTERDIT : fixer un nombre de liens externes à atteindre. Un lien externe n’est suggérable que s’il cite une source réellement utile au lecteur, sans chiffre — et hors link_tips (link_tips = pages boutique seulement).
- Langage simple affiché au vendeur : pas de « maillage », « ancre », « backlink ».
- Chaque tip : article_title + article_slug, section_h2 (titre H2), sentence (phrase EXACTE du texte), anchor_words (mots à transformer en lien), target_name + target_path, markdown_link prêt à copier « [mots](/chemin) ».
- Liens cassés (broken_links) : tip_type fix_broken + broken_href + broken_reason + replacement_name/path.
- Produit/catégorie jamais cité : tip_type cite_product|cite_category dans l’article le plus proche ; sinon tip_type new_article_idea avec new_article_idea.
- Classer par impact (produits phares / articles avec le plus d’affichages Google d’abord).

Schéma:
{
  "data_sufficiency":"ok|low",
  "summary":"",
  "quick_wins":[{"page":"","query":"","action":"","evidence":"","admin_path":"Admin → …"}],
  "title_rewrites":[{"page":"","current_issue":"","suggested_title":"","suggested_meta_description":"","admin_path":"Admin → …"}],
  "traffic_actions":[{"channel":"","action":"","evidence":"","priority":1,"admin_path":"Admin → …"}],
  "link_tips":[{"impact":1,"tip_type":"add_link|fix_broken|cite_product|cite_category|new_article_idea","article_title":"","article_slug":"","section_h2":"","sentence":"","anchor_words":"","target_name":"","target_path":"/produits/…","markdown_link":"[mots](/produits/…)","broken_href":"","broken_reason":"","replacement_name":"","replacement_path":"","new_article_idea":""}],
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
