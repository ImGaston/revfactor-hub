// Create an API key for an external consumer of GET /api/v1/leads.
//
//   npx tsx --env-file=.env.local scripts/create-api-key.ts \
//     "Marketing tracking stack" marketing@example.com leads:read
//
// The plaintext token is printed once and never stored — only its SHA-256.

import { createClient } from "@supabase/supabase-js"
import { createHash, randomBytes } from "node:crypto"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const [name, ownerEmail, ...scopes] = process.argv.slice(2)
const allowedScopes = new Set(["leads:read", "market-map:read"])

if (!name || scopes.length === 0) {
  console.error(
    "Usage: create-api-key.ts <name> [owner_email] <scope...>\n" +
      '  e.g. create-api-key.ts "Marketing tracking stack" marketing@example.com leads:read'
  )
  process.exit(1)
}

const invalidScopes = scopes.filter((scope) => !allowedScopes.has(scope))
if (invalidScopes.length > 0) {
  console.error(`Unknown API scope: ${invalidScopes.join(", ")}`)
  process.exit(1)
}

const plaintext = "rvf_live_" + randomBytes(32).toString("hex")
const prefix = plaintext.slice(0, "rvf_live_".length + 8)
const hash = createHash("sha256").update(plaintext).digest("hex")

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const { error } = await supabase.from("api_keys").insert({
  name,
  key_prefix: prefix,
  key_hash: hash,
  scopes,
  owner_email: ownerEmail || null,
})

if (error) {
  console.error(`Failed to create API key: ${error.message}`)
  process.exit(1)
}

console.log(`\nAPI key created: ${name}`)
console.log(`  prefix: ${prefix}`)
console.log(`  scopes: ${scopes.join(", ")}`)
console.log(`\n  ${plaintext}\n`)
console.log(
  "Store it now — it is not recoverable. Send it over a secure channel;"
)
console.log(
  "it must live server-side in the consumer's stack, never in a browser.\n"
)
