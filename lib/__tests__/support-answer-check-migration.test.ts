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

const NEW_TABLES = [
  "support_ticket_answers",
  "support_suggested_answers",
  "support_answer_checks",
  "support_answer_comparisons",
]

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

describe("support answer migration (blind-first flow)", () => {
  it("keeps every existing timeline event type and adds the answer-flow ones", () => {
    const original = eventTypes(ORIGINAL, "event_type TEXT NOT NULL CHECK (event_type IN (")
    const updated = eventTypes(SQL, "ADD CONSTRAINT support_ticket_events_event_type_check")
    expect(original.length).toBeGreaterThan(20)
    const added = ["answer_saved", "suggestion_unlocked", "answer_finalized"]
    expect(updated.filter((t) => !added.includes(t)).sort()).toEqual([...original].sort())
    for (const t of [...added, "answer_checked"]) expect(updated).toContain(t)
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
    expect(answers.find((p) => p.command === "INSERT")?.body).toContain("first_saved_by = auth.uid()")
    expect(answers.find((p) => p.command === "INSERT")?.body).toContain("updated_by = auth.uid()")
    expect(answers.find((p) => p.command === "UPDATE")?.body).toContain("updated_by = auth.uid()")
    for (const table of ["support_answer_checks", "support_answer_comparisons"]) {
      expect(policiesFor(table).find((p) => p.command === "INSERT")?.body).toContain("created_by = auth.uid()")
    }
    const drafts = policiesFor("support_suggested_answers")
    for (const command of ["INSERT", "UPDATE"]) {
      const body = drafts.find((p) => p.command === command)?.body ?? ""
      expect(body).toContain("origin = 'manual'")
      expect(body).toContain("created_by = auth.uid()")
    }
  })

  it("stores the three versions: blind first answer, the suggestion as shown, and the final", () => {
    for (const column of [
      "first_body TEXT NOT NULL",
      "suggestion_at_unlock JSONB",
      "body TEXT NOT NULL",
      "final_body TEXT",
      "suggestion_at_final JSONB",
      "suggestion_adoption NUMERIC(4, 3)",
    ]) {
      expect(SQL).toContain(column)
    }
    expect(SQL).toContain("used_suggestion TEXT CHECK (used_suggestion IN ('none', 'partly', 'mostly'))")
    expect(SQL).toContain("final_source TEXT CHECK (final_source IN ('mine', 'suggested', 'merged', 'edited'))")
  })

  it("freezes the blind first answer and the unlock snapshot in a trigger", () => {
    const start = SQL.indexOf("FUNCTION public.support_ticket_answer_guard()")
    const body = SQL.slice(start, SQL.indexOf("$$;", start))
    expect(body).toContain("NEW.first_body IS DISTINCT FROM OLD.first_body")
    expect(body).toContain("OLD.suggestion_at_unlock IS NOT NULL")
    expect(body).toContain("COALESCE(auth.uid(), NEW.final_saved_by)")
    expect(SQL).toContain("BEFORE INSERT OR UPDATE ON support_ticket_answers")
    expect(SQL).toContain("REVOKE EXECUTE ON FUNCTION public.support_ticket_answer_guard() FROM PUBLIC, anon, authenticated")
  })

  it("keeps checks and comparisons append-only, with the transport and model recorded", () => {
    for (const table of ["support_answer_checks", "support_answer_comparisons"]) {
      expect(policiesFor(table).map((p) => p.command).sort()).toEqual(["INSERT", "SELECT"])
    }
    expect(SQL).toContain("target TEXT NOT NULL CHECK (target IN ('team', 'final'))")
    expect(SQL).toContain("transport TEXT NOT NULL CHECK (transport IN ('gateway', 'typesafe'))")
    expect(SQL).toContain("model_version TEXT")
    expect(SQL).toContain("CHECK (verdict IN ('pass', 'fix', 'needs_human'))")
    expect(SQL).toContain("CHECK (verdict IN ('covered', 'review', 'needs_human'))")
    expect(SQL).toContain("jsonb_array_length(adds) <= 3")
  })

  it("allows at most one automatic draft per ticket", () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX uq_support_suggested_answers_automatic\s+ON support_suggested_answers\(ticket_id\) WHERE origin IN \('auto', 'backfill'\)/
    )
  })

  it("leaves the ticket table, its guard, and grants alone", () => {
    expect(SQL).not.toMatch(/ALTER TABLE support_tickets\b/)
    expect(SQL).not.toContain("support_ticket_guard()")
    expect(SQL).not.toMatch(/\bGRANT\b/)
    expect(SQL).not.toMatch(/\banon\b(?!, authenticated)/)
    expect(SQL).not.toMatch(/SECURITY DEFINER/)
  })
})
