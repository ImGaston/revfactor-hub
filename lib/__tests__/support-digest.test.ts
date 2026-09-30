import { describe, expect, it } from "vitest"

import { buildSupportDigest, endOfDayInTimeZone, type DigestTicket } from "@/lib/support-digest"

const NOW = new Date("2026-09-29T15:00:00Z") // 11:00 ET
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const hoursAhead = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()

const ANDRES = { id: "a", full_name: "Andrés Pérez", email: "andres@revfactor.io" }
const GASTON = { id: "g", full_name: "Gastón Ruiz", email: "gaston@revfactor.io" }

let seq = 0
function ticket(overrides: Partial<DigestTicket> = {}): DigestTicket {
  seq += 1
  return {
    id: `t${seq}`,
    ticket_number: 1000 + seq,
    client_id: "c1",
    property_scope: "listings",
    property_validated_at: hoursAgo(40),
    category: "pricing",
    request_type: "question",
    summary: "How is December pacing?",
    client_message: null,
    requested_by_name: null,
    requested_at: hoursAgo(40),
    time_window: null,
    source: "assembly",
    source_message_id: null,
    external_key: null,
    needs_attachment_review: false,
    status: "open",
    priority: "medium",
    priority_source: "rule",
    client_sentiment: "neutral",
    money_at_stake: false,
    hand_managed: false,
    assignee_id: ANDRES.id,
    possible_duplicate_of: null,
    merged_into: null,
    first_response_at: null,
    last_client_message_at: hoursAgo(10),
    last_team_message_at: hoursAgo(5),
    sla_anchor_at: null,
    client_chase_count: 0,
    client_nudge_count: 0,
    answer_summary: null,
    answered_at: null,
    answer_check_verdict: null,
    answer_check_asked: null,
    answer_check_replied: null,
    answer_check_gap: null,
    answer_check_at: null,
    client_told_live_at: null,
    client_acknowledged_at: null,
    verification: {},
    resolved_at: null,
    dismiss_reason: null,
    dismiss_note: null,
    backfilled: false,
    backfill_batch: null,
    ai_classification: {},
    created_at: hoursAgo(40),
    updated_at: hoursAgo(1),
    clients: { id: "c1", name: "Okafor Family Homes", churn_risk: null },
    assignee: ANDRES,
    support_ticket_listings: [{ listing_id: "L1", listings: { id: "L1", name: "Boho Cottage | TX | Ngozi" } }],
    support_ticket_commitments: [],
    adjustments: [],
    ...overrides,
  }
}

const promise = (due: string) => ({
  id: `p${seq}`,
  ticket_id: "x",
  description: "Send the analysis",
  due_at: due,
  due_source: "explicit" as const,
  rescheduled_to: null,
  status: "open" as const,
  made_by_name: null,
  made_at: hoursAgo(30),
  source: "bot" as const,
  closed_at: null,
  close_note: null,
  created_at: hoursAgo(30),
})

describe("endOfDayInTimeZone", () => {
  it("returns the next midnight in New York", () => {
    expect(endOfDayInTimeZone(NOW).toISOString()).toBe("2026-09-30T04:00:00.000Z")
  })

  it("handles the day the clocks change (Nov 1, 2026)", () => {
    expect(endOfDayInTimeZone(new Date("2026-10-31T20:00:00Z")).toISOString()).toBe("2026-11-01T04:00:00.000Z")
    expect(endOfDayInTimeZone(new Date("2026-11-01T12:00:00Z")).toISOString()).toBe("2026-11-02T05:00:00.000Z")
  })
})

