import { describe, expect, it } from "vitest"

import {
  askFingerprint,
  bucketSupportTickets,
  classifyClientMessage,
  commitmentTiming,
  decideCapturedStatus,
  derivePriority,
  detectCredential,
  honorsProposedAnswer,
  isDoneNotTold,
  maskContactDetails,
  matchListingRefs,
  nextDueAt,
  promiseLikelyKept,
  resolutionBlockers,
  resolveDefaultAssignee,
  SUPPORT_DEFAULT_ROUTING,
  supportCaptureSchema,
  supportDismissSchema,
  supportStats,
  validateSupportTicketForm,
  type SupportTicket,
  type SupportTicketCommitment,
} from "@/lib/support-tickets"

const NOW = new Date("2026-09-29T15:00:00Z")
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const hoursAhead = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()

function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: overrides.id ?? "t1",
    ticket_number: 1001,
    client_id: "c1",
    property_scope: "listings",
    property_validated_at: hoursAgo(10),
    category: "pricing",
    request_type: "question",
    summary: "How is December pacing?",
    client_message: null,
    requested_by_name: "Dana Whitfield",
    requested_at: hoursAgo(10),
    time_window: null,
    source: "assembly",
    source_message_id: "msg_1",
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
    last_client_message_at: hoursAgo(10),
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
    support_ticket_commitments: [],
    adjustments: [],
    ...overrides,
  }
}

function promise(overrides: Partial<SupportTicketCommitment> = {}): SupportTicketCommitment {
  return {
    id: "p1",
    ticket_id: "t1",
    description: "Send the comps analysis",
    due_at: hoursAhead(10),
    due_source: "explicit",
    rescheduled_to: null,
    status: "open",
    made_by_name: "Andrés",
    made_at: hoursAgo(5),
    source: "bot",
    closed_at: null,
    close_note: null,
    created_at: hoursAgo(5),
    ...overrides,
  }
}

describe("matchListingRefs", () => {
  const listings = [
    { id: "L1", name: "Boho Cottage | TX | Ngozi", listing_id: "pl_111", airbnb_link: "https://www.airbnb.com/rooms/53118765" },
    { id: "L2", name: "Birch Ave Bungalow | NJ | Dana", listing_id: "1329788633582491000", airbnb_link: null },
    { id: "L3", name: "Birch Lane Loft", listing_id: null, airbnb_link: null },
  ]

  it("matches by hub id, PriceLabs id, Airbnb id, and the public part of the name", () => {
    const { matchedIds, unresolved } = matchListingRefs(listings, [
      { hub_listing_id: "L3" },
      { pricelabs_listing_id: "pl_111" },
      { airbnb_id: "1329788633582491000" },
      { name_hint: "boho cottage" },
    ])
    expect(matchedIds.sort()).toEqual(["L1", "L2", "L3"])
    expect(unresolved).toEqual([])
  })

  it("reads the Airbnb id from the stored link", () => {
    expect(matchListingRefs(listings, [{ airbnb_id: "53118765" }]).matchedIds).toEqual(["L1"])
  })

  it("leaves an ambiguous partial name unresolved instead of guessing", () => {
    const { matchedIds, unresolved } = matchListingRefs(listings, [{ name_hint: "Birch" }])
    expect(matchedIds).toEqual([])
    expect(unresolved).toEqual([{ name_hint: "Birch" }])
  })

  it("accepts a unique partial name", () => {
    expect(matchListingRefs(listings, [{ name_hint: "Bungalow" }]).matchedIds).toEqual(["L2"])
  })
})

