import { redirect } from "next/navigation"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { loadLastCaptureAt, loadSupportQueue } from "@/lib/support-queue.server"
import { supportStats } from "@/lib/support-tickets"
import { SupportWorkspace } from "./support-workspace"

// The queue loads once here and stays mounted while people move between
// tickets and clients; actions revalidate it so the list and counts refresh.
// The sidebar filters it in the browser (layouts can't read the URL); a
// picked client's context and closed history load in the page below.
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
      clientOptions={data.clientOptions}
      currentUserId={user?.id ?? null}
      lastCaptureAt={lastCaptureAt}
      nowIso={now.toISOString()}
    >
      {children}
    </SupportWorkspace>
  )
}
