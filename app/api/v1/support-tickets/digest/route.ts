import { NextResponse } from "next/server"

import { verifyApiKey } from "@/lib/api-auth.server"
import { createAdminClient } from "@/lib/supabase/admin"
import { buildSupportDigestForApi } from "@/lib/support-tickets.server"

export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }

/**
 * Daily digest sections computed with the same rules as the Hub queue. The
 * bot formats and delivers them; it never recomputes them from chats.
 */
export async function GET(request: Request) {
  const auth = await verifyApiKey(request, "support:read")
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE })

  try {
    const digest = await buildSupportDigestForApi(createAdminClient())
    return NextResponse.json(digest, { headers: NO_STORE })
  } catch (error) {
    console.error("[api/v1/support-tickets/digest] failed:", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE })
  }
}
