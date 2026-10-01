// Support tickets — shared constants, types, and pure rules. Safe for client
// and server components. Every client ask becomes a ticket first; some spawn an
// Adjustment as a second step. Schema: supabase/migrations/20260929160000_support_tickets.sql.
// Design decisions: docs/support/grok-review-decisions.md.

import { z } from "zod"

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

// Category drives routing, the default owner, and the Adjustment suggestion.
// Request type drives what "done" means. Don't argue categories at
// verification — the request type is what gets checked.
export const SUPPORT_CATEGORIES = [
  {
    value: "pricing",
    label: "Pricing",
    description: "Nightly rates, base/min price, discounts, promotions, fee markups",
  },
  {
    value: "stay_rules",
    label: "Stay rules",
    description: "Minimum stay, check-in/out days, gap and orphan nights, booking window",
  },
  { value: "availability", label: "Calendar", description: "Blocking or unblocking dates" },
  {
    value: "listing_setup",
    label: "Listing & channels",
    description: "OTA/PMS sync, cleaning fees, cancellation policy, amenities, VRBO/Airbnb settings",
  },
  {
    value: "performance",
    label: "Performance",
    description: "Occupancy, revenue, pacing, projections, comparable listings",
  },
  {
    value: "reporting",
    label: "Reports & dashboards",
    description: "Reports, dashboards, promised touchpoints",
  },
  { value: "billing", label: "Billing", description: "Charges, invoices, cards, subscriptions" },
  {
    value: "onboarding",
    label: "Onboarding & access",
    description: "Setup, credentials, portal/PriceLabs access, adding properties",
  },
  {
    value: "offboarding",
    label: "Offboarding",
    description: "Termination, PriceLabs/PMS transfers, final charges, removing properties",
  },
  { value: "other", label: "Other", description: "Anything else" },
] as const

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]["value"]
export const SUPPORT_CATEGORY_VALUES = SUPPORT_CATEGORIES.map((c) => c.value) as [
  SupportCategory,
  ...SupportCategory[],
]

export const SUPPORT_REQUEST_TYPES = [
  {
    value: "question",
    label: "Question",
    doneWhen: "A specific answer to the exact question, about the right property and period",
    classifyWhen: "The client wants information",
  },
  {
    value: "change",
    label: "Change request",
    doneWhen: "The change is applied, verified, and the client is told it is live",
    classifyWhen: "The client wants something changed or set up",
  },
  {
    value: "decision",
    label: "Decision",
    doneWhen: "An explicit yes/no or recommendation the client can act on",
    classifyWhen: 'The client wants us to choose or recommend ("should we…", "yes or no")',
  },
  {
    value: "issue",
    label: "Issue",
    doneWhen: "The problem is fixed and checked, with the cause explained",
    classifyWhen: "Something is broken or behaving unexpectedly",
  },
] as const

export type SupportRequestType = (typeof SUPPORT_REQUEST_TYPES)[number]["value"]
export const SUPPORT_REQUEST_TYPE_VALUES = SUPPORT_REQUEST_TYPES.map((t) => t.value) as [
  SupportRequestType,
  ...SupportRequestType[],
]

export const SUPPORT_STATUSES = [
  "new",
  "open",
  "in_progress",
  "awaiting_client",
  "answered",
  "resolved",
  "dismissed",
] as const
export type SupportStatus = (typeof SUPPORT_STATUSES)[number]

export const SUPPORT_STATUS_LABEL: Record<SupportStatus, string> = {
  new: "Needs triage",
  open: "Open",
  in_progress: "In progress",
  awaiting_client: "Waiting on client",
  answered: "Answered — verify",
  resolved: "Resolved",
  dismissed: "Dismissed",
}

/** Statuses where the team still owes the client something. */
export const SUPPORT_ACTIVE_STATUSES: SupportStatus[] = [
  "new",
  "open",
  "in_progress",
  "awaiting_client",
  "answered",
]
export const SUPPORT_CLOSED_STATUSES: SupportStatus[] = ["resolved", "dismissed"]

/**
 * Statuses a user may pick directly. `answered` goes through "Record answer",
 * `resolved` through verification, and `dismissed` needs a reason.
 */
export const SUPPORT_MANUAL_STATUSES: SupportStatus[] = ["open", "in_progress", "awaiting_client"]

export const SUPPORT_PRIORITIES = ["low", "medium", "high", "urgent"] as const
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number]

export const SUPPORT_SENTIMENTS = ["neutral", "concerned", "unhappy"] as const
export type SupportSentiment = (typeof SUPPORT_SENTIMENTS)[number]

export const CLIENT_CHURN_RISKS = ["low", "medium", "high"] as const
export type ClientChurnRisk = (typeof CLIENT_CHURN_RISKS)[number]

export const SUPPORT_PROPERTY_SCOPES = [
  { value: "listings", label: "Specific properties" },
  { value: "portfolio", label: "Whole portfolio" },
  { value: "account", label: "Not property-specific" },
  { value: "unknown", label: "Not validated yet" },
] as const
export type SupportPropertyScope = (typeof SUPPORT_PROPERTY_SCOPES)[number]["value"]

export const SUPPORT_SOURCES = ["assembly", "email", "whatsapp", "call", "manual"] as const
export type SupportSource = (typeof SUPPORT_SOURCES)[number]
export type SupportCaptureSource = Exclude<SupportSource, "manual">

export const SUPPORT_SOURCE_LABEL: Record<SupportSource, string> = {
  assembly: "Assembly chat",
  email: "Email",
  whatsapp: "WhatsApp",
  call: "Call",
  manual: "Logged manually",
}

// Dismissals never count as misses; they are reported as their own counts.
export const SUPPORT_DISMISS_REASONS = [
  { value: "not_an_ask", label: "Not an ask", requiresNote: false },
  { value: "duplicate", label: "Duplicate", requiresNote: true },
  { value: "client_self_resolved", label: "Client resolved it", requiresNote: false },
  { value: "no_longer_needed", label: "No longer needed", requiresNote: false },
  { value: "handled_offline", label: "Handled on a call or by email", requiresNote: true },
] as const
export type SupportDismissReason = (typeof SUPPORT_DISMISS_REASONS)[number]["value"]
export const SUPPORT_DISMISS_REASON_VALUES = SUPPORT_DISMISS_REASONS.map((r) => r.value) as [
  SupportDismissReason,
  ...SupportDismissReason[],
]

export const SUPPORT_DUE_SOURCES = [
  "explicit",
  "relative",
  "default_vague",
  "default_concrete",
  "manual",
] as const
export type SupportDueSource = (typeof SUPPORT_DUE_SOURCES)[number]

// ---------------------------------------------------------------------------
// Clocks and thresholds (clock hours incl. nights/weekends — the audit basis)
// ---------------------------------------------------------------------------

/** A client message with no team reply for this long is overdue. */
export const SUPPORT_REPLY_SLA_HOURS = 24
/** "We'll review / reviewing" with no date. The phrasing behind most misses. */
export const SUPPORT_VAGUE_PROMISE_HOURS = 24
/** A named deliverable with no date ("we'll send the comps"). */
export const SUPPORT_CONCRETE_PROMISE_HOURS = 48
/** Promises due within this window are flagged "due soon". */
export const SUPPORT_DUE_SOON_HOURS = 24
/** A controlled change the client hasn't been told about is overdue after this. */
export const SUPPORT_TELL_LIVE_HOURS = 24
/** Below this request-type confidence a captured ask goes to triage. */
export const SUPPORT_TRIAGE_CONFIDENCE = 0.8
/** Triage items older than this surface in the daily digest. */
export const SUPPORT_STALE_TRIAGE_HOURS = 12
/** A second client message within this window of an unanswered one is a continuation, not a chase. */
export const SUPPORT_CONTINUATION_MINUTES = 120
/** Longest client excerpt the capture API accepts; the message ID links to the rest. */
export const SUPPORT_CAPTURE_EXCERPT_MAX = 1500

