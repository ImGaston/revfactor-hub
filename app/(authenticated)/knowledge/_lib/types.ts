export type ArticleStatus = "draft" | "published"

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
}

export type KnowledgeStats = {
  total_published: number
  total_drafts: number
  categories_count: number
  my_drafts: number
}
