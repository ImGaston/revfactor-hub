"use client"

// Presentational pieces of the "Our answer" card (no data fetching).

import { useState, useTransition } from "react"
import Link from "next/link"
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  ExternalLink,
  PlugZap,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  SUPPORT_DRAFT_CONFIDENCE_BADGE,
  SUPPORT_DRAFT_CONFIDENCE_LABEL,
  confidencePct,
  type SupportAnswerCheckOutcome,
  type SupportAnswerSource,
  type SupportDraftConfidence,
} from "@/lib/support-answers"
import { cn } from "@/lib/utils"
import { testJevConnectionAction } from "../answer-actions"

const OUTCOME_ICON: Record<SupportAnswerCheckOutcome, { icon: typeof CircleCheck; className: string; label: string }> = {
  ok: { icon: CircleCheck, className: "text-emerald-600 dark:text-emerald-400", label: "OK" },
  problem: { icon: CircleAlert, className: "text-red-600 dark:text-red-400", label: "Look at this" },
  unsure: { icon: CircleHelp, className: "text-amber-600 dark:text-amber-400", label: "Needs a human look" },
  skipped: { icon: CircleMinus, className: "text-muted-foreground", label: "Skipped" },
}

export type ResultRow = {
  key: string
  label: string
  outcome: SupportAnswerCheckOutcome
  detail: string
  confidence: number | null
  source: "jev" | "rule" | "hub"
}

export function StepHeader({ n, title, hint, children }: { n: number; title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
          {n}
        </span>
        <h3 className="font-medium">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function ResultRowItem({ r }: { r: ResultRow }) {
  const meta = OUTCOME_ICON[r.outcome]
  const Icon = meta.icon
  const pct = r.outcome === "skipped" ? null : confidencePct(r.confidence)
  return (
    <li className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2 py-1.5">
      <Icon className={cn("mt-0.5 size-4", meta.className)} aria-label={meta.label} />
      <div className="min-w-0">
        <p className="font-medium">{r.label}</p>
        <p className="text-xs text-muted-foreground wrap-anywhere">{r.detail}</p>
      </div>
      <div className="text-right text-xs">
        <span className="font-mono tabular-nums">{pct ?? "—"}</span>
        {r.source !== "jev" && <p className="text-[11px] text-muted-foreground">{r.source === "rule" ? "rule" : "Hub"}</p>}
      </div>
    </li>
  )
}

export function ResultList({ rows, dimmed }: { rows: ResultRow[]; dimmed?: boolean }) {
  return (
    <ul className={cn("divide-y", dimmed && "opacity-70")}>
      {rows.map((r) => (
        <ResultRowItem key={r.key} r={r} />
      ))}
    </ul>
  )
}

export function ResultPanel({
  title,
  badge,
  meta,
  busy,
  busyLabel,
  stale,
  children,
}: {
  title: string
  badge?: { label: string; className: string } | null
  meta?: string | null
  busy?: boolean
  busyLabel?: string
  stale?: string | null
  children?: React.ReactNode
}) {
  return (
    <section className="min-w-0 space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium">{title}</h4>
        {busy ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner /> {busyLabel ?? "Working…"}
          </span>
        ) : (
          <>
            {badge && <Badge className={badge.className}>{badge.label}</Badge>}
            {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
          </>
        )}
      </div>
      {!busy && stale && <p className="text-xs text-amber-700 dark:text-amber-300">{stale}</p>}
      {!busy && children}
    </section>
  )
}

export function ConfidenceBadge({ confidence }: { confidence: SupportDraftConfidence | null }) {
  if (!confidence) return null
  if (confidence.status === "not_configured")
    return (
      <Badge variant="outline" className="font-normal">
        AI check not configured
      </Badge>
    )
  if (confidence.status === "failed")
    return (
      <Badge variant="outline" className="font-normal">
        Confidence unavailable
      </Badge>
    )
  const pct = confidencePct(confidence.score)
  return (
    <Badge className={SUPPORT_DRAFT_CONFIDENCE_BADGE[confidence.level]}>
      {SUPPORT_DRAFT_CONFIDENCE_LABEL[confidence.level]}
      {pct && confidence.level !== "needs_human" ? ` · ${pct}` : ""}
    </Badge>
  )
}

export function WhyConfidence({ confidence }: { confidence: SupportDraftConfidence | null }) {
  const [open, setOpen] = useState(false)
  if (confidence?.status !== "scored") return null
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        Why this confidence
      </button>
      {open && (
        <div className="mt-1 rounded-md border px-3">
          <ResultList rows={confidence.checks} />
        </div>
      )}
    </div>
  )
}

export function SourceList({ sources }: { sources: SupportAnswerSource[] }) {
  const cited = sources.some((s) => s.cited)
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p className="font-medium">{cited ? "Sources (✓ = the draft relied on it)" : "Sources it was given"}</p>
      <ul className="space-y-0.5">
        {sources.map((s) => (
          <li key={s.id} className="flex min-w-0 items-start gap-1.5">
            <span className="mt-0.5 flex size-3 shrink-0 items-center justify-center">
              {s.cited ? (
                <Check className="size-3 text-emerald-600" aria-label="Relied on" />
              ) : (
                <span className="size-1 rounded-full bg-muted-foreground/50" />
              )}
            </span>
            {s.href ? (
              <Link href={s.href} className="inline-flex min-w-0 items-center gap-1 hover:text-foreground hover:underline">
                <span className="wrap-anywhere">{s.label}</span>
                <ExternalLink className="size-3 shrink-0" />
              </Link>
            ) : (
              <span className="wrap-anywhere">{s.label}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** One trivial Jev question: proves auth, transport, and the live response shape. */
export function JevConnectionTest() {
  const [pending, start] = useTransition()
  const [line, setLine] = useState<{ ok: boolean; text: string } | null>(null)

  function run() {
    start(async () => {
      const res = await testJevConnectionAction()
      if (!res.ok) return setLine({ ok: false, text: res.error })
      const r = res.result
      if (!r.ok) return setLine({ ok: false, text: `Jev not reachable (${r.reason}): ${r.error}` })
      setLine({
        ok: r.decided,
        text: `${r.decided ? "Jev answered" : "Jev answered but the gate couldn't read it"} via ${
          r.transport === "gateway" ? "AI Gateway" : "TypeSafe"
        } · ${r.model}${r.modelVersion ? ` (${r.modelVersion})` : ""} · ${r.latencyMs} ms · probability ${
          r.probability === null ? "—" : r.probability.toFixed(2)
        } · fields: ${r.answerFields.join(", ") || "none"}`,
      })
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button type="button" size="xs" variant="ghost" onClick={run} disabled={pending}>
        {pending ? <Spinner /> : <PlugZap className="size-3" />}
        Test Jev connection
      </Button>
      {line && (
        <span className={cn("wrap-anywhere", line.ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>
          {line.text}
        </span>
      )}
    </div>
  )
}
