import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { z } from "zod"

import {
  CASE_STUDY_WORKFLOW_VERSION,
  EXPECTED_REVFACTOR_PROJECT_REF,
  clientSchema,
  hubListingSchema,
  onboardingRunListingSchema,
  onboardingRunSchema,
  reportListingSchema,
  reportMetricSchema,
  reportRunSchema,
  setupAdjustmentSchema,
  type CaseStudySelection,
  type CaseStudySourceInventory,
  type ReportListingSource,
  type ReportMetricSource,
  type ReportRunSource,
} from "@/lib/case-studies/contracts"

const PAGE_SIZE = 1_000
const MAX_PAGES = 100

type QueryResult = {
  data: unknown[] | null
  error: { message?: string } | null
  count: number | null
}

export function assertExpectedProject(urlString: string) {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not a valid URL")
  }
  if (url.protocol !== "https:") {
    throw new Error("RevFactor Supabase must use HTTPS")
  }
  if (url.hostname !== `${EXPECTED_REVFACTOR_PROJECT_REF}.supabase.co`) {
    throw new Error(
      `Refusing non-RevFactor Supabase target; expected ${EXPECTED_REVFACTOR_PROJECT_REF}`
    )
  }
}

export function createReadOnlyCaseStudyClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"
    )
  }
  assertExpectedProject(url)

  const readOnlyFetch: typeof fetch = (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase()
    if (method !== "GET" && method !== "HEAD") {
      throw new Error(`Read-only case-study client rejected ${method}`)
    }
    return fetch(input, init)
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: readOnlyFetch },
  })
}

export async function readAllPages<T>(
  label: string,
  schema: z.ZodType<T>,
  buildPage: (from: number, to: number) => PromiseLike<QueryResult>,
  identity: (row: T) => string
): Promise<T[]> {
  const rows: T[] = []
  const seen = new Set<string>()
  let declaredTotal: number | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE
    const result = await buildPage(from, from + PAGE_SIZE - 1)
    if (result.error) {
      throw new Error(
        `${label} read failed: ${result.error.message ?? "unknown"}`
      )
    }
    if (!Number.isSafeInteger(result.count) || Number(result.count) < 0) {
      throw new Error(`${label} did not return a safe exact count`)
    }
    if (declaredTotal === null) declaredTotal = Number(result.count)
    if (result.count !== declaredTotal) {
      throw new Error(`${label} count drifted during pagination`)
    }
    if (!Array.isArray(result.data) || result.data.length > PAGE_SIZE) {
      throw new Error(`${label} returned an invalid page`)
    }
    if (result.data.length === 0 && rows.length < declaredTotal) {
      throw new Error(`${label} ended before its declared total`)
    }

    for (const raw of result.data) {
      const row = schema.parse(raw)
      const key = identity(row)
      if (seen.has(key))
        throw new Error(`${label} returned duplicate identity ${key}`)
      seen.add(key)
      rows.push(row)
    }

    if (rows.length === declaredTotal) return rows
    if (rows.length > declaredTotal || result.data.length < PAGE_SIZE) {
      throw new Error(`${label} could not reconcile its declared total`)
    }
  }

  throw new Error(`${label} exceeded the ${MAX_PAGES * PAGE_SIZE} row bound`)
}

