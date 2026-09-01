export const AIRBNB_CANCELLATION_POLICIES = [
  "flexible",
  "moderate",
  "limited",
  "firm",
  "strict",
  "super_strict_30",
  "super_strict_60",
] as const

export type AirbnbCancellationPolicy =
  (typeof AIRBNB_CANCELLATION_POLICIES)[number]

export const AIRBNB_CANCELLATION_POLICY_LABELS: Record<
  AirbnbCancellationPolicy,
  string
> = {
  flexible: "Flexible",
  moderate: "Moderate",
  limited: "Limited",
  firm: "Firm",
  strict: "Strict",
  super_strict_30: "Super Strict 30",
  super_strict_60: "Super Strict 60",
}

export function isAirbnbCancellationPolicy(
  value: unknown
): value is AirbnbCancellationPolicy {
  return (
    typeof value === "string" &&
    AIRBNB_CANCELLATION_POLICIES.includes(value as AirbnbCancellationPolicy)
  )
}

export function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

export type AirbnbFoundationListing = {
  id: string
  name: string
  status: string
  client_id: string | null
  client_name: string | null
  airbnb_id: string | null
  airbnb_link: string | null
  listing_id: string | null
  default_cancellation_policy: AirbnbCancellationPolicy | null
  timezone: string | null
}

export type AirbnbFoundationInventoryRow = AirbnbFoundationListing & {
  account_classification: "RevFactor" | "Blackbird"
  airbnb_identity_present: boolean
  missing_or_blocked_reason: string | null
}

function present(value: string | null): boolean {
  return Boolean(value?.trim())
}

export function buildAirbnbFoundationInventoryRow(
  listing: AirbnbFoundationListing
): AirbnbFoundationInventoryRow {
  const accountClassification = listing.client_id
    ? ("RevFactor" as const)
    : ("Blackbird" as const)
  const reasons: string[] = []

  if (listing.status !== "active") reasons.push("inactive_listing")
  if (accountClassification === "RevFactor" && !present(listing.client_name)) {
    reasons.push("missing_revfactor_client_identity")
  }
  if (
    !present(listing.airbnb_id) &&
    !present(listing.airbnb_link) &&
    !present(listing.listing_id)
  ) {
    reasons.push("missing_airbnb_identity")
  }
  if (!listing.default_cancellation_policy) {
    reasons.push("missing_default_cancellation_policy")
  }
  if (!listing.timezone) reasons.push("missing_timezone")

  return {
    ...listing,
    account_classification: accountClassification,
    airbnb_identity_present:
      present(listing.airbnb_id) ||
      present(listing.airbnb_link) ||
      present(listing.listing_id),
    missing_or_blocked_reason: reasons.length > 0 ? reasons.join(";") : null,
  }
}

export function sortAirbnbFoundationInventory(
  rows: AirbnbFoundationInventoryRow[]
): AirbnbFoundationInventoryRow[] {
  return [...rows].sort((a, b) =>
    a.id === b.id
      ? a.name.localeCompare(b.name, "en")
      : a.id.localeCompare(b.id)
  )
}
