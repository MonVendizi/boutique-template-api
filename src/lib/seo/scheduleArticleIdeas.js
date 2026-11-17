import pool from "../../db/pool.js";

/** Marqueur dans calendar_tasks.description pour lier une idée SEO. */
export function seoIdeaMarker(ideaId) {
  return `[seo-idea:${String(ideaId).toLowerCase()}]`;
}

export function parseSeoIdeaId(description) {
  const m = String(description || "").match(/\[seo-idea:([0-9a-f-]{36})\]/i);
  return m ? m[1].toLowerCase() : null;
}

function toKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() + n);
  return x;
}

function weekKey(d) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return toKey(x);
}

/** Fêtes commerciales (légères) pour éviter de surcharger ces jours. */
const BUSY_DATES = new Set([
  "2026-02-14",
  "2026-03-08",
  "2026-05-25",
  "2026-06-21",
  "2026-11-27",
  "2026-12-25",
  "2027-02-14",
  "2027-03-08",
  "2027-05-24",
  "2027-11-26",
  "2027-12-25",
]);

const PREFERRED_DOW = new Set([2, 3]); // mardi, mercredi
const FALLBACK_DOW = new Set([1, 2, 3, 4]); // lun–jeu si mardi/mercredi saturés
const MAX_NEW_PER_REPORT = 4;
const MAX_CONTENT_PER_WEEK = 1;
/** Ne compte que les tâches SEO-idée pour le plafond journalier (les seeds marketing ne bloquent plus). */
const MAX_SEO_TASKS_PER_DAY = 1;
const HORIZON_DAYS = 180;

const OPEN_STATUSES = ["proposee", "retenue", "redigee"];

/**
 * Supprime les tâches calendrier liées à des idées fermées / introuvables.
 * Sinon l'ancien « flood » d'idées occupe 1 créneau/semaine pendant des mois
 * et les nouvelles propositions ne trouvent plus de place.
 */
export async function cleanupOrphanSeoCalendarTasks() {
  const { rows: tasks } = await pool.query(
    `SELECT id, description
     FROM calendar_tasks
     WHERE description LIKE '%[seo-idea:%'`,
  );
  if (tasks.length === 0) {
    return { removed: 0, kept: 0 };
  }

  const ideaIds = [
    ...new Set(tasks.map((t) => parseSeoIdeaId(t.description)).filter(Boolean)),
  ];
  const openIds = new Set();
  if (ideaIds.length) {
    const { rows } = await pool.query(
      `SELECT id::text AS id FROM seo_article_ideas
       WHERE id = ANY($1::uuid[])
         AND status = ANY($2::text[])`,
      [ideaIds, OPEN_STATUSES],
    );
    for (const r of rows) openIds.add(String(r.id).toLowerCase());
  }

  let removed = 0;
  for (const t of tasks) {
    const ideaId = parseSeoIdeaId(t.description);
    if (ideaId && openIds.has(ideaId)) continue;
    await pool.query(`DELETE FROM calendar_tasks WHERE id = $1`, [t.id]);
    removed += 1;
  }
  return { removed, kept: tasks.length - removed };
}

/**
 * Place intelligemment des idées d'articles dans le calendrier.
 * - max N nouvelles tâches par passage
 * - max 1 tâche SEO-idée / semaine (uniquement idées encore ouvertes)
 * - préfère mardi/mercredi, sinon lun–jeu
 * - les tâches marketing seed ne bloquent plus le placement SEO
 */
