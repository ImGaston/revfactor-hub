import type { NormalizedProviderEvent } from "@/lib/market-signals/contracts"
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
