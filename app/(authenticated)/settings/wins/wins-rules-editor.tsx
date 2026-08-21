"use client"

import { useMemo, useState, useTransition } from "react"
import { ArrowRight, History, RotateCcw, TriangleAlert } from "lucide-react"
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
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import {
  WINS_RULE_FIELDS,
  evaluateCandidate,
  type CandidateRawInputs,
  type WinCategory,
  type WinsRuleInput,
  type WinsRules,
  validateRuleSet,
} from "@/lib/wins"

import { activateWinRulesAction, publishWinRulesAction } from "./actions"

type PreviewCandidate = {
  id: string
  listing_name: string
  raw: CandidateRawInputs
  staticReasonCodes: string[]
}

type RuleSetRow = {
  id: string
  version: number
  note: string | null
  is_active: boolean
  created_at: string
  author_name?: string | null
}

const CATEGORY_LABEL: Record<WinCategory, string> = {
  double_win: "Double Win",
  yoy_positive_steady: "YoY+ Steady",
  market_compass_candidate: "Market Compass",
  conflicting_signal: "Conflicting",
  insufficient_data: "Insufficient data",
  no_win: "No win",
}

const PREVIEW_ORDER: WinCategory[] = [
  "double_win",
  "yoy_positive_steady",
  "market_compass_candidate",
  "conflicting_signal",
  "insufficient_data",
]

/** Percent-unit fields are stored as fractions but edited as percentages. */
function toDisplay(key: keyof WinsRuleInput, value: number): number {
  const field = WINS_RULE_FIELDS.find((f) => f.key === key)!
  return field.unit === "percent" ? Math.round(value * 1000) / 10 : value
}
function fromDisplay(key: keyof WinsRuleInput, value: number): number {
  const field = WINS_RULE_FIELDS.find((f) => f.key === key)!
  return field.unit === "percent" ? value / 100 : value
}

function unitSuffix(unit: string): string {
  switch (unit) {
    case "percent":
      return "%"
    case "currency":
      return "USD"
    case "days":
      return "days"
    case "points":
      return "pp"
    default:
      return ""
  }
}

function stripVersion(rules: WinsRules): WinsRuleInput {
  const { version: _version, ...rest } = rules
  return rest
}

