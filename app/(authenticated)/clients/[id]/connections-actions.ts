"use server"

// Data Connections tab on /clients/[id]: staff review of client PMS
// connections and property → listing mapping.
//
// Reads and mapping writes run on the session client (RLS: data_connections
// view/edit + listings:edit). Review and disconnect go through SECURITY DEFINER
// functions that re-check has_permission. The live Hospitable re-check needs
// the Vault secret, so it uses the admin client — gated in code first.
// Secrets and secret_id are never selected here.

import { revalidatePath } from "next/cache"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import {
  createStaffConnection,
  isMissingConnectionsRelation,
  recheckHospitableConnection,
  type StaffCreateResult,
} from "@/lib/pms-connections.server"
import {
  pmsProviderLabel,
  type PmsConnectionStatus,
  type PmsErrorCode,
} from "@/lib/pms-connections"
import { getPmsAdapter } from "@/lib/pms-adapters.server"
import { formatPmsCoverage } from "@/lib/pms-reservations"
import { syncPmsConnection } from "@/lib/pms-sync.server"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MIGRATION_PENDING =
  "This needs the PMS connections migration (20261020120000), which isn't applied yet"

type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: string }
type ActionResult = { ok: true } | { ok: false; error: string }

type Person = { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null

function personName(p: Person): string | null {
  const who = Array.isArray(p) ? p[0] : p
  return who?.full_name ?? who?.email ?? null
}

export type StaffPmsConnection = {
  id: string
  provider: string
  providerLabel: string
  label: string | null
  status: PmsConnectionStatus
  tokenLast4: string | null
  expiresAt: string | null
  remindAt: string
  propertyCount: number | null
  lastValidatedAt: string | null
  lastErrorCode: PmsErrorCode | null
  clientNote: string | null
  submittedVia: string
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNote: string | null
  disconnectedAt: string | null
  createdAt: string
}

export type StaffPmsProperty = {
  id: string
  connectionId: string
  externalPropertyId: string
  name: string | null
  airbnbId: string | null
  vrboId: string | null
  suggestedListingId: string | null
  suggestionReason: string | null
  mappedListingId: string | null
  mappingStatus: "suggested" | "unmatched" | "confirmed" | "ignored"
  confirmedBy: string | null
  confirmedAt: string | null
}

export type StaffPmsEvent = {
  id: string
  connectionId: string
  eventType: string
  fromStatus: string | null
  toStatus: string | null
  actor: string | null
  viaPortal: boolean
  createdAt: string
}

export type StaffPmsSyncState = {
  /** The PMS has a booking-sync adapter (Hospitable today). */
  supported: boolean
  /** Latest run of any status. */
  lastRun: {
    status: "running" | "succeeded" | "partial" | "failed"
    mode: "backfill" | "incremental"
    errorCode: string | null
    startedAt: string
    finishedAt: string | null
  } | null
  /** Latest successful run's coverage, e.g. "Jan 2024 – Apr 2028 · 412 stays". */
  coverage: string | null
  lastSuccessAt: string | null
}

export type ClientConnectionsData = {
  connections: StaffPmsConnection[]
  /** Keyed by connection id. No runs when the sync migration isn't applied. */
  sync: Record<string, StaffPmsSyncState>
  properties: StaffPmsProperty[]
  listings: { id: string; name: string; status: string }[]
  events: StaffPmsEvent[]
  canManage: boolean
  canMap: boolean
}

export async function loadClientConnectionsAction(clientId: string): Promise<Result<ClientConnectionsData>> {
  if (!UUID.test(clientId)) return { error: "Invalid client" }
  const [canView, canManage, canEditListings] = await Promise.all([
    hasPermission("data_connections", "view"),
    hasPermission("data_connections", "edit"),
    hasPermission("listings", "edit"),
  ])
  if (!canView) return { error: "You don't have access to data connections" }

  const supabase = await createClient()
  const [connectionsResult, propertiesResult, listingsResult, eventsResult, runsResult] = await Promise.all([
    supabase
      .from("client_pms_connections")
      .select(
        "id, provider, provider_name, label, status, token_last4, expires_at, remind_at, property_count, last_validated_at, last_error_code, client_note, submitted_via, reviewed_at, review_note, disconnected_at, created_at, reviewer:profiles!client_pms_connections_reviewed_by_fkey(full_name, email)"
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
    supabase
      .from("client_pms_properties")
      .select(
        "id, connection_id, external_property_id, name, airbnb_id, vrbo_id, suggested_listing_id, suggestion_reason, mapped_listing_id, mapping_status, confirmed_at, confirmer:profiles!client_pms_properties_confirmed_by_fkey(full_name, email)"
      )
      .eq("client_id", clientId)
      .order("name"),
    supabase.from("listings").select("id, name, status").eq("client_id", clientId).order("name"),
    supabase
      .from("client_pms_connection_events")
      .select(
        "id, connection_id, event_type, from_status, to_status, actor_assembly_client_id, created_at, actor:profiles!client_pms_connection_events_actor_id_fkey(full_name, email)"
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("pms_sync_runs")
      .select("connection_id, status, mode, error_code, started_at, finished_at, coverage_start, coverage_end, stay_count")
      .eq("client_id", clientId)
      .order("started_at", { ascending: false })
      .limit(100),
  ])

  if (isMissingConnectionsRelation(connectionsResult.error)) return { error: MIGRATION_PENDING }
  if (connectionsResult.error || propertiesResult.error || eventsResult.error) {
    return { error: "Couldn't load data connections" }
  }

  type ConnRow = {
    id: string
    provider: string
    provider_name: string | null
    label: string | null
    status: PmsConnectionStatus
    token_last4: string | null
    expires_at: string | null
    remind_at: string
    property_count: number | null
    last_validated_at: string | null
    last_error_code: PmsErrorCode | null
    client_note: string | null
    submitted_via: string
    reviewed_at: string | null
    review_note: string | null
    disconnected_at: string | null
    created_at: string
    reviewer: Person
  }
  type PropRow = {
    id: string
    connection_id: string
    external_property_id: string
    name: string | null
    airbnb_id: string | null
    vrbo_id: string | null
    suggested_listing_id: string | null
    suggestion_reason: string | null
    mapped_listing_id: string | null
    mapping_status: StaffPmsProperty["mappingStatus"]
    confirmed_at: string | null
    confirmer: Person
  }
  type EventRow = {
    id: string
    connection_id: string
    event_type: string
    from_status: string | null
    to_status: string | null
    actor_assembly_client_id: string | null
    created_at: string
    actor: Person
  }

  type RunRow = {
    connection_id: string
    status: NonNullable<StaffPmsSyncState["lastRun"]>["status"]
    mode: NonNullable<StaffPmsSyncState["lastRun"]>["mode"]
    error_code: string | null
    started_at: string
    finished_at: string | null
    coverage_start: string | null
    coverage_end: string | null
    stay_count: number | null
  }
  // The sync migration may not be applied yet: no runs; the action explains.
  const runs = runsResult.error ? [] : ((runsResult.data ?? []) as RunRow[])
  const sync: Record<string, StaffPmsSyncState> = {}
  for (const c of (connectionsResult.data ?? []) as unknown as ConnRow[]) {
    const mine = runs.filter((r) => r.connection_id === c.id)
    const last = mine[0]
    const success = mine.find((r) => r.status === "succeeded")
    sync[c.id] = {
      supported: getPmsAdapter(c.provider) !== null,
      lastRun: last
        ? {
            status: last.status,
            mode: last.mode,
            errorCode: last.error_code,
            startedAt: last.started_at,
            finishedAt: last.finished_at,
          }
        : null,
      coverage: success ? formatPmsCoverage(success.coverage_start, success.coverage_end, success.stay_count) : null,
      lastSuccessAt: success?.finished_at ?? null,
    }
  }

  return {
    data: {
      sync,
      connections: ((connectionsResult.data ?? []) as unknown as ConnRow[]).map((r) => ({
        id: r.id,
        provider: r.provider,
        providerLabel: pmsProviderLabel(r.provider, r.provider_name),
        label: r.label,
        status: r.status,
        tokenLast4: r.token_last4,
        expiresAt: r.expires_at,
        remindAt: r.remind_at,
        propertyCount: r.property_count,
        lastValidatedAt: r.last_validated_at,
        lastErrorCode: r.last_error_code,
        clientNote: r.client_note,
        submittedVia: r.submitted_via,
        reviewedBy: personName(r.reviewer),
        reviewedAt: r.reviewed_at,
        reviewNote: r.review_note,
        disconnectedAt: r.disconnected_at,
        createdAt: r.created_at,
      })),
      properties: ((propertiesResult.data ?? []) as unknown as PropRow[]).map((r) => ({
        id: r.id,
        connectionId: r.connection_id,
        externalPropertyId: r.external_property_id,
        name: r.name,
        airbnbId: r.airbnb_id,
        vrboId: r.vrbo_id,
        suggestedListingId: r.suggested_listing_id,
        suggestionReason: r.suggestion_reason,
        mappedListingId: r.mapped_listing_id,
        mappingStatus: r.mapping_status,
        confirmedBy: personName(r.confirmer),
        confirmedAt: r.confirmed_at,
      })),
      listings: (listingsResult.data ?? []) as { id: string; name: string; status: string }[],
      events: ((eventsResult.data ?? []) as unknown as EventRow[]).map((r) => ({
        id: r.id,
        connectionId: r.connection_id,
        eventType: r.event_type,
        fromStatus: r.from_status,
        toStatus: r.to_status,
        actor: personName(r.actor),
        viaPortal: !personName(r.actor) && Boolean(r.actor_assembly_client_id),
        createdAt: r.created_at,
      })),
      canManage,
      canMap: canManage && canEditListings,
    },
  }
}

export async function reviewPmsConnectionAction(input: {
  connectionId: string
  decision: "verified" | "rejected"
  note?: string | null
}): Promise<ActionResult> {
  if (!UUID.test(input.connectionId ?? "")) return { ok: false, error: "Invalid connection" }
  if (input.decision !== "verified" && input.decision !== "rejected") return { ok: false, error: "Invalid decision" }
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : ""
  if (!(await hasPermission("data_connections", "edit"))) {
    return { ok: false, error: "You don't have permission to manage data connections" }
  }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("pms_connection_review", {
    p_connection_id: input.connectionId,
    p_decision: input.decision,
    p_note: note || null,
  })
  if (error) return { ok: false, error: "Couldn't save the review" }
  if (data !== true) return { ok: false, error: "This connection can't be reviewed (it may be live-checked or disconnected)" }
  return { ok: true }
}

export async function disconnectPmsConnectionStaffAction(connectionId: string): Promise<ActionResult> {
  if (!UUID.test(connectionId ?? "")) return { ok: false, error: "Invalid connection" }
  if (!(await hasPermission("data_connections", "edit"))) {
    return { ok: false, error: "You don't have permission to manage data connections" }
  }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("pms_connection_disconnect_staff", { p_connection_id: connectionId })
  if (error) return { ok: false, error: "Couldn't disconnect" }
  if (data !== true) return { ok: false, error: "Already disconnected" }
  return { ok: true }
}

export async function recheckPmsConnectionAction(
  connectionId: string
): Promise<{ ok: true; propertyCount: number } | { ok: false; error: string }> {
  if (!UUID.test(connectionId ?? "")) return { ok: false, error: "Invalid connection" }
  // Admin client below (Vault read + provider call): RLS can't stop it, so
  // the permission check here is the gate.
  if (!(await hasPermission("data_connections", "edit"))) {
    return { ok: false, error: "You don't have permission to manage data connections" }
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in" }
  const result = await recheckHospitableConnection(connectionId, user.id)
  return result.ok ? result : { ok: false, error: result.error }
}

const NO_EDIT_PERMISSION = "You don't have permission to manage data connections"

/**
 * Staff add a client's PMS key from the Hub. The admin client (Vault write)
 * bypasses RLS, so the permission check here is the gate and fails closed.
 * Values are never logged, returned or kept after the call.
 */
export async function addPmsConnectionStaffAction(input: {
  clientId: string
  provider: string
  values: Record<string, string>
  label?: string | null
  expiresAt?: string | null
}): Promise<StaffCreateResult> {
  if (!input || typeof input !== "object" || !UUID.test(input.clientId ?? "")) {
    return { ok: false, error: "Invalid client" }
  }
  let allowed = false
  try {
    allowed = (await hasPermission("data_connections", "edit")) === true
  } catch {
    allowed = false
  }
  if (!allowed) return { ok: false, error: NO_EDIT_PERMISSION }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in" }

  const result = await createStaffConnection(
    input.clientId,
    user.id,
    {
      provider: input.provider,
      values: input.values,
      label: input.label ?? null,
      expiresAt: input.expiresAt ?? null,
    },
    {
      // Runs as the staff session: the function re-checks the permission and
      // stamps reviewed_by, so the history shows who verified it.
      markVerified: async (connectionId) => {
        const { data, error } = await supabase.rpc("pms_connection_review", {
          p_connection_id: connectionId,
          p_decision: "verified",
          p_note: "Added by staff in the Hub",
        })
        return !error && data === true
      },
    }
  )
  if (result.ok) revalidatePath(`/clients/${input.clientId}`)
  return result
}

export type MappingChange =
  | { mode: "confirm"; listingId: string }
  | { mode: "ignore" }
  | { mode: "reset" }

export async function updatePmsPropertyMappingAction(propertyId: string, change: MappingChange): Promise<ActionResult> {
  if (!UUID.test(propertyId ?? "")) return { ok: false, error: "Invalid property" }
  const [canManage, canEditListings] = await Promise.all([
    hasPermission("data_connections", "edit"),
    hasPermission("listings", "edit"),
  ])
  if (!canManage || !canEditListings) {
    return { ok: false, error: "Mapping needs data connections and listing edit permissions" }
  }

  const supabase = await createClient()
  const { data: property, error: readError } = await supabase
    .from("client_pms_properties")
    .select("id, suggested_listing_id")
    .eq("id", propertyId)
    .maybeSingle()
  if (readError || !property) return { ok: false, error: "Property not found" }

  let patch: Record<string, unknown>
  if (change.mode === "confirm") {
    if (!UUID.test(change.listingId ?? "")) return { ok: false, error: "Pick a listing" }
    patch = { mapping_status: "confirmed", mapped_listing_id: change.listingId }
  } else if (change.mode === "ignore") {
    patch = { mapping_status: "ignored", mapped_listing_id: null }
  } else {
    patch = {
      mapping_status: property.suggested_listing_id ? "suggested" : "unmatched",
      mapped_listing_id: null,
    }
  }

  const { error } = await supabase.from("client_pms_properties").update(patch).eq("id", propertyId)
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That listing is already mapped to another property" }
    if (/does not belong to client/i.test(error.message ?? "")) {
      return { ok: false, error: "That listing belongs to a different client" }
    }
    return { ok: false, error: "Couldn't save the mapping" }
  }
  return { ok: true }
}

/** Server Actions run inside the page's function; stay well under its limit. */
const SYNC_BUDGET_MS = 45_000

/**
 * "Sync bookings" on a connection card. Backfills (2024 → +18 months) until a
 * backfill has finished, then pulls the last 30 days of check-ins plus all
 * future ones; a run stopped by the time budget resumes on the next click (or
 * the daily cron). The admin client (Vault read + writes) bypasses RLS, so
 * data_connections:edit here is the gate and fails closed.
 */
export async function syncPmsBookingsAction(connectionId: string): Promise<
  | { ok: true; status: "succeeded" | "partial"; upserted: number; coverage: string | null }
  | { ok: false; error: string }
> {
  if (!UUID.test(connectionId ?? "")) return { ok: false, error: "Invalid connection" }
  let allowed = false
  try {
    allowed = (await hasPermission("data_connections", "edit")) === true
  } catch {
    allowed = false
  }
  if (!allowed) return { ok: false, error: NO_EDIT_PERMISSION }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in" }

  const result = await syncPmsConnection(connectionId, {
    mode: "auto",
    trigger: "manual",
    actorId: user.id,
    deadline: Date.now() + SYNC_BUDGET_MS,
  })
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, status: result.status, upserted: result.upserted, coverage: result.coverage }
}
