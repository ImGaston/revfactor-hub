// Configure default support-ticket owners (support_routing_rules).
//
//   npx tsx --env-file=.env.local scripts/seed-support-routing.ts \
//     --changes=<andres hub email> --strategy=<gaston hub email> --money=<fede hub email>
//
// Each email must belong to an existing Hub login (profiles). Replaces every
// existing rule in one pass so re-running is safe. Rules come from
// SUPPORT_DEFAULT_ROUTING in lib/support-tickets.ts. Add --dry-run to print
// the rules without writing.

import { createClient } from "@supabase/supabase-js"

import { SUPPORT_DEFAULT_ROUTING, type SupportRoutingRole } from "@/lib/support-tickets"

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=")
    return [key, value.join("=") || "true"]
  })
)
const roles: SupportRoutingRole[] = ["changes", "strategy", "money"]
const missing = roles.filter((role) => !args[role])
if (missing.length) {
  console.error(`Missing --${missing.join(", --")}=<hub email>`)
  process.exit(1)
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

async function main() {
  const emails = roles.map((role) => args[role].toLowerCase())
  const { data: profiles, error } = await supabase.from("profiles").select("id, email").in("email", emails)
  if (error) throw new Error(error.message)

  const idFor = new Map<SupportRoutingRole, string>()
  for (const role of roles) {
    const profile = profiles?.find((p) => p.email.toLowerCase() === args[role].toLowerCase())
    if (!profile) throw new Error(`No Hub login for ${args[role]} (--${role}); invite them first`)
    idFor.set(role, profile.id)
  }

  const rows = SUPPORT_DEFAULT_ROUTING.map((rule) => ({
    category: rule.category,
    request_type: rule.request_type,
    assignee_id: idFor.get(rule.role)!,
    rank: rule.rank,
  }))
  for (const rule of SUPPORT_DEFAULT_ROUTING)
    console.log(`${(rule.category ?? "any category").padEnd(16)} ${(rule.request_type ?? "any type").padEnd(10)} → ${rule.role} (${args[rule.role]})`)

  if (args["dry-run"]) return
  const { error: deleteError } = await supabase.from("support_routing_rules").delete().not("id", "is", null)
  if (deleteError) throw new Error(deleteError.message)
  const { error: insertError } = await supabase.from("support_routing_rules").insert(rows)
  if (insertError) throw new Error(insertError.message)
  console.log(`\nWrote ${rows.length} routing rules.`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
