import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { friendlyDbError, triageBlockers, validateNote, validateVerification } from "@/lib/support-workflow"

const NOW = new Date("2026-10-08T15:00:00Z")

describe("close-out rules", () => {
  it("blocks accepting triage until the property is confirmed", () => {
    expect(triageBlockers({ status: "new", property_scope: "unknown", property_validated_at: null })).toEqual([
      "Pick the property first",
    ])
    expect(triageBlockers({ status: "new", property_scope: "listings", property_validated_at: NOW.toISOString() })).toEqual([])
    expect(triageBlockers({ status: "open", property_scope: "unknown", property_validated_at: null })).toEqual([])
  })

  it("requires notes only where asked, and never stores credentials", () => {
    expect(validateNote("", "a note", false)).toEqual({ value: null })
    expect(validateNote("  ", "what's missing", true)).toEqual({ error: "Add what's missing" })
    expect(validateNote(" Client changed plans ", "a note", true)).toEqual({ value: "Client changed plans" })
    const leaked = validateNote("Use pw: hunter22", "a note", true)
    expect(leaked).toMatchObject({ error: expect.stringContaining("Remove the") })
    if ("error" in leaked) expect(leaked.error).not.toContain("hunter22")
  })

  it("verifies only with every check, and a reason for a flagged answer", () => {
    const all = ["right_property", "answers_ask", "specific"]
    expect(validateVerification({ request_type: "question", answer_check_verdict: "pass" }, all.slice(0, 2), null, NOW)).toEqual({
      error: "Tick every check before resolving",
    })
    expect(validateVerification({ request_type: "question", answer_check_verdict: "pass" }, all, null, NOW)).toEqual({
      verification: { checks: all, verified_at: NOW.toISOString() },
    })
    expect(validateVerification({ request_type: "question", answer_check_verdict: "uncertain" }, all, "ok", NOW)).toMatchObject({
      error: expect.any(String),
    })
    expect(
      validateVerification({ request_type: "question", answer_check_verdict: "fail" }, all, "Client confirmed on a call", NOW)
    ).toMatchObject({ verification: { override_reason: "Client confirmed on a call" } })
    expect(validateVerification({ request_type: "change", answer_check_verdict: null }, all, null, NOW)).toEqual({
      error: "Tick every check before resolving",
    })
    expect(
      validateVerification({ request_type: "check_in", answer_check_verdict: null }, ["client_replied", "outcome_recorded"], null, NOW)
    ).toMatchObject({ verification: { checks: ["client_replied", "outcome_recorded"] } })
  })

  it("passes the database guard's messages through and hides everything else", () => {
    expect(friendlyDbError("Close or cancel every open promise before resolving")).toBe("Close or cancel every open promise")
    expect(friendlyDbError('new row violates row-level security policy for table "support_tickets"')).toBe(
      "You don't have permission to do that"
    )
    expect(friendlyDbError('duplicate key value violates unique constraint "x"')).toBe("Something went wrong. Try again.")
  })
})

describe("close-out actions boundary", () => {
  const actions = readFileSync(path.join(process.cwd(), "app/(authenticated)/support/close-actions.ts"), "utf8")
  const exported = [...actions.matchAll(/export async function (\w+)\(/g)].map((m) => m[1])
  const body = (name: string) => {
    const start = actions.indexOf(`export async function ${name}(`)
    const next = actions.indexOf("export async function", start + 1)
    return actions.slice(start, next === -1 ? undefined : next)
  }

  it("are server actions on the user's session, never the admin client", () => {
    expect(actions.startsWith('"use server"')).toBe(true)
    expect(actions).not.toContain("createAdminClient")
    expect(exported).toEqual(
      expect.arrayContaining([
        "confirmSupportPropertyAction",
        "acceptSupportTriageAction",
        "markSupportToldLiveAction",
        "closeSupportPromiseAction",
        "verifySupportTicketAction",
        "sendBackSupportTicketAction",
      ])
    )
  })

  it("check a permission before every write, and verify rights to resolve or send back", () => {
    for (const name of exported) expect(body(name), name).toMatch(/openTicket\(|session\(/)
    for (const name of ["verifySupportTicketAction", "sendBackSupportTicketAction"]) expect(body(name)).toContain('"control")')
  })

  it("log every change with the signed-in user as actor", () => {
    expect(actions).toContain("actor_id: user.id")
  })
})
