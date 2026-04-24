"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { AlertCircle, UserPlus, Link2, Building2, Eye, ChevronDown, ChevronRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { StripeSubscriptionSummary } from "@/lib/stripe"
import { CreateClientFromStripeDialog } from "./create-client-from-stripe-dialog"
import { LinkStripeDialog } from "./link-stripe-dialog"
import { LinkSubscriptionDialog } from "./link-subscription-dialog"

type ClientRef = { id: string; name: string; email: string | null; stripe_customer_id: string | null }
type ListingRef = {
  id: string
  name: string
  client_id: string
  stripe_subscription_id: string | null
  clients: { id: string; name: string } | null
}

type CreateTarget = {
  stripeCustomerId: string
  defaultName: string
  defaultEmail: string
}

type LinkClientTarget = {
  stripeCustomerId: string
  stripeCustomerEmail: string | null
  stripeCustomerName: string | null
}

type LinkTarget = {
  subscriptionId: string
  customerId: string
  planName: string | null
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
}

function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function NewSubscriptionsSection({
  subscriptions,
  clients,
  clientStripeCustomers,
  listings,
  assemblyConfigured,
}: {
  subscriptions: StripeSubscriptionSummary[]
  clients: ClientRef[]
  clientStripeCustomers: { client_id: string; stripe_customer_id: string }[]
  listings: ListingRef[]
  assemblyConfigured: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null)
  const [linkClientTarget, setLinkClientTarget] = useState<LinkClientTarget | null>(null)
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null)

  // Build lookups
  const stripeCustomerToClient = useMemo(() => {
    const m = new Map<string, ClientRef>()
    const clientsById = new Map(clients.map((c) => [c.id, c]))
    for (const row of clientStripeCustomers) {
      const c = clientsById.get(row.client_id)
      if (c) m.set(row.stripe_customer_id, c)
    }
    return m
  }, [clients, clientStripeCustomers])

  const subToListings = useMemo(() => {
    const m = new Map<string, ListingRef[]>()
    for (const l of listings) {
      if (!l.stripe_subscription_id) continue
      const arr = m.get(l.stripe_subscription_id) ?? []
      arr.push(l)
      m.set(l.stripe_subscription_id, arr)
    }
    return m
  }, [listings])

  // Pending = subs that need action
  type PendingItem = {
    sub: StripeSubscriptionSummary
    needsClient: boolean
    needsListings: boolean
    linkedClient: ClientRef | null
  }

  const pending: PendingItem[] = useMemo(() => {
    return subscriptions
      .filter((s) => s.status === "active" || s.status === "trialing" || s.status === "past_due")
      .map((sub) => {
        const linkedClient = stripeCustomerToClient.get(sub.customerId) ?? null
        const linkedListings = subToListings.get(sub.id) ?? []
        return {
          sub,
          needsClient: !linkedClient,
          needsListings: linkedListings.length === 0,
          linkedClient,
        }
      })
      .filter((p) => p.needsClient || p.needsListings)
      .sort((a, b) => {
        // Unknown customers first (most urgent), then by recency
        if (a.needsClient && !b.needsClient) return -1
        if (!a.needsClient && b.needsClient) return 1
        return b.sub.created - a.sub.created
      })
  }, [subscriptions, stripeCustomerToClient, subToListings])

  if (pending.length === 0) return null

  return (
    <>
      <Card className="border-amber-200/60 bg-amber-50/30 dark:border-amber-900/40 dark:bg-amber-950/10">
        <CardHeader className="pb-3">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            onClick={() => setCollapsed((c) => !c)}
          >
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="size-4 text-amber-600" />
              New subscriptions
              <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                {pending.length}
              </Badge>
            </CardTitle>
            {collapsed ? (
              <ChevronRight className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </button>
          {!collapsed && (
            <p className="text-xs text-muted-foreground mt-1">
              Subscriptions that need a Hub client or listing assignment.
            </p>
          )}
        </CardHeader>

        {!collapsed && (
          <CardContent className="pt-0">
            <div className="rounded-md border bg-background divide-y">
              {pending.map(({ sub, needsClient, needsListings, linkedClient }) => (
                <div
                  key={sub.id}
                  className="flex flex-wrap items-center gap-3 p-3 text-sm"
                >
                  {/* Customer block */}
                  <div className="min-w-[180px] flex-1">
                    <div className="font-medium truncate">
                      {sub.customerName ?? "Unknown"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {sub.customerEmail ?? "No email"}
                    </div>
                  </div>

                  {/* Plan + amount */}
                  <div className="text-right shrink-0">
                    <div className="font-mono text-sm">
                      {formatCurrency(sub.amount)}/{sub.interval ?? "mo"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Created {formatDate(sub.created)}
                    </div>
                  </div>

                  {/* Status pills */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {needsClient ? (
                      <Badge variant="outline" className="border-orange-300 text-orange-700 dark:text-orange-400">
                        No Hub client
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-400">
                        {linkedClient?.name}
                      </Badge>
                    )}
                    {needsListings && (
                      <Badge variant="outline" className="border-blue-300 text-blue-700 dark:text-blue-400">
                        No listings
                      </Badge>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {needsClient ? (
                      <>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() =>
                            setCreateTarget({
                              stripeCustomerId: sub.customerId,
                              defaultName: sub.customerName ?? "",
                              defaultEmail: sub.customerEmail ?? "",
                            })
                          }
                        >
                          <UserPlus className="mr-1.5 size-3.5" />
                          Create Client
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setLinkClientTarget({
                              stripeCustomerId: sub.customerId,
                              stripeCustomerEmail: sub.customerEmail,
                              stripeCustomerName: sub.customerName,
                            })
                          }
                        >
                          <Link2 className="mr-1.5 size-3.5" />
                          Link existing
                        </Button>
                      </>
                    ) : (
                      needsListings && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() =>
                            setLinkTarget({
                              subscriptionId: sub.id,
                              customerId: sub.customerId,
                              planName: sub.planName,
                            })
                          }
                        >
                          <Building2 className="mr-1.5 size-3.5" />
                          Link Listings
                        </Button>
                      )
                    )}
                    <Button asChild variant="outline" size="sm" className="h-8">
                      <Link href={`/financials/subscriptions/${sub.id}`}>
                        <Eye className="mr-1 size-3.5" />
                        View
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      {createTarget && (
        <CreateClientFromStripeDialog
          open={!!createTarget}
          onOpenChange={(open) => !open && setCreateTarget(null)}
          stripeCustomerId={createTarget.stripeCustomerId}
          defaultName={createTarget.defaultName}
          defaultEmail={createTarget.defaultEmail}
          assemblyConfigured={assemblyConfigured}
        />
      )}

      {linkClientTarget && (
        <LinkStripeDialog
          open={!!linkClientTarget}
          onOpenChange={(open) => !open && setLinkClientTarget(null)}
          stripeCustomerId={linkClientTarget.stripeCustomerId}
          stripeCustomerEmail={linkClientTarget.stripeCustomerEmail}
          stripeCustomerName={linkClientTarget.stripeCustomerName}
          clients={clients}
        />
      )}

      {linkTarget && (
        <LinkSubscriptionDialog
          open={!!linkTarget}
          onOpenChange={(open) => !open && setLinkTarget(null)}
          subscriptionId={linkTarget.subscriptionId}
          customerId={linkTarget.customerId}
          planName={linkTarget.planName}
          listings={listings}
          clients={clients}
          clientStripeCustomers={clientStripeCustomers}
          currentListingIds={(subToListings.get(linkTarget.subscriptionId) ?? []).map((l) => l.id)}
        />
      )}
    </>
  )
}
