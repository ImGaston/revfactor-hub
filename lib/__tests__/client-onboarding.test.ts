import { describe, expect, it } from "vitest"

import {
  ONBOARDING_ITEMS,
  buildOnboardingView,
  describeOnboardingEvent,
  formatOnboardingTimestamp,
  validateOnboardingSave,
  type OnboardingClientInput,
  type OnboardingListingInput,
} from "@/lib/client-onboarding"

const client: OnboardingClientInput = {
  pms_name: "Guesty",
  has_vrbo: false,
  ghl_onboarding: {
    purchased_listings: 1,
    agreement_evidence: ["rf-subscription-agreement-q1-signed"],
    uses_pms: "Yes",
    vrbo: "Yes",
    uses_pricelabs: "Yes",
    airbnb_ready: "Invite pending",
    audit_requested: "Yes",
    readiness: ["I understand the call needs access"],
    airbnb_listing_url: "https://www.airbnb.com/rooms/123",
    appointment: { start: "2026-10-14T15:00:00-04:00", status: "confirmed", host_name: "Fede" },
  },
}

const listing = (over: Partial<OnboardingListingInput> = {}): OnboardingListingInput => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "HK332",
  airbnb_link: null,
  listing_id: null,
  pricelabs_link: null,
  pl_synced_at: null,
  ...over,
})

const cellOf = (cells: { key: string }[], key: string) => cells.find((c) => c.key === key) as ReturnType<
  typeof buildOnboardingView
>["owner"][number]

describe("onboarding catalog", () => {
  it("has unique, storable keys and call items in a group", () => {
    const keys = ONBOARDING_ITEMS.map((i) => i.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const item of ONBOARDING_ITEMS) {
      expect(item.key).toMatch(/^[a-z0-9_]{2,60}$/)
      if (item.section === "call") expect("group" in item && item.group).toBeTruthy()
    }
  })
})

describe("buildOnboardingView", () => {
  it("prefills owner items from GHL and marks their source", () => {
    const view = buildOnboardingView({ client, listings: [listing()], rows: [] })
    expect(cellOf(view.owner, "agreement")).toMatchObject({ value: "signed", source: "ghl", status: "open" })
    expect(cellOf(view.owner, "listing_count")).toMatchObject({ value: 1, source: "client" })
    expect(cellOf(view.owner, "airbnb_audit")).toMatchObject({ value: "yes", source: "client" })
    expect(cellOf(view.owner, "onboarding_call").display).toContain("Oct 14, 2026")
    expect(cellOf(view.owner, "payout_floor")).toMatchObject({ value: null, source: null })
  })

  it("prefills per-listing items, mapping the intake link only for a single listing", () => {
    const one = buildOnboardingView({ client, listings: [listing()], rows: [] })
    const cells = one.listings[0].cells
    expect(cellOf(cells, "airbnb_link")).toMatchObject({ value: "https://www.airbnb.com/rooms/123", source: "client" })
    expect(cellOf(cells, "channels")).toMatchObject({ value: ["vrbo"], source: "client" })
    expect(cellOf(cells, "pms")).toMatchObject({ value: "Guesty", source: "hub" })
    expect(cellOf(cells, "pricelabs")).toMatchObject({ value: "has_account", source: "client" })

    const two = buildOnboardingView({
      client,
      listings: [
        listing({ airbnb_link: "https://www.airbnb.com/rooms/9", pl_synced_at: "2026-10-15T08:00:00Z" }),
        listing({ id: "22222222-2222-4222-8222-222222222222", name: "B" }),
      ],
      rows: [],
    })
    expect(cellOf(two.listings[0].cells, "airbnb_link").source).toBe("hub")
    expect(cellOf(two.listings[0].cells, "pricelabs")).toMatchObject({ value: "synced", source: "hub" })
    expect(cellOf(two.listings[1].cells, "airbnb_link").value).toBeNull()
  })

  it("lets a saved row win and repeats listing checks per listing", () => {
    const l1 = listing()
    const l2 = listing({ id: "22222222-2222-4222-8222-222222222222", name: "B" })
    const view = buildOnboardingView({
      client,
      listings: [l1, l2],
      rows: [
        {
          listing_id: null,
          item_key: "payout_floor",
          status: "done",
          value: 250,
          note: null,
          completed_at: "2026-10-15T12:00:00Z",
          completed_by_name: "Fede",
          updated_at: "2026-10-15T12:00:00Z",
          updated_by_name: "Fede",
        },
        {
          listing_id: l2.id,
          item_key: "access_airbnb_cohost",
          status: "done",
          value: null,
          note: null,
          completed_at: "2026-10-15T12:00:00Z",
          completed_by_name: "Fede",
          updated_at: "2026-10-15T12:00:00Z",
          updated_by_name: "Fede",
        },
      ],
    })
    expect(cellOf(view.owner, "payout_floor")).toMatchObject({ value: 250, source: "staff", status: "done", display: "$250.00" })
    const cohost = view.call.find((g) => g.group === "access")!.items.find((i) => i.key === "access_airbnb_cohost")!
    expect(cohost.cells.map((c) => [c.listingId, c.status])).toEqual([
      [l1.id, "open"],
      [l2.id, "done"],
    ])
    const ownerChecks = ONBOARDING_ITEMS.filter((i) => i.section === "call" && i.scope === "client").length
    const listingChecks = ONBOARDING_ITEMS.filter((i) => i.section === "call" && i.scope === "listing").length
    expect(view.progress).toEqual({ done: 1, total: ownerChecks + listingChecks * 2, blocked: 0 })
  })

  it("has no per-listing checks when the client has no listings yet", () => {
    const view = buildOnboardingView({ client: { ...client, ghl_onboarding: null }, listings: [], rows: [] })
    expect(view.listings).toEqual([])
    expect(view.call.flatMap((g) => g.items).every((i) => i.cells.every((c) => c.listingId === null))).toBe(true)
    expect(cellOf(view.owner, "agreement").value).toBeNull()
  })
})

