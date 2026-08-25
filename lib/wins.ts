// Wins detection — pure types, rules and classification.
//
// Client-safe on purpose: no next/headers, no Supabase, no environment. Every
// function here is deterministic so the whole classification is unit-testable
// without a database, matching the rest of lib/__tests__.
//
// Two clocks run through this module and must never be mixed silently:
//   * pickup is measured by BOOKED DATE (when the guest reserved);
//   * TY/STLY revenue is measured by STAY DATE (when the guest sleeps there).
// They answer different questions, so they are kept in separate shapes and are
// labelled separately everywhere they surface.

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * Frozen rule set. The whole object is snapshotted into every detection run
 * (win_detection_runs.rules_snapshot) so historical evidence stays
 * reproducible. Changing any number here requires bumping `version`, which is
 * surfaced in the UI so a shift in thresholds is never invisible.
 */
export const WINS_RULES_V1 = {
  version: "v1",
  /** Pickup change strictly above this is `up`. Verified against the reference workbook: the lowest change it labelled Up was +15.18%. */
  pickupUpThreshold: 0.15,
  /** Pickup change strictly below this is `down`. Workbook's highest Down was -15.46%. */
  pickupDownThreshold: -0.15,
  /** Below this STLY base a percentage is meaningless, so only the absolute delta is shown. */
  minStlyRevenue: 5000,
  /** RevPAR Index at or above this is a market-relative win candidate. */
  revparIndexWinFloor: 105,
  /** Above this the comp set is almost certainly mis-built, not the listing 5x its market. */
  revparIndexQaCeiling: 250,
  /** Beyond this the source is treated as stale and nothing is communicable. */
  maxStalenessDays: 2,
  /** Length of each pickup window, in days, inclusive of both endpoints. */
  pickupWindowDays: 31,
  /** Above this a percentage is suppressed in favour of the absolute delta. */
  extremeYoyPct: 3,
  /** Occupancy rise (pp) paired with an ADR fall that warrants a second look. */
  occUpPpThreshold: 3,
  adrDownPctThreshold: -0.1,
} as const

/**
 * A rule set, whether it came from the seeded constant above or from a
 * published `win_rule_sets` row. Structural rather than `typeof WINS_RULES_V1`
 * so a database-backed set with different numbers still satisfies it.
 */
export type WinsRules = {
  version: string
  pickupUpThreshold: number
  pickupDownThreshold: number
  minStlyRevenue: number
  revparIndexWinFloor: number
  revparIndexQaCeiling: number
  maxStalenessDays: number
  pickupWindowDays: number
  extremeYoyPct: number
  occUpPpThreshold: number
  adrDownPctThreshold: number
}

/** Editable fields of a rule set — everything except the derived version. */
export type WinsRuleInput = Omit<WinsRules, "version">

