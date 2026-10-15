import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  PRICELABS_CHECKED_KEYS,
  type ListingSettingRow,
} from "@/lib/listing-settings"
import {
  checkSetting,
  leadWindowDays,
  nextTransition,
  type CheckVerdict,
  type PriceLabsOverrideDay,
} from "@/lib/listing-setup-check"
import { writeSettingChanges, type SettingChangeWrite } from "@/lib/listing-settings-writes.server"
import {
  fetchPriceLabsListings,
  fetchPriceLabsOverrides,
  isPriceLabsConfigured,
  parseNullableNumber,
  type PriceLabsListing,
} from "@/lib/pricelabs"

export type SetupCheckResult = {
  listings: number
  checked: number
  verified: number
  drifted: number
  unchanged: number
  skipped: number
  errors: string[]
  dryRun: boolean
  details: {
    listingId: string
    settingId: string
    key: string
    range: string | null
    status: string
    verdict: CheckVerdict["kind"]
    detail: string
    recorded: string | null
  }[]
}

const SETTING_COLUMNS =
  "id, listing_id, setting_key, channel, date_from, date_to, value, system, status, last_change_id, updated_at"

const todayUtc = () => new Date().toISOString().slice(0, 10)

/**
 * Compares the decided PriceLabs settings (min/base/max, sync, dated minimum
 * prices and stays) with PriceLabs and records VerifySetting / FlagDrift as
 * system changes. Runs from the daily PriceLabs cron and the Setup tab's
 * "Check now". dryRun reports without writing.
 */
export async function runListingSetupCheck(
  admin: SupabaseClient,
  {
    listingIds,
    dryRun = false,
    today = todayUtc(),
    deadline,
  }: { listingIds?: string[]; dryRun?: boolean; today?: string; deadline?: number } = {}
): Promise<SetupCheckResult> {
  const result: SetupCheckResult = {
    listings: 0,
    checked: 0,
    verified: 0,
    drifted: 0,
    unchanged: 0,
    skipped: 0,
    errors: [],
    dryRun,
    details: [],
  }
  if (!isPriceLabsConfigured()) {
    result.errors.push("PRICELABS_API_KEY is not configured")
    return result
  }

  let query = admin
    .from("listing_settings")
    .select(SETTING_COLUMNS)
    .in("setting_key", [...PRICELABS_CHECKED_KEYS])
    .in("status", ["applied", "verified", "drift"])
  if (listingIds) query = query.in("listing_id", listingIds)
  const { data: settingRows, error } = await query
  if (error) {
    // Before the migration the tables don't exist; nothing to check.
    if (error.code === "PGRST205" || error.code === "42P01") return result
    result.errors.push(error.message)
    return result
  }
  const byListing = new Map<string, (ListingSettingRow & { listing_id: string })[]>()
  for (const s of (settingRows ?? []) as (ListingSettingRow & { listing_id: string })[]) {
    const list = byListing.get(s.listing_id) ?? []
    list.push(s)
    byListing.set(s.listing_id, list)
  }
  if (byListing.size === 0) return result

  const { data: hubListings, error: lErr } = await admin
    .from("listings")
    .select("id, listing_id")
    .in("id", [...byListing.keys()])
  if (lErr) {
    result.errors.push(lErr.message)
    return result
  }

  // One call returns every listing (including ones with sync off).
  let plListings: PriceLabsListing[]
  try {
    plListings = await fetchPriceLabsListings(false)
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "PriceLabs listings request failed")
    return result
  }
  const plById = new Map(plListings.map((l) => [String(l.id), l]))

  for (const hub of hubListings ?? []) {
    if (deadline && Date.now() > deadline) {
      result.errors.push("Stopped early: time budget used up")
      break
    }
    const settings = byListing.get(hub.id as string) ?? []
    const pl = hub.listing_id ? plById.get(String(hub.listing_id).trim()) : undefined
    result.listings++

    let overrides: Map<string, PriceLabsOverrideDay> | null = null
    const needsOverrides = settings.some((s) => s.date_from && s.date_to && s.date_to >= today)
    if (pl && needsOverrides) {
      try {
        const rows = await fetchPriceLabsOverrides(String(pl.id), pl.pms)
        overrides = new Map(
          rows.map((o) => [
            o.date,
            {
              date: o.date,
              min_price: parseNullableNumber(o.min_price),
              min_price_type: o.min_price_type ?? null,
              min_stay: typeof o.min_stay === "number" ? o.min_stay : null,
            },
          ])
        )
      } catch (e) {
        result.errors.push(`Overrides for ${hub.id}: ${e instanceof Error ? e.message : "request failed"}`)
      }
    }

    const ctx = {
      listing: pl
        ? {
            min: parseNullableNumber(pl.min),
            base: parseNullableNumber(pl.base),
            max: parseNullableNumber(pl.max),
            push_enabled: typeof pl.push_enabled === "boolean" ? pl.push_enabled : null,
          }
        : null,
      overrides,
      today,
    }

    // Lead-time windows come from every setting on the listing, not just the
    // checked ones (a min stay with a fallback shares the min price's record).
    const { data: allSettings } = await admin
      .from("listing_settings")
      .select("setting_key, date_from, date_to, value")
      .eq("listing_id", hub.id)
    const writes: SettingChangeWrite[] = []
    for (const s of settings) {
      const verdict = checkSetting(s, ctx, leadWindowDays((allSettings ?? []) as ListingSettingRow[], s))
      const transition = nextTransition(s.status, verdict)
      if (verdict.kind === "unknown") result.skipped++
      else result.checked++
      if (!transition) {
        if (verdict.kind !== "unknown") result.unchanged++
      } else if (transition.action === "VerifySetting") result.verified++
      else result.drifted++

      result.details.push({
        listingId: hub.id as string,
        settingId: s.id,
        key: s.setting_key,
        range: s.date_from ? `${s.date_from}..${s.date_to}` : null,
        status: s.status,
        verdict: verdict.kind,
        detail: verdict.detail,
        recorded: transition?.action ?? null,
      })
      if (!transition) continue
      writes.push({
        setting_key: s.setting_key,
        channel: s.channel,
        date_from: s.date_from,
        date_to: s.date_to,
        action: transition.action,
        old_value: transition.action === "FlagDrift" ? s.value : null,
        new_value: verdict.kind === "mismatch" ? verdict.observed : s.value,
        system: s.system,
        reason: `Daily PriceLabs check: ${verdict.detail}`,
        evidence: { source: "pricelabs_api", checked_on: today, pricelabs_listing_id: pl ? String(pl.id) : null },
        next: { value: s.value, status: transition.status },
      })
    }

    if (!dryRun && writes.length > 0) {
      try {
        await writeSettingChanges(admin, {
          listingId: hub.id as string,
          changeSetId: null,
          actor: { type: "system", id: "pricelabs-check" },
          changes: writes,
          existing: settings,
        })
      } catch (e) {
        result.errors.push(`Saving for ${hub.id}: ${e instanceof Error ? e.message : "write failed"}`)
      }
    }
  }
  return result
}
