"use server"

// Lazy data for the client page tabs (Onboarding, Customer Journey, Client
// Profile, Support Tickets, Adjustment Requests). Each tab calls its loader when it is
// first opened, so the Legacy tab — the default — costs nothing extra.
// Everything runs on the session client: RLS is the backstop and the
// permission checks here decide what to even ask for.

import { createClient } from "@/lib/supabase/server"
import type { AdjustmentOrigin, AdjustmentStatus } from "@/lib/types"
import { hasPermission } from "@/lib/permissions.server"
import { detectCredential, SUPPORT_ACTIVE_STATUSES } from "@/lib/support-tickets"
import {
  computeClientJourney,
  isJourneyStatus,
  isJourneyStepKey,
  type ClientJourney,
  type JourneyClientInput,
  type JourneyDecisionEventInput,
  type JourneyItemInput,
  type JourneyListingInput,
  type JourneyPricingPlanInput,
  type JourneyReportInput,
  type JourneySetupAdjustmentInput,
} from "@/lib/client-journey"
import {
  buildOnboardingView,
  validateOnboardingSave,
  type GhlOnboardingInput,
  type OnboardingEventInput,
  type OnboardingListingInput,
  type OnboardingRowInput,
  type OnboardingSaveInput,
  type OnboardingView,
} from "@/lib/client-onboarding"
import {
  validateClientProfile,
  type ClientProfileRecord,
  type ClientProfileValues,
} from "@/lib/client-profile"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MIGRATION_PENDING = "This needs the client tabs migration (20261014120000), which isn't applied yet"

type PgError = { code?: string; message?: string } | null

/** Tables from another branch or an unapplied migration: degrade, don't break. */
function isMissingRelation(error: PgError): boolean {
  if (!error) return false
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /does not exist|could not find the table/i.test(error.message ?? "")
  )
}

type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: string }

type Person = { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null

function personName(p: Person): string | null {
  const who = Array.isArray(p) ? p[0] : p
  return who?.full_name ?? who?.email ?? null
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

const ONBOARDING_MIGRATION_PENDING =
  "This needs the onboarding migration (20261018120000), which isn't applied yet"

export type ClientOnboardingData = {
  view: OnboardingView
  /** Raw intake answers, exactly as GHL submitted them. */
  intake: GhlOnboardingInput
  ghlSyncedAt: string | null
  ghlSyncError: boolean
  events: OnboardingEventInput[]
  /** False until migration 20261018120000 is applied: read-only prefill. */
  itemsAvailable: boolean
  canEdit: boolean
}

export async function loadClientOnboardingAction(clientId: string): Promise<Result<ClientOnboardingData>> {
  if (!UUID.test(clientId)) return { error: "Invalid client" }
  const [canView, canEdit] = await Promise.all([
    hasPermission("clients", "view"),
    hasPermission("clients", "edit"),
  ])
  if (!canView) return { error: "You don't have access to clients" }

  const supabase = await createClient()
  const [clientResult, itemsResult, eventsResult] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "pms_name, has_vrbo, ghl_onboarding, ghl_synced_at, ghl_sync_error, listings(id, name, status, airbnb_link, listing_id, pricelabs_link, pl_synced_at)"
      )
      .eq("id", clientId)
      .single(),
    supabase
      .from("client_onboarding_items")
      .select(
        "listing_id, item_key, status, value, note, completed_at, updated_at, completer:profiles!client_onboarding_items_completed_by_fkey(full_name, email), updater:profiles!client_onboarding_items_updated_by_fkey(full_name, email)"
      )
      .eq("client_id", clientId),
    supabase
      .from("client_onboarding_item_events")
      .select(
        "listing_id, item_key, from_status, to_status, from_value, to_value, note, created_at, actor:profiles!client_onboarding_item_events_actor_id_fkey(full_name, email)"
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(30),
  ])
  if (clientResult.error || !clientResult.data) return { error: "Client not found" }

  const client = clientResult.data as unknown as {
    pms_name: string | null
    has_vrbo: boolean | null
    ghl_onboarding: GhlOnboardingInput
    ghl_synced_at: string | null
    ghl_sync_error: string | null
    listings: (OnboardingListingInput & { status: string })[] | null
  }
  const itemsAvailable = !isMissingRelation(itemsResult.error)
  if (itemsResult.error && itemsAvailable) return { error: "Couldn't load the onboarding checklist" }

  const rows: OnboardingRowInput[] = itemsResult.error
    ? []
    : (
        (itemsResult.data ?? []) as unknown as (Omit<OnboardingRowInput, "completed_by_name" | "updated_by_name"> & {
          completer: Person
          updater: Person
        })[]
      ).map(({ completer, updater, ...row }) => ({
        ...row,
        completed_by_name: personName(completer),
        updated_by_name: personName(updater),
      }))

  const events: OnboardingEventInput[] = eventsResult.error
    ? []
    : ((eventsResult.data ?? []) as unknown as (Omit<OnboardingEventInput, "actor_name"> & { actor: Person })[]).map(
        ({ actor, ...e }) => ({ ...e, actor_name: personName(actor) })
      )

  // Inactive listings aren't being onboarded; keep the order stable by name.
  const listings = (client.listings ?? [])
    .filter((l) => l.status !== "inactive")
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    data: {
      view: buildOnboardingView({ client, listings, rows }),
      intake: client.ghl_onboarding,
      ghlSyncedAt: client.ghl_synced_at,
      ghlSyncError: !!client.ghl_sync_error,
      events,
      itemsAvailable,
      canEdit,
    },
  }
}

