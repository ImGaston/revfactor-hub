import { describe, expect, it } from "vitest"

import { summarizePriceLabsListingHealth } from "@/lib/agent-studio-health"

const NOW = Date.parse("2026-08-02T16:00:00.000Z")

describe("summarizePriceLabsListingHealth", () => {
  it("keeps a fresh portfolio connected while listing exceptions remain visible", () => {
    const summary = summarizePriceLabsListingHealth({
      now: NOW,
      clientNames: new Map([
        ["client-1", "Cynthia"],
        ["client-2", "Info RM Test"],
      ]),
      listings: [
        {
          id: "fresh",
          clientId: "client-1",
          name: "Fossil Farmstay",
          priceLabsId: "1471724",
          syncedAt: "2026-08-02T08:44:03.257Z",
        },
        {
          id: "never",
          clientId: "client-1",
          name: "Fossil Farmstay 2BR",
          priceLabsId: "1353978628934531620",
          syncedAt: null,
        },
        {
          id: "missing",
          clientId: "client-2",
          name: "Wingate 300",
          priceLabsId: null,
          syncedAt: null,
        },
      ],
    })

    expect(summary.latestSyncIsStale).toBe(false)
    expect(summary.freshListings).toBe(1)
    expect(summary.attentionListings).toEqual([
      expect.objectContaining({
        listingName: "Fossil Farmstay 2BR",
        clientName: "Cynthia",
        reason: "never_synced",
      }),
      expect.objectContaining({
        listingName: "Wingate 300",
        clientName: "Info RM Test",
        reason: "missing_id",
      }),
    ])
  })

  it("identifies an individually stale listing even when another is fresh", () => {
    const summary = summarizePriceLabsListingHealth({
      now: NOW,
      clientNames: new Map(),
      listings: [
        {
          id: "fresh",
          clientId: null,
          name: "Fresh listing",
          priceLabsId: "fresh-id",
          syncedAt: "2026-08-02T08:00:00.000Z",
        },
        {
          id: "stale",
          clientId: null,
          name: "Stale listing",
          priceLabsId: "stale-id",
          syncedAt: "2026-06-15T05:44:04.493Z",
        },
      ],
    })

    expect(summary.latestSyncIsStale).toBe(false)
    expect(summary.attentionListings).toEqual([
      expect.objectContaining({
        listingName: "Stale listing",
        reason: "stale",
        lastSyncedAt: "2026-06-15T05:44:04.493Z",
      }),
    ])
  })
})
