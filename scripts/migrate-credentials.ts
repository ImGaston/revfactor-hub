/**
 * One-time migration: Import credentials from Airtable CSV into Supabase.
 *
 * Usage:
 *   npx tsx scripts/migrate-credentials.ts
 *
 * Prerequisites:
 *   - .env file with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   - Migration 013_client_credentials.sql already applied
 *   - Clients already in the database
 */

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

// Parse CSV (simple parser for this format)
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
  // Read CSV
  const csvPath = resolve(__dirname, "../Downloads/Credentials-Grid view.csv")
  let csvContent: string
  try {
    csvContent = readFileSync(csvPath, "utf-8")
  } catch {
    // Try relative to project
    csvContent = readFileSync(
      resolve(process.env.HOME!, "Downloads/Credentials-Grid view.csv"),
      "utf-8"
    )
  }

  const rows = parseCSV(csvContent)
  console.log(`Parsed ${rows.length} credential rows from CSV`)

  // Get all clients from Supabase
  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("id, name")

  if (clientsError) {
    console.error("Failed to fetch clients:", clientsError.message)
    process.exit(1)
  }

  console.log(`Found ${clients.length} clients in Supabase`)

  // Build a name → id map (case-insensitive)
  const clientMap = new Map<string, string>()
  for (const c of clients) {
    clientMap.set(c.name.toLowerCase(), c.id)
  }

  let inserted = 0
  let skipped = 0

  for (const row of rows) {
    const clientName = row["Clients"]?.trim()
    if (!clientName) {
      console.warn(`  Skipping row "${row["Name"]}" — no client name`)
      skipped++
      continue
    }

    const clientId = clientMap.get(clientName.toLowerCase())
    if (!clientId) {
      console.warn(`  No matching client for "${clientName}" — skipping "${row["Name"]}"`)
      skipped++
      continue
    }

    const { error } = await supabase.from("client_credentials").insert({
      client_id: clientId,
      name: row["Name"] || `${clientName} - ${row["Software"]}`,
      software: row["Software"] || "Other",
      email: row["Email"] || null,
      password: row["Password"] || null,
      notes: row["Notes"] || null,
    })

    if (error) {
      console.error(`  Failed to insert "${row["Name"]}":`, error.message)
      skipped++
    } else {
      console.log(`  ✓ ${row["Name"]}`)
      inserted++
    }
  }

  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped`)
}

main().catch(console.error)
