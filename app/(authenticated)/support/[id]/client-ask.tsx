"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { ChevronRight, ExternalLink, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import type { SupportAskPlain } from "@/lib/support-ask-plain"
import { messageSegments } from "@/lib/support-message"
import { cn } from "@/lib/utils"
import { plainAskAction } from "../ask-actions"

/** The ASD-STE100 version; written on first view when missing or out of date. */
export function PlainAsk({ ticketId, initial }: { ticketId: string; initial: SupportAskPlain | null }) {
  const [plain, setPlain] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const started = useRef(false)

  const run = () =>
    start(async () => {
      setError(null)
      const result = await plainAskAction(ticketId)
      if (result.ok) setPlain(result.plain)
      else setError(result.error)
    })

  useEffect(() => {
    if (initial || started.current) return
    started.current = true
    run()
    // Once per ticket view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">In plain English</p>
        {(plain || error) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={pending}
            onClick={run}
            aria-label="Write the plain version again"
          >
            <RefreshCw className={cn("size-3.5", pending && "animate-spin")} aria-hidden />
          </Button>
        )}
      </div>
      {plain && !pending ? (
        <>
          <ul className="list-disc space-y-1 pl-5 font-medium">
            {plain.wants.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          {plain.says.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {plain.says.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </>
      ) : pending ? (
        <div className="space-y-2" aria-busy>
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <p className="text-muted-foreground">{error ?? "Not written yet."}</p>
      )}
    </div>
  )
}

/** The message as the client wrote it, folded by default, with links shortened. */
export function OriginalMessage({ message, defaultOpen = false }: { message: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden />
        {open ? "Hide original message" : "See original message"}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <blockquote className="mt-2 border-l-2 pl-3 text-sm whitespace-pre-wrap wrap-anywhere">
          <MessageText text={message} />
        </blockquote>
      </CollapsibleContent>
    </Collapsible>
  )
}

function MessageText({ text }: { text: string }) {
  return (
    <>
      {messageSegments(text).map((seg, i) =>
        seg.type === "text" ? (
          <span key={i}>{seg.text}</span>
        ) : seg.type === "link" ? (
          <a
            key={i}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline"
          >
            {seg.label}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : (
          <span key={i} className="text-muted-foreground" title="The capture bot removed part of this link">
            {seg.label} (link broken by redaction)
          </span>
        )
      )}
    </>
  )
}