const HOUR_MS = 3_600_000

// ---------------------------------------------------------------------------
// Badges (import these — don't redeclare)
// ---------------------------------------------------------------------------

export const SUPPORT_STATUS_BADGE: Record<SupportStatus, string> = {
  new: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  open: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  in_progress: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  awaiting_client: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  answered: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  resolved: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  dismissed: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
}

export const SUPPORT_PRIORITY_BADGE: Record<SupportPriority, string> = {
  urgent: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  medium: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  low: "bg-zinc-50 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400",
}

export const SUPPORT_SENTIMENT_BADGE: Record<SupportSentiment, string> = {
  unhappy: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  concerned: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  neutral: "",
}

export type SupportAnswerVerdict = "pass" | "fail" | "uncertain"

export const SUPPORT_VERDICT_BADGE: Record<SupportAnswerVerdict, string> = {
  pass: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  fail: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  uncertain: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Whether a team reply used the ticket's draft: as written, in part, or not at all. */
export const SUPPORT_DRAFT_USAGE = ["yes", "partly", "no"] as const
export type SupportDraftUsage = (typeof SUPPORT_DRAFT_USAGE)[number]

export const SUPPORT_DRAFT_USAGE_LABEL: Record<SupportDraftUsage, string> = {
  yes: "used the draft",
  partly: "partly used the draft",
  no: "didn't use the draft",
}

export type SupportCommitmentStatus = "open" | "kept" | "cancelled"

export type SupportTicketCommitment = {
  id: string
  ticket_id: string
  description: string
  /** Original due date — never moves. */
  due_at: string
  due_source: SupportDueSource
  rescheduled_to: string | null
  status: SupportCommitmentStatus
  made_by_name: string | null
  made_at: string
  source: "bot" | "manual"
  closed_at: string | null
  close_note: string | null
  created_at: string
}

/** A promise as the capture boundary sees it (includes its idempotency key). */
export type CaptureCommitment = SupportTicketCommitment & { external_key: string | null }

export type SupportTicketListing = {
  listing_id: string
  listings: { id: string; name: string } | null
}

export type SupportLinkedAdjustment = {
  id: string
  type: string
  status: string
  target_value: string | null
  controlled_at: string | null
  listings: { name: string } | null
}

/** The capture bot's draft reply (contract v1.3). A person edits and sends it. */
export type SupportSuggestedReply = {
  text: string
  /** What the draft drew on ("PriceLabs: Dec occupancy vs market"), for the reader */
  basis: string[]
  skill: string | null
  prompt_version: string | null
  generated_at: string
}

export type SupportTicket = {
  id: string
  ticket_number: number
  client_id: string
  property_scope: SupportPropertyScope
  property_validated_at: string | null
  category: SupportCategory
  request_type: SupportRequestType
  summary: string
  client_message: string | null
  requested_by_name: string | null
  requested_at: string
  time_window: string | null
  source: SupportSource
  source_message_id: string | null
  external_key: string | null
  needs_attachment_review: boolean
  status: SupportStatus
  priority: SupportPriority
  priority_source: "rule" | "manual"
  client_sentiment: SupportSentiment
  money_at_stake: boolean
  /** Client is hand-managed: captured and logged, but no automatic status, priority, or owner change. */
  hand_managed: boolean
  assignee_id: string | null
  possible_duplicate_of: string | null
  merged_into: string | null
  first_response_at: string | null
  last_client_message_at: string | null
  last_team_message_at: string | null
  sla_anchor_at: string | null
  client_chase_count: number
  client_nudge_count: number
  answer_summary: string | null
  answered_at: string | null
  answer_check_verdict: SupportAnswerVerdict | null
  answer_check_asked: string | null
  answer_check_replied: string | null
  answer_check_gap: string | null
  answer_check_at: string | null
  client_told_live_at: string | null
  client_acknowledged_at: string | null
  verification: Record<string, unknown>
  resolved_at: string | null
  dismiss_reason: SupportDismissReason | null
  dismiss_note: string | null
  backfilled: boolean
  backfill_batch: string | null
  ai_classification: Record<string, unknown>
  /** Capture-bot draft reply (detail page only; the queue reads the timestamp) */
  suggested_reply?: SupportSuggestedReply | null
  suggested_reply_generated_at?: string | null
  created_at: string
  updated_at: string
  // Joined
  clients?: { id: string; name: string } | null
  assignee?: { full_name: string | null; email: string } | null
  support_ticket_listings?: SupportTicketListing[]
  support_ticket_commitments?: SupportTicketCommitment[]
  adjustments?: SupportLinkedAdjustment[]
}

export type SupportTicketEvent = {
  id: string
  ticket_id: string
  event_type: string
  actor_id: string | null
  actor_label: string | null
  body: string | null
  payload: Record<string, unknown>
  occurred_at: string
  actor?: { full_name: string | null; email: string } | null
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export function supportCategoryLabel(value: string): string {
  return SUPPORT_CATEGORIES.find((c) => c.value === value)?.label ?? value
}

export function supportRequestTypeLabel(value: string): string {
  return SUPPORT_REQUEST_TYPES.find((t) => t.value === value)?.label ?? value
}

export function supportRequestTypeDoneWhen(value: string): string {
  return SUPPORT_REQUEST_TYPES.find((t) => t.value === value)?.doneWhen ?? ""
}

export function supportStatusLabel(value: SupportStatus): string {
  return SUPPORT_STATUS_LABEL[value] ?? value
}

export function supportPropertyScopeLabel(value: string): string {
  return SUPPORT_PROPERTY_SCOPES.find((s) => s.value === value)?.label ?? value
}

export function supportDismissReasonLabel(value: string): string {
  return SUPPORT_DISMISS_REASONS.find((r) => r.value === value)?.label ?? value
}

export function ticketRef(ticketNumber: number): string {
  return `#${ticketNumber}`
}

export function supportTicketPath(id: string): string {
  return `/support/${id}`
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function ms(value: string | null | undefined): number | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : t
}

function maxMs(...values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null)
  return present.length ? Math.max(...present) : null
}

// ---------------------------------------------------------------------------
// Promises
// ---------------------------------------------------------------------------

export function openCommitments(
  commitments: SupportTicketCommitment[] | undefined
): SupportTicketCommitment[] {
  return (commitments ?? []).filter((c) => c.status === "open")
}

/** The working due date: the reschedule if any, else the original. */
export function effectiveDueAt(
  commitment: Pick<SupportTicketCommitment, "due_at" | "rescheduled_to">
): string {
  return commitment.rescheduled_to ?? commitment.due_at
}

/** Default due date for a promise made without one. */
export function defaultPromiseDueAt(
  kind: "default_vague" | "default_concrete",
  madeAt: Date = new Date()
): Date {
  const hours = kind === "default_vague" ? SUPPORT_VAGUE_PROMISE_HOURS : SUPPORT_CONCRETE_PROMISE_HOURS
  return new Date(madeAt.getTime() + hours * HOUR_MS)
}

export type CommitmentTiming = "open" | "overdue" | "kept_on_time" | "kept_late" | "cancelled"

/**
 * Operational state uses the working (rescheduled) date; kept on time vs late
 * is always judged against the ORIGINAL due date, so rescheduling never hides
 * a broken promise.
 */
export function commitmentTiming(
  commitment: Pick<SupportTicketCommitment, "status" | "due_at" | "rescheduled_to" | "closed_at">,
  now: Date = new Date()
): CommitmentTiming {
  if (commitment.status === "cancelled") return "cancelled"
  if (commitment.status === "kept") {
    const due = ms(commitment.due_at) ?? 0
    const closed = ms(commitment.closed_at) ?? due
    return closed <= due ? "kept_on_time" : "kept_late"
  }
  return now.getTime() > (ms(effectiveDueAt(commitment)) ?? 0) ? "overdue" : "open"
}

/**
 * An open promise made before a linked Adjustment was controlled is probably
 * kept already — work done in PriceLabs rarely gets said in the chat. The
 * Hub shows "likely kept, confirm"; a person closes it, never the bot.
 */
export function promiseLikelyKept(
  commitment: Pick<SupportTicketCommitment, "status" | "made_at">,
  adjustments: Pick<SupportLinkedAdjustment, "status" | "controlled_at">[] | undefined
): boolean {
  if (commitment.status !== "open") return false
  const made = ms(commitment.made_at) ?? 0
  return (adjustments ?? []).some(
    (a) => a.status === "controlled" && (ms(a.controlled_at) ?? 0) >= made
  )
}

// ---------------------------------------------------------------------------
// Ball-in-court and next due
// ---------------------------------------------------------------------------

/** The client's latest message has no team reply after it. */
export function hasUnansweredClientMessage(
  ticket: Pick<SupportTicket, "last_client_message_at" | "last_team_message_at">
): boolean {
  const client = ms(ticket.last_client_message_at)
  if (client === null) return false
  const team = ms(ticket.last_team_message_at)
  return team === null || client > team
}

export type WaitingOn = "us" | "client" | "nobody"

export function waitingOn(ticket: Pick<SupportTicket, "status">): WaitingOn {
  if (ticket.status === "awaiting_client") return "client"
  if (SUPPORT_CLOSED_STATUSES.includes(ticket.status)) return "nobody"
  return "us"
}

type ChangeFields = Pick<SupportTicket, "request_type" | "client_told_live_at"> & {
  adjustments?: Pick<SupportLinkedAdjustment, "status" | "controlled_at">[]
}

/**
 * "Done, client not told": a change ticket whose linked Adjustments are all
 * closed with at least one controlled, but nobody told the client it's live.
 * Returns when telling them became overdue, or null.
 */
export function tellLiveDueAt(ticket: ChangeFields): Date | null {
  if (ticket.request_type !== "change" || ticket.client_told_live_at) return null
  const adjustments = ticket.adjustments ?? []
  if (!adjustments.length) return null
  if (adjustments.some((a) => a.status !== "controlled" && a.status !== "rejected")) return null
  const controlled = maxMs(
    ...adjustments.filter((a) => a.status === "controlled").map((a) => ms(a.controlled_at))
  )
  return controlled === null ? null : new Date(controlled + SUPPORT_TELL_LIVE_HOURS * HOUR_MS)
}

export function isDoneNotTold(ticket: ChangeFields): boolean {
  return tellLiveDueAt(ticket) !== null
}

type DueFields = Pick<
  SupportTicket,
  | "status"
  | "request_type"
  | "requested_at"
  | "last_client_message_at"
  | "last_team_message_at"
  | "sla_anchor_at"
  | "client_told_live_at"
> & {
  support_ticket_commitments?: SupportTicketCommitment[]
  adjustments?: Pick<SupportLinkedAdjustment, "status" | "controlled_at">[]
}

/**
 * When the client next needs to hear from us: the earliest of open promises
 * (working date), the reply SLA on an unanswered client message, and telling
 * the client a controlled change is live. Null when nothing is owed.
 * Verification speed is deliberately not a client clock.
 */
export function nextDueAt(ticket: DueFields): Date | null {
  if (SUPPORT_CLOSED_STATUSES.includes(ticket.status)) return null
  const candidates: number[] = []
  for (const c of openCommitments(ticket.support_ticket_commitments)) {
    const due = ms(effectiveDueAt(c))
    if (due !== null) candidates.push(due)
  }
  if (ticket.status !== "awaiting_client") {
    const lastClient = ms(ticket.last_client_message_at) ?? ms(ticket.requested_at)
    const lastTeam = ms(ticket.last_team_message_at)
    if (lastClient !== null && (lastTeam === null || lastClient > lastTeam)) {
      // Backfilled tickets start their clock at import, not the original ask
      const base = maxMs(lastClient, ms(ticket.sla_anchor_at)) ?? lastClient
      candidates.push(base + SUPPORT_REPLY_SLA_HOURS * HOUR_MS)
    }
  }
  const tellLive = tellLiveDueAt(ticket)
  if (tellLive) candidates.push(tellLive.getTime())
  return candidates.length ? new Date(Math.min(...candidates)) : null
}

export type DueState = "overdue" | "due_soon" | "ok" | "none"

export function dueState(due: Date | null, now: Date = new Date()): DueState {
  if (!due) return "none"
  const delta = due.getTime() - now.getTime()
  if (delta < 0) return "overdue"
  if (delta <= SUPPORT_DUE_SOON_HOURS * HOUR_MS) return "due_soon"
  return "ok"
}

/** "in 5h", "in 2d", "3h overdue", "2d overdue". */
export function relativeDueLabel(due: Date | null, now: Date = new Date()): string {
  if (!due) return "—"
  const delta = due.getTime() - now.getTime()
  const abs = Math.abs(delta)
  const unit =
    abs < 48 * HOUR_MS
      ? `${Math.max(1, Math.round(abs / HOUR_MS))}h`
      : `${Math.round(abs / (24 * HOUR_MS))}d`
  return delta < 0 ? `${unit} overdue` : `in ${unit}`
}

/** Hours an answered ticket has waited for verification (not a client clock). */
export function verifyAgeHours(
  ticket: Pick<SupportTicket, "status" | "answered_at">,
  now: Date = new Date()
): number | null {
  if (ticket.status !== "answered") return null
  const answered = ms(ticket.answered_at)
  return answered === null ? null : Math.max(0, (now.getTime() - answered) / HOUR_MS)
}

export function isStaleTriage(
  ticket: Pick<SupportTicket, "status" | "created_at">,
  now: Date = new Date()
): boolean {
  const created = ms(ticket.created_at)
  return (
    ticket.status === "new" &&
    created !== null &&
    now.getTime() - created > SUPPORT_STALE_TRIAGE_HOURS * HOUR_MS
  )
}

// ---------------------------------------------------------------------------
// Client follow-ups: chase vs nudge vs continuation
// ---------------------------------------------------------------------------

export type ClientMessageKind = "chase" | "nudge" | "continuation" | "reply"

export type ClientMessageEffect = {
  kind: ClientMessageKind
  chaseDelta: 0 | 1
  nudgeDelta: 0 | 1
}

/**
 * Classify a client message on an existing ticket, judged BEFORE it is applied.
 *
 * - reply: we were waiting on the client.
 * - chase: we already owed the next move — a promise past its working date,
 *   an unanswered client message older than the continuation window, or the
 *   team's last reply failed the answer check (the client had to ask again).
 * - continuation: a second message shortly after an unanswered one ("also…").
 * - nudge: a polite "any update?" before anything was due. The second nudge
 *   on a ticket also counts as a chase.
 */
export function classifyClientMessage(
  ticket: Pick<
    SupportTicket,
    "status" | "last_client_message_at" | "last_team_message_at" | "client_nudge_count"
  > & {
    support_ticket_commitments?: SupportTicketCommitment[]
    answer_check_verdict?: SupportAnswerVerdict | null
  },
  at: Date
): ClientMessageEffect {
  if (ticket.status === "awaiting_client") return { kind: "reply", chaseDelta: 0, nudgeDelta: 0 }

  const promiseOverdue = openCommitments(ticket.support_ticket_commitments).some(
    (c) => (ms(effectiveDueAt(c)) ?? Infinity) < at.getTime()
  )
  if (promiseOverdue) return { kind: "chase", chaseDelta: 1, nudgeDelta: 0 }
  if (ticket.answer_check_verdict === "fail" && ticket.status !== "answered")
    return { kind: "chase", chaseDelta: 1, nudgeDelta: 0 }

  if (hasUnansweredClientMessage(ticket)) {
    const waited = at.getTime() - (ms(ticket.last_client_message_at) ?? at.getTime())
    return waited > SUPPORT_CONTINUATION_MINUTES * 60_000
      ? { kind: "chase", chaseDelta: 1, nudgeDelta: 0 }
      : { kind: "continuation", chaseDelta: 0, nudgeDelta: 0 }
  }

  return {
    kind: "nudge",
    chaseDelta: ticket.client_nudge_count + 1 >= 2 ? 1 : 0,
    nudgeDelta: 1,
  }
}

// ---------------------------------------------------------------------------
// Priority (rules, not the bot's opinion; a person can pin it)
// ---------------------------------------------------------------------------

export function derivePriority(input: {
  sentiment: SupportSentiment
  churnRisk: ClientChurnRisk | null
  chaseCount: number
  category: SupportCategory
  moneyAtStake: boolean
  hasOverduePromise: boolean
}): SupportPriority {
  const moneyCategory = input.category === "billing" || input.category === "offboarding"
  if (
    (input.sentiment === "unhappy" && input.churnRisk === "high") ||
    input.chaseCount >= 3 ||
    (moneyCategory && input.moneyAtStake)
  )
    return "urgent"
  if (input.sentiment === "unhappy" || input.chaseCount >= 2 || input.hasOverduePromise)
    return "high"
  return "medium"
}

// ---------------------------------------------------------------------------
// Capture triage and routing
// ---------------------------------------------------------------------------

export type TriageDecision = { status: "new" | "open"; reasons: string[] }

/**
 * A captured ask opens directly only when the property is validated, the
 * request type is confident, it isn't a possible duplicate, and the ask isn't
 * hidden in an attachment. Low category confidence never blocks: category is
 * editable and doesn't change what "done" means.
 */
export function decideCapturedStatus(input: {
  propertyValidated: boolean
  requestTypeConfidence: number | null
  possibleDuplicate: boolean
  needsAttachmentReview: boolean
}): TriageDecision {
  const reasons: string[] = []
  if (!input.propertyValidated) reasons.push("property_not_validated")
  if (input.requestTypeConfidence === null || input.requestTypeConfidence < SUPPORT_TRIAGE_CONFIDENCE)
    reasons.push("low_request_type_confidence")
  if (input.possibleDuplicate) reasons.push("possible_duplicate")
  if (input.needsAttachmentReview) reasons.push("ask_in_attachment")
  return { status: reasons.length ? "new" : "open", reasons }
}

export type SupportRoutingRule = {
  category: SupportCategory | null
  request_type: SupportRequestType | null
  assignee_id: string
  rank: number
}

/**
 * Default owner: the most specific matching rule (category + type, then
 * category, then type, then catch-all), ties broken by rank.
 */
export function resolveDefaultAssignee(
  rules: SupportRoutingRule[],
  category: SupportCategory,
  requestType: SupportRequestType
): string | null {
  const specificity = (r: SupportRoutingRule) =>
    (r.category ? 2 : 0) + (r.request_type ? 1 : 0)
  const matching = rules
    .filter(
      (r) =>
        (r.category === null || r.category === category) &&
        (r.request_type === null || r.request_type === requestType)
    )
    .sort((a, b) => specificity(b) - specificity(a) || a.rank - b.rank)
  return matching[0]?.assignee_id ?? null
}

/**
 * Agreed default routing (2026-09-29). Roles, not people, so a hand-over only
 * changes who the role maps to:
 * - `changes`: pricing, stay rules, calendar, listing setup, onboarding (Andrés)
 * - `strategy`: performance, reports, and every decision outside money (Gastón)
 * - `money`: billing and offboarding, decisions included (Fede)
 * The category rule outranks a type-only rule, so decisions in change
 * categories need their own (category, decision) rows. Everything else falls
 * to `strategy`, who also owns triage, so nothing is left without an owner.
 */
export type SupportRoutingRole = "changes" | "strategy" | "money"

export const SUPPORT_DEFAULT_ROUTING: {
  category: SupportCategory | null
  request_type: SupportRequestType | null
  role: SupportRoutingRole
  rank: number
}[] = [
  ...(["pricing", "stay_rules", "availability", "listing_setup", "onboarding"] as const).map((category) => ({
    category,
    request_type: null,
    role: "changes" as const,
    rank: 10,
  })),
  ...(["pricing", "stay_rules", "availability", "listing_setup", "onboarding", "reporting", "other"] as const).map(
    (category) => ({ category, request_type: "decision" as const, role: "strategy" as const, rank: 10 })
  ),
  { category: "performance", request_type: null, role: "strategy", rank: 10 },
  { category: "reporting", request_type: null, role: "strategy", rank: 10 },
  { category: "billing", request_type: null, role: "money", rank: 10 },
  { category: "offboarding", request_type: null, role: "money", rank: 10 },
  { category: null, request_type: null, role: "strategy", rank: 1000 },
]

// ---------------------------------------------------------------------------
// Ask fingerprint (idempotency that survives re-wording)
// ---------------------------------------------------------------------------

// cyrb53: small, fast, deterministic 53-bit string hash. Not for security —
// only to derive a stable key from the fields that define an ask.
function cyrb53(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/** Stable short hash for idempotency keys (never for security). */
export function stableHash(text: string): string {
  return cyrb53(text.trim().toLowerCase().replace(/\s+/g, " ")).toString(36).padStart(11, "0")
}

export function normalizeTimeWindow(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase().replace(/\s+/g, "")
  return trimmed ? trimmed : null
}

/**
 * Derived from what the ask IS — request type, category, validated property
 * set (or scope), and period — never from the ask index or summary text, so a
 * re-run that splits or words the message differently still lands on the same
 * ticket.
 */
export function askFingerprint(input: {
  requestType: SupportRequestType
  category: SupportCategory
  propertyScope: SupportPropertyScope
  listingIds: string[]
  timeWindow: string | null
}): string {
  const property =
    input.propertyScope === "listings" && input.listingIds.length
      ? [...new Set(input.listingIds)].sort().join(",")
      : input.propertyScope
  const key = [
    input.requestType,
    input.category,
    property,
    normalizeTimeWindow(input.timeWindow) ?? "-",
  ].join("|")
  return cyrb53(key).toString(36).padStart(11, "0")
}

export function captureExternalKey(
  source: SupportCaptureSource,
  messageId: string,
  suffix: string
): string {
  return `${source}:${messageId}:${suffix}`
}

// ---------------------------------------------------------------------------
// Sensitive content. The capture bot redacts before sending; the server
// rejects anything that still looks like a credential and masks contact
// details as a second line of defense. Patterns favor precision: a false
// positive blocks a real ask from being captured.
// ---------------------------------------------------------------------------

const REDACTION_MARKER = /\[redacted[^\]]*\]/gi
const URL_PATTERN = /\bhttps?:\/\/\S+/gi

const CREDENTIAL_PATTERNS: { kind: string; pattern: RegExp }[] = [
  {
    kind: "password",
    pattern:
      /\b(?:password|passwd|pwd|pw|passcode|pin|contraseña|contrasena|clave)\s*[:=]\s*[^\s,;]{4,}/i,
  },
  {
    kind: "access code",
    pattern:
      /\b(?:door|lock|gate|garage|lockbox|keypad|entry|access)\s*(?:code|pin)\b\s*(?::|=|\bis\b|\bes\b)?\s*#?\d{3,8}\b/i,
  },
  // One-time login codes (VRBO/Expedia verification, 2FA) grant access too
  {
    kind: "one-time code",
    pattern:
      /\b(?:verification|security|one[- ]time|login|sign[- ]in|confirmation|2fa|mfa|otp)\s*(?:code|pin|passcode)\b[^0-9\n]{0,20}\d{4,8}\b/i,
  },
  {
    kind: "one-time code",
    pattern: /\bc[oó]digo\s+de\s+(?:verificaci[oó]n|seguridad|acceso)\b[^0-9\n]{0,20}\d{4,8}\b/i,
  },
  { kind: "api key", pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/ },
  { kind: "api key", pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { kind: "api key", pattern: /\brvf_live_[a-f0-9]{16,}/i },
  { kind: "bearer token", pattern: /\bbearer\s+[A-Za-z0-9._~+/-]{20,}=*/i },
  { kind: "token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { kind: "token", pattern: /\b[a-f0-9]{32,}\b/i },
]

function luhnValid(digits: string): boolean {
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

// Grouped 4-4-4-4(-3) card numbers, or bare 15–16 digit numbers starting 3–6.
// Bare Airbnb room IDs are 17–19 digits and start with 1, so they don't match.
const CARD_PATTERN = /\b(?:\d{4}[ -]){3}\d{3,4}\b|\b[3-6]\d{14,15}\b/g

/** The kind of credential found, or null. Ignores redaction markers and URLs. */
export function detectCredential(text: string | null | undefined): string | null {
  if (!text) return null
  const cleaned = text.replace(REDACTION_MARKER, " ").replace(URL_PATTERN, " ")
  for (const { kind, pattern } of CREDENTIAL_PATTERNS) {
    if (pattern.test(cleaned)) return kind
  }
  for (const match of cleaned.match(CARD_PATTERN) ?? []) {
    const digits = match.replace(/\D/g, "")
    if (digits.length >= 15 && luhnValid(digits)) return "card number"
  }
  return null
}

const EMAIL_PATTERN = /\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g
// Separated 3-3-4 groups (optionally +1): phone numbers, not dates or IDs
const PHONE_PATTERN = /(?<![\w-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-](\d{4})(?![\w-])/g

/** `jane@x.com` → `j***@x.com`; `(555) 201-4477` → `***-***-4477`. */
export function maskContactDetails(text: string): string {
  return text
    .replace(EMAIL_PATTERN, (_m, first: string, domain: string) => `${first}***@${domain}`)
    .replace(PHONE_PATTERN, (_m, last4: string) => `***-***-${last4}`)
}

// ---------------------------------------------------------------------------
// Verification gate (mirrors support_ticket_guard() in migration 20260929160000 — the
// database is the backstop, this is what the UI explains)
// ---------------------------------------------------------------------------

export const SUPPORT_VERIFICATION_CHECKS = [
  {
    key: "right_property",
    label: "The answer is about the property and period the client asked about",
  },
  {
    key: "answers_ask",
    label: "It answers the actual question — not adjacent stats or a different topic",
  },
  {
    key: "specific",
    label: 'It is specific: numbers, dates, a yes/no — not "we\'ll review"',
  },
  {
    key: "change_live",
    label: "The change is live and the client was told (change requests)",
    onlyFor: "change" as SupportRequestType,
  },
] as const

export type SupportVerificationKey = (typeof SUPPORT_VERIFICATION_CHECKS)[number]["key"]

export function verificationChecksFor(requestType: SupportRequestType) {
  return SUPPORT_VERIFICATION_CHECKS.filter((c) => !("onlyFor" in c) || c.onlyFor === requestType)
}

/** The verifier must explain why a flagged answer is still correct. */
export function overrideReasonRequired(
  ticket: Pick<SupportTicket, "answer_check_verdict">
): boolean {
  return ticket.answer_check_verdict === "fail" || ticket.answer_check_verdict === "uncertain"
}

const CLOSED_ADJUSTMENT_STATUSES = new Set(["controlled", "rejected"])

/** Reasons the ticket cannot be resolved yet (empty = ready). */
export function resolutionBlockers(
  ticket: Pick<
    SupportTicket,
    | "request_type"
    | "property_scope"
    | "property_validated_at"
    | "answered_at"
    | "client_told_live_at"
  > & {
    support_ticket_commitments?: SupportTicketCommitment[]
    adjustments?: Pick<SupportLinkedAdjustment, "status">[]
  }
): string[] {
  const blockers: string[] = []
  if (ticket.property_scope === "unknown" || !ticket.property_validated_at)
    blockers.push("Validate which property the ask is about")
  if (!ticket.answered_at) blockers.push("Record the answer given to the client")
  const open = openCommitments(ticket.support_ticket_commitments).length
  if (open > 0)
    blockers.push(`Close or cancel ${open === 1 ? "the open promise" : `${open} open promises`}`)
  if (ticket.request_type === "change") {
    const pending = (ticket.adjustments ?? []).filter(
      (a) => !CLOSED_ADJUSTMENT_STATUSES.has(a.status)
    ).length
    if (pending > 0)
      blockers.push(
        `${pending === 1 ? "A linked Adjustment is" : `${pending} linked Adjustments are`} not controlled yet`
      )
    if (!ticket.client_told_live_at) blockers.push("Tell the client the change is live")
  }
  return blockers
}

// ---------------------------------------------------------------------------
// Queue and header numbers
// ---------------------------------------------------------------------------

const PRIORITY_WEIGHT: Record<SupportPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
const SENTIMENT_WEIGHT: Record<SupportSentiment, number> = { unhappy: 0, concerned: 1, neutral: 2 }

export type SupportQueue = {
  triage: SupportTicket[]
  overdue: SupportTicket[]
  verify: SupportTicket[]
  onUs: SupportTicket[]
  onClient: SupportTicket[]
  closed: SupportTicket[]
}

/**
 * Exclusive buckets, first match wins: triage → overdue → verify → on us →
 * on client → closed. Overdue outranks everything but triage because a broken
 * promise is the failure the audit found most often; "done, client not told"
 * lands there too once it passes its window.
 */
export function bucketSupportTickets(
  tickets: SupportTicket[],
  now: Date = new Date()
): SupportQueue {
  const queue: SupportQueue = { triage: [], overdue: [], verify: [], onUs: [], onClient: [], closed: [] }
  for (const t of tickets) {
    if (SUPPORT_CLOSED_STATUSES.includes(t.status)) queue.closed.push(t)
    else if (t.status === "new") queue.triage.push(t)
    else if (dueState(nextDueAt(t), now) === "overdue") queue.overdue.push(t)
    else if (t.status === "answered") queue.verify.push(t)
    else if (t.status === "awaiting_client") queue.onClient.push(t)
    else queue.onUs.push(t)
  }

  const byUrgency = (a: SupportTicket, b: SupportTicket) =>
    PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority] ||
    SENTIMENT_WEIGHT[a.client_sentiment] - SENTIMENT_WEIGHT[b.client_sentiment] ||
    a.requested_at.localeCompare(b.requested_at)
  const byDue = (a: SupportTicket, b: SupportTicket) =>
    (nextDueAt(a)?.getTime() ?? Infinity) - (nextDueAt(b)?.getTime() ?? Infinity) || byUrgency(a, b)

  queue.triage.sort(byUrgency)
  queue.overdue.sort(byDue)
  queue.verify.sort((a, b) => (a.answered_at ?? "").localeCompare(b.answered_at ?? ""))
  queue.onUs.sort(byDue)
  queue.onClient.sort((a, b) => a.updated_at.localeCompare(b.updated_at))
  queue.closed.sort((a, b) =>
    (b.resolved_at ?? b.updated_at).localeCompare(a.resolved_at ?? a.updated_at)
  )
  return queue
}

export type SupportStats = {
  onUs: number
  overdue: number
  toVerify: number
  doneNotTold: number
  chasedOpen: number
  promisesClosed30d: number
  promisesOnTime30d: number
  /** null when no promise closed in the window */
  promiseOnTimeRate: number | null
  sentBack30d: number
  clientRejected30d: number
  backlogOpen: number
  backlogCleared: number
  dismissedSelfResolved30d: number
}

/**
 * Header numbers. Backfilled tickets stay out of the promise metrics (they
 * are reported as backlog open/cleared instead). `commitments` should hold
 * promises closed in the last 30 days, tagged with their ticket's backfill
 * flag; `eventCounts` are `verification_failed` / `client_rejected` events in
 * the same window.
 */
export function supportStats(
  tickets: SupportTicket[],
  commitments: (Pick<SupportTicketCommitment, "status" | "due_at" | "rescheduled_to" | "closed_at"> & {
    backfilled?: boolean
  })[],
  eventCounts: { sentBack30d: number; clientRejected30d: number },
  now: Date = new Date()
): SupportStats {
  const queue = bucketSupportTickets(tickets, now)
  const active = tickets.filter((t) => SUPPORT_ACTIVE_STATUSES.includes(t.status))
  const windowStart = now.getTime() - 30 * 24 * HOUR_MS

  let closed = 0
  let onTime = 0
  for (const c of commitments) {
    if (c.backfilled) continue
    const timing = commitmentTiming(c, now)
    if (timing !== "kept_on_time" && timing !== "kept_late") continue
    closed += 1
    if (timing === "kept_on_time") onTime += 1
  }

  return {
    onUs: queue.triage.length + queue.overdue.length + queue.onUs.length,
    overdue: queue.overdue.length,
    toVerify: queue.verify.length,
    doneNotTold: active.filter((t) => isDoneNotTold(t)).length,
    chasedOpen: active.filter((t) => t.client_chase_count > 0).length,
    promisesClosed30d: closed,
    promisesOnTime30d: onTime,
    promiseOnTimeRate: closed ? onTime / closed : null,
    sentBack30d: eventCounts.sentBack30d,
    clientRejected30d: eventCounts.clientRejected30d,
    backlogOpen: active.filter((t) => t.backfilled).length,
    backlogCleared: tickets.filter((t) => t.backfilled && t.status === "resolved").length,
    dismissedSelfResolved30d: tickets.filter(
      (t) =>
        t.status === "dismissed" &&
        t.dismiss_reason === "client_self_resolved" &&
        (ms(t.updated_at) ?? 0) >= windowStart
    ).length,
  }
}

// ---------------------------------------------------------------------------
// Adjustment hand-off and client confirmation
// ---------------------------------------------------------------------------

/** Suggested Adjustment type when a ticket spawns one (user can change it). */
export function suggestedAdjustmentType(category: SupportCategory): string {
  switch (category) {
    case "pricing":
      return "price"
    case "stay_rules":
      return "min_stay"
    case "availability":
      return "blocked_dates"
    case "listing_setup":
      return "markup_fees"
    case "performance":
      return "review"
    default:
      return "other"
  }
}

/** Categories whose asks usually become a PriceLabs change. */
export const SUPPORT_ADJUSTMENT_CATEGORIES: SupportCategory[] = [
  "pricing",
  "stay_rules",
  "availability",
  "listing_setup",
]

/**
 * Client-safe "this is now applied" message to paste into the chat. Only the
 * ticket summary and the recorded answer — never notes or internal text. The
 * reference lets the capture bot recognize it and emit `client_told_live`.
 */
export function buildClientConfirmation(
  ticket: Pick<
    SupportTicket,
    "ticket_number" | "summary" | "answer_summary" | "requested_at" | "requested_by_name"
  >
): string {
  const firstName = ticket.requested_by_name?.trim().split(/\s+/)[0]
  const date = new Date(ticket.requested_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  })
  const lines = [
    `Hi${firstName ? ` ${firstName}` : ""}, confirming your request from ${date}: ${ticket.summary}`,
  ]
  if (ticket.answer_summary?.trim()) lines.push(`✅ Now live: ${ticket.answer_summary.trim()}`)
  lines.push(`(Ref ${ticketRef(ticket.ticket_number)})`)
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Property matching (capture bot → Hub listings). Pure so it is testable; the
// ingest boundary passes only the ticket client's listings.
// ---------------------------------------------------------------------------

export type ListingRef = {
  hub_listing_id?: string
  pricelabs_listing_id?: string
  airbnb_id?: string
  name_hint?: string
}

export type MatchableListing = {
  id: string
  name: string
  listing_id: string | null
  airbnb_link: string | null
  /** Nicknames the client uses ("the Cabin"), learned in triage */
  aliases?: string[] | null
  status?: string | null
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

/** Internal listing names append state/owner after a pipe: "Cabin | TN | Ann". */
function publicPart(name: string): string {
  return normalizeName(name.split(/[|•]/)[0] ?? name)
}

/** Public listing label: the part before the internal state/owner suffix. */
export function publicListingName(name: string): string {
  return (name.split(/[|•]/)[0] ?? name).trim()
}

export function airbnbIdFromLink(link: string | null): string | null {
  const match = link?.match(/rooms\/(?:plus\/)?(\d{5,})/)
  return match?.[1] ?? null
}

export function matchListingRefs(
  listings: MatchableListing[],
  refs: ListingRef[]
): { matchedIds: string[]; unresolved: ListingRef[] } {
  const matched = new Set<string>()
  const unresolved: ListingRef[] = []

  for (const ref of refs) {
    let hit: MatchableListing | undefined
    if (ref.hub_listing_id) hit = listings.find((l) => l.id === ref.hub_listing_id)
    if (!hit && ref.pricelabs_listing_id) {
      const wanted = ref.pricelabs_listing_id.trim()
      hit = listings.find((l) => l.listing_id?.trim() === wanted)
    }
    if (!hit && ref.airbnb_id) {
      const wanted = ref.airbnb_id.replace(/\D/g, "")
      if (wanted)
        hit = listings.find(
          (l) => airbnbIdFromLink(l.airbnb_link) === wanted || l.listing_id?.trim() === wanted
        )
    }
    if (!hit && ref.name_hint) {
      const hint = normalizeName(ref.name_hint)
      if (hint) {
        const exact = listings.filter(
          (l) =>
            normalizeName(l.name) === hint ||
            publicPart(l.name) === hint ||
            (l.aliases ?? []).some((a) => normalizeName(a) === hint)
        )
        if (exact.length === 1) hit = exact[0]
        else if (exact.length === 0 && hint.length >= 4) {
          const partial = listings.filter((l) => publicPart(l.name).includes(hint))
          if (partial.length === 1) hit = partial[0]
        }
      }
    }
    if (hit) matched.add(hit.id)
    else unresolved.push(ref)
  }

  return { matchedIds: [...matched], unresolved }
}

// ---------------------------------------------------------------------------
// Capture-bot API contract: POST /api/v1/support-captures — one call per chat
// message. The Hub records the message in a ledger so it is split exactly
// once; a deliberate re-run sets `reprocess: true` and matches asks to the
// message's existing tickets by fingerprint instead of creating new ones.
// ---------------------------------------------------------------------------

const isoDateTime = z.iso.datetime({ offset: true })
const confidence = z.number().min(0).max(1)
const shortQuote = z.string().trim().min(1).max(500)
const eventBody = z.string().trim().max(SUPPORT_CAPTURE_EXCERPT_MAX)

const listingRefSchema = z
  .object({
    hub_listing_id: z.uuid().optional(),
    pricelabs_listing_id: z.string().trim().min(1).max(100).optional(),
    airbnb_id: z.string().trim().min(1).max(40).optional(),
    name_hint: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (r) => r.hub_listing_id || r.pricelabs_listing_id || r.airbnb_id || r.name_hint,
    "Each listing reference needs at least one identifier"
  )

const promiseInputSchema = z
  .object({
    description: z.string().trim().min(3).max(500),
    // Resolved by the bot in America/New_York (6 PM ET convention); omitted
    // for default_* sources and the server applies 24h / 48h
    due_at: isoDateTime.optional(),
    due_source: z.enum(["explicit", "relative", "default_vague", "default_concrete"]),
    made_by_name: z.string().trim().min(1).max(120).optional(),
  })
  .refine(
    (p) => (p.due_source === "explicit" || p.due_source === "relative" ? !!p.due_at : true),
    "explicit and relative promises need due_at"
  )

export const supportAskCandidateSchema = z.object({
  summary: z.string().trim().min(3).max(300),
  client_message: z.string().trim().max(SUPPORT_CAPTURE_EXCERPT_MAX).optional(),
  requested_by_name: z.string().trim().min(1).max(120).optional(),
  category: z.enum(SUPPORT_CATEGORY_VALUES),
  request_type: z.enum(SUPPORT_REQUEST_TYPE_VALUES),
  // Normalized period, e.g. "2027-07" or "2026-10-12/2026-10-14"
  time_window: z.string().trim().min(1).max(40).optional(),
  client_sentiment: z.enum(SUPPORT_SENTIMENTS).default("neutral"),
  money_at_stake: z.boolean().default(false),
  needs_attachment_review: z.boolean().default(false),
  property: z
    .object({
      scope: z.enum(["unknown", "listings", "portfolio", "account"]),
      listings: z.array(listingRefSchema).max(25).default([]),
    })
    .default({ scope: "unknown", listings: [] }),
  ai: z
    .object({
      confidence: z.object({
        category: confidence,
        request_type: confidence,
        sentiment: confidence.optional(),
      }),
      rationale: z.string().trim().max(1000).optional(),
    }),
  // Bot suspects this restates an active ticket (from the list endpoint)
  possible_duplicate_of: z.uuid().optional(),
  duplicate_note: z.string().trim().max(500).optional(),
  // Promises the team already made before the ticket existed
  commitments: z.array(promiseInputSchema).max(10).default([]),
  // Day-one import of the open-item recheck
  backfill: z
    .object({
      batch: z.string().trim().min(3).max(60),
      initial_status: z.enum(["open", "answered"]).default("open"),
      // For "said done, never confirmed" items imported as answered
      note: z.string().trim().max(1000).optional(),
    })
    .optional(),
})
export type SupportAskCandidate = z.infer<typeof supportAskCandidateSchema>

const answerCheckSchema = z.object({
  verdict: z.enum(["pass", "fail", "uncertain"]),
  asked: shortQuote,
  replied: shortQuote,
  gap: z.string().trim().max(500).optional(),
})

// Events on EXISTING tickets. The server derives each idempotency key from
// the message, the event type, and the ticket.
export const supportCaptureEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("client_message"),
    ticket_id: z.uuid(),
    body: eventBody.optional(),
    // A client message on a closed ticket reopens it only when asked to
    reopen: z.boolean().default(false),
  }),
  z.object({ type: z.literal("client_acknowledged"), ticket_id: z.uuid(), body: eventBody.optional() }),
  z.object({
    type: z.literal("client_rejected"),
    ticket_id: z.uuid(),
    body: eventBody.min(1),
  }),
  z.object({ type: z.literal("client_told_live"), ticket_id: z.uuid(), body: eventBody.optional() }),
  z.object({
    type: z.literal("team_reply"),
    ticket_id: z.uuid(),
    body: eventBody.optional(),
    answer_check: answerCheckSchema.optional(),
    // Only honored with a pass or uncertain check; never on fail. The bot
    // never resolves — a person verifies.
    proposes_answered: z.boolean().default(false),
    // How much of the ticket's draft reply the team sent (v1.4). Kept only
    // when the ticket had a draft before this reply.
    used_suggestion: z.enum(SUPPORT_DRAFT_USAGE).optional(),
  }),
  z.object({ type: z.literal("team_asked_client"), ticket_id: z.uuid(), body: eventBody.optional() }),
  z.object({
    type: z.literal("internal_note_from_chat"),
    ticket_id: z.uuid(),
    body: eventBody.min(1),
  }),
  z.object({ type: z.literal("commitment_made"), ticket_id: z.uuid(), commitment: promiseInputSchema }),
  z.object({ type: z.literal("commitment_kept"), ticket_id: z.uuid(), commitment_id: z.uuid() }),
  z.object({
    type: z.literal("commitment_rescheduled"),
    ticket_id: z.uuid(),
    commitment_id: z.uuid(),
    rescheduled_to: isoDateTime,
  }),
  z.object({
    type: z.literal("commitment_cancelled"),
    ticket_id: z.uuid(),
    commitment_id: z.uuid(),
    note: z.string().trim().min(3).max(500),
  }),
  z.object({
    type: z.literal("handoff"),
    ticket_id: z.uuid(),
    to_label: z.string().trim().min(1).max(120),
    body: eventBody.optional(),
  }),
])
export type SupportCaptureEvent = z.infer<typeof supportCaptureEventSchema>

export const supportCaptureSchema = z
  .object({
    source: z.enum(["assembly", "email", "whatsapp", "call"]).default("assembly"),
    source_message_id: z.string().trim().min(1).max(200),
    message_at: isoDateTime,
    author_role: z.enum(["client", "team", "internal"]),
    author_name: z.string().trim().min(1).max(120).optional(),
    client: z
      .object({
        hub_client_id: z.uuid().optional(),
        assembly_client_id: z.string().trim().min(1).max(100).optional(),
        assembly_company_id: z.string().trim().min(1).max(100).optional(),
      })
      .refine(
        (c) => c.hub_client_id || c.assembly_client_id || c.assembly_company_id,
        "client needs hub_client_id, assembly_client_id, or assembly_company_id"
      ),
    model: z.string().trim().max(100).optional(),
    prompt_version: z.string().trim().max(60).optional(),
    reprocess: z.boolean().default(false),
    // New asks in this message (client messages only)
    tickets: z.array(supportAskCandidateSchema).max(10).default([]),
    // Effects of this message on existing tickets
    events: z.array(supportCaptureEventSchema).max(20).default([]),
  })
  .refine((c) => c.author_role === "client" || c.tickets.length === 0, {
    message: "Only client messages create tickets",
    path: ["tickets"],
  })
export type SupportCapture = z.infer<typeof supportCaptureSchema>

/**
 * A failed answer check never moves a ticket to "answered". When money is at
 * stake (a charge after termination, a refund), only a clear pass does.
 */
export function honorsProposedAnswer(
  event: Extract<SupportCaptureEvent, { type: "team_reply" }>,
  ticket: { money_at_stake: boolean } = { money_at_stake: false }
): boolean {
  if (!event.proposes_answered) return false
  const verdict = event.answer_check?.verdict
  return ticket.money_at_stake ? verdict === "pass" : verdict !== "fail"
}

/** Lowest confidence among the fields that block auto-open (for display). */
export function overallCaptureConfidence(ai: SupportAskCandidate["ai"]): number {
  return ai.confidence.request_type
}

// ---------------------------------------------------------------------------
// Suggested replies (contract v1.3): drafts only, a person always sends
// ---------------------------------------------------------------------------

export const SUPPORT_SUGGESTED_REPLY_MAX = 4000

/** RevFactor's own fees and terminations: no drafts (financial data is super_admin only). */
export const SUPPORT_NO_DRAFT_CATEGORIES: SupportCategory[] = ["billing", "offboarding"]

export const supportSuggestedReplySchema = z.object({
  text: z.string().trim().min(1).max(SUPPORT_SUGGESTED_REPLY_MAX),
  basis: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  skill: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "skill must be a lowercase slug")
    .optional(),
  prompt_version: z.string().trim().min(1).max(60).optional(),
  generated_at: isoDateTime.optional(),
})

type DraftTicket = Pick<SupportTicket, "status" | "category" | "merged_into">

/**
 * Validate a draft from the bot and normalize it for storage: rejects closed
 * and no-draft tickets and credentials; masks emails and phone numbers.
 */
export function prepareSuggestedReply(
  raw: unknown,
  ticket: DraftTicket,
  now: Date = new Date()
):
  | { ok: true; value: SupportSuggestedReply }
  | { ok: false; status: 400 | 409 | 422; error: string; issues?: { path: string; message: string }[] } {
  const parsed = supportSuggestedReplySchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: "Invalid suggested reply",
      issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })),
    }
  }
  if (ticket.merged_into || SUPPORT_CLOSED_STATUSES.includes(ticket.status))
    return { ok: false, status: 409, error: "This ticket is closed; drafts only go on open tickets" }
  if (SUPPORT_NO_DRAFT_CATEGORIES.includes(ticket.category))
    return { ok: false, status: 422, error: `No drafts on ${ticket.category} tickets` }

  const draft = parsed.data
  const credential = [draft.text, ...draft.basis].map((t) => detectCredential(t)).find(Boolean)
  // Never echo the match back
  if (credential) return { ok: false, status: 422, error: `The draft looks like it contains a ${credential}` }

  const generated = draft.generated_at ? new Date(draft.generated_at) : now
  if (generated.getTime() > now.getTime() + 5 * 60_000)
    return { ok: false, status: 400, error: "generated_at is in the future" }

  return {
    ok: true,
    value: {
      text: maskContactDetails(draft.text),
      basis: draft.basis.map(maskContactDetails),
      skill: draft.skill ?? null,
      prompt_version: draft.prompt_version ?? null,
      generated_at: generated.toISOString(),
    },
  }
}

