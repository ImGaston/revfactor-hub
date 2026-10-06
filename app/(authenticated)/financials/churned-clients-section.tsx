"use client"

import Link from "next/link"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  ClientChurnTable,
  type ChurnTableClient,
} from "@/components/churn/client-churn-table"
import { tenureMonths } from "@/lib/churn"

export type ChurnedClient = ChurnTableClient & { ltv: number | null }

export function ChurnedClientsSection({
  churnedClients,
}: {
  churnedClients: ChurnedClient[]
}) {
  const totalLtv = churnedClients.reduce(
    (sum, client) => sum + (client.ltv ?? 0),
    0
  )
  const tenures = churnedClients
    .map(tenureMonths)
    .filter((value): value is number => value !== null)
  const avgTenure = tenures.length
    ? Math.round(tenures.reduce((a, b) => a + b, 0) / tenures.length)
    : null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Churned Clients</CardTitle>
        <CardDescription>
          {churnedClients.length} churned ·{" "}
          {totalLtv.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          })}{" "}
          lifetime revenue · avg tenure{" "}
          {avgTenure == null ? "—" : `${avgTenure} mo`}
        </CardDescription>
        <Button asChild variant="outline" size="sm" className="w-fit">
          <Link href="/churn">Open Churn tracker</Link>
        </Button>
      </CardHeader>
      <CardContent>
        <ClientChurnTable clients={churnedClients} showLtv />
      </CardContent>
    </Card>
  )
}
