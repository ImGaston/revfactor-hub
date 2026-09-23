// Outbound deep links for a listing (Airbnb host tools, PriceLabs).
// Client-safe: shared by the listing page, Adjustments and the public share card.
//
// listing_id is the PriceLabs ID and is NOT always the Airbnb ID, so every
// Airbnb link is derived from airbnb_link only.

export type ListingLinkFields = {
  listing_id: string | null
  pricelabs_link: string | null
  airbnb_link: string | null
}

export function airbnbIdFromLink(airbnbLink: string | null | undefined): string | null {
  const match = airbnbLink?.match(/airbnb\.[^/]+\/rooms\/(\d+)/)
  return match?.[1] ?? null
}

export function airbnbCalendarUrl(listing: Pick<ListingLinkFields, "airbnb_link">): string | null {
  const id = airbnbIdFromLink(listing.airbnb_link)
  return id ? `https://www.airbnb.com/multicalendar/${id}` : null
}

export function airbnbEditorUrl(listing: Pick<ListingLinkFields, "airbnb_link">): string | null {
  const id = airbnbIdFromLink(listing.airbnb_link)
  return id ? `https://www.airbnb.com/hosting/listings/editor/${id}/details/photo-tour` : null
}

export function airbnbRoomUrl(listing: Pick<ListingLinkFields, "airbnb_link">): string | null {
  const id = airbnbIdFromLink(listing.airbnb_link)
  return id ? `https://www.airbnb.com/rooms/${id}` : null
}

export function pricelabsUrl(listing: ListingLinkFields): string | null {
  if (listing.pricelabs_link) return listing.pricelabs_link
  if (listing.listing_id)
    return `https://app.pricelabs.co/pricing?listings=${listing.listing_id}`
  return null
}
