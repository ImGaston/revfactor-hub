"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"

// ─── Toggle step completion ────────────────────────────

export async function toggleOnboardingStep(
  clientId: string,
  templateId: string,
  isCompleted: boolean
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error("Not authenticated")

  const { error } = await supabase.from("onboarding_progress").upsert(
    {
      client_id: clientId,
      template_id: templateId,
      is_completed: isCompleted,
      completed_at: isCompleted ? new Date().toISOString() : null,
      completed_by: isCompleted ? user.id : null,
    },
    { onConflict: "client_id,template_id" }
  )

  if (error) throw new Error(error.message)
  revalidatePath("/onboarding")
}

// ─── Template CRUD ─────────────────────────────────────

export async function createOnboardingTemplate(formData: FormData) {
  const supabase = await createClient()

  // Get max step_order
  const { data: maxRow } = await supabase
    .from("onboarding_templates")
    .select("step_order")
    .order("step_order", { ascending: false })
    .limit(1)
    .single()

  const nextOrder = (maxRow?.step_order ?? -1) + 1

  const { error } = await supabase.from("onboarding_templates").insert({
    step_name: formData.get("step_name") as string,
    description: (formData.get("description") as string) || null,
    is_active: true,
    step_order: nextOrder,
  })

  if (error) throw new Error(error.message)
  revalidatePath("/settings/onboarding")
  revalidatePath("/onboarding")
}

export async function updateOnboardingTemplate(
  id: string,
  data: { step_name?: string; description?: string | null; is_active?: boolean }
) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("onboarding_templates")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) throw new Error(error.message)
  revalidatePath("/settings/onboarding")
  revalidatePath("/onboarding")
}

export async function deleteOnboardingTemplate(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("onboarding_templates")
    .delete()
    .eq("id", id)

  if (error) throw new Error(error.message)
  revalidatePath("/settings/onboarding")
  revalidatePath("/onboarding")
}

export async function reorderOnboardingTemplates(orderedIds: string[]) {
  const supabase = await createClient()

  // Update step_order for each template based on index
  const updates = orderedIds.map((id, index) =>
    supabase
      .from("onboarding_templates")
      .update({ step_order: index, updated_at: new Date().toISOString() })
      .eq("id", id)
  )

  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)

  revalidatePath("/settings/onboarding")
  revalidatePath("/onboarding")
}

// ─── Resource CRUD ─────────────────────────────────────

export async function createOnboardingResource(formData: FormData) {
  const supabase = await createClient()

  const { data: maxRow } = await supabase
    .from("onboarding_resources")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .single()

  const nextOrder = (maxRow?.sort_order ?? -1) + 1

  const { error } = await supabase.from("onboarding_resources").insert({
    title: formData.get("title") as string,
    description: (formData.get("description") as string) || null,
    url: (formData.get("url") as string) || null,
    icon: (formData.get("icon") as string) || "📄",
    sort_order: nextOrder,
  })

  if (error) throw new Error(error.message)
  revalidatePath("/settings/onboarding")
  revalidatePath("/onboarding")
}

export async function updateOnboardingResource(
  id: string,
  data: {
    title?: string
    description?: string | null
    url?: string | null
    icon?: string
  }
) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("onboarding_resources")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) throw new Error(error.message)
  revalidatePath("/settings/onboarding")
  revalidatePath("/onboarding")
}

export async function deleteOnboardingResource(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("onboarding_resources")
    .delete()
    .eq("id", id)

  if (error) throw new Error(error.message)
  revalidatePath("/settings/onboarding")
  revalidatePath("/onboarding")
}

export async function reorderOnboardingResources(orderedIds: string[]) {
  const supabase = await createClient()

  const updates = orderedIds.map((id, index) =>
    supabase
      .from("onboarding_resources")
      .update({ sort_order: index, updated_at: new Date().toISOString() })
      .eq("id", id)
  )

  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)

  revalidatePath("/settings/onboarding")
  revalidatePath("/onboarding")
}
