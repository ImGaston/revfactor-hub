import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CLIENT_CHURN_REASONS } from "@/lib/clients"

const migration = readFileSync(
  "supabase/migrations/20261006120000_churn_tracker.sql",
  "utf8"
)
describe("churn migration contract", () => {
  it("keeps database reasons aligned with the shared client enum", () => {
    const check = migration.match(
      /exit_reason TEXT CHECK \(exit_reason IN \(([\s\S]*?)\)\)/
    )![1]
    expect([...check.matchAll(/'([^']+)'/g)].map((match) => match[1])).toEqual(
      CLIENT_CHURN_REASONS.map((reason) => reason.value)
    )
  })
  it("keeps operational cancellation metadata narrow and uses null-safe gates", () => {
    expect(migration).toContain(
      "RETURNS TABLE (client_id UUID, subscription_id TEXT, scheduled_end DATE, synced_at TIMESTAMPTZ)"
    )
    expect(migration).toContain(
      "public.has_permission('churn', 'view') IS NOT TRUE"
    )
    expect(migration).toContain(
      "public.has_permission('churn', 'edit') IS NOT TRUE"
    )
    expect(migration).not.toContain("ALTER POLICY")
    expect(migration).not.toContain("stamp_listing_deactivation")
  })
})
