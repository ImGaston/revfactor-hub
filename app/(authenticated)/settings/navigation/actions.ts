"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import { getNavConfig } from "@/lib/navigation.server"
import { NAV_ITEMS, isNavGroupIconName, type NavConfig } from "@/lib/navigation"

type ActionResult = { error: string; config?: undefined } | { error: null; config: NavConfig }

export type NavGroupInput = {
  label: string
  icon: string
  defaultCollapsed: boolean
}

const UNAUTHORIZED: ActionResult = { error: "Unauthorized" }

function validateGroupInput(input: NavGroupInput) {
  const label = input.label.trim()
  if (label.length === 0 || label.length > 40) {
    return { error: "Folder name must be 1–40 characters" as const }
  }
  if (!isNavGroupIconName(input.icon)) return { error: "Invalid icon" as const }
  return { error: null, label, icon: input.icon, defaultCollapsed: !!input.defaultCollapsed }
}

// Every mutation ends here: the sidebar lives in the authenticated layout, so
// invalidate the whole tree, then hand the fresh config back so the manager
// can render it without a second round trip.
async function finish(): Promise<ActionResult> {
  revalidatePath("/", "layout")
  return { error: null, config: await getNavConfig() }
}

/** Renumber a folder's sections 0..n-1 in their current order. */
async function renumberGroupItems(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupId: string
) {
  const { data } = await supabase
    .from("nav_item_settings")
    .select("item_key, sort_order")
    .eq("group_id", groupId)
    .order("sort_order")
  const rows = data ?? []
  const codeIndex = new Map(NAV_ITEMS.map((i, idx) => [i.key, idx]))
  rows.sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      (codeIndex.get(a.item_key) ?? 0) - (codeIndex.get(b.item_key) ?? 0)
  )
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].sort_order !== i) {
      const { error } = await supabase
        .from("nav_item_settings")
        .update({ sort_order: i })
        .eq("item_key", rows[i].item_key)
      if (error) return error.message
    }
  }
  return null
}

export async function createNavGroupAction(input: NavGroupInput): Promise<ActionResult> {
  if (!(await hasPermission("settings", "edit"))) return UNAUTHORIZED
  const v = validateGroupInput(input)
  if (v.error) return { error: v.error }

  const supabase = await createClient()
  const { data: last } = await supabase
    .from("nav_groups")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from("nav_groups").insert({
    label: v.label,
    icon: v.icon,
    default_collapsed: v.defaultCollapsed,
    sort_order: (last?.sort_order ?? -1) + 1,
  })
  if (error) return { error: error.message }
  return finish()
}

export async function updateNavGroupAction(
  id: string,
  input: NavGroupInput
): Promise<ActionResult> {
  if (!(await hasPermission("settings", "edit"))) return UNAUTHORIZED
  const v = validateGroupInput(input)
  if (v.error) return { error: v.error }

  const supabase = await createClient()
  const { error } = await supabase
    .from("nav_groups")
    .update({ label: v.label, icon: v.icon, default_collapsed: v.defaultCollapsed })
    .eq("id", id)
  if (error) return { error: error.message }
  return finish()
}

/** Deleting a folder sends its sections back to the top level (FK SET NULL). */
export async function deleteNavGroupAction(id: string): Promise<ActionResult> {
  if (!(await hasPermission("settings", "edit"))) return UNAUTHORIZED
  const supabase = await createClient()
  // Drop the orphaned placement rows too so nothing lingers with a NULL group.
  const { error: itemsError } = await supabase
    .from("nav_item_settings")
    .delete()
    .eq("group_id", id)
  if (itemsError) return { error: itemsError.message }
  const { error } = await supabase.from("nav_groups").delete().eq("id", id)
  if (error) return { error: error.message }
  return finish()
}

export async function moveNavGroupAction(
  id: string,
  direction: "up" | "down"
): Promise<ActionResult> {
  if (!(await hasPermission("settings", "edit"))) return UNAUTHORIZED
  const supabase = await createClient()
  const { data } = await supabase
    .from("nav_groups")
    .select("id, sort_order, label")
    .order("sort_order")
    .order("label")
  const groups = data ?? []
  const index = groups.findIndex((g) => g.id === id)
  if (index === -1) return { error: "Folder not found" }
  const target = direction === "up" ? index - 1 : index + 1
  if (target < 0 || target >= groups.length) return finish()

  const reordered = [...groups]
  ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
  for (let i = 0; i < reordered.length; i++) {
    if (reordered[i].sort_order !== i) {
      const { error } = await supabase
        .from("nav_groups")
        .update({ sort_order: i })
        .eq("id", reordered[i].id)
      if (error) return { error: error.message }
    }
  }
  return finish()
}

/** Put a section in a folder (appended last) or back at the top level (null). */
export async function setNavItemGroupAction(
  itemKey: string,
  groupId: string | null
): Promise<ActionResult> {
  if (!(await hasPermission("settings", "edit"))) return UNAUTHORIZED
  if (!NAV_ITEMS.some((i) => i.key === itemKey)) return { error: "Unknown section" }

  const supabase = await createClient()

  if (groupId === null) {
    const { error } = await supabase
      .from("nav_item_settings")
      .delete()
      .eq("item_key", itemKey)
    if (error) return { error: error.message }
    return finish()
  }

  const { data: group } = await supabase
    .from("nav_groups")
    .select("id")
    .eq("id", groupId)
    .maybeSingle()
  if (!group) return { error: "Folder not found" }

  const { data: last } = await supabase
    .from("nav_item_settings")
    .select("sort_order")
    .eq("group_id", groupId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase
    .from("nav_item_settings")
    .upsert(
      { item_key: itemKey, group_id: groupId, sort_order: (last?.sort_order ?? -1) + 1 },
      { onConflict: "item_key" }
    )
  if (error) return { error: error.message }
  return finish()
}

export async function moveNavItemAction(
  itemKey: string,
  direction: "up" | "down"
): Promise<ActionResult> {
  if (!(await hasPermission("settings", "edit"))) return UNAUTHORIZED
  const supabase = await createClient()

  const { data: row } = await supabase
    .from("nav_item_settings")
    .select("item_key, group_id")
    .eq("item_key", itemKey)
    .maybeSingle()
  if (!row?.group_id) return { error: "Section is not in a folder" }

  const renumberError = await renumberGroupItems(supabase, row.group_id)
  if (renumberError) return { error: renumberError }

  const { data } = await supabase
    .from("nav_item_settings")
    .select("item_key, sort_order")
    .eq("group_id", row.group_id)
    .order("sort_order")
  const rows = data ?? []
  const index = rows.findIndex((r) => r.item_key === itemKey)
  const target = direction === "up" ? index - 1 : index + 1
  if (index === -1 || target < 0 || target >= rows.length) return finish()

  const swaps = [
    { item_key: rows[index].item_key, sort_order: rows[target].sort_order },
    { item_key: rows[target].item_key, sort_order: rows[index].sort_order },
  ]
  for (const s of swaps) {
    const { error } = await supabase
      .from("nav_item_settings")
      .update({ sort_order: s.sort_order })
      .eq("item_key", s.item_key)
    if (error) return { error: error.message }
  }
  return finish()
}
