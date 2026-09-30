import { NextRequest, NextResponse } from "next/server"

import { verifyApiKey } from "@/lib/api-auth.server"
import { createAdminClient } from "@/lib/supabase/admin"
import { listSupportClientListings } from "@/lib/support-tickets.server"

export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE })
}

/**
 * One client's listings (public names, nicknames, PriceLabs/Airbnb IDs) so
 * the capture bot can send exact hub_listing_id values instead of guessing
 * from nicknames. Also says whether capture is on and whether the client is
 * hand-managed.
 */
export async function GET(request: NextRequest) {
  const auth = await verifyApiKey(request, "support:read")
  if (!auth.ok) return apiError(auth.error, auth.status)

  const params = request.nextUrl.searchParams
  const hubClientId = params.get("hub_client_id")?.trim() || undefined
  if (hubClientId && !UUID.test(hubClientId)) return apiError("hub_client_id must be a UUID", 400)
  const assemblyClientId = params.get("assembly_client_id")?.trim() || undefined
  const assemblyCompanyId = params.get("assembly_company_id")?.trim() || undefined
  if (!hubClientId && !assemblyClientId && !assemblyCompanyId)
    return apiError("Pass hub_client_id, assembly_client_id, or assembly_company_id", 400)

  try {
    const result = await listSupportClientListings(createAdminClient(), {
      hub_client_id: hubClientId,
      assembly_client_id: assemblyClientId,
      assembly_company_id: assemblyCompanyId,
    })
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE })
  } catch (error) {
    console.error("[api/v1/support-listings] failed:", error instanceof Error ? error.message : error)
    return apiError("Internal server error", 500)
  }
}
