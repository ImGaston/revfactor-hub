import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { churnReasonLabel } from "@/lib/clients"
import { formatChurnDate, tenureMonths } from "@/lib/churn"

export type ChurnTableClient = {
  id: string
  name: string
  onboarding_date: string | null
  ending_date: string | null
  ending_reason_tags: string[]
  ending_note: string | null
  markets?: string[]
  billing_amount?: number | null
  ltv?: number | null
}
export function ReasonChips({ reasons }: { reasons: string[] }) {
  return reasons.length ? (
    <div className="flex flex-wrap gap-1">
      {[...new Set(reasons)].map((reason) => (
        <Badge key={reason} variant="secondary">
          {churnReasonLabel(reason)}
        </Badge>
      ))}
    </div>
  ) : (
    <span className="text-muted-foreground">Untagged</span>
  )
}
export function ClientChurnTable({
  clients,
  showMarkets = false,
  showBilling = false,
  showLtv = false,
}: {
  clients: ChurnTableClient[]
  showMarkets?: boolean
  showBilling?: boolean
  showLtv?: boolean
}) {
  if (!clients.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No client churn</EmptyTitle>
          <EmptyDescription>
            No inactive clients match the current filters.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Client</TableHead>
          {showMarkets && <TableHead>Market</TableHead>}
          <TableHead>Onboarded</TableHead>
          <TableHead>Ended</TableHead>
          <TableHead>Months as client</TableHead>
          {showBilling && (
            <TableHead className="text-right">Billing amount</TableHead>
          )}
          {showLtv && (
            <TableHead className="text-right">Lifetime value</TableHead>
          )}
          <TableHead>Reason</TableHead>
          <TableHead>Ending note</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {clients.map((client) => (
          <TableRow key={client.id}>
            <TableCell className="whitespace-normal">
              <Link
                href={`/clients/${client.id}`}
                className="font-medium hover:underline"
              >
                {client.name}
              </Link>
            </TableCell>
            {showMarkets && (
              <TableCell className="whitespace-normal">
                {client.markets?.join(" · ") || "Unknown market"}
              </TableCell>
            )}
            <TableCell>{formatChurnDate(client.onboarding_date)}</TableCell>
            <TableCell>{formatChurnDate(client.ending_date)}</TableCell>
            <TableCell className="tabular-nums">
              {tenureMonths(client) ?? "—"}
            </TableCell>
            {showBilling && (
              <TableCell className="text-right font-mono">
                {money(client.billing_amount)}
              </TableCell>
            )}
            {showLtv && (
              <TableCell className="text-right font-mono">
                {money(client.ltv)}
              </TableCell>
            )}
            <TableCell className="max-w-64 whitespace-normal">
              <ReasonChips reasons={client.ending_reason_tags} />
            </TableCell>
            <TableCell className="max-w-80 wrap-anywhere whitespace-normal">
              {client.ending_note || "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
function money(value: number | null | undefined) {
  return value == null
    ? "—"
    : value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      })
}
