-- ============================================================
-- 060: Governed Knowledge embeddings and hybrid retrieval
--
-- Knowledge articles remain the source of truth. Chunks are derived,
-- version-bound search records and are never retrievable unless the parent
-- article is still published, client-safe, approved, and agent-enabled.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE public.knowledge_articles
  ADD COLUMN agent_index_status TEXT NOT NULL DEFAULT 'not_indexed'
    CHECK (agent_index_status IN (
      'not_indexed', 'pending', 'indexing', 'indexed', 'stale', 'failed'
    )),
  ADD COLUMN agent_indexed_at TIMESTAMPTZ,
  ADD COLUMN agent_index_error TEXT,
  ADD COLUMN agent_index_model TEXT,
  ADD COLUMN agent_index_content_hash TEXT,
  ADD COLUMN agent_chunk_count INTEGER NOT NULL DEFAULT 0
    CHECK (agent_chunk_count >= 0),
  ADD COLUMN agent_index_input_tokens INTEGER NOT NULL DEFAULT 0
    CHECK (agent_index_input_tokens >= 0),
  ADD COLUMN agent_index_cost_usd NUMERIC(14, 8) NOT NULL DEFAULT 0
    CHECK (agent_index_cost_usd >= 0);

CREATE TABLE public.knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL
    REFERENCES public.knowledge_articles(id) ON DELETE CASCADE,
  article_updated_at TIMESTAMPTZ NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  heading TEXT,
  content TEXT NOT NULL CHECK (length(btrim(content)) > 0),
  token_estimate INTEGER NOT NULL DEFAULT 0 CHECK (token_estimate >= 0),
  content_hash TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding extensions.vector(1536) NOT NULL,
  search_document TSVECTOR GENERATED ALWAYS AS (
    to_tsvector(
      'english'::regconfig,
      coalesce(heading, '') || ' ' || content
    )
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (article_id, chunk_index)
);

CREATE INDEX idx_knowledge_chunks_article
  ON public.knowledge_chunks (article_id, chunk_index);
CREATE INDEX idx_knowledge_chunks_search
  ON public.knowledge_chunks USING GIN (search_document);
CREATE INDEX idx_knowledge_chunks_embedding
  ON public.knowledge_chunks
  USING HNSW (embedding extensions.vector_cosine_ops);

CREATE TABLE public.knowledge_index_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL
    REFERENCES public.knowledge_articles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  embedding_model TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  estimated_cost_usd NUMERIC(14, 8) NOT NULL DEFAULT 0
    CHECK (estimated_cost_usd >= 0),
  error_message TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_knowledge_index_events_article
  ON public.knowledge_index_events (article_id, created_at DESC);

ALTER TABLE public.agent_runs
  ADD COLUMN retrieval_mode TEXT NOT NULL DEFAULT 'keyword'
    CHECK (retrieval_mode IN ('keyword', 'hybrid', 'compare')),
  ADD COLUMN retrieval_input_tokens INTEGER NOT NULL DEFAULT 0
    CHECK (retrieval_input_tokens >= 0),
  ADD COLUMN retrieval_cost_usd NUMERIC(14, 8) NOT NULL DEFAULT 0
    CHECK (retrieval_cost_usd >= 0),
  ADD COLUMN retrieval_duration_ms INTEGER NOT NULL DEFAULT 0
    CHECK (retrieval_duration_ms >= 0);

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_index_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view knowledge chunks"
  ON public.knowledge_chunks
  FOR SELECT TO authenticated
  USING (
    public.has_permission('knowledge', 'view')
    OR public.has_permission('agent_studio', 'view')
  );

CREATE POLICY "Knowledge publishers can create chunks"
  ON public.knowledge_chunks
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('knowledge', 'publish'));

CREATE POLICY "Knowledge publishers can update chunks"
  ON public.knowledge_chunks
  FOR UPDATE TO authenticated
  USING (public.has_permission('knowledge', 'publish'))
  WITH CHECK (public.has_permission('knowledge', 'publish'));

CREATE POLICY "Knowledge publishers can delete chunks"
  ON public.knowledge_chunks
  FOR DELETE TO authenticated
  USING (public.has_permission('knowledge', 'publish'));

CREATE POLICY "Authorized users can view knowledge index events"
  ON public.knowledge_index_events
  FOR SELECT TO authenticated
  USING (
    public.has_permission('knowledge', 'view')
    OR public.has_permission('agent_studio', 'view')
  );

CREATE POLICY "Knowledge publishers can create index events"
  ON public.knowledge_index_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('knowledge', 'publish'));