export async function saveOnboardingItemAction(
  clientId: string,
  input: OnboardingSaveInput
): Promise<{ error?: string }> {
  if (!UUID.test(clientId)) return { error: "Invalid client" }
  if (input.listingId != null && !UUID.test(input.listingId)) return { error: "Invalid listing" }
  if (!(await hasPermission("clients", "edit"))) return { error: "You don't have permission to edit clients" }
  const parsed = validateOnboardingSave(input)
  if ("error" in parsed) return { error: parsed.error }
  const values = parsed.values

  const supabase = await createClient()
  // The partial unique indexes can't be an upsert target through PostgREST,
  // so find the row first. The indexes still reject a racing duplicate.
  let existing = supabase
    .from("client_onboarding_items")
    .select("id")
    .eq("client_id", clientId)
    .eq("item_key", values.item_key)
  existing = values.listing_id ? existing.eq("listing_id", values.listing_id) : existing.is("listing_id", null)
  const { data: found, error: findError } = await existing.maybeSingle()
  if (findError) {
    return { error: isMissingRelation(findError) ? ONBOARDING_MIGRATION_PENDING : "Couldn't save the item" }
  }

  const { error } = found
    ? await supabase
        .from("client_onboarding_items")
        .update({ status: values.status, value: values.value, note: values.note })
        .eq("id", (found as { id: string }).id)
    : await supabase.from("client_onboarding_items").insert({ client_id: clientId, ...values })
  if (error) {
    if (isMissingRelation(error)) return { error: ONBOARDING_MIGRATION_PENDING }
    if (/does not belong to client/i.test(error.message ?? "")) return { error: "That listing isn't this client's" }
    return { error: "Couldn't save the item" }
  }
  return {}
}

// ---------------------------------------------------------------------------
// Customer Journey
// ---------------------------------------------------------------------------

export type ClientJourneyData = {
  journey: ClientJourney
  overridesAvailable: boolean
  canEdit: boolean
}

