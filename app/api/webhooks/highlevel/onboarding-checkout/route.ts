import { createHash } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import {
  addHighLevelContactTags,
  setHighLevelContactCustomFields,
} from "@/lib/highlevel-onboarding"
import {
  createOnboardingCheckoutSession,
  findOrCreateOnboardingCustomer,
  isStripeConfigured,
} from "@/lib/stripe"
import { getStandardServiceTrialEnd } from "@/lib/onboarding-signup"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const payloadSchema = z.object({
  contactId: z.string().trim().min(1).max(100),
  // GHL currently sends {{document.url}} here, not only the short document ID.
  // Stripe metadata values are capped at 500 characters.
  documentId: z.string().trim().min(1).max(500),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  name: z.string().trim().max(200).nullable().optional(),
  primaryListingQuantity: z.coerce.number().int().min(1).max(100),
  childListingQuantity: z.coerce.number().int().min(0).max(500),
  onboardingFee: z.coerce.number().refine((value) => value === 0 || value === 150, {
    message: "onboardingFee must be 0 or 150",
  }),
  serviceStartMode: z.enum(["immediate", "scheduled"]).default("immediate"),
  serviceStartDate: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  ),
})

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

export async function POST(request: NextRequest) {
  const secret = process.env.HIGHLEVEL_ONBOARDING_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: "HIGHLEVEL_ONBOARDING_WEBHOOK_SECRET not configured" },
      { status: 500 },
    )
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 500 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = payloadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid onboarding checkout payload", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  try {
    const input = parsed.data
    const serviceStartDate =
      input.serviceStartMode === "scheduled"
        ? (input.serviceStartDate ?? null)
        : null
    if (input.serviceStartMode === "scheduled" && !serviceStartDate) {
      return NextResponse.json(
        { error: "Scheduled service start date is required" },
        { status: 400 },
      )
    }
    const customer = await findOrCreateOnboardingCustomer({
      email: input.email,
      name: input.name ?? null,
      highLevelContactId: input.contactId,
    })
    const idempotencyKey = `rf-ghl-onboarding-${createHash("sha256")
      .update(`${input.contactId}:${input.documentId}`)
      .digest("hex")}`
    const checkout = await createOnboardingCheckoutSession({
      customerId: customer.id,
      highLevelContactId: input.contactId,
      documentId: input.documentId,
      primaryPriceId: requiredEnv("STRIPE_PRIMARY_LISTING_PRICE_ID"),
      primaryQuantity: input.primaryListingQuantity,
      childPriceId: requiredEnv("STRIPE_CHILD_LISTING_PRICE_ID"),
      childQuantity: input.childListingQuantity,
      onboardingPriceId: requiredEnv("STRIPE_ONBOARDING_FEE_PRICE_ID"),
      includeOnboardingFee: input.onboardingFee === 150,
      serviceStartMode: input.serviceStartMode,
      serviceStartDate,
      trialEnd: serviceStartDate
        ? getStandardServiceTrialEnd(serviceStartDate)
        : undefined,
      successUrl: requiredEnv("ONBOARDING_CHECKOUT_SUCCESS_URL"),
      cancelUrl: requiredEnv("ONBOARDING_CHECKOUT_CANCEL_URL"),
      idempotencyKey,
    })

    await setHighLevelContactCustomFields(input.contactId, [
      { key: "contact.rf_stripe_checkout_url", fieldValue: checkout.url },
      {
        key: "contact.rf_stripe_checkout_session_id",
        fieldValue: checkout.id,
      },
    ])
    await addHighLevelContactTags(input.contactId, [
      "rf-standard-checkout-ready",
    ])

    return NextResponse.json({
      success: true,
      checkoutUrl: checkout.url,
      checkoutSessionId: checkout.id,
    })
  } catch (error) {
    console.error(
      "[webhook/highlevel/onboarding-checkout] failed:",
      error instanceof Error ? error.message : error,
    )
    return NextResponse.json({ error: "Could not prepare checkout" }, { status: 500 })
  }
}