CREATE OR REPLACE FUNCTION public.mark_knowledge_index_stale()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF
    OLD.title IS DISTINCT FROM NEW.title
    OR OLD.excerpt IS DISTINCT FROM NEW.excerpt
    OR OLD.content_html IS DISTINCT FROM NEW.content_html
    OR OLD.canonical_question IS DISTINCT FROM NEW.canonical_question
    OR OLD.approved_answer IS DISTINCT FROM NEW.approved_answer
    OR OLD.escalation_guidance IS DISTINCT FROM NEW.escalation_guidance
    OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.audience IS DISTINCT FROM NEW.audience
    OR OLD.review_status IS DISTINCT FROM NEW.review_status
  THEN
    NEW.agent_index_status := CASE
      WHEN OLD.agent_chunk_count > 0 THEN 'stale'
      ELSE 'not_indexed'
    END;
    NEW.agent_indexed_at := NULL;
    NEW.agent_index_error := NULL;
    NEW.agent_index_content_hash := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_knowledge_index_stale
  BEFORE UPDATE ON public.knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION public.mark_knowledge_index_stale();

CREATE OR REPLACE FUNCTION public.search_agent_knowledge(
  p_query_text TEXT,
  p_query_embedding extensions.vector(1536),
  p_retrieval_mode TEXT DEFAULT 'hybrid',
  p_match_count INTEGER DEFAULT 12
)
RETURNS TABLE (
  chunk_id UUID,
  article_id UUID,
  article_title TEXT,
  article_slug TEXT,
  article_updated_at TIMESTAMPTZ,
  heading TEXT,
  content TEXT,
  embedding_model TEXT,
  keyword_score DOUBLE PRECISION,
  semantic_score DOUBLE PRECISION,
  combined_score DOUBLE PRECISION,
  keyword_rank BIGINT,
  semantic_rank BIGINT,
  hybrid_rank BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  WITH query_values AS (
    SELECT websearch_to_tsquery('english'::regconfig, p_query_text) AS query
  ),
  scored AS (
    SELECT
      chunks.id AS chunk_id,
      articles.id AS article_id,
      articles.title AS article_title,
      articles.slug AS article_slug,
      articles.updated_at AS article_updated_at,
      chunks.heading,
      chunks.content,
      chunks.embedding_model,
      CASE
        WHEN query_values.query @@ chunks.search_document
          THEN LEAST(
            1::DOUBLE PRECISION,
            (ts_rank_cd(chunks.search_document, query_values.query) * 4)::DOUBLE PRECISION
          )
        ELSE 0::DOUBLE PRECISION
      END AS keyword_score,
      GREATEST(
        -1::DOUBLE PRECISION,
        LEAST(
          1::DOUBLE PRECISION,
          (1 - (chunks.embedding <=> p_query_embedding))::DOUBLE PRECISION
        )
      ) AS semantic_score
    FROM public.knowledge_chunks chunks
    JOIN public.knowledge_articles articles ON articles.id = chunks.article_id
    CROSS JOIN query_values
    WHERE articles.status = 'published'
      AND articles.audience = 'client_safe'
      AND articles.review_status = 'approved'
      AND articles.agent_enabled = TRUE
      AND articles.agent_index_status = 'indexed'
      AND chunks.article_updated_at = articles.updated_at
  ),
  ranked AS (
    SELECT
      scored.*,
      CASE p_retrieval_mode
        WHEN 'keyword' THEN scored.keyword_score
        ELSE (scored.semantic_score * 0.65) + (scored.keyword_score * 0.35)
      END AS combined_score,
      row_number() OVER (
        ORDER BY scored.keyword_score DESC, scored.semantic_score DESC
      ) AS keyword_rank,
      row_number() OVER (
        ORDER BY scored.semantic_score DESC, scored.keyword_score DESC
      ) AS semantic_rank
    FROM scored
    WHERE scored.keyword_score > 0 OR scored.semantic_score >= 0.25
  ),
  hybrid_ranked AS (
    SELECT
      ranked.*,
      row_number() OVER (
        ORDER BY ranked.combined_score DESC, ranked.semantic_score DESC
      ) AS hybrid_rank
    FROM ranked
  )
  SELECT
    hybrid_ranked.chunk_id,
    hybrid_ranked.article_id,
    hybrid_ranked.article_title,
    hybrid_ranked.article_slug,
    hybrid_ranked.article_updated_at,
    hybrid_ranked.heading,
    hybrid_ranked.content,
    hybrid_ranked.embedding_model,
    hybrid_ranked.keyword_score,
    hybrid_ranked.semantic_score,
    hybrid_ranked.combined_score,
    hybrid_ranked.keyword_rank,
    hybrid_ranked.semantic_rank,
    hybrid_ranked.hybrid_rank
  FROM hybrid_ranked
  ORDER BY
    CASE WHEN p_retrieval_mode = 'keyword'
      THEN hybrid_ranked.keyword_rank
      ELSE hybrid_ranked.hybrid_rank
    END
  LIMIT LEAST(GREATEST(p_match_count, 1), 50);
$$;

REVOKE ALL ON FUNCTION public.search_agent_knowledge(
  TEXT, extensions.vector, TEXT, INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_agent_knowledge(
  TEXT, extensions.vector, TEXT, INTEGER
) TO authenticated;

COMMENT ON TABLE public.knowledge_chunks IS
  'Derived, version-bound embeddings for approved Agent Studio Knowledge.';
COMMENT ON FUNCTION public.search_agent_knowledge IS
  'Permission-scoped hybrid keyword and vector retrieval over approved Knowledge.';
