import { describe, expect, it } from "vitest"

import {
  matchProfile,
  planSupportCapture,
  type CaptureContext,
  type CaptureTicketSnapshot,
} from "@/lib/support-capture"
import { supportCaptureSchema, type CaptureCommitment } from "@/lib/support-tickets"

const NOW = new Date("2026-09-29T15:00:00Z")
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const hoursAhead = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()

const CLIENT = "11111111-1111-4111-8111-111111111111"
const OTHER_CLIENT = "22222222-2222-4222-8222-222222222222"
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const T3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const P1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const ANDRES = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const GASTON = "ffffffff-ffff-4fff-8fff-ffffffffffff"

function snapshot(overrides: Partial<CaptureTicketSnapshot> = {}): CaptureTicketSnapshot {
  return {
    id: T1,
    client_id: CLIENT,
    ticket_number: 1029,
    status: "open",
    category: "pricing",
    request_type: "decision",
    priority: "medium",
    priority_source: "rule",
    client_sentiment: "neutral",
    money_at_stake: false,
    hand_managed: false,
    merged_into: null,
    last_client_message_at: hoursAgo(30),
    last_team_message_at: hoursAgo(20),
    client_chase_count: 0,
    client_nudge_count: 0,
    answer_check_verdict: null,
    commitments: [],
    ...overrides,
  }
}

function promise(overrides: Partial<CaptureCommitment> = {}): CaptureCommitment {
  return {
    id: P1,
    ticket_id: T1,
    description: "Send a discount recommendation",
    due_at: hoursAhead(10),
    due_source: "relative",
    rescheduled_to: null,
    status: "open",
    made_by_name: "Andrés",
    made_at: hoursAgo(20),
    source: "bot",
    closed_at: null,
    close_note: null,
    created_at: hoursAgo(20),
    external_key: "assembly:msg_old:commitment_made:x",
    ...overrides,
  }
}

const ask = {
  summary: "Yes or no: discount Boho Cottage for October and November?",
  client_message: "Should we discount Oct/Nov at Boho Cottage? A yes or no is fine.",
  category: "pricing",
  request_type: "decision",
  time_window: "2026-10/2026-11",
  property: { scope: "listings", listings: [{ name_hint: "Boho Cottage" }] },
  ai: { confidence: { category: 0.9, request_type: 0.95 } },
}

function context(
  payload: Record<string, unknown>,
  overrides: Partial<Omit<CaptureContext, "capture">> = {}
): CaptureContext {
  const capture = supportCaptureSchema.parse({
    source_message_id: "msg_1",
    message_at: hoursAgo(1),
    author_role: "client",
    author_name: "Ngozi Okafor",
    client: { hub_client_id: CLIENT },
    ...payload,
  })
  return {
    capture,
    client: { id: CLIENT, support_capture: true, support_hand_managed: false, churn_risk: null },
    listings: [
      { id: "L1", name: "Boho Cottage | TX | Ngozi", listing_id: "pl_1", airbnb_link: null },
      { id: "L2", name: "Birch Lane Loft", listing_id: null, airbnb_link: null },
    ],
    alreadyProcessed: false,
    messageTickets: [],
    tickets: new Map(),
    activeTicketIds: new Set(),
    activeFingerprints: new Map(),
    routingRules: [
      { category: "pricing", request_type: null, assignee_id: ANDRES, rank: 10 },
      { category: "pricing", request_type: "decision", assignee_id: GASTON, rank: 10 },
    ],
    profiles: [
      { id: ANDRES, full_name: "Andrés Pérez", email: "andres@revfactor.io" },
      { id: GASTON, full_name: "Gastón Ruiz", email: "gaston@revfactor.io" },
    ],
    now: NOW,
    ...overrides,
  }
}

function applied(ctx: CaptureContext) {
  const out = planSupportCapture(ctx)
  if (out.kind !== "apply") throw new Error(`expected apply, got ${out.kind}`)
  return out
}

