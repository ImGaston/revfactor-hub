"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { mentionKindFromHref } from "@/lib/revai/mentions"
import { cn } from "@/lib/utils"
import { RevAiMentionPill } from "./revai-mention-pill"

function textOf(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children)
  if (Array.isArray(children)) return children.map(textOf).join("")
  return ""
}

const components: Components = {
  // Tagged records (`[@Name](/listings/<id>)`) render as pills; other Hub
  // paths open in-app; anything else opens a new tab.
  a: ({ href, children }) => {
    const text = textOf(children)
    const kind = mentionKindFromHref(href)
    if (kind && text.startsWith("@")) {
      return <RevAiMentionPill kind={kind} label={text} href={href} />
    }
    return href?.startsWith("/") ? (
      <Link href={href} className="font-medium text-primary underline-offset-2 hover:underline">
        {children}
      </Link>
    ) : (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  },
  table: ({ children }) => (
    <div className="not-prose my-3 overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ children, style }) => (
    <th style={style} className="border-b px-3 py-2 text-left font-medium whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b px-3 py-1.5 align-top last:border-b-0 [tr:last-child_&]:border-b-0">
      {children}
    </td>
  ),
}

/** GitHub-flavoured Markdown (tables, task lists, strikethrough) with Hub-aware links. */
export function RevAiMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none wrap-anywhere dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-li:my-0.5",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
