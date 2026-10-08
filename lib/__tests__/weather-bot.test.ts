import { describe, expect, it } from "vitest"

import {
  weatherBotDeliveryResultSchema,
  weatherBotSeverityLabel,
  weatherBotSignalPayloadSchema,
  weatherBotSlackSummary,
  weatherBotWorkRequestSchema,
  type WeatherBotSignalPayload,
} from "@/lib/weather-bot"

const signal: WeatherBotSignalPayload = {
  schemaVersion: 1,
  impactId: "11111111-1111-4111-8111-111111111111",
  eventId: "22222222-2222-4222-8222-222222222222",
  eventVersion: 2,
  title: "Hurricane watch",
  state: "verified",
  startAt: "2026-09-01T12:00:00+00:00",
  endAt: "2026-09-03T12:00:00+00:00",
  market: {
    id: "33333333-3333-4333-8333-333333333333",
    slug: "myrtle-beach-sc",
    name: "Myrtle Beach, SC",
    timezone: "America/New_York",
  },
  scores: {
    materiality: 87,
    vulnerability: 64,
    actionGate: "review_now",
    evidenceFreshness: "current",
  },
  impactWindow: {
    start: "2026-09-01",
    end: "2026-09-03",
    distanceMiles: 18,
  },
  exposure: {
    evaluatedListings: 40,
    exposedListings: 12,
    topListings: [],
  },
  evidence: {
    url: "https://www.weather.gov/example",
    publisher: "National Weather Service",
    summary: "Potential tropical-storm conditions are under review.",
    observedAt: "2026-08-29T12:00:00+00:00",
    authorityTier: 1,
  },
  generatedAt: "2026-08-29T12:01:00+00:00",
  hubUrl: "/market-signals",
}

describe("Weather-bot signal contract", () => {
  it("validates the governed signal payload", () => {
    expect(weatherBotSignalPayloadSchema.parse(signal)).toEqual(signal)
  })

  it("labels material weather and summarizes the decision KPIs", () => {
    expect(weatherBotSeverityLabel(signal)).toBe("high")
    expect(weatherBotSlackSummary(signal)).toContain(
      "Materiality 87 · Vulnerability 64 · 12/40 listings"
    )
    expect(weatherBotSlackSummary(signal)).toContain("Myrtle Beach, SC")
  })

  it("treats cancellation and unwind signals as critical", () => {
    expect(
      weatherBotSeverityLabel({
        ...signal,
        state: "canceled",
        scores: { ...signal.scores, actionGate: "unwind" },
      })
    ).toBe("critical")
  })

  it("requires delivery leases and bounds external worker batches", () => {
    expect(
      weatherBotDeliveryResultSchema.safeParse({
        outcome: "delivered",
        leaseToken: "44444444-4444-4444-8444-444444444444",
        slackChannelId: "C123",
      }).success
    ).toBe(false)
    expect(weatherBotWorkRequestSchema.parse({})).toEqual({ maximumJobs: 5 })
    expect(
      weatherBotWorkRequestSchema.safeParse({ maximumJobs: 11 }).success
    ).toBe(false)
  })
})
