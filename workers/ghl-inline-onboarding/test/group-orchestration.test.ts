import { delay, http, HttpResponse } from "msw"
import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import worker, {
  issueGroupResumeToken,
  verifyGroupResumeToken,
  type Env as WorkerEnv,
} from "../src/index"
import { network } from "./setup"

const API = "https://services.leadconnectorhq.com"
const testEnv = Object.assign(Object.create(env as unknown as WorkerEnv), {
  HIGHLEVEL_ONBOARDING_RESUME_HMAC_SECRET: "unit-test-resume-secret",
  HUB_ONBOARDING_API_BASE_URL: "https://hub.example",
  HUB_ONBOARDING_INTERNAL_HMAC_SECRET: "unit-test-hub-secret",
  HIGHLEVEL_ONBOARDING_FINAL_URL: "https://links.revfactor.io/final-onboarding",
}) as WorkerEnv

function groupBody(overrides: Record<string, unknown> = {}) {
  return {
    billingMode: "separate_per_listing",
    contactName: "Multi Business Owner",
    email: "multi-business@example.com",
    phone: "+15555550199",
    totalListingCount: 2,
    legalBusinessNames: ["Property One LLC", "Property Two LLC"],
    referralCode: "",
    website: "",
    ...overrides,
  }
}

function submit(body = groupBody()) {
  return worker.fetch(
    new Request("https://worker.example/v2/groups/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: testEnv.HIGHLEVEL_ONBOARDING_ALLOWED_ORIGIN,
      },
      body: JSON.stringify(body),
    }),
    testEnv
  )
}

function resume(resumeToken: string) {
  return worker.fetch(
    new Request("https://worker.example/v2/groups/resume", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: testEnv.HIGHLEVEL_ONBOARDING_ALLOWED_ORIGIN,
      },
      body: JSON.stringify({ resumeToken }),
    }),
    testEnv
  )
}

function installGroupHarness(contactId: string) {
  const opportunities: Array<Record<string, unknown>> = []
  const opportunityCreates: Array<Record<string, unknown>> = []
  const templateCreates: Array<Record<string, unknown>> = []
  const linkCreates: Array<Record<string, unknown>> = []
  let draftVisible = false
  let sentName: string | null = null
  let signed = false

  network.use(
    http.post(`${API}/contacts/upsert`, async () => {
      await delay(10)
      return HttpResponse.json({ contact: { id: contactId } })
    }),
    http.get(`${API}/opportunities/search`, () =>
      HttpResponse.json({
        opportunities,
        meta: { total: opportunities.length },
      })
    ),
    http.post(`${API}/opportunities/`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      opportunityCreates.push(body)
      const opportunity = {
        id: `opp-${opportunityCreates.length}`,
        name: body.name,
        contactId,
      }
      opportunities.push(opportunity)
      return HttpResponse.json({ opportunity })
    }),
    http.post(`${API}/proposals/templates/send`, async ({ request }) => {
      templateCreates.push((await request.json()) as Record<string, unknown>)
      draftVisible = true
      return HttpResponse.json({ success: true })
    }),
    http.get(`${API}/proposals/document`, () => {
      if (!draftVisible) return HttpResponse.json({ documents: [], total: 0 })
      const document = sentName
        ? {
            documentId: "document-group-1",
            name: sentName,
            status: signed ? "completed" : "sent",
            documentRevision: 2,
            updatedAt: "2026-09-03T20:00:00.000Z",
            opportunityId: "opp-1",
            recipients: [{ id: contactId, hasCompleted: signed }],
            links: [
              {
                referenceId: "reference-group-1",
                recipientId: contactId,
                entityName: "contacts",
              },
            ],
          }
        : {
            documentId: "document-group-1",
            name: "RevFactor_Service_Agreement_Standard_Opportunity_NATIVE_DRAFT_v4",
            status: "draft",
            recipients: [{ id: contactId }],
          }
      return HttpResponse.json({ documents: [document], total: 1 })
    }),
    http.post(`${API}/proposals/document/send`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      linkCreates.push(body)
      sentName = String(body.documentName)
      return HttpResponse.json({
        links: [
          {
            referenceId: "reference-group-1",
            recipientId: contactId,
            entityName: "contacts",
          },
        ],
      })
    })
  )

  return {
    opportunityCreates,
    templateCreates,
    linkCreates,
    markSigned() {
      signed = true
    },
  }
}

