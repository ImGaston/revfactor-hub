// "Check with AI" before merging two support tickets: is it the same ask,
// what does the closing ticket add, and what should the kept ticket be called.
// Pure and client-safe; the model call lives in lib/support-merge-check.server.ts.

import { z } from "zod"

import {
  describeLink,
  describeListings,
  prepareAskThread,
  type AskListing,
  type AskThreadMessage,
} from "@/lib/support-ask-plain"
import { redactSupportText } from "@/lib/support-tickets"

const SENTENCE_MAX = 240

export const supportMergeCheckSchema = z.object({
  verdict: z.enum(["same", "related", "different"]),
  title: z.string().trim().min(3).max(140),
  adds: z.array(z.string().trim().min(1).max(SENTENCE_MAX)).max(5),
  warning: z.string().trim().max(SENTENCE_MAX).nullable(),
})
export type SupportMergeCheck = z.infer<typeof supportMergeCheckSchema>

export const SUPPORT_MERGE_VERDICT_LABEL: Record<SupportMergeCheck["verdict"], string> = {
  same: "Same ask",
  related: "Related asks",
  different: "Different asks",
}

export type MergeCheckTicket = {
  ticketNumber: number
  summary: string
  category: string
  requestType: string
  property: string
  openPromises: string[]
  messages: AskThreadMessage[]
}

export const SUPPORT_MERGE_CHECK_INSTRUCTIONS = `You help RevFactor, a short-term rental revenue management team, decide whether to merge two support tickets from the same client. When merged, the SOURCE ticket closes as a duplicate. Its promises, properties, Adjustments, timeline, and client messages move to the TARGET ticket, which stays open.

Return:
- verdict: "same" if both tickets ask for the same thing; "related" if they are about the same property or topic but ask for different things that one person can answer together; "different" if they are about different properties or unrelated asks.
- title: a short new title for the TARGET ticket that covers what both tickets ask. 12 words or fewer. Plain words, no ticket numbers.
- adds: what the SOURCE ticket adds that the TARGET ticket does not already cover (an ask, a property, dates, a comp, a promise). 0 to 5 sentences.
- warning: one sentence if merging could hide or confuse something (for example two different properties that need separate answers); otherwise null.

Write sentences in ASD-STE100 Simplified Technical English: one idea in each sentence, no more than 20 words, active voice, simple words. Keep property names, dates, and numbers exactly as written. Do not invent facts.`

function describeTicket(label: string, t: MergeCheckTicket, refPrefix: string): string {
  const { lines, links } = prepareAskThread(t.messages, refPrefix)
  return [
    `${label} #${t.ticketNumber} (${t.category}, ${t.requestType}): ${redactSupportText(t.summary)}`,
    `Property on the ticket: ${t.property}`,
    `Open promises: ${t.openPromises.length ? t.openPromises.map((p) => redactSupportText(p)).join("; ") : "none"}`,
    `Links: ${links.length ? links.map((l) => `[${l.ref}] ${describeLink(l)}`).join("; ") : "none"}`,
    `Client messages, oldest first:\n${lines.length ? lines.join("\n") : "(none)"}`,
  ].join("\n")
}

export function buildMergeCheckPrompt(input: {
  target: MergeCheckTicket
  source: MergeCheckTicket
  listings: AskListing[]
}): string {
  return [
    `Client listings:\n${describeListings(input.listings)}`,
    describeTicket("TARGET (stays open)", input.target, "T"),
    describeTicket("SOURCE (closes)", input.source, "S"),
  ].join("\n\n")
}
