"use client"

import { useState } from "react"
import Link from "next/link"
import { Search, Link2, Link2Off, Zap, Building2, Eye, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { StripeSubscriptionSummary } from "@/lib/stripe"
import { LinkStripeDialog } from "./link-stripe-dialog"
import { LinkSubscriptionDialog } from "./link-subscription-dialog"
import { unlinkStripeCustomer, autoLinkStripeCustomers, syncStripeNow } from "./actions"

type ClientRef = { id: string; name: string; email: string | null; stripe_customer_id: string | null }
type ListingRef = { id: string; name: string; client_id: string; stripe_subscription_id: string | null; clients: { id: string; name: string } | null }

const statusColors: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  canceled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  past_due: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  trialing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  incomplete: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
}

export function SubscriptionsTable({
  subscriptions,
  clients,
  clientStripeCustomers,
  listings,
  stripeConfigured,
}: {
  subscriptions: StripeSubscriptionSummary[]
  clients: ClientRef[]
  clientStripeCustomers: { client_id: string; stripe_customer_id: string }[]
  listings: ListingRef[]
  stripeConfigured: boolean
}) {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [linkingCustomer, setLinkingCustomer] = useState<{ id: string; email: string | null; name: string | null } | null>(null)
  const [linkingSubscription, setLinkingSubscription] = useState<{ subscriptionId: string; customerId: string; planName: string | null } | null>(null)
  const [autoLinking, setAutoLinking] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // Build lookup: Stripe customer ID → Hub client. Source of truth is the
  // client_stripe_customers junction (a client may own multiple Stripe customers).
  const clientsById = new Map<string, ClientRef>()
  for (const c of clients) clientsById.set(c.id, c)
  const stripeToClient = new Map<string, ClientRef>()
  for (const row of clientStripeCustomers) {
    const client = clientsById.get(row.client_id)
    if (client) stripeToClient.set(row.stripe_customer_id, client)
  }

  // Build subscription → listings map
  const subToListings = new Map<string, ListingRef[]>()
  for (const l of listings) {
    if (l.stripe_subscription_id) {
      const existing = subToListings.get(l.stripe_subscription_id) ?? []
      existing.push(l)
      subToListings.set(l.stripe_subscription_id, existing)
    }
  }

  const filtered = subscriptions.filter((s) => {
    if (statusFilter !== "all" && s.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        (s.customerEmail?.toLowerCase().includes(q) ?? false) ||
        (s.customerName?.toLowerCase().includes(q) ?? false) ||
        (s.planName?.toLowerCase().includes(q) ?? false)
      )
    }
    return true
  })

  async function handleUnlink(clientId: string, stripeCustomerId: string) {
    const result = await unlinkStripeCustomer(clientId, stripeCustomerId)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Stripe customer unlinked from client")
    }
  }

  async function handleSync() {
    setSyncing(true)
    const result = await syncStripeNow()
    setSyncing(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(
        `Synced ${result.subscriptions} subscriptions and ${result.invoices} invoices`,
      )
    }
  }

  async function handleAutoLink() {
    setAutoLinking(true)
    const result = await autoLinkStripeCustomers()
    setAutoLinking(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(`Auto-linked ${result.linked} client${result.linked === 1 ? "" : "s"} by email`)
    }
  }

  if (!stripeConfigured) {
    return (
      <Alert>
        <AlertDescription>
          Configure Stripe to view subscriptions. Add <code className="rounded bg-muted px-1 py-0.5 text-xs">STRIPE_SECRET_KEY</code> to your environment variables.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or plan..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="canceled">Canceled</SelectItem>
            <SelectItem value="past_due">Past due</SelectItem>
            <SelectItem value="trialing">Trialing</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAutoLink}
          disabled={autoLinking}
        >
          <Zap className="mr-1.5 size-3.5" />
          {autoLinking ? "Linking..." : "Auto-link by email"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
        >
          <RefreshCw className={`mr-1.5 size-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing..." : "Sync from Stripe"}
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Listings</TableHead>
              <TableHead className="w-[120px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  {subscriptions.length === 0 ? "No subscriptions found in Stripe" : "No matching subscriptions"}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((sub) => {
                const linkedClient = stripeToClient.get(sub.customerId)
                const linkedListings = subToListings.get(sub.id) ?? []
                const periodEnd = new Date(sub.currentPeriodEnd * 1000)
                return (
                  <TableRow key={sub.id}>
                    <TableCell className="font-medium">{sub.customerName ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{sub.customerEmail ?? "—"}</TableCell>
                    <TableCell className="text-sm">{sub.planName ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${sub.amount.toLocaleString()}/{sub.interval ?? "mo"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={statusColors[sub.status] ?? ""}>
                        {sub.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {periodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {sub.cancelAtPeriodEnd && (
                        <span className="ml-1 text-xs text-red-500">(cancels)</span>
                      )}
                    </TableCell>
                    {/* Client link */}
                    <TableCell>
                      {linkedClient ? (
                        <div className="flex items-center gap-1.5">
                          <Link2 className="size-3.5 text-emerald-600 shrink-0" />
                          <span className="text-sm truncate max-w-[120px]">{linkedClient.name}</span>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setLinkingCustomer({ id: sub.customerId, email: sub.customerEmail, name: sub.customerName })}
                        >
                          Link client
                        </Button>
                      )}
                    </TableCell>
                    {/* Listings link */}
                    <TableCell>
                      {linkedListings.length > 0 ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                className="flex items-center gap-1 text-sm hover:underline"
                                onClick={() => setLinkingSubscription({ subscriptionId: sub.id, customerId: sub.customerId, planName: sub.planName })}
                              >
                                <Building2 className="size-3.5 text-blue-600 shrink-0" />
                                <span>{linkedListings.length} listing{linkedListings.length !== 1 ? "s" : ""}</span>
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-[250px]">
                              <ul className="text-xs space-y-0.5">
                                {linkedListings.map((l) => (
                                  <li key={l.id}>
                                    {l.name}
                                    {l.clients && <span className="text-muted-foreground"> ({l.clients.name})</span>}
                                  </li>
                                ))}
                              </ul>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setLinkingSubscription({ subscriptionId: sub.id, customerId: sub.customerId, planName: sub.planName })}
                        >
                          Link listings
                        </Button>
                      )}
                    </TableCell>
                    {/* Actions */}
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                        >
                          <Link href={`/financials/subscriptions/${sub.id}`}>
                            <Eye className="mr-1 size-3.5" />
                            View
                          </Link>
                        </Button>
                        {linkedClient && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => handleUnlink(linkedClient.id, sub.customerId)}
                            title="Unlink client"
                          >
                            <Link2Off className="size-3.5 text-muted-foreground" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Link Client Dialog */}
      {linkingCustomer && (
        <LinkStripeDialog
          open={!!linkingCustomer}
          onOpenChange={(open) => { if (!open) setLinkingCustomer(null) }}
          stripeCustomerId={linkingCustomer.id}
          stripeCustomerEmail={linkingCustomer.email}
          stripeCustomerName={linkingCustomer.name}
          clients={clients}
        />
      )}

      {/* Link Subscription → Listings Dialog */}
      {linkingSubscription && (
        <LinkSubscriptionDialog
          open={!!linkingSubscription}
          onOpenChange={(open) => { if (!open) setLinkingSubscription(null) }}
          subscriptionId={linkingSubscription.subscriptionId}
          customerId={linkingSubscription.customerId}
          planName={linkingSubscription.planName}
          listings={listings}
          clients={clients}
          clientStripeCustomers={clientStripeCustomers}
          currentListingIds={
            (subToListings.get(linkingSubscription.subscriptionId) ?? []).map((l) => l.id)
          }
        />
      )}
    </div>
  )
}
