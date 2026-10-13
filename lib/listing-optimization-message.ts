// Owner message that goes with a published listing review (client & server safe).
// Deterministic: built from the review's own suggestions, no AI. Staff can edit
// it before "Publish & send"; the edited text is what gets sent.

import {
  OPTIMIZATION_SECTIONS,
  type OptimizationItem,
  type OptimizationPriority,
} from "@/lib/listing-optimization"

const PRIORITY_RANK: Record<OptimizationPriority, number> = { high: 0, medium: 1, low: 2 }
const SECTION_RANK = new Map<string, number>(OPTIMIZATION_SECTIONS.map((s, i) => [s.key, i]))

type MessageItem = Pick<OptimizationItem, "section" | "kind" | "priority" | "sort_order" | "headline">

export const MAX_OWNER_MESSAGE_LENGTH = 4000

function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0]
  return first || "there"
}

function sentenceItem(headline: string): string {
  return headline.trim().replace(/[.!]+$/, "")
}

/**
 * Top fixes for the message: the owner's most important actionable items.
 * Captions collapse into one line so ten caption items don't crowd the list.
 */
export function topFixes(items: MessageItem[], count = 3): string[] {
  const actionable = items
    .filter((i) => i.kind === "change" || i.kind === "owner_choice")
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        (SECTION_RANK.get(a.section) ?? 99) - (SECTION_RANK.get(b.section) ?? 99) ||
        a.sort_order - b.sort_order
    )
  const out: string[] = []
  let captionsAdded = false
  for (const item of actionable) {
    if (item.section === "captions") {
      if (captionsAdded) continue
      captionsAdded = true
      out.push("Add short captions to your photos")
    } else {
      out.push(sentenceItem(item.headline))
    }
    if (out.length >= count) break
  }
  return out
}

export function buildOwnerMessage(input: {
  ownerName: string | null | undefined
  items: MessageItem[]
  channelManager: string | null | undefined
}): string {
  const first = firstNameOf(input.ownerName)
  const fixes = topFixes(input.items)
  const ownerTasks = input.items.filter((i) => i.kind === "owner_task")
  const where = input.channelManager ? input.channelManager : "Airbnb"

  const lines = [
    `Hi ${first}! Your listing review is ready in the portal, under the Listing Review tab.`,
    "",
    "We went through every part of your Airbnb listing and wrote up what we'd change.",
  ]
  if (fixes.length > 0) {
    lines.push(fixes.length === 1 ? "The one that matters most:" : `The ${fixes.length} that matter most:`)
    fixes.forEach((fix, i) => lines.push(`${i + 1}. ${fix}`))
  }
  lines.push(
    "",
    `Each suggestion has Accept or Decline. Nothing changes until you accept it, and we'll make the changes in ${where} for you.`
  )
  if (ownerTasks.length === 1) {
    lines.push("One is something only you can do in Airbnb, and it has a direct link.")
  } else if (ownerTasks.length > 1) {
    const words = ["Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"]
    const count = words[ownerTasks.length - 2] ?? String(ownerTasks.length)
    lines.push(`${count} are things only you can do in Airbnb, and those have a direct link.`)
  }
  lines.push("", "Can you take a look this week?")
  return lines.join("\n")
}
