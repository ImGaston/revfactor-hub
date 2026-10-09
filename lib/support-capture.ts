// Capture planner — turns one processed chat message (POST
// /api/v1/support-captures) into a write plan applied atomically by the
// `apply_support_capture` RPC. Pure: the server boundary loads the context
// (client, listings, ledger, referenced tickets, routing rules, profiles) and
// this module decides everything else, so every rule here is unit-testable.
//
// Idempotency: every ticket, promise, and event key is derived from the
// message ID plus what the item IS, never from its position. A message is
// written to the ledger only when every item in it succeeded; after an error
// the bot fixes the item and resends the same payload, and already-applied
// items come back as existing/duplicate.

import {
  askFingerprint,
  captureExternalKey,
  classifyClientMessage,
  commitmentTiming,
  decideCapturedStatus,
  defaultPromiseDueAt,
  derivePriority,
  detectCredential,
  honorsProposedAnswer,
  maskContactDetails,
  matchListingRefs,
  resolveDefaultAssignee,
  stableHash,
  SUPPORT_CLOSED_STATUSES,
  type CaptureCommitment,
  type ClientChurnRisk,
  type ListingRef,
  type MatchableListing,
  type SupportAskCandidate,
  type SupportCapture,
  type SupportCaptureEvent,
  type SupportCategory,
  type SupportPriority,
  type SupportRequestType,
  type SupportRoutingRule,
  type SupportSentiment,
  type SupportStatus,
} from "@/lib/support-tickets"

const HOUR_MS = 3_600_000
/** Backfilled clocks and promises start at import + 24h, never in the past. */
const BACKFILL_GRACE_HOURS = 24
const BOT_LABEL = "Capture bot"
const DEFAULT_BACKFILL_ANSWER =
  "Imported from the open-item recheck: the team said this was done, but it was never confirmed to the client."

// ---------------------------------------------------------------------------
// Context (loaded by the server boundary)
// ---------------------------------------------------------------------------

export type CaptureClient = {
  id: string
  support_capture: boolean
  support_hand_managed: boolean
  churn_risk: ClientChurnRisk | null
}

export type CaptureTicketSnapshot = {
  id: string
  client_id: string
  ticket_number: number
  status: SupportStatus
  category: SupportCategory
  request_type: SupportRequestType
  priority: SupportPriority
  priority_source: "rule" | "manual"
  client_sentiment: SupportSentiment
  money_at_stake: boolean
  hand_managed: boolean
  merged_into: string | null
  last_client_message_at: string | null
  last_team_message_at: string | null
  client_chase_count: number
  client_nudge_count: number
  answer_check_verdict: "pass" | "fail" | "uncertain" | null
  /** When the current draft reply was written (null or missing = none) */
  suggested_reply_generated_at?: string | null
  commitments: CaptureCommitment[]
}

export type CaptureProfile = { id: string; full_name: string | null; email: string }

export type CaptureContext = {
  capture: SupportCapture
  client: CaptureClient
  listings: MatchableListing[]
  /** The ledger already holds this message. */
  alreadyProcessed: boolean
  /** Tickets previously created from this same message (for reprocess). */
  messageTickets: { id: string; ask_fingerprint: string | null; request_type: SupportRequestType }[]
  /** Referenced tickets by id, including the targets of merged tickets. */
  tickets: Map<string, CaptureTicketSnapshot>
  /** Active tickets of this client a duplicate flag may point at. */
  activeTicketIds: Set<string>
  /**
   * The client's active tickets by ask fingerprint. A new ask whose
   * fingerprint is already open (e.g. restated in a message sent seconds
   * later) is flagged as a possible duplicate instead of opening twice.
   */
  activeFingerprints: Map<string, { id: string; external_key: string | null }>
  routingRules: SupportRoutingRule[]
  profiles: CaptureProfile[]
  now: Date
}

// ---------------------------------------------------------------------------
// Plan (consumed by apply_support_capture)
// ---------------------------------------------------------------------------

export type PlannedEventRow = {
  event_type: string
  external_key: string
  actor_label: string | null
  body: string | null
  payload: Record<string, unknown>
  occurred_at: string
}

export type PlannedCommitmentRow = {
  external_key: string
  description: string
  due_at: string
  due_source: string
  made_by_name: string | null
  made_at: string
}

export type PlannedTicket = {
  external_key: string
  row: Record<string, unknown>
  listing_ids: string[]
  commitments: PlannedCommitmentRow[]
  events: PlannedEventRow[]
}

