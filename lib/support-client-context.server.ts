import "server-only"

// Extra reads for the client context panel on /support?client=<id>: the
// client's listings, its Adjustments, and its latest messages across every
// ticket (closed ones included). Runs with the signed-in session, so RLS
// applies. The panel is secondary to the queue, so a failed or forbidden
// read hides its section instead of failing the page.

import type { SupabaseClient } from "@supabase/supabase-js"

import { OPEN_STATUSES } from "@/lib/adjustments"
import type {
  SupportClientContext,
  SupportContextAdjustment,
  SupportContextListing,
  SupportContextMessage,
} from "@/lib/support-client-view"

const DAY_MS = 86_400_000

/** Controlled Adjustments stay in the panel this long. */
export const SUPPORT_CONTEXT_CONTROLLED_DAYS = 30
/** Upper bound per Adjustments list; a client rarely has more than a few. */
export const SUPPORT_CONTEXT_ADJUSTMENT_LIMIT = 50

/**
 * Adjustments still in flight: the open statuses plus `resolved`, which is
 * done but not yet controlled (a change ticket can't resolve until its
 * Adjustments are controlled).
 */
export const SUPPORT_CONTEXT_IN_FLIGHT_STATUSES: string[] = [...OPEN_STATUSES, "resolved"]

const ADJUSTMENT_COLUMNS = `
  id, type, status, origin, urgency, date_from, date_to, created_at, resolved_at, controlled_at,
  support_ticket_id, listings(name)
`

type Result<T> = { data: T[] | null; error: { message: string } | null }

function rowsOrNull<T>(result: Result<T>): T[] | null {
  return result.error ? null : ((result.data ?? []) as T[])
}

function latest(result: Result<{ id: string; ticket_number: number; at: string | null }>): SupportContextMessage {
  const row = result.error ? null : result.data?.[0]
  return row?.at ? { at: row.at, ticketId: row.id, ticketNumber: row.ticket_number } : null
}

/**
 * `access` mirrors the RLS on each table (listings: `listings:view` or
 * `adjustments:view`; adjustments: `adjustments:view`), so the page skips a
 * read it can't make instead of showing an empty section that looks real.
 */
export async function loadSupportClientContext(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
  access: { listings: boolean; adjustments: boolean }
): Promise<SupportClientContext> {
  const since = new Date(now.getTime() - SUPPORT_CONTEXT_CONTROLLED_DAYS * DAY_MS).toISOString()
  const skipped = Promise.resolve({ data: null, error: { message: "skipped" } })

  const lastMessage = (column: "last_client_message_at" | "last_team_message_at") =>
    supabase
      .from("support_tickets")
      .select(`id, ticket_number, at:${column}`)
      .eq("client_id", clientId)
      .not(column, "is", null)
      .order(column, { ascending: false })
      .limit(1)

  const [listings, inFlight, controlled, lastClient, lastTeam] = await Promise.all([
    access.listings
      ? supabase.from("listings").select("id, name, status").eq("client_id", clientId).order("name")
      : skipped,
    access.adjustments
      ? supabase
          .from("adjustments")
          .select(ADJUSTMENT_COLUMNS)
          .eq("client_id", clientId)
          .in("status", SUPPORT_CONTEXT_IN_FLIGHT_STATUSES)
          .order("created_at", { ascending: false })
          .limit(SUPPORT_CONTEXT_ADJUSTMENT_LIMIT)
      : skipped,
    access.adjustments
      ? supabase
          .from("adjustments")
          .select(ADJUSTMENT_COLUMNS)
          .eq("client_id", clientId)
          .eq("status", "controlled")
          .gte("controlled_at", since)
          .order("controlled_at", { ascending: false })
          .limit(SUPPORT_CONTEXT_ADJUSTMENT_LIMIT)
      : skipped,
    lastMessage("last_client_message_at"),
    lastMessage("last_team_message_at"),
  ])

  const inFlightRows = rowsOrNull(inFlight as Result<SupportContextAdjustment>)
  const controlledRows = rowsOrNull(controlled as Result<SupportContextAdjustment>)

  return {
    listings: rowsOrNull(listings as Result<SupportContextListing>),
    adjustments:
      inFlightRows && controlledRows ? { inFlight: inFlightRows, recentlyControlled: controlledRows } : null,
    lastClientMessage: latest(lastClient as Result<{ id: string; ticket_number: number; at: string | null }>),
    lastTeamMessage: latest(lastTeam as Result<{ id: string; ticket_number: number; at: string | null }>),
  }
}
