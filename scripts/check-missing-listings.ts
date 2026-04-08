/**
 * Compare CSV listings against Supabase to find missing ones.
 * Usage: set -a && source .env.local && set +a && npx tsx scripts/check-missing-listings.ts
 */

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"
import { resolve } from "path"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing env vars")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

// Parse CSV
function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split("\n")
  const headers = lines[0].split(",").map((h) => h.trim())
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const values: string[] = []
    let current = ""
    let inQuotes = false

    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === "," && !inQuotes) {
        values.push(current.trim())
        current = ""
      } else {
        current += char
      }
    }
    values.push(current.trim())

    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? ""
    })
    rows.push(row)
  }
  return rows
}

async function main() {
  const csvPath = resolve(process.env.HOME!, "Downloads/Listings-Grid view (1).csv")
  const csvContent = readFileSync(csvPath, "utf-8")
  const csvRows = parseCSV(csvContent)

  console.log(`CSV: ${csvRows.length} listings\n`)

  // Get all listings from Supabase
  const { data: dbListings, error } = await supabase
    .from("listings")
    .select("id, name, listing_id, pricelabs_link, airbnb_link, client_id, clients(name)")

  if (error) {
    console.error("Failed to fetch listings:", error.message)
    process.exit(1)
  }

  console.log(`Supabase: ${dbListings.length} listings\n`)

  // Build sets for comparison
  // CSV uses "Listing ID" column which maps to listing_id or pricelabs ID
  const dbByName = new Map<string, any>()
  const dbByListingId = new Map<string, any>()
  const dbByPricelabsId = new Map<string, any>()

  for (const l of dbListings) {
    dbByName.set(l.name?.toLowerCase().trim(), l)
    if (l.listing_id) dbByListingId.set(l.listing_id.toString().trim(), l)
    // Extract pricelabs ID from link
    if (l.pricelabs_link) {
      const match = l.pricelabs_link.match(/listings=([^&]+)/)
      if (match) dbByPricelabsId.set(match[1].trim(), l)
    }
  }

  const missing: { name: string; client: string; listingId: string }[] = []
  const found: string[] = []

  for (const row of csvRows) {
    const csvName = (row["Listing"] || row["Internal Listing Name"] || "").trim()
    const csvListingId = (row["Listing ID"] || "").trim()
    const csvClient = (row["Clients"] || "").trim()

    if (!csvName && !csvListingId) continue // skip empty rows

    // Try to match by pricelabs/listing ID first, then by name
    const matchById = dbByPricelabsId.get(csvListingId) || dbByListingId.get(csvListingId)
    const matchByName = dbByName.get(csvName.toLowerCase())

    if (matchById || matchByName) {
      found.push(csvName || csvListingId)
    } else {
      missing.push({
        name: csvName || "(no name)",
        client: csvClient,
        listingId: csvListingId,
      })
    }
  }

  console.log(`✅ Found in Supabase: ${found.length}`)
  console.log(`❌ Missing from Supabase: ${missing.length}\n`)

  if (missing.length > 0) {
    console.log("Missing listings:")
    console.log("─".repeat(80))
    for (const m of missing) {
      console.log(`  ${m.name}  |  Client: ${m.client}  |  ID: ${m.listingId}`)
    }
  }
}

main().catch(console.error)
