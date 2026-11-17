import pool from "../../db/pool.js";

/** Marqueur dans calendar_tasks.description pour lier une idée SEO. */
export function seoIdeaMarker(ideaId) {
  return `[seo-idea:${ideaId}]`;
}

export function parseSeoIdeaId(description) {
  const m = String(description || "").match(/\[seo-idea:([0-9a-f-]{36})\]/i);
  return m ? m[1] : null;
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
const MAX_NEW_PER_REPORT = 4;
const MAX_CONTENT_PER_WEEK = 1;
const MAX_TASKS_PER_DAY = 2;

/**
 * Place intelligemment des idées d'articles dans le calendrier.
 * - max 4 nouvelles tâches par rapport
 * - max 1 tâche content / semaine
 * - préfère mardi/mercredi
 * - évite jours déjà chargés / fêtes
 */
export async function scheduleArticleIdeas(ideas) {
  if (!Array.isArray(ideas) || ideas.length === 0) {
    return { scheduled: [] };
  }

  const { rows: existing } = await pool.query(
    `SELECT id, title, description, date::text AS date, type
     FROM calendar_tasks
     WHERE date >= CURRENT_DATE - 7`,
  );

  const already = new Set();
  const tasksByDay = new Map();
  const contentByWeek = new Map();

  for (const t of existing) {
    const ideaId = parseSeoIdeaId(t.description);
    if (ideaId) already.add(ideaId);

    const day = t.date;
    tasksByDay.set(day, (tasksByDay.get(day) || 0) + 1);

    if (t.type === "content" || ideaId) {
      const wk = weekKey(new Date(`${day}T12:00:00`));
      contentByWeek.set(wk, (contentByWeek.get(wk) || 0) + 1);
    }
  }

  const sorted = [...ideas].sort(
    (a, b) => Number(a.priority || 99) - Number(b.priority || 99),
  );

  const scheduled = [];
  let cursor = addDays(new Date(), 3); // laisser un peu d'air
  const horizon = addDays(new Date(), 120);

  for (const idea of sorted) {
    if (scheduled.length >= MAX_NEW_PER_REPORT) break;
    if (already.has(idea.id)) continue;

    let placed = null;
    let probe = new Date(cursor);
    while (probe <= horizon) {
      const key = toKey(probe);
      const dow = probe.getDay();
      const wk = weekKey(probe);
      const dayLoad = tasksByDay.get(key) || 0;
      const weekContent = contentByWeek.get(wk) || 0;

      const okDow = PREFERRED_DOW.has(dow);
      const okBusy = !BUSY_DATES.has(key);
      const okDay = dayLoad < MAX_TASKS_PER_DAY;
      const okWeek = weekContent < MAX_CONTENT_PER_WEEK;

      if (okDow && okBusy && okDay && okWeek) {
        placed = key;
        break;
      }
      probe = addDays(probe, 1);
    }

    if (!placed) continue;

    const marker = seoIdeaMarker(idea.id);
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
       WHERE id = $1`,
      [idea.id],
    );

    tasksByDay.set(placed, (tasksByDay.get(placed) || 0) + 1);
    const wk = weekKey(new Date(`${placed}T12:00:00`));
    contentByWeek.set(wk, (contentByWeek.get(wk) || 0) + 1);
    already.add(idea.id);

    scheduled.push({
      idea_id: idea.id,
      calendar_task_id: task.id,
      date: placed,
      title: task.title,
    });

    // prochaine idée : au moins une semaine après
    cursor = addDays(new Date(`${placed}T12:00:00`), 7);
  }

  return { scheduled };
}

export async function findCalendarTaskForIdea(ideaId) {
  const marker = seoIdeaMarker(ideaId);
  const { rows } = await pool.query(
    `SELECT id, title, description, date::text AS date, type
     FROM calendar_tasks
     WHERE description LIKE $1
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
