import { describe, expect, it } from "vitest"
import { CLIENT_CHURN_REASONS } from "@/lib/clients"
import {
  EMPTY_CHURN_FILTERS,
  filterChurnClients,
  filterLeavingClients,
  filterListingExits,
  listingExitSchema,
  marketLabel,
  reportDate,
  summarizeChurn,
  tenureMonths,
  validDate,
  type ChurnClient,
  type ListingExit,
} from "@/lib/churn"

const client: ChurnClient = {
  id: "client",
  name: "Client",
  markets: ["Austin, TX", "Dallas, TX"],
  onboarding_date: "2025-03-20",
  ending_date: "2026-10-06",
  ending_reason_tags: ["results", "price", "results"],
  ending_note: null,
}
const exit: ListingExit = {
  id: "a6631aaf-3b5f-477b-8a60-d59a69927d75",
  name: "Property",
  client_id: "active-client",
  client_name: "Active client",
  markets: ["Salt Lake City, UT"],
  deactivated_date: "2026-10-06",
  exit_reason: "sold_property",
  exit_note: null,
  exit_handled_by: null,
  stripe_item_status: "adjusted",
}

describe("churn reporting", () => {
  it("filters inclusive date boundaries, any client market, and reason membership", () => {
    const filters = {
      reason: "results",
      market: "Dallas, TX",
      from: "2026-10-06",
      to: "2026-10-06",
    }
    expect(filterChurnClients([client], filters)).toEqual([client])
    expect(
      filterChurnClients([client], { ...filters, from: "2026-10-07" })
    ).toEqual([])
    expect(
      filterListingExits([exit], {
        ...filters,
        market: "Salt Lake City, UT",
        reason: "sold_property",
      })
    ).toEqual([exit])
  })
  it("keeps undated rows in unfiltered views but excludes them from dated reports", () => {
    const undated = { ...client, ending_date: null, ending_reason_tags: [] }
    expect(
      filterChurnClients([undated], {
        ...EMPTY_CHURN_FILTERS,
        reason: "untagged",
      })
    ).toEqual([undated])
    expect(
      filterChurnClients([undated], {
        ...EMPTY_CHURN_FILTERS,
        from: "2026-01-01",
      })
    ).toEqual([])
    expect(tenureMonths(undated)).toBeNull()
    expect(summarizeChurn([undated], [], "2026-10-06")).toMatchObject({
      clientCount: 0,
      avgTenure: null,
      undatedClients: 1,
    })
  })
  it("uses twelve calendar months, excludes future churn, and separates reasons", () => {
    const rows = [
      client,
      { ...client, id: "old", ending_date: "2025-10-31" },
      { ...client, id: "first", ending_date: "2025-11-01" },
      { ...client, id: "future", ending_date: "2026-10-07" },
    ]
    const summary = summarizeChurn(rows, [exit], "2026-10-06")
    expect(summary.months).toHaveLength(12)
    expect(summary.months[0]).toEqual({
      month: "2025-11",
      clients: 1,
      listings: 0,
    })
    expect(summary.months[11]).toEqual({
      month: "2026-10",
      clients: 1,
      listings: 1,
    })
    expect(summary.clientCount).toBe(2)
    expect(summary.listingCount).toBe(1)
    expect(summary.clientReasons).toEqual([
      { reason: "price", count: 2 },
      { reason: "results", count: 2 },
    ])
    expect(summary.listingReasons).toEqual([
      { reason: "sold_property", count: 1 },
    ])
  })
  it("computes tenure only from recorded, ordered dates", () => {
    expect(tenureMonths(client)).toBe(19)
    expect(tenureMonths({ ...client, ending_date: "2024-01-01" })).toBeNull()
    expect(tenureMonths({ ...client, onboarding_date: null })).toBeNull()
  })
  it("filters leaving-soon subscription dates before counting each client once", () => {
    const row = {
      id: "active",
      name: "Active",
      markets: ["Austin, TX"],
      cancellations: [
        {
          subscription_id: "one",
          scheduled_end: "2026-10-31",
          synced_at: "2026-10-06",
        },
        {
          subscription_id: "two",
          scheduled_end: "2026-12-01",
          synced_at: "2026-10-06",
        },
      ],
    }
    const result = filterLeavingClients([row], {
      reason: "sold_property",
      market: "Austin, TX",
      from: "2026-10-01",
      to: "2026-10-31",
    })
    expect(result).toHaveLength(1)
    expect(result[0].cancellations.map((item) => item.subscription_id)).toEqual(
      ["one"]
    )
  })
  it("uses the business timezone and rejects impossible dates", () => {
    expect(reportDate(new Date("2026-10-07T01:00:00Z"))).toBe("2026-10-06")
    expect(validDate("2026-02-30")).toBe(false)
    expect(validDate("2024-02-29")).toBe(true)
    expect(marketLabel(null, "UT")).toBe("UT")
    expect(marketLabel(null, null)).toBe("Unknown market")
  })
})
describe("listing exit input", () => {
  const input = {
    listingId: exit.id,
    reason: "sold_property",
    note: "  sold  ",
    handledBy: " Team ",
    stripeItemStatus: "adjusted",
  }
  it("shares every client reason and trims notes", () => {
    for (const { value } of CLIENT_CHURN_REASONS)
      expect(
        listingExitSchema.safeParse({ ...input, reason: value }).success
      ).toBe(true)
    expect(listingExitSchema.parse(input)).toMatchObject({
      note: "sold",
      handledBy: "Team",
    })
  })
  it("rejects unsupported reasons, Stripe statuses, oversized text and invalid IDs", () => {
    for (const patch of [
      { reason: "invalid" },
      { stripeItemStatus: "cancel" },
      { note: "x".repeat(4001) },
      { handledBy: "x".repeat(121) },
      { listingId: "not-a-uuid" },
    ])
      expect(listingExitSchema.safeParse({ ...input, ...patch }).success).toBe(
        false
      )
  })
})
