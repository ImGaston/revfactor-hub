// The standard listing-review checklist. Every audit gives every check a
// status; the score, coverage and the owner page layout are derived from it,
// so reports never need to be redesigned per listing.
//
// Score parts and weights follow the RevFactor audit skill:
// Overall = 0.30 completion + 0.25 structure + 0.20 Airbnb style + 0.25 search words.

import type { OptimizationItemKind, OptimizationSection, ScoreBreakdown } from "@/lib/listing-optimization"

export type CheckSource = "guest" | "host"
export type CheckPart = keyof Required<ScoreBreakdown>
export type CheckStatus = "pass" | "thin" | "fail" | "na" | "not_checked"

export type CheckDefinition = {
  id: string
  section: OptimizationSection
  /** Owner-facing name of what was checked ("Neighborhood description"). */
  label: string
  /** Where it can be seen: the public page or only the host editor. */
  source: CheckSource
  part: CheckPart
  /** Relative weight inside its score part. */
  points: number
  /** Default kind for the suggestion when this check fails. */
  kind: Exclude<OptimizationItemKind, "info">
}

/** Bump when checks are added/removed so old reports stay interpretable. */
export const CHECKLIST_VERSION = "2026-10-12"

export const LISTING_CHECKS: CheckDefinition[] = [
  // Title
  { id: "title.length", section: "title", label: "Title fits on phones (under 50 characters)", source: "guest", part: "ota_style", points: 2, kind: "change" },
  { id: "title.hook", section: "title", label: "Title leads with the main reason to book", source: "guest", part: "seo", points: 3, kind: "change" },
  { id: "title.style", section: "title", label: "No pipes, emojis or all caps", source: "guest", part: "ota_style", points: 2, kind: "change" },
  { id: "title.no_repeat", section: "title", label: "Doesn't repeat what Airbnb already shows", source: "guest", part: "ota_style", points: 1, kind: "change" },

  // Description
  { id: "description.hook", section: "description", label: "Opening lines say who it's for and the best thing", source: "guest", part: "structure", points: 3, kind: "change" },
  { id: "description.space", section: "description", label: "“The space” walks through the home", source: "host", part: "structure", points: 2, kind: "change" },
  { id: "description.guest_access", section: "description", label: "Guest access section", source: "host", part: "completion", points: 1, kind: "change" },
  { id: "description.interaction", section: "description", label: "Interaction with guests section", source: "host", part: "completion", points: 1, kind: "change" },
  { id: "description.other_notes", section: "description", label: "Other things to note section", source: "host", part: "completion", points: 1, kind: "change" },
  { id: "description.claims", section: "description", label: "Every claim matches the photos and amenities", source: "guest", part: "structure", points: 3, kind: "change" },
  { id: "description.fees", section: "description", label: "Fees and conditions guests must know are stated", source: "guest", part: "completion", points: 1, kind: "owner_choice" },
  { id: "description.permit", section: "description", label: "Registration or permit number, where required", source: "guest", part: "completion", points: 1, kind: "owner_choice" },

  // Photos
  { id: "photos.cover", section: "photos", label: "Cover photo is the strongest shot", source: "guest", part: "structure", points: 3, kind: "change" },
  { id: "photos.first_five", section: "photos", label: "First five photos sell the main reasons to book", source: "guest", part: "structure", points: 3, kind: "change" },
  { id: "photos.duplicates", section: "photos", label: "No near-duplicates or filler", source: "guest", part: "structure", points: 1, kind: "change" },
  { id: "photos.quality", section: "photos", label: "Photos are bright, sharp and current", source: "guest", part: "structure", points: 2, kind: "owner_choice" },
  { id: "photos.real", section: "photos", label: "Only real photos of the place (no graphics or text images)", source: "guest", part: "ota_style", points: 1, kind: "change" },
  { id: "photos.tour_rooms", section: "photos", label: "Every photo is assigned to a room in the photo tour", source: "host", part: "completion", points: 2, kind: "change" },
  { id: "photos.sleeping_match", section: "photos", label: "Bedroom photos match the sleeping arrangements", source: "guest", part: "structure", points: 1, kind: "change" },

  // Captions
  { id: "captions.coverage", section: "captions", label: "Photos have captions", source: "guest", part: "ota_style", points: 3, kind: "change" },
  { id: "captions.quality", section: "captions", label: "Captions say where and what, without hype", source: "guest", part: "ota_style", points: 1, kind: "change" },

  // Amenities
  { id: "amenities.filters", section: "amenities", label: "Amenities guests filter for are checked", source: "guest", part: "seo", points: 3, kind: "change" },
  { id: "amenities.copy_match", section: "amenities", label: "Amenities mentioned in the text are checked", source: "guest", part: "seo", points: 2, kind: "change" },
  { id: "amenities.false", section: "amenities", label: "Nothing is checked that guests can't use", source: "host", part: "structure", points: 2, kind: "owner_choice" },
  { id: "amenities.essentials", section: "amenities", label: "Essentials marked correctly", source: "guest", part: "completion", points: 1, kind: "change" },

  // Location
  { id: "location.neighborhood", section: "location", label: "Neighborhood description", source: "host", part: "completion", points: 2, kind: "change" },
  { id: "location.getting_around", section: "location", label: "Getting around", source: "host", part: "completion", points: 1, kind: "change" },
  { id: "location.scenic_views", section: "location", label: "Scenic views", source: "host", part: "seo", points: 1, kind: "change" },
  { id: "location.pin", section: "location", label: "Exact map location shown", source: "host", part: "seo", points: 1, kind: "owner_choice" },
  { id: "location.verified", section: "location", label: "Location verified with Airbnb", source: "host", part: "completion", points: 1, kind: "owner_task" },

  // Rules, guest settings and safety
  { id: "rules.kids", section: "rules_settings", label: "Kids and infants setting matches the listing", source: "guest", part: "structure", points: 2, kind: "owner_choice" },
  { id: "rules.pets", section: "rules_settings", label: "Pet rules are clear and consistent", source: "guest", part: "structure", points: 1, kind: "owner_choice" },
  { id: "rules.quiet_hours", section: "rules_settings", label: "Quiet hours and house rules set", source: "host", part: "completion", points: 1, kind: "owner_choice" },
  { id: "rules.capacity", section: "rules_settings", label: "Guest count matches the beds", source: "guest", part: "structure", points: 1, kind: "owner_choice" },
  { id: "rules.sleeping", section: "rules_settings", label: "Sleeping arrangements match the description", source: "host", part: "structure", points: 1, kind: "change" },
  { id: "settings.instant_book", section: "rules_settings", label: "Instant Book", source: "host", part: "seo", points: 1, kind: "owner_choice" },
  { id: "settings.cancellation", section: "rules_settings", label: "Cancellation policy fits the market", source: "host", part: "completion", points: 1, kind: "owner_choice" },
  { id: "safety.devices", section: "rules_settings", label: "Safety devices listed", source: "host", part: "completion", points: 1, kind: "owner_choice" },
  { id: "safety.disclosures", section: "rules_settings", label: "Safety disclosures are accurate", source: "host", part: "completion", points: 1, kind: "owner_choice" },
  { id: "settings.accessibility", section: "rules_settings", label: "Accessibility features", source: "host", part: "completion", points: 1, kind: "owner_choice" },

  // Arrival guide
  { id: "arrival.checkin_method", section: "arrival", label: "Check-in method", source: "host", part: "completion", points: 1, kind: "owner_choice" },
  { id: "arrival.directions", section: "arrival", label: "Directions", source: "host", part: "completion", points: 1, kind: "change" },
  { id: "arrival.wifi", section: "arrival", label: "Wi-Fi details", source: "host", part: "completion", points: 1, kind: "owner_choice" },
  { id: "arrival.house_manual", section: "arrival", label: "House manual", source: "host", part: "completion", points: 1, kind: "owner_choice" },
  { id: "arrival.checkout", section: "arrival", label: "Checkout instructions", source: "host", part: "completion", points: 1, kind: "change" },
  { id: "arrival.guidebook", section: "arrival", label: "Guidebook", source: "host", part: "completion", points: 1, kind: "change" },

  // Host profile
  { id: "profile.about", section: "host_profile", label: "Host profile filled in (about you, profile questions)", source: "guest", part: "completion", points: 2, kind: "owner_task" },
  { id: "profile.photo", section: "host_profile", label: "Clear host profile photo", source: "guest", part: "completion", points: 1, kind: "owner_task" },
  { id: "profile.review_replies", section: "host_profile", label: "Reviews have host replies", source: "guest", part: "completion", points: 1, kind: "change" },
]

