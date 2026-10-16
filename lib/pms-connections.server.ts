import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { PortalViewer } from "@/lib/assembly-portal-session.server"
import { listHospitableProperties, type HospitableProperty } from "@/lib/hospitable-client.server"
import {
  computeRemindAt,
  isPmsProvider,
  MAX_OPEN_CONNECTIONS_PER_CLIENT,
  parsePmsSecretPayload,
  PMS_PROVIDER_CONFIG,
  pmsErrorMessage,
  pmsProviderLabel,
  suggestPropertyMappings,
  validatePmsCredential,
  validatePmsLabel,
  type PmsConnectionStatus,
  type PmsCredentialInput,
  type PmsErrorCode,
  type PortalPmsConnection,
} from "@/lib/pms-connections"
import { createAdminClient } from "@/lib/supabase/admin"

// Server paths for client PMS connections.
//
// The portal has no Supabase session, so it uses the admin client. RLS is
// bypassed there, which makes two things the security boundary:
//   1. every query is filtered by the portal viewer's own Hub client id, taken
//      from the server-validated Assembly token (never from the request), and
//   2. explicit column projections — never select("*"), never secret_id.
// Secrets go in and out of Vault only through the service-role functions in
// migration 20261020120000. Nothing here logs a secret or a provider body.

type Deps = {
  supabase?: SupabaseClient
  listProperties?: typeof listHospitableProperties
  now?: () => Date
}

const PORTAL_CONNECTION_COLUMNS =
  "id, provider, provider_name, status, token_last4, created_at, remind_at, expires_at, property_count, last_validated_at"

type ConnectionRow = {
  id: string
  provider: string
  provider_name: string | null
  status: string
  token_last4: string | null
  created_at: string
  remind_at: string
  expires_at: string | null
  property_count: number | null
  last_validated_at: string | null
}

export function isMissingConnectionsRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST202" ||
    /does not exist|could not find the (table|function)/i.test(error.message ?? "")
  )
}

// ---------------------------------------------------------------------------
// Portal: load
// ---------------------------------------------------------------------------

export type PortalLoadResult =
  | { ok: true; connections: PortalPmsConnection[] }
  | { ok: false; reason: "not_ready" | "failed" }

/** Open (not disconnected) connections for the viewer's own client only. */
export async function loadPortalConnections(
  hubClientId: string,
  deps: Deps = {}
): Promise<PortalLoadResult> {
  const supabase = deps.supabase ?? createAdminClient()
  const { data, error } = await supabase
    .from("client_pms_connections")
    .select(PORTAL_CONNECTION_COLUMNS)
    .eq("client_id", hubClientId)
    .neq("status", "disconnected")
    .order("created_at", { ascending: false })
  if (error) {
    console.error("pms connections: portal load failed", error.code ?? "unknown")
    return { ok: false, reason: isMissingConnectionsRelation(error) ? "not_ready" : "failed" }
  }
  const rows = (data ?? []) as ConnectionRow[]

  const names = new Map<string, string[]>()
  if (rows.length > 0) {
    const { data: props } = await supabase
      .from("client_pms_properties")
      .select("connection_id, name")
      .eq("client_id", hubClientId)
      .in(
        "connection_id",
        rows.map((r) => r.id)
      )
      .order("name")
    for (const p of (props ?? []) as { connection_id: string; name: string | null }[]) {
      names.set(p.connection_id, [...(names.get(p.connection_id) ?? []), p.name ?? "Unnamed property"])
    }
  }

  return { ok: true, connections: rows.map((row) => toPortalConnection(row, names.get(row.id) ?? [])) }
}

function toPortalConnection(row: ConnectionRow, propertyNames: string[]): PortalPmsConnection {
  return {
    id: row.id,
    provider: isPmsProvider(row.provider) ? row.provider : "other",
    providerLabel: pmsProviderLabel(row.provider, row.provider_name),
    status: row.status as PmsConnectionStatus,
    tokenLast4: row.token_last4,
    createdAt: row.created_at,
    remindAt: row.remind_at,
    expiresAt: row.expires_at,
    propertyCount: row.property_count,
    lastValidatedAt: row.last_validated_at,
    propertyNames,
  }
}

// ---------------------------------------------------------------------------
// Portal: submit
// ---------------------------------------------------------------------------

export type SubmitResult =
  | { ok: true; connection: PortalPmsConnection; liveChecked: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; code?: PmsErrorCode }

