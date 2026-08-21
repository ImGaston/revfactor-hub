import Link from "next/link"
import { CalendarCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Reservation } from "@/lib/reservations"

function formatDateOnly(value: string | null): string {
  if (!value) return "—"
  return new Date(value + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatBookedAt(value: string | null): string {
  if (!value) return "—"
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatCurrency(amount: number | null, currency: string | null): string {
  if (amount == null) return "—"
  return Number(amount).toLocaleString("en-US", {
    style: "currency",
    currency: currency ?? "USD",
    maximumFractionDigits: 0,
  })
}

/**
 * Per-reservation ADR: rental revenue over nights stayed.
 *
 * Same rule as `computeKpis` in lib/reservations-export.ts — rental revenue
 * (never total cost, which includes cleaning fees) divided by nights, and null
 * rather than a division by zero when the night count is missing or zero. The
 * per-client Excel export and this table must not disagree.
 */
function reservationAdr(
  rentalRevenue: number | null,
  nights: number | null
): number | null {
  if (rentalRevenue == null || nights == null || nights <= 0) return null
  return rentalRevenue / nights
}

export function RecentReservationsCard({
  reservations,
  context,
}: {
  reservations: Reservation[]
  context: "client" | "listing"
}) {
  // On a client we list which listing each booking belongs to. On a listing
  // that is already known, and the only per-row identity left is the guest —
  // which the upstream source always redacts to "Hidden", so the column carried
  // no information. Drop it rather than show a wall of placeholders.
  const showListingColumn = context === "client"

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarCheck className="size-4" />
          Recent Reservations
          <Badge variant="secondary">{reservations.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {reservations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reservations yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booked</TableHead>
                  <TableHead>Check In</TableHead>
                  <TableHead>Check Out</TableHead>
                  <TableHead className="text-right">Nights</TableHead>
                  <TableHead className="text-right">Bkg Window</TableHead>
                  {showListingColumn ? <TableHead>Listing</TableHead> : null}
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">ADR</TableHead>
                  <TableHead>Channel</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reservations.map((r) => (
                  <TableRow key={r.row_key}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatBookedAt(r.booked_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateOnly(r.check_in)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateOnly(r.check_out)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.number_of_days ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.booking_window_days != null
                        ? `${r.booking_window_days}d`
                        : "—"}
                    </TableCell>
                    {showListingColumn ? (
                      <TableCell className="max-w-[220px] truncate">
                        {r.hub_listing_id ? (
                          <Link
                            href={`/listings/${r.hub_listing_id}`}
                            className="hover:underline"
                          >
                            {r.listing_name ?? "—"}
                          </Link>
                        ) : (
                          (r.listing_name ?? "—")
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(r.rental_revenue, r.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatCurrency(
                        reservationAdr(r.rental_revenue, r.number_of_days),
                        r.currency
                      )}
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {r.booking_channel ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
