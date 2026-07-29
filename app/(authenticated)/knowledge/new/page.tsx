import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import { redirect } from "next/navigation"
import { ArticleForm } from "../_components/article-form"
import type { KnowledgeCategory, KnowledgeTag } from "../_lib/types"

export default async function NewArticlePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>
}) {
  if (!(await hasPermission("knowledge", "create"))) redirect("/knowledge")
  const { type } = await searchParams
  const supabase = await createClient()

  const { data: categoriesRaw } = await supabase
    .from("knowledge_categories")
    .select("*")
    .order("name")

  const { data: tagsRaw } = await supabase
    .from("knowledge_tags")
    .select("*")
    .order("name")

  const categories = (categoriesRaw ?? []) as KnowledgeCategory[]
  const tags = (tagsRaw ?? []) as KnowledgeTag[]

  const canPublish = await hasPermission("knowledge", "publish")

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Article</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create a new knowledge base article
        </p>
      </div>

      <ArticleForm
        categories={categories}
        tags={tags}
        canPublish={canPublish}
        initialType={type === "faq" ? "faq" : "guide"}
      />
    </div>
  )
}