export async function submitPortalConnection(
  viewer: PortalViewer,
  input: PmsCredentialInput,
  deps: Deps = {}
): Promise<SubmitResult> {
  if (viewer.isInternal) return { ok: false, error: "Team previews can't submit credentials." }
  const now = deps.now?.() ?? new Date()
  const validated = validatePmsCredential(input, now)
  if (!validated.ok) return { ok: false, error: validated.error, fieldErrors: validated.fieldErrors }
  const value = validated.value
  const config = PMS_PROVIDER_CONFIG[value.provider]
  const supabase = deps.supabase ?? createAdminClient()

  const { count, error: countError } = await supabase
    .from("client_pms_connections")
    .select("id", { count: "exact", head: true })
    .eq("client_id", viewer.hubClientId)
    .neq("status", "disconnected")
  if (countError) {
    console.error("pms connections: count failed", countError.code ?? "unknown")
    return { ok: false, error: "We couldn't save this right now. Please try again in a minute." }
  }
  if ((count ?? 0) >= MAX_OPEN_CONNECTIONS_PER_CLIENT) {
    return { ok: false, error: "You already have several connections. Disconnect one you no longer use, or message us." }
  }

  // Live check (Hospitable only). Nothing is stored when it fails.
  let properties: HospitableProperty[] = []
  if (config.liveCheck) {
    const fields = parsePmsSecretPayload(value.secretPayload)
    const token = fields?.token ?? ""
    const result = await (deps.listProperties ?? listHospitableProperties)(token)
    if (!result.ok) return { ok: false, code: result.code, error: pmsErrorMessage(result.code, config.label) }
    properties = result.data
  }

  const { data: connectionId, error: createError } = await supabase.rpc("pms_connection_create", {
    p_client_id: viewer.hubClientId,
    p_provider: value.provider,
    p_provider_name: value.providerName,
    p_label: null,
    p_status: config.liveCheck ? "connected" : "pending_verification",
    p_secret: value.secretPayload,
    p_token_last4: value.tokenLast4,
    p_expires_at: value.expiresAt,
    p_remind_at: computeRemindAt(now, value.expiresAt),
    p_property_count: config.liveCheck ? properties.length : null,
    p_last_validated_at: config.liveCheck ? now.toISOString() : null,
    p_client_note: value.clientNote,
    p_submitted_via: "portal",
    p_created_by: null,
    p_created_by_assembly_client_id: viewer.assemblyClientId,
  })
  if (createError || typeof connectionId !== "string") {
    console.error("pms connections: create failed", createError?.code ?? "unknown")
    return { ok: false, error: "We couldn't save this right now. Please try again in a minute." }
  }

  if (properties.length > 0) {
    const synced = await syncDiscoveredProperties(supabase, connectionId, viewer.hubClientId, properties, now)
    if (!synced) console.error("pms connections: property save failed after connect")
  }

  const loaded = await loadPortalConnections(viewer.hubClientId, { supabase })
  const connection = loaded.ok ? loaded.connections.find((c) => c.id === connectionId) : undefined
  return {
    ok: true,
    liveChecked: config.liveCheck,
    connection: connection ?? {
      id: connectionId,
      provider: value.provider,
      providerLabel: pmsProviderLabel(value.provider, value.providerName),
      status: config.liveCheck ? "connected" : "pending_verification",
      tokenLast4: value.tokenLast4,
      createdAt: now.toISOString(),
      remindAt: computeRemindAt(now, value.expiresAt),
      expiresAt: value.expiresAt,
      propertyCount: config.liveCheck ? properties.length : null,
      lastValidatedAt: config.liveCheck ? now.toISOString() : null,
      propertyNames: properties.map((p) => p.name ?? "Unnamed property"),
    },
  }
}

// ---------------------------------------------------------------------------
// Portal: disconnect
// ---------------------------------------------------------------------------

export async function disconnectPortalConnection(
  viewer: PortalViewer,
  connectionId: string,
  deps: Deps = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (viewer.isInternal) return { ok: false, error: "Team previews can't disconnect connections." }
  const supabase = deps.supabase ?? createAdminClient()
  // The function only touches a row whose client_id is the viewer's client.
  const { data, error } = await supabase.rpc("pms_connection_disconnect_for_client", {
    p_connection_id: connectionId,
    p_client_id: viewer.hubClientId,
    p_assembly_client_id: viewer.assemblyClientId,
  })
  if (error) {
    console.error("pms connections: portal disconnect failed", error.code ?? "unknown")
    return { ok: false, error: "We couldn't disconnect this right now. Please try again." }
  }
  if (data !== true) return { ok: false, error: "This connection was not found or is already disconnected." }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Staff: add a connection from the Hub (caller checks permissions first)
// ---------------------------------------------------------------------------

export type StaffCreateInput = PmsCredentialInput & { label?: unknown }

export type StaffCreateResult =
  | {
      ok: true
      connectionId: string
      status: "connected" | "verified" | "pending_verification"
      propertyCount: number | null
      /** Set when the key was saved but a follow-up step didn't finish. */
      warning?: string
    }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; code?: PmsErrorCode }

