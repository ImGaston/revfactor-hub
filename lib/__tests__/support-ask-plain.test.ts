import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  SUPPORT_ASK_PLAIN_MAX_WORDS,
  askDigestHash,
  askPlainViolations,
  buildAskPlainPrompt,
  linkFacts,
  orderAskThread,
  prepareAskThread,
  supportAskPlainSchema,
  toAskDigest,
  type AskListing,
  type AskThreadMessage,
} from "@/lib/support-ask-plain"
import { buildMergeCheckPrompt, supportMergeCheckSchema } from "@/lib/support-merge-check"
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
      { type: "broken-link", label: "airbnb.com/rooms/…", raw: url },
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

const CHALET: AskListing = { id: "l-chalet", name: "Moonlight Chalet | TN", city: "Gatlinburg", state: "TN", bedrooms: 3, status: "active" }
const CONDO: AskListing = { id: "l-awa", name: "AWA 111", city: "Playa del Carmen", state: null, bedrooms: 2, status: "active" }
const msg = (at: string, text: string, ticketNumber = 12, merged = false): AskThreadMessage => ({ at, text, ticketNumber, merged })
const REDACTED_COMP =
  "https://www.airbnb.com/rooms/[redacted: credential]?check_in=2026-12-22&check_out=2026-12-29&guests=9&adults=5&children=4"

describe("link facts", () => {
  it("keeps the search dates and guests from a link the bot redacted", () => {
    expect(linkFacts(REDACTED_COMP)).toEqual({
      platform: "airbnb",
      roomId: null,
      idRemoved: true,
      checkIn: "2026-12-22",
      checkOut: "2026-12-29",
      guests: 9,
    })
  })

  it("reads room IDs from Airbnb and Vrbo links", () => {
    expect(linkFacts("https://www.airbnb.com/rooms/1177715267315092510?guests=4")).toMatchObject({ roomId: "1177715267315092510", guests: 4 })
    expect(linkFacts("https://www.vrbo.com/1234567ha")).toMatchObject({ platform: "vrbo", roomId: "1234567" })
    expect(linkFacts("https://example.com/x")).toMatchObject({ platform: "other", roomId: null, checkIn: null })
  })
})

describe("the ask thread", () => {
  it("swaps links for refs before redacting, so dates survive and URLs do not", () => {
    const { lines, links } = prepareAskThread([
      msg("2026-09-22T17:48:00Z", `Its higher than others [${REDACTED_COMP}](${REDACTED_COMP}) pw: hunter22`),
      msg("2026-10-02T09:32:00Z", "Set a floor for slow season", 84, true),
    ])
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ ref: "L1", checkIn: "2026-12-22", guests: 9, idRemoved: true })
    expect(lines[0]).toContain("[L1]")
    expect(lines[0]).not.toContain("check_in")
    expect(lines[0]).not.toContain("hunter22")
    expect(lines[1]).toMatch(/^\(Oct 2, #84, merged\)/)
  })

  it("orders oldest first and drops a repeated ask", () => {
    const thread = orderAskThread([
      msg("2026-10-02T00:00:00Z", "later"),
      msg("2026-09-22T00:00:00Z", "The  ask"),
      msg("2026-09-22T00:00:01Z", "the ask"),
      msg("2026-09-23T00:00:00Z", "   "),
    ])
    expect(thread.map((m) => m.text)).toEqual(["The  ask", "later"])
  })

  it("rewrites the digest when a message, a merge, or a listing changes", () => {
    const base = [msg("2026-09-22T00:00:00Z", "ask")]
    const hash = askDigestHash(base, [CHALET])
    expect(askDigestHash(base, [CHALET])).toBe(hash)
    expect(askDigestHash([...base, msg("2026-10-02T00:00:00Z", "more")], [CHALET])).not.toBe(hash)
    expect(askDigestHash([...base, msg("2026-10-02T00:00:00Z", "more", 84, true)], [CHALET])).not.toBe(
      askDigestHash([...base, msg("2026-10-02T00:00:00Z", "more")], [CHALET])
    )
    expect(askDigestHash(base, [CHALET, CONDO])).not.toBe(hash)
  })

  it("gives the model the listings and link facts, not raw URLs", () => {
    const { lines, links } = prepareAskThread([msg("2026-09-22T17:48:00Z", `see ${REDACTED_COMP}`)])
    const prompt = buildAskPlainPrompt({
      ticketNumber: 12,
      summary: "Re-review pricing",
      category: "pricing",
      requestType: "change",
      listings: [CHALET, CONDO],
      lines,
      links,
    })
    expect(prompt).toContain('id=l-chalet "Moonlight Chalet | TN", Gatlinburg, TN, 3 bedrooms')
    expect(prompt).toContain("[L1] an Airbnb listing, room ID removed by the capture bot, search dates 2026-12-22 to 2026-12-29, 9 guests")
    expect(prompt).not.toContain("airbnb.com/rooms")
  })
})

