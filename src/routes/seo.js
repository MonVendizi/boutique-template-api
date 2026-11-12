import { checkAdmin } from "../lib/adminAuth.js";
import { getOpportunities, getOverview, getRanked } from "../lib/seo/analytics.js";
import {
  generateAiReport,
  listAiReports,
  listArticleIdeas,
} from "../lib/seo/ai-report.js";
import { ensureBoutiqueSeoProperty } from "../lib/seo/property.js";
import { syncBoutiqueSeo } from "../lib/seo/sync.js";

export default async function seoRoutes(fastify) {
  fastify.get("/admin/seo/status", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    try {
      const property = await ensureBoutiqueSeoProperty();
      return {
        property,
        ga4_property_id: process.env.GA4_PROPERTY_ID
          ? String(process.env.GA4_PROPERTY_ID).replace(/^properties\//, "")
          : null,
        has_google_credentials: Boolean(
          process.env.GOOGLE_APPLICATION_CREDENTIALS ||
            (process.env.GOOGLE_CREDENTIALS &&
              process.env.GOOGLE_CREDENTIALS !== "{}" &&
              process.env.GOOGLE_CREDENTIALS !== "file"),
        ),
        has_anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        seo_ai_model: process.env.SEO_AI_MODEL || null,
      };
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  fastify.get("/admin/seo/overview", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    try {
      const period = String(request.query?.period || "28d");
      const data = await getOverview(period);
      return data;
    } catch (error) {
      return reply
        .code(500)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  fastify.get("/admin/seo/queries", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    try {
      return await getRanked(
        "query",
        String(request.query?.period || "28d"),
        String(request.query?.sort || "impressions"),
      );
    } catch (error) {
      return reply
        .code(500)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  fastify.get("/admin/seo/pages", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    try {
      return await getRanked(
        "page",
        String(request.query?.period || "28d"),
        String(request.query?.sort || "impressions"),
      );
    } catch (error) {
      return reply
        .code(500)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  fastify.get("/admin/seo/opportunities", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    try {
      return await getOpportunities();
    } catch (error) {
      return reply
        .code(500)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  fastify.post("/admin/seo/sync", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    try {
      const result = await syncBoutiqueSeo("manual");
      const status =
        result.status === "error" ? 502 : result.status === "skipped" ? 409 : 200;
      return reply.code(status).send(result);
    } catch (error) {
      return reply
        .code(500)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  fastify.get("/admin/seo/ai-report", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    try {
      const reports = await listAiReports(10);
      return { reports };
    } catch (error) {
      return reply
        .code(500)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  fastify.post("/admin/seo/ai-report", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    try {
      const out = await generateAiReport();
      return out;
    } catch (error) {
      return reply
        .code(500)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  fastify.get("/admin/seo/article-ideas", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;
    try {
      return { ideas: await listArticleIdeas() };
    } catch (error) {
      return reply
        .code(500)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