describe("promises", () => {
  it("judges kept-on-time against the ORIGINAL due date, even after a reschedule", () => {
    const rescheduled = promise({
      due_at: hoursAgo(20),
      rescheduled_to: hoursAgo(2),
      status: "kept",
      closed_at: hoursAgo(5),
    })
    expect(commitmentTiming(rescheduled, NOW)).toBe("kept_late")
    expect(
      commitmentTiming(promise({ due_at: hoursAgo(1), status: "kept", closed_at: hoursAgo(2) }), NOW)
    ).toBe("kept_on_time")
  })

  it("uses the working (rescheduled) date for an open promise", () => {
    const p = promise({ due_at: hoursAgo(20), rescheduled_to: hoursAhead(4) })
    expect(commitmentTiming(p, NOW)).toBe("open")
    expect(commitmentTiming(promise({ due_at: hoursAgo(1) }), NOW)).toBe("overdue")
  })

  it("flags a promise as likely kept once a later Adjustment is controlled", () => {
    const p = promise({ made_at: hoursAgo(30) })
    expect(promiseLikelyKept(p, [{ status: "controlled", controlled_at: hoursAgo(3) }])).toBe(true)
    expect(promiseLikelyKept(p, [{ status: "controlled", controlled_at: hoursAgo(40) }])).toBe(false)
    expect(promiseLikelyKept(p, [{ status: "resolved", controlled_at: null }])).toBe(false)
  })
})

describe("nextDueAt", () => {
  it("puts the reply SLA 24h after an unanswered client message", () => {
    expect(nextDueAt(ticket({ last_client_message_at: hoursAgo(10) }))?.toISOString()).toBe(
      hoursAhead(14)
    )
  })

  it("takes the earliest of promise and reply SLA", () => {
    const t = ticket({ support_ticket_commitments: [promise({ due_at: hoursAhead(3) })] })
    expect(nextDueAt(t)?.toISOString()).toBe(hoursAhead(3))
  })

  it("stops the reply clock while waiting on the client, but keeps promises", () => {
    expect(nextDueAt(ticket({ status: "awaiting_client" }))).toBeNull()
    const withPromise = ticket({
      status: "awaiting_client",
      support_ticket_commitments: [promise({ due_at: hoursAhead(6) })],
    })
    expect(nextDueAt(withPromise)?.toISOString()).toBe(hoursAhead(6))
  })

  it("starts a backfilled ticket's clock at import, not the original ask", () => {
    const t = ticket({ last_client_message_at: hoursAgo(300), sla_anchor_at: hoursAgo(1) })
    expect(nextDueAt(t)?.toISOString()).toBe(hoursAhead(23))
  })

  it("is null once closed", () => {
    expect(nextDueAt(ticket({ status: "resolved" }))).toBeNull()
  })
})

describe("done, client not told", () => {
  const change = (overrides: Partial<SupportTicket> = {}) =>
    ticket({
      request_type: "change",
      last_team_message_at: hoursAgo(1),
      adjustments: [
        { id: "a1", type: "min_stay", status: "controlled", target_value: "2", controlled_at: hoursAgo(30), listings: null },
      ],
      ...overrides,
    })

  it("becomes overdue 24h after the Adjustment was controlled", () => {
    const t = change()
    expect(isDoneNotTold(t)).toBe(true)
    expect(bucketSupportTickets([t], NOW).overdue).toHaveLength(1)
  })

  it("does not apply while an Adjustment is still open, or once the client was told", () => {
    expect(
      isDoneNotTold(
        change({
          adjustments: [
            { id: "a1", type: "min_stay", status: "controlled", target_value: null, controlled_at: hoursAgo(30), listings: null },
            { id: "a2", type: "price", status: "open", target_value: null, controlled_at: null, listings: null },
          ],
        })
      )
    ).toBe(false)
    expect(isDoneNotTold(change({ client_told_live_at: hoursAgo(2) }))).toBe(false)
    expect(isDoneNotTold(change({ request_type: "question" }))).toBe(false)
  })
})

describe("classifyClientMessage", () => {
  it("is a reply when we were waiting on the client", () => {
    expect(classifyClientMessage(ticket({ status: "awaiting_client" }), NOW).kind).toBe("reply")
  })

  it("is a chase when a promise is past due", () => {
    const t = ticket({
      last_team_message_at: hoursAgo(1),
      support_ticket_commitments: [promise({ due_at: hoursAgo(2) })],
    })
    expect(classifyClientMessage(t, NOW)).toEqual({ kind: "chase", chaseDelta: 1, nudgeDelta: 0 })
  })

  it("is a chase after 2h of an unanswered message, a continuation before", () => {
    expect(classifyClientMessage(ticket({ last_client_message_at: hoursAgo(3) }), NOW).kind).toBe("chase")
    expect(
      classifyClientMessage(ticket({ last_client_message_at: hoursAgo(1) }), NOW).kind
    ).toBe("continuation")
  })

  it("counts a polite follow-up as a nudge, and the second nudge as a chase too", () => {
    const answered = { last_client_message_at: hoursAgo(10), last_team_message_at: hoursAgo(5) }
    expect(classifyClientMessage(ticket(answered), NOW)).toEqual({
      kind: "nudge",
      chaseDelta: 0,
      nudgeDelta: 1,
    })
    expect(classifyClientMessage(ticket({ ...answered, client_nudge_count: 1 }), NOW)).toEqual({
      kind: "nudge",
      chaseDelta: 1,
      nudgeDelta: 1,
    })
  })
})

