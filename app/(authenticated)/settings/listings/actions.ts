"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isPriceLabsConfigured } from "@/lib/pricelabs"
import { syncPriceLabsData } from "@/lib/pricelabs-sync"
import { isReportBuilderConfigured } from "@/lib/report-builder/client"
import { advanceReportBuilder } from "@/lib/report-builder/runner"
import { getProfile } from "@/lib/supabase/profile"
import { hasPermission } from "@/lib/permissions.server"
import type { ReportGroupOverride } from "@/lib/types"
import type { SeoMetricRow } from "@/lib/seo-metrics"

type ListingInput = {
  client_id: string
  name: string
  status: string
  listing_id: string | null
  pricelabs_link: string | null
  airbnb_link: string | null
  city: string | null
  state: string | null
}

export async function getClientOptionsAction(): Promise<
  { id: string; name: string }[]
> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("clients")
    .select("id, name")
    .order("name")
  return data ?? []
}

export async function createListingAction(input: ListingInput) {
  const supabase = await createClient()
  const { error } = await supabase.from("listings").insert(input)
  if (error) return { error: error.message }
  revalidatePath("/settings/listings")
  revalidatePath("/listings")
  revalidatePath("/clients")
  return { error: null }
}

export async function updateListingAction(id: string, input: ListingInput) {
  const supabase = await createClient()
  const { error } = await supabase.from("listings").update(input).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/settings/listings")
  revalidatePath("/listings")
  revalidatePath("/clients")
  return { error: null }
}

export async function deleteListingAction(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from("listings").delete().eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/settings/listings")
  revalidatePath("/listings")
  revalidatePath("/clients")
  return { error: null }
}

export async function updateListingStatusAction(
  id: string,
  status: "active" | "inactive"
) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("listings")
    .update({ status })
    .eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/settings/listings")
  revalidatePath("/listings")
  revalidatePath("/clients")
  return { error: null }
}

export async function syncPriceLabsAction() {
  if (!isPriceLabsConfigured()) {
    return {
      error: "PRICELABS_API_KEY not configured",
      synced: 0,
      notFound: 0,
      failed: 0,
      totalDb: 0,
      totalPriceLabs: 0,
      results: [],
    }
  }

  try {
    const result = await syncPriceLabsData(createAdminClient())

    revalidatePath("/settings/listings")
    revalidatePath("/listings")
    revalidatePath("/clients")
    revalidatePath("/dashboard")
    return { error: null, ...result }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Unknown error",
      synced: 0,
      notFound: 0,
      failed: 0,
      totalDb: 0,
      totalPriceLabs: 0,
      results: [],
    }
  }
}

// ─── Report Builder ──────────────────────────────────────

/**
 * Trigger / resume the Report Builder ingestion. Idempotent: starts a fresh run
 * or resumes an in-window polling run, so a human can close out a slow report.
 */
export async function syncReportBuilderAction() {
  if (!isReportBuilderConfigured()) {
    return { error: "PRICELABS_API_KEY not configured", status: "failed" as const }
  }

  const profile = await getProfile()

  try {
    const result = await advanceReportBuilder(createAdminClient(), {
      triggeredBy: "manual",
      userId: profile?.id ?? null,
    })

    revalidatePath("/settings/listings")
    revalidatePath("/listings")
    revalidatePath("/clients")
    revalidatePath("/dashboard")

    return {
      error: result.status === "failed" ? result.error ?? result.message : null,
      status: result.status,
      message: result.message,
      listingCount: result.listingCount ?? null,
      metricRowCount: result.metricRowCount ?? null,
      unresolvedCount: result.unresolvedCount ?? null,
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Unknown error",
      status: "failed" as const,
    }
  }
}

export async function listReportGroupOverridesAction(): Promise<
  (ReportGroupOverride & { client_name: string | null })[]
> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("report_group_overrides")
    .select("*, clients(name)")
    .order("group_name")
  return (data ?? []).map((row) => {
    const client = row.clients as { name: string } | { name: string }[] | null
    const client_name = Array.isArray(client) ? client[0]?.name ?? null : client?.name ?? null
    return {
      id: row.id as string,
      group_name: row.group_name as string,
      client_id: row.client_id as string,
      note: (row.note as string | null) ?? null,
      created_by: (row.created_by as string | null) ?? null,
      created_at: row.created_at as string,
      client_name,
    }
  })
}

export async function createReportGroupOverrideAction(input: {
  group_name: string
  client_id: string
  note: string | null
}) {
  if (!(await hasPermission("listings", "edit"))) {
    return { error: "Not authorized" }
  }
  const groupName = input.group_name.trim()
  if (!groupName || !input.client_id) {
    return { error: "Group name and client are required" }
  }

  const profile = await getProfile()
  const { error } = await createAdminClient()
    .from("report_group_overrides")
    .upsert(
      {
        group_name: groupName,
        client_id: input.client_id,
        note: input.note?.trim() || null,
        created_by: profile?.id ?? null,
      },
      { onConflict: "group_name" }
    )
  if (error) return { error: error.message }

  revalidatePath("/settings/listings")
  return { error: null }
}

export async function deleteReportGroupOverrideAction(id: string) {
  if (!(await hasPermission("listings", "edit"))) {
    return { error: "Not authorized" }
  }
  const { error } = await createAdminClient()
    .from("report_group_overrides")
    .delete()
    .eq("id", id)
  if (error) return { error: error.message }

  revalidatePath("/settings/listings")
  return { error: null }
}

// ─── SEO Metrics upload (Rankbreeze listing-metrics CSV) ──────────────────
//
// `seo_metrics` is a read-side VIEW; we write raw CSV rows to its base table
// `seo_metrics_raw` and the view derives metric slugs, side, and hub
// listing/client ids on read.

/**
 * Clear any existing `seo_metrics_raw` rows for the given download date(s) so a
 * re-upload of the same snapshot replaces rather than duplicates. Called once
 * before streaming chunks.
 */
export async function clearSeoMetricsForDatesAction(downloadDates: string[]) {
  if (!(await hasPermission("listings", "edit"))) {
    return { error: "Not authorized" }
  }
  if (downloadDates.length === 0) return { error: null }

  const { error } = await createAdminClient()
    .from("seo_metrics_raw")
    .delete()
    .in("download_date", downloadDates)
  if (error) return { error: error.message }
  return { error: null }
}

/**
 * Insert one chunk of parsed SEO metric rows verbatim into `seo_metrics_raw`.
 */
export async function insertSeoMetricsChunkAction(rows: SeoMetricRow[]) {
  if (!(await hasPermission("listings", "edit"))) {
    return { error: "Not authorized", inserted: 0 }
  }
  if (rows.length === 0) return { error: null, inserted: 0 }

  const { error } = await createAdminClient()
    .from("seo_metrics_raw")
    .insert(rows)
  if (error) return { error: error.message, inserted: 0 }

  return { error: null, inserted: rows.length }
}
