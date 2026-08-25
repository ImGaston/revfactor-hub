import { describe, expect, it } from "vitest"

import {
  analyzeOnboardingListingUrl,
  analyzeOnboardingPmsName,
  applyOnboardingStudyAnswer,
  buildOnboardingStudyPayload,
  buildOnboardingStudyTranscript,
  getOnboardingStudyQuestions,
  ONBOARDING_STUDY_SKIPPED,
  suggestPropertyNameCorrection,
  type OnboardingStudyAnswers,
  validateOnboardingStudyAnswer,
} from "@/lib/onboarding-study"

const COMPLETE_ANSWERS: OnboardingStudyAnswers = {
  property_name: "Ashwood",
  listing_url: "https://www.airbnb.com/rooms/123456",
  is_live: "yes",
  launch_month: "May",
  launch_year: "2024",
  has_pms: "yes",
  pms_name: "Hospitable",
  has_pricelabs: "yes",
  airbnb_access: "submitted",
  pms_access: "in-progress",
  pricelabs_access: "submitted",
  listing_access: "submitted",
  revenue_target: "95000",
  minimum_nightly_price: "125",
  cleaning_cost: "175",
  min_stay_midweek: "2",
  min_stay_weekend: "3",
  has_event: "yes",
  event_name: "Annual music festival",
  event_month: "October",
  event_recurrence: "one-off",
  event_year: "2026",
  event_demand: "significant",
  has_comp: "yes",
  comp_url: "https://www.airbnb.com/rooms/654321",
  pricing_priority: "maximize_revenue",
  notes: "Same-day turns are possible.",
}

