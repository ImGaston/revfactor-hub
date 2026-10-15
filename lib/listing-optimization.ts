// Listing optimization reports — shared types and pure helpers (client & server safe)

export const OPTIMIZATION_SECTIONS = [
  { key: "title", label: "Title" },
  { key: "description", label: "Description" },
  { key: "photos", label: "Photos" },
  { key: "captions", label: "Photo captions" },
  { key: "amenities", label: "Amenities" },
  { key: "location", label: "Location" },
  { key: "rules_settings", label: "Rules & guest settings" },
  { key: "arrival", label: "Arrival guide" },
  { key: "host_profile", label: "Host profile" },
  { key: "other", label: "Other" },
] as const

export type OptimizationSection = (typeof OPTIMIZATION_SECTIONS)[number]["key"]

/** One plain sentence under each section heading so owners know where a change happens. */
export const SECTION_HINTS: Partial<Record<OptimizationSection, string>> = {
  title: "The name guests see first in Airbnb search results.",
  description: "The text on your listing page. The first lines show before “Show more”.",
  photos: "The order and set of photos on your listing. The cover and first five matter most.",
  captions: "The short label under each photo in your Airbnb photo tour.",
  amenities:
    "The checklist in your Airbnb listing settings (Listing › Amenities). Checked items show on your page and in guest search filters. We only check what you really have.",
  location:
    "The “Where you'll be” part of your listing: neighborhood, getting around and views, set in your Airbnb location settings.",
  rules_settings: "House rules, who can book and safety details, set in your Airbnb listing settings.",
  arrival:
    "Your Airbnb arrival guide: what guests get before check-in (check-in method, directions, Wi-Fi, house manual, checkout).",
  host_profile:
    "Your host profile and replies to reviews. Airbnb only lets you edit your own profile, so those items link you straight to it.",
}
export type OptimizationItemKind = "change" | "owner_choice" | "owner_task" | "info"

/** Airbnb page where hosts edit their own profile; co-hosts cannot change it. */
export const AIRBNB_HOST_PROFILE_EDIT_URL =
  "https://www.airbnb.com/users/profile/about?context=host&editMode=true"

/**
 * Shown when a server action call throws instead of returning a result. The
 * usual cause is a deploy while the page was open (the old page's action ids
 * no longer exist), which otherwise crashes the whole page.
 */
export const ACTION_FAILED_MESSAGE =
  "That didn't go through. The page may be out of date: reload it and try again."
export type OptimizationPriority = "high" | "medium" | "low"
export type OptimizationClientStatus = "pending" | "accepted" | "declined"
export type OptimizationApplyStatus =
  | "not_started"
  | "queued"
  | "applied"
  | "verified"
  | "failed"
  | "skipped"

export type ScoreBreakdown = {
  completion?: number
  structure?: number
  ota_style?: number
  seo?: number
}

export const SCORE_PARTS: { key: keyof ScoreBreakdown; label: string; weight: number }[] = [
  { key: "completion", label: "Completion", weight: 0.3 },
  { key: "structure", label: "Structure", weight: 0.25 },
  { key: "ota_style", label: "Airbnb style", weight: 0.2 },
  { key: "seo", label: "Search words", weight: 0.25 },
]

export type OptimizationItem = {
  id: string
  section: OptimizationSection
  kind: OptimizationItemKind
  priority: OptimizationPriority
  sort_order: number
  headline: string
  rationale: string | null
  current_value: string | null
  proposed_value: string | null
  options: string[]
  photo_url: string | null
  action_url: string | null
  check_id: string | null
  client_status: OptimizationClientStatus
  client_choice: string | null
  client_note: string | null
  decided_at: string | null
  apply_status: OptimizationApplyStatus
}

export type OptimizationReport = {
  id: string
  listing_title: string
  listing_url: string | null
  cover_photo_url: string | null
  overall_score: number | null
  score_breakdown: ScoreBreakdown
  section_grades: Partial<Record<OptimizationSection, string>>
  owner_line: string | null
  summary: string | null
  published_at: string | null
  /** Standard checklist results (lib/listing-optimization-checks.ts). */
  checks: { id: string; status: "pass" | "thin" | "fail" | "na" | "not_checked"; note?: string | null }[]
  items: OptimizationItem[]
}

export type OptimizationDecision = "accept" | "decline" | "reset"

export function sectionLabel(section: string): string {
  return OPTIMIZATION_SECTIONS.find((s) => s.key === section)?.label ?? "Other"
}

/** Items grouped by section in the canonical section order, each sorted. */
export function groupItemsBySection(
  items: OptimizationItem[]
): { section: OptimizationSection; label: string; items: OptimizationItem[] }[] {
  return OPTIMIZATION_SECTIONS.map((s) => ({
    section: s.key,
    label: s.label,
    items: items
      .filter((i) => i.section === s.key)
      .sort((a, b) => a.sort_order - b.sort_order),
  })).filter((g) => g.items.length > 0)
}

