// Pacing Chart data layer.
//
// All date math is anchored to UTC. `today` is the UTC calendar date at the
// time of fetch. The Pacing Chart renders forward 60 days from today (inclusive),
// with each day broken into 4 booked-recency buckets. See dashboard-view.tsx.

import type { SupabaseClient } from "@supabase/supabase-js"

export type PacingBucket = "last_3d" | "last_7d" | "last_14d" | "older"

export type PacingDayPoint = {
  stay_date: string // YYYY-MM-DD, UTC
  last_3d: number
  last_7d: number
  last_14d: number
  older: number
  booked_total: number
  booked_pct: number // 0..100, rounded to 1 decimal
}

export type PacingHighlights = {
  total_listings: number
  total_booked_nights: number
  booked_last_14d: number
  booked_last_7d: number
  booked_last_3d: number
}

export type PacingData = {
  days: PacingDayPoint[]
  highlights: PacingHighlights
}

const WINDOW_DAYS = 60
const MS_PER_DAY = 86_400_000

// Bucket boundaries — locked here so seed and aggregator cannot drift.
// last_3d:  booked_date in [today-3, today]
// last_7d:  booked_date in [today-7, today-3)
// last_14d: booked_date in [today-14, today-7)
// older:    booked_date < today-14
const BUCKET_BOUNDARIES = { last_3d: 3, last_7d: 7, last_14d: 14 } as const

function todayUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseISODate(s: string): Date {
  // Anchored at UTC midnight to match all other date math here.
  const [y, m, d] = s.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY)
}

function bucketFor(bookedDate: Date, today: Date): PacingBucket {
  const ageDays = diffDays(today, bookedDate)
  if (ageDays <= BUCKET_BOUNDARIES.last_3d) return "last_3d"
  if (ageDays < BUCKET_BOUNDARIES.last_7d) return "last_7d"
  if (ageDays < BUCKET_BOUNDARIES.last_14d) return "last_14d"
  return "older"
}

type ReservationRow = {
  listing_id: string
  check_in: string
  check_out: string
  booked_date: string | null
  cancelled_on: string | null
}

export async function getPacingData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>
): Promise<PacingData> {
  const today = todayUTC()
  const windowEnd = addDays(today, WINDOW_DAYS)
  const todayISO = toISODate(today)
  const windowEndISO = toISODate(windowEnd)

  // Fetch listings count (denominator) and reservations overlapping the window
  // in parallel.
  const [{ count: listingsCount }, { data: reservations }] = await Promise.all([
    supabase.from("listings").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase
      .from("reservations")
      .select("listing_id, check_in, check_out, booked_date, cancelled_on")
      .eq("booking_status", "booked")
      .lt("check_in", windowEndISO)
      .gt("check_out", todayISO)
      // TODO: push this aggregation into a SQL RPC with generate_series once
      // the dataset outgrows ~5k rows. For MVP the JS-side explosion is fine.
      .limit(5000),
  ])

  const totalListings = listingsCount ?? 0

  // Pre-build the 60-day skeleton so the chart always has a point per day.
  const days: PacingDayPoint[] = Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const d = addDays(today, i)
    return {
      stay_date: toISODate(d),
      last_3d: 0,
      last_7d: 0,
      last_14d: 0,
      older: 0,
      booked_total: 0,
      booked_pct: 0,
    }
  })
  const dayIndex = new Map(days.map((d, i) => [d.stay_date, i]))

  for (const r of (reservations as ReservationRow[] | null) ?? []) {
    if (!r.booked_date) continue
    const checkIn = parseISODate(r.check_in)
    const checkOut = parseISODate(r.check_out)
    const bookedDate = parseISODate(r.booked_date)
    const cancelledOn = r.cancelled_on ? parseISODate(r.cancelled_on) : null
    const bucket = bucketFor(bookedDate, today)

    const startIter = checkIn.getTime() < today.getTime() ? today : checkIn
    const endIter = checkOut.getTime() < windowEnd.getTime() ? checkOut : windowEnd

    for (let t = startIter.getTime(); t < endIter.getTime(); t += MS_PER_DAY) {
      const stay = new Date(t)
      // Cancellation rule: a reservation still counts on stay_dates that
      // happened BEFORE cancelled_on. cancelled_on === stay_date means the
      // booking was cancelled that day → does not count.
      if (cancelledOn && cancelledOn.getTime() <= stay.getTime()) continue

      const iso = toISODate(stay)
      const idx = dayIndex.get(iso)
      if (idx === undefined) continue
      days[idx][bucket] += 1
      days[idx].booked_total += 1
    }
  }

  // Finalize per-day percentages.
  for (const d of days) {
    if (totalListings > 0) {
      const pct = (d.booked_total / totalListings) * 100
      d.booked_pct = Math.round(Math.min(pct, 100) * 10) / 10
    }
  }

  const highlights: PacingHighlights = {
    total_listings: totalListings,
    total_booked_nights: 0,
    booked_last_14d: 0,
    booked_last_7d: 0,
    booked_last_3d: 0,
  }
  for (const d of days) {
    highlights.total_booked_nights += d.booked_total
    highlights.booked_last_14d += d.last_14d
    highlights.booked_last_7d += d.last_7d
    highlights.booked_last_3d += d.last_3d
  }

  return { days, highlights }
}
