import { describe, expect, it } from "vitest"

import type { SupportTicket } from "@/lib/support-tickets"
import {
  defaultQueueView,
  friendlyDbError,
  matchesTicketSearch,
  queueViews,
  triageBlockers,
  validateAnswer,
  validateNote,
  validateVerification,
} from "@/lib/support-workflow"

const NOW = new Date("2026-10-02T15:00:00Z")
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

let seq = 0
function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  seq += 1
  return {
    id: `t${seq}`,
    ticket_number: 100 + seq,
    client_id: "c1",
    property_scope: "listings",
    property_validated_at: hoursAgo(10),
    category: "pricing",
    request_type: "question",
    summary: "How is December pacing?",
    client_message: null,
    requested_by_name: null,
    requested_at: hoursAgo(10),
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
    assignee_id: null,
    possible_duplicate_of: null,
    merged_into: null,
    first_response_at: null,
    last_client_message_at: hoursAgo(2),
    last_team_message_at: null,
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
    created_at: hoursAgo(10),
    updated_at: hoursAgo(1),
    clients: { id: "c1", name: "Lake House Co" },
    assignee: null,
    support_ticket_listings: [{ listing_id: "l1", listings: { id: "l1", name: "Cabin | TN | Kate" } }],
    support_ticket_commitments: [],
    adjustments: [],
    ...overrides,
  }
}

describe("queue views", () => {
  const triage = ticket({ status: "new" })
  const overdue = ticket({ last_client_message_at: hoursAgo(30) })
  const mine = ticket({ assignee_id: ME })
  const verify = ticket({ status: "answered", answered_at: hoursAgo(1), last_team_message_at: hoursAgo(1) })
  const checkIn = ticket({ request_type: "check_in", last_client_message_at: null, requested_at: hoursAgo(100) })
  const closed = ticket({ status: "resolved", resolved_at: hoursAgo(3) })
  const views = queueViews([triage, overdue, mine, verify, checkIn, closed], ME, NOW)

  it("splits tickets the way the queue does", () => {
    expect(views.triage).toEqual([triage])
    expect(views.overdue).toEqual([overdue])
    expect(views.verify).toEqual([verify])
    expect(views.closed).toEqual([closed])
  })

  it("adds Mine and Check-ins across the active views", () => {
    expect(views.mine).toEqual([mine])
    expect(views.checkIns).toEqual([checkIn])
    // A check-in with no client message is not overdue on a reply clock
    expect(views.onUs).toContain(checkIn)
  })

  it("opens on the most urgent view with work", () => {
    expect(defaultQueueView(views)).toBe("overdue")
    expect(defaultQueueView(queueViews([triage], ME, NOW))).toBe("triage")
    expect(defaultQueueView(queueViews([], ME, NOW))).toBe("onUs")
  })

  it("has no Mine view without a user", () => {
    expect(queueViews([mine], null, NOW).mine).toEqual([])
  })
})

describe("matchesTicketSearch", () => {
  const t = ticket({
    ticket_number: 1042,
    assignee: { full_name: "Andrés Pérez", email: "andres@revfactor.io" },
  })
  it("matches ref, client, summary, owner, and property", () => {
    for (const q of ["#1042", "1042", "lake house", "december", "andrés", "cabin", ""]) {
      expect(matchesTicketSearch(t, q)).toBe(true)
    }
    expect(matchesTicketSearch(t, "marissa")).toBe(false)
  })
})

describe("action rules", () => {
  it("blocks accepting triage until the property is confirmed", () => {
    expect(triageBlockers(ticket({ status: "new", property_scope: "unknown", property_validated_at: null }))).toEqual([
      "Pick the property first",
    ])
    expect(triageBlockers(ticket({ status: "new" }))).toEqual([])
    expect(triageBlockers(ticket({ status: "open", property_scope: "unknown" }))).toEqual([])
  })

  it("validates the recorded answer", () => {
    expect(validateAnswer("  Yes, 10% off October at the Cabin.  ")).toEqual({ value: "Yes, 10% off October at the Cabin." })
    expect(validateAnswer("ok")).toMatchObject({ error: expect.any(String) })
    expect(validateAnswer("a".repeat(4001))).toMatchObject({ error: expect.any(String) })
    const credential = validateAnswer("The door code is 4471, pw: hunter22")
    expect(credential).toMatchObject({ error: expect.stringContaining("Remove the") })
    if ("error" in credential) expect(credential.error).not.toContain("hunter22")
  })

  it("requires notes only where asked", () => {
    expect(validateNote("", "a note", false)).toEqual({ value: null })
    expect(validateNote("  ", "what's missing", true)).toEqual({ error: "Add what's missing" })
    expect(validateNote(" Client changed plans ", "a note", true)).toEqual({ value: "Client changed plans" })
  })

  it("verifies only with every check, and a reason for a flagged answer", () => {
    const all = ["right_property", "answers_ask", "specific"]
    expect(validateVerification({ request_type: "question", answer_check_verdict: "pass" }, all.slice(0, 2), null, NOW)).toEqual({
      error: "Tick every check before resolving",
    })
    expect(validateVerification({ request_type: "question", answer_check_verdict: "pass" }, all, null, NOW)).toEqual({
      verification: { checks: all, verified_at: NOW.toISOString() },
    })
    expect(validateVerification({ request_type: "question", answer_check_verdict: "uncertain" }, all, "ok", NOW)).toMatchObject({
      error: expect.any(String),
    })
    expect(
      validateVerification({ request_type: "question", answer_check_verdict: "fail" }, all, "Client confirmed on a call", NOW)
    ).toMatchObject({ verification: { override_reason: "Client confirmed on a call" } })
    expect(
      validateVerification({ request_type: "change", answer_check_verdict: null }, all, null, NOW)
    ).toEqual({ error: "Tick every check before resolving" })
    expect(
      validateVerification({ request_type: "check_in", answer_check_verdict: null }, ["client_replied", "outcome_recorded"], null, NOW)
    ).toMatchObject({ verification: { checks: ["client_replied", "outcome_recorded"] } })
  })

  it("passes the database guard's messages through and hides everything else", () => {
    expect(friendlyDbError("Close or cancel every open promise before resolving")).toBe("Close or cancel every open promise")
    expect(friendlyDbError("Reach out, then log the client's reply to the check-in before resolving")).toBe(
      "Reach out, then log the client's reply to the check-in"
    )
    expect(friendlyDbError('new row violates row-level security policy for table "support_tickets"')).toBe(
      "You don't have permission to do that"
    )
    expect(friendlyDbError('duplicate key value violates unique constraint "x"')).toBe("Something went wrong. Try again.")
    expect(friendlyDbError(undefined)).toBe("Something went wrong. Try again.")
  })
})
