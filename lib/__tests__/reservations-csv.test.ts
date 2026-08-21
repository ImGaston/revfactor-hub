import { describe, expect, it } from "vitest"
import type { Reservation } from "@/lib/reservations"
import {
  RESERVATION_CSV_HEADERS,
  reservationsToCsv,
} from "@/lib/reservations-csv"

let seq = 0
function makeRow(overrides: Partial<Reservation> = {}): Reservation {
  seq += 1
  return {
    row_key: `row-${seq}`,
    hub_listing_id: null,
    client_id: null,
    client_name: "Client A",
    listing_name: "Listing A",
    guest_name: "Guest",
    booked_at: "2026-07-05T14:30:00+00:00",
    check_in: "2026-07-10",
    check_out: "2026-07-15",
    number_of_days: 5,
    booking_window_days: 5,
    booking_channel: "airbnb",
    rental_revenue: 1000,
    total_cost: 1200,
    currency: "USD",
    ...overrides,
  }
}

function lines(csv: string): string[] {
  return csv.replace(/^\uFEFF/, "").trimEnd().split("\r\n")
}

describe("reservationsToCsv", () => {
  it("starts with a UTF-8 BOM and the header row, using CRLF line endings", () => {
    const csv = reservationsToCsv([makeRow()])
    expect(csv.startsWith("\uFEFF")).toBe(true)
    expect(csv.endsWith("\r\n")).toBe(true)
    expect(lines(csv)[0]).toBe(RESERVATION_CSV_HEADERS.join(","))
  })

  it("serializes a row with a date-only booked date and a computed ADR", () => {
    const csv = reservationsToCsv([makeRow()])
    expect(lines(csv)[1]).toBe(
      "2026-07-05,2026-07-10,2026-07-15,5,5,Guest,Listing A,Client A,1000,1200,200,airbnb,USD"
    )
  })

  it("rounds ADR to cents and omits it when nights are missing or zero", () => {
    const [, uneven, noNights] = lines(
      reservationsToCsv([
        makeRow({ rental_revenue: 1000, number_of_days: 3 }),
        makeRow({ number_of_days: 0 }),
      ])
    )
    expect(uneven.split(",")[10]).toBe("333.33")
    expect(noNights.split(",")[10]).toBe("")
  })

  it("quotes and escapes fields containing commas and quotes", () => {
    const csv = reservationsToCsv([
      makeRow({ listing_name: 'Cabin, "The Nest"', guest_name: null }),
    ])
    expect(lines(csv)[1]).toContain(',"Cabin, ""The Nest""",')
    // null guest serializes as an empty field
    expect(lines(csv)[1].split(",")[5]).toBe("")
  })
})
