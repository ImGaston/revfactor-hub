import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const RAW = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261008120000_support_bot_ticket_writes.sql"),
  "utf8"
)
const SQL = RAW.split("\n")
  .map((line) => (line.includes("--") ? line.slice(0, line.indexOf("--")) : line))
  .join("\n")
  .replace(/[ \t]+/g, " ")

describe("support bot ticket-write migration", () => {
  it("keeps the bot RPC invoker-only and service-role-only", () => {
    const fn = SQL.slice(SQL.indexOf("FUNCTION public.apply_support_ticket_bot_update("))
    expect(fn.slice(0, 500)).toContain("SECURITY INVOKER")
    expect(SQL).toMatch(/REVOKE EXECUTE ON FUNCTION public\.apply_support_ticket_bot_update\([\s\S]*?\) FROM PUBLIC, anon, authenticated/)
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.apply_support_ticket_bot_update\([\s\S]*?\) TO service_role/)
  })

  it("never hard-deletes records", () => {
    expect(SQL).not.toMatch(/DELETE FROM/i)
  })

  it("preserves human resolution checks and gates bot resolution to service role", () => {
    expect(SQL).toContain("Only a super admin can resolve a ticket outside the Hub")
    expect(SQL).toContain("Resolving a support ticket requires a verifier")
    expect(SQL).toContain("auth.role() IS DISTINCT FROM 'service_role'")
    expect(SQL).toContain("COALESCE((NEW.verification->>'by_bot')::boolean, FALSE)")
    expect(SQL).toContain("char_length(COALESCE(btrim(NEW.verification->>'note'), '')) < 3")
  })
})
