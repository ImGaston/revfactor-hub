"use client"

// Listing tabs built on the stored pricing plan: Strategy (open questions,
// decisions, plan vs live, seasons, approve), Goals (anchors + monthly goals
// and pace), Comps, Events and Listing Audit. Each tab loads its data when it
// opens. Price math: lib/pricing-plan.ts; plan helpers: lib/listing-strategy.ts.

import { useCallback, useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { CheckCircle2, CircleDashed, ExternalLink, Plus, Trash2 } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  PLAN_EVENT_STATUS,
  WHO_LABEL,
  answeredDecisions,
  isAnswered,
  missingForApproval,
  planChannels,
  planMinimum,
  planVsLive,
  type LivePricing,
  type PlanCompPoint,
  type PlanEvent,
  type PlanQuestion,
  type PlanSeason,
  type PricingPlan,
} from "@/lib/listing-strategy"
import { PricingPlanTab } from "./pricing-plan-tab"
import {
  addQuestionAction,
  answerQuestionAction,
  approvePlanAction,
  getListingAuditAction,
  getStrategyDataAction,
  savePlanAction,
} from "./strategy-actions"

const usd = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : "$" + Math.round(n).toLocaleString("en-US"))
const FAILED = "That didn't go through. The page may be out of date: reload it and try again."

type StrategyData = { plan: PricingPlan | null; questions: PlanQuestion[]; live: LivePricing }
type SetData = (fn: (d: StrategyData | null) => StrategyData | null) => void

function useStrategy(listingId: string) {
  const [data, setData] = useState<StrategyData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    getStrategyDataAction(listingId)
      .then((r) => (r.ok ? setData({ plan: r.plan, questions: r.questions, live: r.live }) : setError(r.error)))
      .catch(() => setError(FAILED))
  }, [listingId])
  useEffect(load, [load])
  return { data, setData, error, reload: load }
}

function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

/** Save a plan patch and keep local state in sync. */
function usePlanSaver(listingId: string, setData: (fn: (d: StrategyData | null) => StrategyData | null) => void) {
  return useCallback(
    async (patch: Parameters<typeof savePlanAction>[1], okMsg = "Saved to the plan.") => {
      try {
        const r = await savePlanAction(listingId, patch)
        if (!r.ok) {
          toast.error(r.error)
          return false
        }
        setData((d) => (d ? { ...d, plan: r.plan } : d))
        toast.success(okMsg)
        return true
      } catch {
        toast.error(FAILED)
        return false
      }
    },
    [listingId, setData]
  )
}

