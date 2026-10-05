"use client"

// "Our answer": blind-first answering in three steps.
//   1. Your answer — the suggestion is locked (the server never sends it).
//   2. Review — your answer next to the suggestion, with the Jev check and the
//      Jev comparison (runs automatically after the first save).
//   3. Final answer — keep yours, use the suggestion, or merge; check; save.
// The Hub never sends anything: the final answer is copied into Assembly.

import { useState, useTransition } from "react"
import { Bot, Combine, FileText, Lock, RefreshCw, Save, ShieldCheck, Sparkles, Undo2 } from "lucide-react"
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
  SUPPORT_COMPARISON_VERDICT_BADGE,
  SUPPORT_COMPARISON_VERDICT_LABEL,
  SUPPORT_USED_SUGGESTION_LABEL,
  type SuggestionLockStatus,
  type SupportAnswerCheckResult,
  type SupportAnswerSource,
  type SupportAnswerVerdict,
  type SupportComparisonResult,
  type SupportComparisonVerdict,
  type SupportDraftConfidence,
  type SupportFinalSource,
  type SupportSuggestionAdd,
  type SupportUsedSuggestion,
} from "@/lib/support-answers"
import type { DraftFreshness, SupportDraftSource } from "@/lib/support-tickets"
import { cn } from "@/lib/utils"
import {
  checkFinalAnswerAction,
  generateSuggestedAnswerAction,
  mergeAnswersAction,
  runAnswerReviewAction,
  saveFinalAnswerAction,
  saveSupportAnswerAction,
} from "../answer-actions"
import {
  ConfidenceBadge,
  JevConnectionTest,
  ResultList,
  ResultPanel,
  SourceList,
  StepHeader,
  WhyConfidence,
} from "./answer-parts"
import { CopyDraftButton } from "./copy-draft-button"

export type OurAnswerCheck = {
  verdict: SupportAnswerVerdict
  results: SupportAnswerCheckResult[]
  answerSnapshot: string
  checkedLabel: string
}