describe("derivePriority", () => {
  const base = {
    sentiment: "neutral" as const,
    churnRisk: null,
    chaseCount: 0,
    category: "pricing" as const,
    moneyAtStake: false,
    hasOverduePromise: false,
  }

  it("follows the rules", () => {
    expect(derivePriority(base)).toBe("medium")
    expect(derivePriority({ ...base, sentiment: "unhappy" })).toBe("high")
    expect(derivePriority({ ...base, sentiment: "unhappy", churnRisk: "high" })).toBe("urgent")
    expect(derivePriority({ ...base, chaseCount: 2 })).toBe("high")
    expect(derivePriority({ ...base, chaseCount: 3 })).toBe("urgent")
    expect(derivePriority({ ...base, hasOverduePromise: true })).toBe("high")
    expect(derivePriority({ ...base, category: "offboarding", moneyAtStake: true })).toBe("urgent")
    expect(derivePriority({ ...base, category: "pricing", moneyAtStake: true })).toBe("medium")
  })
})

describe("decideCapturedStatus", () => {
  const ok = {
    propertyValidated: true,
    requestTypeConfidence: 0.9,
    possibleDuplicate: false,
    needsAttachmentReview: false,
  }

  it("opens a confident, validated, unique ask", () => {
    expect(decideCapturedStatus(ok)).toEqual({ status: "open", reasons: [] })
  })

  it("sends anything doubtful to triage with the reasons", () => {
    expect(decideCapturedStatus({ ...ok, requestTypeConfidence: 0.79 }).reasons).toEqual([
      "low_request_type_confidence",
    ])
    const all = decideCapturedStatus({
      propertyValidated: false,
      requestTypeConfidence: null,
      possibleDuplicate: true,
      needsAttachmentReview: true,
    })
    expect(all.status).toBe("new")
    expect(all.reasons).toHaveLength(4)
  })
})

describe("resolveDefaultAssignee", () => {
  const rules = [
    { category: null, request_type: null, assignee_id: "catch_all", rank: 100 },
    { category: "pricing" as const, request_type: null, assignee_id: "andres", rank: 10 },
    { category: null, request_type: "decision" as const, assignee_id: "gaston", rank: 10 },
    { category: "billing" as const, request_type: null, assignee_id: "fede", rank: 10 },
  ]

  it("routes the agreed defaults: changes, decisions to strategy, money to money", () => {
    const people = { changes: "andres", strategy: "gaston", money: "fede" } as const
    const agreed = SUPPORT_DEFAULT_ROUTING.map((r) => ({ ...r, assignee_id: people[r.role] }))
    expect(resolveDefaultAssignee(agreed, "pricing", "change")).toBe("andres")
    expect(resolveDefaultAssignee(agreed, "onboarding", "question")).toBe("andres")
    expect(resolveDefaultAssignee(agreed, "pricing", "decision")).toBe("gaston")
    expect(resolveDefaultAssignee(agreed, "performance", "question")).toBe("gaston")
    expect(resolveDefaultAssignee(agreed, "billing", "decision")).toBe("fede")
    expect(resolveDefaultAssignee(agreed, "offboarding", "change")).toBe("fede")
    expect(resolveDefaultAssignee(agreed, "other", "issue")).toBe("gaston")
  })

  it("prefers the most specific rule", () => {
    expect(resolveDefaultAssignee(rules, "pricing", "change")).toBe("andres")
    expect(resolveDefaultAssignee(rules, "performance", "decision")).toBe("gaston")
    expect(resolveDefaultAssignee(rules, "billing", "decision")).toBe("fede")
    expect(resolveDefaultAssignee(rules, "other", "question")).toBe("catch_all")
    expect(resolveDefaultAssignee([], "other", "question")).toBeNull()
  })
})

