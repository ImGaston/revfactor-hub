export type ArticleStatus = "draft" | "published"
export type KnowledgeArticleType = "faq" | "policy" | "sop" | "guide" | "template"
export type KnowledgeAudience = "internal" | "client_safe"
export type KnowledgeReviewStatus = "draft" | "needs_review" | "approved"
export type KnowledgeIndexStatus =
  | "not_indexed"
  | "pending"
  | "indexing"
  | "indexed"
  | "stale"
  | "failed"

export type KnowledgeCategory = {
  id: string
  name: string
  slug: string
  color: string
  dark_color: string
  accent_color: string
  icon: string
  description: string
  article_count?: number
}

export type KnowledgeTag = {
  id: string
  name: string
  color: string
}

export type KnowledgeAuthor = {
  id: string
  full_name: string
  avatar_url: string | null
}

export type KnowledgeArticle = {
  id: string
  title: string
  slug: string
  excerpt: string
  content_html: string
  category_id: string | null
  category?: KnowledgeCategory | null
  tag_ids: string[]
  tags?: KnowledgeTag[]
  author: KnowledgeAuthor
  author_id: string
  status: ArticleStatus
  published_at: string | null
  updated_at: string
  created_at: string
  reading_time_min: number
  article_type: KnowledgeArticleType
  audience: KnowledgeAudience
  canonical_question: string
  approved_answer: string
  escalation_guidance: string
  source_notes: string
  review_status: KnowledgeReviewStatus
  agent_enabled: boolean
  agent_index_status: KnowledgeIndexStatus
  agent_indexed_at: string | null
  agent_index_error: string
  agent_index_model: string
  agent_chunk_count: number
  agent_index_input_tokens: number
  agent_index_cost_usd: number
  approved_by: string | null
  approved_at: string | null
  last_reviewed_at: string | null
  review_due_at: string | null
}

export type KnowledgeStats = {
  total_published: number
  total_drafts: number
  categories_count: number
  my_drafts: number
  agent_ready: number
  needs_agent_review: number
}
