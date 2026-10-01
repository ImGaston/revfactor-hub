import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

// Text assertions over the migration. The behavior (draft-only writes keep
// updated_at, malformed drafts rejected, resolve gate intact) was run against
// a disposable Postgres.

const read = (file: string) => readFileSync(path.join(process.cwd(), "supabase/migrations", file), "utf8")
const executable = (raw: string) =>
  raw
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--")
      return idx === -1 ? line : line.slice(0, idx)
    })
    .join("\n")
    .replace(/[ \t]+/g, " ")

const SQL = executable(read("20260930200000_support_suggested_reply.sql"))
const ORIGINAL = executable(read("20260929160000_support_tickets.sql"))

describe("suggested reply migration", () => {
  it("adds a bounded, nullable draft column", () => {
    expect(SQL).toContain("ADD COLUMN suggested_reply JSONB")
    expect(SQL).toContain("CONSTRAINT support_tickets_suggested_reply_shape CHECK")
    // A missing key must fail the CHECK, not pass it as NULL
    expect(SQL).toMatch(/OR COALESCE\([\s\S]*?,\s*FALSE\s*\)/)
    expect(SQL).toContain("BETWEEN 1 AND 4000")
  })

  it("only skips the updated_at stamp for draft-only writes", () => {
    expect(SQL).toContain(
      "IF (to_jsonb(NEW) - 'suggested_reply' - 'updated_at')\n IS DISTINCT FROM (to_jsonb(OLD) - 'suggested_reply' - 'updated_at') THEN"
    )
  })

  it("keeps every rule of the original guard", () => {
    const messages = (sql: string) => {
      const start = sql.indexOf("FUNCTION public.support_ticket_guard()")
      const body = sql.slice(start, sql.indexOf("$$;", start))
      return [...body.matchAll(/RAISE EXCEPTION '((?:[^']|'')+)'/g)].map((m) => m[1])
    }
    expect(messages(ORIGINAL).length).toBeGreaterThan(5)
    expect(messages(SQL)).toEqual(messages(ORIGINAL))
    expect(SQL).toContain("SECURITY DEFINER")
    expect(SQL).toContain("SET search_path = public")
    expect(SQL).toContain("REVOKE EXECUTE ON FUNCTION public.support_ticket_guard() FROM PUBLIC, anon, authenticated")
  })

  it("adds no policies or grants", () => {
    expect(SQL).not.toMatch(/CREATE POLICY|GRANT /)
  })
})
