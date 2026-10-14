import { describe, expect, it } from "vitest"

import {
  CLIENT_JOURNEY_STEPS,
  computeClientJourney,
  isJourneyStepKey,
  type JourneyInput,
  type JourneyStepKey,
} from "@/lib/client-journey"

const NOW = new Date("2026-10-14T15:00:00Z")

function base(overrides: Partial<JourneyInput> = {}): JourneyInput {
  return {
    now: NOW,
    client: {
      onboarding_date: null,
      ending_date: null,
      status: "onboarding",
      assembly_client_id: null,
      pms_name: null,
      ghl_onboarding: null,
    },
    listings: [],
    reports: [],
    items: [],
    decisionEvents: [],
    setupAdjustments: [],
    pricingPlans: null,
    openTickets: 0,
    overrides: [],
    ...overrides,
  }
}

function step(input: JourneyInput, key: JourneyStepKey) {
  const s = computeClientJourney(input).steps.find((x) => x.key === key)
  if (!s) throw new Error(`missing step ${key}`)
  return s
}

const LISTING = { id: "l1", status: "active", listing_id: "pl-1", pl_synced_at: "2026-10-13T10:00:00Z" }
const REPORT = {
  id: "r1",
  listing_id: "l1",
  status: "published",
  published_at: "2026-10-02T12:00:00Z",
  owner_message_sent_at: null as string | null,
}

