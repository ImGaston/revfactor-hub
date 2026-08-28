import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import {
  computeMonthlySummary,
  currentMonthISO,
  getMonthlySummaryListings,
  isValidMonthISO,
} from "@/lib/monthly-summary"
import { MonthlySummaryView } from "./monthly-summary-view"

export default async function MonthlySummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const canView = await hasPermission("monthly_summary", "view")
  if (!canView) redirect("/")

  const { month: monthParam } = await searchParams
  const month =
    monthParam && isValidMonthISO(monthParam) ? monthParam : currentMonthISO()

  const supabase = await createClient()
  const rows = await getMonthlySummaryListings(supabase)
  const summary = computeMonthlySummary(rows, month)

  return <MonthlySummaryView summary={summary} />
}
