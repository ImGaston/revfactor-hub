"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import { ADJUSTMENT_TYPES } from "@/lib/adjustments"

// Upsert so types added to ADJUSTMENT_TYPES after migration 073 get a row on
// first toggle (missing rows read as enabled-for-both in the dialog filter)
export async function toggleAdjustmentTypeGroup(
  type: string,
  group: "internal" | "hostpricing",
  enabled: boolean
) {
  if (!(await hasPermission("settings", "edit"))) return { error: "Unauthorized" }
  if (!ADJUSTMENT_TYPES.some((t) => t.value === type)) return { error: "Invalid type" }

  const supabase = await createClient()
  const column = group === "internal" ? "internal_enabled" : "hostpricing_enabled"
  const { error } = await supabase
    .from("adjustment_type_settings")
    .upsert({ type, [column]: enabled }, { onConflict: "type" })

  if (error) return { error: error.message }

  revalidatePath("/settings/adjustment-types")
  return { error: null }
}