describe("validateOnboardingSave", () => {
  const listingId = "11111111-1111-4111-8111-111111111111"

  it("enforces scope, status and value types", () => {
    expect(validateOnboardingSave({ itemKey: "nope", listingId: null, status: "done" })).toEqual({
      error: "Unknown onboarding item",
    })
    expect(validateOnboardingSave({ itemKey: "cleaning_fee", listingId: null, status: "done" })).toEqual({
      error: "Pick a listing",
    })
    expect(validateOnboardingSave({ itemKey: "payout_floor", listingId, status: "done", value: 1 })).toEqual({
      error: "This item is owner-level",
    })
    expect(validateOnboardingSave({ itemKey: "onboarding_call", listingId: null, status: "done" })).toHaveProperty("error")
    expect(validateOnboardingSave({ itemKey: "next_steps", listingId: null, status: "maybe" })).toEqual({
      error: "Pick a status",
    })
    expect(validateOnboardingSave({ itemKey: "pricelabs", listingId, status: "open", value: "sometimes" })).toEqual({
      error: "Pick an option",
    })
  })

  it("normalizes values and refuses to verify an empty prep value", () => {
    expect(validateOnboardingSave({ itemKey: "cleaning_fee", listingId, status: "done", value: "$1,185.555" })).toEqual({
      values: { item_key: "cleaning_fee", listing_id: listingId, status: "done", value: 1185.56, note: null },
    })
    expect(
      validateOnboardingSave({ itemKey: "channels", listingId, status: "done", value: ["direct", "airbnb", "airbnb"] })
    ).toMatchObject({ values: { value: ["airbnb", "direct"] } })
    expect(
      validateOnboardingSave({ itemKey: "airbnb_link", listingId, status: "open", value: "https://www.airbnb.com/rooms/5?s=1#x" })
    ).toMatchObject({ values: { value: "https://www.airbnb.com/rooms/5" } })
    expect(validateOnboardingSave({ itemKey: "airbnb_link", listingId, status: "open", value: "http://x.com" })).toHaveProperty(
      "error"
    )
    expect(validateOnboardingSave({ itemKey: "payout_floor", listingId: null, status: "done", value: "" })).toEqual({
      error: "Add a value before verifying it",
    })
    expect(validateOnboardingSave({ itemKey: "launch_report_date", listingId: null, status: "open", value: "2026-13-40" })).toHaveProperty(
      "error"
    )
  })

  it("rejects credentials in notes and text values", () => {
    expect(
      validateOnboardingSave({ itemKey: "access_pricelabs", listingId: null, status: "done", note: "PriceLabs password: hunter2hunter2" })
    ).toHaveProperty("error")
  })
})

describe("formatting", () => {
  it("formats full timestamps instead of returning Invalid Date", () => {
    expect(formatOnboardingTimestamp("2026-10-15T14:05:00Z")).toBe("Oct 15, 2026, 10:05 AM")
    expect(formatOnboardingTimestamp("not a date")).toBe("")
    expect(formatOnboardingTimestamp(null)).toBe("")
  })

  it("describes audit events", () => {
    const base = { listing_id: null, note: null, created_at: "2026-10-15T14:05:00Z", actor_name: "Fede" }
    expect(
      describeOnboardingEvent({ ...base, item_key: "next_steps", from_status: "open", to_status: "done", from_value: null, to_value: null })
    ).toBe("Checked Next steps explained")
    expect(
      describeOnboardingEvent({ ...base, item_key: "payout_floor", from_status: null, to_status: "done", from_value: null, to_value: 250 })
    ).toBe("Verified Payout floor (owner minimum)")
    expect(
      describeOnboardingEvent({ ...base, item_key: "payout_floor", from_status: "done", to_status: "done", from_value: 250, to_value: 300 })
    ).toBe("Set Payout floor (owner minimum) to $300.00")
  })
})
