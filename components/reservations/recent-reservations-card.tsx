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

export function RecentReservationsCard({
  reservations,
  context,
}: {
  reservations: Reservation[]
  context: "client" | "listing"
}) {
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
                  <TableHead>
                    {context === "client" ? "Listing" : "Guest"}
                  </TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
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
                    <TableCell className="max-w-[220px] truncate">
                      {context === "client" ? (
                        r.hub_listing_id ? (
                          <Link
                            href={`/listings/${r.hub_listing_id}`}
                            className="hover:underline"
                          >
                            {r.listing_name ?? "—"}
                          </Link>
                        ) : (
                          (r.listing_name ?? "—")
                        )
                      ) : (
                        (r.guest_name ?? "—")
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(r.rental_revenue, r.currency)}
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
