import { createHash } from "node:crypto"
import { NextResponse } from "next/server"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

type Assignment = {
  listing_id: string
  market_id: string
  locality_id: string | null
  relationship_type: string
  membership_status: string
  assignment_source: string
}

/** Redacted, read-only contract for the internal/Grok market map. */
export async function GET() {
  if (!(await hasPermission("market_signals", "view"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const supabase = await createClient()
  const [{ data: listings, error: listingError }, { data: memberships, error: membershipError }, { data: markets, error: marketError }, { data: localities, error: localityError }] = await Promise.all([
    supabase.from("listings").select("id, city, state, location_latitude, location_longitude, location_source, location_observed_at").eq("status", "active"),
    supabase.from("revenue_market_listings").select("listing_id, market_id, locality_id, relationship_type, membership_status, assignment_source").eq("membership_status", "approved"),
    supabase.from("revenue_markets").select("id, name, status"),
    supabase.from("revenue_market_localities").select("id, name, status"),
  ])

  const error = listingError ?? membershipError ?? marketError ?? localityError
  if (error) return NextResponse.json({ error: "Map data unavailable" }, { status: 503 })

  const marketById = new Map((markets ?? []).map((market) => [market.id, market]))
  const localityById = new Map((localities ?? []).map((locality) => [locality.id, locality]))
  const membershipByListing = new Map<string, Assignment>()
  for (const membership of memberships ?? []) {
    if (membership.relationship_type === "primary") membershipByListing.set(membership.listing_id, membership)
  }

  const points = (listings ?? [])
    .filter((listing) => listing.location_latitude !== null && listing.location_longitude !== null)
    .map((listing) => {
      const membership = membershipByListing.get(listing.id)
      const market = membership ? marketById.get(membership.market_id) : null
      const locality = membership?.locality_id ? localityById.get(membership.locality_id) : null
      return {
        map_key: createHash("sha256").update(`revfactor-map:${listing.id}`).digest("hex").slice(0, 16),
        city: listing.city,
        state: listing.state,
        country: "US",
        latitude: listing.location_latitude,
        longitude: listing.location_longitude,
        location_precision: listing.location_source === "geocoded" ? "approximate" : "exact",
        location_source: listing.location_source,
        location_observed_at: listing.location_observed_at,
        market: market ? { name: market.name, status: market.status } : null,
        locality: locality ? { name: locality.name, status: locality.status } : null,
        assignment_confidence: membership ? (membership.assignment_source === "manual" ? "high" : "reviewed") : "unmapped",
      }
    })

  return NextResponse.json({ version: 1, generated_at: new Date().toISOString(), read_only: true, points })
}
