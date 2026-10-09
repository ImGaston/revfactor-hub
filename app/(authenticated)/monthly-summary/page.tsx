import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import {
  computeMonthlySummary,
  currentMonthISO,
  getMonthlySummaryListings,
  hostpricingManagedListings,
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
  const allRows = await getMonthlySummaryListings(supabase)
  const inEntity = (r: { billing_entity: string }) =>
    entity === "all" || r.billing_entity === entity
  // Hostpricing's portfolio only: RevFactor-managed listings are left out.
  const rows = hostpricingManagedListings(allRows)
  const summary = computeMonthlySummary(rows.filter(inEntity), month)
  // Disclosed in the view: RevFactor-managed listings active at month end.
  const internalCount = computeMonthlySummary(
    allRows.filter((r) => r.managed_by === "revfactor" && inEntity(r)),
    month
  ).endCount
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
      internalCount={internalCount}
    />
  )
}
