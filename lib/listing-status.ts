import { TEST_STATUS } from "@/lib/status"

export type ListingStatusFilter = "all" | "active" | "inactive" | "test"

/**
 * The "active" view is the hub's default and is meant to show everything that
 * is in operation, so test listings match it too (they are synced and worked
 * on like real ones — they are only excluded from analyses). "test" isolates
 * them; "inactive" never includes them.
 */
export function matchesListingStatus(
  listingStatus: string,
  filter: ListingStatusFilter
) {
  if (filter === "all") return true
  if (filter === "active") {
    return listingStatus === "active" || listingStatus === TEST_STATUS
  }
  return listingStatus === filter
}