export async function loadClientJourneyAction(clientId: string): Promise<Result<ClientJourneyData>> {
  if (!UUID.test(clientId)) return { error: "Invalid client" }
  const [canView, canEdit, canViewListings, canViewAdjustments, canViewSupport] = await Promise.all([
    hasPermission("clients", "view"),
    hasPermission("clients", "edit"),
    hasPermission("listings", "view"),
    hasPermission("adjustments", "view"),
    hasPermission("support", "view"),
  ])
  if (!canView) return { error: "You don't have access to clients" }

  const supabase = await createClient()

  const [clientResult, reportsResult, setupResult, ticketsResult, overridesResult] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "onboarding_date, ending_date, status, assembly_client_id, pms_name, ghl_onboarding, listings(id, status, listing_id, pl_synced_at)"
      )
      .eq("id", clientId)
      .single(),
    canViewListings
      ? supabase
          .from("listing_optimization_reports")
          .select(
            "id, listing_id, status, published_at, owner_message_sent_at, listing_optimization_items(report_id, kind, client_status, apply_status)"
          )
          .eq("client_id", clientId)
      : Promise.resolve(null),
    canViewAdjustments
      ? supabase
          .from("adjustments")
          .select("status, created_at, resolved_at, controlled_at")
          .eq("client_id", clientId)
          .eq("type", "setup")
      : Promise.resolve(null),
    canViewSupport
      ? supabase
          .from("support_tickets")
          .select("id", { count: "exact", head: true })
          .eq("client_id", clientId)
          .in("status", SUPPORT_ACTIVE_STATUSES)
      : Promise.resolve(null),
    supabase
      .from("client_journey_steps")
      .select("step_key, status, done_at, note, updated_at")
      .eq("client_id", clientId),
  ])

  if (clientResult.error || !clientResult.data) return { error: "Client not found" }
  const clientRow = clientResult.data as unknown as JourneyClientInput & {
    listings: JourneyListingInput[] | null
  }
  const listings = clientRow.listings ?? []

  let reports: JourneyReportInput[] | null = null
  let items: JourneyItemInput[] | null = null
  let decisionEvents: JourneyDecisionEventInput[] | null = null
  if (reportsResult && !reportsResult.error) {
    const rows = (reportsResult.data ?? []) as unknown as (JourneyReportInput & {
      listing_optimization_items: JourneyItemInput[] | null
    })[]
    reports = rows.map((r) => ({
      id: r.id,
      listing_id: r.listing_id,
      status: r.status,
      published_at: r.published_at,
      owner_message_sent_at: r.owner_message_sent_at,
    }))
    items = rows.flatMap((r) => r.listing_optimization_items ?? [])
    decisionEvents = []
    if (rows.length > 0) {
      const { data: events, error } = await supabase
        .from("listing_optimization_events")
        .select("report_id, created_at")
        .eq("action", "DecideSuggestion")
        .in(
          "report_id",
          rows.map((r) => r.id)
        )
      decisionEvents = error ? null : ((events ?? []) as JourneyDecisionEventInput[])
    }
  }

  // listing_pricing_plans ships on another branch; until then the step is todo.
  let pricingPlans: JourneyPricingPlanInput[] | null = null
  const listingIds = listings.map((l) => l.id)
  if (canViewListings && listingIds.length > 0) {
    const { data, error } = await supabase
      .from("listing_pricing_plans")
      .select("listing_id, status, approved_at")
      .in("listing_id", listingIds)
    pricingPlans = error ? null : ((data ?? []) as JourneyPricingPlanInput[])
  }

  const overridesAvailable = !isMissingRelation(overridesResult.error)
  const journey = computeClientJourney({
    now: new Date(),
    client: clientRow,
    listings,
    reports,
    items,
    decisionEvents,
    setupAdjustments:
      setupResult && !setupResult.error ? ((setupResult.data ?? []) as JourneySetupAdjustmentInput[]) : null,
    pricingPlans,
    openTickets: ticketsResult && !ticketsResult.error ? (ticketsResult.count ?? 0) : null,
    overrides: overridesResult.error ? [] : (overridesResult.data ?? []),
  })

  return { data: { journey, overridesAvailable, canEdit } }
}

