import { redirect } from "next/navigation"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { loadLastCaptureAt, loadSupportQueue } from "@/lib/support-queue.server"
import { supportStats } from "@/lib/support-tickets"
import { SupportWorkspace } from "./support-workspace"

// The queue loads once here and stays mounted while people move between
// tickets; actions revalidate this layout so the list and counts refresh.
export default async function SupportLayout({ children }: { children: React.ReactNode }) {
  const canView = await hasPermission("support", "view")
  if (!canView) redirect("/")

  const supabase = await createClient()
  const now = new Date()
  const [
    {
      data: { user },
    },
    data,
    lastCaptureAt,
  ] = await Promise.all([supabase.auth.getUser(), loadSupportQueue(supabase, now), loadLastCaptureAt(supabase)])
  const stats = supportStats(
    data.tickets,
    data.closedCommitments,
    { sentBack30d: data.sentBack30d, clientRejected30d: data.clientRejected30d },
    now
  )

  return (
    <SupportWorkspace
      tickets={data.tickets}
      stats={stats}
      currentUserId={user?.id ?? null}
      lastCaptureAt={lastCaptureAt}
      nowIso={now.toISOString()}
    >
      {children}
    </SupportWorkspace>
  )
}
