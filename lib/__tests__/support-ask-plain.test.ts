import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  SUPPORT_ASK_PLAIN_MAX_WORDS,
  askPlainSourceHash,
  askPlainViolations,
  buildAskPlainPrompt,
  supportAskPlainSchema,
} from "@/lib/support-ask-plain"
import { messageSegments, shortLinkLabel, supportAssemblyThreadUrl } from "@/lib/support-message"

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8")

describe("messageSegments", () => {
  it("turns Assembly's [url](url) into one short link", () => {
    const url = "https://www.airbnb.com/rooms/1234567890123456789?check_in=2026-12-22&guests=9"
    const segs = messageSegments(`Its higher than others [${url}](${url}) i dont understand`)
    expect(segs).toEqual([
      { type: "text", text: "Its higher than others " },
      { type: "link", href: url, label: "airbnb.com/rooms/1234567890123456789" },
      { type: "text", text: " i dont understand" },
    ])
  })

  it("shows a link the capture bot redacted as one broken link, not a wall of text", () => {
    const url = "https://www.airbnb.com/rooms/[redacted: credential]?check_in=2026-12-22&unique_share_id=828c"
    const segs = messageSegments(`see [${url}](${url}) thanks`)
    expect(segs).toEqual([
      { type: "text", text: "see " },
      { type: "broken-link", label: "airbnb.com/rooms/…" },
      { type: "text", text: " thanks" },
    ])
  })

  it("links bare URLs without their trailing punctuation", () => {
    const segs = messageSegments("Look at https://vrbo.com/12345. Thanks")
    expect(segs[1]).toEqual({ type: "link", href: "https://vrbo.com/12345", label: "vrbo.com/12345" })
    expect(segs[2]).toEqual({ type: "text", text: ". Thanks" })
  })

  it("keeps a named markdown link's name", () => {
    expect(messageSegments("[my listing](https://airbnb.com/rooms/42)")).toEqual([
      { type: "link", href: "https://airbnb.com/rooms/42", label: "my listing" },
    ])
  })

  it("leaves plain text and redaction markers in text as they are", () => {
    const text = "Door code is [redacted: credential], see you"
    expect(messageSegments(text)).toEqual([{ type: "text", text }])
    expect(messageSegments(null)).toEqual([])
  })

  it("caps long labels", () => {
    expect(shortLinkLabel(`https://example.com/${"a".repeat(100)}`).length).toBeLessThanOrEqual(60)
  })
})

describe("supportAssemblyThreadUrl", () => {
  it("prefers the company chat, then the client chat", () => {
    expect(supportAssemblyThreadUrl({ assembly_company_id: "co1", assembly_client_id: "cl1" })).toBe(
      "https://dashboard.assembly.com/companies/co1/messages"
    )
    expect(supportAssemblyThreadUrl({ assembly_company_id: null, assembly_client_id: "cl1" })).toBe(
      "https://dashboard.assembly.com/clients/users/details/cl1/messages"
    )
    expect(supportAssemblyThreadUrl({ assembly_company_id: null, assembly_client_id: null })).toBeNull()
    expect(supportAssemblyThreadUrl(null)).toBeNull()
  })
})

describe("plain-English ask", () => {
  it("needs 1–5 wants and at most 5 context sentences", () => {
    expect(supportAskPlainSchema.safeParse({ wants: [], says: [] }).success).toBe(false)
    expect(supportAskPlainSchema.safeParse({ wants: ["a", "b", "c", "d", "e", "f"], says: [] }).success).toBe(false)
    expect(supportAskPlainSchema.safeParse({ wants: ["The client asks why rates are high."], says: [] }).success).toBe(true)
  })

  it(`flags sentences over ${SUPPORT_ASK_PLAIN_MAX_WORDS} words for a retry`, () => {
    const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ")
    expect(askPlainViolations({ wants: ["The client asks for a review."], says: [long] })).toHaveLength(1)
    expect(askPlainViolations({ wants: ["The client asks for a review."], says: [] })).toEqual([])
  })

  it("redacts the message before it goes to the model", () => {
    const prompt = buildAskPlainPrompt("pw: hunter22 see https://airbnb.com/rooms/1?check_in=2026-12-22 call 555-201-4477")
    expect(prompt).not.toContain("hunter22")
    expect(prompt).not.toContain("check_in")
    expect(prompt).toContain("***-***-4477")
  })

  it("ties a saved version to the message text, ignoring spacing and case", () => {
    expect(askPlainSourceHash("Why  is my rate HIGH?")).toBe(askPlainSourceHash("why is my rate high?"))
    expect(askPlainSourceHash("Why is my rate high?")).not.toBe(askPlainSourceHash("Why is my rate low?"))
  })
})

describe("plain-ask boundaries", () => {
  it("uses the session client and gates on support permissions", () => {
    for (const path of ["lib/support-ask-plain.server.ts", "app/(authenticated)/support/ask-actions.ts"]) {
      const source = read(path)
      expect(source).not.toContain("createAdminClient")
      expect(source).not.toContain("@/lib/supabase/admin")
    }
    const action = read("app/(authenticated)/support/ask-actions.ts")
    expect(action).toContain('hasPermission("support", "view")')
    expect(action).toContain('hasPermission("support", "edit")')
  })

  it("the migration is RLS-gated on support permissions with no open policy", () => {
    const sql = read("supabase/migrations/20261009150000_support_ask_plain.sql")
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY")
    expect(sql).not.toMatch(/USING\s*\(\s*true\s*\)/i)
    expect(sql).toContain("has_permission('support', 'view')")
    expect(sql).toContain("has_permission('support', 'edit') AND generated_by = auth.uid()")
    expect(sql).not.toMatch(/ALTER TABLE support_tickets/i)
  })
})
