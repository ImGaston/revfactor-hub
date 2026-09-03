import type {
  MarketEventChangeType,
  NormalizedProviderEvent,
} from "@/lib/market-signals/contracts"
import { canonicalEventFingerprint } from "@/lib/market-signals/domain"

export type MarketSignalMarket = {
  id: string
  name: string
  countryCode: string
  timezone: string
  centerLat: number
  centerLon: number
  radiusMiles: number
  kind: "urban" | "destination" | "cabin" | "coastal" | "mixed"
}

export type MarketSignalProviderCandidate = {
  normalized: NormalizedProviderEvent
  providerState: string
  rank: number | null
  accommodationSpend: number | null
  impactStart: string
  impactEnd: string
  publisher: string
  authorityTier: 1 | 2 | 3 | 4
  verificationState: "unverified" | "corroborating" | "verified" | "rejected"
  evidenceSummary: string
  materialityFloor?: number
  retentionFloor?: number
  // Some first-party pages expose no publication timestamp. Their adapter
  // supplies the observation time initially; persistence then preserves the
  // first-seen value and excludes observation-only timestamps from content
  // identity so an unchanged page does not churn versions every poll.
  timestampsFromObservation?: boolean
}

export type MarketSignalProviderFetchResult<TRaw> = {
  events: TRaw[]
  totalAvailable: number
  overflow: boolean
}

export class MarketSignalProviderRequestError extends Error {
  readonly status: number
  readonly provider: string

  constructor(provider: string, message: string, status: number) {
    super(message)
    this.name = "MarketSignalProviderRequestError"
    this.provider = provider
    this.status = status
  }
}

export function stabilizeObservationTimestamps(input: {
  incoming: NormalizedProviderEvent
  previous: NormalizedProviderEvent | null
  changeType: MarketEventChangeType
  observedAt: string
  timestampsFromObservation: boolean
}) {
  if (!input.timestampsFromObservation || !input.previous) {
    return input.incoming
  }
  return {
    ...input.incoming,
    firstSeenAt: input.previous.firstSeenAt,
    updatedAt:
      input.changeType === "unchanged"
        ? input.previous.updatedAt
        : input.observedAt,
  }
}

export function stripObservationTimestamps<
  T extends { firstSeenAt: unknown; updatedAt: unknown },
>(value: T, timestampsFromObservation: boolean) {
  return timestampsFromObservation
    ? { ...value, firstSeenAt: null, updatedAt: null }
    : value
}

export function batchProviderCandidates(
  candidates: MarketSignalProviderCandidate[],
  batchSize: number
) {
  let pending = [...candidates]
  const batches: MarketSignalProviderCandidate[][] = []

  while (pending.length > 0) {
    const fingerprints = new Set<string>()
    const selected: MarketSignalProviderCandidate[] = []
    const deferred: MarketSignalProviderCandidate[] = []

    for (const candidate of pending) {
      const fingerprint = canonicalEventFingerprint(candidate.normalized)
      if (selected.length < batchSize && !fingerprints.has(fingerprint)) {
        fingerprints.add(fingerprint)
        selected.push(candidate)
      } else {
        deferred.push(candidate)
      }
    }

    batches.push(selected)
    pending = deferred
  }

  return batches
}
