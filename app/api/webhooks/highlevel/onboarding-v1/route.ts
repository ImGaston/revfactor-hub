import { NextResponse } from "next/server"
import {
  BeginSchema,
  CommandSchema,
  applyCommand,
  beginJourney,
  checkBearer,
} from "@/lib/ghl-onboarding-v1/service.server"

import {
  ControlSchema,
  controlJourney,
} from "@/lib/ghl-onboarding-v1/control.server"

export async function POST(request: Request) {
  if (!checkBearer(request, "GHL_V1_WEBHOOK_SECRET"))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (process.env.GHL_V1_ENABLED !== "true")
    return NextResponse.json(
      { error: "onboarding_v1_disabled" },
      { status: 503 }
    )
  const raw = await request.text()
  if (raw.length > 64000)
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 })
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }
  const control = ControlSchema.safeParse(body)
  const begin = BeginSchema.safeParse(body)
  const command = CommandSchema.safeParse(body)
  if (!begin.success && !command.success && !control.success)
    return NextResponse.json({ error: "invalid_command" }, { status: 400 })
  try {
    return NextResponse.json(
      control.success
        ? await controlJourney(control.data)
        : begin.success
          ? await beginJourney(begin.data)
          : await applyCommand(command.data!),
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    const code = error instanceof Error ? error.message : "onboarding_error"
    const safe = /^[a-z_]+$/.test(code) ? code : "onboarding_dependency_error"
    return NextResponse.json(
      { error: safe },
      { status: safe === "revision_conflict" ? 409 : 422 }
    )
  }
}
