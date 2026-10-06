import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { ChurnClient, LeavingClient, ListingExit } from "@/lib/churn"
import { marketLabel } from "@/lib/churn"

// Page through every row so totals don't silently stop at PostgREST's row cap.
async function allRows<T>(
  query: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await query(from, from + 499)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < 500) return rows
  }
}
type ClientRow = Omit<ChurnClient, "markets"> & {
  listings: { city: string | null; state: string | null }[]
}
type ExitRow = Omit<ListingExit, "markets" | "client_name"> & {
  city: string | null
  state: string | null
  clients: { name: string; status: string }
}
type LeavingRow = {
  client_id: string
  subscription_id: string
  scheduled_end: string | null
  synced_at: string
}
type ActiveRow = {
  id: string
  name: string
  listings: { city: string | null; state: string | null }[]
}
function markets(listings: ActiveRow["listings"]) {
  return [
    ...new Set(listings.map((row) => marketLabel(row.city, row.state))),
  ].sort()
}

export async function getChurnData(
  supabase: SupabaseClient,
  isSuperAdmin: boolean
) {
  const [clients, exits, active, leaving] = await Promise.all([
    allRows<ClientRow>((from, to) =>
      supabase
        .from("clients")
        .select(
          `id, name, onboarding_date, ending_date, ending_reason_tags, ending_note${isSuperAdmin ? ", billing_amount" : ""}, listings(city, state)`
        )
        .eq("status", "inactive")
        .order("ending_date", { ascending: false, nullsFirst: false })
        .order("id")
        .range(from, to)
        .returns<ClientRow[]>()
    ),
    allRows<ExitRow>((from, to) =>
      supabase
        .from("listings")
        .select(
          "id, name, client_id, city, state, deactivated_date, exit_reason, exit_note, exit_handled_by, stripe_item_status, clients!inner(name, status)"
        )
        .eq("status", "inactive")
        .eq("clients.status", "active")
        .order("deactivated_date", { ascending: false, nullsFirst: false })
        .order("id")
        .range(from, to)
        .returns<ExitRow[]>()
    ),
    allRows<ActiveRow>((from, to) =>
      supabase
        .from("clients")
        .select("id, name, listings(city, state)")
        .eq("status", "active")
        .order("id")
        .range(from, to)
    ),
    allRows<LeavingRow>((from, to) =>
      supabase
        .rpc("churn_leaving_subscriptions")
        .order("client_id")
        .order("subscription_id")
        .range(from, to)
    ),
  ])
  const byClient = new Map<string, LeavingClient>()
  const activeById = new Map(active.map((row) => [row.id, row]))
  for (const row of leaving) {
    const client = activeById.get(row.client_id)
    if (!client) continue
    const entry = byClient.get(client.id) ?? {
      id: client.id,
      name: client.name,
      markets: markets(client.listings),
      cancellations: [],
    }
    entry.cancellations.push({
      subscription_id: row.subscription_id,
      scheduled_end: row.scheduled_end,
      synced_at: row.synced_at,
    })
    byClient.set(client.id, entry)
  }
  return {
    clients: clients.map(
      (row): ChurnClient => ({
        id: row.id,
        name: row.name,
        onboarding_date: row.onboarding_date,
        ending_date: row.ending_date,
        ending_reason_tags: row.ending_reason_tags ?? [],
        ending_note: row.ending_note,
        markets: markets(row.listings),
        ...(isSuperAdmin
          ? {
              billing_amount:
                row.billing_amount == null ? null : Number(row.billing_amount),
            }
          : {}),
      })
    ),
    exits: exits.map(
      (row): ListingExit => ({
        id: row.id,
        name: row.name,
        client_id: row.client_id,
        client_name: row.clients.name,
        markets: [marketLabel(row.city, row.state)],
        deactivated_date: row.deactivated_date,
        exit_reason: row.exit_reason,
        exit_note: row.exit_note,
        exit_handled_by: row.exit_handled_by,
        stripe_item_status: row.stripe_item_status,
      })
    ),
    leaving: [...byClient.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
  }
}
