import { redirect } from "next/navigation"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { loadSupportClientContext } from "@/lib/support-client-context.server"
import { parseSupportQueueParams } from "@/lib/support-queue"
import { loadSupportQueue } from "@/lib/support-queue.server"
import { supportStats } from "@/lib/support-tickets"
import { SupportClientPage } from "./support-client-page"

// The queue itself lives in the layout's sidebar. This page fills the main
// column only when a client is picked; with none, the workspace shows its
// overview instead.
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const canView = await hasPermission("support", "view")
  if (!canView) redirect("/")

  // ?client=<clients.id>&closed=1&view=status — bad values are ignored
  const filters = parseSupportQueueParams(await searchParams)
  if (!filters.clientId) return null
  const clientId = filters.clientId

  const supabase = await createClient()
  // One clock for the whole render so every "due in" label agrees
  const now = new Date()
  const loadContext = async () => {
    // Mirror the listings/adjustments RLS so a forbidden section stays hidden
    const [adjustments, listings] = await Promise.all([
      hasPermission("adjustments", "view"),
      hasPermission("listings", "view"),
    ])
    return loadSupportClientContext(supabase, clientId, now, {
      adjustments,
      listings: listings || adjustments,
    })
  }
  const [data, context] = await Promise.all([loadSupportQueue(supabase, now, filters), loadContext()])
  const stats = supportStats(
    data.tickets,
    data.closedCommitments,
    { sentBack30d: data.sentBack30d, clientRejected30d: data.clientRejected30d },
    now
  )
  const clientName =
    data.clientOptions.find((c) => c.id === clientId)?.name ??
    data.tickets.find((t) => t.clients?.name)?.clients?.name ??
    "This client"

  return (
    <SupportClientPage
      clientName={clientName}
      tickets={data.tickets}
      stats={stats}
      context={context}
      filters={filters}
      closedTotal={data.closedTotal}
      nowIso={now.toISOString()}
    />
  )
}
