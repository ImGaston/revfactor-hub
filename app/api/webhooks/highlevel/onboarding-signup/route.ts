import { NextRequest, NextResponse } from "next/server"
import {
  addHighLevelContactTags,
  upsertHighLevelContact,
} from "@/lib/highlevel-onboarding"
import {
  buildStandardOnboardingValues,
  standardOnboardingSignupSchema,
} from "@/lib/onboarding-signup"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const secret = process.env.HIGHLEVEL_SIGNUP_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: "HIGHLEVEL_SIGNUP_WEBHOOK_SECRET not configured" },
      { status: 500 },
    )
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = standardOnboardingSignupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid standard-onboarding signup", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  try {
    const input = parsed.data
    const values = buildStandardOnboardingValues(input)
    const contactId = await upsertHighLevelContact({
      name: input.contactName,
      email: input.email,
      phone: input.phone || null,
      companyName: input.legalName,
      source: "RevFactor standard signup",
      customFields: [
        { key: "contact.rf_client_legal_name", fieldValue: input.legalName },
        {
          key: "contact.rf_primary_listing_quantity",
          fieldValue: String(input.primaryListingQuantity),
        },
        {
          key: "contact.rf_child_listing_quantity",
          fieldValue: String(input.childListingQuantity),
        },
        {
          key: "contact.rf_pricing_program",
          fieldValue: values.pricingProgram,
        },
        {
          key: "contact.rf_monthly_service_fee",
          fieldValue: String(values.monthlyServiceFee),
        },
        {
          key: "contact.rf_onboarding_fee",
          fieldValue: String(values.onboardingFee),
        },
        {
          key: "contact.rf_initial_checkout_total",
          fieldValue: String(values.initialCheckoutTotal),
        },
        {
          key: "contact.rf_service_start_mode",
          fieldValue: input.serviceStartMode,
        },
        {
          key: "contact.rf_service_start_date",
          fieldValue: values.serviceStartDate ?? "",
        },
      ],
    })

    // Add the workflow trigger separately so the upsert never overwrites existing tags.
    await addHighLevelContactTags(contactId, ["rf-standard-contract-ready"])

    return NextResponse.json({
      success: true,
      contactId,
      monthlyServiceFee: values.monthlyServiceFee,
      onboardingFee: values.onboardingFee,
      initialCheckoutTotal: values.initialCheckoutTotal,
    })
  } catch (error) {
    console.error(
      "[webhook/highlevel/onboarding-signup] failed:",
      error instanceof Error ? error.message : error,
    )
    return NextResponse.json(
      { error: "Could not prepare standard onboarding" },
      { status: 500 },
    )
  }
}
