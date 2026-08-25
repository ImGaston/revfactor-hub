import type {
  MarketEventChangeType,
  MarketEventState,
  MarketSignalActionGate,
  MarketSignalReviewProposal,
  NormalizedProviderEvent,
} from "@/lib/market-signals/contracts"

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bthe\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function stableHash(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export function eventFamilyKey(title: string) {
  const normalized = normalizeText(title)
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return `event:${normalized || "unknown"}`
}

export function canonicalEventFingerprint(
  event: Pick<
    NormalizedProviderEvent,
    "title" | "startDate" | "venueName" | "city" | "region" | "countryCode"
  >
) {
  const date = event.startDate.slice(0, 10)
  const location = event.venueName
    ? normalizeText(event.venueName)
    : [event.city, event.region, event.countryCode]
        .filter(Boolean)
        .map((value) => normalizeText(value ?? ""))
        .join(":")
  const identity = [normalizeText(event.title), date, location].join("|")

  return `market-event:${stableHash(identity)}`
}

export function distanceMiles(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
) {
  const earthRadiusMiles = 3958.8
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const latitudeDelta = radians(to.latitude - from.latitude)
  const longitudeDelta = radians(to.longitude - from.longitude)
  const firstLatitude = radians(from.latitude)
  const secondLatitude = radians(to.latitude)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2

  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(haversine))
}

export function calculateMaterialityScore(input: {
  attendance: number | null
  localRank: number | null
  rank: number | null
  accommodationSpend: number | null
  category: string
  marketKind: "urban" | "destination" | "cabin" | "coastal" | "mixed"
  distanceMiles: number | null
  radiusMiles: number
}) {
  const attendanceScore = input.attendance
    ? Math.min(35, Math.log10(input.attendance + 1) * 7)
    : 0
  const localRankScore = (input.localRank ?? 0) * 0.3
  const globalRankScore = (input.rank ?? 0) * 0.1
  const spendScore = input.accommodationSpend
    ? Math.min(12, Math.log10(input.accommodationSpend + 1) * 2)
    : 0
  const categoryBoost =
    /sports|festivals|conferences|expos|concerts|performing-arts/i.test(
      input.category
    )
      ? 6
      : 0
  const destinationBoost =
    input.marketKind !== "urban" &&
    /festivals|sports|community|conferences|expos/i.test(input.category)
      ? 5
      : 0
  const proximityScore =
    input.distanceMiles == null
      ? 0
      : Math.max(
          0,
          7 * (1 - input.distanceMiles / Math.max(input.radiusMiles, 0.1))
        )

  return (
    Math.round(
      Math.min(
        100,
        attendanceScore +
          localRankScore +
          globalRankScore +
          spendScore +
          categoryBoost +
          destinationBoost +
          proximityScore
      ) * 100
    ) / 100
  )
}

export function shouldRetainProviderCandidate(input: {
  providerStatus: string
  materialityScore: number
  retentionFloor?: number
}) {
  const status = input.providerStatus.toLowerCase()
  if (/cancel|postpon/.test(status)) {
    return true
  }
  if (/deleted|duplicate|spam/.test(status)) return false
  const floor = input.retentionFloor ?? 40
  if (/predicted/.test(status)) {
    return input.materialityScore >= Math.max(60, floor)
  }
  return input.materialityScore >= floor
}

export function classifyEventChange(
  previous: NormalizedProviderEvent | null,
  current: NormalizedProviderEvent
): MarketEventChangeType {
  if (!previous) return "new"

  const priorStatus = normalizeText(previous.providerStatus ?? "")
  const currentStatus = normalizeText(current.providerStatus ?? "")
  const canceled = /cancel|called off|abandon/.test(currentStatus)
  const postponed = /postpon|reschedul|date tbd/.test(currentStatus)
  const wasNegative = /cancel|postpon|reschedul|called off|abandon/.test(
    priorStatus
  )

  if (canceled && !/cancel|called off|abandon/.test(priorStatus)) {
    return "canceled"
  }
  if (postponed && !/postpon|reschedul|date tbd/.test(priorStatus)) {
    return "postponed"
  }
  if (wasNegative && !canceled && !postponed) return "restored"
  if (
    previous.startDate !== current.startDate ||
    previous.endDate !== current.endDate
  ) {
    return "date_moved"
  }

  const changed =
    previous.title !== current.title ||
    previous.category !== current.category ||
    previous.venueName !== current.venueName ||
    previous.attendance !== current.attendance ||
    previous.localRank !== current.localRank ||
    previous.sourceUrl !== current.sourceUrl

  return changed ? "details_changed" : "unchanged"
}

export function determineActionGate(input: {
  state: MarketEventState
  verificationState: "unverified" | "corroborating" | "verified" | "rejected"
  authorityTier: 1 | 2 | 3 | 4
  corroborationCount: number
  materialityScore: number
  vulnerabilityScore: number | null
  evidenceFreshness: "current" | "stale" | "unknown"
}): MarketSignalActionGate {
  if (
    input.state === "canceled" ||
    input.state === "postponed" ||
    input.state === "unwind_required"
  ) {
    return "unwind"
  }

  if (
    input.verificationState !== "verified" ||
    input.evidenceFreshness !== "current"
  ) {
    return "watch"
  }

  const sufficientlyVerified =
    input.authorityTier <= 2 || input.corroborationCount >= 2
  const materiallyRelevant = input.materialityScore >= 65
  const vulnerable =
    input.vulnerabilityScore != null && input.vulnerabilityScore >= 45

  return sufficientlyVerified && materiallyRelevant && vulnerable
    ? "review_now"
    : "watch"
}

export function buildReviewProposal(input: {
  gate: MarketSignalActionGate
  category: string
  durationDays: number
  hasInventoryEvidence: boolean
  hasPricingEvidence: boolean
  hasStayRuleEvidence: boolean
}): MarketSignalReviewProposal {
  if (input.gate === "unwind") {
    return {
      gate: input.gate,
      actions: ["unwind_existing_overlay", "verify_inventory_and_pace"],
      explanation:
        "The event changed negatively. Verify current strategy and remove only event-specific overlays that are still present.",
      missingEvidence: [
        !input.hasInventoryEvidence ? "current inventory" : null,
        !input.hasPricingEvidence ? "current pricing state" : null,
        !input.hasStayRuleEvidence ? "current stay restrictions" : null,
      ].filter((value): value is string => value !== null),
    }
  }

  const actions: MarketSignalReviewProposal["actions"] = [
    "verify_inventory_and_pace",
  ]
  if (input.gate === "review_now") {
    actions.push("review_rate_premium")
    if (input.durationDays >= 2) actions.push("review_minimum_stay")
    if (/sports|festival|conference|expo/i.test(input.category)) {
      actions.push("review_arrival_departure_rules")
    }
  }

  return {
    gate: input.gate,
    actions,
    explanation:
      input.gate === "review_now"
        ? "Verified material demand may affect open nights. Review pricing and stay rules against current evidence before creating an Adjustment."
        : "Keep the signal on the watchlist until authority, materiality, or booking vulnerability is strong enough for review.",
    missingEvidence: [
      !input.hasInventoryEvidence ? "current inventory" : null,
      !input.hasPricingEvidence ? "current pricing state" : null,
      !input.hasStayRuleEvidence ? "current stay restrictions" : null,
    ].filter((value): value is string => value !== null),
  }
}
