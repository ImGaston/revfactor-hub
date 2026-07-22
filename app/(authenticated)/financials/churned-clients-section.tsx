"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { churnReasonLabel } from "@/lib/clients"

export type ChurnedClient = {
  id: string
  name: string
  onboarding_date: string | null
  ending_date: string | null
  ending_reason_tags: string[]
  ending_note: string | null
  ltv: number | null
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  return new Date(value + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function tenureMonths(client: ChurnedClient): number | null {
  if (!client.onboarding_date) return null
  const start = new Date(client.onboarding_date + "T00:00:00")
  const end = client.ending_date
    ? new Date(client.ending_date + "T00:00:00")
    : new Date()
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth())
  return Math.max(0, months)
}

function formatTenure(months: number | null): string {
  if (months == null) return "—"
  const years = Math.floor(months / 12)
  const rest = months % 12
  if (years === 0) return `${rest} mo`
  if (rest === 0) return `${years} yr`
  return `${years} yr ${rest} mo`
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })
}

export function ChurnedClientsSection({
  churnedClients,
}: {
  churnedClients: ChurnedClient[]
}) {
  const totalLtv = churnedClients.reduce((sum, c) => sum + (c.ltv ?? 0), 0)
  const tenures = churnedClients
    .map(tenureMonths)
    .filter((m): m is number => m != null)
  const avgTenure =
    tenures.length > 0
      ? Math.round(tenures.reduce((a, b) => a + b, 0) / tenures.length)
      : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Churned Clients</CardTitle>
        <CardDescription>
          {churnedClients.length} churned · {formatCurrency(totalLtv)} lifetime
          revenue · avg tenure {formatTenure(avgTenure)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {churnedClients.length === 0 ? (
          <p className="text-sm text-muted-foreground">No churned clients.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Onboarded</TableHead>
                <TableHead>Ended</TableHead>
                <TableHead>Tenure</TableHead>
                <TableHead className="text-right">Lifetime Value</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {churnedClients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/clients/${client.id}`}
                      className="hover:underline"
                    >
                      {client.name}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDate(client.onboarding_date)}</TableCell>
                  <TableCell>{formatDate(client.ending_date)}</TableCell>
                  <TableCell>{formatTenure(tenureMonths(client))}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {client.ltv != null ? formatCurrency(client.ltv) : "—"}
                  </TableCell>
                  <TableCell>
                    {client.ending_reason_tags.length === 0 &&
                    !client.ending_note ? (
                      "—"
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        {client.ending_reason_tags.map((tag) => (
                          <Badge key={tag} variant="secondary">
                            {churnReasonLabel(tag)}
                          </Badge>
                        ))}
                        {client.ending_note && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="max-w-[200px] truncate text-xs text-muted-foreground">
                                {client.ending_note}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs whitespace-pre-wrap">
                              {client.ending_note}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
