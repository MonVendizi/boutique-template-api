import pool from "../../db/pool.js";

/** File éditoriale courte : digeste + mesure avant de proposer plus. */
export const MAX_OPEN_ARTICLE_IDEAS = 2;
export const MAX_NEW_IDEAS_PER_REPORT = 2;

const OPEN_STATUSES = ["proposee", "retenue", "redigee"];

export async function getEditorialPipeline() {
  const { rows } = await pool.query(
    `SELECT id, title, status, priority, created_at::text
     FROM seo_article_ideas
     WHERE status = ANY($1::text[])
     ORDER BY
       CASE status WHEN 'redigee' THEN 0 WHEN 'retenue' THEN 1 ELSE 2 END,
       priority ASC,
       created_at ASC`,
    [OPEN_STATUSES],
  );

  const open_count = rows.length;
  const slots_available = Math.max(0, MAX_OPEN_ARTICLE_IDEAS - open_count);

  return {
    max_open: MAX_OPEN_ARTICLE_IDEAS,
    max_new_per_report: MAX_NEW_IDEAS_PER_REPORT,
    open_count,
    slots_available,
    open_ideas: rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
    })),
    rule:
      "Max 2 idées ouvertes. Écrire → publier → mesurer 2–4 semaines avant d'en proposer d'autres.",
  };
}

/**
 * Garde au plus MAX_OPEN idées ouvertes.
 * Priorité : redigee > retenue > proposee (par priority).
 * Le surplus en "proposee" passe en rejetee (+ tâche calendrier retirée).
 */
export async function pruneExcessOpenIdeas() {
  const { rows } = await pool.query(
    `SELECT id, title, status, priority
     FROM seo_article_ideas
     WHERE status = ANY($1::text[])
     ORDER BY
       CASE status WHEN 'redigee' THEN 0 WHEN 'retenue' THEN 1 ELSE 2 END,
       priority ASC,
       created_at ASC`,
    [OPEN_STATUSES],
  );

  if (rows.length <= MAX_OPEN_ARTICLE_IDEAS) {
    return { kept: rows.length, rejected: 0, rejected_ids: [] };
  }

  const keepIds = new Set(
    rows.slice(0, MAX_OPEN_ARTICLE_IDEAS).map((r) => r.id),
  );
  const drop = rows.filter((r) => !keepIds.has(r.id) && r.status === "proposee");
  // Si encore trop (trop de retenue/redigee), ne touche pas aux en-cours — seulement proposee
  const rejected_ids = [];

  for (const idea of drop) {
    await pool.query(
      `UPDATE seo_article_ideas
       SET status = 'rejetee', updated_at = NOW()
       WHERE id = $1 AND status = 'proposee'`,
      [idea.id],
    );
    rejected_ids.push(idea.id);
    try {
      const { deleteCalendarTaskForIdea } = await import(
        "./scheduleArticleIdeas.js"
      );
      await deleteCalendarTaskForIdea(idea.id);
    } catch {
      // ignore
    }
  }

  return {
    kept: Math.min(rows.length, MAX_OPEN_ARTICLE_IDEAS),
    rejected: rejected_ids.length,
    rejected_ids,
  };
}
