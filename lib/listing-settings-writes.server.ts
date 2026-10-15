import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  sameSettingScope,
  type ListingSettingRow,
  type SettingChangeAction,
  type SettingChannel,
  type SettingStatus,
  type SettingValue,
} from "@/lib/listing-settings"

// Writes to the listing setup tables. The tables have no client write policies
// (RLS is SELECT-only), so every write goes through the admin client from a
// server action that already checked listings:edit, or from the cron.
// listing_setting_changes is append-only (UPDATE is blocked by a trigger).

export type SettingScope = {
  setting_key: string
  channel: SettingChannel
  date_from: string | null
  date_to: string | null
}

export type SettingChangeWrite = SettingScope & {
  action: SettingChangeAction
  old_value: SettingValue | null
  new_value: SettingValue | null
  system: string
  reason: string | null
  evidence?: Record<string, unknown>
  approved_by_label?: string | null
  /** The current-setting row after this change, or null to leave it as is. */
  next: { value: SettingValue; status: SettingStatus } | null
}

export type WriteActor = {
  type: "staff" | "agent" | "owner" | "system"
  id: string | null
}

const SETTING_COLUMNS =
  "id, setting_key, channel, date_from, date_to, value, system, status, last_change_id, updated_at"

export async function loadListingSettings(
  admin: SupabaseClient,
  listingId: string
): Promise<ListingSettingRow[]> {
  const { data, error } = await admin
    .from("listing_settings")
    .select(SETTING_COLUMNS)
    .eq("listing_id", listingId)
  if (error) throw new Error(error.message)
  return (data ?? []) as ListingSettingRow[]
}

/**
 * Appends the changes (one insert, so the history lands together), then moves
 * each current-setting row to its new value/status and points it at the change.
 * Returns the inserted change ids in input order.
 */
export async function writeSettingChanges(
  admin: SupabaseClient,
  {
    listingId,
    changeSetId,
    actor,
    changes,
    existing,
  }: {
    listingId: string
    changeSetId: string | null
    actor: WriteActor
    changes: SettingChangeWrite[]
    existing: ListingSettingRow[]
  }
): Promise<string[]> {
  if (changes.length === 0) return []
  // Spread occurred_at by a millisecond so "newest first" keeps input order.
  const base = Date.now()
  const rows = changes.map((c, i) => ({
    listing_id: listingId,
    change_set_id: changeSetId,
    setting_key: c.setting_key,
    channel: c.channel,
    date_from: c.date_from,
    date_to: c.date_to,
    action: c.action,
    old_value: c.old_value,
    new_value: c.new_value,
    system: c.system,
    reason: c.reason,
    evidence: c.evidence ?? {},
    actor_type: actor.type,
    actor_id: actor.id,
    approved_by_label: c.approved_by_label ?? null,
    occurred_at: new Date(base + i).toISOString(),
  }))
  const { data, error } = await admin
    .from("listing_setting_changes")
    .insert(rows)
    .select("id, occurred_at")
  if (error) throw new Error(error.message)
  // PostgREST returns bulk-insert rows in input order; sort by our own
  // occurred_at spacing anyway so the mapping never depends on that.
  const ids = [...(data ?? [])]
    .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)))
    .map((r) => r.id as string)

  const now = new Date().toISOString()
  const current = [...existing]
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]
    if (!c.next) continue
    const match = current.find((s) => sameSettingScope(s, c))
    if (match) {
      const { error: upErr } = await admin
        .from("listing_settings")
        .update({
          value: c.next.value,
          status: c.next.status,
          system: c.system,
          last_change_id: ids[i],
          updated_at: now,
        })
        .eq("id", match.id)
      if (upErr) throw new Error(`History saved, but updating the current value failed: ${upErr.message}`)
      Object.assign(match, { value: c.next.value, status: c.next.status, last_change_id: ids[i] })
    } else {
      const { data: inserted, error: insErr } = await admin
        .from("listing_settings")
        .insert({
          listing_id: listingId,
          setting_key: c.setting_key,
          channel: c.channel,
          date_from: c.date_from,
          date_to: c.date_to,
          value: c.next.value,
          system: c.system,
          status: c.next.status,
          last_change_id: ids[i],
          updated_at: now,
        })
        .select(SETTING_COLUMNS)
        .single()
      if (insErr) throw new Error(`History saved, but adding the current value failed: ${insErr.message}`)
      current.push(inserted as ListingSettingRow)
    }
  }
  return ids
}