export type OurAnswerProps = {
  ticketId: string
  canEdit: boolean
  closed: boolean
  schemaReady: boolean
  runtime: { drafts: boolean; check: boolean }
  moneyAtStake: boolean
  /** The team has a saved answer; only then does `suggestion` exist */
  unlocked: boolean
  lock: { status: SuggestionLockStatus; message: string }
  draftPending: boolean
  lastDraftError: string | null
  answer: { firstBody: string; body: string; savedLabel: string; firstLabel: string } | null
  suggestion: {
    text: string
    source: SupportDraftSource
    generatedAgo: string
    skill: string | null
    basis: string[]
    freshness: DraftFreshness
    gaps: string[]
    sources: SupportAnswerSource[] | null
    confidence: SupportDraftConfidence | null
    createdByName: string | null
  } | null
  teamCheck: OurAnswerCheck | null
  comparison: {
    verdict: SupportComparisonVerdict | null
    results: SupportComparisonResult[]
    adds: SupportSuggestionAdd[]
    jevStatus: "ok" | "not_configured" | "failed"
    addsStatus: "ok" | "not_configured" | "failed"
    teamAnswerSnapshot: string
    suggestionText: string
    checkedLabel: string
  } | null
  final: { body: string; source: SupportFinalSource | null; savedLabel: string; usedSuggestion: SupportUsedSuggestion | null } | null
  finalCheck: OurAnswerCheck | null
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim() === (b ?? "").trim()

export function OurAnswer(props: OurAnswerProps) {
  const { suggestion, teamCheck, comparison, finalCheck } = props
  const savedTeam = props.answer?.body ?? ""
  const [answerText, setAnswerText] = useState(savedTeam)
  const [savedBody, setSavedBody] = useState(savedTeam)
  const [finalText, setFinalText] = useState(props.final?.body ?? savedTeam)
  const [finalBase, setFinalBase] = useState<{ source: Exclude<SupportFinalSource, "edited">; text: string }>({
    source: props.final?.source && props.final.source !== "edited" ? props.final.source : "mine",
    text: props.final?.body ?? savedTeam,
  })
  const [mergeNote, setMergeNote] = useState<string[] | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [showFirst, setShowFirst] = useState(false)
  const [saving, startSave] = useTransition()
  const [reviewing, startReview] = useTransition()
  const [generating, startGenerate] = useTransition()
  const [merging, startMerge] = useTransition()
  const [checkingFinal, startCheckFinal] = useTransition()
  const [savingFinal, startSaveFinal] = useTransition()

  const busy = saving || reviewing || generating || merging || checkingFinal || savingFinal
  const editable = props.canEdit && !props.closed && props.schemaReady
  const dirty = !same(answerText, savedBody)
  const canGenerate =
    props.canEdit && !props.closed && props.schemaReady && props.runtime.drafts && props.lock.status !== "blocked"

  // --------------------------------------------------------------- actions
  function review() {
    setReviewError(null)
    startReview(async () => {
      const res = await runAnswerReviewAction(props.ticketId)
      if (!res.ok) {
        setReviewError(res.error)
        toast.error(res.error)
        return
      }
      if (res.check.status === "failed") setReviewError(res.check.error ?? "The AI check failed.")
      if (res.check.status === "checked") {
        const label = SUPPORT_ANSWER_VERDICT_LABEL[res.check.verdict]
        if (res.check.verdict === "pass") toast.success(`AI check: ${label}`)
        else toast.warning(`AI check: ${label}`)
      }
    })
  }

  function saveAnswer(then?: "review") {
    startSave(async () => {
      const res = await saveSupportAnswerAction(props.ticketId, answerText)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setAnswerText(res.body)
      setSavedBody(res.body)
      if (!props.final) {
        setFinalText(res.body)
        setFinalBase({ source: "mine", text: res.body })
      }
      if (res.unlocked) toast.success("Saved. The suggested answer is unlocked.")
      else toast.success(res.changed ? "Answer saved." : "No changes to save.")
      // First save (or an explicit re-run): review right away, in its own transition
      if (res.unlocked || then === "review") review()
    })
  }

  function generate() {
    setConfirmReplace(false)
    startGenerate(async () => {
      const res = await generateSuggestedAnswerAction(props.ticketId)
      if (res.ok) toast.success(props.unlocked ? "New suggested answer ready." : "Suggested answer prepared. It stays hidden until you save your answer.")
      else toast.error(res.error)
    })
  }

  function pickFinal(source: "mine" | "suggested", text: string) {
    setFinalText(text)
    setFinalBase({ source, text })
    setMergeNote(null)
  }

  function merge() {
    startMerge(async () => {
      const res = await mergeAnswersAction(props.ticketId)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setFinalText(res.text)
      setFinalBase({ source: "merged", text: res.text })
      setMergeNote(res.addedPoints)
      toast.success("Merged. Review it, fill any [brackets], then save.")
    })
  }

  function checkFinal() {
    startCheckFinal(async () => {
      const res = await checkFinalAnswerAction(props.ticketId, finalText)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      const label = SUPPORT_ANSWER_VERDICT_LABEL[res.verdict]
      if (res.verdict === "pass") toast.success(`Final check: ${label}`)
      else toast.warning(`Final check: ${label}`)
    })
  }

  function saveFinal() {
    const source: SupportFinalSource = same(finalText, finalBase.text) ? finalBase.source : "edited"
    startSaveFinal(async () => {
      const res = await saveFinalAnswerAction(props.ticketId, finalText, source)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setFinalText(res.body)
      toast.success("Final answer saved. Copy it into Assembly to send it.")
    })
  }

  if (!props.schemaReady) {
    return (
      <p className="text-sm text-muted-foreground">
        Answering arrives once the answer migration is applied. {props.lock.message}
      </p>
    )
  }

  // --------------------------------------------------------------- step 1 (locked)
  if (!props.unlocked) {
    return (
      <div className="space-y-3 text-sm">
        <StepHeader n={1} title="Your answer" hint="Write yours first" />
        <p className="text-muted-foreground">
          Write the answer you&apos;d send. You&apos;ll see the suggested answer after you save it.
        </p>
        {editable ? (
          <>
            <Textarea
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              placeholder="Write or paste the answer you'll send in Assembly…"
              disabled={busy}
              maxLength={SUPPORT_ANSWER_MAX}
              rows={6}
              className="min-h-32"
              aria-label="Your answer to the client"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={() => saveAnswer()} disabled={busy || !answerText.trim()}>
                {saving ? <Spinner /> : <Save className="size-4" />}
                {saving ? "Saving…" : "Save and compare"}
              </Button>
              {canGenerate && props.lock.status === "missing" && (
                <Button type="button" size="sm" variant="ghost" onClick={generate} disabled={busy}>
                  {generating ? <Spinner /> : <Sparkles className="size-4" />}
                  {generating ? "Preparing…" : "Prepare a suggestion"}
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">
            {props.closed ? "This ticket is closed." : "The team hasn't saved an answer yet."}
          </p>
        )}
        <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-muted-foreground">
          {props.draftPending || generating ? <Spinner className="mt-0.5" /> : <Lock className="mt-0.5 size-4 shrink-0" />}
          <span>{generating ? "A suggested answer is being prepared. Save your answer to compare when it's ready." : props.lock.message}</span>
        </p>
        {props.lastDraftError && !generating && (
          <p className="text-xs text-amber-700 dark:text-amber-300 wrap-anywhere">
            The last draft attempt failed: {props.lastDraftError}
          </p>
        )}
        {props.canEdit && <JevConnectionTest />}
        <p className="text-xs text-muted-foreground">
          The Hub never sends anything. Emails and phone numbers are masked when saved.
        </p>
      </div>
    )
  }

  // --------------------------------------------------------------- steps 2 and 3
  const teamCheckStale = teamCheck && !same(teamCheck.answerSnapshot, savedBody)
  const comparisonStale =
    comparison && (!same(comparison.teamAnswerSnapshot, savedBody) || !same(comparison.suggestionText, suggestion?.text))
  const finalCheckStale = finalCheck && !same(finalCheck.answerSnapshot, finalText)
  const finalDirty = !same(finalText, props.final?.body)

  return (
    <div className="space-y-6 text-sm">
      {/* ------------------------------------------------ Step 2: Review */}
      <section className="space-y-3" aria-label="Review">
        <StepHeader n={2} title="Review" hint={props.answer?.firstLabel}>
          {editable && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => (dirty ? saveAnswer("review") : review())}
              disabled={busy || !answerText.trim()}
            >
              {reviewing ? <Spinner /> : <ShieldCheck className="size-4" />}
              {reviewing ? "Checking…" : dirty ? "Save and re-run review" : "Re-run review"}
            </Button>
          )}
        </StepHeader>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Your answer */}
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="font-medium">Your answer</h4>
              <span className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : props.answer?.savedLabel}</span>
            </div>
            <Textarea
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              readOnly={!editable}
              disabled={busy}
              maxLength={SUPPORT_ANSWER_MAX}
              rows={7}
              className="min-h-40"
              aria-label="Your answer to the client"
            />
            {editable && (
              <Button type="button" size="sm" variant="outline" onClick={() => saveAnswer()} disabled={busy || !dirty || !answerText.trim()}>
                {saving ? <Spinner /> : <Save className="size-4" />}
                {saving ? "Saving…" : "Save"}
              </Button>
            )}
            {props.answer && !same(props.answer.firstBody, savedBody) && (
              <div className="text-xs">
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setShowFirst((v) => !v)}
                  aria-expanded={showFirst}
                >
                  {showFirst ? "Hide" : "Show"} your first answer (written before the suggestion)
                </button>
                {showFirst && (
                  <p className="mt-1 rounded-md border bg-muted/40 p-2 whitespace-pre-wrap wrap-anywhere">{props.answer.firstBody}</p>
                )}
              </div>
            )}
          </div>

          {/* Suggested answer */}
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <h4 className="mr-1 font-medium">Suggested answer</h4>
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
                </span>
              )}
            </div>
            {suggestion ? (
              <>
                {suggestion.freshness === "client_wrote_since" && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">The client wrote again after this draft.</p>
                )}
                {suggestion.gaps.length > 0 && (
                  <p className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-900 wrap-anywhere dark:bg-amber-950/40 dark:text-amber-200">
                    Gaps to fill: {suggestion.gaps.join(", ")}
                  </p>
                )}
                <div className={cn("rounded-md border bg-muted/40 p-3 whitespace-pre-wrap wrap-anywhere", generating && "opacity-60")}>
                  {suggestion.text}
                </div>
                {suggestion.sources?.length ? (
                  <SourceList sources={suggestion.sources} />
                ) : suggestion.basis.length ? (
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
                {suggestion.source === "hub" && <WhyConfidence confidence={suggestion.confidence} />}
                <div className="flex flex-wrap items-center gap-2">
                  <CopyDraftButton text={suggestion.text} />
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
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-muted-foreground">
                  {props.draftPending || generating ? "A suggested answer is being prepared." : props.lock.status === "blocked" ? props.lock.message : props.runtime.drafts ? "No suggested answer for this ticket yet." : "AI drafting not configured."}
                </p>
                {canGenerate && !props.draftPending && (
                  <Button type="button" size="sm" variant="outline" onClick={generate} disabled={busy}>
                    {generating ? <Spinner /> : <Sparkles className="size-4" />}
                    {generating ? "Drafting…" : "Prepare a suggestion"}
                  </Button>
                )}
              </div>
            )}
            {props.lastDraftError && !generating && (
              <p className="text-xs text-amber-700 dark:text-amber-300 wrap-anywhere">The last draft attempt failed: {props.lastDraftError}</p>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ResultPanel
            title="AI check on your answer"
            busy={reviewing}
            busyLabel="Checking with Jev…"
            badge={teamCheck ? { label: SUPPORT_ANSWER_VERDICT_LABEL[teamCheck.verdict], className: SUPPORT_ANSWER_VERDICT_BADGE[teamCheck.verdict] } : null}
            meta={teamCheck?.checkedLabel}
            stale={teamCheckStale ? "This check is for an earlier version of your answer. Re-run the review." : null}
          >
            {teamCheck ? (
              <ResultList rows={teamCheck.results} dimmed={!!teamCheckStale} />
            ) : (
              <div className="space-y-2">
                <p className="text-muted-foreground">
                  {!props.runtime.check ? "AI check not configured." : reviewError ?? "No AI check yet."}
                </p>
                {editable && props.runtime.check && (
                  <Button type="button" size="sm" variant="outline" onClick={review} disabled={busy}>
                    <ShieldCheck className="size-4" />
                    Run review
                  </Button>
                )}
                {props.canEdit && <JevConnectionTest />}
              </div>
            )}
            {teamCheck && reviewError && <p className="text-xs text-amber-700 dark:text-amber-300 wrap-anywhere">{reviewError}</p>}
          </ResultPanel>

          <ResultPanel
            title="Compared with the suggestion"
            busy={reviewing && !!suggestion}
            busyLabel="Comparing…"
            badge={
              comparison?.verdict
                ? { label: SUPPORT_COMPARISON_VERDICT_LABEL[comparison.verdict], className: SUPPORT_COMPARISON_VERDICT_BADGE[comparison.verdict] }
                : null
            }
            meta={comparison?.checkedLabel}
            stale={comparisonStale ? "Compared with an earlier version of one of the answers. Re-run the review." : null}
          >
            {!suggestion ? (
              <p className="text-muted-foreground">Nothing to compare with yet.</p>
            ) : !comparison ? (
              <p className="text-muted-foreground">Not compared yet.</p>
            ) : (
              <>
                {comparison.jevStatus === "ok" ? (
                  <ResultList rows={comparison.results} dimmed={!!comparisonStale} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {comparison.jevStatus === "failed" ? "The Jev comparison failed. Needs a human look." : "AI check not configured."}
                  </p>
                )}
                <div className="space-y-1">
                  <p className="text-xs font-medium">What the suggestion adds</p>
                  {comparison.addsStatus !== "ok" ? (
                    <p className="text-xs text-muted-foreground">
                      {comparison.addsStatus === "failed" ? "Couldn't list it this time." : "AI drafting not configured."}
                    </p>
                  ) : comparison.adds.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nothing the client asked about that your answer misses.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {comparison.adds.map((a) => (
                        <li key={a.quote} className="text-xs">
                          <p className="wrap-anywhere">{a.point}</p>
                          <p className="border-l-2 pl-2 text-muted-foreground wrap-anywhere">“{a.quote}”</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </ResultPanel>
        </div>
        <p className="text-xs text-muted-foreground">
          Mid-confidence results are never a pass or a fail: a person decides.
        </p>
      </section>

      {/* ------------------------------------------------ Step 3: Final answer */}
      <section className="space-y-3 border-t pt-5" aria-label="Final answer">
        <StepHeader n={3} title="Final answer" hint={props.final?.savedLabel ?? "Not saved yet"}>
          {props.final?.usedSuggestion && (
            <Badge variant="outline" className="font-normal">
              {SUPPORT_USED_SUGGESTION_LABEL[props.final.usedSuggestion]}
            </Badge>
          )}
        </StepHeader>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => pickFinal("mine", savedBody)} disabled={busy}>
              <Undo2 className="size-4" />
              Keep mine
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => suggestion && pickFinal("suggested", suggestion.text)}
              disabled={busy || !suggestion}
            >
              <FileText className="size-4" />
              Use suggested
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={merge}
              disabled={busy || !suggestion || !props.runtime.drafts}
              title={!props.runtime.drafts ? "AI drafting not configured" : undefined}
            >
              {merging ? <Spinner /> : <Combine className="size-4" />}
              {merging ? "Merging…" : "Merge with AI"}
            </Button>
          </div>
        )}
        {mergeNote && mergeNote.length > 0 && (
          <p className="text-xs text-muted-foreground wrap-anywhere">Taken from the suggestion: {mergeNote.join("; ")}</p>
        )}
        <Textarea
          value={finalText}
          onChange={(e) => setFinalText(e.target.value)}
          readOnly={!editable}
          disabled={busy}
          maxLength={SUPPORT_ANSWER_MAX}
          rows={7}
          className="min-h-40"
          aria-label="Final answer to send in Assembly"
        />
        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={checkFinal}
                disabled={busy || !finalText.trim() || !props.runtime.check}
                title={props.runtime.check ? undefined : "AI check not configured"}
              >
                {checkingFinal ? <Spinner /> : <ShieldCheck className="size-4" />}
                {checkingFinal ? "Checking…" : "Check final"}
              </Button>
              <Button type="button" size="sm" onClick={saveFinal} disabled={busy || !finalText.trim() || (!finalDirty && !!props.final)}>
                {savingFinal ? <Spinner /> : <Save className="size-4" />}
                {savingFinal ? "Saving…" : "Save final answer"}
              </Button>
            </>
          )}
          <CopyDraftButton text={finalText} label="Copy final answer" copiedToast="Final answer copied. Send it in Assembly." />
          {finalDirty && props.final && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        </div>
        {(finalCheck || checkingFinal) && (
          <ResultPanel
            title="AI check on the final answer"
            busy={checkingFinal}
            busyLabel="Checking with Jev…"
            badge={finalCheck ? { label: SUPPORT_ANSWER_VERDICT_LABEL[finalCheck.verdict], className: SUPPORT_ANSWER_VERDICT_BADGE[finalCheck.verdict] } : null}
            meta={finalCheck?.checkedLabel}
            stale={finalCheckStale ? "This check is for an earlier version of the final answer." : null}
          >
            {finalCheck && <ResultList rows={finalCheck.results} dimmed={!!finalCheckStale} />}
          </ResultPanel>
        )}
        {props.moneyAtStake && (
          <p className="text-xs text-amber-700 dark:text-amber-300">Money at stake: get Fede&apos;s approval before sending.</p>
        )}
        <p className="text-xs text-muted-foreground">
          The Hub never sends this. Copy it into Assembly yourself. Emails and phone numbers are masked when saved.
        </p>
      </section>

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