const PRIORITY_RANK: Record<OptimizationPriority, number> = { high: 0, medium: 1, low: 2 }

/** Highest priority among a section's items (drives the section badge). */
export function sectionPriority(items: OptimizationItem[]): OptimizationPriority | null {
  const actionable = items.filter((i) => i.kind !== "info")
  if (actionable.length === 0) return null
  return actionable.reduce<OptimizationPriority>(
    (best, i) => (PRIORITY_RANK[i.priority] < PRIORITY_RANK[best] ? i.priority : best),
    "low"
  )
}

export function decisionProgress(items: OptimizationItem[]) {
  const actionable = items.filter((i) => i.kind !== "info")
  const decided = actionable.filter((i) => i.client_status !== "pending")
  return {
    total: actionable.length,
    decided: decided.length,
    accepted: actionable.filter((i) => i.client_status === "accepted").length,
    declined: actionable.filter((i) => i.client_status === "declined").length,
  }
}

/** An owner can change a decision until the team has started applying it. */
export function isDecisionLocked(
  item: Pick<OptimizationItem, "apply_status"> & { kind?: OptimizationItemKind }
): boolean {
  // Owner tasks are marked done by the owner, who can undo that themselves.
  if (item.kind === "owner_task") return false
  return item.apply_status === "applied" || item.apply_status === "verified"
}

export function gradeTone(grade: string | undefined): "good" | "ok" | "weak" | "none" {
  if (!grade) return "none"
  const g = grade.trim().toUpperCase()[0]
  if (g === "A") return "good"
  if (g === "B" || g === "C") return "ok"
  if (g === "D" || g === "F") return "weak"
  return "none"
}

export function applyStatusLabel(status: OptimizationApplyStatus): string {
  switch (status) {
    case "queued":
      return "In our queue"
    case "applied":
      return "Applied"
    case "verified":
      return "Live"
    case "failed":
      return "Needs a second try"
    case "skipped":
      return "Not applied"
    default:
      return ""
  }
}

export const MAX_CLIENT_NOTE_LENGTH = 1000
export const MAX_CLIENT_CHOICE_LENGTH = 5000

/**
 * Validates an owner decision payload. Returns the normalized values or an
 * error message. `choice` is the selected option or owner-edited text; it is
 * only meaningful when accepting.
 */
export function validateDecision(input: {
  item: Pick<OptimizationItem, "kind" | "options" | "proposed_value" | "apply_status">
  decision: OptimizationDecision
  choice?: string | null
  note?: string | null
}):
  | { ok: true; choice: string | null; note: string | null }
  | { ok: false; error: string } {
  const { item, decision } = input
  if (item.kind === "info") return { ok: false, error: "This item is for information only." }
  if (isDecisionLocked(item)) {
    return { ok: false, error: "This change is already live. Message us if you want it changed." }
  }
  const note = input.note?.trim() ? input.note.trim() : null
  if (note && note.length > MAX_CLIENT_NOTE_LENGTH) {
    return { ok: false, error: "That note is too long." }
  }
  if (decision !== "accept") return { ok: true, choice: null, note }

  const raw = input.choice?.trim() ? input.choice.trim() : null
  if (raw && raw.length > MAX_CLIENT_CHOICE_LENGTH) {
    return { ok: false, error: "That text is too long." }
  }
  const choice = raw ?? item.proposed_value ?? (item.options.length > 0 ? item.options[0] : null)
  return { ok: true, choice, note }
}

export type OwnerReviewRow = {
  id: string
  listingName: string
  listingTitle: string
  status: "draft" | "published"
  overallScore: number | null
  channelManager: string | null
  coverage: { checked: number; total: number; complete: boolean }
  items: (Pick<OptimizationItem, "section" | "kind" | "priority" | "sort_order" | "headline"> & {
    check_id: string | null
  })[]
}

export type OwnerSendGroup = { clientId: string; clientName: string | null; reportIds: string[] }

/**
 * Owners with two or more reviews still waiting for the owner message (draft
 * or published, not sent). They get one "Publish & send all" instead of one
 * message per listing.
 */
export function ownerSendGroups(
  rows: {
    id: string
    client_id: string
    client_name: string | null
    status: string
    owner_message_sent_at: string | null
  }[]
): OwnerSendGroup[] {
  const groups = new Map<string, OwnerSendGroup>()
  for (const r of rows) {
    if (r.owner_message_sent_at || (r.status !== "draft" && r.status !== "published")) continue
    const group = groups.get(r.client_id) ?? { clientId: r.client_id, clientName: r.client_name, reportIds: [] }
    group.reportIds.push(r.id)
    groups.set(r.client_id, group)
  }
  return [...groups.values()]
    .filter((g) => g.reportIds.length >= 2)
    .sort((a, b) => (a.clientName ?? "").localeCompare(b.clientName ?? ""))
}
