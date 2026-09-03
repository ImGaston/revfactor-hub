import { z } from "zod"

export const EXPECTED_REVFACTOR_PROJECT_REF = "xpfjjcwgbjsdxdhyrcxd"
export const CASE_STUDY_WORKFLOW_VERSION = "revfactor-case-study-foundation:v1"

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    )
  }, "Invalid date")
const isoTimestamp = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid timestamp")
const nullableDate = isoDate.nullable()
const nullableTimestamp = isoTimestamp.nullable()
const nullableFiniteNumber = z
  .union([z.number(), z.string()])
  .transform((value, context) => {
    const parsed = typeof value === "number" ? value : Number(value)
    if (!Number.isFinite(parsed)) {
      context.addIssue({ code: "custom", message: "Expected a finite number" })
      return z.NEVER
    }
    return parsed
  })
  .nullable()

export const caseStudySelectionSchema = z
  .object({
    version: z.literal("v1"),
    listingIds: z.array(z.string().uuid()).length(3),
    rationale: z.string().trim().min(1).max(2_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.listingIds).size !== value.listingIds.length) {
      context.addIssue({
        code: "custom",
        path: ["listingIds"],
        message: "Listing IDs must be unique",
      })
    }
  })

export type CaseStudySelection = z.infer<typeof caseStudySelectionSchema>

export const hubListingSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    status: z.string().min(1),
    listing_id: z.string().nullable(),
    client_id: z.string().uuid().nullable(),
    created_at: isoTimestamp,
    initial_setup_date: nullableDate,
    adjustment_confirmed_date: nullableDate,
    deactivated_date: nullableDate,
  })
  .strict()

export const clientSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    status: z.string().min(1),
    onboarding_date: nullableDate,
  })
  .strict()

export const setupAdjustmentSchema = z
  .object({
    id: z.string().uuid(),
    listing_id: z.string().uuid().nullable(),
    status: z.string().min(1),
    type: z.string().min(1),
    resolved_at: nullableTimestamp,
    controlled_at: nullableTimestamp,
    created_at: isoTimestamp,
  })
  .strict()

export const onboardingRunSchema = z
  .object({
    id: z.string().uuid(),
    client_id: z.string().uuid(),
    status: z.string().min(1),
    started_at: isoTimestamp,
    live_at: nullableTimestamp,
    created_at: isoTimestamp,
  })
  .strict()

export const onboardingRunListingSchema = z
  .object({
    id: z.string().uuid(),
    run_id: z.string().uuid(),
    hub_listing_id: z.string().uuid().nullable(),
    is_live: z.boolean(),
    launch_month: z.number().int().min(1).max(12).nullable(),
    launch_year: z.number().int().min(2000).max(2100).nullable(),
    target_launch_month: z.number().int().min(1).max(12).nullable(),
    target_launch_year: z.number().int().min(2000).max(2100).nullable(),
    created_at: isoTimestamp,
  })
  .strict()

export const reportRunSchema = z
  .object({
    id: z.string().uuid(),
    template_id: z.string().min(1),
    status: z.literal("completed"),
    completed_at: isoTimestamp,
    listing_count: z.number().int().nonnegative().nullable(),
    metric_row_count: z.number().int().nonnegative().nullable(),
    unresolved_count: z.number().int().nonnegative().nullable(),
    report_currency: z.string().trim().length(3).nullable(),
    error_reason: z.string().nullable(),
  })
  .strict()

export const reportListingSchema = z
  .object({
    listing_id: z.string().trim().min(1),
    listing_name: z.string().nullable(),
    hub_listing_id: z.string().uuid().nullable(),
    hub_client_id: z.string().uuid().nullable(),
    report_run_id: z.string().uuid().nullable(),
    updated_at: isoTimestamp,
  })
  .strict()

export const reportMetricSchema = z
  .object({
    id: z.string().uuid(),
    report_run_id: z.string().uuid(),
    listing_id: z.string().trim().min(1),
    period: isoDate.refine((value) => value.endsWith("-01"), {
      message: "Report metric period must be the first day of a month",
    }),
    rental_revenue: nullableFiniteNumber,
    rental_revenue_ly: nullableFiniteNumber,
    rental_adr: nullableFiniteNumber,
    rental_adr_ly: nullableFiniteNumber,
    market_adr: nullableFiniteNumber,
    rental_revpar: nullableFiniteNumber,
    rental_revpar_ly: nullableFiniteNumber,
    market_revpar: nullableFiniteNumber,
    market_revpar_ly: nullableFiniteNumber,
    revpar_index: nullableFiniteNumber,
    adjusted_occupancy_pct: nullableFiniteNumber,
    adjusted_occupancy_ly_pct: nullableFiniteNumber,
    market_occupancy_pct: nullableFiniteNumber,
    market_occupancy_ly_pct: nullableFiniteNumber,
    median_booking_window: nullableFiniteNumber,
    median_booking_window_ly: nullableFiniteNumber,
    market_median_booking_window: nullableFiniteNumber,
    market_median_booking_window_ly: nullableFiniteNumber,
  })
  .strict()