export async function saveJourneyStepAction(input: {
  clientId: string
  stepKey: string
  /** null = reset to automatic (deletes the override row). */
  status: string | null
  doneAt: string | null
  note: string | null
}): Promise<{ error?: string }> {
  if (!UUID.test(input.clientId)) return { error: "Invalid client" }
  if (!isJourneyStepKey(input.stepKey)) return { error: "Unknown step" }
  if (!(await hasPermission("clients", "edit"))) return { error: "You don't have permission to edit clients" }

  const supabase = await createClient()

  if (input.status == null) {
    const { error } = await supabase
      .from("client_journey_steps")
      .delete()
      .eq("client_id", input.clientId)
      .eq("step_key", input.stepKey)
    if (error) return { error: isMissingRelation(error) ? MIGRATION_PENDING : "Couldn't reset the step" }
    return {}
  }

  if (!isJourneyStatus(input.status)) return { error: "Pick a status" }
  const doneAt = input.doneAt?.trim() || null
  if (doneAt && !DATE.test(doneAt)) return { error: "Use a valid date" }
  const note = input.note?.trim() || null
  if (note && note.length > 1000) return { error: "Keep the note under 1,000 characters" }
  const credential = detectCredential(note)
  if (credential) return { error: `Remove the ${credential} from the note` }

  const { error } = await supabase.from("client_journey_steps").upsert(
    {
      client_id: input.clientId,
      step_key: input.stepKey,
      status: input.status,
      done_at: doneAt,
      note,
    },
    { onConflict: "client_id,step_key" }
  )
  if (error) return { error: isMissingRelation(error) ? MIGRATION_PENDING : "Couldn't save the step" }
  return {}
}

// ---------------------------------------------------------------------------
// Client Profile
// ---------------------------------------------------------------------------

export type OwnerQuestion = {
  id: string
  listing_id: string
  listing_name: string
  question: string
}

export type ClientProfileData = {
  profile: ClientProfileRecord | null
  profileAvailable: boolean
  canEdit: boolean
  glance: {
    activeListings: number
    totalListings: number
    channels: string[]
    pms: string | null
    onboardingDate: string | null
  }
  /** null = listing_plan_questions isn't in this database yet. */
  questions: OwnerQuestion[] | null
}

export async function loadClientProfileAction(clientId: string): Promise<Result<ClientProfileData>> {
  if (!UUID.test(clientId)) return { error: "Invalid client" }
  const [canView, canEdit] = await Promise.all([
    hasPermission("clients", "view"),
    hasPermission("clients", "edit"),
  ])
  if (!canView) return { error: "You don't have access to clients" }

  const supabase = await createClient()
  const [clientResult, profileResult] = await Promise.all([
    supabase
      .from("clients")
      .select("onboarding_date, pms_name, has_vrbo, ghl_onboarding, listings(id, name, status, airbnb_link)")
      .eq("id", clientId)
      .single(),
    supabase
      .from("client_profiles")
      .select(
        "experience_level, background, goals, pricing_preferences, communication, timezone, decision_style, guest_mix, updated_at, profiles(full_name, email)"
      )
      .eq("client_id", clientId)
      .maybeSingle(),
  ])
  if (clientResult.error || !clientResult.data) return { error: "Client not found" }

  const client = clientResult.data as unknown as {
    onboarding_date: string | null
    pms_name: string | null
    has_vrbo: boolean
    ghl_onboarding: { vrbo?: string | null } | null
    listings: { id: string; name: string; status: string; airbnb_link: string | null }[] | null
  }
  const listings = client.listings ?? []
  const active = listings.filter((l) => l.status !== "inactive")

  const channels: string[] = []
  if (active.some((l) => l.airbnb_link)) channels.push("Airbnb")
  const vrbo = client.ghl_onboarding?.vrbo ? client.ghl_onboarding.vrbo === "Yes" : client.has_vrbo
  if (vrbo) channels.push("Vrbo")

  let profile: ClientProfileRecord | null = null
  if (!profileResult.error && profileResult.data) {
    const { profiles: author, updated_at, ...values } = profileResult.data as unknown as ClientProfileValues & {
      updated_at: string | null
      profiles: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null
    }
    const who = Array.isArray(author) ? author[0] : author
    profile = { ...values, updated_at, updated_by_name: who?.full_name ?? who?.email ?? null }
  }

  // listing_plan_questions ships on another branch; until then show nothing.
  let questions: OwnerQuestion[] | null = null
  if (active.length > 0) {
    const { data, error } = await supabase
      .from("listing_plan_questions")
      .select("id, listing_id, question, who, answer")
      .in(
        "listing_id",
        active.map((l) => l.id)
      )
      .eq("who", "owner")
    if (!error) {
      const names = new Map(listings.map((l) => [l.id, l.name]))
      questions = ((data ?? []) as { id: string; listing_id: string; question: string; answer: string | null }[])
        .filter((q) => !q.answer?.trim())
        .map((q) => ({
          id: q.id,
          listing_id: q.listing_id,
          listing_name: names.get(q.listing_id) ?? "Listing",
          question: q.question,
        }))
    }
  } else {
    questions = []
  }

  return {
    data: {
      profile,
      profileAvailable: !isMissingRelation(profileResult.error),
      canEdit,
      glance: {
        activeListings: active.length,
        totalListings: listings.length,
        channels,
        pms: client.pms_name,
        onboardingDate: client.onboarding_date,
      },
      questions,
    },
  }
}