describe("multi-business GHL draft orchestration", () => {
  it("issues a bound, expiring and tamper-evident resume token", async () => {
    const groupFingerprint = "a".repeat(64)
    const tokenEnv = {
      ...testEnv,
      HIGHLEVEL_ONBOARDING_RESUME_HMAC_SECRET: "unit-test-resume-secret",
    }
    const token = await issueGroupResumeToken(
      tokenEnv,
      "contact-resume",
      groupFingerprint
    )
    await expect(
      verifyGroupResumeToken(
        tokenEnv,
        token,
        { contactId: "contact-resume", groupFingerprint },
        Math.floor(Date.now() / 1000)
      )
    ).resolves.toMatchObject({
      contactId: "contact-resume",
      groupFingerprint,
    })
    await expect(
      verifyGroupResumeToken(tokenEnv, `${token.slice(0, -1)}x`, {
        contactId: "contact-resume",
        groupFingerprint,
      })
    ).rejects.toThrow("Invalid onboarding resume token")
    await expect(
      verifyGroupResumeToken(tokenEnv, token, {
        contactId: "different-contact",
        groupFingerprint,
      })
    ).rejects.toThrow("Invalid or expired onboarding resume token")
    await expect(
      verifyGroupResumeToken(
        tokenEnv,
        token,
        { contactId: "contact-resume", groupFingerprint },
        Math.floor(Date.now() / 1000) + 24 * 60 * 60 + 1
      )
    ).rejects.toThrow("Invalid or expired onboarding resume token")
  })

  it("creates one opportunity and agreement under concurrent first-account submissions", async () => {
    const harness = installGroupHarness("contact-group-concurrent")
    const responses = await Promise.all([submit(), submit()])
    expect(
      responses.every((response) => [200, 503].includes(response.status))
    ).toBe(true)
    expect(harness.opportunityCreates).toHaveLength(1)
    expect(harness.templateCreates).toHaveLength(1)
    expect(harness.linkCreates).toHaveLength(1)

    const successPayloads = await Promise.all(
      responses
        .filter((response) => response.status === 200)
        .map((response) => response.json())
    )
    expect(successPayloads[0]).toMatchObject({
      success: true,
      nextAction: { kind: "agreement", accountSequence: 1 },
    })
    expect(
      successPayloads.filter((payload) => payload.reused === false)
    ).toHaveLength(1)
    expect(harness.templateCreates[0]).toMatchObject({
      contactId: "contact-group-concurrent",
      opportunityId: "opp-1",
      sendDocument: false,
    })
    const opportunity = harness.opportunityCreates[0]
    expect(opportunity).not.toHaveProperty("monthlyRate")
    expect(opportunity).not.toHaveProperty("onboardingFee")
    expect(opportunity).toMatchObject({
      monetaryValue: 425,
      contactId: "contact-group-concurrent",
    })
    expect(opportunity.customFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field_value: "Property One LLC" }),
        expect.objectContaining({ field_value: "350.00" }),
        expect.objectContaining({ field_value: "75.00" }),
        expect.objectContaining({ field_value: "425.00" }),
      ])
    )
  })

  it("reuses the frozen group and rejects changed ordered legal names before a second write", async () => {
    const harness = installGroupHarness("contact-group-immutable")
    expect((await submit()).status).toBe(200)
    const replay = await submit()
    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toMatchObject({ reused: true })

    const conflict = await submit(
      groupBody({ legalBusinessNames: ["Changed LLC", "Property Two LLC"] })
    )
    expect(conflict.status).toBe(409)
    expect(harness.opportunityCreates).toHaveLength(1)
    expect(harness.templateCreates).toHaveLength(1)
    expect(harness.linkCreates).toHaveLength(1)
  })

  it("returns only server-calculated group quote values", async () => {
    const response = await worker.fetch(
      new Request("https://worker.example/v2/groups/quote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: testEnv.HIGHLEVEL_ONBOARDING_ALLOWED_ORIGIN,
        },
        body: JSON.stringify({
          billingMode: "separate_per_listing",
          totalListingCount: 4,
          referralCode: "",
          monthlyRateCents: 1,
          onboardingFeeCents: 1,
          templateId: "browser-injected",
        }),
      }),
      testEnv
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      onboardingFeeTotalCents: 15000,
      accounts: Array.from({ length: 4 }, (_, index) => ({
        sequence: index + 1,
        listingQuantity: 1,
        monthlyRateCents: 35000,
        monthlyAmountCents: 35000,
        onboardingFeeCents: 3750,
        initialCheckoutTotalCents: 38750,
      })),
    })
  })

  it("verifies the signed agreement, prepares payment, then unlocks the group", async () => {
    const harness = installGroupHarness("contact-group-resume")
    const checkoutBodies: Array<Record<string, unknown>> = []
    network.use(
      http.post(
        "https://hub.example/api/internal/onboarding/checkout",
        async ({ request }) => {
          expect(request.headers.get("x-rf-signature")).toMatch(
            /^v1=[a-f0-9]{64}$/
          )
          checkoutBodies.push((await request.json()) as Record<string, unknown>)
          return HttpResponse.json({
            success: true,
            checkoutSessionId: "cs_test_group_1",
            checkoutUrl: "https://checkout.stripe.test/cs_test_group_1",
          })
        }
      ),
      http.post("https://hub.example/api/internal/onboarding/status", () =>
        HttpResponse.json({
          success: true,
          state: "complete",
          stripeCustomerId: "cus_group_1",
          stripeSubscriptionId: "sub_group_1",
        })
      )
    )
    const started = await submit(
      groupBody({
        billingMode: "single",
        legalBusinessNames: ["Portfolio LLC"],
      })
    )
    expect(started.status).toBe(200)
    const startPayload = (await started.json()) as { resumeToken: string }
    harness.markSigned()

    const payment = await resume(startPayload.resumeToken)
    expect(payment.status).toBe(200)
    await expect(payment.json()).resolves.toMatchObject({
      nextAction: {
        kind: "payment",
        accountSequence: 1,
        url: "https://checkout.stripe.test/cs_test_group_1",
      },
    })
    expect(checkoutBodies).toHaveLength(1)
    expect(checkoutBodies[0]).toMatchObject({
      documentId: "document-group-1",
      documentRevision: 2,
      account: {
        listingQuantity: 2,
        onboardingFeeCents: 15000,
        initialCheckoutTotalCents: 85000,
      },
    })

    const completed = await resume(startPayload.resumeToken)
    expect(completed.status).toBe(200)
    await expect(completed.json()).resolves.toMatchObject({
      nextAction: {
        kind: "onboarding",
        url: testEnv.HIGHLEVEL_ONBOARDING_FINAL_URL,
      },
    })
  })
})
