import { afterEach, describe, expect, it, vi } from "vitest"
import {
  agreementDocumentName,
  agreementTemplate,
  default as worker,
  parseSignup,
  resolvePricingProgram,
  serviceValues,
} from "@/workers/ghl-inline-onboarding/src/index"

const env = {
  HIGHLEVEL_API_KEY: "test-token",
  HIGHLEVEL_LOCATION_ID: "location-123",
  HIGHLEVEL_ONBOARDING_TEMPLATE_ID: "standard-template",
  HIGHLEVEL_ONBOARDING_REFERRAL_TEMPLATE_ID: "referral-template",
  HIGHLEVEL_ONBOARDING_SENDER_USER_ID: "user-123",
  HIGHLEVEL_ONBOARDING_TEMPLATE_NAME: "Standard_Agreement",
  HIGHLEVEL_ONBOARDING_REFERRAL_TEMPLATE_NAME: "Referral_Agreement",
  HIGHLEVEL_ONBOARDING_REFERRAL_CODES: " partner-one, STRLTB ",
  HIGHLEVEL_DOCUMENT_SIGNING_BASE_URL: "https://links.revfactor.io",
  HIGHLEVEL_ONBOARDING_ALLOWED_ORIGIN: "https://links.revfactor.io",
}

const validSignup = {
  legalName: "Example Holdings LLC",
  contactName: "Example Client",
  email: "client@example.com",
  phone: "+15555555555",
  primaryListingQuantity: 2,
  childListingQuantity: 0,
  serviceStartMode: "immediate",
  serviceStartDate: null,
  website: "",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("GHL inline onboarding offer authority", () => {
  it("defaults blank offer codes to the standard agreement", () => {
    expect(
      resolvePricingProgram(undefined, env.HIGHLEVEL_ONBOARDING_REFERRAL_CODES)
    ).toBe("Regular")
    expect(parseSignup(validSignup, env)).toMatchObject({
      pricingProgram: "Regular",
      primaryListingQuantity: 2,
    })
    expect(
      serviceValues({ primaryListingQuantity: 2, pricingProgram: "Regular" })
    ).toEqual({
      primaryMonthlyRate: 350,
      monthlyServiceFee: 700,
      onboardingFee: 150,
      initialCheckoutTotal: 850,
      pricingProgram: "Regular",
    })
  })

  it("matches referral codes case-insensitively on the server allowlist", () => {
    expect(
      parseSignup({ ...validSignup, offerCode: " strltb " }, env)
    ).toMatchObject({ pricingProgram: "Referral" })
    expect(
      serviceValues({ primaryListingQuantity: 2, pricingProgram: "Referral" })
    ).toEqual({
      primaryMonthlyRate: 320,
      monthlyServiceFee: 640,
      onboardingFee: 150,
      initialCheckoutTotal: 790,
      pricingProgram: "Referral",
    })
  })

  it("does not let browser-supplied pricing select the referral template", () => {
    const input = parseSignup(
      { ...validSignup, pricingProgram: "Referral" },
      env
    )
    expect(input.pricingProgram).toBe("Regular")
    expect(agreementTemplate(env, input.pricingProgram)).toMatchObject({
      templateId: "standard-template",
      templateName: "Standard_Agreement",
    })
    expect(
      agreementTemplate(
        env,
        resolvePricingProgram("STRLTB", env.HIGHLEVEL_ONBOARDING_REFERRAL_CODES)
      )
    ).toMatchObject({
      templateId: "referral-template",
      templateName: "Referral_Agreement",
    })
  })

  it("binds replay identity to the template and exact primary quantity", () => {
    const input = parseSignup(validSignup, env)
    expect(agreementDocumentName(input, "Standard_Agreement")).toBe(
      "Standard_Agreement — Example Client — q2"
    )
    expect(
      agreementDocumentName(
        { ...input, primaryListingQuantity: 3 },
        "Standard_Agreement"
      )
    ).not.toBe(agreementDocumentName(input, "Standard_Agreement"))
  })

  it("fails closed for an unknown non-empty offer code", () => {
    expect(() =>
      parseSignup({ ...validSignup, offerCode: "unknown" }, env)
    ).toThrow("Enter a valid referral code")
  })

  it("quotes referral pricing without creating a GHL contact or document", async () => {
    const response = await worker.fetch(
      new Request("https://worker.example/quote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://links.revfactor.io",
        },
        body: JSON.stringify({
          offerCode: "PARTNER-ONE",
          primaryListingQuantity: 3,
        }),
      }),
      env
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      pricingProgram: "Referral",
      primaryMonthlyRate: 320,
      monthlyServiceFee: 960,
      onboardingFee: 150,
      initialCheckoutTotal: 1110,
    })
  })

  it("selects only the allowlisted referral template and writes canonical totals", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ contact: { id: "contact-123" } }))
      .mockResolvedValueOnce(jsonResponse({ documents: [] }))
      .mockResolvedValueOnce(jsonResponse({ contact: { id: "contact-123" } }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          documents: [
            {
              documentId: "document-123",
              name: "Referral_Agreement",
              status: "draft",
              recipients: [{ id: "contact-123" }],
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          links: [
            {
              referenceId: "reference-123",
              recipientId: "contact-123",
              entityName: "contacts",
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }))
    vi.stubGlobal("fetch", fetchMock)

    const response = await worker.fetch(
      new Request("https://worker.example/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://links.revfactor.io",
        },
        body: JSON.stringify({ ...validSignup, offerCode: "strltb" }),
      }),
      env
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(7)
    expect(await fetchMock.mock.calls[0][1]?.body).not.toContain("customFields")
    expect(await fetchMock.mock.calls[2][1]?.body).toContain(
      '"contact.rf_pricing_program","fieldValue":"Referral"'
    )
    expect(await fetchMock.mock.calls[2][1]?.body).toContain(
      '"contact.rf_monthly_service_fee","fieldValue":"640"'
    )
    expect(await fetchMock.mock.calls[3][1]?.body).toContain(
      '"templateId":"referral-template"'
    )
    expect(await fetchMock.mock.calls[5][1]?.body).toContain(
      '"documentName":"Referral_Agreement — Example Client — q2"'
    )
  })

  it("fails before commercial-field mutation when a competing agreement exists", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ contact: { id: "contact-123" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          documents: [
            {
              documentId: "document-standard",
              name: "Standard_Agreement — Example Client — q2",
              status: "sent",
              recipients: [{ id: "contact-123" }],
            },
          ],
        })
      )
    vi.stubGlobal("fetch", fetchMock)

    const response = await worker.fetch(
      new Request("https://worker.example/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://links.revfactor.io",
        },
        body: JSON.stringify({ ...validSignup, offerCode: "strltb" }),
      }),
      env
    )

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await fetchMock.mock.calls[0][1]?.body).not.toContain("customFields")
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("agreement already exists"),
    })
  })

  it("rejects child listings and deferred starts in the standard journey", () => {
    expect(() =>
      parseSignup({ ...validSignup, childListingQuantity: 1 }, env)
    ).toThrow("Child listings require a separate RevFactor onboarding path")
    expect(() =>
      parseSignup(
        {
          ...validSignup,
          serviceStartMode: "scheduled",
          serviceStartDate: "2026-09-15",
        },
        env
      )
    ).toThrow("The standard RevFactor signup starts service immediately")
  })
})
