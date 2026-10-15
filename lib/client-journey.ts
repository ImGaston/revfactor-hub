// Customer Journey — pure, client+server-safe computation of a client's
// journey steps from Hub data, with manual overrides from
// `client_journey_steps` (migration 20261014120000). No I/O here: the Server
// Action loads the rows and this module decides each step's status, date and
// evidence line. Tested in lib/__tests__/client-journey.test.ts.

export const JOURNEY_STATUSES = ["done", "next", "todo", "blocked"] as const
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number]

export const JOURNEY_STATUS_LABEL: Record<JourneyStatus, string> = {
  done: "Done",
  next: "Next",
  todo: "To do",
  blocked: "Blocked",
}

export const JOURNEY_PHASES = [
  { key: "sales", label: "Sales" },
  { key: "onboarding", label: "Onboarding", hint: "Day 0–5" },
  { key: "first_90", label: "First 90 days" },
  { key: "ongoing", label: "Ongoing" },
] as const
export type JourneyPhase = (typeof JOURNEY_PHASES)[number]["key"]

/**
 * Step keys are stored in `client_journey_steps.step_key` — never rename a key
 * (rename the label instead). `auto` = the Hub computes a status from data;
 * otherwise the step is manual (staff tick it).
 */
export const CLIENT_JOURNEY_STEPS = [
  { key: "discovery_call", phase: "sales", label: "Discovery call", auto: true },
  { key: "agreement_signed", phase: "sales", label: "Agreement signed", auto: true },
  { key: "payment_portal", phase: "sales", label: "Payment and portal invite", auto: true },
  { key: "onboarding_call", phase: "onboarding", label: "Onboarding call", auto: true },
  { key: "audit_published", phase: "onboarding", label: "Listing audit published", auto: true },
  { key: "audit_sent", phase: "onboarding", label: "Listing audit sent to owner", auto: true },
  { key: "owner_decided", phase: "onboarding", label: "Owner opened / decided on the audit", auto: true },
  { key: "access_verified", phase: "onboarding", label: "Access verified (PriceLabs synced, PMS)", auto: true },
  { key: "pricing_plan_approved", phase: "onboarding", label: "Pricing plan approved", auto: true },
  { key: "setup_applied", phase: "onboarding", label: "Setup applied in PriceLabs and the PMS", auto: true },
  { key: "launch_report_sent", phase: "onboarding", label: "Launch report sent", auto: false },
  { key: "owner_accepts_changes", phase: "first_90", label: "Owner accepts listing changes", auto: true },
  { key: "day_14_pickup", phase: "first_90", label: "Day 14 pickup check", auto: false },
  { key: "day_30_review", phase: "first_90", label: "Day 30 review", auto: false },
  { key: "day_60_90_checkins", phase: "first_90", label: "Day 60/90 check-ins", auto: false },
  { key: "monthly_reports", phase: "ongoing", label: "Monthly reports", auto: false },
  { key: "renewal", phase: "ongoing", label: "Renewal", auto: false },
] as const satisfies readonly { key: string; phase: JourneyPhase; label: string; auto: boolean }[]

export type JourneyStepKey = (typeof CLIENT_JOURNEY_STEPS)[number]["key"]

export const JOURNEY_STEP_KEYS = CLIENT_JOURNEY_STEPS.map((s) => s.key) as JourneyStepKey[]

export function isJourneyStepKey(value: string): value is JourneyStepKey {
  return (JOURNEY_STEP_KEYS as string[]).includes(value)
}

export function isJourneyStatus(value: string): value is JourneyStatus {
  return (JOURNEY_STATUSES as readonly string[]).includes(value)
}

/** Owner has not decided on a sent audit after this many days → blocked. */
export const OWNER_DECISION_STALL_DAYS = 7

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type JourneyClientInput = {
  onboarding_date: string | null
  ending_date: string | null
  status: string
  assembly_client_id: string | null
  pms_name: string | null
  ghl_onboarding: {
    agreement_evidence?: string[] | null
    appointment?: { start: string; status: string | null } | null
  } | null
}

export type JourneyListingInput = {
  id: string
  status: string
  listing_id: string | null
  pl_synced_at: string | null
}

export type JourneyReportInput = {
  id: string
  listing_id: string | null
  status: string
  published_at: string | null
  owner_message_sent_at: string | null
}

export type JourneyItemInput = {
  report_id: string
  kind: string
  client_status: string
  apply_status: string
}