export const CHECK_STATUSES: CheckStatus[] = ["pass", "thin", "fail", "na", "not_checked"]

const CHECK_BY_ID = new Map(LISTING_CHECKS.map((c) => [c.id, c]))

export function getCheck(id: string): CheckDefinition | undefined {
  return CHECK_BY_ID.get(id)
}

export type CheckResult = { id: string; status: CheckStatus; note?: string | null }

const PART_WEIGHTS: Record<CheckPart, number> = {
  completion: 0.3,
  structure: 0.25,
  ota_style: 0.2,
  seo: 0.25,
}

const STATUS_CREDIT: Record<"pass" | "thin" | "fail", number> = { pass: 1, thin: 0.5, fail: 0 }

/**
 * Scores from check results. N/A and not-checked checks don't count against
 * the listing; a part with nothing applicable is left out and the remaining
 * weights are re-normalized.
 */
export function scoreChecks(results: CheckResult[]): {
  overall: number | null
  breakdown: ScoreBreakdown
} {
  const byId = new Map(results.map((r) => [r.id, r.status]))
  const breakdown: ScoreBreakdown = {}
  let weighted = 0
  let weightUsed = 0
  for (const part of Object.keys(PART_WEIGHTS) as CheckPart[]) {
    let earned = 0
    let possible = 0
    for (const check of LISTING_CHECKS) {
      if (check.part !== part) continue
      const status = byId.get(check.id)
      if (status === "pass" || status === "thin" || status === "fail") {
        earned += check.points * STATUS_CREDIT[status]
        possible += check.points
      }
    }
    if (possible === 0) continue
    const value = Math.round((earned / possible) * 100)
    breakdown[part] = value
    weighted += value * PART_WEIGHTS[part]
    weightUsed += PART_WEIGHTS[part]
  }
  return {
    overall: weightUsed > 0 ? Math.round(weighted / weightUsed) : null,
    breakdown,
  }
}

