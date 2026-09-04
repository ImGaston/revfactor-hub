import { describe, expect, it } from "vitest"
import {
  agreementDocumentName,
  agreementRevisionFingerprint,
  agreementTemplate,
  buildAgreementRevision,
  type Env,
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
} as unknown as Env

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

  it("binds replay identity to legal name, template, quantity, and exact terms", async () => {
    const input = parseSignup(validSignup, env)
    const revision = buildAgreementRevision(env, {
      contactId: "contact-123",
      input,
    })
    const fingerprint = await agreementRevisionFingerprint(revision)
    expect(agreementDocumentName(revision, fingerprint)).toMatch(
      /^Standard_Agreement — Example Client — rf-[0-9a-f]{16}$/
    )
    const changedLegalName = buildAgreementRevision(env, {
      contactId: "contact-123",
      input: { ...input, legalName: "Changed Holdings LLC" },
    })
    expect(await agreementRevisionFingerprint(changedLegalName)).not.toBe(
      fingerprint
    )
  })

  it("fails closed for an unknown non-empty offer code", () => {
    expect(() =>
      parseSignup({ ...validSignup, offerCode: "unknown" }, env)
    ).toThrow("Enter a valid referral code")
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
