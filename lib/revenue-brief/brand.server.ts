import "server-only"

import { createClient } from "@/lib/supabase/server"
import {
  REVENUE_BRIEF_BRAND_BUCKET,
  type CoBrandingMode,
  type RevenueBriefBrandProfile,
  type RevenueBriefBrandTheme,
} from "@/lib/revenue-brief/brand"

type BrandRow = {
  id: string
  name: string
  client_id: string | null
  co_branding_mode: CoBrandingMode
  primary_color: string
  secondary_color: string
  accent_color: string
  font_family: string | null
  footer_text: string | null
  source_drive_url: string | null
  logo_storage_path: string | null
  logo_file_name: string | null
  manual_storage_path: string | null
  manual_file_name: string | null
}

async function signedUrl(path: string | null): Promise<string | null> {
  if (!path) return null
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from(REVENUE_BRIEF_BRAND_BUCKET)
    .createSignedUrl(path, 60 * 15)
  return error ? null : data.signedUrl
}

export async function listRevenueBriefBrands(): Promise<
  RevenueBriefBrandProfile[]
> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("revenue_brief_brands")
    .select(
      "id,name,client_id,co_branding_mode,primary_color,secondary_color,accent_color,font_family,footer_text,source_drive_url,logo_storage_path,logo_file_name,manual_storage_path,manual_file_name"
    )
    .order("name")

  if (error) {
    console.error("Revenue brief brands could not be loaded", error)
    return []
  }

  const rows = (data ?? []) as BrandRow[]
  const clientIds = rows
    .map((row) => row.client_id)
    .filter((id): id is string => Boolean(id))
  const { data: clients } = clientIds.length
    ? await supabase.from("clients_basic").select("id,name").in("id", clientIds)
    : { data: [] }
  const clientNames = new Map(
    (clients ?? []).map((client) => [client.id, client.name])
  )

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      clientId: row.client_id,
      clientName: row.client_id
        ? (clientNames.get(row.client_id) ?? null)
        : null,
      coBrandingMode: row.co_branding_mode,
      primaryColor: row.primary_color,
      secondaryColor: row.secondary_color,
      accentColor: row.accent_color,
      fontFamily: row.font_family,
      footerText: row.footer_text,
      sourceDriveUrl: row.source_drive_url,
      logoStoragePath: row.logo_storage_path,
      logoFileName: row.logo_file_name,
      manualStoragePath: row.manual_storage_path,
      manualFileName: row.manual_file_name,
      logoUrl: await signedUrl(row.logo_storage_path),
      manualUrl: await signedUrl(row.manual_storage_path),
    }))
  )
}

export async function loadRevenueBriefBrandTheme(
  id: string
): Promise<RevenueBriefBrandTheme | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("revenue_brief_brands")
    .select(
      "name,co_branding_mode,primary_color,secondary_color,accent_color,font_family,footer_text,logo_storage_path"
    )
    .eq("id", id)
    .maybeSingle()

  if (error || !data) return null

  let logoDataUrl: string | null = null
  if (data.logo_storage_path) {
    const { data: logo, error: logoError } = await supabase.storage
      .from(REVENUE_BRIEF_BRAND_BUCKET)
      .download(data.logo_storage_path)
    if (!logoError && logo) {
      const bytes = Buffer.from(await logo.arrayBuffer())
      const mime = logo.type === "image/png" ? "image/png" : "image/jpeg"
      logoDataUrl = `data:${mime};base64,${bytes.toString("base64")}`
    }
  }

  return {
    name: data.name,
    coBrandingMode: data.co_branding_mode as CoBrandingMode,
    primaryColor: data.primary_color,
    secondaryColor: data.secondary_color,
    accentColor: data.accent_color,
    fontFamily: data.font_family,
    footerText: data.footer_text,
    logoDataUrl,
  }
}
