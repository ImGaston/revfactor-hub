import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
import { JourneySchema, propertySnapshot } from "@/lib/ghl-onboarding-v1/domain"
import {
  AssemblyFailure,
  type AssemblyApi,
  type AssemblyCheckpoint,
} from "@/lib/ghl-onboarding-v1/assembly"
import {
  assemblyWorkerConfig,
  processAssemblyJobs,
  runAssemblyJob,
  type AcceptedJobJourney,
  type AssemblyJob,
  type AssemblyWorkerConfig,
  type AssemblyWorkerRepository,
} from "@/lib/ghl-onboarding-v1/worker.server"

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const now = Date.parse("2026-09-04T12:00:00Z")
const config: AssemblyWorkerConfig = {
  enabled: true,
  assemblyEnabled: true,
  portalCompatible: true,
  apiKey: "test",
  portalId: "portal",
  ownerField: "owner",
  propertiesField: "properties",
}
function accepted(): AcceptedJobJourney {
  const j = JourneySchema.parse({
    version: "rf.onboarding.v1",
    id: uuid(1),
    contactId: "contact",
    opportunityId: "opp",
    appointmentId: "appt",
    ownerId: "rep",
    email: "owner@example.com",
    name: "Test Owner",
    stage: "submitted",
    submittedAt: "2026-09-04T10:00:00Z",
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
          country: "US",
          postalCode: "10001",
        },
        status: "pre_launch",
        targetLaunchDate: "2026-10-01",
        identityConfirmed: true,
        preferences: {
          goal: "guidance",
          minimumNightly: { mode: "guidance" },
          cleaningFee: { mode: "guidance" },
          minimumStay: { mode: "guidance" },
        },
      },
    ],
    accounts: [
      {
        id: uuid(2),
        legalName: "Owner LLC",
        ghlContactId: "contact",
        propertyIds: [uuid(10)],
        monthlyRateCents: 35000,
        onboardingFeeCents: 15000,
        documentId: "doc",
        invoiceId: "inv",
        stripePaymentIntentId: "pi_test",
        verifiedAt: "2026-09-04T10:00:00Z",
      },
    ],
    software: {
      pmsName: null,
      pms: "not_applicable",
      airbnb: "need_help",
      pricelabs: "need_help",
    },
    expectationsAcknowledged: true,
  })
  j.signedPropertySnapshot = propertySnapshot(j)
  return {
    snapshot: j,
    stage: "submitted",
    manualTakeover: false,
    companyId: "co",
    clientId: "cl",
  }
}
function setup() {
  const row = accepted()
  const job: AssemblyJob = {
    id: uuid(30),
    journey_id: uuid(1),
    kind: "activation_check",
    lease_token: uuid(40),
    created_at: "2026-09-04T11:00:00Z",
  }
  let checkpoint: AssemblyCheckpoint | null = null
  const repository: AssemblyWorkerRepository = {
    claim: vi.fn(async () => null),
    acceptedJourney: vi.fn(async () => row),
    checkpoints: () => ({
      load: async () => checkpoint,
      compareAndSet: async (_key, rev, next) => {
        if ((checkpoint?.revision ?? null) !== rev) return false
        checkpoint = next
        return true
      },
    }),
    finish: vi.fn(async () => true),
  }
  const api: AssemblyApi = {
    verifyCompanyFields: vi.fn(async () => undefined),
    findClients: vi.fn(async () => []),
    findCompanies: vi.fn(async () => []),
    getCompany: vi.fn(async () => ({ id: "co", customFields: {} })),
    getClient: vi.fn(async () => ({
      id: "cl",
      email: "owner@example.com",
      companyId: "co",
      status: "invited" as const,
    })),
    createCompany: vi.fn(async (_name, customFields) => ({
      id: "co",
      customFields,
    })),
    updateCompany: vi.fn(async (id, customFields) => ({ id, customFields })),
    createClient: vi.fn(async (input) => ({
      id: "cl",
      email: input.email,
      companyId: input.companyId,
      status: "notInvited" as const,
    })),
    inviteClient: vi.fn(async () => ({
      id: "cl",
      email: "owner@example.com",
      companyId: "co",
      status: "invited" as const,
    })),
  }
  const deps = {
    repository,
    api,
    portalId: "portal",
    mapping: { ownerExternalKey: "owner", propertySummaryKey: "properties" },
    now: () => now,
  }
  return { row, job, repository, api, deps }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubEnv("GHL_V1_ROLLOUT_MODE", "pilot")
  vi.stubEnv("GHL_V1_PILOT_CONTACT_IDS", "contact")
})
afterEach(() => vi.unstubAllEnvs())
it("will not claim or invite before the deployed portal supports accepted V1", async () => {
  const r = await processAssemblyJobs({
    config: { ...config, portalCompatible: false },
  })
  expect(r.state).toBe("portal_compatibility_required")
  expect(r.claimed).toBe(0)
})

