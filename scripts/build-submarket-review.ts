import { writeFile } from "node:fs/promises"
import { createAdminClient } from "@/lib/supabase/admin"

type Row = { id: string; city: string | null; state: string | null; location_latitude: number | null; location_longitude: number | null }
type Definition = { slug: string; name: string; state: string; cities: string[]; aliases: string[] }
const definitions: Definition[] = [
  { slug: "asheville-area-nc", name: "Asheville area", state: "NC", cities: ["Asheville", "Fairview", "Avery Creek"], aliases: ["Asheville", "Fairview", "Avery Creek"] },
  { slug: "lake-lure-nc", name: "Lake Lure", state: "NC", cities: ["Lake Lure"], aliases: ["Lake Lure"] },
  { slug: "knoxville-tn", name: "Knoxville", state: "TN", cities: ["Knoxville"], aliases: ["Knoxville"] },
  { slug: "eastern-connecticut-ct", name: "Eastern Connecticut", state: "CT", cities: ["Storrs", "Mansfield", "Willimantic", "Windham"], aliases: ["Storrs", "Mansfield", "Willimantic", "Windham"] },
]
const earthRadiusMiles = 3958.7613
function distance(a: Row, b: { latitude: number; longitude: number }) {
  if (a.location_latitude === null || a.location_longitude === null) return null
  const rad = Math.PI / 180
  const dLat = (b.latitude - a.location_latitude) * rad
  const dLon = (b.longitude - a.location_longitude) * rad
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.location_latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}
async function main() {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from("listings").select("id,city,state,location_latitude,location_longitude").eq("status", "active").in("state", ["NC", "TN", "CT"])
  if (error) throw error
  const rows = (data ?? []) as Row[]
  const markets = definitions.map((definition) => {
    const evidence = rows.filter((row) => row.state === definition.state && definition.cities.includes(row.city ?? ""))
    const withCoords = evidence.filter((row) => row.location_latitude !== null && row.location_longitude !== null)
    const center = withCoords.length ? { latitude: withCoords.reduce((s, r) => s + r.location_latitude!, 0) / withCoords.length, longitude: withCoords.reduce((s, r) => s + r.location_longitude!, 0) / withCoords.length } : null
    const distances = center ? withCoords.map((row) => distance(row, center)!).filter(Number.isFinite) : []
    const radius = distances.length ? Math.min(150, Math.max(5, Math.ceil(Math.max(...distances) + 3))) : null
    const classifications = rows.filter((row) => row.state === definition.state).map((row) => {
      const miles = center ? distance(row, center) : null
      return { city: row.city, state: row.state, latitude: row.location_latitude, longitude: row.location_longitude, distance_miles: miles, classification: miles === null ? "unresolved" : miles <= (radius ?? 0) ? "inside" : "outside" }
    })
    return { ...definition, proposed_market_kind: definition.slug.includes("lake-lure") ? "destination" : definition.slug.includes("eastern") ? "mixed" : "urban", center, radius_miles: radius, evidence_count: evidence.length, coordinate_count: withCoords.length, confidence: withCoords.length >= 3 ? "medium" : withCoords.length ? "low" : "unresolved", listing_points: classifications }
  })
  const exceptions = rows.filter((row) => !definitions.some((d) => d.state === row.state && d.cities.includes(row.city ?? ""))).map((row) => ({ city: row.city, state: row.state, has_coordinates: row.location_latitude !== null && row.location_longitude !== null, classification: "outside-target-clusters" }))
  await writeFile("artifacts/market-registry-review.json", JSON.stringify({ version: 1, generated_at: new Date().toISOString(), read_only: true, source: "Hub listings coordinates", markets, exceptions }, null, 2) + "\n")
  await writeFile("artifacts/submarket-definition-review.md", `# Submarket definition review\n\nGenerated ${new Date().toISOString()} from active Hub listings with coordinates. This is a read-only recommendation; no market or membership rows were written.\n\n| Proposed market | State | Evidence | Coordinates | Suggested radius | Confidence |\n|---|---:|---:|---:|---:|---|\n${markets.map((m) => `| ${m.name} | ${m.state} | ${m.evidence_count} | ${m.coordinate_count} | ${m.radius_miles ?? "unresolved"} mi | ${m.confidence} |`).join("\n")}\n\n## Boundaries\n\n- Asheville and Lake Lure remain separate.\n- Knoxville remains separate from Smoky Mountains.\n- Eastern Connecticut remains separate from Washington, DC.\n\n## Exceptions\n\n${exceptions.length ? exceptions.map((e) => `- ${e.city ?? "Unknown city"}, ${e.state ?? "unknown state"}: ${e.classification}`).join("\n") : "None in the queried states."}\n\n## Review required\n\nConfirm suggested center/radius for each market, resolve low-confidence clusters, and approve any new Eastern Connecticut proposal before creating draft market records.\n`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
