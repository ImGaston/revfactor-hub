"use client"

import { Building2, LifeBuoy, SlidersHorizontal, Users, X } from "lucide-react"
import Link from "next/link"

import type { RevAiMentionKind } from "@/lib/revai/mentions"
import { cn } from "@/lib/utils"

export const REVAI_MENTION_ICONS: Record<RevAiMentionKind, typeof Users> = {
  client: Users,
  listing: Building2,
  ticket: LifeBuoy,
  adjustment: SlidersHorizontal,
}

const PILL =
  "not-prose inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 align-middle text-xs font-medium text-primary no-underline"

/** A tagged record shown as a pill: in sent messages it links to the Hub page. */
export function RevAiMentionPill({
  kind,
  label,
  href,
  onRemove,
}: {
  kind: RevAiMentionKind
  label: string
  href?: string
  onRemove?: () => void
}) {
  const Icon = REVAI_MENTION_ICONS[kind]
  const body = (
    <>
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{label.replace(/^@/, "")}</span>
    </>
  )
  if (onRemove) {
    return (
      <span className={PILL}>
        {body}
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onRemove}
          className="-mr-0.5 rounded-full p-0.5 hover:bg-primary/15"
        >
          <X className="size-3" />
          <span className="sr-only">Remove {label}</span>
        </button>
      </span>
    )
  }
  return href ? (
    <Link href={href} className={cn(PILL, "hover:bg-primary/15")}>
      {body}
    </Link>
  ) : (
    <span className={PILL}>{body}</span>
  )
}
