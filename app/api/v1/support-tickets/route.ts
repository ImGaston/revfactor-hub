import { NextRequest, NextResponse } from "next/server"

import { verifyApiKey } from "@/lib/api-auth.server"
import { createAdminClient } from "@/lib/supabase/admin"
import { listSupportTicketsForApi } from "@/lib/support-tickets.server"
import { SUPPORT_ACTIVE_STATUSES, SUPPORT_STATUSES, type SupportStatus } from "@/lib/support-tickets"

export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE })
}

function parseCursor(raw: string): { updatedAt: string; id: string } | null {
  const [updatedAt, id, ...rest] = raw.split("|")
  if (rest.length || !updatedAt || !id || Number.isNaN(Date.parse(updatedAt)) || !UUID.test(id)) return null
  return { updatedAt, id }
}

/**
 * Tickets for the capture bot to match follow-ups against (and for the daily
 * digest). Defaults to active tickets. Keyset-paginated on (updated_at, id).
 */
export async function GET(request: NextRequest) {
  const auth = await verifyApiKey(request, "support:read")
  if (!auth.ok) return apiError(auth.error, auth.status)

  const params = request.nextUrl.searchParams

  const rawStatus = params.get("status")?.trim() || "active"
  let statuses: SupportStatus[]
  if (rawStatus === "active") statuses = SUPPORT_ACTIVE_STATUSES
  else if (rawStatus === "all") statuses = [...SUPPORT_STATUSES]
  else {
    const requested = rawStatus.split(",").map((s) => s.trim())
    const invalid = requested.filter((s) => !(SUPPORT_STATUSES as readonly string[]).includes(s))
    if (invalid.length) return apiError(`Unknown status: ${invalid.join(", ")}`, 400)
    statuses = requested as SupportStatus[]
  }

  const hubClientId = params.get("hub_client_id")?.trim() || undefined
  if (hubClientId && !UUID.test(hubClientId)) return apiError("hub_client_id must be a UUID", 400)
  const assemblyClientId = params.get("assembly_client_id")?.trim() || undefined
  const assemblyCompanyId = params.get("assembly_company_id")?.trim() || undefined
  const client =
    hubClientId || assemblyClientId || assemblyCompanyId
      ? { hub_client_id: hubClientId, assembly_client_id: assemblyClientId, assembly_company_id: assemblyCompanyId }
      : undefined

  const updatedSince = params.get("updated_since")?.trim() || undefined
  if (updatedSince && Number.isNaN(Date.parse(updatedSince)))
    return apiError("updated_since must be a valid ISO 8601 timestamp", 400)

  const rawLimit = params.get("limit")
  if (rawLimit && !/^\d+$/.test(rawLimit)) return apiError("limit must be a positive integer", 400)
  const limit = Math.min(Number(rawLimit) || DEFAULT_LIMIT, MAX_LIMIT)

  const rawCursor = params.get("cursor")
  const cursor = rawCursor ? parseCursor(rawCursor) : undefined
  if (rawCursor && !cursor) return apiError("cursor is malformed", 400)

  try {
    const result = await listSupportTicketsForApi(createAdminClient(), {
      statuses,
      client,
      updatedSince,
      limit,
      cursor: cursor ?? undefined,
    })
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE })
  } catch (error) {
    console.error("[api/v1/support-tickets] list failed:", error instanceof Error ? error.message : error)
    return apiError("Internal server error", 500)
  }
}
