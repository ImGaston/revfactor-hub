// Revoke an API key immediately — no redeploy needed.
//
//   npx tsx --env-file=.env.local scripts/revoke-api-key.ts rvf_live_a1b2c3d4
//
// Accepts the key prefix (printed at creation) or the row id. To rotate:
// create the new key, hand it over, then revoke the old one.

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const identifier = process.argv[2]

if (!identifier) {
  console.error("Usage: revoke-api-key.ts <key_prefix | id>")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const column = identifier.startsWith("rvf_live_") ? "key_prefix" : "id"

const { data, error } = await supabase
  .from("api_keys")
  .update({ revoked_at: new Date().toISOString() })
  .eq(column, identifier)
  .is("revoked_at", null)
  .select("name, key_prefix")

if (error) {
  console.error(`Failed to revoke: ${error.message}`)
  process.exit(1)
}

if (!data || data.length === 0) {
  console.error(`No active API key matched ${identifier}`)
  process.exit(1)
}

for (const key of data) {
  console.log(`Revoked "${key.name}" (${key.key_prefix}) — effective immediately.`)
}
