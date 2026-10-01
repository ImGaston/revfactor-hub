import { describe, expect, it } from "vitest"

import {
  formatSupportDateTime,
  ownerLabel,
  supportEventActor,
  supportEventLabel,
  supportEventSide,
  ticketPropertyLabel,
  timeAgo,
} from "@/lib/support-display"

describe("supportEventLabel", () => {
  it("names known events and falls back to spaced words", () => {
    expect(supportEventLabel("verification_failed")).toBe("Sent back at verification")
    expect(supportEventLabel("some_new_event")).toBe("some new event")
  })
})

describe("supportEventActor", () => {
  it("prefers the Hub user, then the chat name, then System", () => {
    expect(supportEventActor({ actor: { full_name: "Andrés Pérez", email: "a@x.io" }, actor_label: "Andres" })).toBe(
      "Andrés Pérez"
    )
    expect(supportEventActor({ actor: { full_name: null, email: "a@x.io" }, actor_label: null })).toBe("a@x.io")
    expect(supportEventActor({ actor: null, actor_label: "Client (Jamie)" })).toBe("Client (Jamie)")
    expect(supportEventActor({ actor: null, actor_label: null })).toBe("System")
  })
})

describe("supportEventSide", () => {
  it("puts client, team, and system events on their side", () => {
    expect(supportEventSide("client_message")).toBe("client")
    expect(supportEventSide("client_rejected")).toBe("client")
    expect(supportEventSide("team_reply")).toBe("team")
    expect(supportEventSide("commitment_made")).toBe("team")
    expect(supportEventSide("handoff")).toBe("team")
    expect(supportEventSide("verified")).toBe("system")
  })
})

describe("ticketPropertyLabel", () => {
  const listing = (name: string) => ({ listing_id: name, listings: { id: name, name } })

  it("describes portfolio and account-level asks without listings", () => {
    expect(ticketPropertyLabel({ property_scope: "portfolio", support_ticket_listings: [] })).toBe("Whole portfolio")
    expect(ticketPropertyLabel({ property_scope: "account", support_ticket_listings: [] })).toBe(
      "Not property-specific"
    )
  })

  it("strips the internal state and owner suffix from listing names", () => {
    expect(
      ticketPropertyLabel({
        property_scope: "listings",
        support_ticket_listings: [listing("Lake House | Active | Andrés"), listing("Cabin • paused")],
      })
    ).toBe("Lake House, Cabin")
  })

  it("flags an unmatched property", () => {
    expect(ticketPropertyLabel({ property_scope: "unknown", support_ticket_listings: [] })).toBe(
      "Property not validated"
    )
  })
})

describe("ownerLabel", () => {
  it("uses the first name, then the email, then Unassigned", () => {
    expect(ownerLabel({ full_name: "Gastón Ruiz", email: "g@x.io" })).toBe("Gastón")
    expect(ownerLabel({ full_name: null, email: "g@x.io" })).toBe("g@x.io")
    expect(ownerLabel(null)).toBe("Unassigned")
  })
})

describe("formatSupportDateTime", () => {
  it("renders New York time regardless of the machine zone", () => {
    expect(formatSupportDateTime("2026-09-29T19:04:00Z")).toBe("Sep 29, 3:04 PM")
    expect(formatSupportDateTime(null)).toBe("—")
  })
})

describe("timeAgo", () => {
  const now = new Date("2026-09-30T12:00:00Z")
  it("uses minutes, hours, then days", () => {
    expect(timeAgo("2026-09-30T11:59:30Z", now)).toBe("just now")
    expect(timeAgo("2026-09-30T11:20:00Z", now)).toBe("40m ago")
    expect(timeAgo("2026-09-30T07:00:00Z", now)).toBe("5h ago")
    expect(timeAgo("2026-09-27T12:00:00Z", now)).toBe("3d ago")
    expect(timeAgo(undefined, now)).toBe("—")
  })
})
