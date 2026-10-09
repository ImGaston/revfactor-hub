"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { AlertTriangle, ChevronRight, ExternalLink, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import type { AskLinkFact, AskThreadMessage, SupportAskDigest } from "@/lib/support-ask-plain"
import { messageSegments } from "@/lib/support-message"
import { cn } from "@/lib/utils"
import { plainAskAction } from "../ask-actions"

const CONFIDENCE_BADGE = {
  high: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
} as const

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

function linkLine(l: AskLinkFact): string {
  const dates = l.checkIn && l.checkOut ? `${day(`${l.checkIn}T00:00:00Z`)}–${day(`${l.checkOut}T00:00:00Z`)}` : null
  return [l.idRemoved ? `${l.label} (ID removed)` : l.label, dates, l.guests ? `${l.guests} guests` : null]
    .filter(Boolean)
    .join(" · ")
}

/** The digest; written on first view when missing or out of date. */
export function PlainAsk({ ticketId, initial }: { ticketId: string; initial: SupportAskDigest | null }) {
  const [digest, setDigest] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const started = useRef(false)

  const run = (force: boolean) =>
    start(async () => {
      setError(null)
      const result = await plainAskAction(ticketId, force)
      if (result.ok) setDigest(result.digest)
      else setError(result.error)
    })

  useEffect(() => {
    if (initial || started.current) return
    started.current = true
    run(false)
    // Once per ticket view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  const d = digest?.details ?? {}
  return (
    <div className="space-y-3 rounded-md border bg-muted/40 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">In plain English</p>
        {(digest || error) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={pending}
            onClick={() => run(true)}
            aria-label="Write the digest again"
          >
            <RefreshCw className={cn("size-3.5", pending && "animate-spin")} aria-hidden />
          </Button>
        )}
      </div>

      {pending ? (
        <div className="space-y-2" aria-busy>
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : !digest ? (
        <p className="text-muted-foreground">{error ?? "Not written yet."}</p>
      ) : (
        <>
          {d.mixedProperties && (
            <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <span className="font-medium">Mixes properties.</span> {d.mixedProperties} Consider a ticket for each.
              </span>
            </p>
          )}
          <ul className="list-disc space-y-1 pl-5 font-medium">
            {digest.wants.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          {digest.says.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {digest.says.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}

          {(d.properties?.length ?? 0) > 0 && (
            <Section title="Likely property">
              <ul className="space-y-1">
                {d.properties!.map((p) => (
                  <li key={p.listing.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-medium">{p.listing.name}</span>
                    <Badge className={cn("h-5 px-1.5 text-[11px]", CONFIDENCE_BADGE[p.confidence])}>{p.confidence}</Badge>
                    <span className="text-muted-foreground">{p.reason}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">A suggestion. Confirm the property before you answer.</p>
            </Section>
          )}

          {(d.comps?.length ?? 0) > 0 && (
            <Section title="Comps the client sent">
              <ul className="space-y-1.5">
                {d.comps!.map((c, i) => (
                  <li key={i} className="space-y-0.5">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      {c.link ? (
                        <span className="font-mono text-xs">
                          {day(c.link.sentAt)} · {linkLine(c.link)}
                        </span>
                      ) : (
                        <span className="font-mono text-xs text-muted-foreground">Described, no link</span>
                      )}
                      {c.listing && <span className="text-xs text-muted-foreground">vs {c.listing.name}</span>}
                    </span>
                    <span className="block">{c.note}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(d.gaps?.length ?? 0) > 0 && (
            <Section title="Gaps to close before answering">
              <ul className="list-disc space-y-1 pl-5">
                {d.gaps!.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-t pt-2.5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      {children}
    </div>
  )
}

/** Every client message on the ticket (merged tickets included), folded by default, links shortened. */
export function OriginalMessages({
  messages,
  defaultOpen = false,
}: {
  messages: AskThreadMessage[]
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (messages.length === 0) return null
  const label = messages.length === 1 ? "original message" : `${messages.length} original messages`
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden />
        {open ? `Hide ${label}` : `See ${label}`}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 space-y-2.5">
          {messages.map((m, i) => (
            <li key={i} className="border-l-2 pl-3 text-sm">
              <p className="text-xs text-muted-foreground">
                {day(m.at)}
                {m.merged && <span> · from #{m.ticketNumber} (merged)</span>}
              </p>
              <p className="whitespace-pre-wrap wrap-anywhere">
                <MessageText text={m.text} />
              </p>
            </li>
          ))}
        </ol>
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
