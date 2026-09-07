-- Boutique template — schéma e-commerce extensible

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Fonction générique updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Produits (catalogue extensible) ───
CREATE TABLE IF NOT EXISTS products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  slug          VARCHAR(255) NOT NULL UNIQUE,
  category      VARCHAR(100) NOT NULL,
  description   TEXT,
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  currency      VARCHAR(3) NOT NULL DEFAULT 'eur',
  sku           VARCHAR(50) NOT NULL UNIQUE,
  stock         INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  images        JSONB NOT NULL DEFAULT '[]'::jsonb,
  highlights    JSONB NOT NULL DEFAULT '[]'::jsonb,
  featured      BOOLEAN NOT NULL DEFAULT false,
  badge         VARCHAR(50),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT true,
  subtitle      VARCHAR(255),
  short_description TEXT,
  unit          VARCHAR(50),
  origin        VARCHAR(100),
  seo_title     VARCHAR(255),
  seo_description TEXT,
  rating        NUMERIC(2,1) DEFAULT 5.0,
  review_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products (slug);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products (featured) WHERE featured = true;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Commandes ───
CREATE TABLE IF NOT EXISTS orders (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id         VARCHAR(255) UNIQUE,
  stripe_payment_intent_id  VARCHAR(255),
  status                    VARCHAR(50) NOT NULL DEFAULT 'pending',
  customer_email            VARCHAR(255),
  customer_name             VARCHAR(255),
  items                     JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_cents               INTEGER NOT NULL CHECK (total_cents >= 0),
  currency                  VARCHAR(3) NOT NULL DEFAULT 'eur',
  shipping_address          JSONB,
  tracking_number           VARCHAR(100),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cents INTEGER DEFAULT 490;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cents INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS affiliate_code VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS affiliate_commission_cents INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_paid BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_review_sent_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS crosssell_sent BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_session ON orders (stripe_session_id);

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Mouvements de stock ───
CREATE TABLE IF NOT EXISTS stock_movements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
  order_id         UUID REFERENCES orders (id) ON DELETE SET NULL,
  quantity_change  INTEGER NOT NULL,
  reason           VARCHAR(100) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_order ON stock_movements (order_id);

-- ─── Newsletter ───
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  token VARCHAR(64) UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  source VARCHAR(50) DEFAULT 'site',
  customer_name VARCHAR(255),
  active BOOLEAN DEFAULT true,
  welcome_sent BOOLEAN DEFAULT false,
  welcome_j3_sent BOOLEAN DEFAULT false,
  welcome_j7_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  unsubscribed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_newsletter_email ON newsletter_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_newsletter_active ON newsletter_subscribers(active) WHERE active = true;

-- ─── Blog ───
CREATE TABLE IF NOT EXISTS blog_posts (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(255) UNIQUE NOT NULL,
  type VARCHAR(50) DEFAULT 'guide',
  status VARCHAR(20) DEFAULT 'draft',
  title VARCHAR(255) NOT NULL,
  excerpt TEXT,
  hero_image VARCHAR(500),
  category VARCHAR(100),
  tags JSONB DEFAULT '[]',
  seo_title VARCHAR(255),
  seo_description VARCHAR(500),
  seo_keywords JSONB DEFAULT '[]',
  sections JSONB DEFAULT '[]',
  faq JSONB DEFAULT '[]',
  cta_text VARCHAR(100),
  cta_url VARCHAR(255),
  related_slug VARCHAR(255),
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blog_slug ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_status ON blog_posts(status);

-- ─── Avis clients ───
CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_slug VARCHAR(255),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  customer_email VARCHAR(255) NOT NULL,
  customer_name VARCHAR(100) NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title VARCHAR(200),
  content TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  verified_purchase BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  published_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_slug, status);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);

-- ─── Codes promo ───
CREATE TABLE IF NOT EXISTS promo_codes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('percent', 'fixed')),
  value NUMERIC(10,2) NOT NULL,
  min_order_cents INTEGER DEFAULT 0,
  max_uses INTEGER DEFAULT NULL,
  uses_count INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  expires_at TIMESTAMP DEFAULT NULL,
  internal_note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS internal_note TEXT;

-- ─── Tâches calendrier marketing ───
CREATE TABLE IF NOT EXISTS calendar_tasks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  type VARCHAR(50) DEFAULT 'task',
  reminder_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calendar_tasks_date ON calendar_tasks(date);

-- ─── Groupes de navigation ───
CREATE TABLE IF NOT EXISTS nav_groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO nav_groups (name, sort_order) VALUES
  ('Boutique', 1)
