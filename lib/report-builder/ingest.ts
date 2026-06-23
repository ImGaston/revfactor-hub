// Report Builder ingestion: parse the envelope (20 listing / 35 month split),
// rename to snake_case, resolve each listing to a hub client, and upsert
// idempotently into report_listings + report_metrics. Errors are accumulated,
// not thrown per-row, so a partial payload still lands what it can.

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getReportCurrency,
  getReportData,
  type ReportEnvelope,
} from "@/lib/report-builder/client"
import {
  METRIC_FIELD_MAP,
  parseListing,
  parseMetrics,
  parsePeriod,
  type MetricColumn,
  type ParsedListing,
} from "@/lib/report-builder/schema"

const UPSERT_CHUNK = 500
const RAW_ENVELOPE_KEEP = 30 // keep raw_envelope for the last N completed runs

export type IngestResult = {
  listingCount: number
  metricRowCount: number
  unresolvedCount: number
  skippedRows: number
  reportCurrency: string | null
  errors: string[]
}

type HubListing = { id: string; client_id: string | null }

async function buildResolutionMaps(supabase: SupabaseClient) {
  const [listingsRes, overridesRes, clientsRes] = await Promise.all([
    supabase.from("listings").select("id, listing_id, client_id").not("listing_id", "is", null),
    supabase.from("report_group_overrides").select("group_name, client_id"),
    supabase.from("clients").select("id, name"),
  ])

  const byPriceLabsId = new Map<string, HubListing>()
  for (const l of listingsRes.data ?? []) {
    const key = (l.listing_id as string | null)?.trim()
    if (key && !byPriceLabsId.has(key)) {
      byPriceLabsId.set(key, { id: l.id as string, client_id: l.client_id as string | null })
    }
  }

  const overrideByGroup = new Map<string, string>()
  for (const o of overridesRes.data ?? []) {
    const key = (o.group_name as string | null)?.trim().toLowerCase()
    if (key) overrideByGroup.set(key, o.client_id as string)
  }

  const clientByName = new Map<string, string>()
  for (const c of clientsRes.data ?? []) {
    const key = (c.name as string | null)?.trim().toLowerCase()
    if (key && !clientByName.has(key)) clientByName.set(key, c.id as string)
  }

  return { byPriceLabsId, overrideByGroup, clientByName }
}

/**
 * Resolve hub linkage for one listing:
 *   1. hard key — match Listing ID against listings.listing_id
 *   2. fallback — Group Name via override table, then exact client name match
 */
function resolveLinkage(
  listing: ParsedListing,
  maps: Awaited<ReturnType<typeof buildResolutionMaps>>
): { hub_listing_id: string | null; hub_client_id: string | null } {
  const hub = maps.byPriceLabsId.get(listing.listing_id.trim())
  if (hub) return { hub_listing_id: hub.id, hub_client_id: hub.client_id }

  const group = listing.group_name?.trim().toLowerCase()
  if (group) {
    const overrideClient = maps.overrideByGroup.get(group)
    if (overrideClient) return { hub_listing_id: null, hub_client_id: overrideClient }
    const nameClient = maps.clientByName.get(group)
    if (nameClient) return { hub_listing_id: null, hub_client_id: nameClient }
  }

  return { hub_listing_id: null, hub_client_id: null }
}

async function chunkedUpsert(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  errors: string[]
) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK)
    const { error } = await supabase.from(table).upsert(chunk, { onConflict })
    if (error) errors.push(`${table} upsert [${i}-${i + chunk.length}]: ${error.message}`)
  }
}

/**
 * Ingest a completed envelope for `runId`. Upserts listings + metrics, then
 * stamps report_runs with counts/currency/completed and prunes old envelopes.
 */
export async function ingestReport(
  supabase: SupabaseClient,
  runId: string,
  envelope: ReportEnvelope,
  payloadBytes: number | null
): Promise<IngestResult> {
  const rows = getReportData(envelope)
  if (!rows || rows.length === 0) {
    throw new Error("Report envelope has no report_data rows")
  }
  const reportCurrency = getReportCurrency(envelope)
  const errors: string[] = []

  const maps = await buildResolutionMaps(supabase)

  // First occurrence of each listing carries its (constant) attributes.
  const listingRows = new Map<string, Record<string, unknown>>()
  const metricRows: Record<string, unknown>[] = []
  let unresolvedCount = 0
  let skippedRows = 0

  for (const row of rows) {
    const listing = parseListing(row)
    if (!listing) {
      skippedRows++
      continue
    }

    if (!listingRows.has(listing.listing_id)) {
      const linkage = resolveLinkage(listing, maps)
      if (!linkage.hub_client_id) unresolvedCount++
      listingRows.set(listing.listing_id, {
        ...listing,
        ...linkage,
        report_run_id: runId,
        updated_at: new Date().toISOString(),
      })
    }

    const period = parsePeriod(row["Year Month"])
    if (!period) {
      skippedRows++
      continue
    }
    const metrics = parseMetrics(row)
    metricRows.push({
      report_run_id: runId,
      listing_id: listing.listing_id,
      period,
      period_label: typeof row["Year Month"] === "string" ? row["Year Month"] : null,
      ...metrics,
    })
  }

  // report_listings must land before report_metrics (FK on listing_id).
  await chunkedUpsert(
    supabase,
    "report_listings",
    Array.from(listingRows.values()),
    "listing_id",
    errors
  )
  await chunkedUpsert(
    supabase,
    "report_metrics",
    metricRows,
    "listing_id,period,report_run_id",
    errors
  )

  const completedAt = new Date().toISOString()
  const { error: runError } = await supabase
    .from("report_runs")
    .update({
      status: "completed",
      completed_at: completedAt,
      listing_count: listingRows.size,
      metric_row_count: metricRows.length,
      unresolved_count: unresolvedCount,
      payload_bytes: payloadBytes,
      report_currency: reportCurrency,
      raw_envelope: envelope,
      error_reason: errors.length > 0 ? errors.join("; ") : null,
    })
    .eq("id", runId)
  if (runError) errors.push(`report_runs update: ${runError.message}`)

  await pruneRawEnvelopes(supabase, errors)

  return {
    listingCount: listingRows.size,
    metricRowCount: metricRows.length,
    unresolvedCount,
    skippedRows,
    reportCurrency,
    errors,
  }
}

/** Keep raw_envelope only for the most recent N completed runs. */
async function pruneRawEnvelopes(supabase: SupabaseClient, errors: string[]) {
  const { data, error } = await supabase
    .from("report_runs")
    .select("id")
    .eq("status", "completed")
    .not("raw_envelope", "is", null)
    .order("completed_at", { ascending: false })
    .range(RAW_ENVELOPE_KEEP, RAW_ENVELOPE_KEEP + 999)
  if (error) {
    errors.push(`prune select: ${error.message}`)
    return
  }
  const stale = (data ?? []).map((r) => r.id as string)
  if (stale.length === 0) return
  const { error: clearError } = await supabase
    .from("report_runs")
    .update({ raw_envelope: null })
    .in("id", stale)
  if (clearError) errors.push(`prune clear: ${clearError.message}`)
}

// Re-export so callers don't reach into schema for the column list.
export { METRIC_FIELD_MAP }
export type { MetricColumn }