export async function saveClientProfileAction(
  clientId: string,
  raw: Record<string, unknown>
): Promise<{ error?: string }> {
  if (!UUID.test(clientId)) return { error: "Invalid client" }
  if (!(await hasPermission("clients", "edit"))) return { error: "You don't have permission to edit clients" }
  const parsed = validateClientProfile(raw)
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase
    .from("client_profiles")
    .upsert({ client_id: clientId, ...parsed.values }, { onConflict: "client_id" })
  if (error) return { error: isMissingRelation(error) ? MIGRATION_PENDING : "Couldn't save the profile" }
  return {}
}

// ---------------------------------------------------------------------------
// Support Tickets
// ---------------------------------------------------------------------------

/** Explicit projection: never `client_message`, the raw owner text. */
export type ClientTicketRow = {
  id: string
  ticket_number: number
  summary: string
  category: string
  priority: string
  status: string
  requested_at: string
  first_response_at: string | null
  merged_into: string | null
}

export async function loadClientTicketsAction(clientId: string): Promise<Result<ClientTicketRow[]>> {
  if (!UUID.test(clientId)) return { error: "Invalid client" }
  if (!(await hasPermission("support", "view"))) return { error: "You don't have access to support tickets" }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("support_tickets")
    .select("id, ticket_number, summary, category, priority, status, requested_at, first_response_at, merged_into")
    .eq("client_id", clientId)
    .order("requested_at", { ascending: false })
    .limit(500)
  if (error) return { error: "Couldn't load support tickets" }
  return { data: (data ?? []) as ClientTicketRow[] }
}

// ---------------------------------------------------------------------------
// Adjustment Requests
// ---------------------------------------------------------------------------

export type ClientAdjustmentRow = {
  id: string
  public_token: string
  scope: string
  type: string
  target_value: string | null
  date_from: string | null
  date_to: string | null
  origin: AdjustmentOrigin
  status: AdjustmentStatus
  created_at: string
  resolved_at: string | null
  controlled_at: string | null
  listings: { name: string } | null
}

export async function loadClientAdjustmentsAction(clientId: string): Promise<Result<ClientAdjustmentRow[]>> {
  if (!UUID.test(clientId)) return { error: "Invalid client" }
  if (!(await hasPermission("adjustments", "view"))) return { error: "You don't have access to adjustments" }
  const supabase = await createClient()
  // Client names come through clients_basic (conventions); this tab only needs
  // the listing name, which the listings embed provides.
  const { data, error } = await supabase
    .from("adjustments")
    .select(
      "id, public_token, scope, type, target_value, date_from, date_to, origin, status, created_at, resolved_at, controlled_at, listings(name), clients:clients_basic(name)"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(500)
  if (error) return { error: "Couldn't load adjustments" }
  return { data: (data ?? []) as unknown as ClientAdjustmentRow[] }
}