ON CONFLICT (name) DO NOTHING;

-- ─── Catégories produits ───
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  color VARCHAR(20) DEFAULT '#D4AF37',
  nav_group VARCHAR(100),
  active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO categories (slug, name, color, nav_group, sort_order) VALUES
  ('exemple', 'Exemple', '#D4AF37', 'Boutique', 1)
ON CONFLICT (slug) DO NOTHING;

-- ─── Paniers abandonnés ───
CREATE TABLE IF NOT EXISTS abandoned_carts (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  customer_name VARCHAR(100),
  items JSONB NOT NULL,
  total_cents INTEGER NOT NULL,
  promo_code VARCHAR(50),
  discount_cents INTEGER DEFAULT 0,
  reminder_sent BOOLEAN DEFAULT false,
  reminder_sent_at TIMESTAMP,
  converted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_abandoned_email ON abandoned_carts(email);
CREATE INDEX IF NOT EXISTS idx_abandoned_reminder ON abandoned_carts(reminder_sent, converted, created_at);

-- ─── Programme fidélité ───
CREATE TABLE IF NOT EXISTS loyalty_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  active BOOLEAN DEFAULT false,
  points_per_euro INTEGER DEFAULT 1,
  points_for_reward INTEGER DEFAULT 100,
  reward_cents INTEGER DEFAULT 500,
  reward_expiry_days INTEGER DEFAULT 30,
  updated_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO loyalty_config (id, active) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS loyalty_points (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  customer_name VARCHAR(100),
  points INTEGER DEFAULT 0,
  total_earned INTEGER DEFAULT 0,
  total_redeemed INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ─── Programme d'affiliation ───
CREATE TABLE IF NOT EXISTS affiliates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  code VARCHAR(50) UNIQUE NOT NULL,
  commission_percent NUMERIC(5,2) DEFAULT 10.00,
  active BOOLEAN DEFAULT true,
  total_clicks INTEGER DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  total_revenue_cents INTEGER DEFAULT 0,
  total_commission_cents INTEGER DEFAULT 0,
  total_paid_cents INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id SERIAL PRIMARY KEY,
  affiliate_code VARCHAR(50) NOT NULL,
  ip_hash VARCHAR(64),
  user_agent VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_code ON affiliate_clicks(affiliate_code);

-- ─── Paramètres boutique ───
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT
);
INSERT INTO settings (key, value) VALUES ('google_review_url', '')
ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES
  ('popup_enabled', 'true'),
  ('popup_discount', '10'),
  ('popup_title', 'Bienvenue chez Ma Boutique ✨'),
  ('popup_subtitle', 'Rejoignez notre communauté et recevez'),
  ('popup_delay', '5')
ON CONFLICT (key) DO NOTHING;

-- ─── Programme de parrainage ───
CREATE TABLE IF NOT EXISTS referral_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  active BOOLEAN DEFAULT false,
  referrer_discount_percent INTEGER DEFAULT 10,
  referee_discount_percent INTEGER DEFAULT 10,
  cookie_days INTEGER DEFAULT 30,
  updated_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO referral_config (id, active) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  referrer_email VARCHAR(255) NOT NULL,
  referrer_name VARCHAR(100),
  referral_code VARCHAR(50) UNIQUE NOT NULL,
  referee_email VARCHAR(255),
  referee_order_id UUID REFERENCES orders(id),
  status VARCHAR(20) DEFAULT 'pending',
  referrer_discount_code VARCHAR(50),
  referrer_discount_sent BOOLEAN DEFAULT false,
  invite_sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  converted_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_email);

-- ─── Tracking comportemental ───
CREATE TABLE IF NOT EXISTS analytics_events (
  id SERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL,
  page VARCHAR(255) NOT NULL,
  element VARCHAR(100),
  depth INTEGER,
  seconds INTEGER,
  device VARCHAR(10),
  session_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analytics_page ON analytics_events(page, type, created_at);

-- ─── Relances avis ───
CREATE TABLE IF NOT EXISTS review_reminders (
  order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  sent_at TIMESTAMP DEFAULT NOW()
);

-- ─── Clients (CRM léger, upsert à chaque commande payée) ───
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  total_orders INTEGER DEFAULT 0,
  total_spent_cents INTEGER DEFAULT 0,
  last_order_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_last_order ON customers(last_order_at);

-- ─── Tenants (SaaS multi-tenant — mapping domaine → API client) ───
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain VARCHAR(255) NOT NULL UNIQUE,
  api_url VARCHAR(255) NOT NULL,
  brand_name VARCHAR(255),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_domain ON tenants(domain);

