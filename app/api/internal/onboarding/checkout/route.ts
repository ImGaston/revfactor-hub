import { NextResponse } from "next/server"

import { CheckoutBoundaryError } from "@/lib/server-checkout/contracts"
import { verifyInternalOnboardingRequest } from "@/lib/server-checkout/internal-auth.server"
import { prepareOnboardingAccountCheckout } from "@/lib/server-checkout/onboarding-account.server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: Request) {
  const rawBody = await request.text()
  try {
    verifyInternalOnboardingRequest({
      secret: process.env.RF_ONBOARDING_INTERNAL_HMAC_SECRET ?? "",
      body: rawBody,
      timestamp: request.headers.get("x-rf-timestamp"),
      signature: request.headers.get("x-rf-signature"),
    })
    const result = await prepareOnboardingAccountCheckout(JSON.parse(rawBody))
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const status =
      error instanceof CheckoutBoundaryError &&
      error.code === "internal_auth_failed"
        ? 401
        : error instanceof SyntaxError
          ? 400
          : 422
    console.error(
      "[internal/onboarding/checkout] request rejected",
      error instanceof CheckoutBoundaryError ? error.code : "internal_error"
    )
    return NextResponse.json(
      { error: "Checkout could not be prepared" },
      { status }
    )
  }
}
