"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  ExternalLink,
  FileText,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  SUPPORT_ANSWER_MAX,
  SUPPORT_ANSWER_VERDICT_BADGE,
  SUPPORT_ANSWER_VERDICT_LABEL,
  SUPPORT_DRAFT_CONFIDENCE_BADGE,
  SUPPORT_DRAFT_CONFIDENCE_LABEL,
  confidencePct,
  type SupportAnswerCheckOutcome,
  type SupportAnswerCheckResult,
  type SupportAnswerSource,
  type SupportAnswerVerdict,
  type SupportDraftConfidence,
} from "@/lib/support-answers"
import type { DraftFreshness, SupportDraftSource } from "@/lib/support-tickets"
import { cn } from "@/lib/utils"
import {
  checkSupportAnswerAction,
  generateSuggestedAnswerAction,
  saveSupportAnswerAction,
} from "../answer-actions"
import { CopyDraftButton } from "./copy-draft-button"

export type OurAnswerSuggestion = {
  text: string
  source: SupportDraftSource
  /** "2h ago", computed on the server so it can't mismatch on hydration */
  generatedAgo: string
  skill: string | null
  basis: string[]
  freshness: DraftFreshness
  gaps: string[]
  /** Hub drafts only */
  sources: SupportAnswerSource[] | null
  confidence: SupportDraftConfidence | null
  createdByName: string | null
}

export type OurAnswerProps = {
  ticketId: string
  canEdit: boolean
  closed: boolean
  schemaReady: boolean
  runtime: { drafts: boolean; check: boolean }
  /** Why the Hub won't draft this ticket (billing/offboarding, check-in) */
  draftBlockReason: string | null
  moneyAtStake: boolean
  suggestion: OurAnswerSuggestion | null
  /** An automatic draft is being written right now */
  drafting: boolean
  lastDraftError: string | null
  answer: { body: string; savedLabel: string } | null
  latestCheck: {
    verdict: SupportAnswerVerdict
    results: SupportAnswerCheckResult[]
    answerSnapshot: string
    model: string
    checkedLabel: string
  } | null
}

const OUTCOME_ICON: Record<SupportAnswerCheckOutcome, { icon: typeof CircleCheck; className: string; label: string }> = {
  ok: { icon: CircleCheck, className: "text-emerald-600 dark:text-emerald-400", label: "OK" },
  problem: { icon: CircleAlert, className: "text-red-600 dark:text-red-400", label: "Fix" },
  unsure: { icon: CircleHelp, className: "text-amber-600 dark:text-amber-400", label: "Unsure" },
  skipped: { icon: CircleMinus, className: "text-muted-foreground", label: "Skipped" },
}

function CheckRow({ r }: { r: SupportAnswerCheckResult }) {
  const meta = OUTCOME_ICON[r.outcome]
  const Icon = meta.icon
  const pct = confidencePct(r.confidence)
  return (
    <li className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2 py-1.5">
      <Icon className={cn("mt-0.5 size-4", meta.className)} aria-label={meta.label} />
      <div className="min-w-0">
        <p className="font-medium">{r.label}</p>
        <p className="text-xs text-muted-foreground wrap-anywhere">{r.detail}</p>
      </div>
      <div className="text-right text-xs">
        <span className="font-mono tabular-nums">{pct ?? "—"}</span>
        {r.source !== "jev" && (
          <p className="text-[11px] text-muted-foreground">{r.source === "rule" ? "rule" : "Hub"}</p>
        )}
      </div>
    </li>
  )
}

function ConfidenceBadge({ confidence }: { confidence: SupportDraftConfidence | null }) {
  if (!confidence) return null
  if (confidence.status === "not_configured")
    return <Badge variant="outline" className="font-normal">AI check not configured</Badge>
  if (confidence.status === "failed")
    return <Badge variant="outline" className="font-normal">Confidence unavailable</Badge>
  const pct = confidencePct(confidence.score)
  return (
    <Badge className={SUPPORT_DRAFT_CONFIDENCE_BADGE[confidence.level]}>
      {SUPPORT_DRAFT_CONFIDENCE_LABEL[confidence.level]}
      {pct && confidence.level !== "needs_human" ? ` · ${pct}` : ""}
    </Badge>
  )
}