// "[date]", "[X]%", "[owner to fill]" — not markdown links "[text](url)"
const PLACEHOLDER_PATTERN = /\[[^\[\]\n]{1,80}\](?!\()/g

/** Bracketed gaps the owner must fill before sending (redaction markers excluded). */
export function unfilledPlaceholders(text: string | null | undefined): string[] {
  if (!text) return []
  const found = (text.match(PLACEHOLDER_PATTERN) ?? []).filter((m) => !/^\[redacted:/i.test(m))
  return [...new Set(found)]
}

export type DraftFreshness = "current" | "client_wrote_since" | "team_replied_since"

/**
 * Whether a draft still fits the conversation. A team reply after the draft
 * wins (the draft was used or superseded); a client message after it means
 * the draft may miss what they just said.
 */
export function suggestedReplyFreshness(
  generatedAt: string | null | undefined,
  ticket: Pick<SupportTicket, "last_client_message_at" | "last_team_message_at">
): DraftFreshness {
  const at = generatedAt ? Date.parse(generatedAt) : NaN
  if (Number.isNaN(at)) return "current"
  const team = ticket.last_team_message_at ? Date.parse(ticket.last_team_message_at) : NaN
  if (team > at) return "team_replied_since"
  const client = ticket.last_client_message_at ? Date.parse(ticket.last_client_message_at) : NaN
  if (client > at) return "client_wrote_since"
  return "current"
}

// ---------------------------------------------------------------------------
// Manual form input (Hub dialog → server action)
// ---------------------------------------------------------------------------

export const supportTicketFormSchema = z.object({
  client_id: z.uuid("Pick a client"),
  summary: z.string().trim().min(3, "Summarize the ask (3+ characters)").max(300),
  client_message: z.string().trim().max(2000).optional().default(""),
  requested_by_name: z.string().trim().max(120).optional().default(""),
  requested_at: z.string().trim().optional().default(""),
  time_window: z.string().trim().max(40).optional().default(""),
  source: z.enum(SUPPORT_SOURCES).default("manual"),
  category: z.enum(SUPPORT_CATEGORY_VALUES),
  request_type: z.enum(SUPPORT_REQUEST_TYPE_VALUES),
  client_sentiment: z.enum(SUPPORT_SENTIMENTS).default("neutral"),
  // Empty = derived by the priority rules
  priority: z.union([z.enum(SUPPORT_PRIORITIES), z.literal("")]).optional().default(""),
  money_at_stake: z.boolean().default(false),
  property_scope: z.enum(["unknown", "listings", "portfolio", "account"]),
  listing_ids: z.array(z.uuid()).max(50).default([]),
  assignee_id: z.union([z.uuid(), z.literal("")]).optional().default(""),
})
export type SupportTicketFormInput = z.input<typeof supportTicketFormSchema>

/** Normalize the dialog payload; the property must be concrete to be validated. */
export function validateSupportTicketForm(
  input: unknown
): { value: z.infer<typeof supportTicketFormSchema> } | { error: string } {
  const parsed = supportTicketFormSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid ticket" }
  const value = parsed.data
  if (value.property_scope === "listings" && value.listing_ids.length === 0)
    return { error: "Pick at least one property, or choose a different scope" }
  if (value.property_scope !== "listings") value.listing_ids = []
  if (value.requested_at && Number.isNaN(Date.parse(value.requested_at)))
    return { error: "Requested at must be a valid date" }
  const credential = detectCredential(value.client_message) ?? detectCredential(value.summary)
  if (credential)
    return { error: `Remove the ${credential} from the text before saving — never store credentials in tickets` }
  return { value }
}

export const supportDismissSchema = z
  .object({
    reason: z.enum(SUPPORT_DISMISS_REASON_VALUES),
    note: z.string().trim().max(1000).optional().default(""),
  })
  .refine(
    (d) =>
      !SUPPORT_DISMISS_REASONS.find((r) => r.value === d.reason)?.requiresNote || d.note.length > 0,
    { message: "Add a note for this reason", path: ["note"] }
  )
