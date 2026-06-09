"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getProfile } from "@/lib/supabase/profile"
import {
  createCustomer,
  createSubscriptionCheckoutSession,
  isStripeConfigured,
  listSubscriptionPriceOptions,
} from "@/lib/stripe"

const MAX_ONBOARDING_FEE = 10000

function stripeCustomerDashboardUrl(customerId: string) {
  return `https://dashboard.stripe.com/customers/${customerId}`
}

async function requireSuperAdmin() {
  const profile = await getProfile()
  if (profile?.role !== "super_admin") {
    return { error: "Unauthorized" }
  }
  return { error: null }
}

async function getBaseUrl() {
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host")
  const proto = h.get("x-forwarded-proto") ?? "https"

  if (host) return `${proto}://${host}`
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return "http://localhost:3000"
}

export async function getStripeSubscriptionOptionsAction() {
  if (!isStripeConfigured()) {
    return { error: "Stripe is not configured", options: [] }
  }

  const auth = await requireSuperAdmin()
  if (auth.error) return { error: auth.error, options: [] }

  try {
    const options = await listSubscriptionPriceOptions()
    return { error: null, options }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not load Stripe subscription types",
      options: [],
    }
  }
}

export async function createClientStripeCheckoutAction(input: {
  clientId: string
  priceId: string
  includeOnboardingFee?: boolean
  onboardingFeeAmount?: number
}) {
  if (!isStripeConfigured()) {
    return { error: "Stripe is not configured", checkoutUrl: null }
  }

  const auth = await requireSuperAdmin()
  if (auth.error) return { error: auth.error, checkoutUrl: null }

  if (!input.clientId) return { error: "Client is required", checkoutUrl: null }
  if (!input.priceId) return { error: "Subscription type is required", checkoutUrl: null }
  const includeOnboardingFee = input.includeOnboardingFee === true
  const onboardingFeeAmount = Number(input.onboardingFeeAmount ?? 0)
  if (!Number.isFinite(onboardingFeeAmount) || onboardingFeeAmount < 0) {
    return { error: "Onboarding fee must be a valid amount", checkoutUrl: null }
  }
  if (onboardingFeeAmount > MAX_ONBOARDING_FEE) {
    return { error: `Onboarding fee cannot exceed $${MAX_ONBOARDING_FEE}`, checkoutUrl: null }
  }
  const onboardingFeeCents =
    includeOnboardingFee && onboardingFeeAmount > 0
      ? Math.round(onboardingFeeAmount * 100)
      : 0

  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, name, email")
    .eq("id", input.clientId)
    .single()

  if (clientError || !client) {
    return { error: clientError?.message ?? "Client not found", checkoutUrl: null }
  }

  const { data: existingLink, error: linkError } = await supabase
    .from("client_stripe_customers")
    .select("stripe_customer_id")
    .eq("client_id", input.clientId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (linkError) return { error: linkError.message, checkoutUrl: null }

  let stripeCustomerId = existingLink?.stripe_customer_id ?? null

  try {
    const subscriptionOptions = await listSubscriptionPriceOptions()
    const selectedOption = subscriptionOptions.find((option) => option.priceId === input.priceId)
    if (!selectedOption) {
      return { error: "Subscription type is no longer available in Stripe", checkoutUrl: null }
    }

    if (!stripeCustomerId) {
      const customer = await createCustomer({
        name: client.name,
        email: client.email,
        hubClientId: client.id,
      })
      stripeCustomerId = customer.id

      const { error: insertError } = await admin
        .from("client_stripe_customers")
        .insert({
          client_id: client.id,
          stripe_customer_id: stripeCustomerId,
        })

      if (insertError) {
        return { error: insertError.message, checkoutUrl: null }
      }
    }

    await admin
      .from("clients")
      .update({ stripe_dashboard: stripeCustomerDashboardUrl(stripeCustomerId) })
      .eq("id", client.id)

    const baseUrl = await getBaseUrl()
    const clientPath = `/clients/${client.id}`
    const checkout = await createSubscriptionCheckoutSession({
      customerId: stripeCustomerId,
      priceId: input.priceId,
      hubClientId: client.id,
      successUrl: `${baseUrl}${clientPath}?stripe_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}${clientPath}?stripe_checkout=canceled`,
      onboardingFee:
        onboardingFeeCents > 0
          ? {
              amountCents: onboardingFeeCents,
              currency: selectedOption.currency,
            }
          : null,
    })

    revalidatePath("/clients")
    revalidatePath(clientPath)
    revalidatePath("/financials")

    return {
      error: null,
      checkoutUrl: checkout.url,
      checkoutSessionId: checkout.id,
      stripeCustomerId,
      stripeDashboardUrl: stripeCustomerDashboardUrl(stripeCustomerId),
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not create Stripe checkout",
      checkoutUrl: null,
    }
  }
}