describe("message ledger", () => {
  it("skips a message that was already processed", () => {
    expect(planSupportCapture(context({ tickets: [ask] }, { alreadyProcessed: true }))).toEqual({
      kind: "skipped",
      outcome: "skipped_processed",
    })
  })

  it("records an excluded client's message without capturing it", () => {
    const out = applied(
      context({ tickets: [ask] }, { client: { id: CLIENT, support_capture: false, support_hand_managed: false, churn_risk: null } })
    )
    expect(out.outcome).toBe("skipped_client_excluded")
    expect(out.plan.tickets).toEqual([])
    expect(out.plan.ledger?.outcome).toBe("skipped_client_excluded")
  })

  it("records a message with no ask as no_ask", () => {
    const out = applied(context({}))
    expect(out.outcome).toBe("no_ask")
    expect(out.plan.ledger?.outcome).toBe("no_ask")
  })
})

describe("new asks", () => {
  it("opens a confident ask on a matched property and routes it", () => {
    const out = applied(context({ tickets: [ask] }))
    const ticket = out.plan.tickets[0]
    expect(out.outcome).toBe("captured")
    expect(ticket.external_key).toMatch(/^assembly:msg_1:[0-9a-z]{11}$/)
    expect(ticket.listing_ids).toEqual(["L1"])
    expect(ticket.row).toMatchObject({
      status: "open",
      assignee_id: GASTON,
      priority: "medium",
      hand_managed: false,
      requested_by_name: "Ngozi Okafor",
      last_client_message_at: hoursAgo(1),
    })
    expect(ticket.row.property_validated_at).toBe(NOW.toISOString())
    expect(ticket.events.map((e) => e.event_type)).toEqual(["created"])
    expect(out.plan.ledger).toMatchObject({ outcome: "captured", ask_count: 1 })
  })

  it("keeps the same key when the bot words the summary differently", () => {
    const a = applied(context({ tickets: [ask] })).plan.tickets[0].external_key
    const b = applied(context({ tickets: [{ ...ask, summary: "Discount decision for Boho, Oct–Nov" }] })).plan
      .tickets[0].external_key
    expect(a).toBe(b)
  })

  it("sends an unmatched property to triage and reports it", () => {
    const out = applied(
      context({ tickets: [{ ...ask, property: { scope: "listings", listings: [{ name_hint: "Birch Ave" }] } }] })
    )
    expect(out.tickets[0]).toMatchObject({
      status: "new",
      property_validated: false,
      triage_reasons: ["property_not_validated"],
      unresolved_listings: [{ name_hint: "Birch Ave" }],
    })
  })

  it("marks hand-managed clients and always sends their asks to triage", () => {
    const out = applied(
      context({ tickets: [ask] }, { client: { id: CLIENT, support_capture: true, support_hand_managed: true, churn_risk: null } })
    )
    expect(out.plan.tickets[0].row).toMatchObject({ status: "new", hand_managed: true })
    expect(out.tickets[0].triage_reasons).toContain("hand_managed")
  })

  it("rejects a credential and leaves the message unprocessed", () => {
    const out = applied(context({ tickets: [{ ...ask, client_message: "our PriceLabs pw: Summer2026!" }] }))
    expect(out.outcome).toBe("incomplete")
    expect(out.plan.ledger).toBeNull()
    expect(out.tickets[0]).toMatchObject({ outcome: "error" })
  })

  it("masks contact details in stored text", () => {
    const out = applied(
      context({ tickets: [{ ...ask, client_message: "Call me at 555-201-4477 or mail ngozi@example.com" }] })
    )
    expect(out.plan.tickets[0].row.client_message).toBe("Call me at ***-***-4477 or mail n***@example.com")
  })

  it("collapses two candidates that are the same ask", () => {
    const out = applied(context({ tickets: [ask, { ...ask, summary: "Same thing, reworded" }] }))
    expect(out.plan.tickets).toHaveLength(1)
    expect(out.tickets[1]).toMatchObject({ outcome: "planned", same_as_index: 0 })
  })

  it("on reprocess, never opens an unmatched ask directly", () => {
    const out = applied(
      context(
        { reprocess: true, tickets: [{ ...ask, time_window: "2026-12" }] },
        { alreadyProcessed: true, messageTickets: [{ id: T2, ask_fingerprint: "other", request_type: "decision" }] }
      )
    )
    expect(out.tickets[0]).toMatchObject({ status: "new", possible_duplicate_of: T2 })
    expect(out.tickets[0].triage_reasons).toContain("reprocess_unmatched")
    expect(out.plan.tickets[0].events.map((e) => e.event_type)).toEqual(["created", "possible_duplicate"])
  })

  it("ignores a duplicate flag that doesn't point at an active ticket of this client", () => {
    const out = applied(context({ tickets: [{ ...ask, possible_duplicate_of: T3 }] }))
    expect(out.tickets[0].possible_duplicate_of).toBeNull()
    expect(out.tickets[0].warnings?.[0]).toMatch(/ignored/)
  })

  it("gives a vague promise 24h from when it was made", () => {
    const out = applied(
      context({ tickets: [{ ...ask, commitments: [{ description: "We'll review", due_source: "default_vague" }] }] })
    )
    expect(out.plan.tickets[0].commitments[0].due_at).toBe(hoursAhead(23))
  })

  it("imports backlog as answered with clocks starting now + 24h", () => {
    const out = applied(
      context({
        message_at: hoursAgo(300),
        tickets: [
          {
            ...ask,
            backfill: { batch: "2026-09-28-recheck", initial_status: "answered" },
            commitments: [{ description: "Confirm the min price change", due_source: "explicit", due_at: hoursAgo(250) }],
          },
        ],
      })
    )
    const t = out.plan.tickets[0]
    expect(t.row).toMatchObject({
      status: "answered",
      backfilled: true,
      backfill_batch: "2026-09-28-recheck",
      sla_anchor_at: NOW.toISOString(),
      answered_at: NOW.toISOString(),
    })
    expect(String(t.row.answer_summary)).toMatch(/never confirmed/)
    expect(t.commitments[0].due_at).toBe(hoursAhead(24))
  })
})

