import { createClient } from "@/lib/supabase/server"
import { RoadmapBoard } from "./roadmap-board"

const DEFAULT_OWNERS = ["Gaston", "Federico"]
const DEFAULT_TAGS = ["Product", "Growth", "Operations", "Tech", "Integrations"]

export default async function RoadmapPage() {
  const supabase = await createClient()

  const { data: items } = await supabase
    .from("roadmap_items")
    .select("*")
    .order("sort_order")

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Roadmap</h1>
        <p className="text-sm text-muted-foreground">
          Projects and proposals for the team.
        </p>
      </div>
      <RoadmapBoard
        items={items ?? []}
        owners={DEFAULT_OWNERS}
        tags={DEFAULT_TAGS}
      />
    </div>
  )
}
