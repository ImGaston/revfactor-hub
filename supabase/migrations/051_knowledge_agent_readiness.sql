-- ============================================================
-- 051: Knowledge agent readiness
-- Separates internal publication from client-safe AI approval.
-- ============================================================

ALTER TABLE public.knowledge_articles
  ADD COLUMN article_type TEXT NOT NULL DEFAULT 'guide'
    CHECK (article_type IN ('faq', 'policy', 'sop', 'guide', 'template')),
  ADD COLUMN audience TEXT NOT NULL DEFAULT 'internal'
    CHECK (audience IN ('internal', 'client_safe')),
  ADD COLUMN canonical_question TEXT,
  ADD COLUMN approved_answer TEXT,
  ADD COLUMN escalation_guidance TEXT,
  ADD COLUMN source_notes TEXT,
  ADD COLUMN review_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (review_status IN ('draft', 'needs_review', 'approved')),
  ADD COLUMN agent_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN approved_at TIMESTAMPTZ,
  ADD COLUMN last_reviewed_at TIMESTAMPTZ,
  ADD COLUMN review_due_at DATE,
  ADD CONSTRAINT knowledge_agent_enabled_requires_approval CHECK (
    NOT agent_enabled OR (
      status = 'published'
      AND audience = 'client_safe'
      AND review_status = 'approved'
      AND approved_answer IS NOT NULL
      AND length(btrim(approved_answer)) > 0
    )
  );

CREATE INDEX idx_knowledge_articles_agent_ready
  ON public.knowledge_articles (agent_enabled, review_status, updated_at DESC)
  WHERE agent_enabled = TRUE;

CREATE OR REPLACE FUNCTION public.guard_knowledge_agent_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (
    NEW.status = 'published'
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
  ) OR (
    NEW.review_status = 'approved'
    AND (TG_OP = 'INSERT' OR OLD.review_status IS DISTINCT FROM NEW.review_status)
  ) OR (
    NEW.agent_enabled = TRUE
    AND (TG_OP = 'INSERT' OR OLD.agent_enabled IS DISTINCT FROM NEW.agent_enabled)
  ) THEN
    IF NOT public.has_permission('knowledge', 'publish') THEN
      RAISE EXCEPTION 'knowledge:publish permission required';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS knowledge_agent_approval_guard
  ON public.knowledge_articles;
CREATE TRIGGER knowledge_agent_approval_guard
  BEFORE INSERT OR UPDATE ON public.knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION public.guard_knowledge_agent_approval();

INSERT INTO public.knowledge_tags (name, color)
VALUES ('FAQ', 'cyan')
ON CONFLICT (name) DO NOTHING;

UPDATE public.knowledge_articles
SET
  article_type = 'policy',
  canonical_question = 'How do OTA markups work?',
  category_id = (
    SELECT id FROM public.knowledge_categories
    WHERE slug = 'pricing-strategy'
  ),
  review_status = 'draft',
  audience = 'internal',
  agent_enabled = FALSE
WHERE slug = 'ota-markup-policy';

INSERT INTO public.knowledge_article_tags (article_id, tag_id)
SELECT article.id, tag.id
FROM public.knowledge_articles article
CROSS JOIN public.knowledge_tags tag
WHERE article.slug = 'ota-markup-policy'
  AND tag.name IN ('FAQ', 'Policy')
ON CONFLICT DO NOTHING;
