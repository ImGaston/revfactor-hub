import { delay, http, HttpResponse } from "msw"
import { env } from "cloudflare:workers"
import { runInDurableObject } from "cloudflare:test"
import { describe, expect, it } from "vitest"
import worker, {
  agreementRevisionFingerprint,
  buildAgreementRevision,
  LEGACY_REVFACTOR_AGREEMENT_NAMES,
  type Env as WorkerEnv,
  type Signup,
} from "../src/index"
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
  documentPage?: (
    skip: number,
    harness: Harness
  ) => { documents: unknown[]; total?: number }
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
    http.get(`${API}/proposals/document`, ({ request }) => {
      const skip = Number(new URL(request.url).searchParams.get("skip") ?? 0)
      if (options.documentPage) {
        return HttpResponse.json(options.documentPage(skip, harness))
      }
      if (!harness.templateCreated || !harness.templateVisible) {
        return HttpResponse.json({ documents: [], total: 0 })
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
          total: 1,
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
        total: 1,
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

function unrelatedDocuments(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => ({
    documentId: `${prefix}-${index}`,
    name: `Unrelated document ${prefix}-${index}`,
    status: "draft",
    recipients: [{ id: `other-contact-${index}` }],
  }))
}

function agreementDocument(
  contactId: string,
  name: string,
  status: string,
  documentId = `agreement-${contactId}`
) {
  return {
    documentId,
    name,
    status,
    recipients: [{ id: contactId }],
  }
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

  it("finds a relevant existing agreement on page two before any commercial mutation", async () => {
    const contactId = "contact-page-two-conflict"
    const pageOne = unrelatedDocuments(50, "page-two-conflict")
    const harness = installHarness({
      contactId,
      documentPage: (skip) => ({
        total: 51,
        documents:
          skip === 0
            ? pageOne
            : [
                agreementDocument(
                  contactId,
                  testEnv.HIGHLEVEL_ONBOARDING_TEMPLATE_NAME,
                  "sent"
                ),
              ],
      }),
    })
    const result = await testEnv.AGREEMENT_CLAIMS.getByName(
      contactId
    ).processAgreement({
      contactId,
      input: signup({
        email: "page-two-conflict@example.com",
        contactName: "Page Two Conflict",
      }),
    })

    expect(result).toMatchObject({ outcome: "conflict" })
    expect(harness.commercialWrites).toHaveLength(0)
    expect(harness.templateCreates).toHaveLength(0)
    expect(harness.linkCreates).toHaveLength(0)
  })

  it.each([
    ["missing total", () => ({ documents: [] })],
    ["truncated page set", () => ({ documents: [], total: 1 })],
    [
      "drifting total",
      (skip: number) => ({
        documents:
          skip === 0
            ? unrelatedDocuments(50, "drifting-total")
            : [
                {
                  documentId: "drifting-total-last",
                  name: "Unrelated final document",
                  status: "draft",
                  recipients: [{ id: "other" }],
                },
              ],
        total: skip === 0 ? 51 : 52,
      }),
    ],
    [
      "duplicate document identity",
      (skip: number) => {
        const page = unrelatedDocuments(50, "duplicate-id")
        return {
          documents: skip === 0 ? page : [page[0]],
          total: 51,
        }
      },
    ],
  ])(
    "fails closed for an incomplete document inventory: %s",
    async (_label, documentPage) => {
      const contactId = `contact-incomplete-${String(_label).replaceAll(" ", "-")}`
      const harness = installHarness({ contactId, documentPage })
      const result = await testEnv.AGREEMENT_CLAIMS.getByName(
        contactId
      ).processAgreement({
        contactId,
        input: signup({
          email: `${contactId}@example.com`,
          contactName: `Incomplete ${_label}`,
        }),
      })

      expect(result).toMatchObject({ outcome: "pending", stage: "claimed" })
      expect(harness.commercialWrites).toHaveLength(0)
      expect(harness.templateCreates).toHaveLength(0)
      expect(harness.linkCreates).toHaveLength(0)
    }
  )

  it("finds a newly created reconciliation target on page two", async () => {
    const contactId = "contact-page-two-reconcile"
    const pageOne = unrelatedDocuments(50, "page-two-reconcile")
    const harness = installHarness({
      contactId,
      documentPage: (skip, state) => {
        if (!state.templateCreated) return { documents: [], total: 0 }
        return {
          total: 51,
          documents:
            skip === 0
              ? pageOne
              : [
                  agreementDocument(
                    contactId,
                    state.createdTemplateName,
                    "draft",
                    `document-${contactId}`
                  ),
                ],
        }
      },
    })
    const result = await testEnv.AGREEMENT_CLAIMS.getByName(
      contactId
    ).processAgreement({
      contactId,
      input: signup({
        email: "page-two-reconcile@example.com",
        contactName: "Page Two Reconcile",
      }),
    })

    expect(result).toMatchObject({ outcome: "completed" })
    expect(harness.commercialWrites).toHaveLength(1)
    expect(harness.templateCreates).toHaveLength(1)
    expect(harness.linkCreates).toHaveLength(1)
  })

  it.each(
    LEGACY_REVFACTOR_AGREEMENT_NAMES.flatMap((name) =>
      ["draft", "sent", "viewed", "completed"].map(
        (status) => [name, status] as const
      )
    )
  )(
    "blocks legacy agreement %s in %s state before commercial mutation",
    async (legacyName, status) => {
      const suffix = `${LEGACY_REVFACTOR_AGREEMENT_NAMES.indexOf(legacyName)}-${status}`
      const contactId = `contact-legacy-${suffix}`
      const harness = installHarness({
        contactId,
        documentPage: () => ({
          total: 1,
          documents: [agreementDocument(contactId, legacyName, status)],
        }),
      })
      const result = await testEnv.AGREEMENT_CLAIMS.getByName(
        contactId
      ).processAgreement({
        contactId,
        input: signup({
          email: `legacy-${suffix}@example.com`,
          contactName: `Legacy ${suffix}`,
        }),
      })

      expect(result).toMatchObject({ outcome: "conflict" })
      expect(harness.commercialWrites).toHaveLength(0)
      expect(harness.templateCreates).toHaveLength(0)
      expect(harness.linkCreates).toHaveLength(0)
    }
  )

  it("recovers an expired read-only preflight scan after an isolate crash", async () => {
    const contactId = "contact-stale-preflight"
    const harness = installHarness({ contactId })
    const stub = testEnv.AGREEMENT_CLAIMS.getByName(contactId)
    const input = signup({
      email: "stale-preflight@example.com",
      contactName: "Stale Preflight",
    })
    const revision = buildAgreementRevision(testEnv, { contactId, input })
    const fingerprint = await agreementRevisionFingerprint(revision)

    await runInDurableObject(stub, async (_instance, state) => {
      const staleAt = Date.now() - 60_000
      state.storage.sql.exec(
        `INSERT INTO agreement_claim
          (fingerprint, revision_json, stage, created_at, updated_at)
         VALUES (?, ?, 'preflight_scanning', ?, ?)`,
        fingerprint,
        JSON.stringify(revision),
        staleAt,
        staleAt
      )
    })

    expect(await stub.processAgreement({ contactId, input })).toMatchObject({
      outcome: "completed",
    })
    expect(harness.commercialWrites).toHaveLength(1)
    expect(harness.templateCreates).toHaveLength(1)
    expect(harness.linkCreates).toHaveLength(1)
  })
})
