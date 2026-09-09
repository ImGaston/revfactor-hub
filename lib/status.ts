// Shared client/listing status constants — client + server safe (no "use server",
// no next/headers). The DB CHECK constraints (migrations 002, 026, and the
// 20260909 test-status migration) are the source of truth; keep these in sync.

export const CLIENT_STATUSES = ["active", "onboarding", "inactive", "test"] as const
export type ClientStatus = (typeof CLIENT_STATUSES)[number]

export const LISTING_STATUSES = ["active", "inactive", "test"] as const
export type ListingStatus = (typeof LISTING_STATUSES)[number]

/**
 * Internal test data. Visible everywhere in the hub (lists, detail, settings,
 * pickers) but excluded from every analysis, KPI, chart, and financial
 * aggregate. Aggregation queries write `.neq("status", TEST_STATUS)`; grep for
 * TEST_STATUS to audit coverage.
 */
export const TEST_STATUS = "test" as const

export function isTestStatus(status: string | null | undefined): boolean {
  return status === TEST_STATUS
}

export const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  onboarding: "Onboarding",
  inactive: "Inactive",
  test: "Test",
}

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status
}

export const STATUS_BADGE_VARIANT: Record<
  string,
  "default" | "secondary" | "outline"
> = {
  active: "default",
  onboarding: "secondary",
  inactive: "outline",
  test: "outline",
}

export const STATUS_BADGE_CLASS: Record<string, string> = {
  active:
    "bg-green-500/10 text-green-700 border-green-300 dark:text-green-400 dark:border-green-700",
  onboarding:
    "bg-blue-500/10 text-blue-700 border-blue-300 dark:text-blue-400 dark:border-blue-700",
  inactive: "bg-muted text-muted-foreground border-border",
  test: "bg-violet-500/10 text-violet-700 border-violet-300 dark:text-violet-400 dark:border-violet-700",
}

/**
 * Listing cascade when a client's status changes. Forward-only, like the
 * pre-existing inactive cascade: a client going inactive takes every listing
 * with it; a client becoming test takes only its active listings (inactive
 * ones keep their churn history). Leaving test/inactive never re-activates
 * listings automatically.
 */
export function listingCascadeForClientStatus(
  clientStatus: string
): { set: ListingStatus; onlyFrom: ListingStatus | null } | null {
  if (clientStatus === "inactive") return { set: "inactive", onlyFrom: null }
  if (clientStatus === TEST_STATUS) return { set: TEST_STATUS, onlyFrom: "active" }
  return null
}