describe("computeClientJourney", () => {
  it("returns every step in order with stable keys", () => {
    const journey = computeClientJourney(base())
    expect(journey.steps.map((s) => s.key)).toEqual(CLIENT_JOURNEY_STEPS.map((s) => s.key))
    expect(new Set(journey.steps.map((s) => s.key)).size).toBe(journey.steps.length)
  })

  it("an empty client starts with the discovery call as next", () => {
    const journey = computeClientJourney(base())
    expect(journey.steps[0].status).toBe("next")
    expect(journey.next?.key).toBe("discovery_call")
    expect(journey.steps.filter((s) => s.status === "next")).toHaveLength(1)
  })

  it("agreement comes from GHL evidence, then the contract date", () => {
    const signed = base({
      client: {
        ...base().client,
        onboarding_date: "2026-10-01",
        ghl_onboarding: { agreement_evidence: ["rf-subscription-agreement-q1-signed"], appointment: null },
      },
    })
    expect(step(signed, "agreement_signed")).toMatchObject({ status: "done", date: "2026-10-01" })
    expect(step(signed, "agreement_signed").evidence).toContain("GHL")
    expect(step(signed, "discovery_call").status).toBe("done")

    const contractOnly = base({ client: { ...base().client, onboarding_date: "2026-10-01" } })
    expect(step(contractOnly, "agreement_signed").evidence).toContain("Contract start")
    expect(computeClientJourney(contractOnly).health.daysSinceSigning).toBe(13)
  })

  it("portal is done when assembly_client_id is present", () => {
    const input = base({ client: { ...base().client, assembly_client_id: "asm-1" } })
    expect(step(input, "payment_portal").status).toBe("done")
  })

  it("onboarding call reads the GHL appointment", () => {
    const appt = (start: string, status: string) =>
      base({ client: { ...base().client, ghl_onboarding: { agreement_evidence: [], appointment: { start, status } } } })
    expect(step(appt("2026-10-10T16:00:00Z", "confirmed"), "onboarding_call").status).toBe("done")
    expect(step(appt("2026-10-20T16:00:00Z", "confirmed"), "onboarding_call")).toMatchObject({
      status: "todo",
      date: "2026-10-20T16:00:00Z",
    })
    expect(step(appt("2026-10-10T16:00:00Z", "cancelled"), "onboarding_call").status).toBe("blocked")

    const legacyClient = base({
      setupAdjustments: [
        { status: "controlled", created_at: "2026-08-01T00:00:00Z", resolved_at: "2026-08-02T00:00:00Z", controlled_at: null },
      ],
    })
    expect(step(legacyClient, "onboarding_call").status).toBe("done")
    expect(step(base(), "onboarding_call").status).toBe("todo")
  })

  it("audit published and sent are separate checks", () => {
    const published = base({ listings: [LISTING], reports: [REPORT] })
    expect(step(published, "audit_published")).toMatchObject({ status: "done", date: REPORT.published_at })
    expect(step(published, "audit_sent").status).not.toBe("done")
    expect(step(published, "audit_sent").evidence).toContain("not sent")

    const sent = base({
      listings: [LISTING],
      reports: [{ ...REPORT, owner_message_sent_at: "2026-10-03T09:00:00Z" }],
    })
    expect(step(sent, "audit_sent")).toMatchObject({ status: "done", date: "2026-10-03T09:00:00Z" })
  })

  it("drafts and archived reviews don't count as published", () => {
    const input = base({
      reports: [
        { ...REPORT, id: "d", status: "draft", published_at: null },
        { ...REPORT, id: "a", status: "archived" },
      ],
    })
    expect(step(input, "audit_published").status).not.toBe("done")
  })

  it("owner decision comes from DecideSuggestion events and stalls after a week", () => {
    const sentAt = "2026-10-01T09:00:00Z"
    const reports = [{ ...REPORT, owner_message_sent_at: sentAt }]
    const items = [
      { report_id: "r1", kind: "change", client_status: "accepted", apply_status: "queued" },
      { report_id: "r1", kind: "owner_choice", client_status: "pending", apply_status: "not_started" },
      { report_id: "r1", kind: "info", client_status: "pending", apply_status: "not_started" },
    ]
    const decided = base({ reports, items, decisionEvents: [{ report_id: "r1", created_at: "2026-10-04T10:00:00Z" }] })
    expect(step(decided, "owner_decided")).toMatchObject({ status: "done", date: "2026-10-04T10:00:00Z" })
    expect(computeClientJourney(decided).health).toMatchObject({ decisionsDone: 1, decisionsTotal: 2 })

    const stalled = base({ reports, items, decisionEvents: [] })
    expect(step(stalled, "owner_decided").status).toBe("blocked")
    expect(computeClientJourney(stalled).blocking.map((s) => s.key)).toContain("owner_decided")
  })

  it("access is verified when every active listing syncs; a missing PriceLabs ID blocks it", () => {
    const ok = base({ listings: [LISTING, { ...LISTING, id: "l2", status: "inactive", pl_synced_at: null }] })
    expect(step(ok, "access_verified").status).toBe("done")

    const partial = base({ listings: [LISTING, { ...LISTING, id: "l2", pl_synced_at: null }] })
    expect(step(partial, "access_verified").status).toBe("next")

    const missing = base({ listings: [{ ...LISTING, listing_id: null }] })
    expect(step(missing, "access_verified").status).toBe("blocked")
  })

  it("pricing plan is todo when the table is missing, done when every listing is approved", () => {
    expect(step(base({ listings: [LISTING] }), "pricing_plan_approved")).toMatchObject({ status: expect.any(String) })
    expect(step(base({ listings: [LISTING] }), "pricing_plan_approved").evidence).toContain("aren't in the Hub")

    const approved = base({
      listings: [LISTING],
      pricingPlans: [{ listing_id: "l1", status: "approved", approved_at: "2026-10-05T00:00:00Z" }],
    })
    expect(step(approved, "pricing_plan_approved")).toMatchObject({ status: "done", date: "2026-10-05T00:00:00Z" })

    const draft = base({ listings: [LISTING], pricingPlans: [{ listing_id: "l1", status: "draft", approved_at: null }] })
    expect(step(draft, "pricing_plan_approved").status).not.toBe("done")
  })

  it("setup is applied from resolved/controlled setup adjustments", () => {
    const row = (status: string, resolved_at: string | null = null) => ({
      status,
      created_at: "2026-10-02T00:00:00Z",
      resolved_at,
      controlled_at: null,
    })
    expect(step(base({ setupAdjustments: [row("controlled", "2026-10-06T00:00:00Z")] }), "setup_applied")).toMatchObject({
      status: "done",
      date: "2026-10-06T00:00:00Z",
    })
    expect(step(base({ setupAdjustments: [row("open")] }), "setup_applied").status).toBe("next")
    expect(step(base({ setupAdjustments: [row("issue")] }), "setup_applied").status).toBe("blocked")
    expect(step(base({ setupAdjustments: null }), "setup_applied").evidence).toContain("not visible")
  })

  it("90-day checkpoints are due from the launch anchor", () => {
    const input = base({
      client: { ...base().client, onboarding_date: "2026-09-01" },
      setupAdjustments: [
        { status: "resolved", created_at: "2026-09-02T00:00:00Z", resolved_at: "2026-09-05T00:00:00Z", controlled_at: null },
      ],
    })
    expect(step(input, "day_14_pickup")).toMatchObject({ status: "next", date: "2026-09-19" })
    expect(step(input, "day_30_review")).toMatchObject({ status: "next", date: "2026-10-05" })
    expect(step(input, "day_60_90_checkins")).toMatchObject({ status: "todo", date: "2026-11-04" })
  })

  it("owner accepts changes once accepted items are applied", () => {
    const reports = [REPORT]
    const waiting = base({
      reports,
      items: [{ report_id: "r1", kind: "change", client_status: "accepted", apply_status: "queued" }],
    })
    expect(step(waiting, "owner_accepts_changes").status).toBe("next")
    const applied = base({
      reports,
      items: [{ report_id: "r1", kind: "change", client_status: "accepted", apply_status: "verified" }],
    })
    expect(step(applied, "owner_accepts_changes").status).toBe("done")
  })

  it("manual overrides win and keep the computed status for reference", () => {
    const input = base({
      overrides: [
        { step_key: "launch_report_sent", status: "done", done_at: "2026-10-08", note: "Sent by Fede", updated_at: null },
        { step_key: "payment_portal", status: "blocked", done_at: null, note: "Card failed", updated_at: null },
        { step_key: "not_a_step", status: "done", done_at: null, note: null, updated_at: null },
      ],
    })
    expect(step(input, "launch_report_sent")).toMatchObject({
      status: "done",
      computedStatus: "todo",
      date: "2026-10-08",
      overridden: true,
      note: "Sent by Fede",
    })
    expect(computeClientJourney(input).blocking.map((s) => s.key)).toEqual(["payment_portal"])
    expect(isJourneyStepKey("not_a_step")).toBe(false)
  })

  it("health reports open tickets and unknown sources as null", () => {
    const journey = computeClientJourney(base({ openTickets: null, items: null }))
    expect(journey.health).toMatchObject({ openTickets: null, decisionsDone: null, decisionsTotal: null })
  })
})
