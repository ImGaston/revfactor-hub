import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft, ExternalLink } from "lucide-react"

import { BreadcrumbSetter } from "@/components/layout/breadcrumb-context"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { adjustmentStatusLabel, adjustmentTypeLabel } from "@/lib/adjustments"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import {
  formatSupportDateTime,
  ownerLabel,
  supportEventActor,
  supportEventLabel,
  supportEventSide,
  ticketPropertyLabel,
  timeAgo,
} from "@/lib/support-display"
import { loadSupportTicket } from "@/lib/support-queue.server"
import {
  SUPPORT_CLOSED_STATUSES,
  SUPPORT_PRIORITY_BADGE,
  SUPPORT_SENTIMENT_BADGE,
  SUPPORT_SOURCE_LABEL,
  SUPPORT_STATUS_BADGE,
  SUPPORT_VERDICT_BADGE,
  commitmentTiming,
  dueState,
  effectiveDueAt,
  isDoneNotTold,
  nextDueAt,
  overrideReasonRequired,
  promiseLikelyKept,
  relativeDueLabel,
  resolutionBlockers,
  supportCategoryLabel,
  supportDismissReasonLabel,
  supportRequestTypeDoneWhen,
  supportRequestTypeLabel,
  supportStatusLabel,
  ticketRef,
  verifyAgeHours,
  type CommitmentTiming,
} from "@/lib/support-tickets"
import { cn } from "@/lib/utils"

const TIMING_BADGE: Record<CommitmentTiming, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" },
  overdue: { label: "Overdue", className: SUPPORT_VERDICT_BADGE.fail },
  kept_on_time: { label: "Kept on time", className: SUPPORT_VERDICT_BADGE.pass },
  kept_late: { label: "Kept late", className: SUPPORT_VERDICT_BADGE.uncertain },
  cancelled: { label: "Cancelled", className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
}

function pct(value: unknown): string | null {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : null
}