type StaffDeps = Deps & {
  /**
   * Marks a just-created, non-live connection verified as the staff member
   * (session RPC pms_connection_review). Without it the connection stays
   * pending verification.
   */
  markVerified?: (connectionId: string) => Promise<boolean>
}

const STAFF_SAVE_FAILED = "Couldn't save this connection. Try again in a minute."

/**
 * A staff member pastes a client's PMS key in the Hub. Same validation, live
 * check and Vault path as the portal; the row is stamped submitted_via='hub'
 * and created_by = the staff profile. Hospitable is saved only after a
 * successful live check. Other PMSs are saved and then marked verified by the
 * staff member, since there is no client submission to review.
 *
 * The admin client bypasses RLS: the caller must check data_connections:edit
 * before calling this. Secrets are never logged or returned.
 */
export async function createStaffConnection(
  clientId: string,
  actorProfileId: string,
  input: StaffCreateInput,
  deps: StaffDeps = {}
): Promise<StaffCreateResult> {
  const now = deps.now?.() ?? new Date()
  const validated = validatePmsCredential(input, now)
  const label = validatePmsLabel(input.label)
  if (!validated.ok || !label.ok) {
    const fieldErrors = {
      ...(validated.ok ? {} : validated.fieldErrors),
      ...(label.ok ? {} : { label: label.error }),
    }
    return { ok: false, error: validated.ok ? "Check the highlighted fields" : validated.error, fieldErrors }
  }
  const value = validated.value
  const config = PMS_PROVIDER_CONFIG[value.provider]
  const supabase = deps.supabase ?? createAdminClient()

  const { count, error: countError } = await supabase
    .from("client_pms_connections")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .neq("status", "disconnected")
  if (countError) {
    console.error("pms connections: staff count failed", countError.code ?? "unknown")
    return { ok: false, error: STAFF_SAVE_FAILED }
  }
  if ((count ?? 0) >= MAX_OPEN_CONNECTIONS_PER_CLIENT) {
    return {
      ok: false,
      error: `This client already has ${MAX_OPEN_CONNECTIONS_PER_CLIENT} open connections. Disconnect one first.`,
    }
  }

  // Live check (Hospitable only). Nothing is stored when it fails.
  let properties: HospitableProperty[] = []
  if (config.liveCheck) {
    const token = parsePmsSecretPayload(value.secretPayload)?.token ?? ""
    const result = await (deps.listProperties ?? listHospitableProperties)(token)
    if (!result.ok) return { ok: false, code: result.code, error: pmsErrorMessage(result.code, config.label) }
    properties = result.data
  }

  const { data: connectionId, error: createError } = await supabase.rpc("pms_connection_create", {
    p_client_id: clientId,
    p_provider: value.provider,
    p_provider_name: value.providerName,
    p_label: label.label,
    // The create function only accepts these two; non-live keys are marked
    // verified right after, as the staff member.
    p_status: config.liveCheck ? "connected" : "pending_verification",
    p_secret: value.secretPayload,
    p_token_last4: value.tokenLast4,
    p_expires_at: value.expiresAt,
    p_remind_at: computeRemindAt(now, value.expiresAt),
    p_property_count: config.liveCheck ? properties.length : null,
    p_last_validated_at: config.liveCheck ? now.toISOString() : null,
    p_client_note: value.clientNote,
    p_submitted_via: "hub",
    p_created_by: actorProfileId,
    p_created_by_assembly_client_id: null,
  })
  if (createError || typeof connectionId !== "string") {
    console.error("pms connections: staff create failed", createError?.code ?? "unknown")
    return { ok: false, error: STAFF_SAVE_FAILED }
  }

  if (config.liveCheck) {
    if (properties.length > 0) {
      const synced = await syncDiscoveredProperties(supabase, connectionId, clientId, properties, now)
      if (!synced) {
        console.error("pms connections: property save failed after staff connect")
        return {
          ok: true,
          connectionId,
          status: "connected",
          propertyCount: properties.length,
          warning: "Connected, but saving the property list failed. Use Re-check to try again.",
        }
      }
    }
    return { ok: true, connectionId, status: "connected", propertyCount: properties.length }
  }

  const verified = deps.markVerified ? await deps.markVerified(connectionId).catch(() => false) : false
  if (!verified) {
    return {
      ok: true,
      connectionId,
      status: "pending_verification",
      propertyCount: null,
      warning: "Saved, but it couldn't be marked verified. Use Mark verified on the connection.",
    }
  }
  return { ok: true, connectionId, status: "verified", propertyCount: null }
}

// ---------------------------------------------------------------------------
// Discovery → client_pms_properties (never touches confirmed mappings)
// ---------------------------------------------------------------------------

