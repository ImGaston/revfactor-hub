import "server-only"

import { assemblyApi } from "@assembly-js/node-sdk"
import { createAdminClient } from "@/lib/supabase/admin"

// Server-side identity for Assembly Custom App iframes (owner portal).
// Assembly appends an encrypted `token` query param to the app URL; only the
// app's API key can decrypt it. Query params other than the token are never
// trusted for identity, and the Hub client is resolved from the decrypted
// company/client ids (company first, matching the onboarding app contract).

export type PortalViewer = {
  hubClientId: string
  hubClientName: string
  assemblyClientId: string | null
  assemblyCompanyId: string | null
  isInternal: boolean
  displayName: string
}

export type PortalAccess =
  | { ok: true; viewer: PortalViewer }
  | {
      ok: false
      reason: "missing-token" | "misconfigured" | "invalid-token" | "no-client"
    }

function portalApiKey(): string | null {
  const key =
    process.env.ASSEMBLY_LISTING_REVIEW_APP_API_KEY ??
    process.env.ASSEMBLY_APP_API_KEY ??
    process.env.ASSEMBLY_API_KEY
  return key?.trim() ? key.trim() : null
}

export function normalizeToken(value: string | string[] | undefined | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

async function resolveHubClient(
  companyId: string | null,
  clientId: string | null
): Promise<{ id: string; name: string } | null> {
  const supabase = createAdminClient()
  if (companyId) {
    const { data } = await supabase
      .from("clients")
      .select("id, name")
      .eq("assembly_company_id", companyId)
      .limit(2)
    // Ambiguous company mappings fail closed.
    if (data && data.length === 1) return data[0]
    if (data && data.length > 1) return null
  }
  if (clientId) {
    const { data } = await supabase
      .from("clients")
      .select("id, name")
      .eq("assembly_client_id", clientId)
      .limit(2)
    if (data && data.length === 1) return data[0]
  }
  return null
}

export async function resolvePortalAccess(
  rawToken: string | string[] | undefined | null
): Promise<PortalAccess> {
  const token = normalizeToken(rawToken)
  if (!token) return { ok: false, reason: "missing-token" }

  const apiKey = portalApiKey()
  if (!apiKey) return { ok: false, reason: "misconfigured" }

  let payload:
    | { clientId?: string; companyId?: string; internalUserId?: string; workspaceId?: string }
    | undefined
  let assembly: Awaited<ReturnType<typeof assemblyApi>>
  try {
    assembly = await assemblyApi({ apiKey, token })
    payload = await assembly.getTokenPayload?.()
  } catch {
    return { ok: false, reason: "invalid-token" }
  }
  if (!payload) return { ok: false, reason: "invalid-token" }

  const companyId = payload.companyId ?? null
  const clientId = payload.clientId ?? null
  const isInternal = Boolean(payload.internalUserId) && !clientId

  // Internal users preview the app from a client's company context; without
  // one there is no client to show.
  const hubClient = await resolveHubClient(companyId, clientId)
  if (!hubClient) return { ok: false, reason: "no-client" }

  let displayName = isInternal ? "RevFactor team" : hubClient.name
  if (clientId) {
    try {
      const client = await assembly.retrieveClient({ id: clientId })
      displayName =
        [client.givenName, client.familyName].filter(Boolean).join(" ") || displayName
    } catch {
      // Identity stays valid if profile enrichment is unavailable.
    }
  }

  return {
    ok: true,
    viewer: {
      hubClientId: hubClient.id,
      hubClientName: hubClient.name,
      assemblyClientId: clientId,
      assemblyCompanyId: companyId,
      isInternal,
      displayName,
    },
  }
}
