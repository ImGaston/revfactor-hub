// Client-safe @-mention contract for the RevAI composer. A picked mention is
// inserted as a Markdown link whose Hub path carries the record type and id,
// e.g. `[@Lake House](/listings/<uuid>)`, so the model and the user see the
// same reference and the link stays clickable in the transcript.

export const REVAI_MENTION_KINDS = ["client", "listing", "ticket", "adjustment"] as const
export type RevAiMentionKind = (typeof REVAI_MENTION_KINDS)[number]

export type RevAiMention = {
  kind: RevAiMentionKind
  id: string
  label: string
  detail: string | null
  href: string
}

export const REVAI_MENTION_KIND_LABELS: Record<RevAiMentionKind, string> = {
  client: "Client",
  listing: "Listing",
  ticket: "Ticket",
  adjustment: "Adjustment",
}

export function mentionMarkdown(mention: RevAiMention): string {
  const label = mention.label.replace(/[[\]]/g, "")
  return `[@${label}](${mention.href})`
}

/** The `@query` being typed just before the caret, or null. */
export function activeMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret)
  const match = before.match(/(^|\s)@([^\s@[\]()]{0,40})$/)
  if (!match) return null
  return { query: match[2], start: caret - match[2].length - 1 }
}
