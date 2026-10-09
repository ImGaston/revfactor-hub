// The client's ask, digested: the whole client thread on a ticket (tickets
// merged into it included) rewritten in ASD-STE100 Simplified Technical
// English, plus the comps the client sent, the likely properties, and the
// gaps to close before answering. Pure and client-safe: the model call lives
// in lib/support-ask-plain.server.ts.

import { z } from "zod"

import { SUPPORT_ANSWER_MODEL_ID } from "@/lib/support-answers"
import { messageSegments } from "@/lib/support-message"
import { redactSupportText, stableHash } from "@/lib/support-tickets"

export const SUPPORT_ASK_PLAIN_MODEL_ID = SUPPORT_ANSWER_MODEL_ID
/** Bumped when the inputs or output change, so saved digests are rewritten. */
export const SUPPORT_ASK_DIGEST_VERSION = 2
/** ASD-STE100 caps descriptive sentences at 25 words. */
export const SUPPORT_ASK_PLAIN_MAX_WORDS = 25
/** Newest client messages sent to the model. */
export const SUPPORT_ASK_THREAD_MAX = 20
const SENTENCE_MAX = 240

const sentence = z.string().trim().min(1).max(SENTENCE_MAX)

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One client message: the ticket's own ask, a later client message, or a merged ticket's ask. */
export type AskThreadMessage = { at: string; text: string; ticketNumber: number; merged: boolean }

export type AskListing = {
  id: string
  name: string
  city: string | null
  state: string | null
  bedrooms: number | null
  status: string | null
}

export type AskLinkFact = {
  ref: string
  label: string
  platform: "airbnb" | "vrbo" | "booking" | "other"
  roomId: string | null
  /** The capture bot removed part of the link (usually the room ID) */
  idRemoved: boolean
  checkIn: string | null
  checkOut: string | null
  guests: number | null
  sentAt: string
}

