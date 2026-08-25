"use client"

import { useEffect, useState } from "react"
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Copy,
  ExternalLink,
  Lightbulb,
  MessageSquareCheck,
  RotateCcw,
  Trash2,
  TriangleAlert,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { copyToClipboard, openExternal } from "@/lib/clipboard"
import { cn } from "@/lib/utils"
import { REASON_CODE_LABELS, type PickupTrend, type WinCandidate, type WinCategory } from "@/lib/wins"
import { MESSAGE_MAX_LENGTH, formatCurrency, formatPercent } from "@/lib/wins-message"

import {
  generateWinMessageAction,
  markWinSharedAction,
  recordWinEventAction,
  saveEditedMessageAction,
  updateWinReviewAction,
} from "./actions"

/** Shown once per session: the two actions below do not send anything. */
let notSentNoticeShown = false

const CATEGORY_LABEL: Record<WinCategory, string> = {
  double_win: "Double Win",
  yoy_positive_steady: "YoY+ Steady",
  market_compass_candidate: "Market Compass",
  conflicting_signal: "Conflicting signal",
  insufficient_data: "Insufficient data",
  no_win: "No win",
}

const CATEGORY_TONE: Record<WinCategory, string> = {
  double_win: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  yoy_positive_steady: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  market_compass_candidate: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  conflicting_signal: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  insufficient_data: "bg-muted text-muted-foreground",
  no_win: "bg-muted text-muted-foreground",
}

const TREND_TONE: Record<PickupTrend, string> = {
  up: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  up_from_zero: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  held: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  down: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  no_pickup: "bg-muted text-muted-foreground",
  insufficient_data: "bg-muted text-muted-foreground",
}

const TREND_LABEL: Record<PickupTrend, string> = {
  up: "Up",
  up_from_zero: "Up from zero",
  held: "Held",
  down: "Down",
  no_pickup: "No pickup",
  insufficient_data: "Insufficient data",
}

/** Green for a gain, rose for a loss, neutral for flat or unknown. */
function deltaTone(value: number | null | undefined): string {
  if (value == null || value === 0) return "text-foreground"
  return value > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400"
}

/**
 * RevPAR Index traffic light from the reference workbook's own thresholds.
 * Always paired with a text label — colour alone must not carry the meaning.
 */