export type TicketPatch = {
  status?: SupportStatus
  last_client_message_at?: string
  last_team_message_at?: string
  first_response_at?: string
  chase_delta?: number
  nudge_delta?: number
  answer_summary?: string
  answered_at?: string
  answer_check_verdict?: string
  answer_check_asked?: string
  answer_check_replied?: string
  answer_check_gap?: string | null
  answer_check_at?: string
  client_told_live_at?: string
  client_acknowledged_at?: string
  priority?: SupportPriority
  assignee_id?: string
}

export type CommitmentOp =
  | ({ op: "insert" } & PlannedCommitmentRow)
  | { op: "keep"; id: string; closed_at: string }
  | { op: "reschedule"; id: string; rescheduled_to: string }
  | { op: "cancel"; id: string; closed_at: string; close_note: string }

export type PlannedEvent = PlannedEventRow & {
  ticket_id: string
  patch: TicketPatch
  commitment?: CommitmentOp
}

export type CaptureLedger = {
  source: string
  source_message_id: string
  client_id: string
  author_role: string
  message_at: string
  outcome: "captured" | "no_ask" | "skipped_client_excluded"
  model: string | null
  prompt_version: string | null
  ask_count: number
  event_count: number
  reprocess: boolean
}

export type CapturePlan = {
  /** Null when an item errored: the message is not marked processed. */
  ledger: CaptureLedger | null
  tickets: PlannedTicket[]
  events: PlannedEvent[]
}

export type TicketItemResult = {
  index: number
  outcome: "planned" | "error"
  error?: string
  external_key?: string
  /** Same ask as an earlier candidate in this message. */
  same_as_index?: number
  status?: SupportStatus
  triage_reasons?: string[]
  property_validated?: boolean
  unresolved_listings?: ListingRef[]
  possible_duplicate_of?: string | null
  warnings?: string[]
}

export type EventItemResult = {
  index: number
  outcome: "planned" | "skipped" | "error"
  error?: string
  reason?: string
  external_key?: string
  ticket_id?: string
  redirected_from?: string
}

export type CapturePlanOutput =
  | { kind: "skipped"; outcome: "skipped_processed" }
  | {
      kind: "apply"
      outcome: "captured" | "no_ask" | "skipped_client_excluded" | "incomplete"
      plan: CapturePlan
      tickets: TicketItemResult[]
      events: EventItemResult[]
    }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clean(text: string | undefined | null): string | null {
  const trimmed = text?.trim()
  return trimmed ? maskContactDetails(trimmed) : null
}

function firstCredential(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    const found = detectCredential(text)
    if (found) return found
  }
  return null
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function promiseDueAt(
  promise: { due_at?: string; due_source: string },
  madeAt: Date
): string {
  if (promise.due_at) return new Date(promise.due_at).toISOString()
  return defaultPromiseDueAt(
    promise.due_source === "default_vague" ? "default_vague" : "default_concrete",
    madeAt
  ).toISOString()
}

/** Match a hand-off target to exactly one Hub profile by name, first name, or email. */
export function matchProfile(profiles: CaptureProfile[], label: string): CaptureProfile | null {
  const wanted = label.trim().toLowerCase()
  if (!wanted) return null
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
  const target = norm(wanted)
  const exact = profiles.filter(
    (p) =>
      norm(p.email) === target ||
      norm(p.email.split("@")[0] ?? "") === target ||
      (p.full_name && norm(p.full_name) === target)
  )
  if (exact.length === 1) return exact[0]
  const byFirst = profiles.filter(
    (p) => p.full_name && norm(p.full_name.split(/\s+/)[0] ?? "") === target
  )
  return byFirst.length === 1 ? byFirst[0] : null
}

const CLIENT_EVENTS = new Set(["client_message", "client_acknowledged", "client_rejected"])
const TEAM_EVENTS = new Set([
  "team_reply",
  "team_asked_client",
  "client_told_live",
  "commitment_made",
  "commitment_kept",
  "commitment_rescheduled",
  "commitment_cancelled",
  "handoff",
])

