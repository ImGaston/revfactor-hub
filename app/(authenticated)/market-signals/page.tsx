import { redirect } from "next/navigation"

import { MarketSignalsView } from "./market-signals-view"
import { getMarketSignalBriefRuntimeStatus } from "@/lib/market-signals/briefs.server"
import { getMarketSignalsRuntimeStatus } from "@/lib/market-signals/ingest.server"
import { getMarketSignalsWorkspace } from "@/lib/market-signals/repository.server"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"

export default async function MarketSignalsPage() {
  const [canView, canEdit] = await Promise.all([
    hasPermission("market_signals", "view"),
    hasPermission("market_signals", "edit"),
  ])
  if (!canView) redirect("/")

  const supabase = await createClient()
  const workspace = await getMarketSignalsWorkspace(supabase)

  return (
    <MarketSignalsView
      workspace={workspace}
      canEdit={canEdit}
      runtime={getMarketSignalsRuntimeStatus()}
      briefRuntime={getMarketSignalBriefRuntimeStatus()}
    />
  )
}
