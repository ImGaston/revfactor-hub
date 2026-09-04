import { describe, expect, it, vi } from "vitest"
import { assertRolloutContact } from "@/lib/ghl-onboarding-v1/rollout"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }))
import { createAdminClient } from "@/lib/supabase/admin"
import {
  beginJourney,
  BeginSchema,
} from "@/lib/ghl-onboarding-v1/service.server"

describe("controlled onboarding rollout", () => {
  it("defaults to a closed pilot, not general enrollment", () => {
    expect(() => assertRolloutContact("client", {})).toThrow(
      "pilot_contact_not_allowed"
    )
  })
  it("matches exact IDs only and ignores empty entries", () => {
    const env = { GHL_V1_PILOT_CONTACT_IDS: " first, second, " }
    expect(() => assertRolloutContact("second", env)).not.toThrow()
    expect(() => assertRolloutContact("sec", env)).toThrow(
      "pilot_contact_not_allowed"
    )
    expect(() => assertRolloutContact("", env)).toThrow(
      "pilot_contact_not_allowed"
    )
  })
  it("requires an explicit live mode and rejects mistyped modes", () => {
    expect(() =>
      assertRolloutContact("client", { GHL_V1_ROLLOUT_MODE: "live" })
    ).not.toThrow()
    expect(() =>
      assertRolloutContact("client", { GHL_V1_ROLLOUT_MODE: "true" })
    ).toThrow("rollout_configuration_invalid")
  })
  it("rejects an unlisted begin before any database or provider request", async () => {
    vi.stubEnv("GHL_V1_ROLLOUT_MODE", "pilot")
    vi.stubEnv("GHL_V1_PILOT_CONTACT_IDS", "allowed-contact")
    try {
      const input = BeginSchema.parse({
        action: "begin",
        eventId: "test",
        contactId: "other-contact",
        opportunityId: "opp",
        appointmentId: "call",
        ownerId: "owner",
        email: "test@example.invalid",
        name: "Test Owner",
        legalName: "Test LLC",
        properties: [
          {
            name: "Test",
            address: {
              street: "1 Test St",
              city: "Test",
              region: "NY",
              postalCode: "10001",
              country: "US",
            },
          },
        ],
      })
      await expect(beginJourney(input)).rejects.toThrow(
        "pilot_contact_not_allowed"
      )
      expect(createAdminClient).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