export async function syncDiscoveredProperties(
  supabase: SupabaseClient,
  connectionId: string,
  clientId: string,
  properties: HospitableProperty[],
  now: Date = new Date()
): Promise<boolean> {
  const [{ data: listings, error: listingsError }, { data: existing, error: existingError }] = await Promise.all([
    supabase.from("listings").select("id, airbnb_link").eq("client_id", clientId),
    supabase
      .from("client_pms_properties")
      .select("id, external_property_id, mapping_status")
      .eq("connection_id", connectionId)
      .eq("client_id", clientId),
  ])
  if (listingsError || existingError) return false

  const suggestions = new Map(
    suggestPropertyMappings(properties, (listings ?? []) as { id: string; airbnb_link: string | null }[]).map((s) => [
      s.external_property_id,
      s,
    ])
  )
  const known = new Map(
    ((existing ?? []) as { id: string; external_property_id: string; mapping_status: string }[]).map((r) => [
      r.external_property_id,
      r,
    ])
  )
  const seenAt = now.toISOString()

  const inserts = properties
    .filter((p) => !known.has(p.external_property_id))
    .map((p) => {
      const s = suggestions.get(p.external_property_id)
      return {
        connection_id: connectionId,
        client_id: clientId,
        external_property_id: p.external_property_id,
        name: p.name,
        airbnb_id: p.airbnb_id,
        vrbo_id: p.vrbo_id,
        suggested_listing_id: s?.suggested_listing_id ?? null,
        suggestion_reason: s?.suggestion_reason ?? null,
        mapping_status: s?.mapping_status ?? "unmatched",
        last_seen_at: seenAt,
      }
    })
  if (inserts.length > 0) {
    const { error } = await supabase.from("client_pms_properties").insert(inserts)
    if (error) return false
  }

  for (const p of properties) {
    const row = known.get(p.external_property_id)
    if (!row) continue
    const s = suggestions.get(p.external_property_id)
    const awaiting = row.mapping_status === "suggested" || row.mapping_status === "unmatched"
    const { error } = await supabase
      .from("client_pms_properties")
      .update({
        name: p.name,
        airbnb_id: p.airbnb_id,
        vrbo_id: p.vrbo_id,
        suggested_listing_id: s?.suggested_listing_id ?? null,
        suggestion_reason: s?.suggestion_reason ?? null,
        last_seen_at: seenAt,
        ...(awaiting ? { mapping_status: s?.mapping_status ?? "unmatched" } : {}),
      })
      .eq("id", row.id)
      .eq("client_id", clientId)
    if (error) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Staff: re-check a Hospitable connection (caller checks permissions first)
// ---------------------------------------------------------------------------

export async function recheckHospitableConnection(
  connectionId: string,
  actorProfileId: string,
  deps: Deps = {}
): Promise<{ ok: true; propertyCount: number } | { ok: false; error: string; code?: PmsErrorCode }> {
  const supabase = deps.supabase ?? createAdminClient()
  const now = deps.now?.() ?? new Date()
  const { data: row, error } = await supabase
    .from("client_pms_connections")
    .select("id, client_id, provider, status")
    .eq("id", connectionId)
    .maybeSingle()
  if (error || !row) return { ok: false, error: "Connection not found" }
  if (row.provider !== "hospitable") return { ok: false, error: "Only Hospitable connections can be checked live" }
  if (row.status === "disconnected") return { ok: false, error: "This connection is disconnected" }

  const { data: secret, error: secretError } = await supabase.rpc("pms_connection_secret", {
    p_connection_id: connectionId,
  })
  if (secretError || typeof secret !== "string") return { ok: false, error: "The stored token is unavailable" }
  const token = parsePmsSecretPayload(secret)?.token ?? ""

  const result = await (deps.listProperties ?? listHospitableProperties)(token)
  const update = result.ok
    ? {
        status: "connected",
        last_validated_at: now.toISOString(),
        last_error_code: null,
        property_count: result.data.length,
        updated_by: actorProfileId,
        updated_by_assembly_client_id: null,
      }
    : {
        status: "error",
        last_error_code: result.code,
        updated_by: actorProfileId,
        updated_by_assembly_client_id: null,
      }
  const { error: updateError } = await supabase.from("client_pms_connections").update(update).eq("id", connectionId)
  if (updateError) return { ok: false, error: "Couldn't save the check result" }
  if (!result.ok) return { ok: false, code: result.code, error: pmsErrorMessage(result.code) }

  const synced = await syncDiscoveredProperties(supabase, connectionId, row.client_id as string, result.data, now)
  if (!synced) return { ok: false, error: "Token works, but saving the property list failed" }
  return { ok: true, propertyCount: result.data.length }
}
