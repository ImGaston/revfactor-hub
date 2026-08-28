import { delay, http, HttpResponse } from "msw"
import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import worker, { type Env as WorkerEnv, type Signup } from "../src/index"
import { network } from "./setup"

const API = "https://services.leadconnectorhq.com"
const testEnv = env as unknown as WorkerEnv

type Harness = {
  contactId: string
  commercialWrites: Array<Record<string, unknown>>
  templateCreates: Array<Record<string, unknown>>
  linkCreates: Array<Record<string, unknown>>
  templateCreated: boolean
  templateVisible: boolean
  createdTemplateName: string
  sentDocumentName: string | null
}

function signup(overrides: Partial<Signup> = {}): Signup {
  return {
    legalName: "Concurrency Test Holdings LLC",
    contactName: "Concurrency Test Client",
    email: "concurrency-test@example.com",
    phone: "+15555550123",
    primaryListingQuantity: 2,
    pricingProgram: "Regular",
    ...overrides,
  }
}

function jsonBody(request: Request) {
  return request.json() as Promise<Record<string, unknown>>
}

function installHarness(options: {
  contactId: string
  templateCreateFailsAfterCommit?: boolean
  templateInitiallyHidden?: boolean
  commercialDelayMs?: number
}) {
  const harness: Harness = {
    contactId: options.contactId,
    commercialWrites: [],
    templateCreates: [],
    linkCreates: [],
    templateCreated: false,
    templateVisible: !options.templateInitiallyHidden,
    createdTemplateName: testEnv.HIGHLEVEL_ONBOARDING_TEMPLATE_NAME,
    sentDocumentName: null,
  }

  network.use(
    http.post(`${API}/contacts/upsert`, async ({ request }) => {
      const body = await jsonBody(request)
      if (Array.isArray(body.customFields)) {
        harness.commercialWrites.push(body)
        if (options.commercialDelayMs) await delay(options.commercialDelayMs)
      }
      return HttpResponse.json({ contact: { id: harness.contactId } })
    }),
    http.get(`${API}/proposals/document`, () => {
      if (!harness.templateCreated || !harness.templateVisible) {
        return HttpResponse.json({ documents: [] })
      }
      if (harness.sentDocumentName) {
        return HttpResponse.json({
          documents: [
            {
              documentId: `document-${harness.contactId}`,
              name: harness.sentDocumentName,
              status: "sent",
              recipients: [{ id: harness.contactId }],
              links: [
                {
                  referenceId: `reference-${harness.contactId}`,
                  recipientId: harness.contactId,
                  entityName: "contacts",
                },
              ],
            },
          ],
        })
      }
      return HttpResponse.json({
        documents: [
          {
            documentId: `document-${harness.contactId}`,
            name: harness.createdTemplateName,
            status: "draft",
            recipients: [{ id: harness.contactId }],
          },
        ],
      })
    }),
    http.post(`${API}/proposals/templates/send`, async ({ request }) => {
      const body = await jsonBody(request)
      harness.templateCreates.push(body)
      harness.templateCreated = true
      harness.createdTemplateName =
        body.templateId === testEnv.HIGHLEVEL_ONBOARDING_REFERRAL_TEMPLATE_ID
          ? testEnv.HIGHLEVEL_ONBOARDING_REFERRAL_TEMPLATE_NAME
          : testEnv.HIGHLEVEL_ONBOARDING_TEMPLATE_NAME
      if (options.templateCreateFailsAfterCommit) {
        return HttpResponse.json({ error: "response lost" }, { status: 504 })
      }
      return HttpResponse.json({ success: true })
    }),
    http.post(`${API}/proposals/document/send`, async ({ request }) => {
      const body = await jsonBody(request)
      harness.linkCreates.push(body)
      harness.sentDocumentName = String(body.documentName)
      return HttpResponse.json({
        links: [
          {
            referenceId: `reference-${harness.contactId}`,
            recipientId: harness.contactId,
            entityName: "contacts",
          },
        ],
      })
    }),
    http.post(`${API}/contacts/:contactId/tags`, () =>
      HttpResponse.json({ success: true })
    )
  )
  return harness
}

function requestBody(input: Signup) {
  return {
    legalName: input.legalName,
    contactName: input.contactName,
    email: input.email,
    phone: input.phone,
    primaryListingQuantity: input.primaryListingQuantity,
    childListingQuantity: 0,
    serviceStartMode: "immediate",
    serviceStartDate: null,
    website: "",
  }
}

