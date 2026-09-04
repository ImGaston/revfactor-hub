import { NextResponse } from "next/server"
import { saveClientCommand } from "@/lib/ghl-onboarding-v1/service.server"
import { onboardingCors } from "@/lib/ghl-onboarding-v1/cors.server"
export function OPTIONS(request: Request) {
  const headers = onboardingCors(request)
  return new NextResponse(null, {
    status: headers ? 204 : 403,
    headers: headers ?? undefined,
  })
}
export async function POST(request: Request) {
  const headers = onboardingCors(request)
  if (!headers)
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 })
  if (process.env.GHL_V1_ENABLED !== "true")
    return NextResponse.json({ error: "disabled" }, { status: 503, headers })
  try {
    const body = await request.text()
    if (body.length > 64000)
      return NextResponse.json(
        { error: "body_too_large" },
        { status: 413, headers }
      )
    const token =
      request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
    return NextResponse.json(await saveClientCommand(token, JSON.parse(body)), {
      headers,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_request"
    const allowed = [
      "revision_conflict",
      "journey_locked",
      "payment_required",
      "onboarding_incomplete",
      "signed_property_correction_requires_review",
      "action_not_allowed",
      "journey_not_allowed",
      "event_payload_conflict",
    ]
    return NextResponse.json(
      { error: allowed.includes(code) ? code : "invalid_request" },
      { status: code === "revision_conflict" ? 409 : 400, headers }
    )
  }
}
