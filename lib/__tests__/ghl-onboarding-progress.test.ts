import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  highlevel: vi.fn(),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}))
vi.mock("@/lib/ghl-onboarding-v1/providers.server", () => ({
  highlevelFetch: mocks.highlevel,
  requiredEnv: (key: string) =>
    key === "HIGHLEVEL_LOCATION_ID" ? "location" : key,
}))
import { projectGhlProgress } from "@/lib/ghl-onboarding-v1/progress.server"
import { JourneySchema } from "@/lib/ghl-onboarding-v1/domain"

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const job = { id: uuid(20), journey_id: uuid(1), lease_token: uuid(30) }
function initialJourney() {
  return JourneySchema.parse({
    version: "rf.onboarding.v1",
    id: uuid(1),
    contactId: "contact",
    opportunityId: "opp",
    appointmentId: "appt",
    ownerId: "rep",
    name: "Test Owner",
    email: "owner@example.com",
    stage: "signup",
    billingMode: "single",
    properties: [
      {
        id: uuid(10),
        billingAccountId: uuid(2),
        name: "Home",
        address: {
          street: "1 Main",
          city: "City",
          region: "NY",
          postalCode: "10001",
          country: "US",
        },
      },
    ],
    accounts: [
      {
        id: uuid(2),
        ghlContactId: "contact",
        legalName: "Owner LLC",
        propertyIds: [uuid(10)],
        monthlyRateCents: 35000,
        onboardingFeeCents: 15000,
      },
    ],
  })
}
let current = {
  id: uuid(1),
  payload: initialJourney(),
  revision: 1,
  created_at: "2026-09-04T12:00:00Z",
}
let others: { id: string; stage: string; created_at: string }[] = []
let leaseExists = true
beforeEach(() => {
  vi.stubEnv("GHL_V1_ROLLOUT_MODE", "pilot")
  vi.stubEnv("GHL_V1_PILOT_CONTACT_IDS", "contact")
  vi.stubEnv("GHL_V1_ENABLED", "true")
  vi.stubEnv("GHL_V1_PROGRESS_ENABLED", "true")
  current = {
    id: uuid(1),
    payload: initialJourney(),
    revision: 1,
    created_at: "2026-09-04T12:00:00Z",
  }
  others = []
  leaseExists = true
  mocks.rpc.mockReset().mockImplementation(async (name: string) => ({
    data: name === "claim_ghl_onboarding_job" ? [job] : true,
    error: null,
  }))
  mocks.highlevel
    .mockReset()
    .mockResolvedValue({ contact: { id: "contact", locationId: "location" } })
  mocks.from.mockReset().mockImplementation((table: string) => {
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      neq: vi.fn(),
      gt: vi.fn(),
      single: async () => ({ data: current, error: null }),
      maybeSingle: async () => ({
        data:
          table === "ghl_onboarding_jobs" && leaseExists
            ? { id: job.id }
            : null,
        error: null,
      }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: others, error: null }).then(resolve),
    }
    for (const fn of [chain.select, chain.eq, chain.neq, chain.gt])
      fn.mockReturnValue(chain)
    return chain
  })
})

afterEach(() => vi.unstubAllEnvs())

describe("GHL progress projection recovery", () => {
  it("uses the lease-checked completion RPC after one idempotent field PUT", async () => {
    expect(await projectGhlProgress()).toEqual({ status: "projected" })
    expect(
      mocks.highlevel.mock.calls.filter((call) => call[1]?.method === "PUT")
    ).toHaveLength(1)
    expect(mocks.rpc).toHaveBeenLastCalledWith("finish_ghl_progress_v1", {
      p_job_id: job.id,
      p_lease_token: job.lease_token,
      p_revision: 1,
      p_outcome: "projected",
      p_code: null,
    })
  })
  it("projects Team follow-up for a paused journey", async () => {
    current.payload.manualTakeover = true
    await projectGhlProgress()
    const put = mocks.highlevel.mock.calls.find(
      (call) => call[1]?.method === "PUT"
    )
    expect(JSON.parse(put![1].body).customFields).toContainEqual({
      id: "GHL_V1_FIELD_NEXT_ACTION",
      field_value: "Team follow-up",
    })
  })
  it("does not PUT after a pause revoked the old lease", async () => {
    leaseExists = false
    expect(await projectGhlProgress()).toEqual({ status: "stale_lease" })
    expect(
      mocks.highlevel.mock.calls.filter((call) => call[1]?.method === "PUT")
    ).toHaveLength(0)
  })
  it("supersedes an older journey through the RPC without a contact mutation", async () => {
    others = [
      { id: uuid(99), stage: "signup", created_at: "2026-09-04T13:00:00Z" },
    ]
    expect(await projectGhlProgress()).toEqual({ status: "superseded" })
    expect(mocks.highlevel).not.toHaveBeenCalled()
    expect(mocks.rpc.mock.calls.at(-1)?.[1].p_outcome).toBe("superseded")
  })
  it("refuses an ambiguous older active journey and persists an owned exception outcome", async () => {
    others = [
      { id: uuid(99), stage: "signup", created_at: "2026-09-04T11:00:00Z" },
    ]
    expect(await projectGhlProgress()).toEqual({
      status: "manual_review",
      reason: "progress_ambiguous_journey",
    })
    expect(mocks.highlevel).not.toHaveBeenCalled()
    expect(mocks.rpc.mock.calls.at(-1)?.[1].p_outcome).toBe("manual_review")
  })
  it("puts temporary provider failures into bounded retry instead of permanent review", async () => {
    mocks.highlevel.mockRejectedValue(Error("highlevel_http_503"))
    expect(await projectGhlProgress()).toEqual({
      status: "failed",
      reason: "progress_projection_failed",
    })
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({
      p_outcome: "failed",
      p_code: "progress_projection_failed",
    })
  })
  it("classifies missing access as a configuration exception", async () => {
    mocks.highlevel.mockRejectedValue(Error("highlevel_http_401"))
    expect(await projectGhlProgress()).toEqual({
      status: "manual_review",
      reason: "progress_configuration_or_identity_invalid",
    })
  })
  it("rejects another location before any PUT", async () => {
    mocks.highlevel.mockResolvedValue({
      contact: { id: "contact", locationId: "other-location" },
    })
    expect(await projectGhlProgress()).toEqual({
      status: "manual_review",
      reason: "progress_contact_mismatch",
    })
    expect(
      mocks.highlevel.mock.calls.filter((call) => call[1]?.method === "PUT")
    ).toHaveLength(0)
  })
  it("cannot claim success or overwrite a newer job after stale completion", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === "claim_ghl_onboarding_job" ? [job] : false,
      error: null,
    }))
    expect(await projectGhlProgress()).toEqual({ status: "stale_lease" })
  })
  it("stores no raw provider error text", async () => {
    mocks.highlevel.mockRejectedValue(
      Error("secret-token owner@example.com private-payload")
    )
    const result = await projectGhlProgress()
    expect(JSON.stringify(result)).not.toMatch(
      /secret-token|owner@example|private-payload/
    )
    expect(JSON.stringify(mocks.rpc.mock.calls.at(-1))).not.toMatch(
      /secret-token|owner@example|private-payload/
    )
  })
})

it("does not read or write CRM for a contact outside the pilot", async () => {
  vi.stubEnv("GHL_V1_PILOT_CONTACT_IDS", "other-contact")
  expect(await projectGhlProgress()).toMatchObject({ status: "manual_review" })
  expect(mocks.highlevel).not.toHaveBeenCalled()
})
