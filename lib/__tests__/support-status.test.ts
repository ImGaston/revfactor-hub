import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { friendlyStatusError, validateStatusChange, validateSupportNote } from "@/lib/support-status"

describe("validateStatusChange", () => {
  const base = { current: "open" as const, merged: false, note: "Handled on the Oct 3 call with Michelle" }

  it("resolves outside the Hub with a note", () => {
    expect(validateStatusChange({ ...base, status: "resolved" })).toEqual({
      status: "resolved",
      note: "Handled on the Oct 3 call with Michelle",
      dismissReason: null,
    })
  })

  it("needs a reason to dismiss, and keeps it", () => {
    expect(validateStatusChange({ ...base, status: "dismissed" })).toEqual({ error: "Pick a reason for dismissing" })
    expect(validateStatusChange({ ...base, status: "dismissed", dismissReason: "handled_offline" })).toMatchObject({
      status: "dismissed",
      dismissReason: "handled_offline",
    })
    expect(validateStatusChange({ ...base, status: "dismissed", dismissReason: "bogus" })).toEqual({
      error: "Pick a reason for dismissing",
    })
  })

  it("reopens closed tickets but never sets triage or answered directly", () => {
    expect(validateStatusChange({ ...base, current: "resolved", status: "open" })).toMatchObject({ status: "open" })
    for (const status of ["new", "answered", "whatever"]) {
      expect(validateStatusChange({ ...base, status })).toEqual({ error: "Pick a status" })
    }
  })

  it("rejects no-op changes, merged tickets, and short or sensitive notes", () => {
    expect(validateStatusChange({ ...base, status: "open" })).toMatchObject({ error: expect.stringContaining("already") })
    expect(validateStatusChange({ ...base, merged: true, status: "resolved" })).toMatchObject({
      error: expect.stringContaining("merged"),
    })
    expect(validateStatusChange({ ...base, status: "resolved", note: "ok" })).toMatchObject({ error: expect.any(String) })
    const leaked = validateStatusChange({ ...base, status: "resolved", note: "Reset it, pw: hunter22" })
    expect(leaked).toMatchObject({ error: expect.stringContaining("Remove the") })
    if ("error" in leaked) expect(leaked.error).not.toContain("hunter22")
  })
})

describe("validateSupportNote", () => {
  it("trims and bounds notes", () => {
    expect(validateSupportNote("  Client confirmed by email  ")).toEqual({ note: "Client confirmed by email" })
    expect(validateSupportNote("a".repeat(1001))).toMatchObject({ error: expect.any(String) })
  })
})

describe("friendlyStatusError", () => {
  it("passes the database's own messages through and hides the rest", () => {
    expect(friendlyStatusError("Only a super admin can change a ticket's status directly")).toContain("Only a super admin")
    expect(friendlyStatusError('relation "x" does not exist')).toBe("Couldn't change the status. Try again.")
  })
})

describe("status override migration", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), "supabase/migrations", file), "utf8")
  const strip = (raw: string) =>
    raw
      .split("\n")
      .map((line) => (line.includes("--") ? line.slice(0, line.indexOf("--")) : line))
      .join("\n")
      .replace(/[ \t]+/g, " ")
  const SQL = strip(read("20261007150000_support_status_override.sql"))
  const PREVIOUS = strip(read("20261001120000_support_check_ins.sql"))
  const guardMessages = (sql: string) => {
    const start = sql.indexOf("FUNCTION public.support_ticket_guard()")
    return [...sql.slice(start, sql.indexOf("$$;", start)).matchAll(/RAISE EXCEPTION '((?:[^']|'')+)'/g)].map((m) => m[1])
  }

  it("keeps every earlier resolve rule and adds the super-admin path", () => {
    const before = guardMessages(PREVIOUS)
    const after = guardMessages(SQL)
    expect(after).toEqual(expect.arrayContaining(before))
    expect(after).toContain("Only a super admin can resolve a ticket outside the Hub")
    expect(SQL).toContain("COALESCE((NEW.verification->>'outside_hub')::boolean, FALSE)")
    expect(SQL).toContain("REVOKE EXECUTE ON FUNCTION public.support_ticket_guard() FROM PUBLIC, anon, authenticated")
  })

  it("runs status changes as the caller, checks the role, and is closed to anon", () => {
    const fn = SQL.slice(SQL.indexOf("FUNCTION public.set_support_ticket_status("))
    expect(fn).toContain("SECURITY INVOKER")
    expect(fn).toContain("public.get_my_role() IS DISTINCT FROM 'super_admin'")
    expect(SQL).toContain("REVOKE EXECUTE ON FUNCTION public.set_support_ticket_status(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon")
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.set_support_ticket_status(UUID, TEXT, TEXT, TEXT) TO authenticated")
    expect(SQL).not.toMatch(/CREATE POLICY|SECURITY DEFINER\s*\n\s*SET search_path = public\s*\nAS \$\$\s*\nDECLARE/)
  })
})

describe("status actions boundary", () => {
  const actions = readFileSync(path.join(process.cwd(), "app/(authenticated)/support/status-actions.ts"), "utf8")
  it("are server actions on the user's session, gated to super admins before any write", () => {
    expect(actions.startsWith('"use server"')).toBe(true)
    expect(actions).not.toContain("createAdminClient")
    for (const name of ["setSupportStatusAction", "addSupportNoteAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${name}`))
      expect(body.indexOf("await superAdmin()")).toBeGreaterThan(-1)
      expect(body.indexOf("await superAdmin()")).toBeLessThan(body.indexOf("createClient()"))
    }
    expect(actions).toContain('profile.role !== "super_admin"')
  })
})
