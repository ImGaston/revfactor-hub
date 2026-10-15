import { describe, expect, it } from "vitest"

import { draftReportSchema } from "@/lib/listing-optimization-input"
import {
  AIRBNB_HOST_PROFILE_EDIT_URL,
  decisionProgress,
  groupItemsBySection,
  isDecisionLocked,
  ownerSendGroups,
  sectionPriority,
  validateDecision,
  type OptimizationItem,
} from "@/lib/listing-optimization"

function item(partial: Partial<OptimizationItem> = {}): OptimizationItem {
  return {
    id: "i1",
    section: "title",
    kind: "change",
    priority: "medium",
    sort_order: 0,
    headline: "Fix title",
    rationale: null,
    current_value: "Old",
    proposed_value: "New",
    options: [],
    photo_url: null,
    action_url: null,
    check_id: null,
    client_status: "pending",
    client_choice: null,
    client_note: null,
    decided_at: null,
    apply_status: "not_started",
    ...partial,
  }
}

describe("validateDecision", () => {
  it("rejects decisions on info items", () => {
    const r = validateDecision({ item: item({ kind: "info" }), decision: "accept" })
    expect(r.ok).toBe(false)
  })

  it("rejects changes once applied or live", () => {
    expect(validateDecision({ item: item({ apply_status: "applied" }), decision: "decline" }).ok).toBe(false)
    expect(validateDecision({ item: item({ apply_status: "verified" }), decision: "reset" }).ok).toBe(false)
    expect(validateDecision({ item: item({ apply_status: "queued" }), decision: "decline" }).ok).toBe(true)
  })

  it("defaults the accepted choice to the proposal, then the first option", () => {
    const a = validateDecision({ item: item(), decision: "accept" })
    expect(a).toEqual({ ok: true, choice: "New", note: null })
    const b = validateDecision({
      item: item({ proposed_value: null, options: ["A", "B"] }),
      decision: "accept",
    })
    expect(b).toEqual({ ok: true, choice: "A", note: null })
  })

  it("keeps the owner's edited text and trims notes", () => {
    const r = validateDecision({
      item: item(),
      decision: "accept",
      choice: "  My title  ",
      note: "  thanks ",
    })
    expect(r).toEqual({ ok: true, choice: "My title", note: "thanks" })
  })

  it("drops the choice when declining", () => {
    const r = validateDecision({ item: item(), decision: "decline", choice: "x" })
    expect(r).toEqual({ ok: true, choice: null, note: null })
  })

  it("rejects oversized notes and text", () => {
    expect(validateDecision({ item: item(), decision: "decline", note: "x".repeat(1001) }).ok).toBe(false)
    expect(validateDecision({ item: item(), decision: "accept", choice: "x".repeat(5001) }).ok).toBe(false)
  })
})

describe("grouping and progress", () => {
  const items = [
    item({ id: "c2", section: "captions", sort_order: 2 }),
    item({ id: "t", section: "title", priority: "high", client_status: "accepted" }),
    item({ id: "c1", section: "captions", sort_order: 1, client_status: "declined" }),
    item({ id: "p", section: "other", kind: "info", priority: "high" }),
  ]

  it("orders sections canonically and items by sort_order", () => {
    const groups = groupItemsBySection(items)
    expect(groups.map((g) => g.section)).toEqual(["title", "captions", "other"])
    expect(groups[1].items.map((i) => i.id)).toEqual(["c1", "c2"])
  })

  it("counts only actionable items", () => {
    expect(decisionProgress(items)).toEqual({ total: 3, decided: 2, accepted: 1, declined: 1 })
  })

  it("ignores info items for section priority", () => {
    expect(sectionPriority([items[3]])).toBeNull()
    expect(sectionPriority([items[0], items[1]])).toBe("high")
  })

  it("locks only applied or live items", () => {
    expect(isDecisionLocked({ apply_status: "queued" })).toBe(false)
    expect(isDecisionLocked({ apply_status: "verified" })).toBe(true)
  })
})

describe("owner tasks", () => {
  it("stay undoable after the owner marks them done", () => {
    expect(isDecisionLocked({ kind: "owner_task", apply_status: "applied" })).toBe(false)
    const r = validateDecision({
      item: item({ kind: "owner_task", apply_status: "applied" }),
      decision: "reset",
    })
    expect(r.ok).toBe(true)
  })
})

describe("draftReportSchema", () => {
  const base = {
    client_id: "e0b1a843-33e3-4f79-9582-a4ffac13b7d8",
    report: { listing_title: "Lake cabin" },
  }

  it("drops pricing items (listing content only)", () => {
    const r = draftReportSchema.parse({
      ...base,
      items: [
        { section: "title", headline: "Fix title" },
        { section: "pricing", kind: "info", headline: "Cleaning fee is low" },
      ],
    })
    expect(r.items.map((i) => i.section)).toEqual(["title"])
  })

  it("links host-profile owner tasks to the Airbnb profile editor by default", () => {
    const r = draftReportSchema.parse({
      ...base,
      items: [{ section: "host_profile", kind: "owner_task", headline: "Fill in your bio" }],
    })
    expect(r.items[0].action_url).toBe(AIRBNB_HOST_PROFILE_EDIT_URL)
  })

  it("rejects owner-task links outside airbnb.com", () => {
    const r = draftReportSchema.safeParse({
      ...base,
      items: [
        {
          section: "host_profile",
          kind: "owner_task",
          headline: "Fill in your bio",
          action_url: "https://example.com/profile",
        },
      ],
    })
    expect(r.success).toBe(false)
  })
})

describe("ownerSendGroups", () => {
  const row = (id: string, client_id: string, status: string, sent: string | null = null) => ({
    id,
    client_id,
    client_name: client_id === "s" ? "Spencer Ritterskamp" : "Kasey Booth",
    status,
    owner_message_sent_at: sent,
  })

  it("groups owners with two or more unsent drafts or published reviews", () => {
    const groups = ownerSendGroups([
      row("a", "s", "draft"),
      row("b", "s", "published"),
      row("c", "k", "draft"),
      row("d", "k", "archived"),
      row("e", "k", "published", "2026-10-14T00:00:00Z"),
    ])
    expect(groups).toEqual([{ clientId: "s", clientName: "Spencer Ritterskamp", reportIds: ["a", "b"] }])
  })
})
