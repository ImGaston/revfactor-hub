// Pure CSV serialization for the /reservations export — no I/O so it stays
// unit-testable. Columns mirror the browser table (plus currency, since the
// cache mixes USD/CAD/EUR and a flat file loses the UI's disclosure).

import type { Reservation } from "@/lib/reservations"

export const RESERVATION_CSV_HEADERS = [
  "Booked Date",
  "Check In",
  "Check Out",
  "Nights",
  "Booking Window (days)",
  "Guest",
  "Listing",
  "Client",
  "Rental Revenue",
  "Total Revenue",
  "ADR",
  "Channel",
  "Currency",
] as const

function csvField(value: string | number | null | undefined): string {
  if (value == null) return ""
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function dateOnly(value: string | null): string | null {
  return value ? value.slice(0, 10) : null
}

function adr(r: Reservation): number | null {
  if (r.rental_revenue == null || !r.number_of_days || r.number_of_days <= 0)
    return null
  return Math.round((r.rental_revenue / r.number_of_days) * 100) / 100
}

export function reservationsToCsv(rows: Reservation[]): string {
  const lines = [RESERVATION_CSV_HEADERS.map(csvField).join(",")]
  for (const r of rows) {
    lines.push(
      [
        dateOnly(r.booked_at),
        r.check_in,
        r.check_out,
        r.number_of_days,
        r.booking_window_days,
        r.guest_name,
        r.listing_name,
        r.client_name,
        r.rental_revenue,
        r.total_cost,
        adr(r),
        r.booking_channel,
        r.currency,
      ]
        .map(csvField)
        .join(",")
    )
  }
  // BOM so Excel detects UTF-8; CRLF per RFC 4180
  return "\uFEFF" + lines.join("\r\n") + "\r\n"
}
