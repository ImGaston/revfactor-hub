import { createClient } from "@supabase/supabase-js"

import {
  buildAirbnbFoundationInventoryRow,
  sortAirbnbFoundationInventory,
  type AirbnbCancellationPolicy,
} from "@/lib/airbnb-cancellation-foundation"

type RawListing = {
  id: string
  name: string
  status: string
  client_id: string | null
  airbnb_id: string | null
  airbnb_link: string | null
  listing_id: string | null
  default_cancellation_policy: AirbnbCancellationPolicy | null
  timezone: string | null
  clients: { name: string } | { name: string }[] | null
}

function field(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value)
  return text.replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ")
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"
    )
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await supabase
    .from("listings")
    .select(
      "id, name, status, client_id, airbnb_id, airbnb_link, listing_id, default_cancellation_policy, timezone, clients:clients_basic(name)"
    )
    .eq("status", "active")
    .order("id")

  if (error) throw new Error(`Failed to read active listings: ${error.message}`)

  const rows = sortAirbnbFoundationInventory(
    ((data ?? []) as RawListing[]).map((listing) => {
      const client = Array.isArray(listing.clients)
        ? (listing.clients[0] ?? null)
        : listing.clients
      return buildAirbnbFoundationInventoryRow({
        ...listing,
        client_name: client?.name ?? null,
      })
    })
  )

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
    return
  }

  const headers = [
    "listing_uuid",
    "listing_name",
    "account_classification",
    "client_identity",
    "airbnb_id",
    "airbnb_link",
    "listing_id",
    "default_cancellation_policy",
    "timezone",
    "missing_or_blocked_reason",
  ]
  process.stdout.write(`${headers.join("\t")}\n`)
  for (const row of rows) {
    process.stdout.write(
      `${[
        row.id,
        row.name,
        row.account_classification,
        row.client_name,
        row.airbnb_id,
        row.airbnb_link,
        row.listing_id,
        row.default_cancellation_policy,
        row.timezone,
        row.missing_or_blocked_reason,
      ]
        .map(field)
        .join("\t")}\n`
    )
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
