import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

// Text assertions over the migration (same genre as wins-migration.test.ts):
// there is no database-backed harness, so this keeps the shape of the
// test-status migration from regressing.

const RAW = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260909120000_test_status.sql"),
  "utf8"
)

/** Executable SQL only: `--` comments stripped, whitespace collapsed. */
const SQL = RAW.split("\n")
  .map((line) => {
    const idx = line.indexOf("--")
    return idx === -1 ? line : line.slice(0, idx)
  })
  .join("\n")
  .replace(/\s+/g, " ")

describe("test status migration", () => {
  it("widens both CHECK constraints with 'test'", () => {
    expect(SQL).toMatch(
      /ADD CONSTRAINT clients_status_check CHECK \(status IN \('active', 'onboarding', 'inactive', 'test'\)\)/
    )
    expect(SQL).toMatch(
      /ADD CONSTRAINT listings_status_check CHECK \(status IN \('active', 'inactive', 'test'\)\)/
    )
  })

  it("makes the deactivation stamp ignore test transitions before the 086 rules", () => {
    const fn = SQL.slice(SQL.indexOf("stamp_listing_deactivation"))
    const guard = fn.indexOf("IF NEW.status = 'test' OR OLD.status = 'test' THEN RETURN NEW; END IF;")
    const stamp = fn.indexOf("NEW.deactivated_date := CURRENT_DATE")
    expect(guard).toBeGreaterThan(-1)
    expect(stamp).toBeGreaterThan(guard)
    expect(fn).toContain(
      "REVOKE EXECUTE ON FUNCTION public.stamp_listing_deactivation() FROM PUBLIC, anon, authenticated"
    )
  })

  it("marks the test client by email, never by a hardcoded id", () => {
    expect(SQL).toContain("lower(email) = 'rm@blackbirdhm.com'")
    expect(SQL).not.toContain("4a7a9305")
  })

  it("leaves Runner Rd out of the executable SQL", () => {
    expect(SQL).not.toContain("2e569369")
    expect(SQL).not.toContain("Runner Rd")
  })
})