export type HubListingSource = z.infer<typeof hubListingSchema>
export type ClientSource = z.infer<typeof clientSchema>
export type SetupAdjustmentSource = z.infer<typeof setupAdjustmentSchema>
export type OnboardingRunSource = z.infer<typeof onboardingRunSchema>
export type OnboardingRunListingSource = z.infer<
  typeof onboardingRunListingSchema
>
export type ReportRunSource = z.infer<typeof reportRunSchema>
export type ReportListingSource = z.infer<typeof reportListingSchema>
export type ReportMetricSource = z.infer<typeof reportMetricSchema>

export type CaseStudySourceInventory = {
  workflowVersion: typeof CASE_STUDY_WORKFLOW_VERSION
  projectRef: typeof EXPECTED_REVFACTOR_PROJECT_REF
  asOf: string
  expectedReportTemplateId: string
  selection: CaseStudySelection | null
  reportRun: ReportRunSource
  listings: HubListingSource[]
  clients: ClientSource[]
  setupAdjustments: SetupAdjustmentSource[]
  onboardingRuns: OnboardingRunSource[]
  onboardingRunListings: OnboardingRunListingSource[]
  reportListings: ReportListingSource[]
  reportMetrics: ReportMetricSource[]
}

export const CASE_STUDY_STATES = [
  "Discovered",
  "Missing start proof",
  "Missing baseline",
  "Needs QA",
  "Quantitatively supported",
  "Full analysis",
  "Approved",
  "Rejected",
] as const

export type CaseStudyState = (typeof CASE_STUDY_STATES)[number]
export type StartConfidence = "high" | "medium" | "low" | "none"
export type CaseType = "inherited" | "revfactor_assisted_launch" | "unknown"
export type PriorYearAttribution =
  | "before_revfactor"
  | "revfactor_managed"
  | "unknown"

export type CaseStudyMonthlyEvidence = {
  period: string
  priorYearPeriod: string
  priorYearAttribution: PriorYearAttribution
  rentalRevenue: number | null
  rentalRevenueLy: number | null
  occupancyPct: number | null
  occupancyLyPct: number | null
  adr: number | null
  adrLy: number | null
  revpar: number | null
  revparLy: number | null
  marketOccupancyPct: number | null
  marketOccupancyLyPct: number | null
  marketAdr: number | null
  marketAdrLy: null
  marketRevpar: number | null
  marketRevparLy: number | null
  revparIndex: number | null
  bookingWindow: number | null
  bookingWindowLy: number | null
  marketBookingWindow: number | null
  marketBookingWindowLy: number | null
  listingRevparYoyPct: number | null
  marketRevparYoyPct: number | null
  marketAdjustedRevparLiftPp: number | null
  isValidCurrentEvidence: boolean
  qaFlags: string[]
}

export type CaseStudyPeriodSummary = {
  label: "first_3" | "first_6" | "first_12" | "latest_3" | "all_supported"
  available: boolean
  unavailableReason: string | null
  monthCount: number
  comparableMonthCount: number
  revenue: number | null
  revenueLy: number | null
  averageOccupancyPct: number | null
  averageAdr: number | null
  averageRevpar: number | null
  averageMarketRevpar: number | null
  averageRevparIndex: number | null
  averageMarketAdjustedRevparLiftPp: number | null
  shareComparableMonthsOutperformingMarket: number | null
  marketResilience: boolean
  marketDeclined: boolean
}

export type CaseStudyCandidate = {
  hubListingId: string
  priceLabsListingId: string | null
  clientId: string | null
  clientName: string | null
  listingName: string
  caseType: CaseType
  managementStartDate: string | null
  managementStartConfidence: StartConfidence
  managementStartSource: string | null
  launchDate: string | null
  launchDatePrecision: "month" | "unknown"
  eligibleManagedMonthCount: number
  rawMetricRowCount: number
  supportedManagedMonthCount: number
  comparableMonthCount: number
  state: CaseStudyState
  qaFlags: string[]
  monthly: CaseStudyMonthlyEvidence[]
  periods: CaseStudyPeriodSummary[]
  rank: number | null
  publicIdentityApproved: false
}

export type CaseStudyFoundationResult = {
  workflowVersion: typeof CASE_STUDY_WORKFLOW_VERSION
  projectRef: typeof EXPECTED_REVFACTOR_PROJECT_REF
  asOf: string
  reportRun: ReportRunSource
  selection: CaseStudySelection | null
  sourceFingerprint: string
  counts: {
    sourceActiveRevFactorListings: number
    selectedListings: number
    analyzed: number
    blocked: number
    skipped: number
  }
  candidates: CaseStudyCandidate[]
}