describe("dry-run findings (2026-09-29)", () => {
  it("flags the same ask arriving in a second message instead of opening it twice", () => {
    const first = applied(context({ tickets: [ask] })).plan.tickets[0]
    const out = applied(
      context(
        { source_message_id: "msg_2", tickets: [{ ...ask, summary: "Should we discount Boho for Oct and Nov?" }] },
        { activeFingerprints: new Map([[String(first.row.ask_fingerprint), { id: T1, external_key: first.external_key }]]) }
      )
    )
    expect(out.tickets[0]).toMatchObject({ status: "new", possible_duplicate_of: T1 })
    expect(out.tickets[0].triage_reasons).toContain("same_ask_open")
  })

  it("does not flag a replay of the same message against its own ticket", () => {
    const first = applied(context({ tickets: [ask] })).plan.tickets[0]
    const out = applied(
      context(
        { tickets: [ask] },
        { activeFingerprints: new Map([[String(first.row.ask_fingerprint), { id: T1, external_key: first.external_key }]]) }
      )
    )
    expect(out.tickets[0]).toMatchObject({ status: "open", possible_duplicate_of: null })
  })

  it("matches a nickname to a client's only active listing", () => {
    const out = applied(
      context(
        { tickets: [{ ...ask, property: { scope: "listings", listings: [{ name_hint: "the Cabin" }] } }] },
        {
          listings: [
            { id: "L1", name: "Creekside Cabin | TN | Ann", listing_id: null, airbnb_link: null, status: "active" },
            { id: "L0", name: "Old Loft | TN | Ann", listing_id: null, airbnb_link: null, status: "inactive" },
          ],
        }
      )
    )
    expect(out.plan.tickets[0].listing_ids).toEqual(["L1"])
    expect(out.tickets[0]).toMatchObject({ status: "open", property_validated: true })
    expect(out.tickets[0].warnings).toContain("Matched the client's only active listing")
  })

  it("matches a saved nickname on a multi-listing client", () => {
    const out = applied(
      context(
        { tickets: [{ ...ask, property: { scope: "listings", listings: [{ name_hint: "Creek Backyard" }] } }] },
        {
          listings: [
            { id: "L1", name: "Boho Cottage | TX | Ngozi", listing_id: null, airbnb_link: null, aliases: ["Creek Backyard"] },
            { id: "L2", name: "Birch Lane Loft", listing_id: null, airbnb_link: null },
          ],
        }
      )
    )
    expect(out.plan.tickets[0].listing_ids).toEqual(["L1"])
  })

  it("counts a follow-up after a reply that missed the ask as a chase", () => {
    const out = applied(
      context(
        { events: [{ type: "client_message", ticket_id: T1, body: "I still see the Oct charge" }] },
        { tickets: new Map([[T1, snapshot({ last_team_message_at: hoursAgo(20), answer_check_verdict: "fail" })]]) }
      )
    )
    expect(out.plan.events[0]).toMatchObject({ payload: { kind: "chase" }, patch: { chase_delta: 1 } })
  })

  it("only lets a clear pass mark a money-at-stake ticket answered", () => {
    const reply = (verdict: "pass" | "uncertain") =>
      applied(
        context(
          {
            author_role: "team",
            events: [
              {
                type: "team_reply",
                ticket_id: T1,
                body: "The last payment we received was September.",
                proposes_answered: true,
                answer_check: { verdict, asked: "I still see the Oct charge", replied: "last payment was September" },
              },
            ],
          },
          { tickets: new Map([[T1, snapshot({ category: "offboarding", money_at_stake: true })]]) }
        )
      ).plan.events[0]
    expect(reply("uncertain").patch.status).toBeUndefined()
    expect(reply("uncertain").payload.proposed_answer_ignored).toBe("money at stake needs a passing answer check")
    expect(reply("pass").patch.status).toBe("answered")
  })

  it("lets a passing team reply answer a ticket still in triage (status new)", () => {
    const event = applied(
      context(
        {
          author_role: "team",
          events: [
            {
              type: "team_reply",
              ticket_id: T1,
              body: "Done: the minimum stay is now 3 nights.",
              proposes_answered: true,
              answer_check: { verdict: "pass", asked: "Change min stay to 3", replied: "min stay is now 3" },
            },
          ],
        },
        { tickets: new Map([[T1, snapshot({ status: "new" })]]) }
      )
    ).plan.events[0]
    expect(event.patch.status).toBe("answered")
    expect(event.payload.proposed_answer_ignored).toBeUndefined()
  })
})

