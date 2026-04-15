import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/supabase/profile"
// TODO: swap back to getPacingData() from "@/lib/pacing" once migration 023
// is applied and the reservations table is seeded.
import { getMockPacingSource } from "@/lib/pacing-mock"
import { DashboardView } from "./dashboard-view"

export default async function DashboardPage() {
  const [supabase, profile] = await Promise.all([
    createClient(),
    getProfile(),
  ])

  const [
    { count: clientCount },
    { count: activeClientCount },
    { count: onboardingClientCount },
    { count: listingCount },
    { data: tasks },
    { data: recentTasks },
    { count: roadmapInProgress },
    pacingSource,
  ] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }),
    supabase.from("clients").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("clients").select("*", { count: "exact", head: true }).eq("status", "onboarding"),
    supabase.from("listings").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("tasks").select("id, status"),
    supabase.from("tasks").select("id, title, status, tags, clients(name), profiles(full_name, email)").order("created_at", { ascending: false }).limit(5),
    supabase.from("posts").select("*", { count: "exact", head: true }).eq("status", "in_progress"),
    Promise.resolve(getMockPacingSource()),
  ])

  const tasksByStatus = {
    todo: 0,
    in_progress: 0,
    waiting: 0,
    done: 0,
  }
  for (const t of tasks ?? []) {
    if (t.status in tasksByStatus) {
      tasksByStatus[t.status as keyof typeof tasksByStatus]++
    }
  }

  const totalTasks = (tasks ?? []).length
  const openTasks = totalTasks - tasksByStatus.done

  return (
    <DashboardView
      isSuperAdmin={profile?.role === "super_admin"}
      pacingSource={pacingSource}
      stats={{
        totalClients: clientCount ?? 0,
        activeClients: activeClientCount ?? 0,
        onboardingClients: onboardingClientCount ?? 0,
        totalListings: listingCount ?? 0,
        totalTasks: totalTasks,
        openTasks,
        tasksByStatus,
        roadmapInProgress: roadmapInProgress ?? 0,
      }}
      recentTasks={
        (recentTasks ?? []).map((t: Record<string, unknown>) => {
          const client = t.clients as { name: string } | null
          const prof = t.profiles as { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null
          const p = Array.isArray(prof) ? prof[0] : prof
          return {
            id: t.id as string,
            title: t.title as string,
            status: t.status as string,
            tags: (t.tags as string[] | null) ?? [],
            clientName: client?.name ?? null,
            ownerName: p?.full_name ?? null,
          }
        })
      }
    />
  )
}