describe("askFingerprint", () => {
  const base = {
    requestType: "decision" as const,
    category: "pricing" as const,
    propertyScope: "listings" as const,
    listingIds: ["L2", "L1"],
    timeWindow: "2027-07",
  }

  it("ignores listing order and time-window formatting", () => {
    expect(askFingerprint(base)).toBe(
      askFingerprint({ ...base, listingIds: ["L1", "L2", "L1"], timeWindow: " 2027-07 " })
    )
  })

  it("changes when what the ask is changes", () => {
    const fp = askFingerprint(base)
    expect(askFingerprint({ ...base, timeWindow: "2027-08" })).not.toBe(fp)
    expect(askFingerprint({ ...base, requestType: "question" })).not.toBe(fp)
    expect(askFingerprint({ ...base, propertyScope: "portfolio", listingIds: [] })).not.toBe(fp)
  })
})

describe("sensitive content", () => {
  it("detects credentials the bot failed to redact", () => {
    expect(detectCredential("PriceLabs login password: Hunter22!")).toBe("password")
    expect(detectCredential("the door code is 4821")).toBe("access code")
    expect(detectCredential("key sk_live_abcdefghijk12345")).toBe("api key")
    expect(detectCredential("card 4111 1111 1111 1111 exp 09/28")).toBe("card number")
    expect(detectCredential("Your Expedia Group verification code is: 482913")).toBe("one-time code")
    expect(detectCredential("Tu código de verificación es 604218")).toBe("one-time code")
  })

  it("does not reject ordinary asks, redaction markers, or Airbnb ids", () => {
    expect(detectCredential("I need a password reset for PriceLabs")).toBeNull()
    expect(detectCredential("password: [redacted: credential]")).toBeNull()
    expect(detectCredential("Your Expedia Group verification code is: [redacted: credential]")).toBeNull()
    expect(detectCredential("If you could send the code for VRBO to ***-***-0181")).toBeNull()
    expect(detectCredential("https://www.airbnb.com/rooms/1329788633582491000?adults=2")).toBeNull()
    expect(detectCredential("listing 1329788633582491000 min price $400 Oct 12-14")).toBeNull()
  })

  it("masks emails and phone numbers but not dates", () => {
    expect(maskContactDetails("mail dana@example.com or call 555-201-4477 on 2026-10-12")).toBe(
      "mail d***@example.com or call ***-***-4477 on 2026-10-12"
    )
  })
})

describe("queue and gate", () => {
  it("keeps triage first even when overdue, and separates verify / client / us", () => {
    const q = bucketSupportTickets(
      [
        ticket({ id: "new", status: "new", last_client_message_at: hoursAgo(40) }),
        ticket({ id: "late", last_client_message_at: hoursAgo(30) }),
        ticket({ id: "verify", status: "answered", answered_at: hoursAgo(2), last_team_message_at: hoursAgo(2) }),
        ticket({ id: "client", status: "awaiting_client" }),
        ticket({ id: "us" }),
      ],
      NOW
    )
    expect(q.triage.map((t) => t.id)).toEqual(["new"])
    expect(q.overdue.map((t) => t.id)).toEqual(["late"])
    expect(q.verify.map((t) => t.id)).toEqual(["verify"])
    expect(q.onClient.map((t) => t.id)).toEqual(["client"])
    expect(q.onUs.map((t) => t.id)).toEqual(["us"])
  })

  it("lists what blocks a change ticket from resolving", () => {
    const blockers = resolutionBlockers(
      ticket({
        request_type: "change",
        property_scope: "unknown",
        support_ticket_commitments: [promise()],
        adjustments: [{ id: "a", type: "price", status: "resolved", target_value: null, controlled_at: null, listings: null }],
      })
    )
    expect(blockers).toEqual([
      "Validate which property the ask is about",
      "Record the answer given to the client",
      "Close or cancel the open promise",
      "A linked Adjustment is not controlled yet",
      "Tell the client the change is live",
    ])
  })

  it("keeps backfilled promises out of the on-time rate and reports backlog", () => {
    const stats = supportStats(
      [
        ticket({ id: "b1", backfilled: true, backfill_batch: "2026-09-28-recheck", status: "resolved" }),
        ticket({ id: "b2", backfilled: true, backfill_batch: "2026-09-28-recheck" }),
      ],
      [
        { status: "kept", due_at: hoursAgo(10), rescheduled_to: null, closed_at: hoursAgo(12) },
        { status: "kept", due_at: hoursAgo(10), rescheduled_to: null, closed_at: hoursAgo(5) },
        { status: "kept", due_at: hoursAgo(10), rescheduled_to: null, closed_at: hoursAgo(1), backfilled: true },
      ],
      { sentBack30d: 2, clientRejected30d: 1 },
      NOW
    )
    expect(stats.promisesClosed30d).toBe(2)
    expect(stats.promiseOnTimeRate).toBe(0.5)
    expect(stats.backlogOpen).toBe(1)
    expect(stats.backlogCleared).toBe(1)
  })
})