function revparBand(index: number | null): { label: string; tone: string } | null {
  if (index == null) return null
  if (index >= 105) return { label: "Ahead of comp set", tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" }
  if (index >= 100) return { label: "At comp set", tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300" }
  if (index >= 90) return { label: "Slightly behind", tone: "bg-amber-500/12 text-amber-700 dark:text-amber-300" }
  return { label: "Behind comp set", tone: "bg-rose-500/12 text-rose-700 dark:text-rose-300" }
}

function signed(value: number, currency: string): string {
  return `${value >= 0 ? "+" : "−"}${formatCurrency(Math.abs(value), currency)}`
}

export function WinDetailDrawer({
  candidate,
  open,
  onOpenChange,
  canEdit,
  canControl,
  onChanged,
}: {
  candidate: WinCandidate | null
  open: boolean
  onOpenChange: (open: boolean) => void
  canEdit: boolean
  canControl: boolean
  onChanged: () => void
}) {
  const [body, setBody] = useState("")
  const [draftId, setDraftId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dismissOpen, setDismissOpen] = useState(false)
  const [dismissReason, setDismissReason] = useState("")

  useEffect(() => {
    if (!open || !candidate) return
    setBody("")
    setDraftId(null)
    setDismissReason("")
    void recordWinEventAction(candidate.id, "viewed")
    if (canEdit) void generate(candidate.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, candidate?.id])

  async function generate(candidateId: string) {
    setBusy(true)
    try {
      const result = await generateWinMessageAction(candidateId)
      if ("error" in result) {
        setBody("")
        return
      }
      setBody(result.body)
      setDraftId(result.draftId)
    } finally {
      setBusy(false)
    }
  }

  if (!candidate) return null

  const { evidence } = candidate
  const { pickup, yoy, occupancy, adr, market, currency, period, windows } = evidence
  const hasMessage = body.trim().length > 0
  const tooLong = body.length > MESSAGE_MAX_LENGTH
  const noChat = !candidate.assembly_deep_link
  const band = revparBand(market.revpar_index)
  const warnings = candidate.reason_codes

  function showNotSentNotice() {
    if (notSentNoticeShown) return
    notSentNoticeShown = true
    toast.info("Copying and opening the chat do not send anything. Paste and send it yourself in Assembly.")
  }

  async function onCopy() {
    if (!candidate) return
    const ok = await copyToClipboard(body)
    if (!ok) {
      toast.error("Could not copy. Select the text and copy it manually.")
      return
    }
    toast.success("Message copied")
    showNotSentNotice()
    void recordWinEventAction(candidate.id, "copied", draftId)
  }

  function onOpenAssembly() {
    if (!candidate?.assembly_deep_link) return
    if (!openExternal(candidate.assembly_deep_link)) {
      toast.error("Your browser blocked the popup. Allow popups for this site and try again.")
      return
    }
    showNotSentNotice()
    void recordWinEventAction(candidate.id, "assembly_opened", draftId)
  }

  async function onSaveEdit() {
    if (!candidate) return
    setBusy(true)
    try {
      const result = await saveEditedMessageAction(candidate.id, body)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      setDraftId(result.draftId)
      toast.success("Draft saved")
    } finally {
      setBusy(false)
    }
  }

  async function onMarkShared() {
    if (!candidate) return
    setBusy(true)
    try {
      const result = await markWinSharedAction(candidate.id)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success("Marked as shared manually")
      onChanged()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  async function onDismiss() {
    if (!candidate) return
    setBusy(true)
    try {
      const result = await updateWinReviewAction(candidate.id, "dismissed", dismissReason)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success("Win dismissed")
      setDismissOpen(false)
      onChanged()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/*
          Two width rules, both needing the `data-[side=right]:` prefix: the base
          SheetContent pins the horizontal sides to `w-3/4` and `sm:max-w-sm`
          (384px) through data-attribute variants, and plain `w-full` /
          `sm:max-w-*` cannot override them — different variant groups, so
          tailwind-merge keeps both and the attribute selector wins. This drawer
          holds a three-column metric grid and an editable message, so 384px
          truncated nearly every value.

          The scroll deliberately lives on the inner wrapper below, NOT here:
          `glass-chrome` paints its backdrop-filter on an absolutely-positioned
          ::before sized to the element's visible box. Put the scroll on the
          same element and that pseudo scrolls away with the content, so past
          one viewport of scrolling the frosted panel simply ends and the page
          shows through. See the "Known limitation" note in conventions.md.
        */}
        <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-2xl data-[side=right]:xl:max-w-3xl">
          <SheetHeader className="gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn("font-medium", CATEGORY_TONE[candidate.category])} variant="secondary">
                {CATEGORY_LABEL[candidate.category]}
              </Badge>
              <Badge variant="outline" className="capitalize">
                {candidate.confidence} confidence
              </Badge>
              {candidate.review_state && candidate.review_state !== "new" ? (
                <Badge variant="outline" className="capitalize">
                  {candidate.review_state.replace(/_/g, " ")}
                </Badge>
              ) : null}
            </div>
            <SheetTitle className="wrap-anywhere text-xl leading-tight">
              {candidate.listing_name_snapshot}
            </SheetTitle>
            <SheetDescription>
              {candidate.client_name_snapshot ?? "Unassigned client"}
            </SheetDescription>
          </SheetHeader>

          {/* min-h-0 lets this flex child shrink below its content height,
              which is what actually allows it to scroll instead of stretching
              the sheet. */}
          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-4 pb-10">
            {warnings.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                {warnings.map((code) => (
                  <Badge
                    key={code}
                    variant="outline"
                    className="border-amber-500/40 bg-background/60 text-xs text-amber-700 dark:text-amber-300"
                  >
                    {REASON_CODE_LABELS[code] ?? code}
                  </Badge>
                ))}
              </div>
            ) : null}

            {/* The two figures that decide whether this is worth communicating. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Hero
                label="Pickup change"
                sublabel="Latest 31-day window vs prior"
                value={signed(pickup.delta_abs, currency)}
                secondary={pickup.change_pct != null ? formatPercent(pickup.change_pct) : null}
                tone={deltaTone(pickup.delta_abs)}
                trend={pickup.trend}
              />
              <Hero
                label="Revenue vs STLY"
                sublabel={period.label}
                value={signed(yoy.delta_abs, currency)}
                secondary={
                  yoy.pct != null && yoy.pct_suppressed_reason == null
                    ? formatPercent(yoy.pct)
                    : null
                }
                tone={deltaTone(yoy.delta_abs)}
                note={
                  yoy.pct_suppressed_reason === "no_stly"
                    ? "No comparable prior year"
                    : yoy.pct_suppressed_reason === "small_base"
                      ? "Base too small for a %"
                      : yoy.pct_suppressed_reason === "extreme"
                        ? "% too extreme to quote"
                        : null
                }
              />
            </div>

            <Section
              title="Recent pickup"
              subtitle="By booked date. Cancelled reservations excluded."
              accent="bg-emerald-500"
            >
              <Metric label={`W3 · ${windows.w3[0]} → ${windows.w3[1]}`} value={formatCurrency(pickup.w3, currency)} />
              <Metric label={`W2 · ${windows.w2[0]} → ${windows.w2[1]}`} value={formatCurrency(pickup.w2, currency)} />
              <Metric
                label="Median lead time"
                value={pickup.median_lead_days_w3 != null ? `${Math.round(pickup.median_lead_days_w3)} days` : "—"}
              />
              <Metric label="Reservations in W3" value={String(pickup.reservation_count_w3)} />
            </Section>

            <Section
              title={`Period performance — ${period.label}`}
              subtitle="By stay date. STLY is same-time-last-year pace, not last year's final result."
              accent="bg-sky-500"
            >
              <Metric label="Revenue TY" value={formatCurrency(yoy.revenue_ty, currency)} />
              <Metric label="Revenue STLY" value={formatCurrency(yoy.revenue_stly, currency)} />
              <Metric
                label="Occupancy TY"
                value={occupancy.ty_pct != null ? `${occupancy.ty_pct.toFixed(1)}%` : "—"}
              />
              <Metric
                label="Occupancy STLY"
                value={occupancy.stly_pct != null ? `${occupancy.stly_pct.toFixed(1)}%` : "—"}
              />
              <Metric label="ADR TY" value={adr.ty != null ? formatCurrency(adr.ty, currency) : "—"} />
              <Metric label="ADR STLY" value={adr.stly != null ? formatCurrency(adr.stly, currency) : "—"} />
              <p className="col-span-full text-xs leading-relaxed text-muted-foreground">
                Occupancy and ADR are simple averages across months (PriceLabs convention). The Hub
                has no daily available-nights source, so they cannot be weighted.
              </p>
            </Section>

            <Section title="Market context" accent="bg-violet-500">
              <Metric
                label="RevPAR Index"
                value={market.revpar_index != null ? market.revpar_index.toFixed(0) : "—"}
                badge={band ? { label: band.label, tone: band.tone } : undefined}
                wide
              />
              <Metric
                label="Occupancy vs market"
                value={
                  occupancy.gap_pp != null
                    ? `${occupancy.gap_pp > 0 ? "+" : "−"}${Math.abs(occupancy.gap_pp).toFixed(1)} pp`
                    : "—"
                }
                tone={deltaTone(occupancy.gap_pp)}
              />
              <Metric
                label="ADR vs market"
                value={
                  adr.vs_market_pct != null
                    ? `${adr.vs_market_pct > 0 ? "+" : "−"}${Math.abs(adr.vs_market_pct).toFixed(1)}%`
                    : "—"
                }
                tone={deltaTone(adr.vs_market_pct)}
              />
              <Metric
                label="Market RevPAR YoY"
                value={
                  market.market_revpar_yoy_pct != null
                    ? `${market.market_revpar_yoy_pct.toFixed(1)}%`
                    : "—"
                }
              />
              <Metric
                label="Booking window vs market"
                value={
                  market.bw_vs_market_days != null
                    ? `${market.bw_vs_market_days > 0 ? "+" : "−"}${Math.abs(market.bw_vs_market_days).toFixed(0)} days`
                    : "—"
                }
              />
            </Section>

            {evidence.opportunity.potential_revenue_open_inventory ? (
              /* Deliberately styled as an aside: this is upside, not proof of a
                 win, and it is banned from every message template. */
              <section className="rounded-lg border border-dashed p-4">
                <div className="flex items-start gap-2.5">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium">Opportunity — not evidence of the win</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Recommended revenue on still-open inventory. Never used in the client message.
                    </p>
                    <p className="mt-2 font-mono text-lg tabular-nums">
                      {formatCurrency(evidence.opportunity.potential_revenue_open_inventory, currency)}
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            <Collapsible>
              <CollapsibleTrigger className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground motion-snappy">
                Sources and definitions
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                {evidence.sources.map((s) => (
                  <div key={s.name}>
                    <span className="font-medium text-foreground">{s.name}</span>
                    {s.as_of ? ` · as of ${s.as_of}` : null}
                    {s.note ? <p className="mt-0.5">{s.note}</p> : null}
                  </div>
                ))}
                <p>
                  Pickup compares two consecutive 31-day windows by the date the guest booked.
                  Period performance compares revenue for stays in {period.label} against the same
                  point last year.
                </p>
              </CollapsibleContent>
            </Collapsible>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Suggested message</h3>
                {canEdit && hasMessage ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => generate(candidate.id)}
                    className="gap-1.5"
                  >
                    <RotateCcw className="size-3.5" />
                    Regenerate
                  </Button>
                ) : null}
              </div>

              {hasMessage ? (
                <>
                  <Textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={7}
                    readOnly={!canEdit}
                    aria-label="Suggested message"
                    className={cn("resize-y leading-relaxed", tooLong && "border-destructive")}
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className={cn("tabular-nums", tooLong && "text-destructive")}>
                      {body.length} / {MESSAGE_MAX_LENGTH}
                    </span>
                    {canEdit ? (
                      <Button variant="ghost" size="sm" disabled={busy || tooLong} onClick={onSaveEdit}>
                        Save edit
                      </Button>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={onCopy} className="gap-2">
                      <Copy className="size-4" />
                      Copy message
                    </Button>
                    <Button
                      variant="outline"
                      onClick={onOpenAssembly}
                      disabled={noChat}
                      className="gap-2"
                    >
                      <ExternalLink className="size-4" />
                      Open in Assembly
                    </Button>
                  </div>
                  {noChat ? (
                    <p className="text-xs text-muted-foreground">
                      {canControl
                        ? "This client has no Assembly chat linked, so the chat cannot be opened from here."
                        : "Opening client chats requires the wins:control permission."}
                    </p>
                  ) : null}
                  {/* The whole point of the feature, said plainly. */}
                  <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    Copying and opening the chat do not send anything. Paste and send the message
                    yourself in Assembly.
                  </p>
                </>
              ) : (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  This category does not produce a client message. Conflicting signals and listings
                  with insufficient data are for internal review only.
                </p>
              )}
            </div>

            {canEdit || canControl ? (
              <>
                <Separator />
                <div className="flex flex-wrap gap-2">
                  {canControl ? (
                    <Button variant="secondary" disabled={busy} onClick={onMarkShared} className="gap-2">
                      <MessageSquareCheck className="size-4" />
                      Mark as shared manually
                    </Button>
                  ) : null}
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setDismissOpen(true)}
                      className="gap-2 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                      Dismiss
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={dismissOpen} onOpenChange={setDismissOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dismiss this win?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be hidden from the queue until someone reopens it. A reason is required so the
              next reviewer knows why.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={dismissReason}
            onChange={(e) => setDismissReason(e.target.value)}
            placeholder="Reason for dismissing"
            aria-label="Reason for dismissing"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!dismissReason.trim() || busy}
              onClick={(e) => {
                e.preventDefault()
                void onDismiss()
              }}
            >
              Dismiss
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function Hero({
  label,
  sublabel,
  value,
  secondary,
  tone,
  trend,
  note,
}: {
  label: string
  sublabel: string
  value: string
  secondary?: string | null
  tone: string
  trend?: PickupTrend
  note?: string | null
}) {
  const TrendIcon =
    trend === "down" ? ArrowDownRight : trend === "held" ? ArrowRight : ArrowUpRight
  return (
    <div className="rounded-xl border bg-card p-4 shadow-e1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium">{label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{sublabel}</p>
        </div>
        {trend ? (
          <Badge className={cn("shrink-0 gap-1 font-medium", TREND_TONE[trend])} variant="secondary">
            <TrendIcon className="size-3" />
            {TREND_LABEL[trend]}
          </Badge>
        ) : null}
      </div>
      <p className={cn("mt-3 font-mono text-2xl leading-none font-semibold tabular-nums", tone)}>
        {value}
      </p>
      {secondary ? (
        <p className="mt-1.5 font-mono text-sm tabular-nums text-muted-foreground">{secondary}</p>
      ) : note ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{note}</p>
      ) : null}
    </div>
  )
}

function Section({
  title,
  subtitle,
  accent,
  children,
}: {
  title: string
  subtitle?: string
  accent: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-1 h-4 w-1 shrink-0 rounded-full", accent)} aria-hidden />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle ? (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
    </section>
  )
}

function Metric({
  label,
  value,
  tone,
  badge,
  wide,
}: {
  label: string
  value: string
  tone?: string
  badge?: { label: string; tone: string }
  wide?: boolean
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg bg-muted/50 px-3 py-2.5",
        wide && "col-span-2 sm:col-span-1"
      )}
    >
      <p className="truncate text-[11px] leading-tight text-muted-foreground" title={label}>
        {label}
      </p>
      <p className={cn("mt-1 font-mono text-base leading-none tabular-nums", tone)}>{value}</p>
      {badge ? (
        <Badge
          variant="secondary"
          className={cn("mt-2 text-[10px] font-medium", badge.tone)}
        >
          {badge.label}
        </Badge>
      ) : null}
    </div>
  )
}
