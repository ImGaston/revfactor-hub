-- ============================================================
-- 021: Knowledge Base (Policies & SOPs)
-- Articles, categories, tags for internal knowledge management.
-- ============================================================

-- Knowledge categories (seeded reference table)
CREATE TABLE knowledge_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL,
  dark_color TEXT NOT NULL,
  accent_color TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Knowledge tags
CREATE TABLE knowledge_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT 'blue',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Knowledge articles
CREATE TABLE knowledge_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  excerpt TEXT,
  content_html TEXT,
  category_id UUID REFERENCES knowledge_categories(id) ON DELETE SET NULL,
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),
  published_at TIMESTAMPTZ,
  reading_time_min INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Article ↔ Tag junction
CREATE TABLE knowledge_article_tags (
  article_id UUID REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES knowledge_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_knowledge_articles_status ON knowledge_articles(status);
CREATE INDEX idx_knowledge_articles_category ON knowledge_articles(category_id);
CREATE INDEX idx_knowledge_articles_author ON knowledge_articles(author_id);
CREATE INDEX idx_knowledge_articles_slug ON knowledge_articles(slug);
CREATE INDEX idx_knowledge_articles_published_at ON knowledge_articles(published_at);
CREATE INDEX idx_knowledge_article_tags_article ON knowledge_article_tags(article_id);
CREATE INDEX idx_knowledge_article_tags_tag ON knowledge_article_tags(tag_id);

-- ============================================================
-- View: article count per category
-- ============================================================
CREATE OR REPLACE VIEW knowledge_category_article_counts AS
SELECT
  c.id,
  c.name,
  c.slug,
  c.icon,
  c.description,
  c.color,
  c.dark_color,
  c.accent_color,
  c.created_at,
  COALESCE(counts.article_count, 0)::integer AS article_count
FROM knowledge_categories c
LEFT JOIN (
  SELECT category_id, COUNT(*)::integer AS article_count
  FROM knowledge_articles
  WHERE status = 'published'
  GROUP BY category_id
) counts ON counts.category_id = c.id;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE knowledge_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_article_tags ENABLE ROW LEVEL SECURITY;

-- knowledge_categories (read-only for all authenticated)
CREATE POLICY "Authenticated users can view knowledge_categories"
  ON knowledge_categories FOR SELECT TO authenticated USING (true);

-- knowledge_tags (read-only for all authenticated)
CREATE POLICY "Authenticated users can view knowledge_tags"
  ON knowledge_tags FOR SELECT TO authenticated USING (true);

-- knowledge_articles (full CRUD for authenticated — permission checks in server actions)
CREATE POLICY "Authenticated users can view knowledge_articles"
  ON knowledge_articles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert knowledge_articles"
  ON knowledge_articles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update knowledge_articles"
  ON knowledge_articles FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete knowledge_articles"
  ON knowledge_articles FOR DELETE TO authenticated USING (true);

-- knowledge_article_tags (junction)
CREATE POLICY "Authenticated users can view knowledge_article_tags"
  ON knowledge_article_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert knowledge_article_tags"
  ON knowledge_article_tags FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can delete knowledge_article_tags"
  ON knowledge_article_tags FOR DELETE TO authenticated USING (true);

-- ============================================================
-- Storage bucket for article images
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-images', 'knowledge-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Authenticated users can upload knowledge images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'knowledge-images');

CREATE POLICY "Anyone can view knowledge images"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'knowledge-images');

CREATE POLICY "Authenticated users can delete their knowledge images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'knowledge-images');

-- ============================================================
-- Seed categories
-- ============================================================
INSERT INTO knowledge_categories (name, slug, icon, description, color, dark_color, accent_color) VALUES
  ('Operations', 'operations', 'ClipboardList', 'Day-to-day operational procedures and checklists for managing listings', 'bg-emerald-50', 'dark:bg-emerald-950/30', 'text-emerald-600 dark:text-emerald-400'),
  ('Pricing Strategy', 'pricing-strategy', 'DollarSign', 'Revenue optimization, dynamic pricing rules, and market analysis guidelines', 'bg-orange-50', 'dark:bg-orange-950/30', 'text-orange-600 dark:text-orange-400'),
  ('Guest Communication', 'guest-communication', 'MessageSquare', 'Templates and protocols for guest messaging at every touchpoint', 'bg-violet-50', 'dark:bg-violet-950/30', 'text-violet-600 dark:text-violet-400'),
  ('Client Onboarding', 'client-onboarding', 'BookOpen', 'Step-by-step guides for onboarding new revenue management clients', 'bg-sky-50', 'dark:bg-sky-950/30', 'text-sky-600 dark:text-sky-400'),
  ('Legal & Compliance', 'legal-compliance', 'Scale', 'Contract policies, regulatory compliance, and liability guidelines', 'bg-rose-50', 'dark:bg-rose-950/30', 'text-rose-600 dark:text-rose-400'),
  ('Marketing', 'marketing', 'Megaphone', 'Listing optimization, photography standards, and platform SEO', 'bg-amber-50', 'dark:bg-amber-950/30', 'text-amber-600 dark:text-amber-400');

-- ============================================================
-- Seed tags
-- ============================================================
INSERT INTO knowledge_tags (name, color) VALUES
  ('SOP', 'blue'),
  ('Policy', 'purple'),
  ('Template', 'green'),
  ('Checklist', 'orange'),
  ('Training', 'pink'),
  ('Quick Reference', 'cyan'),
  ('Best Practice', 'teal'),
  ('Emergency', 'red'),
  ('Seasonal', 'yellow'),
  ('New', 'indigo');