describe("buildSupportDigest", () => {
  const overdue = ticket({
    summary: "Yes or no on the Oct discount",
    last_client_message_at: hoursAgo(31),
    last_team_message_at: hoursAgo(40),
  })
  const dueToday = ticket({ support_ticket_commitments: [promise(hoursAhead(6))] })
  const notTold = ticket({
    request_type: "change",
    assignee_id: GASTON.id,
    assignee: GASTON,
    adjustments: [{ id: "adj", type: "min_stay", status: "controlled", target_value: null, controlled_at: hoursAgo(30), listings: null }],
  })
  const toVerify = ticket({ status: "answered", answered_at: hoursAgo(9), last_team_message_at: hoursAgo(9) })
  const staleTriage = ticket({ status: "new", created_at: hoursAgo(20) })
  const freshTriage = ticket({ status: "new", created_at: hoursAgo(2) })
  const money = ticket({ category: "offboarding", money_at_stake: true, property_scope: "account" })
  const unhappy = ticket({ client_sentiment: "unhappy", hand_managed: true })
  const backlog = ticket({ backfilled: true, backfill_batch: "2026-09-28-recheck" })

  const digest = buildSupportDigest({
    tickets: [overdue, dueToday, notTold, toVerify, staleTriage, freshTriage, money, unhappy, backlog],
    closedCommitments: [
      { status: "kept", due_at: hoursAgo(30), rescheduled_to: null, closed_at: hoursAgo(40), backfilled: false },
      { status: "kept", due_at: hoursAgo(30), rescheduled_to: null, closed_at: hoursAgo(20), backfilled: false },
      { status: "kept", due_at: hoursAgo(200), rescheduled_to: null, closed_at: hoursAgo(210), backfilled: false },
      { status: "kept", due_at: hoursAgo(30), rescheduled_to: null, closed_at: hoursAgo(20), backfilled: true },
    ],
    events: [
      { event_type: "verification_failed", occurred_at: hoursAgo(24) },
      { event_type: "verification_failed", occurred_at: hoursAgo(200) },
      { event_type: "client_rejected", occurred_at: hoursAgo(3) },
    ],
    backlogCleared: 4,
    now: NOW,
  })

  it("gives each owner their overdue, due-today, and done-not-told lines", () => {
    const andres = digest.by_owner.find((s) => s.owner?.id === ANDRES.id)!
    expect(andres.overdue.map((l) => l.ticket_id)).toContain(overdue.id)
    expect(andres.due_today.map((l) => l.ticket_id)).toEqual([dueToday.id])
    const gaston = digest.by_owner.find((s) => s.owner?.id === GASTON.id)!
    expect(gaston.done_not_told.map((l) => l.ticket_id)).toEqual([notTold.id])
    expect(gaston.overdue).toEqual([])
  })

  it("writes one ready-to-post line per ticket", () => {
    const line = digest.by_owner.find((s) => s.owner?.id === ANDRES.id)!.overdue.find((l) => l.ticket_id === overdue.id)!
    expect(line.line).toBe(`#${overdue.ticket_number} Okafor Family Homes · Boho Cottage · Yes or no on the Oct discount · 7h overdue · Andrés`)
  })

  it("builds the team-wide sections", () => {
    expect(digest.verify_queue.map((l) => l.ticket_id)).toEqual([toVerify.id])
    expect(digest.verify_queue[0].due).toBe("waiting 9h for verification")
    expect(digest.stale_triage.map((l) => l.ticket_id)).toEqual([staleTriage.id])
    expect(digest.money_decisions.map((l) => l.ticket_id)).toEqual([money.id])
    expect(digest.at_risk.map((l) => l.ticket_id)).toEqual([unhappy.id])
    expect(digest.at_risk[0].line).toMatch(/hand-managed$/)
  })

  it("compares this week with last week, keeping backfill out of the promise rate", () => {
    expect(digest.metrics.promises_closed).toEqual({ this_week: 2, last_week: 1 })
    expect(digest.metrics.promise_on_time_rate).toEqual({ this_week: 0.5, last_week: 1 })
    expect(digest.metrics.sent_back).toEqual({ this_week: 1, last_week: 1 })
    expect(digest.metrics.client_rejected).toEqual({ this_week: 1, last_week: 0 })
    expect(digest.metrics.backlog_open).toBe(1)
    expect(digest.metrics.backlog_cleared).toBe(4)
  })
})
