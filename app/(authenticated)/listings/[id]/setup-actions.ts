"use server"

import { revalidatePath } from "next/cache"

import { hasPermission } from "@/lib/permissions.server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getProfile } from "@/lib/supabase/profile"
import {
  SETTING_CHANNELS,
  baseSettingKey,
  sameSettingScope,
  sameSettingValue,
  settingKeyDef,
  validateSettingValue,
  type SettingChannel,
  type SettingStatus,
} from "@/lib/listing-settings"
import {
  loadListingSettings,
  writeSettingChanges,
  type SettingChangeWrite,
} from "@/lib/listing-settings-writes.server"
import { runListingSetupCheck } from "@/lib/listing-setup-check.server"

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export type RecordChangeRow = {
  key: string
  /** Optional name for keys that repeat per channel (promotions). */
  name?: string
  channel: SettingChannel
  date_from: string | null
  date_to: string | null
  value: unknown
  system: string
  reason: string
}

export type RecordChangeInput = {
  title: string
  approvedBy: string
  notes: string
  /** planned = proposal only; applied = done in the system; verified = done and confirmed on the channel. */
  status: "planned" | "applied" | "verified"
  rows: RecordChangeRow[]
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const SYSTEMS = new Set(["pricelabs", "guesty", "airbnb", "booking", "vrbo", "hub"])
const setPath = (listingId: string) => revalidatePath(`/listings/${listingId}`)

async function staffActor() {
  if (!(await hasPermission("listings", "edit"))) return null
  const profile = await getProfile()
  if (!profile) return null
  return { id: profile.id, name: profile.full_name || profile.email }
}

function slug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
}

