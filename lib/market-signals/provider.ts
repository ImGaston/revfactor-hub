import type { NormalizedProviderEvent } from "@/lib/market-signals/contracts"

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
