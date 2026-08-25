import { describe, expect, it } from "vitest"
import { getAshwoodEvidenceBundle } from "@/lib/revenue-manager/evidence"
import { runDeterministicRevenueReview } from "@/lib/revenue-manager/orchestrator"
import { buildAshwoodWorkspace } from "@/lib/revenue-manager/workspace"
import {
  parsePersistedRecommendation,
  serializeRecommendationForPersistence,
  type RevenueRecommendationRow,
} from "@/lib/revenue-manager/persistence"
import {
  REVENUE_CONTRACT_VERSIONS,
  revenueRecommendationSchema,
} from "@/lib/revenue-manager/contracts"

describe("Revenue Manager read-only review orchestration", () => {
  it("keeps the Ashwood fixture data-blocked instead of proposing a rate change", () => {
    const workspace = buildAshwoodWorkspace()

    expect(workspace.review.primaryState).toBe("data_blocked")
    expect(workspace.review.commercialActionProposed).toBe(false)
    expect(workspace.review.verdict).toContain("pacing ahead")
    expect(workspace.review.dataIssues.map((issue) => issue.issueKey)).toEqual([
      "adjusted_occupancy_definition_unresolved",
      "forward_inventory_status_semantics",
    ])
    expect(workspace.decisions).toEqual([])
  })

  it("surfaces a focused rate-stack review once definitions are resolved", () => {
    const evidence = getAshwoodEvidenceBundle()
    const result = runDeterministicRevenueReview({
      profile: evidence.profile,
      metrics: evidence.metrics,
      adjustedOccupancyDefinitionResolved: true,
      forwardInventorySemanticsResolved: true,
    })

    expect(result.primaryState).toBe("recommendation_pending")
    expect(result.attention?.title).toBe("Review the close-in rate stack")
    expect(result.commercialActionProposed).toBe(false)
    expect(result.diagnostics[0].inference).toContain("floor")
  })

  it("records no action when close-in signals are not material", () => {
    const evidence = getAshwoodEvidenceBundle()
    const metrics = evidence.metrics.map((metric) => {
      if (metric.metricKey === "adjusted_occupancy_15d") {
        return {
          ...metric,
          value: 0.25,
          benchmark: metric.benchmark
            ? { ...metric.benchmark, value: 0.22 }
            : null,
        }
      }
      if (metric.metricKey === "minimum_price_exposure_15d") {
        return { ...metric, value: 0.2 }
      }
      return metric
    })

    const result = runDeterministicRevenueReview({
      profile: evidence.profile,
      metrics,
      adjustedOccupancyDefinitionResolved: true,
      forwardInventorySemanticsResolved: true,
    })

    expect(result.primaryState).toBe("no_action")
    expect(result.attention).toBeNull()
    expect(result.diagnostics).toEqual([])
  })

  it("validates every generated profile and metric through the v1 contracts", () => {
    const evidence = getAshwoodEvidenceBundle()

    expect(evidence.profile.schemaVersion).toBe("revenue-profile.v1")
    expect(evidence.metrics).toHaveLength(4)
    expect(
      evidence.metrics.every((metric) => metric.propertyKey === "ashwood-pilot")
    ).toBe(true)
    expect(evidence.sourceManifest.mode).toBe("sanitized_fixture")
  })

  it("round-trips the structured recommendation persistence payload", () => {
    const recommendation = revenueRecommendationSchema.parse({
      schemaVersion: REVENUE_CONTRACT_VERSIONS.recommendation,
      recommendationId: "recommendation-1",
      version: 1,
      propertyKey: "ashwood-pilot",
      reviewRunId: "review-1",
      strategyVersionId: "strategy-1",
      listingOrChannel: "all_channels",
      title: "Review close-in rate stack",
      verdict: "Human review is justified; no automatic change is allowed.",
      problemStatement: "Close-in pace materially exceeds the benchmark.",
      affectedStayRange: { start: "2026-08-20", end: "2026-09-03" },
      affectedBookingRange: null,
      factEvidenceIds: ["pace-15d", "minimum-exposure-15d"],
      inference: "The current rate stack may be leaving ADR uncaptured.",
      competingExplanations: ["Market cohort definition may differ."],
      proposedAction: {
        actionType: "review_price_stack",
        before: { status: "unreviewed" },
        after: { status: "human_reviewed" },
        implementationNotes: null,
      },
      expectedEffect: {
        metricKey: "achieved_adr",
        low: null,
        high: null,
        unit: "USD",
        outcomeWindow: { start: "2026-08-20", end: "2026-09-03" },
      },
      risks: ["A rate increase could slow conversion."],
      guardrails: ["Do not discount protected dates."],
      confidence: "medium",
      confidenceReasons: ["Pace and price-floor signals align."],
      requiredPermission: "revenue:publish",
      decisionDueAt: "2026-08-21T12:00:00-04:00",
      reversalPlan: "Retain current settings if the review is inconclusive.",
      reviewTrigger: "After source definitions are resolved.",
      conflicts: [],
      status: "draft",
    })
    const payload = serializeRecommendationForPersistence(recommendation)
    const row: RevenueRecommendationRow = {
      id: recommendation.recommendationId,
      review_run_id: recommendation.reviewRunId,
      listing_id: "listing-1",
      ...payload,
      expires_at: null,
      supersedes_id: null,
      created_by: "profile-1",
      created_at: "2026-08-20T00:00:00-04:00",
      updated_at: "2026-08-20T00:00:00-04:00",
    }

    expect(parsePersistedRecommendation(row)).toEqual(recommendation)
  })
})
