import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

// Structural checks on the capture-bot API. These routes read and write
// through the service-role admin client, so RLS is not a backstop: the scope
// check and the column projection are the whole security boundary.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8")

const ROUTES = [
  { path: "app/api/v1/support-captures/route.ts", scope: "support:write" },
  { path: "app/api/v1/support-tickets/route.ts", scope: "support:read" },
  { path: "app/api/v1/support-tickets/digest/route.ts", scope: "support:read" },
  { path: "app/api/v1/support-listings/route.ts", scope: "support:read" },
]

describe("support API routes", () => {
  it.each(ROUTES)("$path checks the $scope scope first and never caches", ({ path, scope }) => {
    const source = read(path)
    expect(source).toContain(`verifyApiKey(request, "${scope}")`)
    expect(source.indexOf("verifyApiKey(")).toBeLessThan(source.indexOf("createAdminClient()"))
    expect(source).toContain('"Cache-Control": "no-store"')
    expect(source).toContain('export const dynamic = "force-dynamic"')
  })

  it("never leaks internal error text to the bot", () => {
    for (const { path } of ROUTES) {
      expect(read(path)).toContain('"Internal server error"')
    }
  })

  it("registers the support scopes for key issuance", () => {
    expect(read("lib/api-auth.server.ts")).toMatch(/"support:read",\s*"support:write"/)
    expect(read("scripts/create-api-key.ts")).toMatch(/"support:read",\s*"support:write"/)
  })
})

describe("server projection", () => {
  const server = read("lib/support-tickets.server.ts")
  // Executable code only: comments explain what the file avoids
  const code = server
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
  const list = code.slice(code.indexOf("const LIST_COLUMNS"), code.indexOf("type ListRow"))

  it("is server-only and never selects every column", () => {
    expect(server.startsWith('import "server-only"')).toBe(true)
    expect(code).not.toMatch(/select\(\s*["'`]\*["'`]/)
  })

  it("keeps notes, verification, and billing out of the list", () => {
    for (const hidden of [
      "verification",
      "dismiss_note",
      "answer_summary",
      "client_message",
      "support_ticket_events",
      "billing_amount",
      "ai_classification",
    ]) {
      expect(list, `list projection must not include ${hidden}`).not.toMatch(new RegExp(`\\b${hidden}\\b`))
    }
  })

  it("hints every ambiguous embed", () => {
    expect(list).toContain("profiles!support_tickets_assignee_id_fkey")
    expect(list).toContain("clients!support_tickets_client_id_fkey")
    expect(list).toContain("adjustments!adjustments_support_ticket_id_fkey")
  })
})

describe("bot boundaries", () => {
  const planner = read("lib/support-capture.ts")

  it("can never resolve, dismiss, or merge a ticket", () => {
    expect(planner).not.toMatch(/setStatus\("resolved"\)/)
    expect(planner).not.toMatch(/setStatus\("dismissed"\)/)
    expect(planner).not.toContain("merge_support_ticket")
  })

  it("never calls Assembly, PriceLabs, or Adjustments", () => {
    for (const source of [planner, read("lib/support-tickets.server.ts")]) {
      expect(source).not.toMatch(/@\/lib\/(assembly|pricelabs)/)
      expect(source).not.toMatch(/from\("adjustments"\)/)
    }
  })
})
