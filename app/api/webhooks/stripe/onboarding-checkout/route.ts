import Stripe from "stripe"
import { NextResponse } from "next/server"

import { CheckoutBoundaryError } from "@/lib/server-checkout/contracts"
import { DbReconciliationLedger } from "@/lib/server-checkout/reconciliation-repository.server"
import {
  stripeCheckoutRetriever,
  stripeWebhookVerifier,
} from "@/lib/server-checkout/stripe-provider.server"
import { reconcileSignedWebhook } from "@/lib/server-checkout/webhook-reconciliation.server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

export async function POST(request: Request) {
  if (process.env.RF_CHECKOUT_ENABLED !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const rawBody = await request.text()
  const signature = request.headers.get("stripe-signature")
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }
  try {
    const environment = required("RF_CHECKOUT_STRIPE_MODE")
    if (environment !== "test" && environment !== "live") {
      throw new Error("RF_CHECKOUT_STRIPE_MODE must be test or live")
    }
    const stripeAccountId = required("RF_CHECKOUT_STRIPE_ACCOUNT_ID")
    const stripe = new Stripe(required("RF_CHECKOUT_STRIPE_SECRET_KEY"))
    const result = await reconcileSignedWebhook({
      rawBody,
      signature,
      verifyWebhook: stripeWebhookVerifier({
        stripe,
        webhookSecret: required("RF_CHECKOUT_STRIPE_WEBHOOK_SECRET"),
        stripeAccountId,
        environment,
      }),
      retrieveCheckout: stripeCheckoutRetriever({
        stripe,
        stripeAccountId,
        environment,
      }),
      ledger: new DbReconciliationLedger(
        createAdminClient() as unknown as ConstructorParameters<
          typeof DbReconciliationLedger
        >[0]
      ),
    })
    return NextResponse.json({ received: true, ...result })
  } catch (error) {
    console.error(
      "[webhooks/stripe/onboarding-checkout] reconciliation rejected",
      error instanceof CheckoutBoundaryError ? error.code : "invalid_event"
    )
    return NextResponse.json({ error: "Webhook rejected" }, { status: 400 })
  }
}
