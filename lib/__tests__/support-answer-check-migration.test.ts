import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

// Text assertions over the migration (not applied to any project yet).

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

const SQL = executable(read("20261004120000_support_answer_check.sql"))
const ORIGINAL = executable(read("20260929160000_support_tickets.sql"))

const NEW_TABLES = ["support_ticket_answers", "support_suggested_answers", "support_answer_checks"]

function eventTypes(sql: string, anchor: string): string[] {
  const start = sql.indexOf(anchor)
  const body = sql.slice(start, sql.indexOf("))", start))
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

function policiesFor(table: string) {
  return [...SQL.matchAll(/CREATE POLICY "[^"]+"\s+ON (\w+) FOR (\w+) TO (\w+)([\s\S]*?);/g)]
    .filter((m) => m[1] === table)
    .map((m) => ({ command: m[2], role: m[3], body: m[4] }))
}

describe("support answer check migration", () => {
  it("adds answer_saved and keeps every existing timeline event type", () => {
    const original = eventTypes(ORIGINAL, "event_type TEXT NOT NULL CHECK (event_type IN (")
    const updated = eventTypes(SQL, "ADD CONSTRAINT support_ticket_events_event_type_check")
    expect(original.length).toBeGreaterThan(20)
    expect(updated.filter((t) => t !== "answer_saved").sort()).toEqual([...original].sort())
    expect(updated).toContain("answer_saved")
    expect(updated).toContain("answer_checked")
  })

  it.each(NEW_TABLES)("%s has RLS on and permission-based policies only", (table) => {
    expect(SQL).toContain(`CREATE TABLE ${table} (`)
    expect(SQL).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
    const policies = policiesFor(table)
    expect(policies.length).toBeGreaterThanOrEqual(2)
    for (const p of policies) {
      expect(p.role).toBe("authenticated")
      expect(p.body).toMatch(/public\.has_permission\('support', '(view|edit)'\)/)
      expect(p.body).not.toMatch(/USING \(\s*true\s*\)|WITH CHECK \(\s*true\s*\)/i)
    }
    expect(policies.find((p) => p.command === "SELECT")?.body).toContain("public.has_permission('support', 'view')")
    expect(policies.some((p) => p.command === "DELETE")).toBe(false)
  })

  it("never trusts the client for who wrote a row", () => {
    const answers = policiesFor("support_ticket_answers")
    expect(answers.find((p) => p.command === "INSERT")?.body).toContain("updated_by = auth.uid()")
    expect(answers.find((p) => p.command === "UPDATE")?.body).toContain("updated_by = auth.uid()")
    expect(policiesFor("support_answer_checks").find((p) => p.command === "INSERT")?.body).toContain("created_by = auth.uid()")
    const drafts = policiesFor("support_suggested_answers")
    for (const command of ["INSERT", "UPDATE"]) {
      const body = drafts.find((p) => p.command === command)?.body ?? ""
      expect(body).toContain("origin = 'manual'")
      expect(body).toContain("created_by = auth.uid()")
    }
  })

  it("keeps checks append-only", () => {
    expect(policiesFor("support_answer_checks").map((p) => p.command).sort()).toEqual(["INSERT", "SELECT"])
  })

  it("allows at most one automatic draft per ticket", () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX uq_support_suggested_answers_automatic\s+ON support_suggested_answers\(ticket_id\) WHERE origin IN \('auto', 'backfill'\)/
    )
  })

  it("stores what the audit needs", () => {
    for (const column of ["answer_snapshot TEXT NOT NULL", "results JSONB NOT NULL", "verdict TEXT NOT NULL", "jev_response JSONB NOT NULL", "request_state JSONB NOT NULL", "model TEXT NOT NULL"]) {
      expect(SQL).toContain(column)
    }
    expect(SQL).toContain("CHECK (verdict IN ('pass', 'fix', 'needs_human'))")
    expect(SQL).toContain("CHECK (origin IN ('auto', 'backfill', 'manual'))")
  })

  it("leaves the ticket table, its guard, and grants alone", () => {
    expect(SQL).not.toMatch(/ALTER TABLE support_tickets\b/)
    expect(SQL).not.toContain("support_ticket_guard")
    expect(SQL).not.toMatch(/\bGRANT\b/)
    expect(SQL).not.toMatch(/\banon\b/)
    expect(SQL).not.toMatch(/SECURITY DEFINER/)
  })
})
