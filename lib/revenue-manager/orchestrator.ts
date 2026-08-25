import type {
  DiagnosticCandidate,
  MetricEvidence,
  RevenuePropertyProfile,
} from "@/lib/revenue-manager/contracts"
import { REVENUE_CONTRACT_VERSIONS } from "@/lib/revenue-manager/contracts"
import type { RevenueReviewState } from "@/lib/revenue-manager/persistence"

export type RevenueDataIssue = {
  issueKey: string
  severity: "info" | "warning" | "blocking"
  title: string
  detail: string
  blocksRecommendation: boolean
}

export type RevenueReviewResult = {
  primaryState: RevenueReviewState
  verdict: string
  attention: {
    title: string
    summary: string
    nextStep: string
    confidence: "high" | "medium" | "low" | "unknown"
  } | null
  diagnostics: DiagnosticCandidate[]
  dataIssues: RevenueDataIssue[]
  commercialActionProposed: false
}

export type RevenueReviewInput = {
  profile: RevenuePropertyProfile
  metrics: MetricEvidence[]
  adjustedOccupancyDefinitionResolved: boolean
  forwardInventorySemanticsResolved: boolean
}

function findMetric(metrics: MetricEvidence[], metricKey: string) {
  return metrics.find((metric) => metric.metricKey === metricKey) ?? null
}

export function runDeterministicRevenueReview(
  input: RevenueReviewInput
): RevenueReviewResult {
  const pace = findMetric(input.metrics, "adjusted_occupancy_15d")
  const minimumExposure = findMetric(
    input.metrics,
    "minimum_price_exposure_15d"
  )
  const paceRatio =
    pace?.value != null && pace.benchmark?.value
      ? pace.value / pace.benchmark.value
      : null

  const dataIssues: RevenueDataIssue[] = []
  if (!input.adjustedOccupancyDefinitionResolved) {
    dataIssues.push({
      issueKey: "adjusted_occupancy_definition_unresolved",
      severity: "blocking",
      title: "Confirm the close-in occupancy definition",
      detail:
        "The property and market values are directionally useful, but their adjusted-occupancy definition and exact market cohort are unresolved.",
      blocksRecommendation: true,
    })
  }
  if (!input.forwardInventorySemanticsResolved) {
    dataIssues.push({
      issueKey: "forward_inventory_status_semantics",
      severity: "blocking",
      title: "Confirm which forward nights are truly sellable",
      detail:
        "Blocked and unbookable fields conflict in the source fixture, so date-level availability needs reconciliation.",
      blocksRecommendation: true,
    })
  }

  const paceIsMaterial = paceRatio != null && paceRatio >= 1.5
  const floorExposureIsMaterial =
    minimumExposure?.value != null && minimumExposure.value >= 0.5

  if (!paceIsMaterial && !floorExposureIsMaterial) {
    return {
      primaryState: "no_action",
      verdict:
        "No sufficiently material close-in pricing condition is supported by the current evidence.",
      attention: null,
      diagnostics: [],
      dataIssues,
      commercialActionProposed: false,
    }
  }

  const candidate: DiagnosticCandidate = {
    schemaVersion: REVENUE_CONTRACT_VERSIONS.diagnostic,
    candidateId: `${input.profile.propertyKey}-close-in-pace-v1`,
    propertyKey: input.profile.propertyKey,
    family: "pace",
    title: "Close-in pace may be outrunning the current rate stack",
    affectedRange: pace?.stayRange ?? null,
    factEvidenceIds: [pace, minimumExposure]
      .filter((metric): metric is MetricEvidence => metric != null)
      .map((metric) => metric.evidenceId),
    inference:
      "Close-in demand may be stronger than the current floor, discount, and override stack is capturing.",
    competingExplanations: [
      "The adjusted occupancy calculation may differ between the property and market cohort.",
      "Forward availability restrictions may be inflating the apparent occupancy signal.",
      "Date-specific demand may explain the pace without implying a base-price issue.",
    ],
    confidence: dataIssues.some((issue) => issue.blocksRecommendation)
      ? "medium"
      : "high",
    estimatedImpact: { low: null, high: null, unit: "USD" },
    urgency: 0.9,
    reversibility: 1,
    riskOfDoingNothing: 0.65,
    riskOfActing: 0.7,
    constraintConflicts: [],
    overlapsActiveWork: false,
  }

  if (dataIssues.some((issue) => issue.blocksRecommendation)) {
    return {
      primaryState: "data_blocked",
      verdict:
        "Ashwood is pacing ahead close-in, but source definitions must be resolved before any rate change is proposed.",
      attention: {
        title: "Validate the close-in pace and sellable inventory",
        summary:
          "The 15-day adjusted occupancy is 90% versus a 22% market benchmark, while 67% of the window is reported at the minimum price. These signals are material but not yet decision-safe.",
        nextStep:
          "Reconcile adjusted-occupancy and forward-inventory definitions, then review the floor, last-minute discount, and date overrides before considering base price.",
        confidence: "medium",
      },
      diagnostics: [candidate],
      dataIssues,
      commercialActionProposed: false,
    }
  }

  return {
    primaryState: "recommendation_pending",
    verdict:
      "Ashwood is pacing materially ahead close-in; review the rate stack before considering a base-price change.",
    attention: {
      title: "Review the close-in rate stack",
      summary:
        "The aligned pace and minimum-price signals justify a focused human review, not an automatic pricing change.",
      nextStep:
        "Inspect the minimum floor, last-minute discount, and date overrides for the affected dates while preserving protected-date policies.",
      confidence: "high",
    },
    diagnostics: [candidate],
    dataIssues,
    commercialActionProposed: false,
  }
}
