import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

// Text assertions over the migration, following the *-seed.test.ts genre this
// repo already uses. There is no database-backed test harness here, so these
// checks are what keeps the security shape of the migration from regressing.

const RAW = readFileSync(
  path.join(process.cwd(), "supabase/migrations/075_wins.sql"),
  "utf8"
)

/**
 * The migration with `--` comments stripped and whitespace collapsed.
 *
 * Assertions must run against executable SQL, not prose: the file explains in
 * comments why it avoids USING (true) and SECURITY DEFINER, and matching those
 * explanations would make the tests pass or fail on documentation.
 */
const SQL = RAW.split("\n")
  .map((line) => {
    const idx = line.indexOf("--")
    return idx === -1 ? line : line.slice(0, idx)
  })
  .join("\n")
  .replace(/[ \t]+/g, " ")

const TABLES = [
  "win_detection_runs",
  "win_candidates",
  "win_reviews",
  "win_message_drafts",
  "win_events",
]

/** Policy statements, split so each can be inspected on its own. */
function policyStatements(): string[] {
  return SQL.split(/CREATE POLICY/i)
    .slice(1)
    .map((chunk) => `CREATE POLICY${chunk.split(";")[0]}`)
}

describe("075_wins.sql — RLS shape", () => {
  it("enables row level security on every new table", () => {
    for (const table of TABLES) {
      expect(SQL).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
    }
  })

  it("never ships a USING (true) policy", () => {
    // The 038 hardening exists precisely because these were the hole.
    expect(SQL).not.toMatch(/USING\s*\(\s*true\s*\)/i)
    expect(SQL).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i)
  })

  it("gates every policy on has_permission", () => {
    for (const policy of policyStatements()) {
      expect(policy, `policy without has_permission:\n${policy}`).toMatch(
        /has_permission\(\s*'wins'/
      )
    }
  })

  it("scopes every policy to authenticated, never to anon or public", () => {
    for (const policy of policyStatements()) {
      expect(policy).toContain("TO authenticated")
    }
  })

  it("gives every UPDATE policy both USING and WITH CHECK", () => {
    // USING alone lets a row be updated into a state the policy would reject.
    for (const policy of policyStatements()) {
      if (!/FOR UPDATE/i.test(policy)) continue
      expect(policy, `UPDATE policy missing USING:\n${policy}`).toMatch(/USING/)
      expect(policy, `UPDATE policy missing WITH CHECK:\n${policy}`).toMatch(/WITH CHECK/)
    }
  })

  it("keeps the audit tables append-only", () => {
    // No UPDATE/DELETE policy means Postgres denies those by default. That is
    // the mechanism that protects already-copied evidence from a recompute.
    for (const table of ["win_message_drafts", "win_events"]) {
      for (const policy of policyStatements()) {
        if (!policy.includes(`ON ${table}`)) continue
        expect(policy, `${table} must not allow UPDATE or DELETE:\n${policy}`).not.toMatch(
          /FOR (UPDATE|DELETE)/i
        )
      }
    }
  })

  it("binds inserted audit rows to the acting user", () => {
    const eventInsert = policyStatements().find(
      (p) => p.includes("ON win_events") && /FOR INSERT/i.test(p)
    )
    expect(eventInsert).toBeDefined()
    expect(eventInsert!).toContain("actor_id = auth.uid()")

    const draftInsert = policyStatements().find(
      (p) => p.includes("ON win_message_drafts") && /FOR INSERT/i.test(p)
    )
    expect(draftInsert).toBeDefined()
    expect(draftInsert!).toContain("created_by = auth.uid()")
  })
})

describe("075_wins.sql — functions", () => {
  it("does not introduce a SECURITY DEFINER function", () => {
    expect(SQL).not.toMatch(/SECURITY DEFINER/i)
  })

  it("declares the pickup RPC as SECURITY INVOKER", () => {
    expect(SQL).toMatch(/SECURITY INVOKER/i)
  })

  it("checks the permission inside the RPC", () => {
    // The reservations matview cannot carry RLS, so this check is the only
    // gate between an authenticated session and portfolio booking data.
    expect(SQL).toMatch(/has_permission\('wins',\s*'view'\)/)
    expect(SQL).toMatch(/RAISE EXCEPTION/)
    expect(SQL).toContain("42501")
  })

  it("guards the RPC with IS NOT TRUE, never a bare NOT", () => {
    // has_permission is `EXISTS(...) OR get_my_role() = 'super_admin'`, which
    // returns NULL for a session with no profile row. `IF NOT NULL THEN` never
    // enters its branch, so a bare NOT lets an unidentified session straight
    // through. Caught by probing the live function, not by review.
    expect(SQL).toMatch(/has_permission\('wins', 'view'\) IS NOT TRUE/)
    expect(SQL).not.toMatch(/IF NOT public\.has_permission/)
  })

  it("revokes the RPC from public and anon before granting it", () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.wins_pickup_windows\(DATE\) FROM PUBLIC, anon/)
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.wins_pickup_windows\(DATE\) TO authenticated/)
  })

  it("excludes cancelled reservations and the missing-date sentinel", () => {
    expect(SQL).toContain("booking_status = 'booked'")
    expect(SQL).toContain("DATE '1970-01-01'")
  })

  it("detects the matview fan-out rather than silently double-counting", () => {
    expect(SQL).toContain("reservation_key")
    expect(SQL).toMatch(/HAVING count\(\*\) > 1/)
  })
})

describe("075_wins.sql — permission seeds", () => {
  it("uses DO UPDATE so a live database is actually changed", () => {
    // createRole() pre-seeds every combination as FALSE, so DO NOTHING would
    // silently no-op on an existing role.
    expect(SQL).toMatch(/DO UPDATE SET allowed = EXCLUDED\.allowed/)
  })

  it("denies the external roles explicitly", () => {
    for (const role of ["contractor", "marketing", "hostpricing"]) {
      expect(SQL).toContain(role)
    }
  })

  it("starts every admin grant switched off so the permission acts as the rollout flag", () => {
    for (const action of ["view", "create", "edit", "delete", "publish", "control"]) {
      expect(SQL).toMatch(
        new RegExp(`\\('admin',\\s*'wins',\\s*'${action}',\\s*FALSE\\)`)
      )
    }
  })
})

describe("075_wins.sql — semantics", () => {
  it("documents that copied and assembly_opened are not delivery", () => {
    expect(RAW).toMatch(/NEITHER means the message was sent/i)
  })

  it("carries every event type the app writes", () => {
    for (const type of [
      "viewed",
      "message_generated",
      "message_edited",
      "copied",
      "assembly_opened",
      "marked_shared",
      "dismissed",
      "reopened",
    ]) {
      expect(SQL).toContain(`'${type}'`)
    }
  })

  it("makes reruns idempotent on the run key", () => {
    expect(SQL).toMatch(/UNIQUE \(as_of_date, period_start, period_end, rules_version\)/)
  })

  it("hangs review state off the listing so it survives a recompute", () => {
    expect(SQL).toMatch(/UNIQUE \(hub_listing_id\)/)
    expect(SQL).toMatch(/version\s+INTEGER NOT NULL DEFAULT 1/)
  })
})