export function WinsRulesEditor({
  activeRules,
  history,
  canPublish,
  sample,
  run,
}: {
  activeRules: WinsRules
  history: RuleSetRow[]
  canPublish: boolean
  sample: PreviewCandidate[]
  run: {
    asOfDate: string
    periodLabel: string
    candidateCount: number
    rulesVersion: string
  } | null
}) {
  const baseline = useMemo(() => stripVersion(activeRules), [activeRules])
  const [draft, setDraft] = useState<WinsRuleInput>(baseline)
  const [note, setNote] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const dirty = useMemo(
    () => WINS_RULE_FIELDS.some((f) => draft[f.key] !== baseline[f.key]),
    [draft, baseline]
  )

  const validation = useMemo(() => validateRuleSet(draft), [draft])
  const validationError = "error" in validation ? validation.error : null

  /**
   * Re-evaluate the latest run under both rule sets.
   *
   * Uses the very same `evaluateCandidate` the detector runs, so the preview
   * cannot drift from what publishing would actually produce.
   */
  const impact = useMemo(() => {
    if (sample.length === 0 || validationError) return null
    const before: Record<string, number> = {}
    const after: Record<string, number> = {}
    let moved = 0

    for (const c of sample) {
      const a = evaluateCandidate(c.raw, c.staticReasonCodes, {
        ...baseline,
        version: "baseline",
      })
      const b = evaluateCandidate(c.raw, c.staticReasonCodes, { ...draft, version: "draft" })
      before[a.category] = (before[a.category] ?? 0) + 1
      after[b.category] = (after[b.category] ?? 0) + 1
      if (a.category !== b.category) moved++
    }
    return { before, after, moved }
  }, [sample, baseline, draft, validationError])

  function setField(key: keyof WinsRuleInput, displayValue: string) {
    const parsed = Number(displayValue)
    if (!Number.isFinite(parsed)) return
    setDraft((prev) => ({ ...prev, [key]: fromDisplay(key, parsed) }))
  }

  function onPublish() {
    startTransition(async () => {
      const result = await publishWinRulesAction(draft, note)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success(`Published rules v${result.version}`)
      setNote("")
      setConfirmOpen(false)
    })
  }

  function onActivate(row: RuleSetRow) {
    startTransition(async () => {
      const result = await activateWinRulesAction(row.id)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success(`Rules v${row.version} is now active`)
    })
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Wins detection rules</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          These thresholds decide what counts as each kind of win. Saving publishes a new
          version rather than editing the current one, so every past detection run stays
          explainable by the exact numbers that produced it.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary" className="font-medium">
          Active: {activeRules.version}
        </Badge>
        {run ? (
          <span className="text-muted-foreground">
            Latest run analysed {run.candidateCount} listings as of {run.asOfDate} under{" "}
            {run.rulesVersion}
          </span>
        ) : (
          <span className="text-muted-foreground">No detection run yet</span>
        )}
      </div>

      <Separator />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {WINS_RULE_FIELDS.map((field) => {
              const changed = draft[field.key] !== baseline[field.key]
              return (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={field.key} className="flex items-center gap-2">
                    {field.label}
                    {changed ? (
                      <Badge variant="outline" className="text-[10px]">
                        changed
                      </Badge>
                    ) : null}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={field.key}
                      type="number"
                      inputMode="decimal"
                      step={field.step}
                      min={field.min}
                      max={field.max}
                      disabled={!canPublish}
                      value={toDisplay(field.key, draft[field.key])}
                      onChange={(e) => setField(field.key, e.target.value)}
                      className={cn("font-mono tabular-nums", changed && "border-primary")}
                    />
                    <span className="w-10 shrink-0 text-xs text-muted-foreground">
                      {unitSuffix(field.unit)}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{field.help}</p>
                </div>
              )
            })}
          </div>

          {validationError ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {validationError}
            </div>
          ) : null}

          {canPublish ? (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="space-y-1.5">
                <Label htmlFor="rules-note">Why this change? (optional)</Label>
                <Input
                  id="rules-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Raised the STLY floor after the Q3 review"
                  maxLength={300}
                />
                <p className="text-xs text-muted-foreground">
                  Stored with the version so the next reviewer knows the reasoning.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!dirty || Boolean(validationError) || pending}
                  onClick={() => setConfirmOpen(true)}
                >
                  Publish new version
                </Button>
                <Button
                  variant="ghost"
                  disabled={!dirty || pending}
                  onClick={() => setDraft(baseline)}
                  className="gap-2"
                >
                  <RotateCcw className="size-4" />
                  Reset
                </Button>
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Publishing detection rules requires the <code>wins:control</code> permission.
              You can review the current thresholds here.
            </p>
          )}
        </section>

        <aside className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <h3 className="text-sm font-semibold">Impact on the latest run</h3>
              {!run ? (
                <p className="text-xs text-muted-foreground">
                  Run detection once to preview how a threshold change would reclassify the
                  portfolio.
                </p>
              ) : validationError ? (
                <p className="text-xs text-muted-foreground">
                  Fix the values above to see the impact.
                </p>
              ) : !dirty ? (
                <p className="text-xs text-muted-foreground">
                  Change a threshold to see how {sample.length} listings would be
                  reclassified.
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Re-evaluated with the same code the detector runs. Publishing does not
                    rerun detection — press Run detection on /wins afterwards.
                  </p>
                  <div className="space-y-1.5">
                    {PREVIEW_ORDER.map((cat) => {
                      const b = impact?.before[cat] ?? 0
                      const a = impact?.after[cat] ?? 0
                      const delta = a - b
                      return (
                        <div
                          key={cat}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="text-muted-foreground">{CATEGORY_LABEL[cat]}</span>
                          <span className="flex items-center gap-1.5 font-mono tabular-nums">
                            <span className="text-muted-foreground">{b}</span>
                            <ArrowRight className="size-3 text-muted-foreground" />
                            <span className="font-semibold">{a}</span>
                            {delta !== 0 ? (
                              <span
                                className={cn(
                                  "w-9 text-right",
                                  delta > 0
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-rose-600 dark:text-rose-400"
                                )}
                              >
                                {delta > 0 ? "+" : ""}
                                {delta}
                              </span>
                            ) : (
                              <span className="w-9" />
                            )}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <Separator />
                  <p className="text-xs">
                    <span className="font-mono font-semibold tabular-nums">
                      {impact?.moved ?? 0}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      of {sample.length} listings change category
                    </span>
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <History className="size-4 text-muted-foreground" />
                Version history
              </h3>
              <div className="space-y-2">
                {history.map((row) => (
                  <div key={row.id} className="rounded-md bg-muted/50 p-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-medium">v{row.version}</span>
                      {row.is_active ? (
                        <Badge variant="secondary" className="text-[10px]">
                          active
                        </Badge>
                      ) : canPublish ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          disabled={pending}
                          onClick={() => onActivate(row)}
                        >
                          Activate
                        </Button>
                      ) : null}
                    </div>
                    {row.note ? <p className="mt-1 text-muted-foreground">{row.note}</p> : null}
                    <p className="mt-1 text-muted-foreground">
                      {row.created_at.slice(0, 10)}
                      {row.author_name ? ` · ${row.author_name}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish new detection rules?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This publishes a new version and makes it active for everyone. Past runs
                  keep the rules they were computed with.
                </p>
                {impact && impact.moved > 0 ? (
                  <p>
                    Based on the latest run, <strong>{impact.moved}</strong> of {sample.length}{" "}
                    listings would change category the next time detection runs.
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault()
                onPublish()
              }}
            >
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
