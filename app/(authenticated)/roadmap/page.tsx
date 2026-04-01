import { createClient } from "@/lib/supabase/server"
import { RoadmapTabs } from "./roadmap-tabs"
import type { Post, Board, Tag } from "@/lib/types"

export default async function RoadmapPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Fetch posts with counts via the view
  const { data: postsRaw } = await supabase
    .from("post_with_counts")
    .select("*")
    .order("sort_order")

  // Fetch boards
  const { data: boards } = await supabase
    .from("boards")
    .select("*")
    .order("sort_order")

  // Fetch tags
  const { data: tags } = await supabase
    .from("tags")
    .select("*")
    .order("name")

  // Fetch post_tags junction to attach tags to posts
  const { data: postTagRows } = await supabase
    .from("post_tags")
    .select("post_id, tag_id")

  // Fetch board details for each post
  const { data: boardRows } = await supabase
    .from("boards")
    .select("id, name, icon")

  // Fetch user's upvotes
  const { data: userUpvotes } = user
    ? await supabase
        .from("post_upvotes")
        .select("post_id")
        .eq("user_id", user.id)
    : { data: [] }

  const boardMap = new Map(
    (boardRows ?? []).map((b) => [b.id, { name: b.name, icon: b.icon }])
  )
  const tagMap = new Map((tags ?? []).map((t) => [t.id, t]))
  const upvotedPostIds = new Set(
    (userUpvotes ?? []).map((u) => u.post_id)
  )

  // Build post_tags per post
  const postTagsMap = new Map<string, Tag[]>()
  for (const row of postTagRows ?? []) {
    const tag = tagMap.get(row.tag_id)
    if (!tag) continue
    const arr = postTagsMap.get(row.post_id) ?? []
    arr.push(tag)
    postTagsMap.set(row.post_id, arr)
  }

  // Enrich posts
  const posts: Post[] = (postsRaw ?? []).map((p) => ({
    ...p,
    boards: p.board_id ? boardMap.get(p.board_id) ?? null : null,
    post_tags: (postTagsMap.get(p.id) ?? []).map((t) => ({ tags: t })),
    has_upvoted: upvotedPostIds.has(p.id),
  }))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Ideas & Roadmap
        </h1>
        <p className="text-sm text-muted-foreground">
          Share ideas, vote on features, and track the product roadmap.
        </p>
      </div>
      <RoadmapTabs
        posts={posts}
        boards={(boards ?? []) as Board[]}
        tags={(tags ?? []) as Tag[]}
      />
    </div>
  )
}
