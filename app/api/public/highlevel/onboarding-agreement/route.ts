import { NextRequest, NextResponse } from "next/server"
import {
  addHighLevelContactTags,
  prepareHighLevelOnboardingAgreement,
  upsertHighLevelContact,
} from "@/lib/highlevel-onboarding"
import {
  buildStandardOnboardingValues,
  standardOnboardingSignupSchema,
} from "@/lib/onboarding-signup"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const DEFAULT_ALLOWED_ORIGINS = ["https://links.revfactor.io"]

function allowedOrigins(): Set<string> {
  const configured = process.env.HIGHLEVEL_ONBOARDING_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)

  const origins = configured?.length ? configured : DEFAULT_ALLOWED_ORIGINS
  if (process.env.NODE_ENV !== "production") {
    origins.push("http://localhost:3000", "http://localhost:3001")
  }
  return new Set(origins)
}

function corsHeaders(origin: string | null): HeadersInit {
  if (!origin || !allowedOrigins().has(origin)) return {}
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  }
}

function json(
  request: NextRequest,
  body: Record<string, unknown>,
  status = 200,
) {
  const origin = request.headers.get("origin")
  return NextResponse.json(body, {
    status,
    headers: corsHeaders(origin),
  })
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin")
  if (!origin || !allowedOrigins().has(origin)) {
    return new NextResponse(null, { status: 403 })
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) })
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin")
  if (!origin || !allowedOrigins().has(origin)) {
    return json(request, { error: "Origin not allowed" }, 403)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(request, { error: "Invalid JSON" }, 400)
  }

  if (
    typeof body === "object" &&
    body !== null &&
    "website" in body &&
    typeof body.website === "string" &&
    body.website.trim()
  ) {
    return json(request, { error: "Invalid submission" }, 400)
  }

  const parsed = standardOnboardingSignupSchema.safeParse(body)
  if (!parsed.success) {
    return json(
      request,
      {
        error: "Please review the highlighted onboarding details",
        issues: parsed.error.issues,
      },
      400,
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
      source: "RevFactor inline GHL onboarding",
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
        {
          key: "contact.rf_agreement_effective_date",
          fieldValue: new Date().toISOString().slice(0, 10),
        },
      ],
    })

    const agreement = await prepareHighLevelOnboardingAgreement({
      contactId,
      contactName: input.contactName,
      childListingQuantity: input.childListingQuantity,
    })
    try {
      await addHighLevelContactTags(contactId, [
        "rf-standard-inline-agreement",
      ])
    } catch (error) {
      console.warn(
        "[public/highlevel/onboarding-agreement] agreement created but tag update failed:",
        error instanceof Error ? error.message : error,
      )
    }

    return json(request, {
      success: true,
      signingUrl: agreement.signingUrl,
      reused: agreement.reused,
    })
  } catch (error) {
    console.error(
      "[public/highlevel/onboarding-agreement] failed:",
      error instanceof Error ? error.message : error,
    )
    return json(
      request,
      { error: "We could not prepare the agreement. Please try again." },
      502,
    )
  }
}
