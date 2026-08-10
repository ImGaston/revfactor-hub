"use server"

import { revalidatePath } from "next/cache"

import { hasPermission } from "@/lib/permissions.server"
import {
  REVENUE_BRIEF_BRAND_BUCKET,
  RevenueBriefBrandSaveSchema,
  normalizeHex,
  type RevenueBriefBrandSaveInput,
} from "@/lib/revenue-brief/brand"
import { createClient } from "@/lib/supabase/server"

export async function saveRevenueBriefBrand(input: RevenueBriefBrandSaveInput) {
  const parsed = RevenueBriefBrandSaveSchema.safeParse(input)
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message || "Review the brand profile.",
    }
  }
  if (
    parsed.data.coBrandingMode !== "revfactor_led" &&
    !parsed.data.logoStoragePath
  ) {
    return {
      error: "Upload an approved logo for partner-led or co-branded PDFs.",
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: existing } = await supabase
    .from("revenue_brief_brands")
    .select("id,logo_storage_path,manual_storage_path")
    .eq("id", parsed.data.id)
    .maybeSingle()

  const requiredAction = existing ? "edit" : "create"
  if (!(await hasPermission("pipeline", requiredAction))) {
    return {
      error: `You do not have permission to ${existing ? "edit" : "create"} brand profiles.`,
    }
  }

  const payload = {
    id: parsed.data.id,
    name: parsed.data.name,
    client_id: parsed.data.clientId || null,
    co_branding_mode: parsed.data.coBrandingMode,
    primary_color: normalizeHex(parsed.data.primaryColor),
    secondary_color: normalizeHex(parsed.data.secondaryColor),
    accent_color: normalizeHex(parsed.data.accentColor),
    font_family: parsed.data.fontFamily || null,
    footer_text: parsed.data.footerText || null,
    source_drive_url: parsed.data.sourceDriveUrl || null,
    logo_storage_path: parsed.data.logoStoragePath || null,
    logo_file_name: parsed.data.logoFileName || null,
    manual_storage_path: parsed.data.manualStoragePath || null,
    manual_file_name: parsed.data.manualFileName || null,
    updated_by: user.id,
  }

  const result = existing
    ? await supabase
        .from("revenue_brief_brands")
        .update(payload)
        .eq("id", parsed.data.id)
    : await supabase
        .from("revenue_brief_brands")
        .insert({ ...payload, created_by: user.id })

  if (result.error) return { error: result.error.message }

  const obsoletePaths = [
    existing?.logo_storage_path &&
    existing.logo_storage_path !== payload.logo_storage_path
      ? existing.logo_storage_path
      : null,
    existing?.manual_storage_path &&
    existing.manual_storage_path !== payload.manual_storage_path
      ? existing.manual_storage_path
      : null,
  ].filter((value): value is string => Boolean(value))

  if (obsoletePaths.length > 0) {
    const { error } = await supabase.storage
      .from(REVENUE_BRIEF_BRAND_BUCKET)
      .remove(obsoletePaths)
    if (error)
      console.error(
        "Obsolete revenue brief brand assets could not be removed",
        error
      )
  }

  revalidatePath("/revenue-briefs")
  revalidatePath("/revenue-briefs/brands")
  return { error: null }
}

export async function deleteRevenueBriefBrand(id: string) {
  if (!(await hasPermission("pipeline", "delete"))) {
    return { error: "You do not have permission to delete brand profiles." }
  }

  const parsedId = RevenueBriefBrandSaveSchema.shape.id.safeParse(id)
  if (!parsedId.success) return { error: "Invalid brand profile." }

  const supabase = await createClient()
  const { data: existing, error: readError } = await supabase
    .from("revenue_brief_brands")
    .select("logo_storage_path,manual_storage_path")
    .eq("id", parsedId.data)
    .maybeSingle()

  if (readError) return { error: readError.message }

  const { error } = await supabase
    .from("revenue_brief_brands")
    .delete()
    .eq("id", parsedId.data)
  if (error) return { error: error.message }

  const paths = [
    existing?.logo_storage_path,
    existing?.manual_storage_path,
  ].filter((value): value is string => Boolean(value))
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from(REVENUE_BRIEF_BRAND_BUCKET)
      .remove(paths)
    if (storageError)
      console.error(
        "Revenue brief brand assets could not be removed",
        storageError
      )
  }

  revalidatePath("/revenue-briefs")
  revalidatePath("/revenue-briefs/brands")
  return { error: null }
}