function roleAllows(role: SupportCapture["author_role"], type: string): boolean {
  if (CLIENT_EVENTS.has(type)) return role === "client"
  if (TEAM_EVENTS.has(type)) return role === "team"
  return role === "internal" // internal_note_from_chat
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export function planSupportCapture(ctx: CaptureContext): CapturePlanOutput {
  const { capture, client } = ctx
  if (ctx.alreadyProcessed && !capture.reprocess) return { kind: "skipped", outcome: "skipped_processed" }

  const messageAt = new Date(capture.message_at)
  const messageAtIso = messageAt.toISOString()
  const actor = capture.author_name ?? null
  const baseLedger = {
    source: capture.source,
    source_message_id: capture.source_message_id,
    client_id: client.id,
    author_role: capture.author_role,
    message_at: messageAtIso,
    model: capture.model ?? null,
    prompt_version: capture.prompt_version ?? null,
    reprocess: capture.reprocess,
  }

  // Hand-managed desk accounts are still captured; clients switched off are not.
  if (!client.support_capture) {
    return {
      kind: "apply",
      outcome: "skipped_client_excluded",
      plan: {
        ledger: { ...baseLedger, outcome: "skipped_client_excluded", ask_count: 0, event_count: 0 },
        tickets: [],
        events: [],
      },
      tickets: [],
      events: [],
    }
  }

  const tickets: PlannedTicket[] = []
  const ticketResults: TicketItemResult[] = []
  const byKey = new Map<string, number>()

  capture.tickets.forEach((candidate, index) => {
    const result = planTicket(ctx, candidate, index, messageAt)
    if ("error" in result) {
      ticketResults.push({ index, outcome: "error", error: result.error })
      return
    }
    const earlier = byKey.get(result.ticket.external_key)
    if (earlier !== undefined) {
      ticketResults.push({
        index,
        outcome: "planned",
        external_key: result.ticket.external_key,
        same_as_index: earlier,
        warnings: ["Same ask as an earlier candidate in this message (same type, category, property, and period)"],
      })
      return
    }
    byKey.set(result.ticket.external_key, index)
    tickets.push(result.ticket)
    ticketResults.push({ index, outcome: "planned", ...result.summary })
  })

  const events: PlannedEvent[] = []
  const eventResults: EventItemResult[] = []
  // Working copies so several events on one ticket see each other's effects
  const working = new Map<string, CaptureTicketSnapshot>()
  const snapshot = (id: string) => {
    if (!working.has(id)) {
      const found = ctx.tickets.get(id)
      if (found) working.set(id, { ...found, commitments: found.commitments.map((c) => ({ ...c })) })
    }
    return working.get(id)
  }

  const plannedKeys = new Set<string>()
  capture.events.forEach((event, index) => {
    const result = planEvent(ctx, event, index, snapshot, messageAtIso, actor, plannedKeys)
    eventResults.push(result.result)
    if (result.event) events.push(result.event)
  })

  // Rule priority follows the conversation. It is computed once per ticket
  // after the whole message, so the order of events inside a message never
  // changes the result (a reply listed before "promise kept" must not flash
  // the ticket to high).
  const lastEventFor = new Map<string, PlannedEvent>()
  for (const planned of events) lastEventFor.set(planned.ticket_id, planned)
  for (const [ticketId, last] of lastEventFor) {
    const current = working.get(ticketId)
    const original = ctx.tickets.get(ticketId)
    if (!current || !original) continue
    if (current.hand_managed || current.priority_source !== "rule") continue
    if (SUPPORT_CLOSED_STATUSES.includes(current.status)) continue
    const next = derivePriority({
      sentiment: current.client_sentiment,
      churnRisk: client.churn_risk,
      chaseCount: current.client_chase_count,
      category: current.category,
      moneyAtStake: current.money_at_stake,
      hasOverduePromise: current.commitments.some((c) => commitmentTiming(c, messageAt) === "overdue"),
    })
    if (next !== original.priority) {
      last.patch.priority = next
      last.payload.priority_to = next
    }
  }

  const errored =
    ticketResults.some((r) => r.outcome === "error") || eventResults.some((r) => r.outcome === "error")
  const outcome = errored ? "incomplete" : tickets.length || events.length ? "captured" : "no_ask"

  return {
    kind: "apply",
    outcome,
    plan: {
      ledger: errored
        ? null
        : {
            ...baseLedger,
            outcome: outcome === "no_ask" ? "no_ask" : "captured",
            ask_count: tickets.length,
            event_count: events.length,
          },
      tickets,
      events,
    },
    tickets: ticketResults,
    events: eventResults,
  }
}

function planTicket(
  ctx: CaptureContext,
  candidate: SupportAskCandidate,
  index: number,
  messageAt: Date
):
  | { error: string }
  | { ticket: PlannedTicket; summary: Omit<TicketItemResult, "index" | "outcome"> } {
  const { capture, client, now } = ctx

  const credential = firstCredential(
    candidate.summary,
    candidate.client_message,
    candidate.duplicate_note,
    candidate.backfill?.note,
    ...candidate.commitments.map((c) => c.description)
  )
  if (credential) return { error: `possible credential (${credential}) in ticket ${index}` }

  // Property: exact match against this client's own listings only
  const scope = candidate.property.scope
  const warnings: string[] = []
  let { matchedIds, unresolved } =
    scope === "listings"
      ? matchListingRefs(ctx.listings, candidate.property.listings)
      : { matchedIds: [] as string[], unresolved: [] as ListingRef[] }
  // A client with one active listing can only mean that listing, whatever
  // nickname they use ("the Cabin")
  const activeListings = ctx.listings.filter((l) => !l.status || l.status === "active")
  if (scope === "listings" && unresolved.length && !matchedIds.length && activeListings.length === 1) {
    matchedIds = [activeListings[0].id]
    unresolved = []
    warnings.push("Matched the client's only active listing")
  }
  const propertyValidated =
    scope === "portfolio" ||
    scope === "account" ||
    (scope === "listings" && matchedIds.length > 0 && unresolved.length === 0)

  const fingerprint = askFingerprint({
    requestType: candidate.request_type,
    category: candidate.category,
    propertyScope: scope,
    listingIds: matchedIds,
    timeWindow: candidate.time_window ?? null,
  })
  const externalKey = captureExternalKey(capture.source, capture.source_message_id, fingerprint)

  // Duplicates: the bot's flag must point at an active ticket of this client
  let possibleDuplicateOf: string | null = null
  if (candidate.possible_duplicate_of) {
    if (ctx.activeTicketIds.has(candidate.possible_duplicate_of))
      possibleDuplicateOf = candidate.possible_duplicate_of
    else warnings.push("possible_duplicate_of ignored: not an active ticket of this client")
  }
  // A deliberate re-run that splits the message differently never opens a
  // new ticket directly
  const reprocessUnmatched =
    capture.reprocess &&
    ctx.messageTickets.length > 0 &&
    !ctx.messageTickets.some((t) => t.ask_fingerprint === fingerprint)
  if (reprocessUnmatched && !possibleDuplicateOf) {
    possibleDuplicateOf = (
      ctx.messageTickets.find((t) => t.request_type === candidate.request_type) ?? ctx.messageTickets[0]
    ).id
  }
  // The same ask (type, category, property, period) is already open from an
  // earlier message: never open it twice
  const sameAskOpen = ctx.activeFingerprints.get(fingerprint)
  const sameAskElsewhere = !!sameAskOpen && sameAskOpen.external_key !== externalKey
  if (sameAskElsewhere && !possibleDuplicateOf) possibleDuplicateOf = sameAskOpen.id

  const triage = decideCapturedStatus({
    propertyValidated,
    requestTypeConfidence: candidate.ai.confidence.request_type,
    possibleDuplicate: possibleDuplicateOf !== null,
    needsAttachmentReview: candidate.needs_attachment_review,
  })
  const reasons = [...triage.reasons]
  if (reprocessUnmatched) reasons.push("reprocess_unmatched")
  if (sameAskElsewhere) reasons.push("same_ask_open")
  if (client.support_hand_managed) reasons.push("hand_managed")

  const backfill = candidate.backfill
  let status: SupportStatus = reasons.length ? "new" : "open"
  if (backfill && status === "open" && backfill.initial_status === "answered") status = "answered"

  const clockStart = now.getTime() + BACKFILL_GRACE_HOURS * HOUR_MS
  const commitments: PlannedCommitmentRow[] = candidate.commitments.map((promise) => {
    let due = promiseDueAt(promise, messageAt)
    if (backfill && Date.parse(due) < clockStart) due = iso(clockStart)
    return {
      external_key: `${externalKey}:promise:${stableHash(promise.description)}`,
      description: maskContactDetails(promise.description),
      due_at: due,
      due_source: promise.due_source,
      made_by_name: promise.made_by_name ?? null,
      made_at: messageAt.toISOString(),
    }
  })

  const hasOverduePromise = commitments.some((c) => Date.parse(c.due_at) < now.getTime())
  const priority = derivePriority({
    sentiment: candidate.client_sentiment,
    churnRisk: client.churn_risk,
    chaseCount: 0,
    category: candidate.category,
    moneyAtStake: candidate.money_at_stake,
    hasOverduePromise,
  })

  const messageAtIso = messageAt.toISOString()
  const nowIso = now.toISOString()
  const row: Record<string, unknown> = {
    client_id: client.id,
    property_scope: scope,
    property_validated_at: propertyValidated ? nowIso : null,
    category: candidate.category,
    request_type: candidate.request_type,
    summary: maskContactDetails(candidate.summary),
    client_message: clean(candidate.client_message),
    requested_by_name: candidate.requested_by_name ?? capture.author_name ?? null,
    requested_at: messageAtIso,
    time_window: candidate.time_window?.trim() || null,
    source: capture.source,
    source_message_id: capture.source_message_id,
    ask_fingerprint: fingerprint,
    needs_attachment_review: candidate.needs_attachment_review,
    status,
    priority,
    priority_source: "rule",
    client_sentiment: candidate.client_sentiment,
    money_at_stake: candidate.money_at_stake,
    hand_managed: client.support_hand_managed,
    assignee_id: resolveDefaultAssignee(ctx.routingRules, candidate.category, candidate.request_type),
    possible_duplicate_of: possibleDuplicateOf,
    // A check-in is our plan, not a client message: the client clock starts when they reply
    last_client_message_at: candidate.request_type === "check_in" ? null : messageAtIso,
    sla_anchor_at: backfill ? nowIso : null,
    answer_summary:
      status === "answered" ? (clean(backfill?.note) ?? DEFAULT_BACKFILL_ANSWER) : null,
    answered_at: status === "answered" ? nowIso : null,
    backfilled: !!backfill,
    backfill_batch: backfill?.batch ?? null,
    ai_classification: {
      model: capture.model ?? null,
      prompt_version: capture.prompt_version ?? null,
      confidence: candidate.ai.confidence,
      overall: candidate.ai.confidence.request_type,
      rationale: candidate.ai.rationale ?? null,
      triage_reasons: reasons,
      unresolved_listings: unresolved,
    },
  }

  const events: PlannedEventRow[] = [
    {
      event_type: "created",
      external_key: `${externalKey}:created`,
      actor_label: BOT_LABEL,
      body: null,
      payload: {
        status,
        triage_reasons: reasons,
        unresolved_listings: unresolved,
        ...(backfill ? { backfill_batch: backfill.batch } : {}),
      },
      occurred_at: messageAtIso,
    },
  ]
  if (possibleDuplicateOf) {
    events.push({
      event_type: "possible_duplicate",
      external_key: `${externalKey}:possible_duplicate`,
      actor_label: BOT_LABEL,
      body: clean(candidate.duplicate_note),
      payload: { of: possibleDuplicateOf, reprocess_unmatched: reprocessUnmatched, same_ask_open: sameAskElsewhere },
      occurred_at: messageAtIso,
    })
  }

  return {
    ticket: { external_key: externalKey, row, listing_ids: matchedIds, commitments, events },
    summary: {
      external_key: externalKey,
      status,
      triage_reasons: reasons,
      property_validated: propertyValidated,
      unresolved_listings: unresolved,
      possible_duplicate_of: possibleDuplicateOf,
      ...(warnings.length ? { warnings } : {}),
    },
  }
}

function planEvent(
  ctx: CaptureContext,
  event: SupportCaptureEvent,
  index: number,
  snapshot: (id: string) => CaptureTicketSnapshot | undefined,
  messageAtIso: string,
  actor: string | null,
  plannedKeys: Set<string>
): { result: EventItemResult; event?: PlannedEvent } {
  const { capture, client } = ctx
  const fail = (error: string): { result: EventItemResult } => ({
    result: { index, outcome: "error", error },
  })

  if (!roleAllows(capture.author_role, event.type))
    return fail(`${event.type} cannot come from a ${capture.author_role} message`)

  const initial = snapshot(event.ticket_id)
  if (!initial || initial.client_id !== client.id) return fail("ticket not found for this client")
  let ticket: CaptureTicketSnapshot = initial
  // Follow merges (a merge target can later be merged itself)
  let redirectedFrom: string | undefined
  for (let hops = 0; ticket.merged_into; hops++) {
    const target: CaptureTicketSnapshot | undefined = hops < 5 ? snapshot(ticket.merged_into) : undefined
    if (!target || target.client_id !== client.id)
      return fail("ticket was merged and its target could not be loaded")
    redirectedFrom ??= ticket.id
    ticket = target
  }

  const body = "body" in event ? clean(event.body) : null
  const texts: (string | null | undefined)[] = [body]
  if (event.type === "team_reply" && event.answer_check)
    texts.push(event.answer_check.asked, event.answer_check.replied, event.answer_check.gap)
  if (event.type === "commitment_made") texts.push(event.commitment.description)
  if (event.type === "commitment_cancelled") texts.push(event.note)
  const credential = firstCredential(...texts)
  if (credential) return fail(`possible credential (${credential}) in event ${index}`)

  // Keys come from the message + what the event is, so a replay is a no-op
  const keyBase = `${capture.source}:${capture.source_message_id}:${event.type}:${ticket.id}`
  const externalKey =
    event.type === "commitment_made"
      ? `${keyBase}:${stableHash(event.commitment.description)}`
      : event.type === "commitment_kept" || event.type === "commitment_rescheduled" || event.type === "commitment_cancelled"
        ? `${keyBase}:${event.commitment_id}`
        : keyBase
  if (plannedKeys.has(externalKey))
    return { result: { index, outcome: "skipped", reason: "same event already in this message", ticket_id: ticket.id } }
  plannedKeys.add(externalKey)

  const patch: TicketPatch = {}
  const payload: Record<string, unknown> = {}
  let commitment: CommitmentOp | undefined
  const closed = SUPPORT_CLOSED_STATUSES.includes(ticket.status)
  const auto = !ticket.hand_managed // automatic state changes allowed
  const at = new Date(messageAtIso)
  const setStatus = (status: SupportStatus) => {
    if (auto && ticket.status !== status) {
      patch.status = status
      payload.status_to = status
      ticket.status = status
    }
  }

  switch (event.type) {
    case "client_message": {
      const effect = classifyClientMessage(
        { ...ticket, support_ticket_commitments: ticket.commitments },
        at
      )
      payload.kind = effect.kind
      patch.last_client_message_at = messageAtIso
      if (effect.chaseDelta) patch.chase_delta = effect.chaseDelta
      if (effect.nudgeDelta) patch.nudge_delta = effect.nudgeDelta
      ticket.client_chase_count += effect.chaseDelta
      ticket.client_nudge_count += effect.nudgeDelta
      ticket.last_client_message_at = messageAtIso
      if (ticket.status === "awaiting_client") setStatus("open")
      else if (closed && event.reopen) {
        setStatus("open")
        payload.reopened = auto
      }
      break
    }
    case "client_acknowledged":
      // Not a new unanswered message: a "thanks!" must not start the reply clock
      patch.client_acknowledged_at = messageAtIso
      break
    case "client_rejected": {
      if (ticket.status === "dismissed") return fail("ticket is dismissed; capture this as a new ask")
      patch.last_client_message_at = messageAtIso
      ticket.last_client_message_at = messageAtIso
      payload.miss = true
      if (ticket.status === "answered" || ticket.status === "resolved") setStatus("open")
      break
    }
    case "client_told_live":
      patch.client_told_live_at = messageAtIso
      patch.last_team_message_at = messageAtIso
      patch.first_response_at = messageAtIso
      break
    case "team_reply": {
      patch.last_team_message_at = messageAtIso
      patch.first_response_at = messageAtIso
      ticket.last_team_message_at = messageAtIso
      if (event.answer_check) {
        patch.answer_check_verdict = event.answer_check.verdict
        patch.answer_check_asked = maskContactDetails(event.answer_check.asked)
        patch.answer_check_replied = maskContactDetails(event.answer_check.replied)
        patch.answer_check_gap = clean(event.answer_check.gap)
        patch.answer_check_at = messageAtIso
        payload.answer_check = event.answer_check.verdict
        ticket.answer_check_verdict = event.answer_check.verdict
      }
      if (event.used_suggestion) {
        const draftAt = ticket.suggested_reply_generated_at ? Date.parse(ticket.suggested_reply_generated_at) : NaN
        if (draftAt <= Date.parse(messageAtIso)) payload.used_suggestion = event.used_suggestion
        else payload.used_suggestion_ignored = "no draft before this reply"
      }
      const answerText = body ?? clean(event.answer_check?.replied)
      // "new" = captured but still needs triage; a passing team reply still answers it
      const answerable = ["new", "open", "in_progress", "awaiting_client", "answered"].includes(ticket.status)
      if (honorsProposedAnswer(event, ticket) && auto && answerable && answerText) {
        patch.answer_summary = answerText
        patch.answered_at = messageAtIso
        setStatus("answered")
      } else if (event.proposes_answered) {
        payload.proposed_answer_ignored =
          event.answer_check?.verdict === "fail"
            ? "answer check failed"
            : ticket.money_at_stake && event.answer_check?.verdict !== "pass"
              ? "money at stake needs a passing answer check"
              : !auto
                ? "hand-managed"
                : !answerText
                  ? "no answer text"
                  : `status ${ticket.status}`
      }
      break
    }
    case "team_asked_client":
      patch.last_team_message_at = messageAtIso
      patch.first_response_at = messageAtIso
      ticket.last_team_message_at = messageAtIso
      if (ticket.status === "open" || ticket.status === "in_progress") setStatus("awaiting_client")
      break
    case "internal_note_from_chat":
      // Timeline only; never a reply to the client
      break
    case "commitment_made": {
      if (ticket.status === "dismissed") return fail("ticket is dismissed; capture this as a new ask")
      const prefix = `${keyBase}:`
      if (capture.reprocess && ticket.commitments.some((c) => c.external_key?.startsWith(prefix)))
        return {
          result: { index, outcome: "skipped", reason: "promise from this message already recorded", ticket_id: ticket.id },
        }
      const due = promiseDueAt(event.commitment, at)
      commitment = {
        op: "insert",
        external_key: externalKey,
        description: maskContactDetails(event.commitment.description),
        due_at: due,
        due_source: event.commitment.due_source,
        made_by_name: event.commitment.made_by_name ?? actor,
        made_at: messageAtIso,
      }
      ticket.commitments.push({
        id: externalKey,
        ticket_id: ticket.id,
        description: event.commitment.description,
        due_at: due,
        due_source: event.commitment.due_source,
        rescheduled_to: null,
        status: "open",
        made_by_name: event.commitment.made_by_name ?? actor,
        made_at: messageAtIso,
        source: "bot",
        closed_at: null,
        close_note: null,
        created_at: messageAtIso,
        external_key: externalKey,
      })
      payload.due_at = due
      patch.last_team_message_at = messageAtIso
      patch.first_response_at = messageAtIso
      // A new promise on a resolved ticket means it isn't done
      if (ticket.status === "resolved") setStatus("open")
      break
    }
    case "commitment_kept":
    case "commitment_rescheduled":
    case "commitment_cancelled": {
      const target = ticket.commitments.find((c) => c.id === event.commitment_id)
      if (!target) return fail("promise not found on this ticket")
      if (target.status !== "open") return fail(`promise is already ${target.status}`)
      payload.commitment_id = target.id
      if (event.type === "commitment_kept") {
        commitment = { op: "keep", id: target.id, closed_at: messageAtIso }
        target.status = "kept"
        target.closed_at = messageAtIso
        payload.timing = commitmentTiming(target, at)
      } else if (event.type === "commitment_rescheduled") {
        const to = new Date(event.rescheduled_to).toISOString()
        commitment = { op: "reschedule", id: target.id, rescheduled_to: to }
        target.rescheduled_to = to
        payload.rescheduled_to = to
        payload.original_due_at = target.due_at
      } else {
        commitment = { op: "cancel", id: target.id, closed_at: messageAtIso, close_note: event.note }
        target.status = "cancelled"
        target.closed_at = messageAtIso
      }
      patch.last_team_message_at = messageAtIso
      patch.first_response_at = messageAtIso
      break
    }
    case "handoff": {
      payload.to = event.to_label
      const profile = matchProfile(ctx.profiles, event.to_label)
      if (profile && auto) {
        patch.assignee_id = profile.id
        payload.assignee_id = profile.id
      }
      break
    }
  }

  return {
    result: {
      index,
      outcome: "planned",
      external_key: externalKey,
      ticket_id: ticket.id,
      ...(redirectedFrom ? { redirected_from: redirectedFrom } : {}),
    },
    event: {
      ticket_id: ticket.id,
      event_type: event.type,
      external_key: externalKey,
      actor_label: actor,
      body,
      payload,
      occurred_at: messageAtIso,
      patch,
      ...(commitment ? { commitment } : {}),
    },
  }
}
