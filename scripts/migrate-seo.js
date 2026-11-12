import pool from "../src/db/pool.js";

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_properties (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      site_url TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      last_sync_at TIMESTAMP,
      last_sync_status VARCHAR(20),
      last_sync_error TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS seo_gsc_daily (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id UUID NOT NULL REFERENCES seo_properties(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      query TEXT NOT NULL,
      page TEXT NOT NULL,
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      ctr NUMERIC(12, 8) NOT NULL DEFAULT 0,
      position NUMERIC(12, 4) NOT NULL DEFAULT 0,
      UNIQUE (property_id, date, query, page)
    );

    CREATE INDEX IF NOT EXISTS seo_gsc_daily_property_date_idx
      ON seo_gsc_daily (property_id, date);
    CREATE INDEX IF NOT EXISTS seo_gsc_daily_property_query_idx
      ON seo_gsc_daily (property_id, query);
    CREATE INDEX IF NOT EXISTS seo_gsc_daily_property_page_idx
      ON seo_gsc_daily (property_id, page);

    CREATE TABLE IF NOT EXISTS seo_sync_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id UUID NOT NULL REFERENCES seo_properties(id) ON DELETE CASCADE,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMP,
      mode VARCHAR(20) NOT NULL,
      date_from DATE,
      date_to DATE,
      status VARCHAR(20) NOT NULL,
      rows_upserted INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS seo_sync_runs_property_started_idx
      ON seo_sync_runs (property_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS seo_visibility_index (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id UUID NOT NULL REFERENCES seo_properties(id) ON DELETE CASCADE,
      week_start DATE NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      ive NUMERIC(6, 2) NOT NULL,
      discovery NUMERIC(6, 2) NOT NULL,
      attraction NUMERIC(6, 2) NOT NULL,
      traffic NUMERIC(6, 2) NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      ctr NUMERIC(12, 8) NOT NULL DEFAULT 0,
      top10_share NUMERIC(8, 4) NOT NULL DEFAULT 0,
      organic_sessions INTEGER NOT NULL DEFAULT 0,
      analytics_available BOOLEAN NOT NULL DEFAULT false,
      components JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (property_id, week_start)
    );

    CREATE INDEX IF NOT EXISTS seo_visibility_index_property_week_idx
      ON seo_visibility_index (property_id, week_start DESC);

    CREATE TABLE IF NOT EXISTS seo_ai_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id UUID NOT NULL REFERENCES seo_properties(id) ON DELETE CASCADE,
      generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      model TEXT NOT NULL,
      data_sufficiency VARCHAR(20) NOT NULL,
      summary TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE INDEX IF NOT EXISTS seo_ai_reports_property_generated_idx
      ON seo_ai_reports (property_id, generated_at DESC);

    CREATE TABLE IF NOT EXISTS seo_article_ideas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id UUID NOT NULL REFERENCES seo_properties(id) ON DELETE CASCADE,
      report_id UUID REFERENCES seo_ai_reports(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      suggested_slug TEXT,
      target_query TEXT,
      secondary_queries JSONB NOT NULL DEFAULT '[]'::jsonb,
      search_intent VARCHAR(40),
      priority INTEGER NOT NULL DEFAULT 2,
      rationale TEXT,
      outline JSONB NOT NULL DEFAULT '[]'::jsonb,
      faq JSONB NOT NULL DEFAULT '[]'::jsonb,
      source VARCHAR(20) NOT NULL DEFAULT 'data',
      status VARCHAR(20) NOT NULL DEFAULT 'proposee',
      published_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS seo_article_ideas_property_status_idx
      ON seo_article_ideas (property_id, status);
  `);

  console.log("✅ Tables SEO créées");
}

migrate()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error(e);
    await pool.end();
    process.exit(1);
  });