function platformOf(host: string): AskLinkFact["platform"] {
  if (/airbnb\./i.test(host)) return "airbnb"
  if (/vrbo\.|homeaway\./i.test(host)) return "vrbo"
  if (/booking\.com/i.test(host)) return "booking"
  return "other"
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Platform, room ID, and booking-search facts (dates, guests) from one link. */
export function linkFacts(raw: string): Omit<AskLinkFact, "ref" | "label" | "sentAt"> {
  const idRemoved = /\[redacted/i.test(raw)
  const [base, query = ""] = raw.split("?", 2)
  const host = base.replace(/^https?:\/\//i, "").split("/")[0] ?? ""
  const platform = platformOf(host)
  const roomMatch =
    platform === "airbnb" ? base.match(/\/rooms\/(?:plus\/)?(\d{5,})/) : platform === "vrbo" ? base.match(/\/(\d{5,})(?:ha)?(?:[/?#]|$)/) : null
  const params = new URLSearchParams(query.split("#")[0])
  const pick = (...keys: string[]) => keys.map((k) => params.get(k)).find((v) => v && DATE_RE.test(v)) ?? null
  const num = (key: string) => {
    const n = Number(params.get(key))
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const guestsTotal = num("adults") + num("children") || num("guests") || num("numberOfGuests")
  return {
    platform,
    roomId: roomMatch?.[1] ?? null,
    idRemoved,
    checkIn: pick("check_in", "checkin", "startDate", "arrival"),
    checkOut: pick("check_out", "checkout", "endDate", "departure"),
    guests: guestsTotal || null,
  }
}

const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

/**
 * Swaps every link in the thread for `[L1]`, `[L2]`…, collecting its facts
 * first: redaction strips query strings, so this is the only place the
 * search dates and guest count survive. The text is redacted after.
 */
export function prepareAskThread(
  messages: AskThreadMessage[],
  refPrefix = "L"
): {
  lines: string[]
  links: AskLinkFact[]
} {
  const links: AskLinkFact[] = []
  const lines = messages.map((m) => {
    let text = ""
    for (const seg of messageSegments(m.text)) {
      if (seg.type === "text") {
        text += seg.text
        continue
      }
      const raw = seg.type === "link" ? seg.href : seg.raw
      const ref = `${refPrefix}${links.length + 1}`
      links.push({ ref, label: seg.label, sentAt: m.at, ...linkFacts(raw) })
      text += `[${ref}]`
    }
    const from = m.merged ? `#${m.ticketNumber}, merged` : `#${m.ticketNumber}`
    return `(${shortDay(m.at)}, ${from}) ${redactSupportText(text)}`
  })
  return { lines, links }
}

export function describeLink(l: AskLinkFact): string {
  const parts = [
    { airbnb: "an Airbnb listing", vrbo: "a Vrbo listing", booking: "a Booking.com listing", other: "a web link" }[l.platform],
    l.roomId ? `room ID ${l.roomId}` : l.idRemoved ? "room ID removed by the capture bot" : null,
    l.checkIn && l.checkOut ? `search dates ${l.checkIn} to ${l.checkOut}` : null,
    l.guests ? `${l.guests} guests` : null,
  ]
  return parts.filter(Boolean).join(", ")
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export const supportAskPlainSchema = z.object({
  wants: z.array(sentence).min(1).max(5),
  says: z.array(sentence).max(5),
  comps: z
    .array(
      z.object({
        link: z.string().nullable(),
        note: sentence,
        listingId: z.string().nullable(),
      })
    )
    .max(6),
  properties: z
    .array(
      z.object({
        listingId: z.string(),
        confidence: z.enum(["high", "medium", "low"]),
        reason: sentence,
      })
    )
    .max(4),
  gaps: z.array(sentence).max(5),
  mixedProperties: z.string().trim().max(SENTENCE_MAX).nullable(),
})
export type SupportAskPlainOutput = z.infer<typeof supportAskPlainSchema>

/** What the page shows; `details` is the stored JSONB. */
export type SupportAskDigest = {
  wants: string[]
  says: string[]
  details: SupportAskDigestDetails
}
export type SupportAskDigestDetails = {
  version?: number
  comps?: { link: AskLinkFact | null; note: string; listing: { id: string; name: string } | null }[]
  properties?: { listing: { id: string; name: string }; confidence: "high" | "medium" | "low"; reason: string }[]
  gaps?: string[]
  mixedProperties?: string | null
}

/** Drops listing IDs and link refs the model invented, and attaches names and link facts. */
export function toAskDigest(
  output: SupportAskPlainOutput,
  listings: AskListing[],
  links: AskLinkFact[]
): SupportAskDigest {
  const listingById = new Map(listings.map((l) => [l.id, { id: l.id, name: l.name }]))
  const linkByRef = new Map(links.map((l) => [l.ref, l]))
  const seen = new Set<string>()
  return {
    wants: output.wants,
    says: output.says,
    details: {
      version: SUPPORT_ASK_DIGEST_VERSION,
      comps: output.comps.map((c) => ({
        link: (c.link && linkByRef.get(c.link.replace(/[[\]]/g, ""))) || null,
        note: c.note,
        listing: (c.listingId && listingById.get(c.listingId)) || null,
      })),
      properties: output.properties
        .filter((p) => listingById.has(p.listingId) && !seen.has(p.listingId) && seen.add(p.listingId))
        .map((p) => ({ listing: listingById.get(p.listingId)!, confidence: p.confidence, reason: p.reason })),
      gaps: output.gaps,
      mixedProperties: output.mixedProperties || null,
    },
  }
}

export const SUPPORT_ASK_PLAIN_INSTRUCTIONS = `You help RevFactor, a short-term rental revenue management team, understand what a client (a property owner) is asking. You get every message the client wrote on one support ticket, oldest first, the client's listings, and facts about the links the client sent. Links appear as [L1], [L2]… in the messages.

Return:
- wants: what the client wants to know or wants us to do, across the whole thread. 1 to 5 sentences. Start each with "The client asks" or "The client wants".
- says: the facts, comparisons, and feelings the client gives as context. 0 to 5 sentences. Start each with "The client says", or "The client thinks" for an opinion.
- comps: each competitor or comparable listing the client sent or described. link is its [L#] ref (just "L1") or null if the client only described it. note says in one sentence what the client says about it. listingId is the client's own listing it is compared to, or null if you cannot tell.
- properties: which of the client's listings the ticket is about. Use only listing ids from the list. confidence is high only when the message names it or the evidence is clear (location, property type, bedrooms, guest count, a unique detail). reason gives that evidence in one sentence.
- gaps: what RevFactor must still find out or check before it can answer, in one sentence each (for example: which property, a missing link, an unclear direction such as "higher or lower prices"). Do not invent tasks.
- mixedProperties: one sentence if the thread asks about two or more different properties that need separate answers; otherwise null.

Write every sentence in ASD-STE100 Simplified Technical English:
- One idea in each sentence. No more than 20 words in a sentence, and never more than 25.
- Use the active voice and simple tenses. Use simple, common words, no idioms or slang.
- Use the same word for the same thing every time ("nightly rate", not "price" then "rate").
- Keep property names, dates, numbers, and percentages exactly as written.
- When the client says "this property", decide from context if it is the client's own listing or a comp, and say which.

Do not add facts, guesses, or advice that the messages and listings do not support. Do not answer the client. If a message is not in English, translate it. "[redacted: credential]" means the capture bot removed a value.`

export function buildAskPlainPrompt(
  input: {
    ticketNumber: number
    summary: string
    category: string
    requestType: string
    listings: AskListing[]
    lines: string[]
    links: AskLinkFact[]
  },
  violations: string[] = []
): string {
  const listings = describeListings(input.listings)
  const links = input.links.length ? input.links.map((l) => `[${l.ref}] ${describeLink(l)}`).join("\n") : "(none)"
  const parts = [
    `Ticket #${input.ticketNumber} (${input.category}, ${input.requestType}): ${redactSupportText(input.summary)}`,
    `Client listings:\n${listings}`,
    `Links in the messages:\n${links}`,
    `Client messages, oldest first:\n${input.lines.join("\n")}`,
  ]
  if (violations.length)
    parts.push(`Your last version broke these rules. Fix them:\n${violations.map((v) => `- ${v}`).join("\n")}`)
  return parts.join("\n\n")
}

/** One line per listing, for prompts. */
export function describeListings(listings: AskListing[]): string {
  if (!listings.length) return "(none visible)"
  return listings
    .map((l) => {
      const place = [l.city, l.state].filter(Boolean).join(", ")
      return `- id=${l.id} "${l.name}"${place ? `, ${place}` : ""}${l.bedrooms ? `, ${l.bedrooms} bedrooms` : ""}${l.status && l.status !== "active" ? ` (${l.status})` : ""}`
    })
    .join("\n")
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length

/** Sentences over the ASD-STE100 length cap, phrased for a retry prompt. */
export function askPlainViolations(output: Pick<SupportAskPlainOutput, "wants" | "says" | "gaps">): string[] {
  return [...output.wants, ...output.says, ...output.gaps]
    .filter((s) => wordCount(s) > SUPPORT_ASK_PLAIN_MAX_WORDS)
    .map((s) => `Too long (${wordCount(s)} words, max ${SUPPORT_ASK_PLAIN_MAX_WORDS}): "${s}"`)
}

/**
 * Ties a saved digest to its inputs: the version, every client message, and
 * the client's listings. A new message, a merge, or a listing change rewrites it.
 */
export function askDigestHash(messages: AskThreadMessage[], listings: Pick<AskListing, "id">[]): string {
  return stableHash(
    [
      `v${SUPPORT_ASK_DIGEST_VERSION}`,
      ...messages.map((m) => `${m.at}|${m.ticketNumber}|${m.text}`),
      listings
        .map((l) => l.id)
        .sort()
        .join(","),
    ].join("\n")
  )
}

/** Oldest first, repeats dropped (an ask can also be logged as a message), newest {@link SUPPORT_ASK_THREAD_MAX} kept. */
export function orderAskThread(messages: AskThreadMessage[]): AskThreadMessage[] {
  const seen = new Set<string>()
  return [...messages]
    .filter((m) => m.text.trim())
    .sort((a, b) => a.at.localeCompare(b.at))
    .filter((m) => {
      const key = m.text.trim().toLowerCase().replace(/\s+/g, " ")
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(-SUPPORT_ASK_THREAD_MAX)
}