export async function loadCaseStudySourceInventory(
  supabase: SupabaseClient,
  options: {
    asOf: string
    selection: CaseStudySelection | null
    expectedReportTemplateId: string
  }
): Promise<CaseStudySourceInventory> {
  const { data: rawRun, error: runError } = await supabase
    .from("report_runs")
    .select(
      "id, template_id, status, completed_at, listing_count, metric_row_count, unresolved_count, report_currency, error_reason"
    )
    .eq("status", "completed")
    .eq("template_id", options.expectedReportTemplateId)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (runError || !rawRun) {
    throw new Error(
      `Latest completed Report Builder run unavailable: ${runError?.message ?? "none"}`
    )
  }
  const reportRun = reportRunSchema.parse(rawRun)
  if (reportRun.template_id !== options.expectedReportTemplateId) {
    throw new Error("Report Builder returned a run for an unexpected template")
  }

  const listings = await readAllPages(
    "active listings",
    hubListingSchema,
    (from, to) =>
      supabase
        .from("listings")
        .select(
          "id, name, status, listing_id, client_id, created_at, initial_setup_date, adjustment_confirmed_date, deactivated_date",
          { count: "exact" }
        )
        .eq("report_run_id", reportRun.id)
        .eq("status", "active")
        .order("id", { ascending: true })
        .range(from, to),
    (row) => row.id
  )

  const clients = await readAllPages(
    "clients",
    clientSchema,
    (from, to) =>
      supabase
        .from("clients")
        .select("id, name, status, onboarding_date", { count: "exact" })
        .order("id", { ascending: true })
        .range(from, to),
    (row) => row.id
  )

  const setupAdjustments = await readAllPages(
    "controlled setup adjustments",
    setupAdjustmentSchema,
    (from, to) =>
      supabase
        .from("adjustments")
        .select(
          "id, listing_id, status, type, resolved_at, controlled_at, created_at",
          { count: "exact" }
        )
        .eq("type", "setup")
        .eq("status", "controlled")
        .order("id", { ascending: true })
        .range(from, to),
    (row) => row.id
  )

  const onboardingRuns = await readAllPages(
    "onboarding runs",
    onboardingRunSchema,
    (from, to) =>
      supabase
        .from("onboarding_runs")
        .select("id, client_id, status, started_at, live_at, created_at", {
          count: "exact",
        })
        .order("id", { ascending: true })
        .range(from, to),
    (row) => row.id
  )

  const onboardingRunListings = await readAllPages(
    "onboarding run listings",
    onboardingRunListingSchema,
    (from, to) =>
      supabase
        .from("onboarding_run_listings")
        .select(
          "id, run_id, hub_listing_id, is_live, launch_month, launch_year, target_launch_month, target_launch_year, created_at",
          { count: "exact" }
        )
        .not("hub_listing_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    (row) => row.id
  )

  const reportListings = await readAllPages(
    "Report Builder listings",
    reportListingSchema,
    (from, to) =>
      supabase
        .from("report_listings")
        .select(
          "listing_id, listing_name, hub_listing_id, hub_client_id, report_run_id, updated_at",
          { count: "exact" }
        )
        .order("listing_id", { ascending: true })
        .range(from, to),
    (row) => row.listing_id
  )

  const reportMetrics = await readAllPages(
    "Report Builder metrics",
    reportMetricSchema,
    (from, to) =>
      supabase
        .from("report_metrics")
        .select(
          "id, report_run_id, listing_id, period, rental_revenue, rental_revenue_ly, rental_adr, rental_adr_ly, market_adr, rental_revpar, rental_revpar_ly, market_revpar, market_revpar_ly, revpar_index, adjusted_occupancy_pct, adjusted_occupancy_ly_pct, market_occupancy_pct, market_occupancy_ly_pct, median_booking_window, median_booking_window_ly, market_median_booking_window, market_median_booking_window_ly",
          { count: "exact" }
        )
        .eq("report_run_id", reportRun.id)
        .order("period", { ascending: true })
        .order("listing_id", { ascending: true })
        .range(from, to),
    (row) => `${row.listing_id}:${row.period}`
  )

  validateReportRunInventory(reportRun, reportListings, reportMetrics)

  return {
    workflowVersion: CASE_STUDY_WORKFLOW_VERSION,
    projectRef: EXPECTED_REVFACTOR_PROJECT_REF,
    asOf: options.asOf,
    expectedReportTemplateId: options.expectedReportTemplateId,
    selection: options.selection,
    reportRun,
    listings,
    clients,
    setupAdjustments,
    onboardingRuns,
    onboardingRunListings,
    reportListings,
    reportMetrics,
  }
}

export function validateReportRunInventory(
  reportRun: ReportRunSource,
  reportListings: ReportListingSource[],
  reportMetrics: ReportMetricSource[]
) {
  if (reportRun.listing_count === null) {
    throw new Error("Report Builder run has no declared listing count")
  }
  if (reportRun.listing_count !== reportListings.length) {
    throw new Error(
      `Report Builder run declared ${reportRun.listing_count} listings but returned ${reportListings.length}`
    )
  }
  if (reportRun.unresolved_count === null || reportRun.unresolved_count > 0) {
    throw new Error(
      `Report Builder run is unresolved or partial: ${reportRun.unresolved_count ?? "null"}`
    )
  }
  if (reportRun.metric_row_count !== reportMetrics.length) {
    throw new Error(
      `Report Builder run declared ${reportRun.metric_row_count ?? "null"} metrics but returned ${reportMetrics.length}`
    )
  }
  if (reportRun.error_reason) {
    throw new Error("Report Builder completed run contains an error reason")
  }
}
