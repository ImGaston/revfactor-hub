import { NextResponse } from "next/server"

import { verifyApiKey } from "@/lib/api-auth.server"
import { createAdminClient } from "@/lib/supabase/admin"
import { clearSuggestedReplyForApi, saveSuggestedReplyForApi } from "@/lib/support-tickets.server"

export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Context = { params: Promise<{ id: string }> }

function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE })
}

/**
 * The capture bot's draft reply for one ticket (contract v1.3). PUT replaces
 * the draft; DELETE withdraws it. Drafts only: a person edits and sends.
 */
export async function PUT(request: Request, context: Context) {
  const auth = await verifyApiKey(request, "support:write")
  if (!auth.ok) return apiError(auth.error, auth.status)

  const { id } = await context.params
  if (!UUID.test(id)) return apiError("Ticket id must be a UUID", 400)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError("Body must be valid JSON", 400)
  }

  try {
    const result = await saveSuggestedReplyForApi(createAdminClient(), id, body)
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE })
  } catch (error) {
    console.error(
      "[api/v1/support-tickets/suggested-reply] save failed:",
      error instanceof Error ? error.message : error
    )
    return apiError("Internal server error", 500)
  }
}

export async function DELETE(request: Request, context: Context) {
  const auth = await verifyApiKey(request, "support:write")
  if (!auth.ok) return apiError(auth.error, auth.status)

  const { id } = await context.params
  if (!UUID.test(id)) return apiError("Ticket id must be a UUID", 400)

  try {
    const result = await clearSuggestedReplyForApi(createAdminClient(), id)
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE })
  } catch (error) {
    console.error(
      "[api/v1/support-tickets/suggested-reply] clear failed:",
      error instanceof Error ? error.message : error
    )
    return apiError("Internal server error", 500)
  }
}