/** Records one approved batch of setting changes (a change set) for a listing. */
export async function recordSettingChangesAction(
  listingId: string,
  input: RecordChangeInput
): Promise<Result<{ changeSetId: string }>> {
  const actor = await staffActor()
  if (!actor) return { ok: false, error: "You don't have permission to edit listings." }

  const title = input.title.trim().slice(0, 140)
  if (!title) return { ok: false, error: "Give the batch a short title." }
  if (!["planned", "applied", "verified"].includes(input.status)) {
    return { ok: false, error: "Pick a status." }
  }
  if (input.rows.length === 0) return { ok: false, error: "Add at least one change." }
  if (input.rows.length > 30) return { ok: false, error: "Record at most 30 changes at once." }

  const admin = createAdminClient()
  let existing
  try {
    existing = await loadListingSettings(admin, listingId)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't load current settings." }
  }

  const approvedBy = input.approvedBy.trim().slice(0, 80) || actor.name
  const writes: SettingChangeWrite[] = []
  for (const [i, row] of input.rows.entries()) {
    const n = `Change ${i + 1}`
    const def = settingKeyDef(row.key)
    if (!def || baseSettingKey(row.key) !== row.key) return { ok: false, error: `${n}: pick a setting.` }
    const name = row.name ? slug(row.name) : ""
    if (row.key === "promotion.pms" && !name) return { ok: false, error: `${n}: name the promotion.` }
    const settingKey = name ? `${row.key}/${name}` : row.key
    if (!SETTING_CHANNELS.includes(row.channel)) return { ok: false, error: `${n}: pick a channel.` }
    const from = row.date_from || null
    const to = row.date_to || null
    if (def.scope === "date_range") {
      if (!from || !to || !DATE.test(from) || !DATE.test(to)) return { ok: false, error: `${n}: enter both dates.` }
      if (from > to) return { ok: false, error: `${n}: the start date is after the end date.` }
    } else if (from || to) {
      return { ok: false, error: `${n}: this setting doesn't take dates.` }
    }
    if (!SYSTEMS.has(row.system)) return { ok: false, error: `${n}: pick where it's set.` }
    const parsed = validateSettingValue(row.key, row.value)
    if (!parsed.ok) return { ok: false, error: `${n}: ${parsed.error}` }

    const scope = { setting_key: settingKey, channel: row.channel, date_from: from, date_to: to }
    if (writes.some((w) => sameSettingScope(w, scope))) {
      return { ok: false, error: `${n}: the same setting appears twice in this batch.` }
    }
    const current = existing.find((s) => sameSettingScope(s, scope))
    const target: SettingStatus = input.status
    if (current && sameSettingValue(current.value, parsed.value) && current.status === target) {
      return { ok: false, error: `${n}: that's already the current value.` }
    }
    const reason = row.reason.trim().slice(0, 300) || null
    const common = { ...scope, system: row.system, reason, approved_by_label: approvedBy }

    if (target === "planned") {
      // A proposal never overwrites a value that is live; it only creates a
      // planned row when the scope is new (or still planned).
      const keepLive = current && current.status !== "planned"
      writes.push({
        ...common,
        action: "ProposeSettingChange",
        old_value: current?.value ?? null,
        new_value: parsed.value,
        next: keepLive ? null : { value: parsed.value, status: "planned" },
      })
      continue
    }
    writes.push({
      ...common,
      action: "ApplySetting",
      old_value: current?.value ?? null,
      new_value: parsed.value,
      next: { value: parsed.value, status: "applied" },
    })
    if (target === "verified") {
      writes.push({
        ...common,
        action: "VerifySetting",
        old_value: null,
        new_value: parsed.value,
        next: { value: parsed.value, status: "verified" },
      })
    }
  }

  const now = new Date().toISOString()
  const { data: set, error: setErr } = await admin
    .from("listing_setting_change_sets")
    .insert({
      listing_id: listingId,
      title,
      status: input.status === "planned" ? "proposed" : input.status,
      approved_by: approvedBy === actor.name ? actor.id : null,
      approved_by_label: approvedBy,
      approved_at: input.status === "planned" ? null : now,
      notes: input.notes.trim().slice(0, 1000) || null,
      created_by: actor.id,
    })
    .select("id")
    .single()
  if (setErr || !set) return { ok: false, error: setErr?.message ?? "Couldn't create the batch." }

  try {
    await writeSettingChanges(admin, {
      listingId,
      changeSetId: set.id as string,
      actor: { type: "staff", id: actor.id },
      changes: writes,
      existing,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't save the changes."
    // Nothing was appended if the change insert itself failed; drop the empty batch.
    if (!message.startsWith("History saved")) {
      await admin.from("listing_setting_change_sets").delete().eq("id", set.id)
    }
    return { ok: false, error: message }
  }

  setPath(listingId)
  return { ok: true, changeSetId: set.id as string }
}

async function loadSetting(settingId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("listing_settings")
    .select("id, listing_id, setting_key, channel, date_from, date_to, value, system, status, last_change_id, updated_at")
    .eq("id", settingId)
    .maybeSingle()
  return { admin, setting: data, error }
}

/** A person confirmed the value on the channel or system. */
export async function verifySettingAction(settingId: string, note: string): Promise<Result> {
  const actor = await staffActor()
  if (!actor) return { ok: false, error: "You don't have permission to edit listings." }
  const { admin, setting, error } = await loadSetting(settingId)
  if (error || !setting) return { ok: false, error: error?.message ?? "Setting not found." }
  try {
    await writeSettingChanges(admin, {
      listingId: setting.listing_id,
      changeSetId: null,
      actor: { type: "staff", id: actor.id },
      existing: [setting],
      changes: [
        {
          setting_key: setting.setting_key,
          channel: setting.channel,
          date_from: setting.date_from,
          date_to: setting.date_to,
          action: "VerifySetting",
          old_value: null,
          new_value: setting.value,
          system: setting.system,
          reason: note.trim().slice(0, 300) || "Checked by hand",
          approved_by_label: actor.name,
          next: { value: setting.value, status: "verified" },
        },
      ],
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." }
  }
  setPath(setting.listing_id)
  return { ok: true }
}

/** A person saw something different from what we decided. */
export async function flagSettingDriftAction(settingId: string, observed: string): Promise<Result> {
  const actor = await staffActor()
  if (!actor) return { ok: false, error: "You don't have permission to edit listings." }
  const seen = observed.trim().slice(0, 300)
  if (!seen) return { ok: false, error: "Say what you saw instead." }
  const { admin, setting, error } = await loadSetting(settingId)
  if (error || !setting) return { ok: false, error: error?.message ?? "Setting not found." }
  try {
    await writeSettingChanges(admin, {
      listingId: setting.listing_id,
      changeSetId: null,
      actor: { type: "staff", id: actor.id },
      existing: [setting],
      changes: [
        {
          setting_key: setting.setting_key,
          channel: setting.channel,
          date_from: setting.date_from,
          date_to: setting.date_to,
          action: "FlagDrift",
          old_value: setting.value,
          new_value: { text: seen },
          system: setting.system,
          reason: "Found by hand",
          approved_by_label: actor.name,
          next: { value: setting.value, status: "drift" },
        },
      ],
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." }
  }
  setPath(setting.listing_id)
  return { ok: true }
}

/** Runs the PriceLabs check for one listing now (same logic as the daily cron). */
export async function checkSetupNowAction(
  listingId: string
): Promise<Result<{ summary: string }>> {
  const actor = await staffActor()
  if (!actor) return { ok: false, error: "You don't have permission to edit listings." }
  try {
    const result = await runListingSetupCheck(createAdminClient(), { listingIds: [listingId] })
    setPath(listingId)
    const parts = [
      `${result.checked} checked`,
      result.verified ? `${result.verified} verified` : null,
      result.drifted ? `${result.drifted} drift` : null,
      result.unchanged ? `${result.unchanged} unchanged` : null,
      result.skipped ? `${result.skipped} not checkable` : null,
    ].filter(Boolean)
    if (result.errors.length > 0) return { ok: false, error: result.errors[0] }
    return { ok: true, summary: parts.join(" · ") }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Check failed." }
  }
}
