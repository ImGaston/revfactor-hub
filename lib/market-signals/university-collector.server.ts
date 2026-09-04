import type { SupabaseClient } from "@supabase/supabase-js"
import { collectUniversityOfficialPage, normalizeUniversityPageDates } from "@/lib/market-signals/university-pages"

type SourceRow = { id: string; name: string; source_url: string | null; query_config: Record<string, unknown> | null; city: string | null; region: string | null }

export async function collectRegisteredUniversitySources(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("revenue_market_sources").select("id,name,source_url,query_config").eq("source_type", "official_feed").limit(20)
  if (error) throw error
  const results = []
  for (const source of (data ?? []) as SourceRow[]) {
    if (!source.source_url || !source.source_url.startsWith("https://")) continue
    const config = source.query_config ?? {}
    const institution = typeof config.institution_slug === "string" ? config.institution_slug : source.name
    const city = typeof config.city === "string" ? config.city : "Unknown"
    const region = typeof config.region === "string" ? config.region : "US"
    try {
      const rows = await collectUniversityOfficialPage({ institution, sourceUrl: source.source_url })
      results.push({ sourceId: source.id, sourceName: source.name, status: "ok", events: normalizeUniversityPageDates({ rows, city, region }) })
    } catch (sourceError) {
      results.push({ sourceId: source.id, sourceName: source.name, status: "failed", error: sourceError instanceof Error ? sourceError.message : "Source fetch failed", events: [] })
    }
  }
  return { readOnly: true, sourceCount: results.length, results }
}
