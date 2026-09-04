import { NextResponse } from "next/server"
import { z } from "zod"

import { CheckoutBoundaryError } from "@/lib/server-checkout/contracts"
import { verifyInternalOnboardingRequest } from "@/lib/server-checkout/internal-auth.server"
import { onboardingAccountStatus } from "@/lib/server-checkout/onboarding-account.server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const bodySchema = z.object({
  groupFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  accountSequence: z.number().int().min(1).max(5),
})

export async function POST(request: Request) {
  const rawBody = await request.text()
  try {
    verifyInternalOnboardingRequest({
      secret: process.env.RF_ONBOARDING_INTERNAL_HMAC_SECRET ?? "",
      body: rawBody,
      timestamp: request.headers.get("x-rf-timestamp"),
      signature: request.headers.get("x-rf-signature"),
    })
    const input = bodySchema.parse(JSON.parse(rawBody))
    const status = await onboardingAccountStatus(input)
    return NextResponse.json({ success: true, ...status })
  } catch (error) {
    const status =
      error instanceof CheckoutBoundaryError &&
      error.code === "internal_auth_failed"
        ? 401
        : 400
    console.error(
      "[internal/onboarding/status] request rejected",
      error instanceof CheckoutBoundaryError ? error.code : "invalid_request"
    )
    return NextResponse.json(
      { error: "Status could not be verified" },
      { status }
    )
  }
}
