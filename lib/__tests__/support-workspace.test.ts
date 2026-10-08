import { describe, expect, it } from "vitest"

import type { SupportTicket } from "@/lib/support-tickets"
import {
  SUPPORT_STATUS_VIEWS,
  defaultStatusView,
  isStatusView,
  matchesTicketSearch,
  statusViews,
} from "@/lib/support-workspace"

const NOW = new Date("2026-10-05T12:00:00Z")
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

let seq = 0
function ticket(patch: Partial<SupportTicket> = {}): SupportTicket {
  seq += 1
  const clientId = patch.client_id ?? "c-acme"
  return {
    id: `t${seq}`,
    ticket_number: seq,
    client_id: clientId,
    property_scope: "listings",
    property_validated_at: hoursAgo(1),
    category: "pricing",
    request_type: "question",
    summary: "Ask",
    client_message: null,
    requested_by_name: null,
    requested_at: hoursAgo(2),
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
    // Asked 2h ago, no reply yet: the reply clock is running but not overdue
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
    created_at: hoursAgo(2),
    updated_at: hoursAgo(1),
    clients: { id: clientId, name: clientId === "c-acme" ? "Acme" : clientId },
    assignee: null,
    support_ticket_listings: [],
    support_ticket_commitments: [],
    adjustments: [],
    ...patch,
  } as SupportTicket
}

const ids = (tickets: SupportTicket[]) => tickets.map((t) => t.id)

describe("statusViews", () => {
  const triage = ticket({ status: "new" })
  // Asked 30h ago with no reply: past the 24h reply clock
  const overdue = ticket({ last_client_message_at: hoursAgo(30), requested_at: hoursAgo(30) })
  const verify = ticket({ status: "answered", answered_at: hoursAgo(3), last_team_message_at: hoursAgo(1) })
  const onClient = ticket({ status: "awaiting_client", last_team_message_at: hoursAgo(1) })
  const mine = ticket({ assignee_id: "u-fede" })
  const checkIn = ticket({ request_type: "check_in", assignee_id: "u-fede" })
  const closed = ticket({ status: "resolved", resolved_at: hoursAgo(1), assignee_id: "u-fede" })
  const all = [triage, overdue, verify, onClient, mine, checkIn, closed]

  it("uses the queue's own buckets", () => {
    const views = statusViews(all, "u-fede", NOW)
    expect(ids(views.triage)).toEqual([triage.id])
    expect(ids(views.overdue)).toEqual([overdue.id])
    expect(ids(views.verify)).toEqual([verify.id])
    expect(ids(views.onClient)).toEqual([onClient.id])
    expect(ids(views.onUs).sort()).toEqual([mine.id, checkIn.id].sort())
    expect(ids(views.closed)).toEqual([closed.id])
  })

  it("Mine and Check-ins only hold open tickets", () => {
    const views = statusViews(all, "u-fede", NOW)
    expect(ids(views.mine).sort()).toEqual([mine.id, checkIn.id].sort())
    expect(ids(views.checkIns)).toEqual([checkIn.id])
  })

  it("Mine is empty without a signed-in user", () => {
    expect(statusViews(all, null, NOW).mine).toEqual([])
  })

  it("has a list for every sidebar view", () => {
    const views = statusViews([], null, NOW)
    for (const v of SUPPORT_STATUS_VIEWS) expect(views[v.key]).toEqual([])
  })
})

describe("defaultStatusView", () => {
  it("opens on overdue work first, then triage", () => {
    expect(defaultStatusView(statusViews([ticket({ status: "new" }), ticket({ last_client_message_at: hoursAgo(30) })], null, NOW))).toBe("overdue")
    expect(defaultStatusView(statusViews([ticket({ status: "new" }), ticket()], null, NOW))).toBe("triage")
  })

  it("falls back to On us when nothing is open", () => {
    expect(defaultStatusView(statusViews([], null, NOW))).toBe("onUs")
  })
})

describe("isStatusView", () => {
  it("accepts only known views", () => {
    expect(isStatusView("verify")).toBe(true)
    expect(isStatusView("everything")).toBe(false)
    expect(isStatusView(null)).toBe(false)
  })
})

describe("matchesTicketSearch", () => {
  const t = ticket({
    ticket_number: 4321,
    summary: "Raise December minimums",
    client_id: "c-blue",
    clients: { id: "c-blue", name: "Blue Lake Rentals" },
    assignee: { full_name: "Gaston R", email: "g@x.test" },
    support_ticket_listings: [{ listing_id: "l1", listings: { id: "l1", name: "Cedar Cabin" } }],
  } as Partial<SupportTicket>)

  it("matches ref, summary, client, owner, and property, ignoring case", () => {
    for (const q of ["#4321", "4321", "december", "blue lake", "gaston", "cedar cabin"]) {
      expect(matchesTicketSearch(t, q)).toBe(true)
    }
  })

  it("treats a blank query as a match and misses unrelated text", () => {
    expect(matchesTicketSearch(t, "   ")).toBe(true)
    expect(matchesTicketSearch(t, "airbnb")).toBe(false)
  })
})