export default async function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const canView = await hasPermission("support", "view")
  if (!canView) redirect("/")

  const { id } = await params
  const supabase = await createClient()
  const data = await loadSupportTicket(supabase, id)
  if (!data) notFound()

  const { ticket: t, events, mergedFrom, possibleDuplicate, mergedInto } = data
  const now = new Date()
  const closed = SUPPORT_CLOSED_STATUSES.includes(t.status)
  const due = nextDueAt(t)
  const state = dueState(due, now)
  const blockers = resolutionBlockers(t)
  const promises = t.support_ticket_commitments ?? []
  const adjustments = t.adjustments ?? []
  const ai = t.ai_classification as {
    model?: string | null
    confidence?: { category?: number; request_type?: number; sentiment?: number }
    rationale?: string | null
    triage_reasons?: string[]
  }
  const verification = t.verification as { override_reason?: string }
  const verifyAge = verifyAgeHours(t, now)

  return (
    <div className="space-y-6">
      <BreadcrumbSetter segment={t.id} label={ticketRef(t.ticket_number)} />

      <Link
        href="/support"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Support queue
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm text-muted-foreground">{ticketRef(t.ticket_number)}</span>
          <Badge className={SUPPORT_STATUS_BADGE[t.status]}>{supportStatusLabel(t.status)}</Badge>
          <Badge variant="outline" className="font-normal">
            {supportCategoryLabel(t.category)}
          </Badge>
          <Badge variant="secondary" className="font-normal">
            {supportRequestTypeLabel(t.request_type)}
          </Badge>
          {t.priority !== "medium" && (
            <Badge className={SUPPORT_PRIORITY_BADGE[t.priority]}>
              {t.priority[0].toUpperCase() + t.priority.slice(1)} priority
            </Badge>
          )}
          {t.client_sentiment !== "neutral" && (
            <Badge className={SUPPORT_SENTIMENT_BADGE[t.client_sentiment]}>
              {t.client_sentiment === "unhappy" ? "Unhappy" : "Concerned"}
            </Badge>
          )}
          {t.client_chase_count > 0 && (
            <Badge className={SUPPORT_PRIORITY_BADGE.urgent}>Chased ×{t.client_chase_count}</Badge>
          )}
          {t.client_nudge_count > 0 && <Badge variant="outline">Nudged ×{t.client_nudge_count}</Badge>}
          {t.hand_managed && <Badge variant="outline">Hand-managed</Badge>}
          {t.backfilled && <Badge variant="outline">Backlog ({t.backfill_batch})</Badge>}
          {t.money_at_stake && <Badge className={SUPPORT_PRIORITY_BADGE.high}>Money at stake</Badge>}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance wrap-anywhere">{t.summary}</h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{t.clients?.name ?? "Unknown client"}</span>
            {t.requested_by_name ? ` · ${t.requested_by_name}` : ""}
          </span>
          <span>{ticketPropertyLabel(t)}</span>
          <span>Owner: {ownerLabel(t.assignee)}</span>
          {!closed && (
            <span>
              Next due:{" "}
              <span
                className={cn(
                  "font-mono",
                  state === "overdue" && "font-medium text-red-700 dark:text-red-300",
                  state === "due_soon" && "text-amber-700 dark:text-amber-300"
                )}
              >
                {relativeDueLabel(due, now)}
              </span>
            </span>
          )}
        </div>
      </header>

      {(possibleDuplicate || mergedInto || mergedFrom.length > 0) && (
        <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          {possibleDuplicate && (
            <p>
              Possible duplicate of{" "}
              <Link className="font-medium underline" href={`/support/${possibleDuplicate.id}`}>
                {ticketRef(possibleDuplicate.ticket_number)}
              </Link>{" "}
              ({possibleDuplicate.summary}).
            </p>
          )}
          {mergedInto && (
            <p>
              Merged into{" "}
              <Link className="font-medium underline" href={`/support/${mergedInto.id}`}>
                {ticketRef(mergedInto.ticket_number)}
              </Link>
              . Work continues there.
            </p>
          )}
          {mergedFrom.length > 0 && (
            <p>
              Absorbed {mergedFrom.map((m) => ticketRef(m.ticket_number)).join(", ")}. Their history is in
              the timeline below.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between gap-2 text-base">
                Client&apos;s ask
                <span className="text-xs font-normal text-muted-foreground">
                  {SUPPORT_SOURCE_LABEL[t.source]} · {formatSupportDateTime(t.requested_at)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {t.client_message ? (
                <blockquote className="border-l-2 pl-3 text-sm whitespace-pre-wrap wrap-anywhere">
                  {t.client_message}
                </blockquote>
              ) : (
                <p className="text-sm text-muted-foreground">No message text was captured.</p>
              )}
              <p className="rounded-md bg-muted px-3 py-2 text-sm">
                <span className="font-medium">Done when:</span> {supportRequestTypeDoneWhen(t.request_type)}
              </p>
              {t.needs_attachment_review && (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  The ask is in an attachment the bot couldn&apos;t read. Open the chat to see it.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Our answer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {t.answer_summary ? (
                <>
                  <blockquote className="border-l-2 pl-3 whitespace-pre-wrap wrap-anywhere">
                    {t.answer_summary}
                  </blockquote>
                  <p className="text-xs text-muted-foreground">Answered {formatSupportDateTime(t.answered_at)}</p>
                </>
              ) : (
                <p className="text-muted-foreground">No answer recorded yet.</p>
              )}
              {t.answer_check_verdict && (
                <div className="space-y-1.5 rounded-md border p-3">
                  <Badge className={SUPPORT_VERDICT_BADGE[t.answer_check_verdict]}>
                    Bot answer check: {t.answer_check_verdict}
                  </Badge>
                  {t.answer_check_asked && (
                    <p>
                      <span className="text-muted-foreground">Asked:</span> “{t.answer_check_asked}”
                    </p>
                  )}
                  {t.answer_check_replied && (
                    <p>
                      <span className="text-muted-foreground">Replied:</span> “{t.answer_check_replied}”
                    </p>
                  )}
                  {t.answer_check_gap && (
                    <p>
                      <span className="text-muted-foreground">Gap:</span> {t.answer_check_gap}
                    </p>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>First response: {formatSupportDateTime(t.first_response_at)}</span>
                <span>Told live: {t.client_told_live_at ? formatSupportDateTime(t.client_told_live_at) : "no"}</span>
                {t.client_acknowledged_at && <span>Client acknowledged {timeAgo(t.client_acknowledged_at, now)}</span>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <ol className="space-y-3">
                  {events.map((e) => {
                    const side = supportEventSide(e.event_type)
                    const miss = e.event_type === "client_rejected" || e.event_type === "verification_failed"
                    return (
                      <li key={e.id} className="grid grid-cols-[12px_minmax(0,1fr)] gap-3">
                        <span
                          className={cn(
                            "mt-1.5 size-3 rounded-full border-2",
                            side === "client" && "border-blue-500",
                            side === "team" && "border-emerald-600",
                            side === "system" && "border-violet-500",
                            miss && "border-red-500"
                          )}
                        />
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{supportEventLabel(e.event_type)}</span>
                            {" · "}
                            {supportEventActor(e)} · {formatSupportDateTime(e.occurred_at)}
                            {e.from_ticket_number ? ` · from ${ticketRef(e.from_ticket_number)}` : ""}
                            {typeof e.payload?.kind === "string" && e.payload.kind !== "reply"
                              ? ` · ${e.payload.kind}`
                              : ""}
                          </p>
                          {e.body && <p className="text-sm whitespace-pre-wrap wrap-anywhere">{e.body}</p>}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between gap-2 text-base">
                Verification
                <span className="text-xs font-normal text-muted-foreground">
                  {closed ? "" : blockers.length ? "Blocked" : "Ready"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {t.status === "resolved" ? (
                <>
                  <p>Verified and resolved {formatSupportDateTime(t.resolved_at)}.</p>
                  {verification.override_reason && (
                    <p className="text-muted-foreground">Override reason: {verification.override_reason}</p>
                  )}
                </>
              ) : t.status === "dismissed" ? (
                <p>
                  Dismissed: {t.dismiss_reason ? supportDismissReasonLabel(t.dismiss_reason) : "no reason"}
                  {t.dismiss_note ? ` (${t.dismiss_note})` : ""}
                </p>
              ) : (
                <>
                  <ul className="space-y-1.5">
                    {blockers.length === 0 ? (
                      <li className="flex gap-2">
                        <span className="text-emerald-600">✓</span>
                        Nothing blocks resolving
                      </li>
                    ) : (
                      blockers.map((b) => (
                        <li key={b} className="flex gap-2">
                          <span className="text-red-600">!</span>
                          {b}
                        </li>
                      ))
                    )}
                    {overrideReasonRequired(t) && (
                      <li className="flex gap-2">
                        <span className="text-amber-600">!</span>
                        The bot flagged the answer: the verifier must explain why it&apos;s still correct
                      </li>
                    )}
                  </ul>
                  {verifyAge !== null && (
                    <p className="text-xs text-muted-foreground">
                      Waiting {Math.round(verifyAge)}h for verification.
                    </p>
                  )}
                </>
              )}
              {isDoneNotTold(t) && !closed && (
                <p className="text-amber-700 dark:text-amber-300">
                  The change is controlled but the client hasn&apos;t been told it&apos;s live.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between gap-2 text-base">
                Promises
                <span className="text-xs font-normal text-muted-foreground">
                  {promises.filter((p) => p.status === "open").length} open
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {promises.length === 0 ? (
                <p className="text-muted-foreground">No promises on this ticket.</p>
              ) : (
                promises.map((p) => {
                  const timing = commitmentTiming(p, now)
                  const rescheduled = p.rescheduled_to && effectiveDueAt(p) !== p.due_at
                  return (
                    <div key={p.id} className="space-y-1 border-t pt-3 first:border-t-0 first:pt-0">
                      <div className="flex items-start justify-between gap-2">
                        <span className="wrap-anywhere">{p.description}</span>
                        <Badge className={TIMING_BADGE[timing].className}>{TIMING_BADGE[timing].label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {p.made_by_name ?? "Team"} · due {formatSupportDateTime(p.due_at)}
                        {rescheduled ? ` → rescheduled to ${formatSupportDateTime(p.rescheduled_to)}` : ""}
                        {p.closed_at ? ` · closed ${formatSupportDateTime(p.closed_at)}` : ""}
                      </p>
                      {promiseLikelyKept(p, adjustments) && (
                        <p className="text-xs text-emerald-700 dark:text-emerald-300">
                          Likely kept: a linked Adjustment was controlled after this promise. Confirm it.
                        </p>
                      )}
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Property</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>{ticketPropertyLabel(t)}</p>
              <p className="text-xs text-muted-foreground">
                {t.property_validated_at
                  ? `Validated ${formatSupportDateTime(t.property_validated_at)}`
                  : "Not validated yet"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Adjustments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {adjustments.length === 0 ? (
                <p className="text-muted-foreground">No Adjustment linked.</p>
              ) : (
                adjustments.map((a) => (
                  <Link
                    key={a.id}
                    href={`/adjustments/${a.id}`}
                    className="flex flex-wrap items-center gap-2 hover:underline"
                  >
                    <span>{adjustmentTypeLabel(a.type)}</span>
                    {a.target_value && <span className="text-muted-foreground">{a.target_value}</span>}
                    {a.listings?.name && <span className="text-muted-foreground">· {a.listings.name}</span>}
                    <Badge variant="secondary">{adjustmentStatusLabel(a.status)}</Badge>
                    <ExternalLink className="size-3 text-muted-foreground" />
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between gap-2 text-base">
                Classification
                <span className="text-xs font-normal text-muted-foreground">{ai.model ?? "manual"}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <p className="text-muted-foreground">
                Confidence: category {pct(ai.confidence?.category) ?? "—"} · type{" "}
                {pct(ai.confidence?.request_type) ?? "—"}
                {pct(ai.confidence?.sentiment) ? ` · sentiment ${pct(ai.confidence?.sentiment)}` : ""}
              </p>
              {ai.rationale && <p className="wrap-anywhere">{ai.rationale}</p>}
              {ai.triage_reasons && ai.triage_reasons.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Sent to triage: {ai.triage_reasons.map((r) => r.replace(/_/g, " ")).join(", ")}
                </p>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Read-only for now. Triage, answering, verifying, and merging arrive in the next update.
          </p>
        </div>
      </div>
    </div>
  )
}
