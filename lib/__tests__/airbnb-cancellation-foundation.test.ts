import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  buildAirbnbFoundationInventoryRow,
  isAirbnbCancellationPolicy,
  isValidIanaTimezone,
  sortAirbnbFoundationInventory,
  type AirbnbFoundationListing,
} from "@/lib/airbnb-cancellation-foundation"

function listing(
  patch: Partial<AirbnbFoundationListing> = {}
): AirbnbFoundationListing {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Test listing",
    status: "active",
    client_id: "00000000-0000-0000-0000-000000000010",
    client_name: "Example client",
    airbnb_id: "123456",
    airbnb_link: "https://www.airbnb.com/rooms/123456",
    listing_id: "pl-123456",
    default_cancellation_policy: "firm",
    timezone: "America/New_York",
    ...patch,
  }
}

describe("Airbnb cancellation foundation", () => {
  it("accepts only the canonical policy vocabulary", () => {
    expect(isAirbnbCancellationPolicy("flexible")).toBe(true)
    expect(isAirbnbCancellationPolicy("super_strict_60")).toBe(true)
    expect(isAirbnbCancellationPolicy("flexible_or_better")).toBe(false)
    expect(isAirbnbCancellationPolicy(null)).toBe(false)
  })

  it("validates IANA timezones without guessing", () => {
    expect(isValidIanaTimezone("America/New_York")).toBe(true)
    expect(isValidIanaTimezone("US Eastern")).toBe(false)
    expect(isValidIanaTimezone("")).toBe(false)
  })

  it("classifies RevFactor and ready rows deterministically", () => {
    expect(buildAirbnbFoundationInventoryRow(listing())).toMatchObject({
      account_classification: "RevFactor",
      airbnb_identity_present: true,
      missing_or_blocked_reason: null,
    })
  })

  it("classifies clientless rows as Blackbird and reports every missing gate", () => {
    expect(
      buildAirbnbFoundationInventoryRow(
        listing({
          client_id: null,
          client_name: null,
          airbnb_id: null,
          airbnb_link: null,
          listing_id: null,
          default_cancellation_policy: null,
          timezone: null,
        })
      )
    ).toMatchObject({
      account_classification: "Blackbird",
      airbnb_identity_present: false,
      missing_or_blocked_reason:
        "missing_airbnb_identity;missing_default_cancellation_policy;missing_timezone",
    })
  })

  it("sorts by stable Hub UUID", () => {
    const rows = [
      buildAirbnbFoundationInventoryRow(
        listing({ id: "00000000-0000-0000-0000-000000000002" })
      ),
      buildAirbnbFoundationInventoryRow(listing()),
    ]
    expect(sortAirbnbFoundationInventory(rows).map((row) => row.id)).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
    ])
  })

  it("keeps the inventory command read-only and reservation-free", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/report-airbnb-foundation.ts"),
      "utf8"
    )
    expect(source).toContain('.from("listings")')
    expect(source).toContain("clients:clients_basic")
    expect(source).not.toMatch(/reservations|\.insert\(|\.update\(|\.delete\(|\.rpc\(/)
  })
})