describe("events on existing tickets", () => {
  const ticketsWith = (...list: CaptureTicketSnapshot[]) => new Map(list.map((t) => [t.id, t]))

  it("turns a client reply on a waiting ticket back to open", () => {
    const out = applied(
      context(
        { events: [{ type: "client_message", ticket_id: T1, body: "Go live on Oct 15" }] },
        { tickets: ticketsWith(snapshot({ status: "awaiting_client" })) }
      )
    )
    expect(out.plan.events[0]).toMatchObject({
      event_type: "client_message",
      external_key: `assembly:msg_1:client_message:${T1}`,
      patch: { status: "open", last_client_message_at: hoursAgo(1) },
      payload: { kind: "reply" },
    })
  })

  it("counts a chase on an overdue promise and raises rule-based priority", () => {
    const out = applied(
      context(
        { events: [{ type: "client_message", ticket_id: T1, body: "Any news?" }] },
        { tickets: ticketsWith(snapshot({ client_chase_count: 1, commitments: [promise({ due_at: hoursAgo(5) })] })) }
      )
    )
    expect(out.plan.events[0].patch).toMatchObject({ chase_delta: 1, priority: "high" })
  })

  it("never changes status or priority on a hand-managed ticket", () => {
    const out = applied(
      context(
        { events: [{ type: "client_message", ticket_id: T1, body: "Here you go" }] },
        {
          tickets: ticketsWith(
            snapshot({ status: "awaiting_client", hand_managed: true, client_chase_count: 5, commitments: [promise({ due_at: hoursAgo(5) })] })
          ),
        }
      )
    )
    expect(out.plan.events[0].patch.status).toBeUndefined()
    expect(out.plan.events[0].patch.priority).toBeUndefined()
    expect(out.plan.events[0].patch.last_client_message_at).toBe(hoursAgo(1))
  })

  it("does not start the reply clock on a thank-you", () => {
    const out = applied(
      context({ events: [{ type: "client_acknowledged", ticket_id: T1, body: "Thanks!" }] }, { tickets: ticketsWith(snapshot()) })
    )
    expect(out.plan.events[0].patch).toEqual({ client_acknowledged_at: hoursAgo(1) })
  })

  it("reopens an answered ticket the client rejects", () => {
    const out = applied(
      context(
        { events: [{ type: "client_rejected", ticket_id: T1, body: "That's November, I asked about December" }] },
        { tickets: ticketsWith(snapshot({ status: "answered" })) }
      )
    )
    expect(out.plan.events[0]).toMatchObject({ patch: { status: "open" }, payload: { miss: true } })
  })

  it("moves a passing proposed answer to answered, but never a failed one", () => {
    const reply = (verdict: "pass" | "fail") =>
      applied(
        context(
          {
            author_role: "team",
            author_name: "Andrés",
            events: [
              {
                type: "team_reply",
                ticket_id: T1,
                body: "Yes: 10% off Oct 12–31 at Boho Cottage, live today.",
                proposes_answered: true,
                answer_check: { verdict, asked: "yes or no", replied: "Yes: 10% off" },
              },
            ],
          },
          { tickets: ticketsWith(snapshot()) }
        )
      ).plan.events[0]
    expect(reply("pass").patch).toMatchObject({ status: "answered", answer_summary: "Yes: 10% off Oct 12–31 at Boho Cottage, live today." })
    const failed = reply("fail")
    expect(failed.patch.status).toBeUndefined()
    expect(failed.patch.answer_check_verdict).toBe("fail")
    expect(failed.payload.proposed_answer_ignored).toBe("answer check failed")
  })

  it("moves a ticket to waiting on client when the team asks something", () => {
    const out = applied(
      context(
        { author_role: "team", events: [{ type: "team_asked_client", ticket_id: T1, body: "Which dates?" }] },
        { tickets: ticketsWith(snapshot()) }
      )
    )
    expect(out.plan.events[0].patch.status).toBe("awaiting_client")
  })

  it("keeps, reschedules, and validates promises", () => {
    const tickets = ticketsWith(snapshot({ commitments: [promise()] }))
    const kept = applied(
      context({ author_role: "team", events: [{ type: "commitment_kept", ticket_id: T1, commitment_id: P1 }] }, { tickets })
    ).plan.events[0]
    expect(kept.commitment).toEqual({ op: "keep", id: P1, closed_at: hoursAgo(1) })
    expect(kept.payload.timing).toBe("kept_on_time")

    const missing = applied(
      context(
        { author_role: "team", events: [{ type: "commitment_kept", ticket_id: T1, commitment_id: T3 }] },
        { tickets }
      )
    )
    expect(missing.events[0]).toMatchObject({ outcome: "error", error: "promise not found on this ticket" })
  })

  it("reopens a resolved ticket when the team makes a new promise on it", () => {
    const out = applied(
      context(
        {
          author_role: "team",
          events: [
            { type: "commitment_made", ticket_id: T1, commitment: { description: "We'll re-check", due_source: "default_vague" } },
          ],
        },
        { tickets: ticketsWith(snapshot({ status: "resolved" })) }
      )
    )
    expect(out.plan.events[0].patch.status).toBe("open")
    expect(out.plan.events[0].commitment).toMatchObject({ op: "insert", due_at: hoursAhead(23) })
  })

  it("rejects events from the wrong side of the conversation", () => {
    const out = applied(
      context({ events: [{ type: "team_reply", ticket_id: T1, body: "Hi" }] }, { tickets: ticketsWith(snapshot()) })
    )
    expect(out.events[0]).toMatchObject({ outcome: "error" })
    expect(out.plan.ledger).toBeNull()
  })

  it("follows a merge to the ticket that stayed", () => {
    const out = applied(
      context(
        { events: [{ type: "client_message", ticket_id: T1, body: "Still waiting" }] },
        { tickets: ticketsWith(snapshot({ status: "dismissed", merged_into: T2 }), snapshot({ id: T2, ticket_number: 1030 })) }
      )
    )
    expect(out.events[0]).toMatchObject({ ticket_id: T2, redirected_from: T1 })
    expect(out.plan.events[0].ticket_id).toBe(T2)
  })

  it("refuses a ticket of another client", () => {
    const out = applied(
      context({ events: [{ type: "client_message", ticket_id: T1 }] }, { tickets: ticketsWith(snapshot({ client_id: OTHER_CLIENT })) })
    )
    expect(out.events[0]).toMatchObject({ outcome: "error", error: "ticket not found for this client" })
  })

  it("assigns a hand-off only to an unambiguous Hub user", () => {
    const handoff = (to: string) =>
      applied(
        context({ author_role: "team", events: [{ type: "handoff", ticket_id: T1, to_label: to }] }, { tickets: ticketsWith(snapshot()) })
      ).plan.events[0].patch.assignee_id
    expect(handoff("Gaston")).toBe(GASTON)
    expect(handoff("India team")).toBeUndefined()
  })

  it("skips a repeated event on the same ticket within one message", () => {
    const out = applied(
      context(
        {
          events: [
            { type: "client_message", ticket_id: T1, body: "Here are the dates" },
            { type: "client_message", ticket_id: T1, body: "Also the pet fee" },
          ],
        },
        { tickets: ticketsWith(snapshot({ status: "awaiting_client" })) }
      )
    )
    // Same message + type + ticket → same key: the repeat is skipped, not applied twice
    expect(out.events[1]).toMatchObject({ outcome: "skipped", reason: "same event already in this message" })
    expect(out.plan.events).toHaveLength(1)
    expect(out.plan.events[0].patch.status).toBe("open")
  })
})

