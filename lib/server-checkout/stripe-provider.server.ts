import Stripe from "stripe"

import { CheckoutBoundaryError } from "@/lib/server-checkout/contracts"
import type { CheckoutProviderAdapter } from "@/lib/server-checkout/checkout-service.server"
import type { PriceInspector } from "@/lib/server-checkout/price-book"
import type {
  CanonicalProviderCheckout,
  ProviderCheckoutRetriever,
  VerifiedProviderEvent,
  WebhookVerifier,
} from "@/lib/server-checkout/webhook-reconciliation.server"

const METADATA_KEYS = {
  entitlement: "rf_entitlement_id",
  group: "rf_onboarding_group_id",
  account: "rf_billing_account_id",
  sequence: "rf_account_sequence",
  contact: "rf_highlevel_contact_id",
  opportunity: "rf_highlevel_opportunity_id",
  agreement: "rf_agreement_document_id",
  startMode: "rf_service_start_mode",
  startDate: "rf_service_start_date",
} as const

type ProviderEnvironment = "test" | "live"

function id(value: string | { id: string } | null): string | null {
  if (!value) return null
  return typeof value === "string" ? value : value.id
}

function requiredMetadata(
  metadata: Stripe.Metadata,
  key: (typeof METADATA_KEYS)[keyof typeof METADATA_KEYS]
) {
  const value = metadata[key]
  if (!value) {
    throw new CheckoutBoundaryError(
      "provider_identity_conflict",
      `Stripe metadata ${key} is missing`
    )
  }
  return value
}

export class StripeCheckoutAdapter implements CheckoutProviderAdapter {
  readonly environment: ProviderEnvironment

  constructor(
    private readonly stripe: Stripe,
    readonly stripeAccountId: string,
    environment: ProviderEnvironment,
    private readonly continuationUrl: string
  ) {
    this.environment = environment
  }

  async createCheckout(
    input: Parameters<CheckoutProviderAdapter["createCheckout"]>[0]
  ) {
    if (!/^https:\/\//.test(this.continuationUrl)) {
      throw new CheckoutBoundaryError(
        "checkout_configuration_invalid",
        "Checkout continuation URL must use HTTPS"
      )
    }
    const metadata: Stripe.MetadataParam = {
      [METADATA_KEYS.entitlement]: input.entitlementId,
      [METADATA_KEYS.group]: input.onboardingGroupId,
      [METADATA_KEYS.account]: input.billingAccountId,
      [METADATA_KEYS.sequence]: String(input.accountSequence),
      [METADATA_KEYS.contact]: input.highLevelContactId,
      [METADATA_KEYS.opportunity]: input.highLevelOpportunityId,
      [METADATA_KEYS.agreement]: input.agreementDocumentId,
      [METADATA_KEYS.startMode]: input.serviceStartMode,
      [METADATA_KEYS.startDate]: input.serviceStartDate ?? "",
    }
    const subscriptionData: {
      metadata: Stripe.MetadataParam
      trial_end?: number
    } = {
      metadata,
    }
    if (input.serviceStartMode === "scheduled") {
      if (!input.serviceStartDate) {
        throw new CheckoutBoundaryError(
          "checkout_configuration_invalid",
          "Scheduled checkout requires a service-start date"
        )
      }
      subscriptionData.trial_end = Math.floor(
        new Date(`${input.serviceStartDate}T12:00:00.000Z`).getTime() / 1000
      )
    }
    const separator = this.continuationUrl.includes("?") ? "&" : "?"
    const returnUrl = `${this.continuationUrl}${separator}checkout=return`
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: "subscription",
        client_reference_id: input.billingAccountId,
        line_items: input.lineItems.map((line) => ({
          price: line.priceId,
          quantity: line.quantity,
        })),
        allow_promotion_codes: false,
        automatic_tax: { enabled: false },
        billing_address_collection: "required",
        payment_method_collection: "always",
        success_url: returnUrl,
        cancel_url: returnUrl,
        metadata,
        subscription_data: subscriptionData,
      },
      { idempotencyKey: input.idempotencyKey }
    )
    if (!session.url) {
      throw new CheckoutBoundaryError(
        "provider_response_invalid",
        "Stripe did not return a hosted Checkout URL"
      )
    }
    return { checkoutSessionId: session.id, checkoutUrl: session.url }
  }
}

export function stripePriceInspector(input: {
  stripe: Stripe
  stripeAccountId: string
}): PriceInspector {
  // Checkout, Price, Invoice, and Subscription calls below all execute against
  // the account represented by the configured secret key (not Stripe Connect).
  // Bind that credential to the frozen account id using /v1/account.
  const account = input.stripe.accounts.retrieveCurrent()
  return async (priceId) => {
    const [observedAccount, price] = await Promise.all([
      account,
      input.stripe.prices.retrieve(priceId, { expand: ["product"] }),
    ])
    if (observedAccount.id !== input.stripeAccountId) {
      throw new CheckoutBoundaryError(
        "environment_mismatch",
        "Stripe credential is not bound to the configured account"
      )
    }
    const product = price.product
    if (typeof product === "string" || product.deleted) {
      throw new CheckoutBoundaryError(
        "provider_price_mismatch",
        `Stripe Price ${priceId} does not expose an active Product`
      )
    }
    return {
      priceId: price.id,
      productMarker: product.metadata.revfactor_product_marker ?? "",
      unitAmount: price.unit_amount ?? -1,
      currency: price.currency as "usd",
      kind: price.type === "recurring" ? "recurring" : "one_time",
      interval: price.recurring?.interval === "month" ? "month" : null,
      active: price.active && product.active,
      stripeAccountId: input.stripeAccountId,
      livemode: price.livemode,
    }
  }
}