export async function scheduleArticleIdeas(ideas, options = {}) {
  const maxNew =
    Number(options.maxNew) > 0 ? Number(options.maxNew) : MAX_NEW_PER_REPORT;
  if (!Array.isArray(ideas) || ideas.length === 0) {
    return { scheduled: [], skipped: [], cleanup: null };
  }

  const cleanup = await cleanupOrphanSeoCalendarTasks().catch((err) => {
    console.error("cleanupOrphanSeoCalendarTasks:", err);
    return null;
  });

  const { rows: existing } = await pool.query(
    `SELECT id, title, description, date::text AS date, type
     FROM calendar_tasks
     WHERE date >= CURRENT_DATE - 7`,
  );

  const already = new Set();
  const seoByDay = new Map();
  const contentByWeek = new Map();

  for (const t of existing) {
    const ideaId = parseSeoIdeaId(t.description);
    if (!ideaId) continue;

    already.add(ideaId);

    const day = String(t.date).slice(0, 10);
    seoByDay.set(day, (seoByDay.get(day) || 0) + 1);

    const wk = weekKey(new Date(`${day}T12:00:00`));
    contentByWeek.set(wk, (contentByWeek.get(wk) || 0) + 1);
  }

  const sorted = [...ideas].sort(
    (a, b) => Number(a.priority || 99) - Number(b.priority || 99),
  );

  const scheduled = [];
  const skipped = [];
  let cursor = addDays(new Date(), 3);
  const horizon = addDays(new Date(), HORIZON_DAYS);

  function findSlot(fromDate, allowedDow) {
    let probe = new Date(fromDate);
    while (probe <= horizon) {
      const key = toKey(probe);
      const dow = probe.getDay();
      const wk = weekKey(probe);
      const daySeo = seoByDay.get(key) || 0;
      const weekContent = contentByWeek.get(wk) || 0;

      if (
        allowedDow.has(dow) &&
        !BUSY_DATES.has(key) &&
        daySeo < MAX_SEO_TASKS_PER_DAY &&
        weekContent < MAX_CONTENT_PER_WEEK
      ) {
        return key;
      }
      probe = addDays(probe, 1);
    }
    return null;
  }

  for (const idea of sorted) {
    if (scheduled.length >= maxNew) {
      skipped.push({ idea_id: idea.id, reason: "max_new" });
      break;
    }
    const id = String(idea.id || "").toLowerCase();
    if (!id) {
      skipped.push({ idea_id: idea.id, reason: "missing_id" });
      continue;
    }
    if (already.has(id)) {
      skipped.push({ idea_id: idea.id, reason: "already_scheduled" });
      continue;
    }
    if (["rejetee", "publiee"].includes(String(idea.status || ""))) {
      skipped.push({ idea_id: idea.id, reason: "closed_status" });
      continue;
    }

    let placed = findSlot(cursor, PREFERRED_DOW);
    if (!placed) placed = findSlot(cursor, FALLBACK_DOW);
    if (!placed) {
      skipped.push({ idea_id: idea.id, reason: "no_slot" });
      continue;
    }

    const marker = seoIdeaMarker(id);
    const description = [
      marker,
      idea.target_query ? `Requête : ${idea.target_query}` : null,
      idea.rationale ? String(idea.rationale).slice(0, 400) : null,
      idea.suggested_slug ? `Slug suggéré : ${idea.suggested_slug}` : null,
      "→ Admin → Blog pour rédiger · Admin → SEO Google → À écrire pour le brief",
    ]
      .filter(Boolean)
      .join("\n");

    const title = `Rédiger : ${String(idea.title || "Article").slice(0, 80)}`;

    const { rows } = await pool.query(
      `INSERT INTO calendar_tasks (title, description, date, type)
       VALUES ($1, $2, $3::date, 'content')
       RETURNING id, title, description, date::text AS date, type`,
      [title, description, placed],
    );
    const task = rows[0];

    await pool.query(
      `UPDATE seo_article_ideas
       SET status = CASE WHEN status = 'proposee' THEN 'retenue' ELSE status END,
           updated_at = NOW()
       WHERE id = $1::uuid`,
      [id],
    );

    seoByDay.set(placed, (seoByDay.get(placed) || 0) + 1);
    const wk = weekKey(new Date(`${placed}T12:00:00`));
    contentByWeek.set(wk, (contentByWeek.get(wk) || 0) + 1);
    already.add(id);

    scheduled.push({
      idea_id: id,
      calendar_task_id: task.id,
      date: placed,
      title: task.title,
    });

    cursor = addDays(new Date(`${placed}T12:00:00`), 7);
  }

  return { scheduled, skipped, cleanup };
}

/** Planifie les idées existantes pas encore au calendrier (backfill, plafond file). */
export async function scheduleUnplannedArticleIdeas() {
  const { pruneExcessOpenIdeas, MAX_OPEN_ARTICLE_IDEAS } = await import(
    "./editorialPipeline.js"
  );
  await pruneExcessOpenIdeas().catch(() => null);
  await cleanupOrphanSeoCalendarTasks().catch(() => null);

  const { rows } = await pool.query(
    `SELECT id, title, suggested_slug, target_query, secondary_queries,
            search_intent, priority, rationale, outline, faq, source, status
     FROM seo_article_ideas
     WHERE status IN ('proposee', 'retenue', 'redigee')
     ORDER BY
       CASE status WHEN 'redigee' THEN 0 WHEN 'retenue' THEN 1 ELSE 2 END,
       priority ASC,
       created_at ASC
     LIMIT $1`,
    [MAX_OPEN_ARTICLE_IDEAS],
  );
  return scheduleArticleIdeas(rows, { maxNew: MAX_OPEN_ARTICLE_IDEAS });
}

export async function findCalendarTaskForIdea(ideaId) {
  const marker = seoIdeaMarker(ideaId);
  const { rows } = await pool.query(
    `SELECT id, title, description, date::text AS date, type
     FROM calendar_tasks
     WHERE description ILIKE $1
     ORDER BY date ASC
     LIMIT 1`,
    [`%${marker}%`],
  );
  return rows[0] || null;
}

export async function deleteCalendarTaskForIdea(ideaId) {
  const task = await findCalendarTaskForIdea(ideaId);
  if (!task) return null;
  await pool.query(`DELETE FROM calendar_tasks WHERE id = $1`, [task.id]);
  return task;
}

export async function postponeCalendarTaskForIdea(ideaId, days = 7) {
  const task = await findCalendarTaskForIdea(ideaId);
  if (!task) return null;
  const base = new Date(`${task.date}T12:00:00`);
  const next = addDays(base, Math.max(1, Number(days) || 7));
  const { rows } = await pool.query(
    `UPDATE calendar_tasks
     SET date = $2::date, reminder_sent = false
     WHERE id = $1
     RETURNING id, title, description, date::text AS date, type`,
    [task.id, toKey(next)],
  );
  return rows[0] || null;
}