describe("events in sequence", () => {
  it("lets a later event see an earlier event's effect on the same ticket", () => {
    const out = applied(
      context(
        {
          author_role: "team",
          events: [
            { type: "commitment_kept", ticket_id: T1, commitment_id: P1 },
            { type: "commitment_cancelled", ticket_id: T1, commitment_id: P1, note: "Handled on the call" },
          ],
        },
        { tickets: new Map([[T1, snapshot({ commitments: [promise()] })]]) }
      )
    )
    expect(out.events[1]).toMatchObject({ outcome: "error", error: "promise is already kept" })
  })
})

describe("event order inside a message", () => {
  it("computes priority once, so a reply listed before 'promise kept' doesn't flash high", () => {
    const out = applied(
      context(
        {
          author_role: "team",
          events: [
            { type: "team_reply", ticket_id: T1, body: "$380 is competitive; keep it.", proposes_answered: true,
              answer_check: { verdict: "pass", asked: "is $380 reasonable", replied: "$380 is competitive" } },
            { type: "commitment_kept", ticket_id: T1, commitment_id: P1 },
          ],
        },
        { tickets: new Map([[T1, snapshot({ commitments: [promise({ due_at: hoursAgo(5) })] })]]) }
      )
    )
    expect(out.plan.events.map((e) => e.patch.priority)).toEqual([undefined, undefined])
    expect(out.plan.events[1].payload.timing).toBe("kept_late")
  })
})

