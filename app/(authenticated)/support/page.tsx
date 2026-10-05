import { redirect } from "next/navigation"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { loadSupportClientContext } from "@/lib/support-client-context.server"
import { parseSupportQueueParams } from "@/lib/support-queue"
import { loadSupportQueue } from "@/lib/support-queue.server"
import { supportStats } from "@/lib/support-tickets"
import { SupportQueueView } from "./support-queue-view"

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const canView = await hasPermission("support", "view")
  if (!canView) redirect("/")

  // ?client=<clients.id>&closed=1&view=status — read on the server; bad values are ignored (By client is the default view)
  const filters = parseSupportQueueParams(await searchParams)

  const supabase = await createClient()
  // One clock for the whole render so every "due in" label agrees and the
  // client component hydrates with the same values the server printed
  const now = new Date()
  const loadContext = async (clientId: string) => {
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
  const [data, context] = await Promise.all([
    loadSupportQueue(supabase, now, filters),
    filters.clientId ? loadContext(filters.clientId) : Promise.resolve(null),
  ])
  const stats = supportStats(
    data.tickets,
    data.closedCommitments,
    { sentBack30d: data.sentBack30d, clientRejected30d: data.clientRejected30d },
    now
  )

  return (
    <SupportQueueView
      tickets={data.tickets}
      stats={stats}
      nowIso={now.toISOString()}
      filters={filters}
      clientOptions={data.clientOptions}
      closed={{ scope: data.closedScope, total: data.closedTotal }}
      clientContext={context}
    />
  )
}
