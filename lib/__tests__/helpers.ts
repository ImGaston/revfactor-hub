import type { ReservationExportRow } from "@/lib/reservations"

let seq = 0

export function makeReservation(
  overrides: Partial<ReservationExportRow> = {}
): ReservationExportRow {
  seq += 1
  return {
    row_key: `row-${seq}`,
    listing_name: "Listing A",
    listing_id: "100",
    check_in: "2026-07-10",
    check_out: "2026-07-15",
    booked_date: "2026-07-05",
    number_of_days: 5,
    booking_window_days: 5,
    booking_channel: "airbnb",
    rental_revenue: 1000,
    cleaning_fees: 100,
    total_cost: 1200,
    currency: "USD",
    reservation_id: `res-${seq}`,
    pms: "Hostaway",
    channel_confirmation_code: null,
    ...overrides,
  }
}
