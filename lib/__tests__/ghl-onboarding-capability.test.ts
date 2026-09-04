import { beforeEach, describe, it, expect, vi } from "vitest"
const mocks = vi.hoisted(() => ({ db: vi.fn(), row: vi.fn(), apply: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.db }))
vi.mock("@/lib/ghl-onboarding-v1/providers.server", () => ({
  requiredEnv: vi.fn(),
  verifyAccount: vi.fn(),
}))
import {
  saveClientCommand,
  checkBearer,
} from "@/lib/ghl-onboarding-v1/service.server"
import { JourneySchema } from "@/lib/ghl-onboarding-v1/domain"
import {
  POST as contextPost,
  OPTIONS,
} from "@/app/api/public/highlevel/onboarding-v1/context/route"
const jid = "00000000-0000-4000-8000-000000000001",
  aid = "00000000-0000-4000-8000-000000000002",
  pid = "00000000-0000-4000-8000-000000000003"
const token = "a".repeat(43)
const journey = JourneySchema.parse({
  version: "rf.onboarding.v1",
  id: jid,
  contactId: "contact",
  opportunityId: "opp",
  appointmentId: "call",
  ownerId: "rep",
  email: "test@example.invalid",
  name: "Test Owner",
  billingMode: "single",
  stage: "signup",
  properties: [
    {
      id: pid,
      billingAccountId: aid,
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
  accounts: [
    {
      id: aid,
      legalName: "Test LLC",
      ghlContactId: "contact",
      propertyIds: [pid],
      monthlyRateCents: 35000,
      onboardingFeeCents: 15000,
    },
  ],
})
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("GHL_V1_ENABLED", "true")
  vi.stubEnv("GHL_V1_ALLOWED_ORIGINS", "https://onboard.example.invalid")
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    maybeSingle: mocks.row,
  }
  mocks.db.mockReturnValue({ from: vi.fn().mockReturnValue(query) })
  mocks.row.mockResolvedValue({
    data: { payload: journey, revision: 1 },
    error: null,
  })
})
describe("opaque native questionnaire capability", () => {
  it("rejects tokens with incorrect format without touching storage", async () => {
    await expect(saveClientCommand("guess", {})).rejects.toThrow(
      "invalid_context"
    )
    expect(mocks.db).not.toHaveBeenCalled()
  })
  it("rejects expired or unknown tokens", async () => {
    mocks.row.mockResolvedValue({ data: null, error: null })
    await expect(saveClientCommand(token, {})).rejects.toThrow(
      "invalid_context"
    )
  })
  it("cannot bind an invoice or manufacture payment truth", async () => {
    await expect(
      saveClientCommand(token, {
        action: "bind",
        eventId: "event",
        journeyId: jid,
        expectedRevision: 1,
        accountId: aid,
        documentId: "doc",
        invoiceId: "invoice",
        stripePaymentIntentId: "pi_test",
      })
    ).rejects.toThrow("action_not_allowed")
    expect(mocks.db).toHaveBeenCalledTimes(1)
  })
  it("cannot submit another journey using valid owner capability", async () => {
    await expect(
      saveClientCommand(token, {
        action: "submit",
        eventId: "event",
        journeyId: aid,
        expectedRevision: 1,
      })
    ).rejects.toThrow("journey_not_allowed")
    expect(mocks.db).toHaveBeenCalledTimes(1)
  })
  it("never grants the browser an origin wildcard", async () => {
    const r = await contextPost(
      new Request("https://hub.example.invalid/api", {
        method: "POST",
        headers: {
          origin: "https://attacker.invalid",
          authorization: `Bearer ${token}`,
        },
      })
    )
    expect(r.status).toBe(403)
    expect(mocks.db).not.toHaveBeenCalled()
    expect(
      OPTIONS(
        new Request("https://hub.example.invalid/api", {
          headers: { origin: "https://onboard.example.invalid" },
        })
      ).headers.get("Access-Control-Allow-Origin")
    ).toBe("https://onboard.example.invalid")
  })
  it("stays disabled before any data lookup until explicitly enabled", async () => {
    vi.stubEnv("GHL_V1_ENABLED", "false")
    const r = await contextPost(
      new Request("https://hub.example.invalid/api", {
        method: "POST",
        headers: {
          origin: "https://onboard.example.invalid",
          authorization: `Bearer ${token}`,
        },
      })
    )
    expect(r.status).toBe(503)
    expect(mocks.db).not.toHaveBeenCalled()
  })
  it("requires configured webhook secret and exact bearer match", () => {
    vi.stubEnv("GHL_V1_WEBHOOK_SECRET", "")
    expect(
      checkBearer(
        new Request("https://hub.example.invalid"),
        "GHL_V1_WEBHOOK_SECRET"
      )
    ).toBe(false)
    vi.stubEnv("GHL_V1_WEBHOOK_SECRET", "test-secret")
    expect(
      checkBearer(
        new Request("https://hub.example.invalid", {
          headers: { authorization: "Bearer test-secret" },
        }),
        "GHL_V1_WEBHOOK_SECRET"
      )
    ).toBe(true)
    expect(
      checkBearer(
        new Request("https://hub.example.invalid", {
          headers: { authorization: "Bearer other" },
        }),
        "GHL_V1_WEBHOOK_SECRET"
      )
    ).toBe(false)
  })
})
