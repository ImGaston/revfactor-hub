// Server-only: loads the sidebar folder config (see lib/navigation.ts).
import { createClient } from "@/lib/supabase/server"
import { EMPTY_NAV_CONFIG, type NavConfig } from "@/lib/navigation"

export async function getNavConfig(): Promise<NavConfig> {
  const supabase = await createClient()
  const [groupsRes, itemsRes] = await Promise.all([
    supabase
      .from("nav_groups")
      .select("id, label, icon, sort_order, default_collapsed")
      .order("sort_order")
      .order("label"),
    supabase
      .from("nav_item_settings")
      .select("item_key, group_id, sort_order")
      .order("sort_order"),
  ])

  // A failed read must never break the shell: fall back to the flat sidebar.
  if (groupsRes.error || itemsRes.error) return EMPTY_NAV_CONFIG

  return {
    groups: groupsRes.data ?? [],
    items: itemsRes.data ?? [],
  }
}
