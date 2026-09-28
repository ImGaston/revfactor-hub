import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import {
  computeMonthlySummary,
  currentMonthISO,
  getMonthlySummaryListings,
  isValidMonthISO,
} from "@/lib/monthly-summary"
import { isBillingEntity } from "@/lib/billing-entity"
import { MonthlySummaryView, type EntityFilter } from "./monthly-summary-view"

export default async function MonthlySummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; entity?: string }>
}) {
  const canView = await hasPermission("monthly_summary", "view")
  if (!canView) redirect("/")

  const { month: monthParam, entity: entityParam } = await searchParams
  const month =
    monthParam && isValidMonthISO(monthParam) ? monthParam : currentMonthISO()
  // RevFactor by default: Blackbird is billed separately by the India team.
  const entity: EntityFilter =
    entityParam === "all" || isBillingEntity(entityParam)
      ? entityParam
      : "revfactor"

  const supabase = await createClient()
  const rows = await getMonthlySummaryListings(supabase)
  const summary = computeMonthlySummary(
    entity === "all" ? rows : rows.filter((r) => r.billing_entity === entity),
    month
  )
  // End-of-month active count per entity for the selector labels.
  const entityCounts = {
    revfactor: computeMonthlySummary(
      rows.filter((r) => r.billing_entity === "revfactor"),
      month
    ).endCount,
    blackbird: computeMonthlySummary(
      rows.filter((r) => r.billing_entity === "blackbird"),
      month
    ).endCount,
  }

  return (
    <MonthlySummaryView
      summary={summary}
      entity={entity}
      entityCounts={entityCounts}
    />
  )
}
