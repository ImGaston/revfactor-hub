export type ListingStatusFilter = "all" | "active" | "inactive"

export function matchesListingStatus(
  listingStatus: string,
  filter: ListingStatusFilter
) {
  return filter === "all" || listingStatus === filter
}