describe("matchProfile", () => {
  const profiles = [
    { id: "1", full_name: "Andrés Pérez", email: "aperez@revfactor.io" },
    { id: "2", full_name: "Andrés Gómez", email: "agomez@revfactor.io" },
  ]
  it("matches accents-insensitively and refuses ambiguity", () => {
    expect(matchProfile(profiles, "andres perez")?.id).toBe("1")
    expect(matchProfile(profiles, "agomez")?.id).toBe("2")
    expect(matchProfile(profiles, "Andrés")).toBeNull()
  })
})

describe("draft usage on team replies (v1.4)", () => {
  const ticketsWith = (...list: CaptureTicketSnapshot[]) => new Map(list.map((t) => [t.id, t]))
  const reply = (draftAt: string | null, used: string = "partly") =>
    applied(
      context(
        {
          author_role: "team",
          events: [{ type: "team_reply", ticket_id: T1, body: "Yes, 10% off October.", used_suggestion: used }],
        },
        { tickets: ticketsWith(snapshot({ suggested_reply_generated_at: draftAt })) }
      )
    ).plan.events[0].payload

  it("records how much of the draft the team used", () => {
    expect(reply(hoursAgo(3), "yes").used_suggestion).toBe("yes")
    expect(reply(hoursAgo(3), "no").used_suggestion).toBe("no")
  })

  it("drops the tag when the ticket had no draft before the reply", () => {
    for (const draftAt of [null, hoursAgo(0)]) {
      const payload = reply(draftAt)
      expect(payload.used_suggestion).toBeUndefined()
      expect(payload.used_suggestion_ignored).toBe("no draft before this reply")
    }
  })

  it("rejects unknown values", () => {
    expect(
      supportCaptureSchema.safeParse({
        source_message_id: "m",
        message_at: hoursAgo(1),
        author_role: "team",
        client: { hub_client_id: CLIENT },
        events: [{ type: "team_reply", ticket_id: T1, used_suggestion: "mostly" }],
      }).success
    ).toBe(false)
  })
})