export function stripeWebhookVerifier(input: {
  stripe: Stripe
  webhookSecret: string
  stripeAccountId: string
  environment: ProviderEnvironment
}): WebhookVerifier {
  return async (rawBody, signature): Promise<VerifiedProviderEvent> => {
    const event = input.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      input.webhookSecret
    )
    const object = event.data.object as { id?: unknown }
    if (typeof object.id !== "string") {
      throw new CheckoutBoundaryError(
        "provider_response_invalid",
        "Stripe event has no object identity"
      )
    }
    return {
      id: event.id,
      type: event.type,
      created: event.created,
      checkoutSessionId: object.id,
      stripeAccountId: event.account ?? input.stripeAccountId,
      livemode: event.livemode,
      environment: input.environment,
    }
  }
}

export function stripeCheckoutRetriever(input: {
  stripe: Stripe
  stripeAccountId: string
  environment: ProviderEnvironment
}): ProviderCheckoutRetriever {
  return async (checkoutSessionId): Promise<CanonicalProviderCheckout> => {
    const [observedAccount, session] = await Promise.all([
      input.stripe.accounts.retrieveCurrent(),
      input.stripe.checkout.sessions.retrieve(checkoutSessionId),
    ])
    if (observedAccount.id !== input.stripeAccountId) {
      throw new CheckoutBoundaryError(
        "environment_mismatch",
        "Stripe credential is not bound to the configured account"
      )
    }
    const subscriptionId = id(session.subscription)
    const invoiceId = id(session.invoice)
    const customerId = id(session.customer)
    if (!subscriptionId || !invoiceId || !customerId) {
      throw new CheckoutBoundaryError(
        "provider_identity_conflict",
        "Stripe Checkout is missing its customer, subscription, or invoice"
      )
    }
    const [subscription, invoice, sessionLines, invoicePayments] =
      await Promise.all([
        input.stripe.subscriptions.retrieve(subscriptionId),
        input.stripe.invoices.retrieve(invoiceId),
        input.stripe.checkout.sessions.listLineItems(checkoutSessionId, {
          limit: 100,
        }),
        input.stripe.invoicePayments.list({
          invoice: invoiceId,
          status: "paid",
          limit: 10,
          expand: ["data.payment.payment_intent"],
        }),
      ])
    if (sessionLines.has_more || invoicePayments.has_more) {
      throw new CheckoutBoundaryError(
        "provider_response_invalid",
        "Stripe reconciliation exceeded its bounded inventory"
      )
    }
    const payment = invoicePayments.data.find(
      (candidate) => candidate.payment.type === "payment_intent"
    )
    const paymentIntent = payment?.payment.payment_intent
    const paymentIntentObject =
      paymentIntent && typeof paymentIntent !== "string" ? paymentIntent : null
    const paymentIntentId = id(paymentIntent ?? null)
    const lines = sessionLines.data.map((line) => {
      if (!line.price || line.quantity === null || line.quantity < 1) {
        throw new CheckoutBoundaryError(
          "provider_line_item_conflict",
          "Stripe returned an incomplete line item"
        )
      }
      return {
        priceId: line.price.id,
        quantity: line.quantity,
        kind:
          line.price.type === "recurring"
            ? ("recurring" as const)
            : ("one_time" as const),
        unitAmount: line.price.unit_amount ?? -1,
        currency: line.price.currency as "usd",
      }
    })
    const metadata = session.metadata ?? {}
    return {
      checkoutSessionId: session.id,
      stripeAccountId: input.stripeAccountId,
      livemode: session.livemode,
      environment: input.environment,
      customerId,
      entitlementId: requiredMetadata(metadata, METADATA_KEYS.entitlement),
      onboardingGroupId: requiredMetadata(metadata, METADATA_KEYS.group),
      billingAccountId: requiredMetadata(metadata, METADATA_KEYS.account),
      agreementDocumentId: requiredMetadata(metadata, METADATA_KEYS.agreement),
      highLevelContactId: requiredMetadata(metadata, METADATA_KEYS.contact),
      highLevelOpportunityId: requiredMetadata(
        metadata,
        METADATA_KEYS.opportunity
      ),
      serviceStartMode: requiredMetadata(metadata, METADATA_KEYS.startMode) as
        | "immediate"
        | "scheduled",
      serviceStartDate: metadata[METADATA_KEYS.startDate] || null,
      lines,
      paymentStatus: session.payment_status,
      checkoutSessionInvoiceId: invoiceId,
      initialInvoiceId: invoice.id,
      initialInvoiceStatus: invoice.status ?? "draft",
      initialInvoiceAmountDue: invoice.amount_due,
      initialInvoiceAmountPaid: invoice.amount_paid,
      initialInvoiceCurrency: invoice.currency,
      paymentIntentId,
      paymentIntentStatus: paymentIntentObject?.status ?? null,
      paymentIntentAmountReceived: paymentIntentObject?.amount_received ?? 0,
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      subscriptionLatestInvoiceId: id(subscription.latest_invoice),
      subscriptionTrialEnd: subscription.trial_end,
    }
  }
}
