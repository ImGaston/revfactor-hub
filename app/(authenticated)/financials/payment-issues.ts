import type { StripeInvoice } from "@/lib/types"

export type PaymentIssueState = "erroneo" | "incompleto" | "pendiente"

export type ClientRef = {
  id: string
  name: string
  email: string | null
  stripe_customer_id: string | null
  assembly_link: string | null
  assembly_client_id: string | null
  assembly_company_id: string | null
}

export type PaymentIssue = {
  invoiceId: string
  subscriptionId: string | null
  state: PaymentIssueState
  /** Raw Stripe status driving the classification (e.g. past_due, uncollectible, open). */
  stripeStatus: string
  customerName: string | null
  customerEmail: string | null
  amountDue: number
  created: number
  client: ClientRef | null
}

// Severity order for sorting: failed charges first, then never-completed setups,
// then merely-pending invoices.
const STATE_ORDER: Record<PaymentIssueState, number> = {
  erroneo: 0,
  incompleto: 1,
  pendiente: 2,
}

const FAILED_SUB_STATUSES = new Set(["past_due", "unpaid"])
const INCOMPLETE_SUB_STATUSES = new Set(["incomplete", "incomplete_expired"])

/**
 * Classify an unpaid invoice into one of the three payment-issue states using
 * the invoice status refined by its subscription's status.
 *
 * - incompleto: subscription never completed its first payment / checkout.
 * - erroneo:    invoice is uncollectible, or Stripe already tried and failed.
 * - pendiente:  invoice is open and still awaiting payment, no failure yet.
 */
function classify(
  invoiceStatus: string | null,
  subStatus: string | undefined
): { state: PaymentIssueState; stripeStatus: string } {
  if (subStatus && INCOMPLETE_SUB_STATUSES.has(subStatus)) {
    return { state: "incompleto", stripeStatus: subStatus }
  }
  if (invoiceStatus === "uncollectible") {
    return { state: "erroneo", stripeStatus: "uncollectible" }
  }
  if (subStatus && FAILED_SUB_STATUSES.has(subStatus)) {
    return { state: "erroneo", stripeStatus: subStatus }
  }
  return { state: "pendiente", stripeStatus: invoiceStatus ?? "open" }
}

export function buildPaymentIssues({
  invoices,
  subStatusById,
  stripeToClient,
}: {
  invoices: StripeInvoice[]
  /** Map of stripe_subscriptions.id -> status */
  subStatusById: Map<string, string>
  /** Map of stripe customer id -> linked Hub client */
  stripeToClient: Map<string, ClientRef>
}): PaymentIssue[] {
  return invoices
    .filter((inv) => Number(inv.amount_due) > Number(inv.amount_paid))
    .map((inv) => {
      const subStatus = inv.subscription_id
        ? subStatusById.get(inv.subscription_id)
        : undefined
      const { state, stripeStatus } = classify(inv.status, subStatus)
      return {
        invoiceId: inv.id,
        subscriptionId: inv.subscription_id,
        state,
        stripeStatus,
        customerName: inv.customer_name,
        customerEmail: inv.customer_email,
        amountDue: Number(inv.amount_due),
        created: new Date(inv.created).getTime(),
        client: inv.customer_id
          ? (stripeToClient.get(inv.customer_id) ?? null)
          : null,
      }
    })
    .sort((a, b) => {
      const order = STATE_ORDER[a.state] - STATE_ORDER[b.state]
      if (order !== 0) return order
      return b.created - a.created
    })
}
