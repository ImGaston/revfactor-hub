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

/** What the composer shows for a tag: `@Name`. */
export function mentionText(mention: Pick<RevAiMention, "label">): string {
  return `@${mention.label.replace(/[[\]]/g, "")}`
}

/** Tags whose `@Name` is still in the text (the user may have deleted some). */
export function presentMentions(text: string, tags: RevAiMention[]): RevAiMention[] {
  return tags.filter((tag) => text.includes(mentionText(tag)))
}

/**
 * Turn each `@Name` the user tagged into `[@Name](/listings/<id>)` before
 * sending, so the model gets exact ids while the composer stays readable.
 * Longer names go first so "@Lake House 2" is not split by "@Lake House".
 */
export function expandMentions(text: string, tags: RevAiMention[]): string {
  const ordered = [...presentMentions(text, tags)].sort((a, b) => b.label.length - a.label.length)
  const placeholders: string[] = []
  let result = text
  for (const tag of ordered) {
    const token = mentionText(tag)
    result = result.split(token).join(`\u0000${placeholders.length}\u0000`)
    placeholders.push(mentionMarkdown(tag))
  }
  return result.replace(/\u0000(\d+)\u0000/g, (_, index: string) => placeholders[Number(index)])
}

const HREF_KINDS: Array<[string, RevAiMentionKind]> = [
  ["/clients/", "client"],
  ["/listings/", "listing"],
  ["/support/", "ticket"],
  ["/adjustments/", "adjustment"],
]

/** The record kind a Hub link points at, or null for any other link. */
export function mentionKindFromHref(href: string | undefined): RevAiMentionKind | null {
  if (!href) return null
  return HREF_KINDS.find(([prefix]) => href.startsWith(prefix))?.[1] ?? null
}
