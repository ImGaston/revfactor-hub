import "server-only"

import { readFile } from "node:fs/promises"

import type { SupabaseClient } from "@supabase/supabase-js"

import { PREVIEW_LISTING_SETUP } from "@/lib/listing-settings-fixture"
import type {
  ListingChangeSetRow,
  ListingSettingChangeRow,
  ListingSettingRow,
  ListingSetup,
} from "@/lib/listing-settings"

// Explicit projections (no select("*")) so a later column never leaks by accident.
const SETTING_COLUMNS =
  "id, setting_key, channel, date_from, date_to, value, system, status, last_change_id, updated_at"
const CHANGE_COLUMNS =
  "id, change_set_id, setting_key, channel, date_from, date_to, action, old_value, new_value, system, reason, evidence, adjustment_id, actor_type, approved_by_label, occurred_at"
const CHANGE_SET_COLUMNS =
  "id, title, status, plan_ref, approved_by_label, approved_at, notes, created_at"

/** PostgREST / Postgres codes for "the table isn't there yet". */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01"
}

/**
 * Read-only setup for one listing, through the session client (RLS:
 * listings:view). Before the migration is applied this returns
 * { available: false, reason: "not_migrated" } instead of throwing.
 */
export async function getListingSetup(
  supabase: SupabaseClient,
  listingId: string
): Promise<ListingSetup> {
  const [settings, changes, changeSets] = await Promise.all([
    supabase.from("listing_settings").select(SETTING_COLUMNS).eq("listing_id", listingId),
    supabase
      .from("listing_setting_changes")
      .select(CHANGE_COLUMNS)
      .eq("listing_id", listingId)
      .order("occurred_at", { ascending: false })
      .limit(500),
    supabase
      .from("listing_setting_change_sets")
      .select(CHANGE_SET_COLUMNS)
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false }),
  ])

  const errors = [settings.error, changes.error, changeSets.error].filter(Boolean)
  if (errors.some((e) => isMissingTable(e))) {
    return { available: false, reason: "not_migrated" }
  }
  if (errors.length > 0) {
    console.error("listing setup: read failed", errors[0])
    return { available: false, reason: "error" }
  }

  return {
    available: true,
    settings: (settings.data ?? []) as ListingSettingRow[],
    changes: (changes.data ?? []) as ListingSettingChangeRow[],
    changeSets: (changeSets.data ?? []) as ListingChangeSetRow[],
  }
}

/**
 * Local preview for ?setupPreview=1 (never in production). LISTING_SETUP_PREVIEW_JSON
 * may point to a local JSON file (e.g. a real listing's backfill) so it can be
 * checked before the migration and backfill are applied. Client data stays in
 * that file; it is never committed or written to the database.
 */
export async function loadListingSetupPreview(): Promise<ListingSetup> {
  const path = process.env.LISTING_SETUP_PREVIEW_JSON
  if (process.env.NODE_ENV === "production" || !path) return PREVIEW_LISTING_SETUP
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as {
      settings?: ListingSettingRow[]
      changes?: ListingSettingChangeRow[]
      changeSets?: ListingChangeSetRow[]
    }
    return {
      available: true,
      settings: raw.settings ?? [],
      changes: raw.changes ?? [],
      changeSets: raw.changeSets ?? [],
    }
  } catch (error) {
    console.warn("listing setup preview: unreadable LISTING_SETUP_PREVIEW_JSON", error)
    return PREVIEW_LISTING_SETUP
  }
}