function SourceList({ sources }: { sources: SupportAnswerSource[] }) {
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

export function OurAnswer(props: OurAnswerProps) {
  const { suggestion, latestCheck } = props
  const [text, setText] = useState(props.answer?.body ?? "")
  const [savedBody, setSavedBody] = useState(props.answer?.body ?? "")
  const [showWhy, setShowWhy] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [generating, startGenerate] = useTransition()
  const [saving, startSave] = useTransition()
  const [checking, startCheck] = useTransition()

  const busy = generating || saving || checking
  const editable = props.canEdit && !props.closed && props.schemaReady
  const dirty = text.trim() !== savedBody.trim()
  const canGenerate =
    props.canEdit && !props.closed && props.schemaReady && props.runtime.drafts && !props.draftBlockReason
  const checkIsStale = latestCheck ? latestCheck.answerSnapshot.trim() !== text.trim() : false

  function generate() {
    setConfirmReplace(false)
    startGenerate(async () => {
      const result = await generateSuggestedAnswerAction(props.ticketId)
      if (result.ok) toast.success("Suggested answer ready. Review it before you use it.")
      else toast.error(result.error)
    })
  }

  function save() {
    startSave(async () => {
      const result = await saveSupportAnswerAction(props.ticketId, text)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setText(result.body)
      setSavedBody(result.body)
      toast.success(result.changed ? "Answer saved." : "No changes to save.")
    })
  }

  function check() {
    startCheck(async () => {
      const result = await checkSupportAnswerAction(props.ticketId, text)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setText(result.body)
      setSavedBody(result.body)
      const label = SUPPORT_ANSWER_VERDICT_LABEL[result.verdict]
      if (result.verdict === "pass") toast.success(`AI check: ${label}`)
      else toast.warning(`AI check: ${label}`)
    })
  }

  return (
    <div className="space-y-5 text-sm">
      {/* ------------------------------------------------ Suggested answer */}
      <section className="space-y-3" aria-labelledby="suggested-answer-heading">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 id="suggested-answer-heading" className="mr-1 font-medium">
            Suggested answer
          </h3>
          {suggestion && (
            <Badge variant="outline" className="gap-1 font-normal">
              {suggestion.source === "hub" ? <Sparkles className="size-3" /> : <Bot className="size-3" />}
              {suggestion.source === "hub" ? "Hub draft" : "Bot draft"}
            </Badge>
          )}
          {suggestion?.source === "hub" && <ConfidenceBadge confidence={suggestion.confidence} />}
          {suggestion && (
            <span className="text-xs text-muted-foreground">
              {suggestion.generatedAgo}
              {suggestion.source === "bot" && suggestion.skill ? ` · ${suggestion.skill}` : ""}
              {suggestion.createdByName ? ` · by ${suggestion.createdByName}` : ""}
            </span>
          )}
        </div>

        {!suggestion ? (
          <div className="space-y-2">
            {props.draftBlockReason ? (
              <p className="text-muted-foreground">{props.draftBlockReason}</p>
            ) : props.drafting || generating ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Spinner /> Drafting a suggested answer… this takes up to a minute.
              </p>
            ) : !props.schemaReady ? (
              <p className="text-muted-foreground">Suggested answers arrive once the answer migration is applied.</p>
            ) : !props.runtime.drafts ? (
              <p className="text-muted-foreground">AI drafting not configured.</p>
            ) : (
              <p className="text-muted-foreground">No suggested answer yet.</p>
            )}
            {props.lastDraftError && !generating && (
              <p className="text-xs text-amber-700 dark:text-amber-300 wrap-anywhere">
                The last draft attempt failed: {props.lastDraftError}
              </p>
            )}
            {canGenerate && !props.drafting && (
              <Button type="button" size="sm" variant="outline" onClick={generate} disabled={busy}>
                {generating ? <Spinner /> : <Sparkles className="size-4" />}
                {generating ? "Drafting…" : "Generate"}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {suggestion.freshness === "team_replied_since" && (
              <p className="text-muted-foreground">
                The team has replied since this draft, so it may already be used or out of date.
              </p>
            )}
            {suggestion.freshness === "client_wrote_since" && (
              <p className="text-amber-700 dark:text-amber-300">
                The client wrote again after this draft. Check it still answers them.
              </p>
            )}
            {suggestion.gaps.length > 0 && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900 wrap-anywhere dark:bg-amber-950/40 dark:text-amber-200">
                Fill {suggestion.gaps.length === 1 ? "this gap" : `these ${suggestion.gaps.length} gaps`} before
                sending: {suggestion.gaps.join(", ")}
              </p>
            )}
            {props.moneyAtStake && (
              <p className="text-amber-700 dark:text-amber-300">Money at stake: get Fede&apos;s approval before sending.</p>
            )}
            <div
              className={cn(
                "rounded-md border bg-muted/40 p-3 whitespace-pre-wrap wrap-anywhere",
                generating && "opacity-60"
              )}
            >
              {suggestion.text}
            </div>

            {suggestion.sources && suggestion.sources.length > 0 ? (
              <SourceList sources={suggestion.sources} />
            ) : suggestion.basis.length > 0 ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-medium">Based on</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {suggestion.basis.map((b) => (
                    <li key={b} className="wrap-anywhere">
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {suggestion.source === "hub" && suggestion.confidence?.status === "scored" && (
              <div className="text-xs">
                <button
                  type="button"
                  onClick={() => setShowWhy((v) => !v)}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  aria-expanded={showWhy}
                >
                  {showWhy ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  Why this confidence
                </button>
                {showWhy && (
                  <ul className="mt-1 divide-y rounded-md border px-3">
                    {suggestion.confidence.checks.map((r) => (
                      <CheckRow key={r.key} r={r} />
                    ))}
                  </ul>
                )}
              </div>
            )}

            {props.lastDraftError && !generating && (
              <p className="text-xs text-amber-700 dark:text-amber-300 wrap-anywhere">
                The last regenerate attempt failed: {props.lastDraftError}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <CopyDraftButton text={suggestion.text} />
              {editable && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || text.trim().length > 0}
                  title={text.trim() ? "Clear your answer first to start from the draft" : undefined}
                  onClick={() => setText(suggestion.text)}
                >
                  <FileText className="size-4" />
                  Use as my answer
                </Button>
              )}
              {canGenerate && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => (suggestion.source === "bot" ? setConfirmReplace(true) : generate())}
                >
                  {generating ? <Spinner /> : <RefreshCw className="size-4" />}
                  {generating ? "Drafting…" : suggestion.source === "bot" ? "Generate Hub draft" : "Regenerate"}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Draft only. Edit it and send it yourself in Assembly.</p>
          </div>
        )}
      </section>

      {/* ------------------------------------------------ The owner's answer */}
      <section className="space-y-2 border-t pt-4" aria-labelledby="your-answer-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="your-answer-heading" className="font-medium">
            Your answer
          </h3>
          <span className="text-xs text-muted-foreground">
            {dirty ? "Unsaved changes" : (props.answer?.savedLabel ?? "Not saved yet")}
          </span>
        </div>
        {!props.schemaReady ? (
          <p className="text-muted-foreground">Answer drafting arrives once the answer migration is applied.</p>
        ) : (
          <>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                editable ? "Write or paste the answer you'll send in Assembly…" : "No answer saved yet."
              }
              readOnly={!editable}
              disabled={busy}
              maxLength={SUPPORT_ANSWER_MAX}
              rows={6}
              className="min-h-32"
              aria-label="Your answer to the client"
            />
            {editable && (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={save} disabled={busy || !text.trim() || !dirty}>
                  {saving ? <Spinner /> : <Save className="size-4" />}
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={check}
                  disabled={busy || !text.trim() || !props.runtime.check}
                  title={props.runtime.check ? undefined : "AI check not configured"}
                >
                  {checking ? <Spinner /> : <ShieldCheck className="size-4" />}
                  {checking ? "Checking…" : "Check answer"}
                </Button>
                {!props.runtime.check && <span className="text-xs text-muted-foreground">AI check not configured</span>}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              The Hub never sends this. Copy it into Assembly yourself. Emails and phone numbers are masked when saved.
            </p>
          </>
        )}
      </section>

      {/* ------------------------------------------------ AI check results */}
      {(latestCheck || checking) && (
        <section className="space-y-2 rounded-md border p-3" aria-labelledby="answer-check-heading">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="answer-check-heading" className="font-medium">
              AI check
            </h3>
            {checking ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Spinner /> Checking with Jev…
              </span>
            ) : latestCheck ? (
              <>
                <Badge className={SUPPORT_ANSWER_VERDICT_BADGE[latestCheck.verdict]}>
                  {SUPPORT_ANSWER_VERDICT_LABEL[latestCheck.verdict]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {latestCheck.checkedLabel} · {latestCheck.model}
                </span>
              </>
            ) : null}
          </div>
          {latestCheck && !checking && (
            <>
              {checkIsStale && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  This check is for an earlier version of the answer. Check again.
                </p>
              )}
              <ul className={cn("divide-y", checkIsStale && "opacity-70")}>
                {latestCheck.results.map((r) => (
                  <CheckRow key={r.key} r={r} />
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Mid-confidence results are never treated as a pass or a fail: a person decides.
              </p>
            </>
          )}
        </section>
      )}

      <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the bot&apos;s draft?</AlertDialogTitle>
            <AlertDialogDescription>
              The Hub will write its own suggested answer and replace the capture bot&apos;s draft on this ticket.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the bot draft</AlertDialogCancel>
            <AlertDialogAction onClick={generate}>Replace it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