describe("the digest", () => {
  const output = {
    wants: ["The client wants rates closer to her comps."],
    says: [],
    comps: [
      { link: "L1", note: "The client says this cabin is as private as hers.", listingId: "l-chalet" },
      { link: null, note: "The client says the same unit hosts 4.", listingId: "l-made-up" },
    ],
    properties: [
      { listingId: "l-chalet", confidence: "high" as const, reason: "Private cabin." },
      { listingId: "l-chalet", confidence: "low" as const, reason: "Repeat." },
      { listingId: "l-made-up", confidence: "high" as const, reason: "Invented." },
    ],
    gaps: ["Find the comp room ID in Assembly."],
    mixedProperties: "The thread covers the chalet and the condo.",
  }

  it("keeps only real listings and links, once each", () => {
    const { links } = prepareAskThread([msg("2026-09-22T17:48:00Z", REDACTED_COMP)])
    const digest = toAskDigest(output, [CHALET, CONDO], links)
    expect(digest.details.properties).toEqual([
      { listing: { id: "l-chalet", name: "Moonlight Chalet | TN" }, confidence: "high", reason: "Private cabin." },
    ])
    expect(digest.details.comps?.[0]).toMatchObject({ link: { ref: "L1", guests: 9 }, listing: { id: "l-chalet" } })
    expect(digest.details.comps?.[1]).toMatchObject({ link: null, listing: null })
    expect(digest.details.mixedProperties).toBe("The thread covers the chalet and the condo.")
    expect(supportAskPlainSchema.safeParse(output).success).toBe(true)
  })

  it(`flags sentences over ${SUPPORT_ASK_PLAIN_MAX_WORDS} words, gaps included`, () => {
    const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ")
    expect(askPlainViolations({ wants: ["The client asks for a review."], says: [], gaps: [long] })).toHaveLength(1)
    expect(askPlainViolations({ wants: ["The client asks for a review."], says: [], gaps: [] })).toEqual([])
  })

  it("needs at least one want", () => {
    expect(supportAskPlainSchema.safeParse({ ...output, wants: [] }).success).toBe(false)
  })
})

describe("merge check", () => {
  it("shows the model both tickets with separate link refs", () => {
    const ticket = (n: number, text: string) => ({
      ticketNumber: n,
      summary: `Ticket ${n}`,
      category: "pricing",
      requestType: "change",
      property: "Not identified yet",
      openPromises: n === 12 ? ["Review pricing against these properties"] : [],
      messages: [msg("2026-10-02T00:00:00Z", text, n)],
    })
    const prompt = buildMergeCheckPrompt({
      target: ticket(12, `comp ${REDACTED_COMP}`),
      source: ticket(84, "set a floor https://www.airbnb.com/rooms/1071215175803963966"),
      listings: [CONDO],
    })
    expect(prompt).toContain("TARGET (stays open) #12")
    expect(prompt).toContain("SOURCE (closes) #84")
    expect(prompt).toContain("[T1]")
    expect(prompt).toContain("[S1] an Airbnb listing, room ID 1071215175803963966")
    expect(prompt).toContain("Review pricing against these properties")
  })

  it("accepts only same, related, or different", () => {
    const check = { verdict: "related", title: "Pricing review and slow-season floor", adds: [], warning: null }
    expect(supportMergeCheckSchema.safeParse(check).success).toBe(true)
    expect(supportMergeCheckSchema.safeParse({ ...check, verdict: "maybe" }).success).toBe(false)
  })
})

describe("plain-ask boundaries", () => {
  it("uses the session client and gates on support permissions", () => {
    for (const path of [
      "lib/support-ask-plain.server.ts",
      "lib/support-merge-check.server.ts",
      "app/(authenticated)/support/ask-actions.ts",
    ]) {
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
  it("the digest migration only adds a bounded JSONB column", () => {
    const sql = read("supabase/migrations/20261009170000_support_ask_digest.sql")
    expect(sql).toContain("ALTER TABLE support_ticket_ask_plain")
    expect(sql).toContain("ADD COLUMN details JSONB NOT NULL DEFAULT '{}'::jsonb")
    expect(sql).toMatch(/octet_length\(details::text\) <= 20000/)
    expect(sql).not.toMatch(/DROP|ALTER TABLE support_tickets|POLICY/i)
  })

  it("a merge can rename the kept ticket only through the edit-gated merge action", () => {
    const close = read("app/(authenticated)/support/close-actions.ts")
    expect(close).toMatch(/mergeSupportTicketAction\([\s\S]*?session\("edit"\)[\s\S]*?update\(\{ summary: title \}\)/)
    const ask = read("app/(authenticated)/support/ask-actions.ts")
    expect(ask).toMatch(/checkMergeAction[\s\S]*?hasPermission\("support", "edit"\)/)
  })
})
