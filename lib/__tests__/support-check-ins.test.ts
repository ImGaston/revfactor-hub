import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { planSupportCapture, type CaptureContext } from "@/lib/support-capture"
import {
  checkInReplied,
  nextDueAt,
  resolutionBlockers,
  supportCaptureSchema,
  verificationChecksFor,
} from "@/lib/support-tickets"

const NOW = new Date("2026-10-01T15:00:00Z")
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const hoursAhead = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()
const CLIENT = "11111111-1111-4111-8111-111111111111"
const FEDE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

const checkIn = {
  summary: "Check in with Marissa on December pacing and the minimum-price change",
  category: "performance",
  request_type: "check_in",
  property: { scope: "account" },
  ai: { confidence: { category: 0.9, request_type: 0.95 }, rationale: "Planned on the Sep 30 call" },
  commitments: [
    {
      description: "Check in with Marissa on December pacing",
      due_source: "explicit",
      due_at: hoursAhead(48),
      made_by_name: "Fede",
    },
  ],
}

const message = (overrides: Record<string, unknown>) => ({
  source: "call",
  source_message_id: "granola:mtg_1:1",
  message_at: hoursAgo(2),
  author_role: "team",
  author_name: "Fede",
  client: { hub_client_id: CLIENT },
  tickets: [checkIn],
  ...overrides,
})

describe("who can create check-ins", () => {
  it("team messages create planned check-ins", () => {
    expect(supportCaptureSchema.safeParse(message({})).success).toBe(true)
  })

  it("team messages can't create client asks, and clients can't create check-ins", () => {
    expect(
      supportCaptureSchema.safeParse(message({ tickets: [{ ...checkIn, request_type: "question" }] })).success
    ).toBe(false)
    expect(supportCaptureSchema.safeParse(message({ author_role: "client" })).success).toBe(false)
    expect(supportCaptureSchema.safeParse(message({ author_role: "internal" })).success).toBe(false)
  })

  it("a check-in needs the planned outreach as a promise", () => {
    expect(supportCaptureSchema.safeParse(message({ tickets: [{ ...checkIn, commitments: [] }] })).success).toBe(
      false
    )
  })
})

describe("planning a check-in", () => {
  const ctx = (): CaptureContext => ({
    capture: supportCaptureSchema.parse(message({})),
    client: { id: CLIENT, support_capture: true, support_hand_managed: false, churn_risk: "high" },
    listings: [],
    alreadyProcessed: false,
    messageTickets: [],
    tickets: new Map(),
    activeTicketIds: new Set(),
    activeFingerprints: new Map(),
    routingRules: [{ category: "performance", request_type: null, assignee_id: FEDE, rank: 10 }],
    profiles: [],
    now: NOW,
  })

  it("opens with the outreach promise and no client clock", () => {
    const out = planSupportCapture(ctx())
    if (out.kind !== "apply") throw new Error("expected apply")
    expect(out.outcome).toBe("captured")
    const [ticket] = out.plan.tickets
    expect(ticket.row).toMatchObject({
      request_type: "check_in",
      status: "open",
      last_client_message_at: null,
      requested_by_name: "Fede",
      source: "call",
      assignee_id: FEDE,
    })
    expect(ticket.commitments).toHaveLength(1)
    expect(ticket.commitments[0].due_at).toBe(new Date(hoursAhead(48)).toISOString())
  })
})

const base = {
  status: "open" as const,
  request_type: "check_in" as const,
  requested_at: hoursAgo(72),
  last_client_message_at: null,
  last_team_message_at: null,
  sla_anchor_at: null,
  client_told_live_at: null,
}