describe("bounded Assembly worker", () => {
  it("defaults both enablement gates off and never claims jobs", async () => {
    const h = setup()
    expect(assemblyWorkerConfig({})).toMatchObject({
      enabled: false,
      assemblyEnabled: false,
    })
    const r = await processAssemblyJobs(
      { config: { ...config, assemblyEnabled: false } },
      { repository: h.repository, apiFactory: () => h.api }
    )
    expect(r.state).toBe("disabled")
    expect(h.repository.claim).not.toHaveBeenCalled()
  })
  it("fails closed before claiming when a field mapping is missing", async () => {
    const h = setup()
    const r = await processAssemblyJobs(
      { config: { ...config, propertiesField: undefined } },
      { repository: h.repository, apiFactory: () => h.api }
    )
    expect(r.state).toBe("not_configured")
    expect(h.repository.claim).not.toHaveBeenCalled()
  })
  it("polls activation without provisioning or resending invites", async () => {
    const h = setup()
    expect(await runAssemblyJob(h.job, h.deps)).toMatchObject({
      status: "portal_invited",
    })
    expect(h.api.inviteClient).not.toHaveBeenCalled()
    expect(h.api.createClient).not.toHaveBeenCalled()
    expect(h.api.createCompany).not.toHaveBeenCalled()
  })
  it("does not confuse a changed company or email with successful activation", async () => {
    const h = setup()
    h.api.getClient = vi.fn(async () => ({
      id: "cl",
      email: "other@example.com",
      companyId: "co",
      status: "active" as const,
    }))
    expect(await runAssemblyJob(h.job, h.deps)).toMatchObject({
      status: "manual_review",
      reason: "activation_identity_conflict",
    })
  })
  it("hands an inactive seven-day invitation to its owner without a resend", async () => {
    const h = setup()
    h.job.created_at = "2026-08-20T10:00:00Z"
    expect(await runAssemblyJob(h.job, h.deps)).toMatchObject({
      reason: "portal_activation_followup_required",
    })
    expect(h.api.inviteClient).not.toHaveBeenCalled()
  })
  it("still recognizes activation after the follow-up deadline", async () => {
    const h = setup()
    h.job.created_at = "2026-08-20T10:00:00Z"
    h.api.getClient = vi.fn(async () => ({
      id: "cl",
      email: "owner@example.com",
      companyId: "co",
      status: "active" as const,
    }))
    expect(await runAssemblyJob(h.job, h.deps)).toMatchObject({
      status: "portal_active",
    })
  })
  it("manual takeover stops provider work", async () => {
    const h = setup()
    h.row.manualTakeover = true
    expect(await runAssemblyJob(h.job, h.deps)).toMatchObject({
      reason: "assembly_journey_paused",
    })
    expect(h.api.getClient).not.toHaveBeenCalled()
  })
  it("creates from the frozen snapshot without mutating that accepted record", async () => {
    const h = setup()
    h.job.kind = "assembly_provision"
    const before = structuredClone(h.row.snapshot)
    expect(await runAssemblyJob(h.job, h.deps)).toEqual({ status: "pending" })
    expect(h.api.createCompany).toHaveBeenCalledWith("Test Owner properties", {
      owner: "rf-owner:contact",
    })
    expect(h.row.snapshot).toEqual(before)
  })
  it("claims no more than three jobs, classifies successful polls as pending", async () => {
    const h = setup()
    h.repository.claim = vi.fn(async () => h.job)
    const r = await processAssemblyJobs(
      { config, maxJobs: 100 },
      { repository: h.repository, apiFactory: () => h.api, now: () => now }
    )
    expect(r).toMatchObject({ claimed: 3, pending: 3, failed: 0 })
    expect(h.repository.finish).toHaveBeenCalledTimes(3)
  })
  it("does not count a stale-lease completion as success", async () => {
    const h = setup()
    h.repository.claim = vi.fn(async () => h.job)
    h.repository.finish = vi.fn(async () => false)
    const r = await processAssemblyJobs(
      { config, maxJobs: 1 },
      { repository: h.repository, apiFactory: () => h.api, now: () => now }
    )
    expect(r).toMatchObject({ staleLease: 1, pending: 0, completed: 0 })
  })
  it("persists a static failure code without raw upstream client data", async () => {
    const h = setup()
    h.repository.claim = vi.fn(async () => h.job)
    h.api.getClient = vi.fn(async () => {
      throw Error("secret token and owner@example.com")
    })
    const r = await processAssemblyJobs(
      { config, maxJobs: 1 },
      { repository: h.repository, apiFactory: () => h.api, now: () => now }
    )
    expect(r.failed).toBe(1)
    expect(h.repository.finish).toHaveBeenCalledWith(h.job, {
      status: "failed",
      reason: "assembly_worker_failed",
    })
  })
  it("records an atomic handoff commit failure without repeating the provider operation", async () => {
    const h = setup()
    h.repository.claim = vi.fn(async () => h.job)
    h.repository.finish = vi
      .fn()
      .mockRejectedValueOnce(
        Error("operational mapping conflict with private data")
      )
      .mockResolvedValueOnce(true)
    const result = await processAssemblyJobs(
      { config, maxJobs: 1 },
      { repository: h.repository, apiFactory: () => h.api, now: () => now }
    )
    expect(result.failed).toBe(1)
    expect(h.repository.finish).toHaveBeenLastCalledWith(h.job, {
      status: "failed",
      reason: "assembly_handoff_commit_failed",
    })
    expect(h.api.getClient).toHaveBeenCalledTimes(1)
  })
  it("keeps uncertain provider errors visible for persisted reconciliation", async () => {
    const h = setup()
    h.repository.claim = vi.fn(async () => h.job)
    h.api.getClient = vi.fn(async () => {
      throw new AssemblyFailure("request_failed", false, 503)
    })
    await processAssemblyJobs(
      { config, maxJobs: 1 },
      { repository: h.repository, apiFactory: () => h.api, now: () => now }
    )
    expect(h.repository.finish).toHaveBeenCalledWith(h.job, {
      status: "failed",
      reason: "assembly_request_failed",
    })
  })
})

it("never calls Assembly for a contact outside the controlled pilot", async () => {
  vi.stubEnv("GHL_V1_PILOT_CONTACT_IDS", "other-contact")
  const h = setup()
  h.job.kind = "assembly_provision"
  expect(await runAssemblyJob(h.job, h.deps)).toEqual({
    status: "manual_review",
    reason: "assembly_rollout_restricted",
  })
  for (const method of Object.values(h.api))
    expect(method).not.toHaveBeenCalled()
})
