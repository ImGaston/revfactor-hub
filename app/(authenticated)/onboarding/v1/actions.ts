"use server"

import { revalidatePath } from "next/cache"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function verifyGhlOnboardingTaskAction(input: {
  taskId: string
  expectedUpdatedAt: string
  evidence: string
}): Promise<{ success: true } | { error: string }> {
  if (!(await hasPermission("onboarding", "edit"))) {
    return { error: "You do not have permission to verify onboarding tasks." }
  }

  const evidence = input.evidence.trim()
  if (
    !UUID_RE.test(input.taskId) ||
    !Number.isFinite(Date.parse(input.expectedUpdatedAt))
  ) {
    return { error: "This task version is invalid. Reload and try again." }
  }
  if (evidence.length < 1 || evidence.length > 2000) {
    return { error: "Add a verification note of up to 2,000 characters." }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("verify_ghl_onboarding_task_v1", {
    p_task_id: input.taskId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_evidence: evidence,
  })

  if (error) {
    const stale = error.message.includes("onboarding_task_stale")
    return {
      error: stale
        ? "This task changed after you opened it. Reload before verifying."
        : "The task could not be verified. Reload and try again.",
    }
  }

  revalidatePath("/onboarding/v1")
  return { success: true }
}
