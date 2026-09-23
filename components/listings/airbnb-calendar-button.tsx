import { ExternalLink } from "lucide-react"

import { Button } from "@/components/ui/button"
import { airbnbCalendarUrl, type ListingLinkFields } from "@/lib/listing-links"

// Single "open the Airbnb multicalendar" button for a listing. Renders nothing
// when the listing has no Airbnb link.
export function AirbnbCalendarButton({
  listing,
}: {
  listing: Pick<ListingLinkFields, "airbnb_link">
}) {
  const href = airbnbCalendarUrl(listing)
  if (!href) return null
  return (
    <Button asChild variant="outline" size="sm">
      <a href={href} target="_blank" rel="noopener noreferrer">
        <ExternalLink />
        Airbnb calendar
      </a>
    </Button>
  )
}
