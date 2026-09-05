import { describe, expect, it, vi } from "vitest"
import {
  JourneySchema,
  propertySnapshot,
  type Journey,
} from "@/lib/ghl-onboarding-v1/domain"
import {
  AssemblyFailure,
  createAssemblyApi,
  isPortalActive,
  provisionAssembly,
  type AssemblyApi,
  type AssemblyCheckpoint,
  type AssemblyCheckpointStore,
  type PortalClient,
  type PortalCompany,
} from "@/lib/ghl-onboarding-v1/assembly"

const ids = {
  journey: "10000000-0000-4000-8000-000000000001",
  property: "20000000-0000-4000-8000-000000000001",
  account: "30000000-0000-4000-8000-000000000001",
}
function journey(): Journey {
  const result = JourneySchema.parse({
    version: "rf.onboarding.v1",
    id: ids.journey,
    contactId: "contact-1",
    opportunityId: "opp-1",
    appointmentId: "appt-1",
    ownerId: "salesperson-1",
    email: "owner@example.com",
    name: "Example Owner",
    billingMode: "single",
    stage: "submitted",
    properties: [
      {
        id: ids.property,
        billingAccountId: ids.account,
        name: "Property One",
        address: {
          street: "1 Main St",
          city: "Austin",
          region: "TX",
          postalCode: "00000",
          country: "US",
        },
        identityConfirmed: true,
        status: "live",
        listingUrl: "https://example.com/property",
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
        id: ids.account,
        legalName: "Example LLC",
        ghlContactId: "contact-1",
        propertyIds: [ids.property],
        monthlyRateCents: 35000,
        onboardingFeeCents: 15000,
        documentId: "doc-1",
        invoiceId: "inv-1",
        stripePaymentIntentId: "pi_1",
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
    submittedAt: "2026-09-04T10:00:00Z",
  })
  result.signedPropertySnapshot = propertySnapshot(result)
  return result
}
function harness() {
  const states = new Map<string, AssemblyCheckpoint>()
  const companies = new Map<string, PortalCompany>()
  const clients = new Map<string, PortalClient>()
  const store: AssemblyCheckpointStore = {
    async load(key) {
      return structuredClone(states.get(key) ?? null)
    },
    async compareAndSet(key, revision, next) {
      if ((states.get(key)?.revision ?? null) !== revision) return false
      states.set(key, structuredClone(next))
      return true
    },
  }
  const api: AssemblyApi = {
    verifyCompanyFields: vi.fn(async () => undefined),
    findClients: vi.fn(async (email) =>
      [...clients.values()].filter((c) => c.email === email)
    ),
    findCompanies: vi.fn(async (key, value) =>
      [...companies.values()].filter((c) => c.customFields?.[key] === value)
    ),
    getCompany: vi.fn(async (id) => structuredClone(companies.get(id)!)),
    getClient: vi.fn(async (id) => structuredClone(clients.get(id)!)),
    createCompany: vi.fn(async (_name, customFields) => {
      const c = { id: `co-${companies.size + 1}`, customFields }
      companies.set(c.id, c)
      return c
    }),
    updateCompany: vi.fn(async (id, customFields) => {
      const c = { id, customFields }
      companies.set(id, c)
      return c
    }),
    createClient: vi.fn(async (input) => {
      const c: PortalClient = {
        id: `cl-${clients.size + 1}`,
        email: input.email,
        companyId: input.companyId,
        status: "notInvited",
      }
      clients.set(c.id, c)
      return c
    }),
    inviteClient: vi.fn(async (id) => {
      const c: PortalClient = { ...clients.get(id)!, status: "invited" }
      clients.set(id, c)
      return c
    }),
  }
  const deps = {
    api,
    store,
    mapping: {
      ownerExternalKey: "ownerKey",
      propertySummaryKey: "propertySummary",
    },
  }
  const run = (j = journey()) => provisionAssembly(j, deps)
  async function finish(j = journey()) {
    for (let i = 0; i < 8; i++) {
      const r = await run(j)
      if (r.status !== "pending") return r
    }
    throw Error("did_not_finish")
  }
  return { api, store, states, companies, clients, deps, run, finish }
}

describe("Assembly accepted-onboarding orchestration", () => {
  it("creates one company/client, persists property identity, invites once and observes activation", async () => {
    const h = harness()
    expect(await h.finish()).toMatchObject({
      status: "portal_invited",
      companyId: "co-1",
      clientId: "cl-1",
    })
    expect(await h.finish()).toMatchObject({ status: "portal_invited" })
    expect(h.api.createCompany).toHaveBeenCalledTimes(1)
    expect(h.api.createClient).toHaveBeenCalledTimes(1)
    expect(h.api.inviteClient).toHaveBeenCalledTimes(1)
    const summary = JSON.parse(
      String(h.companies.get("co-1")?.customFields?.propertySummary)
    )
    expect(summary.properties[0]).toMatchObject({
      id: ids.property,
      address: { street: "1 Main St" },
    })
    expect(JSON.stringify(summary)).not.toContain("monthlyRateCents")
    h.clients.set("cl-1", { ...h.clients.get("cl-1")!, status: "active" })
    expect(await h.finish()).toMatchObject({ status: "portal_active" })
  })
  it("does not create anything before acceptance or with missing payment", async () => {
    const h = harness(),
      j = journey()
    j.accounts[0].verifiedAt = null
    await expect(h.run(j)).rejects.toThrow("assembly_journey_not_accepted")
    expect(h.api.createCompany).not.toHaveBeenCalled()
  })
  it("rejects a purportedly verified payment without a bound provider identity", async () => {
    const h = harness(),
      j = journey()
    j.accounts[0].invoiceId = null
    await expect(h.run(j)).rejects.toThrow("assembly_journey_not_accepted")
    expect(h.api.createCompany).not.toHaveBeenCalled()
  })
  it("reconciles a company created before its response was lost without creating again", async () => {
    const h = harness(),
      original = h.api.createCompany
    h.api.createCompany = vi.fn(async (name, fields) => {
      await original(name, fields)
      throw new AssemblyFailure("request_failed", true)
    })
    await expect(h.run()).rejects.toThrow("assembly_request_failed")
    expect(h.states.get("rf-owner:contact-1")?.intent).toBe("create_company")
    expect(await h.finish()).toMatchObject({ status: "portal_invited" })
    expect(h.api.createCompany).toHaveBeenCalledTimes(1)
  })
  it("holds uncertain company creation with no exact marker instead of blind recreation", async () => {
    const h = harness()
    h.api.createCompany = vi.fn(async () => {
      throw new AssemblyFailure("request_failed", true)
    })
    await expect(h.run()).rejects.toThrow()
    expect(await h.run()).toMatchObject({
      status: "manual_review",
      reason: "company_create_uncertain",
    })
    expect(h.api.createCompany).toHaveBeenCalledTimes(1)
  })
  it("reconciles a lost client creation response using exact email and company", async () => {
    const h = harness(),
      original = h.api.createClient
    h.api.createClient = vi.fn(async (input) => {
      await original(input)
      throw new AssemblyFailure("response_invalid", true)
    })
    await h.run()
    await h.run()
    await expect(h.run()).rejects.toThrow()
    expect(await h.finish()).toMatchObject({ status: "portal_invited" })
    expect(h.api.createClient).toHaveBeenCalledTimes(1)
  })
  it("reconciles a lost invite response and never resends an already sent invitation", async () => {
    const h = harness(),
      original = h.api.inviteClient
    h.api.inviteClient = vi.fn(async (id) => {
      await original(id)
      throw new AssemblyFailure("request_failed", true)
    })
    await h.run()
    await h.run()
    await h.run()
    await expect(h.run()).rejects.toThrow()
    expect(await h.run()).toMatchObject({ status: "portal_invited" })
    expect(h.api.inviteClient).toHaveBeenCalledTimes(1)
  })
  it("holds an unresolved invite rather than sending twice", async () => {
    const h = harness()
    h.api.inviteClient = vi.fn(async () => {
      throw new AssemblyFailure("request_failed", true)
    })
    await h.run()
    await h.run()
    await h.run()
    await expect(h.run()).rejects.toThrow()
    expect(await h.run()).toMatchObject({
      status: "manual_review",
      reason: "invite_uncertain",
    })
    expect(h.api.inviteClient).toHaveBeenCalledTimes(1)
  })
  it("reuses an existing active owner and stops at ambiguous company membership", async () => {
    const h = harness()
    h.companies.set("existing-company", {
      id: "existing-company",
      customFields: {},
    })
    h.clients.set("existing-client", {
      id: "existing-client",
      email: journey().email,
      status: "active",
      companyIds: ["existing-company"],
    })
    expect(await h.finish()).toMatchObject({
      status: "portal_active",
      clientId: "existing-client",
    })
    expect(h.api.createClient).not.toHaveBeenCalled()
    expect(h.api.inviteClient).not.toHaveBeenCalled()
    h.clients.get("existing-client")!.companyIds!.push("another-company")
    expect(await h.run()).toMatchObject({
      status: "manual_review",
      reason: "ambiguous_company_membership",
    })
  })
  it("refuses duplicate email matches and conflicting owner markers", async () => {
    const h = harness()
    h.clients.set("c1", {
      id: "c1",
      email: journey().email,
      companyId: "co",
      status: "active",
    })
    h.clients.set("c2", {
      id: "c2",
      email: journey().email,
      companyId: "co",
      status: "active",
    })
    expect(await h.run()).toMatchObject({ reason: "ambiguous_client_email" })
    h.clients.delete("c2")
    h.companies.set("co", {
      id: "co",
      customFields: { ownerKey: "someone-else" },
    })
    expect(await h.run()).toMatchObject({ reason: "company_owner_conflict" })
  })
  it("preserves earlier properties when a second accepted journey belongs to the same owner", async () => {
    const h = harness()
    await h.finish()
    const j = journey()
    j.id = "10000000-0000-4000-8000-000000000002"
    j.properties[0].id = "20000000-0000-4000-8000-000000000002"
    j.properties[0].name = "Property Two"
    j.accounts[0].propertyIds = [j.properties[0].id]
    j.signedPropertySnapshot = propertySnapshot(j)
    expect(await h.finish(j)).toMatchObject({ status: "portal_invited" })
    expect(
      JSON.parse(String(h.companies.get("co-1")!.customFields!.propertySummary))
        .properties
    ).toHaveLength(2)
    expect(h.api.inviteClient).toHaveBeenCalledTimes(1)
  })
  it("does not overwrite pre-existing property data absent from the ledger", async () => {
    const h = harness()
    h.clients.set("c1", {
      id: "c1",
      email: journey().email,
      companyId: "co",
      status: "active",
    })
    h.companies.set("co", {
      id: "co",
      customFields: { propertySummary: "legacy property data" },
    })
    expect(await h.run()).toMatchObject({
      reason: "existing_properties_require_reconciliation",
    })
    expect(h.api.updateCompany).not.toHaveBeenCalled()
  })
  it("atomic checkpoint claiming prevents concurrent company POSTs", async () => {
    const h = harness()
    await Promise.all([h.run(), h.run()])
    expect(h.api.createCompany).toHaveBeenCalledTimes(1)
  })
  it("failed checkpoint persistence prevents provider mutation", async () => {
    const h = harness()
    h.store.compareAndSet = async () => {
      throw Error("db_down")
    }
    await expect(h.run()).rejects.toThrow("db_down")
    expect(h.api.createCompany).not.toHaveBeenCalled()
  })
  it("requires a real activation state or valid first-login timestamp", () => {
    const client: PortalClient = {
      id: "c1",
      email: "x@example.com",
      status: "invited",
    }
    expect(isPortalActive(client)).toBe(false)
    expect(isPortalActive({ ...client, firstLoginDate: "nonsense" })).toBe(
      false
    )
    expect(
      isPortalActive({ ...client, firstLoginDate: "2026-09-04T12:00:00Z" })
    ).toBe(true)
  })
})

describe("Assembly direct API adapter", () => {
  it("uses required company association and separates create from invite", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: "c1",
        email: "a@example.com",
        companyId: "co1",
        status: "notInvited",
      })
    )
    const api = createAssemblyApi("server-secret", fetcher)
    await api.createClient({
      givenName: "A",
      familyName: "Owner",
      email: "a@example.com",
      companyId: "co1",
    })
    await api.inviteClient("c1")
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.assembly.com/v1/clients?sendInvite=false"
    )
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).companyId).toBe(
      "co1"
    )
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://api.assembly.com/v1/clients/c1?sendInvite=true"
    )
    expect(fetcher.mock.calls[1][1]?.method).toBe("PATCH")
  })
  it("paginates email search and filters exact matches", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      Response.json(
        String(url).includes("nextToken=")
          ? {
              data: [{ id: "c2", email: "a@example.com", status: "active" }],
              nextToken: null,
            }
          : {
              data: [
                { id: "c1", email: "other@example.com", status: "active" },
              ],
              nextToken: "second",
            }
      )
    )
    expect(
      await createAssemblyApi("secret", fetcher).findClients("a@example.com")
    ).toMatchObject([{ id: "c2" }])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it("does not turn failed or incomplete search into permission to create", async () => {
    const failed = createAssemblyApi(
      "secret",
      vi.fn(async () => new Response("private payload", { status: 500 }))
    )
    await expect(failed.findClients("a@example.com")).rejects.toThrow(
      "assembly_request_failed"
    )
    const looping = createAssemblyApi(
      "secret",
      vi.fn(async () => Response.json({ data: [], nextToken: "same" }))
    )
    await expect(looping.findClients("a@example.com")).rejects.toThrow(
      "assembly_pagination_incomplete"
    )
  })
  it("never retries a write and does not expose network error secrets", async () => {
    const fetcher = vi.fn(async () => {
      throw Error("token=secret and private payload")
    })
    const api = createAssemblyApi("secret", fetcher)
    await expect(api.createCompany("name", {})).rejects.toMatchObject({
      message: "assembly_request_failed",
      uncertain: true,
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it("requires actual company text fields and rejects ignored mutation fields", async () => {
    const api = createAssemblyApi(
      "secret",
      vi.fn(async () =>
        Response.json({
          data: [{ key: "ownerKey", entityType: "client", type: "text" }],
        })
      )
    )
    await expect(
      api.verifyCompanyFields({
        ownerExternalKey: "ownerKey",
        propertySummaryKey: "summary",
      })
    ).rejects.toThrow("assembly_fields_missing")
    const ignored = createAssemblyApi(
      "secret",
      vi.fn(
        async () =>
          new Response("{}", {
            headers: { "X-Ignored-Fields": "customFields" },
          })
      )
    )
    await expect(ignored.createCompany("owner", {})).rejects.toMatchObject({
      uncertain: true,
    })
  })
})