export type JourneyDecisionEventInput = { report_id: string; created_at: string }

export type JourneySetupAdjustmentInput = {
  status: string
  created_at: string
  resolved_at: string | null
  controlled_at: string | null
}

export type JourneyPricingPlanInput = {
  listing_id: string
  status: string
  approved_at: string | null
}

export type JourneyOverrideInput = {
  step_key: string
  status: string
  done_at: string | null
  note: string | null
  updated_at: string | null
}

/**
 * `null` for a source means "not readable": no permission or the table does
 * not exist yet. Such steps stay `todo` with an evidence line saying why.
 */
export type JourneyInput = {
  now: Date
  client: JourneyClientInput
  listings: JourneyListingInput[]
  reports: JourneyReportInput[] | null
  items: JourneyItemInput[] | null
  decisionEvents: JourneyDecisionEventInput[] | null
  setupAdjustments: JourneySetupAdjustmentInput[] | null
  pricingPlans: JourneyPricingPlanInput[] | null
  openTickets: number | null
  overrides: JourneyOverrideInput[]
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type JourneyStep = {
  key: JourneyStepKey
  phase: JourneyPhase
  label: string
  auto: boolean
  status: JourneyStatus
  /** What the Hub data says, before any override. */
  computedStatus: JourneyStatus
  /** ISO date or timestamp the step happened (done) or is due (todo/next). */
  date: string | null
  evidence: string
  overridden: boolean
  note: string | null
}

export type JourneyHealth = {
  daysSinceSigning: number | null
  openTickets: number | null
  decisionsDone: number | null
  decisionsTotal: number | null
}

export type ClientJourney = {
  steps: JourneyStep[]
  blocking: JourneyStep[]
  next: JourneyStep | null
  health: JourneyHealth
}

type Computed = { status: JourneyStatus; date: string | null; evidence: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

function toTime(value: string | null | undefined): number | null {
  if (!value) return null
  // Bare dates (YYYY-MM-DD) are calendar days; read them at UTC midnight.
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value)
  return Number.isFinite(t) ? t : null
}

function daysBetween(from: string | null | undefined, now: Date): number | null {
  const t = toTime(from)
  if (t == null) return null
  return Math.floor((now.getTime() - t) / DAY_MS)
}

function earliest(values: (string | null | undefined)[]): string | null {
  let best: string | null = null
  let bestT = Infinity
  for (const v of values) {
    const t = toTime(v)
    if (t != null && t < bestT) {
      bestT = t
      best = v as string
    }
  }
  return best
}

function latest(values: (string | null | undefined)[]): string | null {
  let best: string | null = null
  let bestT = -Infinity
  for (const v of values) {
    const t = toTime(v)
    if (t != null && t > bestT) {
      bestT = t
      best = v as string
    }
  }
  return best
}

function addDays(value: string, days: number): string {
  const t = toTime(value)
  if (t == null) return value
  return new Date(t + days * DAY_MS).toISOString().slice(0, 10)
}

export function formatJourneyDate(value: string | null | undefined): string {
  const t = toTime(value)
  if (t == null) return ""
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

const isActiveListing = (l: JourneyListingInput) => l.status !== "inactive"
const DECIDABLE_KINDS = new Set(["change", "owner_choice", "owner_task"])
const APPLIED = new Set(["applied", "verified"])

// ---------------------------------------------------------------------------
// Step rules
// ---------------------------------------------------------------------------

function agreementSigned(input: JourneyInput): Computed {
  const { client } = input
  if ((client.ghl_onboarding?.agreement_evidence ?? []).length > 0) {
    return {
      status: "done",
      date: client.onboarding_date,
      evidence: "Signed (GHL workflow verified)",
    }
  }
  if (client.onboarding_date) {
    return {
      status: "done",
      date: client.onboarding_date,
      evidence: "Contract start date on file (no GHL signature record)",
    }
  }
  return { status: "todo", date: null, evidence: "No signed agreement or contract date in the Hub" }
}

function discoveryCall(signed: Computed): Computed {
  if (signed.status === "done") {
    return {
      status: "done",
      date: null,
      evidence: "Implied by the signed agreement (calls are tracked in GHL)",
    }
  }
  return { status: "todo", date: null, evidence: "No call record in the Hub (calls are tracked in GHL)" }
}

function paymentPortal(input: JourneyInput): Computed {
  if (input.client.assembly_client_id) {
    return { status: "done", date: null, evidence: "Assembly portal linked" }
  }
  return { status: "todo", date: null, evidence: "No Assembly portal linked yet" }
}

function onboardingCall(input: JourneyInput, setup: Computed): Computed {
  const appt = input.client.ghl_onboarding?.appointment
  if (!appt?.start) {
    // Clients from before the GHL booking flow have no appointment on file.
    if (setup.status === "done") {
      return { status: "done", date: null, evidence: "Implied by the finished setup (no GHL booking on file)" }
    }
    return { status: "todo", date: null, evidence: "No onboarding call booked in GHL" }
  }
  const status = (appt.status ?? "").toLowerCase()
  const start = toTime(appt.start)
  if (status === "cancelled" || status === "noshow" || status === "no_show" || status === "invalid") {
    return {
      status: "blocked",
      date: appt.start,
      evidence: `Call ${status === "cancelled" ? "cancelled" : "missed"} in GHL — rebook it`,
    }
  }
  if (status === "showed" || (start != null && start <= input.now.getTime())) {
    return { status: "done", date: appt.start, evidence: `Held (GHL status: ${status || "unknown"})` }
  }
  return { status: "todo", date: appt.start, evidence: "Booked in GHL" }
}

function publishedReports(input: JourneyInput): JourneyReportInput[] {
  return (input.reports ?? []).filter((r) => r.published_at && r.status !== "archived")
}

function auditPublished(input: JourneyInput): Computed {
  if (input.reports == null) {
    return { status: "todo", date: null, evidence: "Listing reviews are not visible to you" }
  }
  const published = publishedReports(input)
  if (published.length > 0) {
    const active = input.listings.filter(isActiveListing)
    const covered = new Set(published.map((r) => r.listing_id).filter(Boolean))
    const coverage =
      active.length > 0
        ? ` · covers ${active.filter((l) => covered.has(l.id)).length} of ${plural(active.length, "listing")}`
        : ""
    return {
      status: "done",
      date: earliest(published.map((r) => r.published_at)),
      evidence: `${plural(published.length, "review")} published${coverage}`,
    }
  }
  const drafts = input.reports.filter((r) => r.status === "draft").length
  return {
    status: "todo",
    date: null,
    evidence: drafts > 0 ? `${plural(drafts, "draft")} in progress, nothing published` : "No listing review yet",
  }
}

function auditSent(input: JourneyInput): Computed {
  if (input.reports == null) {
    return { status: "todo", date: null, evidence: "Listing reviews are not visible to you" }
  }
  const published = publishedReports(input)
  const sent = published.filter((r) => r.owner_message_sent_at)
  if (sent.length > 0) {
    return {
      status: "done",
      date: earliest(sent.map((r) => r.owner_message_sent_at)),
      evidence: `Sent to the owner's Assembly chat${published.length > 1 ? ` (${sent.length} of ${published.length} reviews)` : ""}`,
    }
  }
  return {
    status: "todo",
    date: null,
    evidence: published.length > 0 ? "Published, not sent to the owner yet" : "Nothing published to send",
  }
}

function decisionCounts(input: JourneyInput): { done: number; total: number } | null {
  if (input.items == null || input.reports == null) return null
  const published = new Set(publishedReports(input).map((r) => r.id))
  const decidable = input.items.filter((i) => published.has(i.report_id) && DECIDABLE_KINDS.has(i.kind))
  return {
    done: decidable.filter((i) => i.client_status !== "pending").length,
    total: decidable.length,
  }
}

function ownerDecided(input: JourneyInput, sent: Computed): Computed {
  if (input.decisionEvents == null) {
    return { status: "todo", date: null, evidence: "Listing reviews are not visible to you" }
  }
  const counts = decisionCounts(input)
  const tally = counts && counts.total > 0 ? ` · ${counts.done} of ${counts.total} suggestions decided` : ""
  if (input.decisionEvents.length > 0) {
    return {
      status: "done",
      date: earliest(input.decisionEvents.map((e) => e.created_at)),
      evidence: `Owner decided in the portal${tally}`,
    }
  }
  if (sent.status === "done") {
    const days = daysBetween(sent.date, input.now) ?? 0
    if (days >= OWNER_DECISION_STALL_DAYS) {
      return {
        status: "blocked",
        date: sent.date,
        evidence: `Sent ${plural(days, "day")} ago, no owner decision yet`,
      }
    }
    return { status: "todo", date: null, evidence: "Waiting on the owner (the Hub can't see opens, only decisions)" }
  }
  return { status: "todo", date: null, evidence: "Audit not sent yet" }
}

function accessVerified(input: JourneyInput): Computed {
  const active = input.listings.filter(isActiveListing)
  const pms = input.client.pms_name ? `PMS: ${input.client.pms_name}` : "PMS not recorded"
  if (active.length === 0) {
    return { status: "todo", date: null, evidence: `No active listings yet · ${pms}` }
  }
  const missingId = active.filter((l) => !l.listing_id).length
  if (missingId > 0) {
    return {
      status: "blocked",
      date: null,
      evidence: `${plural(missingId, "listing")} without a PriceLabs ID · ${pms}`,
    }
  }
  const synced = active.filter((l) => l.pl_synced_at).length
  if (synced === active.length) {
    return { status: "done", date: null, evidence: `${synced}/${active.length} listings syncing from PriceLabs · ${pms}` }
  }
  if (synced > 0) {
    return { status: "next", date: null, evidence: `${synced} of ${active.length} listings syncing from PriceLabs · ${pms}` }
  }
  return { status: "todo", date: null, evidence: `No listing has synced from PriceLabs yet · ${pms}` }
}

function pricingPlanApproved(input: JourneyInput): Computed {
  if (input.pricingPlans == null) {
    return { status: "todo", date: null, evidence: "Saved pricing plans aren't in the Hub yet" }
  }
  const active = input.listings.filter(isActiveListing)
  const approved = input.pricingPlans.filter((p) => p.status === "approved")
  const approvedListings = new Set(approved.map((p) => p.listing_id))
  const covered = active.filter((l) => approvedListings.has(l.id)).length
  const total = active.length
  if (approved.length > 0 && (total === 0 || covered === total)) {
    return {
      status: "done",
      date: latest(approved.map((p) => p.approved_at)),
      evidence: total > 0 ? `${covered}/${total} listings have an approved plan` : "Plan approved",
    }
  }
  if (covered > 0) {
    return { status: "next", date: null, evidence: `${covered} of ${total} listings have an approved plan` }
  }
  return { status: "todo", date: null, evidence: "No approved pricing plan" }
}

function setupApplied(input: JourneyInput): Computed {
  const rows = input.setupAdjustments
  if (rows == null) {
    return { status: "todo", date: null, evidence: "Adjustments are not visible to you" }
  }
  if (rows.length === 0) {
    return { status: "todo", date: null, evidence: "No setup adjustment filed" }
  }
  const finished = rows.filter((r) => r.status === "resolved" || r.status === "controlled")
  const issues = rows.filter((r) => r.status === "issue").length
  const open = rows.filter((r) => ["open", "in_progress", "needs_info", "issue"].includes(r.status))
  if (issues > 0) {
    return { status: "blocked", date: null, evidence: `${plural(issues, "setup adjustment")} flagged with an issue` }
  }
  if (finished.length > 0 && open.length === 0) {
    const controlled = finished.filter((r) => r.status === "controlled").length
    return {
      status: "done",
      date: earliest(finished.map((r) => r.resolved_at ?? r.controlled_at)),
      evidence: `${plural(finished.length, "setup adjustment")} resolved${controlled > 0 ? `, ${controlled} controlled` : ""}`,
    }
  }
  if (open.length > 0) {
    return {
      status: "next",
      date: null,
      evidence: `${finished.length} done, ${open.length} open (oldest from ${formatJourneyDate(earliest(open.map((r) => r.created_at)))})`,
    }
  }
  return { status: "todo", date: null, evidence: "Setup adjustment rejected — file a new one" }
}

function ownerAcceptsChanges(input: JourneyInput): Computed {
  if (input.items == null || input.reports == null) {
    return { status: "todo", date: null, evidence: "Listing reviews are not visible to you" }
  }
  const published = new Set(publishedReports(input).map((r) => r.id))
  const items = input.items.filter((i) => published.has(i.report_id) && DECIDABLE_KINDS.has(i.kind))
  const accepted = items.filter((i) => i.client_status === "accepted")
  const declined = items.filter((i) => i.client_status === "declined").length
  const waiting = accepted.filter((i) => !APPLIED.has(i.apply_status) && i.apply_status !== "skipped").length
  if (accepted.length === 0) {
    return {
      status: "todo",
      date: null,
      evidence: declined > 0 ? `Owner declined ${plural(declined, "suggestion")}, none accepted` : "No accepted changes yet",
    }
  }
  if (waiting > 0) {
    return { status: "next", date: null, evidence: `${accepted.length} accepted, ${waiting} waiting to be applied` }
  }
  return { status: "done", date: null, evidence: `${accepted.length} accepted changes applied${declined ? `, ${declined} declined` : ""}` }
}

function checkpoint(anchor: string | null, days: number, now: Date, what: string): Computed {
  if (!anchor) return { status: "todo", date: null, evidence: `Due ${days} days after launch (no launch date yet)` }
  const due = addDays(anchor, days)
  const reached = (toTime(due) ?? Infinity) <= now.getTime()
  return {
    status: reached ? "next" : "todo",
    date: due,
    evidence: reached ? `Due — mark done after the ${what}` : `Due ${days} days after launch`,
  }
}

function renewal(input: JourneyInput): Computed {
  const { client } = input
  if (client.status === "inactive") {
    return {
      status: "todo",
      date: client.ending_date,
      evidence: client.ending_date ? "Client ended" : "Client inactive",
    }
  }
  if (client.ending_date) {
    return { status: "todo", date: client.ending_date, evidence: "Contract end date on file" }
  }
  return { status: "todo", date: null, evidence: "Mark done when the client renews" }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function computeClientJourney(input: JourneyInput): ClientJourney {
  const signed = agreementSigned(input)
  const sent = auditSent(input)
  const setup = setupApplied(input)
  const call = onboardingCall(input, setup)

  // Launch anchor for the 90-day checkpoints: setup applied, else the
  // onboarding call, else the contract start.
  const anchor =
    (setup.status === "done" ? setup.date : null) ??
    (call.status === "done" ? call.date : null) ??
    input.client.onboarding_date

  const computed: Record<JourneyStepKey, Computed> = {
    discovery_call: discoveryCall(signed),
    agreement_signed: signed,
    payment_portal: paymentPortal(input),
    onboarding_call: call,
    audit_published: auditPublished(input),
    audit_sent: sent,
    owner_decided: ownerDecided(input, sent),
    access_verified: accessVerified(input),
    pricing_plan_approved: pricingPlanApproved(input),
    setup_applied: setup,
    launch_report_sent: { status: "todo", date: null, evidence: "Mark done when the launch report is sent" },
    owner_accepts_changes: ownerAcceptsChanges(input),
    day_14_pickup: checkpoint(anchor, 14, input.now, "pickup check"),
    day_30_review: checkpoint(anchor, 30, input.now, "review call"),
    day_60_90_checkins: checkpoint(anchor, 60, input.now, "check-ins"),
    monthly_reports: { status: "todo", date: null, evidence: "Mark done once monthly reports are going out" },
    renewal: renewal(input),
  }

  const overrides = new Map<string, JourneyOverrideInput>()
  for (const o of input.overrides) {
    if (isJourneyStepKey(o.step_key) && isJourneyStatus(o.status)) overrides.set(o.step_key, o)
  }

  const steps: JourneyStep[] = CLIENT_JOURNEY_STEPS.map((def) => {
    const c = computed[def.key]
    const o = overrides.get(def.key)
    return {
      key: def.key,
      phase: def.phase,
      label: def.label,
      auto: def.auto,
      status: o ? (o.status as JourneyStatus) : c.status,
      computedStatus: c.status,
      date: o ? (o.done_at ?? c.date) : c.date,
      evidence: c.evidence,
      overridden: Boolean(o),
      note: o?.note ?? null,
    }
  })

  // The first step that is neither done nor blocked is what the team works on
  // next, even if the data alone only says "to do".
  const firstOpen = steps.find((s) => s.status !== "done" && s.status !== "blocked")
  if (firstOpen && firstOpen.status === "todo" && !firstOpen.overridden) firstOpen.status = "next"

  const counts = decisionCounts(input)
  return {
    steps,
    blocking: steps.filter((s) => s.status === "blocked"),
    next: steps.find((s) => s.status === "next") ?? null,
    health: {
      daysSinceSigning: signed.status === "done" ? daysBetween(signed.date, input.now) : null,
      openTickets: input.openTickets,
      decisionsDone: counts?.done ?? null,
      decisionsTotal: counts?.total ?? null,
    },
  }
}