function submit(input: Signup) {
  return worker.fetch(
    new Request("https://worker.example/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: testEnv.HIGHLEVEL_ONBOARDING_ALLOWED_ORIGIN,
      },
      body: JSON.stringify(requestBody(input)),
    }),
    testEnv
  )
}

describe("agreement claim orchestration", () => {
  it("claims two concurrent identical submissions once and performs one GHL create path", async () => {
    const input = signup({
      email: "identical-race@example.com",
      contactName: "Identical Race",
    })
    const harness = installHarness({
      contactId: "contact-identical-race",
      commercialDelayMs: 30,
    })

    const responses = await Promise.all([submit(input), submit(input)])
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 503,
    ])
    expect(harness.commercialWrites).toHaveLength(1)
    expect(harness.templateCreates).toHaveLength(1)
    expect(harness.linkCreates).toHaveLength(1)

    const replay = await submit(input)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ success: true, reused: true })
    expect(harness.commercialWrites).toHaveLength(1)
    expect(harness.templateCreates).toHaveLength(1)
    expect(harness.linkCreates).toHaveLength(1)
  })

  it("allows one winner for concurrent standard and referral revisions with zero losing commercial writes", async () => {
    const contactId = "contact-program-race"
    const harness = installHarness({ contactId, commercialDelayMs: 30 })
    const stub = testEnv.AGREEMENT_CLAIMS.getByName(contactId)
    const standard = signup({
      email: "program-race@example.com",
      contactName: "Program Race",
      pricingProgram: "Regular",
    })
    const referral = { ...standard, pricingProgram: "Referral" as const }

    const results = await Promise.all([
      stub.processAgreement({ contactId, input: standard }),
      stub.processAgreement({ contactId, input: referral }),
    ])
    expect(
      results.filter((result) => result.outcome === "conflict")
    ).toHaveLength(1)
    expect(harness.commercialWrites).toHaveLength(1)
    expect(harness.templateCreates).toHaveLength(1)
    expect(harness.linkCreates).toHaveLength(1)
    const fields = harness.commercialWrites[0].customFields as Array<{
      key: string
      fieldValue: string
    }>
    const program = fields.find(
      (field) => field.key === "contact.rf_pricing_program"
    )?.fieldValue
    expect(["Regular", "Referral"]).toContain(program)
  })

  it("does not rewrite commercial fields on exact replay and rejects a changed legal name before mutation", async () => {
    const contactId = "contact-immutable-replay"
    const harness = installHarness({ contactId })
    const stub = testEnv.AGREEMENT_CLAIMS.getByName(contactId)
    const input = signup({
      email: "immutable-replay@example.com",
      contactName: "Immutable Replay",
    })

    expect(await stub.processAgreement({ contactId, input })).toMatchObject({
      outcome: "completed",
      reused: false,
    })
    expect(await stub.processAgreement({ contactId, input })).toMatchObject({
      outcome: "completed",
      reused: true,
    })
    expect(
      await stub.processAgreement({
        contactId,
        input: { ...input, legalName: "Different Legal Entity LLC" },
      })
    ).toMatchObject({ outcome: "conflict" })
    expect(harness.commercialWrites).toHaveLength(1)
    expect(harness.templateCreates).toHaveLength(1)
    expect(harness.linkCreates).toHaveLength(1)
  })

  it("recovers a committed but unacknowledged and temporarily unlistable template without duplicating it", async () => {
    const contactId = "contact-ambiguous-template"
    const harness = installHarness({
      contactId,
      templateCreateFailsAfterCommit: true,
      templateInitiallyHidden: true,
    })
    const stub = testEnv.AGREEMENT_CLAIMS.getByName(contactId)
    const input = signup({
      email: "ambiguous-template@example.com",
      contactName: "Ambiguous Template",
    })

    expect(await stub.processAgreement({ contactId, input })).toMatchObject({
      outcome: "pending",
      stage: "template_reconciling",
    })
    expect(harness.templateCreates).toHaveLength(1)
    harness.templateVisible = true
    expect(await stub.processAgreement({ contactId, input })).toMatchObject({
      outcome: "completed",
    })
    expect(harness.templateCreates).toHaveLength(1)
    expect(harness.commercialWrites).toHaveLength(1)
    expect(harness.linkCreates).toHaveLength(1)
  })
})