describe("onboarding guided-chat study", () => {
  it("keeps conditional questions aligned with the existing run contract", () => {
    const liveWithPms = getOnboardingStudyQuestions({
      is_live: "yes",
      has_pms: "yes",
      has_pricelabs: "yes",
      has_event: "yes",
      event_recurrence: "one-off",
      has_comp: "yes",
    }).map((question) => question.id)

    expect(liveWithPms).toContain("launch_month")
    expect(liveWithPms).not.toContain("target_launch_month")
    expect(liveWithPms).toContain("pms_name")
    expect(liveWithPms).toContain("pms_access")
    expect(liveWithPms).toContain("pricelabs_access")
    expect(liveWithPms).toContain("event_year")
    expect(liveWithPms).toContain("comp_url")
    expect(liveWithPms.indexOf("launch_year")).toBeLessThan(
      liveWithPms.indexOf("launch_month")
    )
    expect(liveWithPms.indexOf("event_year")).toBeLessThan(
      liveWithPms.indexOf("event_month")
    )

    const plannedWithoutSystems = getOnboardingStudyQuestions({
      is_live: "no",
      has_pms: "no",
      has_pricelabs: "no",
      has_event: "no",
      has_comp: "no",
    }).map((question) => question.id)

    expect(plannedWithoutSystems).toContain("target_launch_month")
    expect(plannedWithoutSystems).not.toContain("launch_month")
    expect(plannedWithoutSystems).not.toContain("pms_name")
    expect(plannedWithoutSystems).not.toContain("pms_access")
    expect(plannedWithoutSystems).not.toContain("pricelabs_access")
    expect(plannedWithoutSystems).not.toContain("event_name")
    expect(plannedWithoutSystems).not.toContain("comp_url")
    expect(plannedWithoutSystems.indexOf("target_launch_year")).toBeLessThan(
      plannedWithoutSystems.indexOf("target_launch_month")
    )
  })

  it("builds the payload shape normalized by migration 042", () => {
    const payload = buildOnboardingStudyPayload(COMPLETE_ANSWERS)

    expect(payload).toMatchObject({
      runId: "study-initial-001",
      listingCount: 1,
      childListingCount: 0,
      hasPms: "yes",
      pms: "Hospitable",
      hasPricelabs: "yes",
      listings: [
        {
          id: 1,
          name: "Ashwood",
          isLive: "yes",
          launchMonth: "May",
          launchYear: "2024",
        },
      ],
      pricingPreferences: {
        "primary-1": {
          revenueTarget: "95000",
          minimumNightlyPrice: "125",
          cleaningCost: "175",
          minStayMidweek: "2",
          minStayWeekend: "3",
        },
      },
      knowledgeAnswers: { pricing_priority: "maximize_revenue" },
    })
    expect(payload.tasks).toEqual([
      { id: "airbnb", clientStatus: "submitted" },
      { id: "pms", clientStatus: "in-progress" },
      { id: "pricelabs", clientStatus: "submitted" },
      { id: "listing", clientStatus: "submitted" },
    ])
    expect(payload.readinessChecks).toEqual({
      airbnb_access: true,
      listing_details: true,
      pms_access: false,
      pricelabs_access: true,
    })
    expect(payload.pricingEvents[0]).toEqual({
      name: "Annual music festival",
      month: "October",
      year: "2026",
      recurrence: "one-off",
      demand: "significant",
      appliesTo: ["primary-1"],
    })
    expect(payload.pricingComps[0]).toEqual({
      url: "https://www.airbnb.com/rooms/654321",
      appliesTo: ["primary-1"],
    })
  })

  it("omits inapplicable integration tasks and cleans skipped values", () => {
    const payload = buildOnboardingStudyPayload({
      ...COMPLETE_ANSWERS,
      listing_url: ONBOARDING_STUDY_SKIPPED,
      has_pms: "no",
      pms_name: undefined,
      pms_access: undefined,
      has_pricelabs: "no",
      pricelabs_access: undefined,
      has_event: "no",
      has_comp: "no",
    })

    expect(payload.listings[0].url).toBe("")
    expect(payload.pms).toBe("")
    expect(payload.tasks.map((task) => task.id)).toEqual(["airbnb", "listing"])
    expect(payload.pricingEvents).toEqual([])
    expect(payload.pricingComps).toEqual([])
  })

  it("clears dependent answers when a client changes an earlier branch", () => {
    const changed = applyOnboardingStudyAnswer(
      COMPLETE_ANSWERS,
      "has_pms",
      "no"
    )

    expect(changed.has_pms).toBe("no")
    expect(changed.pms_name).toBeUndefined()
    expect(changed.pms_access).toBeUndefined()

    const transcript = buildOnboardingStudyTranscript(changed)
    expect(transcript).toContain("Client: No")
    expect(transcript).not.toContain("Client: Hospitable")
  })

  it("rejects credentials and malformed contract values before capture", () => {
    const questions = getOnboardingStudyQuestions({})
    const propertyQuestion = questions.find(
      (question) => question.id === "property_name"
    )!
    const listingUrlQuestion = questions.find(
      (question) => question.id === "listing_url"
    )!

    expect(
      validateOnboardingStudyAnswer(
        propertyQuestion,
        "password: do-not-store-this"
      )
    ).toContain("Do not paste passwords")
    expect(
      validateOnboardingStudyAnswer(listingUrlQuestion, "airbnb dot com")
    ).toBe("Enter a complete http:// or https:// URL.")
    expect(
      validateOnboardingStudyAnswer(
        listingUrlQuestion,
        ONBOARDING_STUDY_SKIPPED
      )
    ).toBeNull()
  })

  it("turns an Airbnb hosting URL into a confirmable public listing URL", () => {
    expect(
      analyzeOnboardingListingUrl(
        "https://www.airbnb.com/hosting/listings/editor/1329788633582491000/details"
      )
    ).toEqual({
      kind: "airbnb_hosting",
      originalUrl:
        "https://www.airbnb.com/hosting/listings/editor/1329788633582491000/details",
      normalizedUrl: "https://www.airbnb.com/rooms/1329788633582491000",
      listingId: "1329788633582491000",
    })
  })

  it("canonicalizes public Airbnb links without changing other public URLs", () => {
    expect(
      analyzeOnboardingListingUrl(
        "www.airbnb.com/rooms/1329788633582491000?source_impression_id=test"
      )
    ).toMatchObject({
      kind: "airbnb_public",
      normalizedUrl: "https://www.airbnb.com/rooms/1329788633582491000",
      listingId: "1329788633582491000",
    })

    expect(analyzeOnboardingListingUrl("https://example.com/stay")).toEqual({
      kind: "other_public",
      originalUrl: "https://example.com/stay",
      normalizedUrl: "https://example.com/stay",
      listingId: null,
    })
  })

  it("recognizes a property-name correction entered at the URL step", () => {
    expect(
      suggestPropertyNameCorrection("Ashwood", "Ashweood", "listing_url")
    ).toBe("Ashwood")
    expect(
      suggestPropertyNameCorrection(
        "change the property name to Ashwood House",
        "Ashweood",
        "listing_url"
      )
    ).toBe("Ashwood House")
  })

  it("suggests a known PMS for a likely typo without rejecting unknown systems", () => {
    expect(analyzeOnboardingPmsName("Hospitabel")).toEqual({
      kind: "suggestion",
      originalName: "Hospitabel",
      suggestedName: "Hospitable",
    })
    expect(analyzeOnboardingPmsName("hospitable")).toEqual({
      kind: "known",
      originalName: "hospitable",
      canonicalName: "Hospitable",
    })
    expect(analyzeOnboardingPmsName("Acme Stay Manager")).toEqual({
      kind: "unknown",
      originalName: "Acme Stay Manager",
    })
  })
})
