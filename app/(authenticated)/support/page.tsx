import { redirect } from "next/navigation"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { loadSupportQueue } from "@/lib/support-queue.server"
import { supportStats } from "@/lib/support-tickets"
import { SupportQueueView } from "./support-queue-view"

export default async function SupportPage() {
  const canView = await hasPermission("support", "view")
  if (!canView) redirect("/")

  const supabase = await createClient()
  // One clock for the whole render so every "due in" label agrees and the
  // client component hydrates with the same values the server printed
  const now = new Date()
  const data = await loadSupportQueue(supabase, now)
  const stats = supportStats(
    data.tickets,
    data.closedCommitments,
    { sentBack30d: data.sentBack30d, clientRejected30d: data.clientRejected30d },
    now
  )

  return <SupportQueueView tickets={data.tickets} stats={stats} nowIso={now.toISOString()} />
}