describe("contracts", () => {
  const capture = {
    source_message_id: "msg_8f2c1",
    message_at: "2026-09-25T14:05:00Z",
    author_role: "client",
    client: { assembly_company_id: "comp_123" },
    tickets: [
      {
        summary: "Yes or no: discount Boho Cottage for October and November?",
        category: "pricing",
        request_type: "decision",
        time_window: "2026-10/2026-11",
        property: { scope: "listings", listings: [{ name_hint: "Boho Cottage" }] },
        ai: { confidence: { category: 0.9, request_type: 0.95 } },
      },
    ],
  }

  it("accepts a client message that creates a ticket", () => {
    const parsed = supportCaptureSchema.safeParse(capture)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.source).toBe("assembly")
  })

  it("rejects tickets created from a team message", () => {
    expect(supportCaptureSchema.safeParse({ ...capture, author_role: "team" }).success).toBe(false)
  })

  it("requires a due date for explicit and relative promises", () => {
    const withPromise = (commitment: object) => ({
      ...capture,
      tickets: [{ ...capture.tickets[0], commitments: [commitment] }],
    })
    expect(
      supportCaptureSchema.safeParse(withPromise({ description: "We'll review", due_source: "default_vague" })).success
    ).toBe(true)
    expect(
      supportCaptureSchema.safeParse(withPromise({ description: "By Monday", due_source: "relative" })).success
    ).toBe(false)
  })

  it("never moves a failed answer to answered", () => {
    const reply = {
      type: "team_reply" as const,
      ticket_id: "7b0c7a3e-5d4b-4f7e-9d2a-1c1e0f2a3b4c",
      proposes_answered: true,
      answer_check: { verdict: "fail" as const, asked: "yes or no", replied: "October is at 41%" },
    }
    expect(honorsProposedAnswer(reply)).toBe(false)
    expect(honorsProposedAnswer({ ...reply, answer_check: { ...reply.answer_check, verdict: "uncertain" } })).toBe(true)
  })

  it("validates the manual form and blocks credentials", () => {
    const form = {
      client_id: "7b0c7a3e-5d4b-4f7e-9d2a-1c1e0f2a3b4c",
      summary: "Lower weekend minimum to 2 nights",
      category: "stay_rules",
      request_type: "change",
      property_scope: "listings",
      listing_ids: [],
    }
    expect(validateSupportTicketForm(form)).toEqual({
      error: "Pick at least one property, or choose a different scope",
    })
    expect(
      validateSupportTicketForm({ ...form, property_scope: "portfolio", client_message: "pw: Summer2026!" })
    ).toEqual({
      error: "Remove the password from the text before saving — never store credentials in tickets",
    })
    expect("value" in validateSupportTicketForm({ ...form, property_scope: "portfolio" })).toBe(true)
  })

  it("requires a note when dismissing as a duplicate or handled offline", () => {
    expect(supportDismissSchema.safeParse({ reason: "duplicate" }).success).toBe(false)
    expect(supportDismissSchema.safeParse({ reason: "duplicate", note: "Same as #1029" }).success).toBe(true)
    expect(supportDismissSchema.safeParse({ reason: "client_self_resolved" }).success).toBe(true)
  })
})
