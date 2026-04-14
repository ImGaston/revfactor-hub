import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// All date math is anchored to UTC so it lines up with the Pacing Chart's
// UTC-based bucket logic in lib/pacing.ts.
const MS_PER_DAY = 86_400_000

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

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

const LISTING_COUNT = 15
const TARGET_RESERVATIONS = 400
const CHANNELS = ["airbnb", "vrbo", "direct"] as const
const CITIES = [
  "Austin", "Miami", "Denver", "Nashville", "Scottsdale",
  "Asheville", "Joshua Tree", "Lake Tahoe", "Sedona", "Park City",
  "Savannah", "Charleston", "Bend", "Big Bear", "Gatlinburg",
] as const

type ReservationRow = {
  row_key: string
  pms_name: string
  listing_id: string
  listing_name: string
  reservation_id: string
  check_in: string
  check_out: string
  booking_status: string
  booked_date: string | null
  rental_revenue: number
  total_cost: number
  no_of_days: number
  currency: string
  cancelled_on: string | null
  min_price_type: string | null
  cleaning_fees: number
  booking_channel: string
  channel_confirmation_code: string
  source_api_window_start: string
  source_api_window_end: string
  first_seen_in_source_at: string
  last_seen_in_source_at: string
  last_refresh_run_at: string
  last_refresh_window_type: string
  missing_from_latest_window: boolean
  missing_from_source_count: number
  ingested_at: string
  raw_json: Record<string, unknown>
}

function generateReservations(): ReservationRow[] {
  const today = todayUTC()
  const windowStart = addDays(today, -90)
  const windowEnd = addDays(today, 120)
  const apiWindowStart = toISODate(windowStart)
  const apiWindowEnd = toISODate(windowEnd)
  const nowISO = new Date().toISOString()

  const listingIds = Array.from({ length: LISTING_COUNT }, (_, i) =>
    `LST-${String(i + 1).padStart(3, "0")}`
  )

  const rows: ReservationRow[] = []
  let resCounter = 1

  for (let i = 0; i < TARGET_RESERVATIONS; i++) {
    const listingId = pick(listingIds)
    const city = CITIES[parseInt(listingId.split("-")[1], 10) - 1] ?? "Austin"
    const listingName = `${city} #${listingId.split("-")[1]}`

    // Spread check_in across the full -90..+120 window. Bias toward the
    // forward 60-day window so the chart has plenty of data to display.
    const checkInOffset = Math.random() < 0.7
      ? randInt(-30, 60)        // bulk: visible chart range + recent past
      : randInt(-90, 120)       // tail: far past or future
    const stayLength = randInt(2, 7)

    const checkIn = addDays(today, checkInOffset)
    const checkOut = addDays(checkIn, stayLength)

    // booked_date — varied so all 4 buckets populate for the forward window.
    // Distribution: 35% older, 25% last_14d, 20% last_7d, 20% last_3d.
    const bucketRoll = Math.random()
    let bookedOffsetFromToday: number
    if (bucketRoll < 0.35) {
      // older: more than 14 days ago, but never after check_in
      bookedOffsetFromToday = randInt(-90, -15)
    } else if (bucketRoll < 0.6) {
      // last_14d: -14..-7 (exclusive of -7)
      bookedOffsetFromToday = randInt(-13, -8)
    } else if (bucketRoll < 0.8) {
      // last_7d: -7..-3 (exclusive of -3)
      bookedOffsetFromToday = randInt(-6, -4)
    } else {
      // last_3d: last 3 days inclusive of today
      bookedOffsetFromToday = randInt(-3, 0)
    }
    let bookedDate = addDays(today, bookedOffsetFromToday)
    // Sanity: a booking must be made on or before the stay starts.
    if (bookedDate.getTime() > checkIn.getTime()) {
      bookedDate = addDays(checkIn, -randInt(1, 14))
    }

    // Cancellations:
    //  - ~5% cancelled AFTER check_in (mid-stay): should still count toward
    //    the nights that preceded cancelled_on
    //  - ~0.75% pre-cancelled (cancelled_on < check_in): negative test,
    //    contributes to no nights
    let cancelledOn: string | null = null
    const cancelRoll = Math.random()
    if (cancelRoll < 0.05) {
      cancelledOn = toISODate(addDays(checkIn, randInt(1, Math.max(1, stayLength - 1))))
    } else if (cancelRoll < 0.0575) {
      cancelledOn = toISODate(addDays(checkIn, -randInt(1, 5)))
    }

    const nightlyRate = randInt(120, 600)
    const rentalRevenue = nightlyRate * stayLength
    const cleaningFees = randInt(75, 200)
    const channel = pick(CHANNELS)
    const reservationId = `R${String(resCounter++).padStart(6, "0")}`
    const rowKey = `mock_${reservationId}`

    rows.push({
      row_key: rowKey,
      pms_name: "mock",
      listing_id: listingId,
      listing_name: listingName,
      reservation_id: reservationId,
      check_in: toISODate(checkIn),
      check_out: toISODate(checkOut),
      booking_status: "booked",
      booked_date: toISODate(bookedDate),
      rental_revenue: rentalRevenue,
      total_cost: rentalRevenue + cleaningFees,
      no_of_days: stayLength,
      currency: "USD",
      cancelled_on: cancelledOn,
      min_price_type: null,
      cleaning_fees: cleaningFees,
      booking_channel: channel,
      channel_confirmation_code: `${channel.toUpperCase()}-${reservationId}`,
      source_api_window_start: apiWindowStart,
      source_api_window_end: apiWindowEnd,
      first_seen_in_source_at: nowISO,
      last_seen_in_source_at: nowISO,
      last_refresh_run_at: nowISO,
      last_refresh_window_type: "full",
      missing_from_latest_window: false,
      missing_from_source_count: 0,
      ingested_at: nowISO,
      raw_json: { source: "seed", channel, nightly_rate: nightlyRate },
    })
  }

  return rows
}

async function seed() {
  console.log("Generating mock reservations...")
  const rows = generateReservations()
  console.log(`Generated ${rows.length} reservations across ${LISTING_COUNT} listings`)

  console.log("Upserting into Supabase...")
  const { error } = await supabase
    .from("reservations")
    .upsert(rows, { onConflict: "row_key" })

  if (error) {
    console.error("Upsert error:", error.message)
    process.exit(1)
  }

  console.log(`✓ ${rows.length} reservations upserted`)

  const { count } = await supabase
    .from("reservations")
    .select("*", { count: "exact", head: true })
  console.log(`Total reservations in table: ${count}`)
}

seed().catch(console.error)
