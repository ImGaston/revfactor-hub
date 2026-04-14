// Frontend mock data for the Pacing Chart while the `reservations` table
// is not yet populated in Supabase. Swap out for `getPacingData()` once the
// migration is applied and the table is seeded.
//
// Anchored to UTC so it matches lib/pacing.ts.

import type {
  PacingBucket,
  PacingData,
  PacingDayPoint,
  PacingHighlights,
} from "@/lib/pacing"

const MS_PER_DAY = 86_400_000

export type PacingListing = {
  id: string
  name: string
  client_id: string
  client_name: string
  state: string
}

export type PacingSource = {
  listings: PacingListing[]
  // listing_id → stay_date (YYYY-MM-DD, UTC) → bucket. Only booked dates present.
  bookings: Record<string, Record<string, PacingBucket>>
  // UTC ISO date the buckets were computed against.
  today: string
}

const LISTINGS: PacingListing[] = [
  { id: "LST-001", name: "Oceanview Loft", client_id: "C1", client_name: "Coastal Collective", state: "CA" },
  { id: "LST-002", name: "Beachside Cottage", client_id: "C1", client_name: "Coastal Collective", state: "CA" },
  { id: "LST-003", name: "Malibu Villa", client_id: "C1", client_name: "Coastal Collective", state: "CA" },
  { id: "LST-004", name: "Downtown Suite", client_id: "C2", client_name: "Urban Stays LLC", state: "NY" },
  { id: "LST-005", name: "SoHo Penthouse", client_id: "C2", client_name: "Urban Stays LLC", state: "NY" },
  { id: "LST-006", name: "Brooklyn Loft", client_id: "C2", client_name: "Urban Stays LLC", state: "NY" },
  { id: "LST-007", name: "Miami Waterfront", client_id: "C3", client_name: "Sunshine Rentals", state: "FL" },
  { id: "LST-008", name: "Key West Bungalow", client_id: "C3", client_name: "Sunshine Rentals", state: "FL" },
  { id: "LST-009", name: "Orlando Villa", client_id: "C3", client_name: "Sunshine Rentals", state: "FL" },
  { id: "LST-010", name: "Aspen Chalet", client_id: "C4", client_name: "Mountain Escapes", state: "CO" },
  { id: "LST-011", name: "Denver Apartment", client_id: "C4", client_name: "Mountain Escapes", state: "CO" },
  { id: "LST-012", name: "Boulder Cabin", client_id: "C4", client_name: "Mountain Escapes", state: "CO" },
  { id: "LST-013", name: "Austin Bungalow", client_id: "C5", client_name: "Lone Star Lodging", state: "TX" },
  { id: "LST-014", name: "Dallas Condo", client_id: "C5", client_name: "Lone Star Lodging", state: "TX" },
  { id: "LST-015", name: "Hill Country Retreat", client_id: "C5", client_name: "Lone Star Lodging", state: "TX" },
]

function todayUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

// Deterministic pseudo-random so the mock is stable across reloads within
// the same server process but still looks varied across days.
function seededRandom(seed: number) {
  let state = seed
  return () => {
    state = (state * 9301 + 49297) % 233280
    return state / 233280
  }
}

export function getMockPacingSource(): PacingSource {
  const today = todayUTC()
  const year = today.getUTCFullYear()
  // Cover Jan 1 of current year → today + 400 days so every range preset has data.
  const startDate = new Date(Date.UTC(year, 0, 1))
  const endDate = new Date(today.getTime() + 400 * MS_PER_DAY)
  const numDays = Math.round((endDate.getTime() - startDate.getTime()) / MS_PER_DAY)

  const bookings: Record<string, Record<string, PacingBucket>> = {}

  LISTINGS.forEach((listing, listingIdx) => {
    const listingBookings: Record<string, PacingBucket> = {}
    const rand = seededRandom(
      year * 1_000_000 + (today.getUTCMonth() + 1) * 10_000 + today.getUTCDate() * 100 + listingIdx
    )

    for (let i = 0; i < numDays; i++) {
      const stay = new Date(startDate.getTime() + i * MS_PER_DAY)
      const dow = stay.getUTCDay()
      const isWeekend = dow === 5 || dow === 6
      const daysFromToday = Math.round(
        (stay.getTime() - today.getTime()) / MS_PER_DAY
      )

      // Base occupancy — higher on weekends, decays toward the far future.
      const baseOcc = isWeekend ? 0.82 : 0.6
      const horizonDecay =
        daysFromToday > 0 ? Math.max(0.28, 1 - daysFromToday / 400) : 1
      const occProb = baseOcc * horizonDecay

      if (rand() >= occProb) continue

      // Recency bucket — fresher bookings dominate nearer dates, older
      // bookings dominate far-future or past dates.
      const proximity =
        daysFromToday > 0 ? 1 - Math.min(daysFromToday / 365, 1) : 0.1
      const r = rand()
      let bucket: PacingBucket
      if (r < 0.04 + proximity * 0.22) bucket = "last_3d"
      else if (r < 0.16 + proximity * 0.3) bucket = "last_7d"
      else if (r < 0.38 + proximity * 0.25) bucket = "last_14d"
      else bucket = "older"
      listingBookings[toISODate(stay)] = bucket
    }

    bookings[listing.id] = listingBookings
  })

  return {
    listings: LISTINGS,
    bookings,
    today: toISODate(today),
  }
}

export function aggregatePacing(
  source: PacingSource,
  startIso: string,
  endIso: string,
  listingIds: string[] | null
): PacingData {
  const activeListings =
    listingIds && listingIds.length > 0
      ? source.listings.filter((l) => listingIds.includes(l.id))
      : source.listings
  const totalListings = activeListings.length

  const start = parseISODate(startIso)
  const end = parseISODate(endIso)
  const n = Math.max(
    0,
    Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1
  )

  const days: PacingDayPoint[] = []
  for (let i = 0; i < n; i++) {
    const stay = new Date(start.getTime() + i * MS_PER_DAY)
    const iso = toISODate(stay)
    let last_3d = 0
    let last_7d = 0
    let last_14d = 0
    let older = 0
    for (const l of activeListings) {
      const bucket = source.bookings[l.id]?.[iso]
      if (bucket === "last_3d") last_3d++
      else if (bucket === "last_7d") last_7d++
      else if (bucket === "last_14d") last_14d++
      else if (bucket === "older") older++
    }
    const booked_total = last_3d + last_7d + last_14d + older
    const booked_pct =
      totalListings > 0
        ? Math.round((booked_total / totalListings) * 1000) / 10
        : 0
    days.push({
      stay_date: iso,
      last_3d,
      last_7d,
      last_14d,
      older,
      booked_total,
      booked_pct,
    })
  }

  const highlights: PacingHighlights = {
    total_listings: totalListings,
    total_booked_nights: days.reduce((s, d) => s + d.booked_total, 0),
    booked_last_14d: days.reduce((s, d) => s + d.last_14d, 0),
    booked_last_7d: days.reduce((s, d) => s + d.last_7d, 0),
    booked_last_3d: days.reduce((s, d) => s + d.last_3d, 0),
  }

  return { days, highlights }
}

// Legacy single-shot helper (next 60 days, all listings). Kept for any
// caller that doesn't need filters or range control.
export function getMockPacingData(): PacingData {
  const source = getMockPacingSource()
  const today = parseISODate(source.today)
  const end = new Date(today.getTime() + 59 * MS_PER_DAY)
  return aggregatePacing(source, source.today, toISODate(end), null)
}