const GRADE_BANDS: [number, string][] = [
  [90, "A"],
  [80, "B"],
  [70, "C"],
  [60, "D"],
]

/** Letter grade per section from its applicable checks. */
export function gradeSections(results: CheckResult[]): Partial<Record<OptimizationSection, string>> {
  const byId = new Map(results.map((r) => [r.id, r.status]))
  const grades: Partial<Record<OptimizationSection, string>> = {}
  const sections = [...new Set(LISTING_CHECKS.map((c) => c.section))]
  for (const section of sections) {
    let earned = 0
    let possible = 0
    for (const check of LISTING_CHECKS) {
      if (check.section !== section) continue
      const status = byId.get(check.id)
      if (status === "pass" || status === "thin" || status === "fail") {
        earned += check.points * STATUS_CREDIT[status]
        possible += check.points
      }
    }
    if (possible === 0) continue
    const pct = (earned / possible) * 100
    grades[section] = GRADE_BANDS.find(([min]) => pct >= min)?.[1] ?? "F"
  }
  return grades
}

export type Coverage = {
  total: number
  checked: number
  notChecked: string[]
  missing: string[]
  /** True when every check in the catalog has a real status. */
  complete: boolean
}

export function checkCoverage(results: CheckResult[]): Coverage {
  const byId = new Map(results.map((r) => [r.id, r.status]))
  const missing = LISTING_CHECKS.filter((c) => !byId.has(c.id)).map((c) => c.id)
  const notChecked = LISTING_CHECKS.filter((c) => byId.get(c.id) === "not_checked").map((c) => c.id)
  return {
    total: LISTING_CHECKS.length,
    checked: LISTING_CHECKS.length - missing.length - notChecked.length,
    notChecked,
    missing,
    complete: missing.length === 0 && notChecked.length === 0,
  }
}

/** Checks in a section that passed, for the owner page's "Looks good" list. */
export function passedChecks(results: CheckResult[], section: OptimizationSection): CheckDefinition[] {
  const byId = new Map(results.map((r) => [r.id, r.status]))
  return LISTING_CHECKS.filter((c) => c.section === section && byId.get(c.id) === "pass")
}
