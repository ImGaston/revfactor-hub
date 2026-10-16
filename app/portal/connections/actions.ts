"use server"

import { resolvePortalAccess } from "@/lib/assembly-portal-session.server"
import {
  disconnectPortalConnection,
  submitPortalConnection,
  type SubmitResult,
} from "@/lib/pms-connections.server"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SESSION_EXPIRED = "Your session expired. Reopen this page from your portal."

// Every call re-validates the Assembly session token. The Hub client is taken
// from the decrypted token only; nothing else from the browser establishes
// whose connection this is. Credentials are never logged or returned.
export async function submitPmsConnectionAction(input: {
  token: string
  provider: string
  values: Record<string, string>
  expiresAt?: string | null
}): Promise<SubmitResult> {
  if (!input || typeof input.token !== "string") return { ok: false, error: "Invalid request." }
  const access = await resolvePortalAccess(input.token)
  if (!access.ok) return { ok: false, error: SESSION_EXPIRED }
  return submitPortalConnection(access.viewer, {
    provider: input.provider,
    values: input.values,
    expiresAt: input.expiresAt ?? null,
  })
}

export async function disconnectPmsConnectionAction(input: {
  token: string
  connectionId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input || typeof input.token !== "string" || !UUID.test(input.connectionId ?? ""))
    return { ok: false, error: "Invalid request." }
  const access = await resolvePortalAccess(input.token)
  if (!access.ok) return { ok: false, error: SESSION_EXPIRED }
  return disconnectPortalConnection(access.viewer, input.connectionId)
}
