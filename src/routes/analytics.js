import pool from "../db/pool.js";
import { checkAdmin } from "../lib/adminAuth.js";

function parseDays(days, fallback = 30) {
  return Math.max(1, Math.min(365, Math.round(Number(days) || fallback)));
}

function normalizePage(page) {
  const p = String(page || "").trim();
  if (!p || p.length > 255) return null;
  return p.startsWith("/") ? p : `/${p}`;
}

export default async function analyticsRoutes(fastify) {
  fastify.post("/analytics/event", async (request) => {
    const body = request.body || {};
    const type = String(body.type || "").trim().slice(0, 20);
    const page = normalizePage(body.page);

    if (!type || !page) return { success: false };
    if (page.startsWith("/admin")) return { success: false };

    const element = body.element
      ? String(body.element).trim().slice(0, 100)
      : null;
    const depth =
      body.depth != null ? Math.round(Number(body.depth)) || null : null;
    const seconds =
      body.seconds != null ? Math.round(Number(body.seconds)) || null : null;
    const device = String(body.device || "unknown")
      .trim()
      .slice(0, 10);
    const sessionId = body.session_id
      ? String(body.session_id).trim().slice(0, 50)
      : null;

    await pool.query(
      `INSERT INTO analytics_events (type, page, element, depth, seconds, device, session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [type, page, element, depth, seconds, device, sessionId]
    );

    return { success: true };
  });

  fastify.get("/admin/analytics/behavior", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;

    const page = normalizePage(request.query?.page);
    if (!page) {
      return reply.code(400).send({ error: "page requis" });
    }

    const days = parseDays(request.query?.days);

    const { rows: clicks } = await pool.query(
      `SELECT element, COUNT(*)::int AS count, device
       FROM analytics_events
       WHERE type = 'click'
         AND page = $1
         AND created_at >= NOW() - make_interval(days => $2)
         AND element IS NOT NULL
       GROUP BY element, device
       ORDER BY count DESC
       LIMIT 20`,
      [page, days]
    );

    const { rows: scrolls } = await pool.query(
      `SELECT depth, COUNT(*)::int AS count
       FROM analytics_events
       WHERE type = 'scroll'
         AND page = $1
         AND created_at >= NOW() - make_interval(days => $2)
       GROUP BY depth
       ORDER BY depth ASC`,
      [page, days]
    );

    const { rows: timeData } = await pool.query(
      `SELECT AVG(seconds)::int AS avg_seconds, COUNT(*)::int AS sessions
       FROM analytics_events
       WHERE type = 'time'
         AND page = $1
         AND created_at >= NOW() - make_interval(days => $2)
         AND seconds > 0 AND seconds < 3600`,
      [page, days]
    );

    const { rows: sessionRows } = await pool.query(
      `SELECT COUNT(DISTINCT session_id)::int AS total_sessions
       FROM analytics_events
       WHERE page = $1
         AND created_at >= NOW() - make_interval(days => $2)
         AND session_id IS NOT NULL`,
      [page, days]
    );

    return {
      page,
      period: `${days}j`,
      clicks,
      scroll_depth: scrolls,
      avg_time: timeData[0] || { avg_seconds: null, sessions: 0 },
      total_sessions: sessionRows[0]?.total_sessions || 0,
    };
  });

  fastify.get("/admin/analytics/funnel", async (request, reply) => {
    if (!(await checkAdmin(request, reply))) return;

    const days = parseDays(request.query?.days);
    const pages = ["/boutique", "/commander", "/commande-confirmee"];
    const result = [];

    for (const p of pages) {
      const { rows } = await pool.query(
        `SELECT COUNT(DISTINCT session_id)::int AS count
         FROM analytics_events
         WHERE page = $1
           AND created_at >= NOW() - make_interval(days => $2)
           AND session_id IS NOT NULL`,
        [p, days]
      );
      result.push({ page: p, sessions: rows[0]?.count || 0 });
    }

    return { funnel: result, period: `${days}j` };
  });
}