export const WINS_RULE_FIELDS: {
  key: keyof WinsRuleInput
  label: string
  help: string
  unit: "percent" | "currency" | "days" | "index" | "points"
  min: number
  max: number
  step: number
}[] = [
  {
    key: "pickupUpThreshold",
    label: "Pickup — Up above",
    help: "Pickup growth strictly above this is Up. The reference workbook's lowest Up was +15.18%.",
    unit: "percent",
    min: 0,
    max: 200,
    step: 1,
  },
  {
    key: "pickupDownThreshold",
    label: "Pickup — Down below",
    help: "Pickup change strictly below this is Down. Anything between the two cuts is Held, inclusive.",
    unit: "percent",
    min: -100,
    max: 0,
    step: 1,
  },
  {
    key: "pickupWindowDays",
    label: "Pickup window",
    help: "Length of each comparison window, by booked date. 31 days reproduces the reference workbook exactly — changing it breaks that comparability.",
    unit: "days",
    min: 7,
    max: 90,
    step: 1,
  },
  {
    key: "minStlyRevenue",
    label: "Minimum STLY base",
    help: "Below this prior-year revenue a percentage is suppressed and only the absolute change is shown. Guards against figures like the workbook's +18,013% on a $249 base.",
    unit: "currency",
    min: 0,
    max: 100000,
    step: 500,
  },
  {
    key: "extremeYoyPct",
    label: "Suppress percentage above",
    help: "A year-over-year percentage larger than this is dropped from the message in favour of the absolute change.",
    unit: "percent",
    min: 50,
    max: 2000,
    step: 50,
  },
  {
    key: "revparIndexWinFloor",
    label: "Market Compass floor",
    help: "RevPAR Index at or above this makes a listing without prior-year history a Market Compass candidate.",
    unit: "index",
    min: 50,
    max: 200,
    step: 1,
  },
  {
    key: "revparIndexQaCeiling",
    label: "Comp set QA ceiling",
    help: "Above this the comp set is almost certainly mis-built rather than the listing genuinely outperforming. Blocks communication pending review.",
    unit: "index",
    min: 120,
    max: 1000,
    step: 10,
  },
  {
    key: "maxStalenessDays",
    label: "Maximum data age",
    help: "Beyond this many days since the newest complete booking day, nothing is marked ready to communicate.",
    unit: "days",
    min: 0,
    max: 30,
    step: 1,
  },
  {
    key: "occUpPpThreshold",
    label: "Occupancy rise watch",
    help: "Occupancy gain (percentage points) that, paired with the ADR fall below, raises a review signal.",
    unit: "points",
    min: 0,
    max: 50,
    step: 1,
  },
  {
    key: "adrDownPctThreshold",
    label: "ADR fall watch",
    help: "ADR decline that, paired with the occupancy rise above, raises a review signal.",
    unit: "percent",
    min: -100,
    max: 0,
    step: 1,
  },
]

