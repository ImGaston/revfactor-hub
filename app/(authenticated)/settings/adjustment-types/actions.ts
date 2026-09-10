"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import { ADJUSTMENT_TYPES, type AdjustmentTypeGroup } from "@/lib/adjustments"

const GROUP_COLUMN: Record<AdjustmentTypeGroup, string> = {
  internal: "internal_enabled",
  hostpricing: "hostpricing_enabled",
  agent: "agent_enabled",
}

// Upsert so types added to ADJUSTMENT_TYPES after migration 073 get a row on
// first toggle (missing rows read as enabled for internal/hostpricing and
// disabled for agent in the dialog filter — the other columns keep their
// DB defaults, which match that).
export async function toggleAdjustmentTypeGroup(
  type: string,
  group: AdjustmentTypeGroup,
  enabled: boolean
) {
  if (!(await hasPermission("settings", "edit"))) return { error: "Unauthorized" }
  if (!ADJUSTMENT_TYPES.some((t) => t.value === type)) return { error: "Invalid type" }
  const column = GROUP_COLUMN[group]
  if (!column) return { error: "Invalid group" }

  const supabase = await createClient()
  const { error } = await supabase
    .from("adjustment_type_settings")
    .upsert({ type, [column]: enabled }, { onConflict: "type" })

  if (error) return { error: error.message }

  revalidatePath("/settings/adjustment-types")
  return { error: null }
}
