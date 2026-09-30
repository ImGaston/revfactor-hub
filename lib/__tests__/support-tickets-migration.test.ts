import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

// Text assertions over the migration (no database-backed harness in this
// repo). The behavioral checks — resolve gate, wrong-client property, merge —
// were run against a disposable Postgres; these keep the security shape from
// regressing.

const RAW = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260929160000_support_tickets.sql"),
  "utf8"
)

// Executable SQL only: comments explain what the file avoids, and matching
// the prose would make assertions pass or fail on documentation.
const SQL = RAW.split("\n")
  .map((line) => {
    const idx = line.indexOf("--")
    return idx === -1 ? line : line.slice(0, idx)
  })
  .join("\n")
  .replace(/[ \t]+/g, " ")

const TABLES = [
  "support_capture_messages",
  "support_tickets",
  "support_ticket_listings",
  "support_ticket_commitments",
  "support_ticket_events",
  "support_routing_rules",
]

function policyStatements(): string[] {
  return SQL.split(/CREATE POLICY/i)
    .slice(1)
    .map((chunk) => `CREATE POLICY${chunk.split(";")[0]}`)
}

function policiesOn(table: string): string[] {
  return policyStatements().filter((p) => new RegExp(`\\bON ${table}\\b`).test(p))
}

describe("20260929160000_support_tickets.sql — RLS shape", () => {
  it("enables row level security on every new table", () => {
    for (const table of TABLES) {
      expect(SQL).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
    }
  })

  it("never ships a USING (true) policy", () => {
    expect(SQL).not.toMatch(/USING\s*\(\s*true\s*\)/i)
    expect(SQL).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i)
  })

  it("gates every policy on has_permission", () => {
    for (const policy of policyStatements()) {
      expect(policy, `policy without has_permission:\n${policy}`).toMatch(/has_permission\(/)
    }
  })

  it("lets only the service role write the capture ledger", () => {
    const ledger = policiesOn("support_capture_messages")
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatch(/FOR SELECT/)
  })

  it("keeps the timeline append-only and promises undeletable", () => {
    const events = policiesOn("support_ticket_events")
    expect(events.some((p) => /FOR (UPDATE|DELETE)/.test(p))).toBe(false)
    expect(events.find((p) => /FOR INSERT/.test(p))).toMatch(/actor_id = auth\.uid\(\)/)
    expect(policiesOn("support_ticket_commitments").some((p) => /FOR DELETE/.test(p))).toBe(false)
  })

  it("denies the external roles explicitly", () => {
    expect(SQL).toMatch(/WHERE r\.name IN \('contractor', 'marketing', 'hostpricing'\)/)
  })
})

describe("20260929160000_support_tickets.sql — invariants", () => {
  it("enforces the resolve gate in the database", () => {
    for (const message of [
      "requires a verifier",
      "Validate which property",
      "Record the answer",
      "explain why it is still correct",
      "Close or cancel every open promise",
      "controlled or rejected",
      "Tell the client the change is live",
    ]) {
      expect(SQL).toContain(message)
    }
  })

  it("keeps a promise's original due date immutable", () => {
    expect(SQL).toMatch(/NEW\.due_at IS DISTINCT FROM OLD\.due_at/)
  })

  it("revokes direct execution of every guard function", () => {
    for (const fn of [
      "support_ticket_guard",
      "support_ticket_listing_guard",
      "adjustment_support_ticket_guard",
      "support_commitment_guard",
    ]) {
      expect(SQL).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn}() FROM PUBLIC, anon, authenticated`)
    }
  })

  it("gates the merge function with IS NOT TRUE and never grants it to anon", () => {
    expect(SQL).toMatch(/has_permission\('support', 'edit'\) IS NOT TRUE/)
    expect(SQL).toMatch(/REVOKE EXECUTE ON FUNCTION public\.merge_support_ticket\(UUID, UUID\) FROM PUBLIC, anon/)
    expect(SQL).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.merge_support_ticket[^;]*anon/)
  })

  it("lets only the service role apply captures", () => {
    expect(SQL).toContain("REVOKE EXECUTE ON FUNCTION public.apply_support_capture(JSONB) FROM PUBLIC, anon, authenticated")
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.apply_support_capture(JSONB) TO service_role")
    const fn = SQL.slice(SQL.indexOf("FUNCTION public.apply_support_capture"))
    expect(fn.slice(0, 200)).toMatch(/SECURITY INVOKER/)
  })

  it("applies ticket patches only for newly inserted events", () => {
    const fn = SQL.slice(SQL.indexOf("FUNCTION public.apply_support_capture"))
    expect(fn).toMatch(/ON CONFLICT \(external_key\) DO NOTHING\s+RETURNING id INTO v_event_id/)
    expect(fn).toMatch(/IF v_event_id IS NOT NULL THEN/)
  })

  it("stores the hand-managed flag on clients and tickets", () => {
    expect(SQL).toMatch(/ALTER TABLE clients\s+ADD COLUMN support_hand_managed BOOLEAN NOT NULL DEFAULT FALSE/)
    expect(SQL).toMatch(/hand_managed BOOLEAN NOT NULL DEFAULT FALSE/)
  })

  it("pins search_path on every SECURITY DEFINER function", () => {
    const definers = SQL.split(/CREATE OR REPLACE FUNCTION/).slice(1).filter((f) => /SECURITY DEFINER/.test(f))
    expect(definers.length).toBeGreaterThanOrEqual(4)
    for (const fn of definers) expect(fn).toMatch(/SET search_path = public/)
  })
})