describe("check-in clocks", () => {
  it("is due when the outreach is due, never on a reply clock from the plan date", () => {
    const promise = {
      id: "p",
      ticket_id: "t",
      description: "Check in",
      due_at: hoursAhead(10),
      due_source: "explicit" as const,
      rescheduled_to: null,
      status: "open" as const,
      made_by_name: null,
      made_at: hoursAgo(72),
      source: "bot" as const,
      closed_at: null,
      close_note: null,
      created_at: hoursAgo(72),
    }
    expect(nextDueAt({ ...base, support_ticket_commitments: [promise] })?.toISOString()).toBe(
      new Date(hoursAhead(10)).toISOString()
    )
    expect(nextDueAt({ ...base, support_ticket_commitments: [] })).toBeNull()
  })

  it("starts our reply clock once the client answers", () => {
    const due = nextDueAt({ ...base, last_team_message_at: hoursAgo(30), last_client_message_at: hoursAgo(5) })
    expect(due?.toISOString()).toBe(new Date(NOW.getTime() + 19 * 3_600_000).toISOString())
  })
})

describe("check-in resolve gate", () => {
  const gate = {
    request_type: "check_in" as const,
    property_scope: "account" as const,
    property_validated_at: hoursAgo(72),
    answered_at: hoursAgo(1),
    client_told_live_at: null,
  }

  it("needs a client reply after our outreach", () => {
    expect(checkInReplied({ first_response_at: null, last_client_message_at: hoursAgo(1) })).toBe(false)
    expect(checkInReplied({ first_response_at: hoursAgo(10), last_client_message_at: hoursAgo(20) })).toBe(false)
    expect(checkInReplied({ first_response_at: hoursAgo(10), last_client_message_at: hoursAgo(2) })).toBe(true)
    expect(checkInReplied({ first_response_at: hoursAgo(10), client_acknowledged_at: hoursAgo(2) })).toBe(true)

    expect(resolutionBlockers({ ...gate, first_response_at: hoursAgo(10), last_client_message_at: null })).toContain(
      "Reach out, then log the client's reply to the check-in"
    )
    expect(
      resolutionBlockers({ ...gate, first_response_at: hoursAgo(10), last_client_message_at: hoursAgo(2) })
    ).toEqual([])
  })

  it("verifies a check-in with its own checks", () => {
    expect(verificationChecksFor("check_in").map((c) => c.key)).toEqual(["client_replied", "outcome_recorded"])
    expect(verificationChecksFor("question").map((c) => c.key)).toEqual(["right_property", "answers_ask", "specific"])
    expect(verificationChecksFor("change").map((c) => c.key)).toContain("change_live")
  })
})

describe("check-in migration", () => {
  const RAW = readFileSync(path.join(process.cwd(), "supabase/migrations/20261001120000_support_check_ins.sql"), "utf8")
  const SQL = RAW.split("\n")
    .map((line) => (line.includes("--") ? line.slice(0, line.indexOf("--")) : line))
    .join("\n")
    .replace(/[ \t]+/g, " ")
  const PREVIOUS = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260930200000_support_suggested_reply.sql"),
    "utf8"
  )
  const messages = (sql: string) => {
    const start = sql.indexOf("FUNCTION public.support_ticket_guard()")
    return [...sql.slice(start, sql.indexOf("$$;", start)).matchAll(/RAISE EXCEPTION '((?:[^']|'')+)'/g)].map(
      (m) => m[1]
    )
  }

  it("allows check_in on tickets and routing rules", () => {
    for (const table of ["support_tickets", "support_routing_rules"]) {
      expect(SQL).toContain(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_request_type_check;`)
      expect(SQL).toContain(
        `ADD CONSTRAINT ${table}_request_type_check\n CHECK (request_type IN ('question', 'change', 'decision', 'issue', 'check_in'));`
      )
    }
  })

  it("keeps every earlier guard rule and adds the check-in gate", () => {
    const before = messages(PREVIOUS)
    const after = messages(SQL)
    expect(after).toEqual(expect.arrayContaining(before))
    expect(after).toContain("Reach out, then log the client''s reply to the check-in before resolving")
    expect(after.length).toBe(before.length + 1)
    expect(SQL).toContain("to_jsonb(NEW) - 'suggested_reply' - 'updated_at'")
    expect(SQL).toContain("REVOKE EXECUTE ON FUNCTION public.support_ticket_guard() FROM PUBLIC, anon, authenticated")
    expect(SQL).not.toMatch(/CREATE POLICY|GRANT /)
  })
})