/** Map a `win_rule_sets` row onto the shape the detector consumes. */
export function ruleSetFromRow(row: Record<string, unknown>): WinsRules {
  const n = (v: unknown, fallback: number): number => {
    const parsed = typeof v === "string" ? Number(v) : (v as number)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return {
    version: `v${n(row.version, 1)}`,
    pickupUpThreshold: n(row.pickup_up_threshold, WINS_RULES_V1.pickupUpThreshold),
    pickupDownThreshold: n(row.pickup_down_threshold, WINS_RULES_V1.pickupDownThreshold),
    minStlyRevenue: n(row.min_stly_revenue, WINS_RULES_V1.minStlyRevenue),
    revparIndexWinFloor: n(row.revpar_index_win_floor, WINS_RULES_V1.revparIndexWinFloor),
    revparIndexQaCeiling: n(row.revpar_index_qa_ceiling, WINS_RULES_V1.revparIndexQaCeiling),
    maxStalenessDays: n(row.max_staleness_days, WINS_RULES_V1.maxStalenessDays),
    pickupWindowDays: n(row.pickup_window_days, WINS_RULES_V1.pickupWindowDays),
    extremeYoyPct: n(row.extreme_yoy_pct, WINS_RULES_V1.extremeYoyPct),
    occUpPpThreshold: n(row.occ_up_pp_threshold, WINS_RULES_V1.occUpPpThreshold),
    adrDownPctThreshold: n(row.adr_down_pct_threshold, WINS_RULES_V1.adrDownPctThreshold),
  }
}

/** Column payload for inserting a new version. */
export function ruleSetToRow(input: WinsRuleInput): Record<string, number> {
  return {
    pickup_up_threshold: input.pickupUpThreshold,
    pickup_down_threshold: input.pickupDownThreshold,
    pickup_window_days: input.pickupWindowDays,
    min_stly_revenue: input.minStlyRevenue,
    extreme_yoy_pct: input.extremeYoyPct,
    revpar_index_win_floor: input.revparIndexWinFloor,
    revpar_index_qa_ceiling: input.revparIndexQaCeiling,
    max_staleness_days: input.maxStalenessDays,
    occ_up_pp_threshold: input.occUpPpThreshold,
    adr_down_pct_threshold: input.adrDownPctThreshold,
  }
}

/**
 * Validate a proposed rule set.
 *
 * Mirrors the CHECK constraints in migration 076 so the form can explain a
 * problem in words rather than surfacing a Postgres constraint name. The
 * database remains the real boundary; this is the courteous half.
 */
export function validateRuleSet(
  input: WinsRuleInput
): { error: string } | { value: WinsRuleInput } {
  const finite = Object.entries(input).every(([, v]) => Number.isFinite(v))
  if (!finite) return { error: "Every threshold must be a number" }

  if (input.pickupUpThreshold <= input.pickupDownThreshold) {
    return { error: "The Up cut must be above the Down cut, or no listing could be Held" }
  }
  if (input.pickupUpThreshold < 0 || input.pickupUpThreshold > 5) {
    return { error: "The Up cut must be between 0% and 500%" }
  }
  if (input.pickupDownThreshold < -1 || input.pickupDownThreshold > 0) {
    return { error: "The Down cut must be between -100% and 0%" }
  }
  if (input.pickupWindowDays < 7 || input.pickupWindowDays > 90) {
    return { error: "The pickup window must be between 7 and 90 days" }
  }
  if (input.minStlyRevenue < 0) {
    return { error: "The minimum STLY base cannot be negative" }
  }
  if (input.extremeYoyPct <= 0) {
    return { error: "The percentage-suppression threshold must be above zero" }
  }
  if (input.revparIndexQaCeiling <= input.revparIndexWinFloor) {
    return { error: "The comp set QA ceiling must be above the Market Compass floor" }
  }
  if (input.revparIndexWinFloor < 50 || input.revparIndexWinFloor > 200) {
    return { error: "The Market Compass floor must be between 50 and 200" }
  }
  if (input.maxStalenessDays < 0 || input.maxStalenessDays > 30) {
    return { error: "Maximum data age must be between 0 and 30 days" }
  }
  if (input.occUpPpThreshold < 0) {
    return { error: "The occupancy rise watch cannot be negative" }
  }
  if (input.adrDownPctThreshold > 0) {
    return { error: "The ADR fall watch must be zero or negative" }
  }
  return { value: input }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const WIN_CATEGORIES = [
  "double_win",
  "yoy_positive_steady",
  "market_compass_candidate",
  "conflicting_signal",
  "insufficient_data",
  "no_win",
] as const
export type WinCategory = (typeof WIN_CATEGORIES)[number]

export const WIN_CONFIDENCES = ["high", "medium", "low", "none"] as const
export type WinConfidence = (typeof WIN_CONFIDENCES)[number]

export const PICKUP_TRENDS = [
  "up",
  "held",
  "down",
  "up_from_zero",
  "no_pickup",
  "insufficient_data",
] as const
export type PickupTrend = (typeof PICKUP_TRENDS)[number]

export const WIN_REVIEW_STATES = [
  "new",
  "in_review",
  "shared_manually",
  "dismissed",
  "snoozed",
] as const
export type WinReviewState = (typeof WIN_REVIEW_STATES)[number]

export const WIN_EVENT_TYPES = [
  "viewed",
  "message_generated",
  "message_edited",
  "copied",
  "assembly_opened",
  "marked_shared",
  "dismissed",
  "reopened",
] as const
export type WinEventType = (typeof WIN_EVENT_TYPES)[number]

/** Reason codes marked blocking keep a candidate out of the "ready to share" queue. */
export const BLOCKING_REASON_CODES = [
  "stale_source",
  "incomplete_period",
  "currency_mismatch",
  "ambiguous_listing_mapping",
  "unassigned_client",
  "compset_missing",
  "compset_qa_required",
] as const

export const REASON_CODE_LABELS: Record<string, string> = {
  stale_source: "Source data is stale",
  incomplete_period: "Period has missing months",
  small_stly_base: "Small comparison base",
  no_stly: "No comparable prior year",
  new_listing: "New listing",
  currency_mismatch: "Mixed currencies",
  ambiguous_listing_mapping: "Listing maps to several properties",
  negative_revenue: "Contains refunds or adjustments",
  unassigned_client: "Listing has no client",
  compset_missing: "No comp set data",
  compset_qa_required: "Comp set needs QA",
  extreme_yoy_pct: "Extreme percentage",
  no_assembly_chat: "No Assembly chat",
  occ_up_adr_down: "Occupancy up while ADR falls",
}

export type WinPeriod = {
  start: string
  end: string
  label: string
  months: number
}

export type WinWindows = {
  w1: [string, string]
  w2: [string, string]
  w3: [string, string]
}

export type PickupEvidence = {
  w1: number
  w2: number
  w3: number
  delta_abs: number
  change_pct: number | null
  trend: PickupTrend
  median_lead_days_w3: number | null
  reservation_count_w2: number
  reservation_count_w3: number
}

export type YoyEvidence = {
  revenue_ty: number
  revenue_stly: number
  delta_abs: number
  pct: number | null
  pct_suppressed_reason: "no_stly" | "small_base" | "extreme" | null
}

export type OccupancyEvidence = {
  ty_pct: number | null
  stly_pct: number | null
  market_pct: number | null
  gap_pp: number | null
  aggregation: "simple_average"
}

export type AdrEvidence = {
  ty: number | null
  stly: number | null
  market: number | null
  vs_market_pct: number | null
  aggregation: "simple_average"
}

export type MarketEvidence = {
  revpar_index: number | null
  market_revpar_yoy_pct: number | null
  bw_own_days: number | null
  bw_market_days: number | null
  bw_vs_market_days: number | null
}

export type WinSource = {
  name: string
  as_of: string | null
  note?: string
  report_run_id?: string
  completed_at?: string | null
}

export type WinMonthlyDetail = {
  period: string
  rental_revenue: number | null
  rental_revenue_stly: number | null
}

export type WinEvidence = {
  currency: string
  period: WinPeriod
  windows: WinWindows
  pickup: PickupEvidence
  yoy: YoyEvidence
  occupancy: OccupancyEvidence
  adr: AdrEvidence
  market: MarketEvidence
  opportunity: { potential_revenue_open_inventory: number | null }
  sources: WinSource[]
  monthly_detail: WinMonthlyDetail[]
}

export type WinCandidate = {
  id: string
  run_id: string
  hub_listing_id: string | null
  pricelabs_listing_id: string
  client_id: string | null
  listing_name_snapshot: string
  client_name_snapshot: string | null
  category: WinCategory
  confidence: WinConfidence
  pickup_trend: PickupTrend
  reason_codes: string[]
  is_blocked: boolean
  priority_rank: number
  evidence: WinEvidence
  created_at: string
  review_state?: WinReviewState
  assembly_deep_link?: string | null
}

export type WinDetectionRun = {
  id: string
  as_of_date: string
  period_start: string
  period_end: string
  rules_version: string
  report_run_id: string | null
  reservations_fetched_at: string | null
  reservations_max_booked_date: string | null
  status: "running" | "completed" | "failed"
  candidate_count: number
  currency: string | null
  error_reason: string | null
  completed_at: string | null
}

// ---------------------------------------------------------------------------
// Date helpers
//
// All window maths runs on calendar DATE strings, never timestamps: the
// upstream booked_at is a timestamptz whose timezone we do not control, and
// bucketing by calendar day removes the whole class of intra-day drift.
// ---------------------------------------------------------------------------

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function monthStartIso(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

export function addMonthsIso(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7)) - 1 + months
  const d = new Date(Date.UTC(y, m, 1))
  return d.toISOString().slice(0, 10)
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

export function monthLabel(iso: string): string {
  return `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
}

/** "Aug–Oct 2026", or "Aug 2026" for a single month. */
export function periodLabel(start: string, end: string): string {
  if (start.slice(0, 7) === end.slice(0, 7)) return monthLabel(start)
  const sy = start.slice(0, 4)
  const ey = end.slice(0, 4)
  const sm = MONTH_NAMES[Number(start.slice(5, 7)) - 1]
  const em = MONTH_NAMES[Number(end.slice(5, 7)) - 1]
  return sy === ey ? `${sm}–${em} ${ey}` : `${sm} ${sy}–${em} ${ey}`
}

/**
 * Three consecutive 31-day windows ending on `asOf`, inclusive at both ends.
 * With asOf = 2026-08-12 this reproduces the reference workbook exactly:
 * W3 = Jul 13–Aug 12, W2 = Jun 12–Jul 12.
 */
export function buildWindows(asOf: string, rules: WinsRules = WINS_RULES_V1): WinWindows {
  const span = rules.pickupWindowDays - 1
  return {
    w3: [addDaysIso(asOf, -span), asOf],
    w2: [addDaysIso(asOf, -(span * 2 + 1)), addDaysIso(asOf, -(span + 1))],
    w1: [addDaysIso(asOf, -(span * 3 + 2)), addDaysIso(asOf, -(span * 2 + 2))],
  }
}

/**
 * Default comparison period: the current month plus the next two. Mirrors the
 * horizon the Grant-style reservations report already uses, and lands inside
 * the calendar year that report_metrics covers.
 */
export function defaultPeriod(asOf: string, months = 3): WinPeriod {
  const start = monthStartIso(asOf)
  const end = addMonthsIso(start, months - 1)
  return { start, end, label: periodLabel(start, end), months }
}

/** Every month start between two period bounds, inclusive. */
export function periodMonths(period: WinPeriod): string[] {
  const out: string[] = []
  for (let i = 0; i < period.months; i++) out.push(addMonthsIso(period.start, i))
  return out
}

export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Pickup trend from two consecutive windows.
 *
 * The zero-denominator cases are the whole reason this is a function and not
 * an inline expression: the reference workbook folded all 16 of its W2 = 0
 * listings into "Up", hiding a division by zero. Here they are their own
 * trend and never carry a percentage.
 */
export function computePickupTrend(
  w2: number,
  w3: number,
  rules: WinsRules = WINS_RULES_V1
): { trend: PickupTrend; changePct: number | null } {
  if (!Number.isFinite(w2) || !Number.isFinite(w3)) {
    return { trend: "insufficient_data", changePct: null }
  }
  if (w2 === 0) {
    if (w3 > 0) return { trend: "up_from_zero", changePct: null }
    return { trend: "no_pickup", changePct: null }
  }
  const pct = (w3 - w2) / w2
  if (pct > rules.pickupUpThreshold) return { trend: "up", changePct: pct }
  if (pct < rules.pickupDownThreshold) return { trend: "down", changePct: pct }
  // Inclusive on both edges: exactly +/-15% is Held, not Up or Down.
  return { trend: "held", changePct: pct }
}

/**
 * YoY figures with the percentage suppressed whenever it would mislead.
 * A percentage against a zero or tiny base is not a smaller truth, it is a
 * different and wrong claim, so it is returned as null with a reason.
 */
export function computeYoy(
  revenueTy: number,
  revenueStly: number,
  rules: WinsRules = WINS_RULES_V1
): YoyEvidence {
  const delta = revenueTy - revenueStly
  if (!revenueStly || revenueStly <= 0) {
    return {
      revenue_ty: revenueTy,
      revenue_stly: revenueStly,
      delta_abs: delta,
      pct: null,
      pct_suppressed_reason: "no_stly",
    }
  }
  if (revenueStly < rules.minStlyRevenue) {
    return {
      revenue_ty: revenueTy,
      revenue_stly: revenueStly,
      delta_abs: delta,
      pct: null,
      pct_suppressed_reason: "small_base",
    }
  }
  const pct = delta / revenueStly
  if (Math.abs(pct) > rules.extremeYoyPct) {
    return {
      revenue_ty: revenueTy,
      revenue_stly: revenueStly,
      delta_abs: delta,
      pct,
      pct_suppressed_reason: "extreme",
    }
  }
  return {
    revenue_ty: revenueTy,
    revenue_stly: revenueStly,
    delta_abs: delta,
    pct,
    pct_suppressed_reason: null,
  }
}

export function isBlockingReason(code: string): boolean {
  return (BLOCKING_REASON_CODES as readonly string[]).includes(code)
}

export type ClassifyInput = {
  evidence: WinEvidence
  reasonCodes: string[]
}

export type ClassifyResult = {
  category: WinCategory
  confidence: WinConfidence
  isBlocked: boolean
}

/**
 * Decision table, evaluated top to bottom; first match wins. Ordering is the
 * specification, so keep the guard clauses ahead of the win branches.
 */
export function classifyCandidate(
  input: ClassifyInput,
  rules: WinsRules = WINS_RULES_V1
): ClassifyResult {
  const { evidence, reasonCodes } = input
  const blocked = reasonCodes.some(isBlockingReason)
  const { pickup, yoy, market } = evidence
  const hasStly = yoy.revenue_stly > 0
  const smallBase = hasStly && yoy.revenue_stly < rules.minStlyRevenue
  const revenueUp = yoy.revenue_ty > yoy.revenue_stly

  // 1-2. Guards.
  if (blocked || pickup.trend === "insufficient_data" || pickup.trend === "no_pickup") {
    return { category: "insufficient_data", confidence: "none", isBlocked: true }
  }

  const pickupPositive = pickup.trend === "up" || pickup.trend === "up_from_zero"

  if (hasStly) {
    // 3. Double Win.
    if (revenueUp && pickupPositive) {
      return {
        category: "double_win",
        confidence: smallBase ? "medium" : "high",
        isBlocked: false,
      }
    }
    // 4. YoY+ Steady.
    if (revenueUp && pickup.trend === "held") {
      return {
        category: "yoy_positive_steady",
        confidence: smallBase ? "low" : "medium",
        isBlocked: false,
      }
    }
    // 5-6. Contradictory signals never surface by default.
    if (revenueUp && pickup.trend === "down") {
      return { category: "conflicting_signal", confidence: "low", isBlocked: false }
    }
    if (!revenueUp && pickupPositive) {
      return { category: "conflicting_signal", confidence: "low", isBlocked: false }
    }
    return { category: "no_win", confidence: "none", isBlocked: false }
  }

  // 7-8. Market Compass: no comparable own history, judged against the market.
  const idx = market.revpar_index
  if (idx != null && idx >= rules.revparIndexWinFloor && pickup.trend !== "down") {
    if (idx > rules.revparIndexQaCeiling) {
      // An index this high nearly always means a mis-built comp set.
      return { category: "market_compass_candidate", confidence: "low", isBlocked: true }
    }
    return { category: "market_compass_candidate", confidence: "medium", isBlocked: false }
  }

  return { category: "no_win", confidence: "none", isBlocked: false }
}

/**
 * Reason codes whose presence depends on the thresholds rather than on the
 * data alone. They are recomputed whenever rules change; everything else is a
 * property of the listing or the sync and is carried through untouched.
 */
export const RULE_DEPENDENT_REASON_CODES = [
  "stale_source",
  "small_stly_base",
  "extreme_yoy_pct",
  "compset_qa_required",
  "occ_up_adr_down",
] as const

export type CandidateRawInputs = {
  pickupW2: number
  pickupW3: number
  revenueTy: number
  revenueStly: number
  revparIndex: number | null
  marketRevpar: number | null
  occTy: number | null
  occStly: number | null
  adrTy: number | null
  adrStly: number | null
  /** Days between the analysis anchor and today. */
  stalenessDays: number
}

export type CandidateEvaluation = {
  pickupTrend: PickupTrend
  pickupChangePct: number | null
  yoy: YoyEvidence
  reasonCodes: string[]
  category: WinCategory
  confidence: WinConfidence
  isBlocked: boolean
}

/**
 * Evaluate one listing end to end under a given rule set.
 *
 * This is the single source of truth for "what would these thresholds decide",
 * called both by the detection run and by the rules editor's impact preview.
 * Sharing it is the point: a preview computed by a parallel implementation
 * would eventually disagree with the detector and quietly mislead whoever is
 * tuning the numbers.
 *
 * `staticReasonCodes` are the data-dependent codes the caller already knows
 * (unassigned client, ambiguous mapping, incomplete period, and so on); the
 * threshold-dependent ones are derived here.
 */
export function evaluateCandidate(
  raw: CandidateRawInputs,
  staticReasonCodes: string[],
  rules: WinsRules
): CandidateEvaluation {
  const { trend, changePct } = computePickupTrend(raw.pickupW2, raw.pickupW3, rules)
  const yoy = computeYoy(raw.revenueTy, raw.revenueStly, rules)

  const codes = new Set(
    staticReasonCodes.filter(
      (c) => !(RULE_DEPENDENT_REASON_CODES as readonly string[]).includes(c)
    )
  )

  if (raw.stalenessDays > rules.maxStalenessDays) codes.add("stale_source")
  if (yoy.pct_suppressed_reason === "small_base") codes.add("small_stly_base")
  if (yoy.pct_suppressed_reason === "no_stly") codes.add("no_stly")
  if (yoy.pct_suppressed_reason === "extreme") codes.add("extreme_yoy_pct")
  if (raw.revparIndex != null && raw.revparIndex > rules.revparIndexQaCeiling) {
    codes.add("compset_qa_required")
  }
  if (
    raw.occTy != null &&
    raw.occStly != null &&
    raw.adrTy != null &&
    raw.adrStly != null &&
    raw.adrStly > 0 &&
    raw.occTy - raw.occStly >= rules.occUpPpThreshold &&
    raw.adrTy / raw.adrStly - 1 <= rules.adrDownPctThreshold
  ) {
    codes.add("occ_up_adr_down")
  }

  const reasonCodes = [...codes]

  // classifyCandidate only reads these three branches of the evidence, so a
  // narrow shape keeps this callable from the browser without a full snapshot.
  const partial = {
    pickup: { trend },
    yoy,
    market: { revpar_index: raw.revparIndex },
  } as unknown as WinEvidence

  const { category, confidence, isBlocked } = classifyCandidate(
    { evidence: partial, reasonCodes },
    rules
  )

  return { pickupTrend: trend, pickupChangePct: changePct, yoy, reasonCodes, category, confidence, isBlocked }
}

/** Pull the raw inputs back out of a stored evidence blob for re-evaluation. */
export function rawInputsFromEvidence(
  evidence: WinEvidence,
  stalenessDays: number
): CandidateRawInputs {
  return {
    pickupW2: evidence.pickup.w2,
    pickupW3: evidence.pickup.w3,
    revenueTy: evidence.yoy.revenue_ty,
    revenueStly: evidence.yoy.revenue_stly,
    revparIndex: evidence.market.revpar_index,
    marketRevpar: null,
    occTy: evidence.occupancy.ty_pct,
    occStly: evidence.occupancy.stly_pct,
    adrTy: evidence.adr.ty,
    adrStly: evidence.adr.stly,
    stalenessDays,
  }
}

/** Categories that count as a win for the queue and the KPI row. */
export const WIN_CATEGORIES_POSITIVE: readonly WinCategory[] = [
  "double_win",
  "yoy_positive_steady",
  "market_compass_candidate",
]

export const READY_CATEGORIES: readonly WinCategory[] = ["double_win", "yoy_positive_steady"]

/** A candidate is communicable only if it is a win, confident, and unblocked. */
export function isReadyToShare(c: {
  category: WinCategory
  confidence: WinConfidence
  is_blocked: boolean
  review_state?: WinReviewState
}): boolean {
  if (!READY_CATEGORIES.includes(c.category)) return false
  if (c.is_blocked) return false
  if (c.confidence !== "high" && c.confidence !== "medium") return false
  if (c.review_state && c.review_state !== "new" && c.review_state !== "in_review") return false
  return true
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

const CONFIDENCE_ORDER: Record<WinConfidence, number> = { high: 0, medium: 1, low: 2, none: 3 }
const CATEGORY_ORDER: Record<WinCategory, number> = {
  double_win: 0,
  yoy_positive_steady: 1,
  market_compass_candidate: 2,
  conflicting_signal: 3,
  no_win: 4,
  insufficient_data: 5,
}

export type RankableCandidate = {
  category: WinCategory
  confidence: WinConfidence
  is_blocked: boolean
  evidence: WinEvidence
  client_id: string | null
  has_assembly_chat: boolean
}

/**
 * Deliberately lexicographic rather than a weighted score: an analyst must be
 * able to look at two adjacent rows and say in one sentence why one is above
 * the other. A single opaque number cannot be argued with.
 */
export function compareCandidates(a: RankableCandidate, b: RankableCandidate): number {
  if (a.is_blocked !== b.is_blocked) return a.is_blocked ? 1 : -1
  const cat = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]
  if (cat !== 0) return cat
  const conf = CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence]
  if (conf !== 0) return conf
  const pickup = b.evidence.pickup.delta_abs - a.evidence.pickup.delta_abs
  if (pickup !== 0) return pickup
  const yoy = b.evidence.yoy.delta_abs - a.evidence.yoy.delta_abs
  if (yoy !== 0) return yoy
  const client = Number(Boolean(b.client_id)) - Number(Boolean(a.client_id))
  if (client !== 0) return client
  return Number(b.has_assembly_chat) - Number(a.has_assembly_chat)
}

export function rankCandidates<T extends RankableCandidate>(candidates: T[]): T[] {
  return [...candidates].sort(compareCandidates)
}

// ---------------------------------------------------------------------------
// Client aggregation
// ---------------------------------------------------------------------------

export type ClientWinGroup = {
  client_id: string | null
  client_name: string | null
  candidates: WinCandidate[]
  wins_count: number
  negative_count: number
  /** Portfolio pickup excludes fan-out listings, which would be double-counted. */
  portfolio_pickup_w2: number
  portfolio_pickup_w3: number
  portfolio_revenue_ty: number
  portfolio_revenue_stly: number
  excluded_from_totals: number
  currency: string
  has_assembly_chat: boolean
  top_wins: WinCandidate[]
}

/**
 * Group candidates by client.
 *
 * Pickup totals skip any listing flagged `ambiguous_listing_mapping`: the
 * reservations matview fans one reservation into several hub listings, so
 * summing those across a portfolio counts the same booking twice. Revenue
 * totals come from report_metrics, whose grain is listing x month, so they
 * carry no fan-out and sum directly.
 */
export function aggregateByClient(
  candidates: WinCandidate[],
  opts: { assemblyChatByClient?: Record<string, boolean>; topN?: number } = {}
): ClientWinGroup[] {
  const topN = opts.topN ?? 3
  const groups = new Map<string, ClientWinGroup>()

  for (const c of candidates) {
    const key = c.client_id ?? "__unassigned__"
    let g = groups.get(key)
    if (!g) {
      g = {
        client_id: c.client_id,
        client_name: c.client_name_snapshot,
        candidates: [],
        wins_count: 0,
        negative_count: 0,
        portfolio_pickup_w2: 0,
        portfolio_pickup_w3: 0,
        portfolio_revenue_ty: 0,
        portfolio_revenue_stly: 0,
        excluded_from_totals: 0,
        currency: c.evidence.currency,
        has_assembly_chat: c.client_id
          ? Boolean(opts.assemblyChatByClient?.[c.client_id])
          : false,
        top_wins: [],
      }
      groups.set(key, g)
    }

    g.candidates.push(c)
    if (WIN_CATEGORIES_POSITIVE.includes(c.category)) g.wins_count++
    if (c.category === "conflicting_signal" || c.evidence.pickup.trend === "down") {
      g.negative_count++
    }

    if (c.reason_codes.includes("ambiguous_listing_mapping")) {
      g.excluded_from_totals++
    } else {
      g.portfolio_pickup_w2 += c.evidence.pickup.w2
      g.portfolio_pickup_w3 += c.evidence.pickup.w3
    }
    g.portfolio_revenue_ty += c.evidence.yoy.revenue_ty
    g.portfolio_revenue_stly += c.evidence.yoy.revenue_stly
  }

  for (const g of groups.values()) {
    g.top_wins = g.candidates
      .filter((c) => isReadyToShare({ ...c, review_state: c.review_state }))
      .slice(0, topN)
  }

  return [...groups.values()].sort((a, b) => {
    if (b.wins_count !== a.wins_count) return b.wins_count - a.wins_count
    return b.portfolio_pickup_w3 - a.portfolio_pickup_w3
  })
}

// ---------------------------------------------------------------------------
// Assembly deep link
//
// Built from columns the Hub already stores, so no Assembly API call is needed
// to render the queue. Company chat wins when a company exists, matching how
// settings/clients/actions.ts already resolves it.
// ---------------------------------------------------------------------------

export function buildAssemblyDeepLink(client: {
  assembly_company_id?: string | null
  assembly_client_id?: string | null
}): string | null {
  if (client.assembly_company_id) {
    return `https://dashboard.assembly.com/companies/${client.assembly_company_id}/messages`
  }
  if (client.assembly_client_id) {
    return `https://dashboard.assembly.com/clients/users/details/${client.assembly_client_id}/messages`
  }
  return null
}
