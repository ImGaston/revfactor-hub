"use client"

import { useCallback, useState } from "react"
import {
  ArrowRightCircle,
  CheckCircle2,
  Circle,
  Info,
  Loader2,
  OctagonAlert,
  Pencil,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  JOURNEY_PHASES,
  JOURNEY_STATUSES,
  JOURNEY_STATUS_LABEL,
  formatJourneyDate,
  type JourneyStatus,
  type JourneyStep,
} from "@/lib/client-journey"
import { cn } from "@/lib/utils"
import {
  loadClientJourneyAction,
  saveJourneyStepAction,
} from "@/app/(authenticated)/clients/[id]/tab-actions"
import { TabError, TabSkeleton, useLazyTabData } from "./lazy-tab"

const STATUS_STYLE: Record<JourneyStatus, { icon: typeof Circle; className: string; badge: string }> = {
  done: {
    icon: CheckCircle2,
    className: "text-emerald-600 dark:text-emerald-400",
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  next: {
    icon: ArrowRightCircle,
    className: "text-blue-600 dark:text-blue-400",
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  },
  todo: {
    icon: Circle,
    className: "text-muted-foreground",
    badge: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  blocked: {
    icon: OctagonAlert,
    className: "text-red-600 dark:text-red-400",
    badge: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
}

const PHASE_ACCENT: Record<string, string> = {
  sales: "border-l-violet-400",
  onboarding: "border-l-blue-400",
  first_90: "border-l-amber-400",
  ongoing: "border-l-emerald-400",
}

export function JourneyTab({ clientId }: { clientId: string }) {
  const load = useCallback(() => loadClientJourneyAction(clientId), [clientId])
  const { state, reload, refresh } = useLazyTabData(load)
  const [editing, setEditing] = useState<JourneyStep | null>(null)

  if (state.status === "loading") return <TabSkeleton variant="timeline" />
  if (state.status === "error") return <TabError error={state.error} onRetry={reload} />

  const { journey, overridesAvailable, canEdit } = state.data
  const editable = canEdit && overridesAvailable

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        {!overridesAvailable && (
          <Alert>
            <Info className="size-4" />
            <AlertDescription>
              Steps are computed from Hub data. Ticking steps by hand needs the client tabs
              migration, which isn&apos;t applied yet.
            </AlertDescription>
          </Alert>
        )}
        {JOURNEY_PHASES.map((phase) => {
          const steps = journey.steps.filter((s) => s.phase === phase.key)
          const done = steps.filter((s) => s.status === "done").length
          return (
            <Card key={phase.key} className={cn("border-l-[3px]", PHASE_ACCENT[phase.key])}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {phase.label}
                  {"hint" in phase && (
                    <span className="text-xs font-normal text-muted-foreground">{phase.hint}</span>
                  )}
                  <Badge variant="secondary" className="ml-auto font-mono">
                    {done}/{steps.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-1">
                  {steps.map((step) => (
                    <StepRow
                      key={step.key}
                      step={step}
                      onEdit={editable ? () => setEditing(step) : undefined}
                    />
                  ))}
                </ol>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <OctagonAlert className="size-4 text-red-600 dark:text-red-400" />
              Blocking right now
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {journey.blocking.length === 0 ? (
              <p className="text-muted-foreground">Nothing is blocked.</p>
            ) : (
              <ul className="space-y-2">
                {journey.blocking.map((s) => (
                  <li key={s.key}>
                    <p className="font-medium">{s.label}</p>
                    <p className="text-muted-foreground">{s.note ?? s.evidence}</p>
                  </li>
                ))}
              </ul>
            )}
            {journey.next && (
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Next up</p>
                <p className="font-medium">{journey.next.label}</p>
                <p className="text-muted-foreground">{journey.next.note ?? journey.next.evidence}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Health</CardTitle>
            <CardDescription>From Hub data, not the overrides.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-3">
              <HealthStat
                label="Days since signing"
                value={journey.health.daysSinceSigning}
              />
              <HealthStat label="Open tickets" value={journey.health.openTickets} />
              <HealthStat
                label="Owner decisions"
                value={
                  journey.health.decisionsTotal == null
                    ? null
                    : `${journey.health.decisionsDone ?? 0}/${journey.health.decisionsTotal}`
                }
              />
            </dl>
          </CardContent>
        </Card>
      </div>

      <StepDialog
        clientId={clientId}
        step={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          refresh()
        }}
      />
    </div>
  )
}

function HealthStat({ label, value }: { label: string; value: number | string | null }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-mono text-lg font-semibold">{value ?? "—"}</dd>
    </div>
  )
}

function StepRow({ step, onEdit }: { step: JourneyStep; onEdit?: () => void }) {
  const style = STATUS_STYLE[step.status]
  const Icon = style.icon
  return (
    <li className="group flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted/40">
      <Icon className={cn("mt-0.5 size-4 shrink-0", style.className)} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("font-medium", step.status === "done" && "text-muted-foreground")}>
            {step.label}
          </span>
          <Badge className={style.badge}>{JOURNEY_STATUS_LABEL[step.status]}</Badge>
          {step.overridden && (
            <Badge variant="outline" title={`Computed: ${JOURNEY_STATUS_LABEL[step.computedStatus]}`}>
              Set by hand
            </Badge>
          )}
          {!step.auto && !step.overridden && (
            <Badge variant="outline" className="text-muted-foreground">
              Manual
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground wrap-anywhere">
          {step.date && <span className="font-medium">{formatJourneyDate(step.date)} · </span>}
          {step.evidence}
        </p>
        {step.note && <p className="text-xs wrap-anywhere">Note: {step.note}</p>}
      </div>
      {onEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 opacity-60 group-hover:opacity-100"
          onClick={onEdit}
          aria-label={`Edit ${step.label}`}
        >
          <Pencil className="size-3.5" />
        </Button>
      )}
    </li>
  )
}

const AUTO = "auto"

function StepDialog({
  clientId,
  step,
  onClose,
  onSaved,
}: {
  clientId: string
  step: JourneyStep | null
  onClose: () => void
  onSaved: () => void
}) {
  return (
    <Dialog open={step != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {step && <StepForm key={step.key} clientId={clientId} step={step} onSaved={onSaved} onCancel={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function dateInputValue(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ""
}

function StepForm({
  clientId,
  step,
  onSaved,
  onCancel,
}: {
  clientId: string
  step: JourneyStep
  onSaved: () => void
  onCancel: () => void
}) {
  const [status, setStatus] = useState<string>(step.overridden ? step.status : AUTO)
  const [doneAt, setDoneAt] = useState(step.overridden ? dateInputValue(step.date) : "")
  const [note, setNote] = useState(step.note ?? "")
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const result = await saveJourneyStepAction({
      clientId,
      stepKey: step.key,
      status: status === AUTO ? null : status,
      doneAt: doneAt || null,
      note: note || null,
    })
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success(status === AUTO ? "Step back to automatic" : "Step updated")
    onSaved()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{step.label}</DialogTitle>
        <DialogDescription>
          {step.auto
            ? `From Hub data: ${JOURNEY_STATUS_LABEL[step.computedStatus]} — ${step.evidence}`
            : "Manual step: the Hub has no data for it."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="journey-status">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="journey-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>{step.auto ? "Automatic (from Hub data)" : "Not set"}</SelectItem>
              {JOURNEY_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {JOURNEY_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {status !== AUTO && (
          <>
            <div className="space-y-2">
              <Label htmlFor="journey-date">Date</Label>
              <Input
                id="journey-date"
                type="date"
                value={doneAt}
                onChange={(e) => setDoneAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="journey-note">Note</Label>
              <Textarea
                id="journey-note"
                value={note}
                maxLength={1000}
                placeholder="What happened, or what it's waiting on"
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </>
  )
}