function PlanStatus({ plan }: { plan: PricingPlan | null }) {
  if (!plan) return <Badge variant="outline">No plan yet</Badge>
  return plan.status === "approved" ? (
    <Badge>Approved · v{plan.version}{plan.approved_at ? ` · ${new Date(plan.approved_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</Badge>
  ) : (
    <Badge variant="secondary">Draft · v{plan.version}</Badge>
  )
}

// ─── Strategy ───────────────────────────────────────────────

export function StrategyTab({ listingId, canEdit }: { listingId: string; canEdit: boolean }) {
  const { data, setData, error } = useStrategy(listingId)
  const savePlan = usePlanSaver(listingId, setData)
  const [isPending, startTransition] = useTransition()
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!data) return <Loading />
  const { plan, questions, live } = data
  const answered = questions.filter(isAnswered).length
  const decisions = answeredDecisions(questions)
  const missing = missingForApproval(questions)
  const min = planMinimum(plan)
  const diff = planVsLive(plan, live)

  const answer = (q: PlanQuestion, value: string) =>
    startTransition(async () => {
      try {
        const r = await answerQuestionAction(q.id, value)
        if (!r.ok) return void toast.error(r.error)
        setData((d) => (d ? { ...d, questions: d.questions.map((x) => (x.id === q.id ? r.question : x)) } : d))
        if (q.feeds === "floor_payout") {
          const fresh = await getStrategyDataAction(listingId)
          if (fresh.ok) setData(() => ({ plan: fresh.plan, questions: fresh.questions, live: fresh.live }))
        }
      } catch {
        toast.error(FAILED)
      }
    })

  const approve = () =>
    startTransition(async () => {
      try {
        const r = await approvePlanAction(listingId)
        if (!r.ok) return void toast.error(r.error)
        setData((d) => (d ? { ...d, plan: r.plan } : d))
        toast.success(r.adjustmentId ? "Plan approved. A setup adjustment is in the team's queue." : "Plan approved.")
      } catch {
        toast.error(FAILED)
      }
    })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PlanStatus plan={plan} />
        <span className="text-sm text-muted-foreground">{answered} of {questions.length} questions answered</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open questions</CardTitle>
            <CardDescription>Answers become decisions. Questions marked &ldquo;Needed to approve&rdquo; block approval.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {questions.length === 0 && <p className="text-sm text-muted-foreground">No questions yet. Add the first one below.</p>}
            {questions.map((q) => (
              <QuestionCard key={q.id} q={q} canEdit={canEdit} disabled={isPending} onAnswer={(v) => answer(q, v)} />
            ))}
            {canEdit && <AddQuestion listingId={listingId} onAdded={(q) => setData((d) => (d ? { ...d, questions: [...d.questions, q] } : d))} />}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Decisions</CardTitle>
              <CardDescription>From answers and standing rules</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {decisions.map((d) => (
                  <li key={d.question}>{d.decision}</li>
                ))}
                {(plan?.rules ?? []).map((r) => (
                  <li key={r} className="text-muted-foreground">{r}</li>
                ))}
                <li className="text-muted-foreground">Owner minimum is a payout after markups and discounts (Fede, Oct 13).</li>
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payout floor → PriceLabs minimum</CardTitle>
              <CardDescription>The minimum protects the owner&apos;s payout on every channel</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Owner payout floor</p>
                <p className="text-xl font-semibold tabular-nums">{usd(plan?.floor_payout)}</p>
                <p className="text-xs text-muted-foreground">{plan?.floor_payout ? "Per night, after markups and discounts" : "Answer the floor question"}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">PriceLabs minimum</p>
                <p className="text-xl font-semibold tabular-nums">{usd(min?.min)}</p>
                <p className="text-xs text-muted-foreground">{min ? `Set by ${min.ch.label} (share ${min.share.toFixed(3)})` : `Live today: ${usd(live.min)}`}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan vs live today</CardTitle>
          <CardDescription>Approving creates one setup adjustment listing these changes for the team</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {plan ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Setting</TableHead>
                    <TableHead>Live</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Why</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {diff.map((r) => (
                    <TableRow key={r.setting}>
                      <TableCell>{r.setting}</TableCell>
                      <TableCell className="text-muted-foreground">{r.live}</TableCell>
                      <TableCell className="font-medium">{r.plan || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.why}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No plan yet. Saving the base price, seasons or goals creates a draft.</p>
          )}
          {canEdit && (
            <PlanBasics key={plan?.updated_at ?? "new"} plan={plan} live={live} onSave={(p) => savePlan(p)} />
          )}
          {canEdit && plan && plan.status !== "approved" && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <span className="text-sm text-muted-foreground">
                {missing.length ? `Needed to approve: ${missing.map((q) => q.question).join(" · ")}` : "Ready to approve."}
              </span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={isPending || missing.length > 0}>Approve plan</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Approve pricing plan v{plan.version}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This creates a setup adjustment for the team with every change from what&apos;s live. Editing the plan later reopens it as a new version.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={approve}>Approve</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </CardContent>
      </Card>

      <SeasonsCard key={plan?.updated_at ?? "new"} plan={plan} canEdit={canEdit} onSave={(seasons) => savePlan({ seasons })} />

      <PricingPlanTab
        key={plan?.updated_at ?? "new"}
        listingId={listingId}
        current={live}
        mode="strategy"
        seed={{ channels: plan?.channels, floor: plan?.floor_payout }}
        onSaveChannels={canEdit ? async (channels) => void (await savePlan({ channels }, "Channel settings saved.")) : undefined}
      />
    </div>
  )
}

function QuestionCard({ q, canEdit, disabled, onAnswer }: { q: PlanQuestion; canEdit: boolean; disabled: boolean; onAnswer: (v: string) => void }) {
  const [draft, setDraft] = useState(q.answer ?? "")
  const done = isAnswered(q)
  return (
    <div className={cn("space-y-2 rounded-lg border p-3", done && "border-emerald-500/50")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{WHO_LABEL[q.who]}</span>
        <div className="flex gap-1">
          {q.required_for_approval && <Badge variant="outline">Needed to approve</Badge>}
          {done ? <Badge className="bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="size-3" /> Answered</Badge> : <Badge variant="secondary"><CircleDashed className="size-3" /> Open</Badge>}
        </div>
      </div>
      <div>
        <p className="text-sm font-medium">{q.question}</p>
        {q.why && <p className="text-xs text-muted-foreground">{q.why}</p>}
      </div>
      {q.kind === "choice" ? (
        <div className="flex flex-wrap gap-2">
          {q.options.map((o) => (
            <Button key={o} type="button" size="sm" variant={q.answer === o ? "default" : "outline"} disabled={!canEdit || disabled} onClick={() => onAnswer(q.answer === o ? "" : o)}>
              {o}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {q.kind === "number" ? (
            <Input type="number" className="h-8 w-32 text-right" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!canEdit || disabled} aria-label={q.question} />
          ) : (
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!canEdit || disabled} aria-label={q.question} className="min-h-16" />
          )}
          {canEdit && (
            <Button size="sm" variant="outline" disabled={disabled || draft === (q.answer ?? "")} onClick={() => onAnswer(draft)}>
              Save answer
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function AddQuestion({ listingId, onAdded }: { listingId: string; onAdded: (q: PlanQuestion) => void }) {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState("")
  const [why, setWhy] = useState("")
  const [who, setWho] = useState<PlanQuestion["who"]>("owner")
  const [kind, setKind] = useState<PlanQuestion["kind"]>("text")
  const [options, setOptions] = useState("")
  const [isPending, startTransition] = useTransition()
  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add question
      </Button>
    )
  const add = () =>
    startTransition(async () => {
      try {
        const r = await addQuestionAction(listingId, { question, why, who, kind, options: kind === "choice" ? options.split(",") : [] })
        if (!r.ok) return void toast.error(r.error)
        onAdded(r.question)
        setQuestion("")
        setWhy("")
        setOptions("")
        setOpen(false)
      } catch {
        toast.error(FAILED)
      }
    })
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <Input placeholder="Question" value={question} onChange={(e) => setQuestion(e.target.value)} />
      <Input placeholder="Why it matters (optional)" value={why} onChange={(e) => setWhy(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={who} onChange={(e) => setWho(e.target.value as PlanQuestion["who"])} aria-label="Who answers">
          <option value="owner">Ask the owner</option>
          <option value="fede">Fede</option>
          <option value="ops">Ops</option>
        </select>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as PlanQuestion["kind"])} aria-label="Answer type">
          <option value="text">Text answer</option>
          <option value="number">Number</option>
          <option value="choice">Choices</option>
        </select>
        {kind === "choice" && <Input className="min-w-56 flex-1" placeholder="Choices, separated by commas" value={options} onChange={(e) => setOptions(e.target.value)} />}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={isPending} onClick={add}>Add</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  )
}

function PlanBasics({ plan, live, onSave }: { plan: PricingPlan | null; live: LivePricing; onSave: (p: { base_price: number | null; max_price: number | null; booking_window: string | null }) => Promise<boolean> }) {
  const [base, setBase] = useState(String(plan?.base_price ?? live.base ?? ""))
  const [max, setMax] = useState(String(plan?.max_price ?? live.max ?? ""))
  const [windowText, setWindowText] = useState(plan?.booking_window ?? "")
  const [isPending, startTransition] = useTransition()
  return (
    <div className="flex flex-wrap items-end gap-3 border-t pt-3">
      <label className="grid gap-1 text-xs text-muted-foreground">Plan base price<Input type="number" className="h-9 w-28 text-right" value={base} onChange={(e) => setBase(e.target.value)} /></label>
      <label className="grid gap-1 text-xs text-muted-foreground">Plan max price<Input type="number" className="h-9 w-28 text-right" value={max} onChange={(e) => setMax(e.target.value)} /></label>
      <label className="grid gap-1 text-xs text-muted-foreground">Booking window<Input className="h-9 w-36" placeholder="e.g. 12 months" value={windowText} onChange={(e) => setWindowText(e.target.value)} /></label>
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => startTransition(async () => void (await onSave({ base_price: base ? Number(base) : null, max_price: max ? Number(max) : null, booking_window: windowText.trim() || null })))}
      >
        Save to plan
      </Button>
    </div>
  )
}

function SeasonsCard({ plan, canEdit, onSave }: { plan: PricingPlan | null; canEdit: boolean; onSave: (s: PlanSeason[]) => Promise<boolean> }) {
  const [rows, setRows] = useState<PlanSeason[]>(plan?.seasons ?? [])
  const [isPending, startTransition] = useTransition()
  const set = (i: number, patch: Partial<PlanSeason>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Seasons and rules</CardTitle>
        <CardDescription>PriceLabs minimum and minimum stay by season. Holiday rules go here or in Events.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Season</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="text-right">PL min</TableHead>
                <TableHead>Min stay</TableHead>
                <TableHead>Rules</TableHead>
                {canEdit && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s, i) => (
                <TableRow key={i}>
                  <TableCell><Input className="h-8 min-w-36" value={s.name} disabled={!canEdit} onChange={(e) => set(i, { name: e.target.value })} aria-label="Season name" /></TableCell>
                  <TableCell><Input className="h-8 min-w-36" value={s.dates} disabled={!canEdit} onChange={(e) => set(i, { dates: e.target.value })} aria-label="Season dates" /></TableCell>
                  <TableCell className="text-right"><Input type="number" className="ml-auto h-8 w-24 text-right" value={s.plMin ?? ""} disabled={!canEdit} onChange={(e) => set(i, { plMin: e.target.value ? Number(e.target.value) : null })} aria-label="PriceLabs minimum" /></TableCell>
                  <TableCell><Input className="h-8 min-w-28" value={s.minStay} disabled={!canEdit} onChange={(e) => set(i, { minStay: e.target.value })} aria-label="Minimum stay" /></TableCell>
                  <TableCell><Input className="h-8 min-w-48" value={s.rules} disabled={!canEdit} onChange={(e) => set(i, { rules: e.target.value })} aria-label="Rules" /></TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label="Remove season"><Trash2 className="size-4" /></Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No seasons yet.</p>}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setRows((r) => [...r, { name: "", dates: "", plMin: null, minStay: "", rules: "" }])}><Plus className="size-4" /> Add season</Button>
            <Button size="sm" disabled={isPending} onClick={() => startTransition(async () => void (await onSave(rows.filter((r) => r.name.trim()))))}>Save seasons</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Goals ──────────────────────────────────────────────────

export function GoalsTab({ listingId, canEdit }: { listingId: string; canEdit: boolean }) {
  const { data, setData, error } = useStrategy(listingId)
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!data) return <Loading />
  return <GoalsBody key={data.plan?.updated_at ?? "new"} listingId={listingId} canEdit={canEdit} data={data} setData={setData} />
}

function GoalsBody({ listingId, canEdit, data, setData }: { listingId: string; canEdit: boolean; data: StrategyData; setData: SetData }) {
  const savePlan = usePlanSaver(listingId, setData)
  const { plan, live } = data
  const [be, setBe] = useState<string>(plan?.anchors.breakEvenMonthly != null ? String(plan.anchors.breakEvenMonthly) : "")
  const [goal, setGoal] = useState<string>(plan?.anchors.ownerGoalAnnual != null ? String(plan.anchors.ownerGoalAnnual) : "")
  const [isPending, startTransition] = useTransition()
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Break-even</CardTitle><CardDescription>What the home must earn per month to cover costs</CardDescription></CardHeader>
          <CardContent className="flex items-center gap-2"><Input type="number" className="h-9 w-32 text-right" placeholder="Unknown" value={be} disabled={!canEdit} onChange={(e) => setBe(e.target.value)} /><span className="text-xs text-muted-foreground">$ / month</span></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Owner goal</CardTitle><CardDescription>What the owner hopes for, per year</CardDescription></CardHeader>
          <CardContent className="flex items-center gap-2"><Input type="number" className="h-9 w-32 text-right" placeholder="No number" value={goal} disabled={!canEdit} onChange={(e) => setGoal(e.target.value)} /><span className="text-xs text-muted-foreground">$ / year</span></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Market support</CardTitle><CardDescription>From the Comps tab</CardDescription></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">{plan?.anchors.marketNote || "Pending comps and PriceLabs market data."}</p></CardContent>
        </Card>
      </div>
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => startTransition(async () => void (await savePlan({ anchors: { ...(plan?.anchors ?? {}), breakEvenMonthly: be ? Number(be) : null, ownerGoalAnnual: goal ? Number(goal) : null } }, "Anchors saved.")))}>
            Save anchors
          </Button>
        </div>
      )}
      <PricingPlanTab
        listingId={listingId}
        current={live}
        mode="goals"
        seed={{ targets: plan?.targets, channels: planChannels(plan) }}
        onSaveTargets={canEdit ? async (targets) => void (await savePlan({ targets }, "Monthly goals saved.")) : undefined}
      />
    </div>
  )
}

// ─── Comps ──────────────────────────────────────────────────

type MarketRow = { period: string; adr: number | null; occ: number | null; revpar: number | null; index: number | null }

export function CompsTab({ listingId, canEdit, market }: { listingId: string; canEdit: boolean; market: MarketRow[] }) {
  const { data, setData, error } = useStrategy(listingId)
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!data) return <Loading />
  return <CompsBody key={data.plan?.updated_at ?? "new"} listingId={listingId} canEdit={canEdit} market={market} data={data} setData={setData} />
}

function CompsBody({ listingId, canEdit, market, data, setData }: { listingId: string; canEdit: boolean; market: MarketRow[]; data: StrategyData; setData: SetData }) {
  const savePlan = usePlanSaver(listingId, setData)
  const [rule, setRule] = useState(data.plan?.comps.rule ?? "")
  const [points, setPoints] = useState<PlanCompPoint[]>(data.plan?.comps.points ?? [])
  const [isPending, startTransition] = useTransition()
  const setP = (i: number, patch: Partial<PlanCompPoint>) => setPoints((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Comp set</CardTitle><CardDescription>Who we compare against and why (bedrooms, guests, view, location, amenities)</CardDescription></CardHeader>
        <CardContent><Textarea value={rule} disabled={!canEdit} onChange={(e) => setRule(e.target.value)} placeholder="e.g. Same building, 1BR mountain view, sleeps 4. Not comps: older hotel-style buildings." className="min-h-20" /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Market from PriceLabs</CardTitle><CardDescription>Report Builder, by month. Fills in once the listing syncs.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          {market.length ? (
            <Table>
              <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">Market nightly</TableHead><TableHead className="text-right">Market occupancy</TableHead><TableHead className="text-right">Market RevPAR</TableHead><TableHead className="text-right">RevPAR index</TableHead></TableRow></TableHeader>
              <TableBody>{market.map((m) => (<TableRow key={m.period}><TableCell>{m.period.slice(0, 7)}</TableCell><TableCell className="text-right tabular-nums">{usd(m.adr)}</TableCell><TableCell className="text-right tabular-nums">{m.occ == null ? "—" : `${Math.round(m.occ)}%`}</TableCell><TableCell className="text-right tabular-nums">{usd(m.revpar)}</TableCell><TableCell className="text-right tabular-nums">{m.index ?? "—"}</TableCell></TableRow>))}</TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No Report Builder data for this listing yet.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Data points</CardTitle><CardDescription>Comparable rates gathered by hand or by the comp skill</CardDescription></CardHeader>
        <CardContent className="space-y-3 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Nightly</TableHead><TableHead>Where from</TableHead><TableHead>Note</TableHead>{canEdit && <TableHead />}</TableRow></TableHeader>
            <TableBody>
              {points.map((p, i) => (
                <TableRow key={i}>
                  <TableCell><Input className="h-8 min-w-48" value={p.source} disabled={!canEdit} onChange={(e) => setP(i, { source: e.target.value })} aria-label="Source" /></TableCell>
                  <TableCell><Input className="h-8 w-28" value={p.nightly} disabled={!canEdit} onChange={(e) => setP(i, { nightly: e.target.value })} aria-label="Nightly" /></TableCell>
                  <TableCell><Input className="h-8 w-32" value={p.origin} disabled={!canEdit} onChange={(e) => setP(i, { origin: e.target.value })} aria-label="Where from" /></TableCell>
                  <TableCell><Input className="h-8 min-w-48" value={p.note} disabled={!canEdit} onChange={(e) => setP(i, { note: e.target.value })} aria-label="Note" /></TableCell>
                  {canEdit && <TableCell><Button size="icon" variant="ghost" onClick={() => setPoints((x) => x.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="size-4" /></Button></TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setPoints((x) => [...x, { source: "", nightly: "", origin: "", note: "" }])}><Plus className="size-4" /> Add data point</Button>
              <Button size="sm" disabled={isPending} onClick={() => startTransition(async () => void (await savePlan({ comps: { rule, points: points.filter((p) => p.source.trim()) } }, "Comps saved.")))}>Save comps</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Events ─────────────────────────────────────────────────

export function EventsTab({ listingId, canEdit }: { listingId: string; canEdit: boolean }) {
  const { data, setData, error } = useStrategy(listingId)
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!data) return <Loading />
  return <EventsBody key={data.plan?.updated_at ?? "new"} listingId={listingId} canEdit={canEdit} data={data} setData={setData} />
}

function EventsBody({ listingId, canEdit, data, setData }: { listingId: string; canEdit: boolean; data: StrategyData; setData: SetData }) {
  const savePlan = usePlanSaver(listingId, setData)
  const [rows, setRows] = useState<PlanEvent[]>(data.plan?.events ?? [])
  const [isPending, startTransition] = useTransition()
  const set = (i: number, patch: Partial<PlanEvent>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Events and peak dates</CardTitle><CardDescription>What drives demand and how the plan handles it. Owner-flagged events go here first.</CardDescription></CardHeader>
      <CardContent className="space-y-3 overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Dates</TableHead><TableHead>Rule</TableHead><TableHead>Status</TableHead>{canEdit && <TableHead />}</TableRow></TableHeader>
          <TableBody>
            {rows.map((e, i) => (
              <TableRow key={i}>
                <TableCell><Input className="h-8 min-w-40" value={e.name} disabled={!canEdit} onChange={(ev) => set(i, { name: ev.target.value })} aria-label="Event" /></TableCell>
                <TableCell><Input className="h-8 min-w-40" value={e.dates} disabled={!canEdit} onChange={(ev) => set(i, { dates: ev.target.value })} aria-label="Dates" /></TableCell>
                <TableCell><Input className="h-8 min-w-56" value={e.rule} disabled={!canEdit} onChange={(ev) => set(i, { rule: ev.target.value })} aria-label="Rule" /></TableCell>
                <TableCell>
                  <select className="h-8 rounded-md border bg-background px-2 text-sm" value={e.status} disabled={!canEdit} onChange={(ev) => set(i, { status: ev.target.value as PlanEvent["status"] })} aria-label="Status">
                    {Object.entries(PLAN_EVENT_STATUS).map(([k, l]) => (<option key={k} value={k}>{l}</option>))}
                  </select>
                </TableCell>
                {canEdit && <TableCell><Button size="icon" variant="ghost" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label="Remove event"><Trash2 className="size-4" /></Button></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No events yet.</p>}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setRows((r) => [...r, { name: "", dates: "", rule: "", status: "not_priced" }])}><Plus className="size-4" /> Add event</Button>
            <Button size="sm" disabled={isPending} onClick={() => startTransition(async () => void (await savePlan({ events: rows.filter((r) => r.name.trim()) }, "Events saved.")))}>Save events</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Listing Audit ──────────────────────────────────────────

const KIND_LABEL: Record<string, string> = { change: "We apply", owner_choice: "Owner decides", owner_task: "Owner does", info: "Info" }

export function AuditTab({ listingId }: { listingId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getListingAuditAction>> | null>(null)
  useEffect(() => {
    getListingAuditAction(listingId).then(setData).catch(() => setData({ ok: false, error: FAILED }))
  }, [listingId])
  if (!data) return <Loading />
  if (!data.ok) return <p className="text-sm text-destructive">{data.error}</p>
  const { report, items } = data
  if (!report)
    return (
      <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No listing audit for this listing yet. Run the listing review skill and it appears here and in <Link className="underline" href="/listing-optimization">Listing Reviews</Link>.</CardContent></Card>
    )
  const decided = items.filter((i) => i.client_status !== "pending").length
  const applied = items.filter((i) => i.apply_status === "applied" || i.apply_status === "live").length
  const grades = Object.entries(report.section_grades ?? {})
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div><CardTitle className="text-base">{report.listing_title ?? "Listing review"}</CardTitle><CardDescription>Changes are applied in {report.channel_manager ?? "Airbnb"}</CardDescription></div>
            <Badge variant={report.status === "published" ? "default" : "secondary"} className="capitalize">{report.status}</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-6">
              <div><p className="text-4xl font-bold tabular-nums">{report.overall_score ?? "—"}</p><p className="text-xs text-muted-foreground">out of 100</p></div>
              {Object.entries(report.score_breakdown ?? {}).map(([k, v]) => (
                <div key={k}><p className="text-xs uppercase tracking-wide text-muted-foreground">{k.replace("_", " ")}</p><p className="text-lg font-semibold tabular-nums">{v}</p></div>
              ))}
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-3">
              <p>Published: {report.published_at ? new Date(report.published_at).toLocaleDateString() : "Not yet"}</p>
              <p>Sent to owner: {report.owner_message_sent_at ? new Date(report.owner_message_sent_at).toLocaleDateString() : "Not yet"}</p>
              <p>Owner decided: {decided} of {items.length} · applied {applied}</p>
            </div>
            <Button asChild size="sm" variant="outline"><Link href={`/listing-optimization/${report.id}`}><ExternalLink className="size-4" /> Open the review</Link></Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Section grades</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-sm">
            {grades.map(([k, g]) => (
              <div key={k} className="flex items-center justify-between rounded-md border px-2 py-1"><span className="capitalize">{k.replace("_", " ")}</span><span className={cn("font-bold", g === "A" || g === "B" ? "text-emerald-600" : g === "C" ? "text-amber-600" : "text-destructive")}>{g}</span></div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Suggestions</CardTitle><CardDescription>Owner decisions and apply status</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Suggestion</TableHead><TableHead>Section</TableHead><TableHead>Priority</TableHead><TableHead>Who</TableHead><TableHead>Owner</TableHead><TableHead>Applied</TableHead></TableRow></TableHeader>
            <TableBody>
              {items.filter((i) => i.section !== "captions").map((i, n) => (
                <TableRow key={n}>
                  <TableCell className="text-sm">{i.headline}</TableCell>
                  <TableCell className="text-sm capitalize text-muted-foreground">{i.section.replace("_", " ")}</TableCell>
                  <TableCell><Badge variant={i.priority === "high" ? "destructive" : "outline"}>{i.priority}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{KIND_LABEL[i.kind] ?? i.kind}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{i.client_status}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{i.apply_status.replace("_", " ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {items.some((i) => i.section === "captions") && <p className="mt-2 text-xs text-muted-foreground">Plus {items.filter((i) => i.section === "captions").length} photo captions.</p>}
        </CardContent>
      </Card>
    </div>
  )
}
