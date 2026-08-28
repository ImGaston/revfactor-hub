// Monthly portfolio summary: active listings at month start/end plus the
// month's new (initial_setup_date) and churned (deactivated_date) listings.
// Split I/O + pure aggregate like lib/monthly-pacing.ts. All lifecycle fields
// are DATE columns, so comparisons are plain ISO-string comparisons — no
// timezone math anywhere.

import type { SupabaseClient } from "@supabase/supabase-js"

export type MonthlySummaryListing = {
  id: string
  name: string
  status: string
  initial_setup_date: string | null
  deactivated_date: string | null
  client_name: string | null
}

export type MonthlySummary = {
  month: string // "YYYY-MM"
  startCount: number
  endCount: number
  newListings: MonthlySummaryListing[]
  churnedListings: MonthlySummaryListing[]
  activeListings: MonthlySummaryListing[]
  // Listings without a setup date predate lifecycle tracking: they count as
  // carried over (active since before any month), can never appear in
  // newListings, and are disclosed here.
  unknownSetup: MonthlySummaryListing[]
  // Inactive without a deactivation date: excluded from every point-in-time
  // count (no way to place them) and disclosed — never guessed.
  unknownChurn: MonthlySummaryListing[]
}

export async function getMonthlySummaryListings(
  supabase: SupabaseClient
): Promise<MonthlySummaryListing[]> {
  // clients_basic (not clients): hostpricing has no clients:view; the
  // SECURITY DEFINER view exposes only id/name/status.
  const { data, error } = await supabase
    .from("listings")
    .select(
      "id, name, status, initial_setup_date, deactivated_date, clients:clients_basic(id, name)"
    )
    .order("name")

  if (error) return []

  return (data ?? []).map((l: Record<string, unknown>) => {
    const client = l.clients as { id: string; name: string } | null
    return {
      id: l.id as string,
      name: l.name as string,
      status: l.status as string,
      initial_setup_date: (l.initial_setup_date as string | null) ?? null,
      deactivated_date: (l.deactivated_date as string | null) ?? null,
      client_name: client?.name ?? null,
    }
  })
}

/**
 * Clients mapped onto the same lifecycle shape so computeMonthlyEvolution can
 * chart them: onboarding_date plays setup, and ending_date counts as churn
 * only for inactive clients (for active ones it's the planned contract end).
 */
export async function getClientsEvolutionRows(
  supabase: SupabaseClient
): Promise<MonthlySummaryListing[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, status, onboarding_date, ending_date")

  if (error) return []

  return (data ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    status: c.status === "inactive" ? "inactive" : "active",
    initial_setup_date: (c.onboarding_date as string | null) ?? null,
    deactivated_date:
      c.status === "inactive" ? ((c.ending_date as string | null) ?? null) : null,
    client_name: null,
  }))
}

export function currentMonthISO(): string {
  return new Date().toISOString().slice(0, 7)
}

export function isValidMonthISO(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number)
  // Day 0 of the next month = last day of this month; UTC to match the DATEs.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month}-${String(last).padStart(2, "0")}`
}

export type MonthlyEvolutionPoint = {
  month: string // "YYYY-MM"
  active: number // active at end of month
  added: number
  churned: number
}

/**
 * Active/new/churned per month for the trailing window ending at `endMonth`
 * (inclusive). Same carried-over/unknown semantics as computeMonthlySummary:
 * null setup = active since before any month; inactive without a deactivation
 * date is excluded everywhere.
 */
export function computeMonthlyEvolution(
  rows: MonthlySummaryListing[],
  monthsBack: number,
  endMonth: string
): MonthlyEvolutionPoint[] {
  const [ey, em] = endMonth.split("-").map(Number)
  const points: MonthlyEvolutionPoint[] = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ey, em - 1 - i, 1))
    const month = d.toISOString().slice(0, 7)
    const s = computeMonthlySummary(rows, month)
    points.push({
      month,
      active: s.endCount,
      added: s.newListings.length,
      churned: s.churnedListings.length,
    })
  }
  return points
}

export function computeMonthlySummary(
  rows: MonthlySummaryListing[],
  month: string
): MonthlySummary {
  const monthStart = `${month}-01`
  const monthEnd = lastDayOfMonth(month)
  // "Started the month with" = state at the end of the previous month, so a
  // listing set up on day 1 counts as new, not as carried over, and
  // start + new − churned = end holds whenever all dates are known.
  const [y, m] = month.split("-").map(Number)
  const prevMonthEnd = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)

  const unknownSetup: MonthlySummaryListing[] = []
  const unknownChurn: MonthlySummaryListing[] = []
  const countable: MonthlySummaryListing[] = []

  for (const row of rows) {
    if (row.status === "inactive" && !row.deactivated_date) {
      unknownChurn.push(row)
      continue
    }
    if (!row.initial_setup_date) unknownSetup.push(row)
    countable.push(row)
  }

  // Null setup = carried over from before lifecycle tracking → active since
  // before any month boundary.
  const activeAt = (date: string) => (row: MonthlySummaryListing) =>
    (row.initial_setup_date === null || row.initial_setup_date <= date) &&
    (row.deactivated_date === null || row.deactivated_date > date)

  const newListings = rows.filter(
    (r) =>
      r.initial_setup_date !== null &&
      r.initial_setup_date >= monthStart &&
      r.initial_setup_date <= monthEnd
  )
  const churnedListings = rows.filter(
    (r) =>
      r.deactivated_date !== null &&
      r.deactivated_date >= monthStart &&
      r.deactivated_date <= monthEnd
  )
  // Newest setup first; carried-over listings (no setup date) are the oldest,
  // so they sink to the bottom. Ties keep the query's name order.
  const activeListings = countable
    .filter(activeAt(monthEnd))
    .sort((a, b) =>
      (b.initial_setup_date ?? "0000").localeCompare(a.initial_setup_date ?? "0000")
    )

  return {
    month,
    startCount: countable.filter(activeAt(prevMonthEnd)).length,
    endCount: activeListings.length,
    newListings,
    churnedListings,
    activeListings,
    unknownSetup,
    unknownChurn,
  }
}
