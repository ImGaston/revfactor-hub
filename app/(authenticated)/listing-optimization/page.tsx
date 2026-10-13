import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { loadStaffReports } from "@/lib/listing-optimization.server"

function statusVariant(status: string) {
  if (status === "published") return "default" as const
  if (status === "archived") return "outline" as const
  return "secondary" as const
}

export default async function ListingOptimizationPage() {
  const reports = await loadStaffReports()

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">Listing reviews</h1>
        <p className="text-sm text-muted-foreground">
          Audit suggestions shared with owners in the Assembly portal. Drafts come from the audit
          skill; publishing approves every suggestion in the review. Owner accepts land in
          Adjustments as Listing Content.
        </p>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Listing</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead className="text-right">Owner decisions</TableHead>
              <TableHead className="text-right">Live</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No listing reviews yet.
                </TableCell>
              </TableRow>
            )}
            {reports.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="max-w-xs truncate">
                  <Link href={`/listing-optimization/${r.id}`} className="font-medium hover:underline">
                    {r.listing_title}
                  </Link>
                </TableCell>
                <TableCell>{r.client_name ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(r.status)} className="capitalize">
                    {r.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.overall_score ?? "—"}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {r.counts.accepted} accepted · {r.counts.declined} declined · {r.counts.pending} open
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.counts.live}/{r.counts.accepted}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
