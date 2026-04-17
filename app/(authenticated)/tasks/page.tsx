import { createClient } from "@/lib/supabase/server"
import { TasksBoard } from "./tasks-board"

const DEFAULT_TAGS = ["Pricing", "Onboarding", "Support", "Marketing", "Operations", "Tech"]

export default async function TasksPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: tasks }, { data: clients }, { data: profiles }] = await Promise.all([
    supabase
      .from("tasks")
      .select("*, clients(id, name), task_listings(listing_id, listings(id, name)), profiles(full_name, email)")
      .order("sort_order")
      .order("created_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, name, listings(id, name, status)")
      .order("name"),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .order("full_name"),
  ])

  const owners = (profiles ?? []).map((p) => ({
    id: p.id,
    label: p.full_name || p.email,
  }))

  const existingTags = new Set<string>(DEFAULT_TAGS)
  for (const t of tasks ?? []) {
    for (const tag of (t.tags ?? []) as string[]) {
      if (tag) existingTags.add(tag)
    }
  }
  const allTags = Array.from(existingTags).sort((a, b) => a.localeCompare(b))

  const filteredClients = (clients ?? []).map((c) => ({
    ...c,
    listings: (c.listings ?? []).filter((l: { status?: string }) => l.status !== "inactive"),
  }))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          Manage and track work across clients.
        </p>
      </div>
      <TasksBoard
        tasks={tasks ?? []}
        clients={filteredClients}
        owners={owners}
        tags={allTags}
        currentUserId={user?.id ?? null}
      />
    </div>
  )
}
