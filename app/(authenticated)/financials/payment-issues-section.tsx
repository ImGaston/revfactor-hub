"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  EyeOff,
  Eye,
  MessageSquare,
  MoreVertical,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { StripeInvoice } from "@/lib/types"
import type { StripeSubscriptionSummary } from "@/lib/stripe"
import {
  buildPaymentIssues,
  type ClientRef,
  type PaymentIssue,
  type PaymentIssueState,
} from "./payment-issues"
import { dismissPaymentIssue, restorePaymentIssue } from "./actions"

const stateColors: Record<PaymentIssueState, string> = {
  erroneo:
    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-transparent",
  incompleto:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-transparent",
  pendiente:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-transparent",
}

// Client-facing message templates, one per state. Placeholders: {name}, {amount}.
// English by default — RevFactor clients are US short-term-rental owners.
const messageTemplates: Record<PaymentIssueState, string> = {
  erroneo:
    "Hi {name}, we noticed your latest RevFactor payment of {amount} didn't go through. Could you update your payment method so we can get it sorted? Happy to send a fresh payment link if you need one.",
  incompleto:
    "Hi {name}, it looks like your RevFactor subscription setup is incomplete — the first payment of {amount} hasn't been completed yet. Could you finish the checkout so we can activate everything on your account?",
  pendiente:
    "Hi {name}, just a friendly heads-up that your RevFactor invoice of {amount} is still pending. Let me know if you have any questions or need a hand completing the payment.",
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

// Stripe dashboard page for the invoice that wasn't charged.
function invoiceDashboardUrl(invoiceId: string): string {
  return `https://dashboard.stripe.com/invoices/${invoiceId}`
}

function buildMessage(issue: PaymentIssue): string {
  const name = issue.client?.name ?? issue.customerName ?? "there"
  return messageTemplates[issue.state]
    .replace("{name}", name)
    .replace("{amount}", formatCurrency(issue.amountDue))
}

export function PaymentIssuesSection({
  invoices,
  subscriptions,
  clients,
  clientStripeCustomers,
  assemblyConfigured,
  dismissedInvoiceIds,
}: {
  invoices: StripeInvoice[]
  subscriptions: StripeSubscriptionSummary[]
  clients: ClientRef[]
  clientStripeCustomers: { client_id: string; stripe_customer_id: string }[]
  assemblyConfigured: boolean
  dismissedInvoiceIds: string[]
}) {
  const [collapsed, setCollapsed] = useState(false)
  // Locally-dismissed ids for optimistic hide before the server round-trip.
  const [locallyDismissed, setLocallyDismissed] = useState<Set<string>>(
    new Set()
  )

  const allIssues = useMemo(() => {
    const subStatusById = new Map<string, string>()
    for (const s of subscriptions) subStatusById.set(s.id, s.status)

    const clientsById = new Map(clients.map((c) => [c.id, c]))
    const stripeToClient = new Map<string, ClientRef>()
    for (const row of clientStripeCustomers) {
      const c = clientsById.get(row.client_id)
      if (c) stripeToClient.set(row.stripe_customer_id, c)
    }

    return buildPaymentIssues({ invoices, subStatusById, stripeToClient })
  }, [invoices, subscriptions, clients, clientStripeCustomers])

  const issues = useMemo(() => {
    const hidden = new Set([...dismissedInvoiceIds, ...locallyDismissed])
    return allIssues.filter((i) => !hidden.has(i.invoiceId))
  }, [allIssues, dismissedInvoiceIds, locallyDismissed])

  async function handleDismiss(issue: PaymentIssue) {
    setLocallyDismissed((prev) => new Set(prev).add(issue.invoiceId))
    const result = await dismissPaymentIssue(issue.invoiceId)
    if (result.error) {
      setLocallyDismissed((prev) => {
        const next = new Set(prev)
        next.delete(issue.invoiceId)
        return next
      })
      toast.error(result.error)
      return
    }
    toast.success("Payment issue dismissed", {
      action: {
        label: "Undo",
        onClick: async () => {
          await restorePaymentIssue(issue.invoiceId)
          setLocallyDismissed((prev) => {
            const next = new Set(prev)
            next.delete(issue.invoiceId)
            return next
          })
        },
      },
    })
  }

  if (issues.length === 0) return null

  async function handleCopyAndOpen(issue: PaymentIssue) {
    const message = buildMessage(issue)
    try {
      await navigator.clipboard.writeText(message)
      toast.success("Message copied")
    } catch {
      toast.error("Could not copy message")
    }
    const link = issue.client?.assembly_link
    if (assemblyConfigured && link) {
      window.open(link, "_blank", "noopener,noreferrer")
    }
  }

  return (
    <Card className="border-red-200/60 bg-red-50/30 dark:border-red-900/40 dark:bg-red-950/10">
      <CardHeader className="pb-3">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 text-left"
          onClick={() => setCollapsed((c) => !c)}
        >
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-red-600" />
            Failed or pending payments
            <Badge
              variant="secondary"
              className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
            >
              {issues.length}
            </Badge>
          </CardTitle>
          {collapsed ? (
            <ChevronRight className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" />
          )}
        </button>
        {!collapsed && (
          <p className="mt-1 text-xs text-muted-foreground">
            Invoices that failed, are incomplete, or are still pending payment.
            Copy the message and open Assembly to follow up on the payment.
          </p>
        )}
      </CardHeader>

      {!collapsed && (
        <CardContent className="pt-0">
          <div className="divide-y rounded-md border bg-background">
            {issues.map((issue) => {
              const client = issue.client
              const hasAssembly = !!(
                assemblyConfigured && client?.assembly_link
              )
              return (
                <div
                  key={issue.invoiceId}
                  className="flex flex-wrap items-center gap-3 p-3 text-sm"
                >
                  {/* Customer block */}
                  <div className="min-w-[180px] flex-1">
                    <div className="truncate font-medium">
                      {client?.name ?? issue.customerName ?? "Unknown"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {issue.customerEmail ?? "No email"}
                    </div>
                  </div>

                  {/* Amount + date */}
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-sm">
                      {formatCurrency(issue.amountDue)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(issue.created)}
                    </div>
                  </div>

                  {/* State badge — raw Stripe status, links to the invoice */}
                  <div className="shrink-0">
                    <a
                      href={invoiceDashboardUrl(issue.invoiceId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open the invoice in Stripe"
                    >
                      <Badge
                        className={cn(
                          stateColors[issue.state],
                          "gap-1 transition-opacity hover:opacity-80"
                        )}
                      >
                        {issue.stripeStatus}
                        <ExternalLink className="size-3" />
                      </Badge>
                    </a>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    {client ? (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleCopyAndOpen(issue)}
                        title={
                          hasAssembly
                            ? "Copy message and open Assembly"
                            : "Copy message (client not linked to Assembly)"
                        }
                      >
                        {hasAssembly ? (
                          <MessageSquare className="mr-1.5 size-3.5" />
                        ) : (
                          <Copy className="mr-1.5 size-3.5" />
                        )}
                        {hasAssembly ? "Copy + Assembly" : "Copy message"}
                      </Button>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-muted-foreground/30 text-muted-foreground"
                      >
                        No client
                      </Badge>
                    )}
                    {issue.subscriptionId && (
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="h-8"
                      >
                        <Link
                          href={`/financials/subscriptions/${issue.subscriptionId}`}
                        >
                          <Eye className="mr-1 size-3.5" />
                          View
                        </Link>
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          title="More options"
                        >
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleDismiss(issue)}>
                          <EyeOff className="mr-2 size-3.5" />
                          Dismiss
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
