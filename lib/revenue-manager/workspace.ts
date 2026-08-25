import fixture from "@/lib/revenue-manager/fixtures/ashwood.v1.json"
import { getAshwoodEvidenceBundle } from "@/lib/revenue-manager/evidence"
import { runDeterministicRevenueReview } from "@/lib/revenue-manager/orchestrator"
import type {
  MetricEvidence,
  RevenuePropertyProfile,
} from "@/lib/revenue-manager/contracts"
import type { RevenueReviewResult } from "@/lib/revenue-manager/orchestrator"

export type RevenueManagerWorkspace = {
  mode: "sanitized_fixture"
  property: {
    key: string
    name: string
    market: string
    lifecycleLabel: string
  }
  asOf: string
  profile: RevenuePropertyProfile
  metrics: MetricEvidence[]
  review: RevenueReviewResult
  sourceCount: number
  decisions: Array<never>
}

export function buildAshwoodWorkspace(): RevenueManagerWorkspace {
  const evidence = getAshwoodEvidenceBundle()
  const review = runDeterministicRevenueReview({
    profile: evidence.profile,
    metrics: evidence.metrics,
    adjustedOccupancyDefinitionResolved:
      fixture.sourceSnapshots.pricelabs.adjustedOccupancy.definitionStatus ===
      "resolved",
    forwardInventorySemanticsResolved:
      fixture.forwardInventory.statusSemanticsResolved,
  })

  return {
    mode: "sanitized_fixture",
    property: {
      key: fixture.property.propertyKey,
      name: fixture.property.displayName,
      market: fixture.property.market,
      lifecycleLabel: "Existing managed property",
    },
    asOf: evidence.sourceManifest.asOf,
    profile: evidence.profile,
    metrics: evidence.metrics,
    review,
    sourceCount: evidence.sourceManifest.snapshots.length,
    decisions: [],
  }
}
