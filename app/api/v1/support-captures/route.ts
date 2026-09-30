import { NextResponse } from "next/server"

import { verifyApiKey } from "@/lib/api-auth.server"
import { createAdminClient } from "@/lib/supabase/admin"
import { runSupportCapture } from "@/lib/support-tickets.server"

export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }

/**
 * One call per chat message processed by the capture bot: new asks become
 * tickets, and the message's effects on existing tickets become events. The
 * whole message is written in one transaction (apply_support_capture), and
 * every item is idempotent by a key derived from the message.
 * Contract: docs/support/grok-review-decisions.md.
 */
export async function POST(request: Request) {
  const auth = await verifyApiKey(request, "support:write")
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400, headers: NO_STORE })
  }

  try {
    const result = await runSupportCapture(createAdminClient(), body)
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE })
  } catch (error) {
    console.error(
      "[api/v1/support-captures] capture failed:",
      error instanceof Error ? error.message : error
    )
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE })
  }
}
