import { NextResponse } from "next/server"
import { getClientContext } from "@/lib/ghl-onboarding-v1/service.server"

import { onboardingCors as cors } from "@/lib/ghl-onboarding-v1/cors.server"

export function OPTIONS(request: Request) {
  const headers = cors(request)
  return new NextResponse(null, {
    status: headers ? 204 : 403,
    headers: headers ?? undefined,
  })
}
export async function POST(request: Request) {
  const headers = cors(request)
  if (!headers)
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 })
  if (process.env.GHL_V1_ENABLED !== "true")
    return NextResponse.json({ error: "disabled" }, { status: 503, headers })
  const token =
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
  try {
    return NextResponse.json(await getClientContext(token), { headers })
  } catch {
    return NextResponse.json(
      { error: "invalid_or_expired_link" },
      { status: 404, headers }
    )
  }
}
