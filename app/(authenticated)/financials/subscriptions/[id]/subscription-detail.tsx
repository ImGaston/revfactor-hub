import Link from "next/link"
import { ArrowLeft, ExternalLink, Link2, Building2, Calendar, Receipt } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { StripeSubscriptionSummary, StripeInvoiceSummary } from "@/lib/stripe"

const statusColors: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  canceled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  past_due: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  trialing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  incomplete: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
}

const invoiceStatusColors: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  void: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  uncollectible: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  draft: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
}

function formatCurrency(amount: number, currency: string = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount)
}

function formatDate(unix: number | null): string {
  if (!unix) return "—"
  return new Date(unix * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

type LinkedClient = { id: string; name: string; email: string | null } | null
type LinkedListing = {
  id: string
  name: string
  city: string | null
  state: string | null
  client: { id: string; name: string } | null
}

export function SubscriptionDetail({
  subscription,
  invoices,
  linkedClient,
  linkedListings,
}: {
  subscription: StripeSubscriptionSummary
  invoices: StripeInvoiceSummary[]
  linkedClient: LinkedClient
  linkedListings: LinkedListing[]
}) {
  const stripeUrl = `https://dashboard.stripe.com/subscriptions/${subscription.id}`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Button asChild variant="ghost" size="sm" className="h-7 -ml-2 text-muted-foreground">
            <Link href="/financials">
              <ArrowLeft className="mr-1.5 size-3.5" />
              Back to Financials
            </Link>
          </Button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight">
              {subscription.customerName ?? subscription.customerEmail ?? "Subscription"}
            </h1>
            <Badge variant="secondary" className={statusColors[subscription.status] ?? ""}>
              {subscription.status}
            </Badge>
            {subscription.cancelAtPeriodEnd && (
              <Badge variant="outline" className="text-red-600 border-red-200">
                Cancels at period end
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground font-mono">{subscription.id}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={stripeUrl} target="_blank" rel="noopener noreferrer">
            View in Stripe
            <ExternalLink className="ml-1.5 size-3.5" />
          </a>
        </Button>
      </div>

      {/* KPI grid */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-normal">Amount</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-mono font-semibold">
              {formatCurrency(subscription.amount, subscription.currency)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              per {subscription.interval ?? "month"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-normal">Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium truncate">
              {subscription.planName ?? "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {subscription.itemCount > 1
                ? `${subscription.itemCount} items · ${subscription.currency.toUpperCase()}`
                : subscription.currency.toUpperCase()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-normal">Current Period</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {formatDate(subscription.currentPeriodStart)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              → {formatDate(subscription.currentPeriodEnd)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-normal">Next Invoice</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {subscription.cancelAtPeriodEnd
                ? "—"
                : formatDate(subscription.currentPeriodEnd)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {subscription.cancelAtPeriodEnd ? "Subscription ending" : "Auto-renews"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Customer & Links */}
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <InfoRow label="Name" value={subscription.customerName ?? "—"} />
              <InfoRow label="Email" value={subscription.customerEmail ?? "—"} />
              <InfoRow label="Stripe ID" value={subscription.customerId} mono />
              <InfoRow label="Created" value={formatDate(subscription.created)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Link2 className="size-4" />
                Linked Hub Client
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {linkedClient ? (
                <Link
                  href={`/clients/${linkedClient.id}`}
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  {linkedClient.name}
                </Link>
              ) : (
                <p className="text-muted-foreground">Not linked to any Hub client.</p>
              )}
              {linkedClient?.email && (
                <p className="text-xs text-muted-foreground mt-1">{linkedClient.email}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Building2 className="size-4" />
                Linked Listings ({linkedListings.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              {linkedListings.length === 0 ? (
                <p className="text-muted-foreground">No listings linked to this subscription.</p>
              ) : (
                <ul className="space-y-2">
                  {linkedListings.map((l) => (
                    <li key={l.id} className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          href={`/listings/${l.id}`}
                          className="font-medium hover:underline truncate block"
                        >
                          {l.name}
                        </Link>
                        {(l.city || l.state) && (
                          <p className="text-xs text-muted-foreground">
                            {[l.city, l.state].filter(Boolean).join(", ")}
                          </p>
                        )}
                      </div>
                      {l.client && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {l.client.name}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Invoices */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Receipt className="size-4" />
                Recent Invoices
                <span className="text-xs text-muted-foreground font-normal">
                  (last {invoices.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {invoices.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                  <Calendar className="size-6" />
                  <p className="text-sm">No invoices yet for this subscription.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="w-[60px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv) => {
                      const invoiceUrl = `https://dashboard.stripe.com/invoices/${inv.id}`
                      return (
                        <TableRow key={inv.id}>
                          <TableCell className="text-sm">{formatDate(inv.created)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDate(inv.periodStart)} → {formatDate(inv.periodEnd)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className={inv.status ? invoiceStatusColors[inv.status] ?? "" : ""}
                            >
                              {inv.status ?? "—"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {inv.status === "paid"
                              ? formatCurrency(inv.amountPaid)
                              : formatCurrency(inv.amountDue)}
                          </TableCell>
                          <TableCell>
                            <Button asChild variant="ghost" size="icon" className="size-7">
                              <a
                                href={invoiceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="View invoice in Stripe"
                              >
                                <ExternalLink className="size-3.5" />
                              </a>
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={`text-right truncate ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  )
}
