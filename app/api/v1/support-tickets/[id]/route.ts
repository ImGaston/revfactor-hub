import { NextResponse } from "next/server"

import { verifyApiKey } from "@/lib/api-auth.server"
import { createAdminClient } from "@/lib/supabase/admin"
import { updateSupportTicketForApi } from "@/lib/support-tickets.server"

export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Context = { params: Promise<{ id: string }> }

function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE })
}

export async function PATCH(request: Request, context: Context) {
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
    const result = await updateSupportTicketForApi(createAdminClient(), id, body, {
      keyId: auth.context.keyId,
    })
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE })
  } catch (error) {
    console.error(
      "[api/v1/support-tickets/[id]] update failed:",
      error instanceof Error ? error.message : error
    )
    return apiError("Internal server error", 500)
  }
}
