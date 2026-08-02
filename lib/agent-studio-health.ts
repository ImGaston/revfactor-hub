export type PriceLabsListingHealthInput = {
  id: string
  clientId: string | null
  name: string
  priceLabsId: string | null
  syncedAt: string | null
}

export type PriceLabsAttentionListing = {
  id: string
  listingName: string
  clientName: string | null
  priceLabsId: string | null
  lastSyncedAt: string | null
  reason: "missing_id" | "never_synced" | "stale"
}

export function summarizePriceLabsListingHealth({
  listings,
  clientNames,
  now = Date.now(),
  staleAfterHours = 36,
}: {
  listings: PriceLabsListingHealthInput[]
  clientNames: ReadonlyMap<string, string>
  now?: number
  staleAfterHours?: number
}) {
  const staleBefore = now - staleAfterHours * 60 * 60 * 1_000
  const synced = listings.filter((listing) => listing.syncedAt)
  const fresh = synced.filter(
    (listing) => new Date(listing.syncedAt as string).getTime() >= staleBefore
  )
  const latestSyncAt = synced.reduce<string | null>((latest, listing) => {
    if (!listing.syncedAt) return latest
    if (!latest) return listing.syncedAt
    return new Date(listing.syncedAt).getTime() > new Date(latest).getTime()
      ? listing.syncedAt
      : latest
  }, null)
  const attentionListings: PriceLabsAttentionListing[] = listings.flatMap(
    (listing) => {
      const isStale =
        listing.syncedAt && new Date(listing.syncedAt).getTime() < staleBefore
      if (listing.syncedAt && !isStale) return []

      return [
        {
          id: listing.id,
          listingName: listing.name,
          clientName: listing.clientId
            ? (clientNames.get(listing.clientId) ?? null)
            : null,
          priceLabsId: listing.priceLabsId,
          lastSyncedAt: listing.syncedAt,
          reason: !listing.priceLabsId
            ? "missing_id"
            : listing.syncedAt
              ? "stale"
              : "never_synced",
        },
      ]
    }
  )

  return {
    activeListings: listings.length,
    syncedListings: synced.length,
    freshListings: fresh.length,
    latestSyncAt,
    latestSyncIsStale:
      !latestSyncAt || new Date(latestSyncAt).getTime() < staleBefore,
    attentionListings,
    staleAfterHours,
  }
}
