"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Check, CircleAlert, GitMerge, RotateCcw, Trash2 } from "lucide-react"
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { triageReasonLabel } from "@/lib/support-display"
import {
  SUPPORT_DISMISS_REASONS,
  SUPPORT_STATUS_BADGE,
  supportStatusLabel,
  supportTicketPath,
  ticketRef,
  type SupportRequestType,
  type SupportStatus,
} from "@/lib/support-tickets"
import { cn } from "@/lib/utils"
import {
  acceptSupportTriage,
  assignSupportTicket,
  dismissSupportTicket,
  markSupportToldLive,
  mergeSupportTicket,
  recordSupportAnswer,
  reopenSupportTicket,
  sendBackSupportTicket,
  setSupportTicketProperty,
  verifySupportTicket,
} from "../actions"

type Result = { success: true; ticketId?: string } | { error: string }

export type TicketActionsProps = {
  ticket: {
    id: string
    status: SupportStatus
    request_type: SupportRequestType
    assignee_id: string | null
    property_scope: string
    property_validated: boolean
    possible_duplicate: { id: string; ticket_number: number } | null
    answer_summary: string | null
    client_told_live: boolean
    merged: boolean
    triage_reasons: string[]
  }
  propertyLabel: string
  selectedListingIds: string[]
  listings: { id: string; name: string; status: string | null }[]
  team: { id: string; name: string }[]
  otherTickets: { id: string; ticket_number: number; summary: string; status: string }[]
  blockers: string[]
  overrideRequired: boolean
  checks: { key: string; label: string }[]
  dueLabel: string | null
  overdue: boolean
  canEdit: boolean
  canControl: boolean
}

const UNASSIGNED = "unassigned"

function useAction() {
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<Result>, ok: string, after?: (r: { success: true; ticketId?: string }) => void) =>
    start(async () => {
      const result = await fn()
      if ("error" in result) toast.error(result.error)
      else {
        toast.success(ok)
        after?.(result)
      }
    })
  return { pending, run }
}

export function TicketActions(props: TicketActionsProps) {
  const { ticket: t, canEdit, canControl } = props
  const { pending, run } = useAction()
  const closed = t.status === "resolved" || t.status === "dismissed" || t.merged
  const editable = canEdit && !closed

  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={SUPPORT_STATUS_BADGE[t.status]}>{supportStatusLabel(t.status)}</Badge>
        {!closed && props.dueLabel && (
          <span className={cn("font-mono text-xs", props.overdue && "font-medium text-red-700 dark:text-red-300")}>
            {props.dueLabel}
          </span>
        )}
      </div>

      <Field label="Owner">
        <Select
          value={t.assignee_id ?? UNASSIGNED}
          disabled={!editable || pending}
          onValueChange={(value) =>
            run(() => assignSupportTicket(t.id, value === UNASSIGNED ? null : value), "Owner updated")
          }
        >
          <SelectTrigger className="w-full" aria-label="Owner">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
            {props.team.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Property">
        <div className="flex items-start justify-between gap-2">
          <span className={cn("wrap-anywhere", !t.property_validated && "text-amber-700 dark:text-amber-300")}>
            {t.property_validated ? props.propertyLabel : "Not confirmed yet"}
          </span>
          {editable && <PropertyDialog {...props} />}
        </div>
      </Field>

      {t.status === "new" && !closed && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="font-medium text-amber-900 dark:text-amber-200">Needs triage</p>
          <ul className="space-y-0.5 text-amber-900 dark:text-amber-200">
            {t.triage_reasons.map((r) => (
              <li key={r}>{triageReasonLabel(r)}</li>
            ))}
          </ul>
          {editable && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                disabled={pending || !t.property_validated}
                onClick={() => run(() => acceptSupportTriage(t.id), "Moved to the queue")}
              >
                Accept to queue
              </Button>
              {t.possible_duplicate && <MergeButton {...props} targetId={t.possible_duplicate.id} />}
            </div>
          )}
          {editable && !t.property_validated && (
            <p className="text-xs text-amber-900 dark:text-amber-200">Confirm the property first.</p>
          )}
        </div>
      )}

      {editable && t.status !== "new" && (
        <div className="flex flex-wrap gap-2">
          <AnswerDialog ticketId={t.id} current={t.answer_summary} answered={t.status === "answered"} />
          {t.request_type === "change" && !t.client_told_live && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => markSupportToldLive(t.id), "Marked as told it's live")}
            >
              Client told it&apos;s live
            </Button>
          )}
        </div>
      )}

      {!closed && (
        <div className="space-y-2 border-t pt-4">
          <p className="font-medium">To resolve</p>
          <ul className="space-y-1">
            {props.blockers.length === 0 ? (
              <li className="flex gap-2">
                <Check className="size-4 shrink-0 text-emerald-600" aria-hidden />
                Nothing blocks resolving
              </li>
            ) : (
              props.blockers.map((b) => (
                <li key={b} className="flex gap-2">
                  <CircleAlert className="size-4 shrink-0 text-red-600" aria-hidden />
                  {b}
                </li>
              ))
            )}
            {props.overrideRequired && (
              <li className="flex gap-2 text-amber-700 dark:text-amber-300">
                <CircleAlert className="size-4 shrink-0" aria-hidden />
                The bot flagged the answer; the verifier explains why it&apos;s still right
              </li>
            )}
          </ul>
          {t.status === "answered" && canControl && (
            <div className="flex flex-wrap gap-2 pt-1">
              <VerifyDialog {...props} />
              <SendBackDialog ticketId={t.id} />
            </div>
          )}
          {t.status === "answered" && !canControl && (
            <p className="text-xs text-muted-foreground">Someone with verify rights resolves it.</p>
          )}
        </div>
      )}

      {canEdit && (
        <div className="flex flex-wrap gap-2 border-t pt-4">
          {closed && !t.merged && <ReopenDialog ticketId={t.id} />}
          {!closed && props.otherTickets.length > 0 && <MergeButton {...props} />}
          {!closed && <DismissDialog ticketId={t.id} />}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}

function PropertyDialog(props: TicketActionsProps) {
  const { ticket: t } = props
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState(t.property_scope === "unknown" ? "listings" : t.property_scope)
  const [selected, setSelected] = useState<string[]>(props.selectedListingIds)
  const { pending, run } = useAction()
  const active = props.listings.filter((l) => !l.status || l.status === "active")
  const inactive = props.listings.filter((l) => l.status && l.status !== "active")

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {t.property_validated ? "Change" : "Confirm"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Which property is this about?</DialogTitle>
          <DialogDescription>Confirming it validates the property for this ticket.</DialogDescription>
        </DialogHeader>
        <ToggleGroup
          type="single"
          value={scope}
          onValueChange={(v) => v && setScope(v)}
          variant="outline"
          className="w-full"
        >
          <ToggleGroupItem value="listings" className="flex-1">
            Specific properties
          </ToggleGroupItem>
          <ToggleGroupItem value="portfolio" className="flex-1">
            All properties
          </ToggleGroupItem>
          <ToggleGroupItem value="account" className="flex-1">
            Not about a property
          </ToggleGroupItem>
        </ToggleGroup>
        {scope === "listings" && (
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
            {props.listings.length === 0 && (
              <p className="p-2 text-sm text-muted-foreground">This client has no listings in the Hub.</p>
            )}
            {[...active, ...inactive].map((l) => (
              <label key={l.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent">
                <Checkbox
                  checked={selected.includes(l.id)}
                  onCheckedChange={(checked) =>
                    setSelected((prev) => (checked ? [...prev, l.id] : prev.filter((id) => id !== l.id)))
                  }
                />
                <span className="wrap-anywhere">{l.name}</span>
                {l.status && l.status !== "active" && (
                  <span className="ml-auto text-xs text-muted-foreground">{l.status}</span>
                )}
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button
            disabled={pending || (scope === "listings" && selected.length === 0)}
            onClick={() =>
              run(() => setSupportTicketProperty(t.id, scope, scope === "listings" ? selected : []), "Property confirmed", () =>
                setOpen(false)
              )
            }
          >
            Confirm property
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AnswerDialog({ ticketId, current, answered }: { ticketId: string; current: string | null; answered: boolean }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(current ?? "")
  const { pending, run } = useAction()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={answered ? "outline" : "default"}>
          {answered ? "Edit answer" : "Record answer"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{answered ? "Edit the answer" : "Record the answer"}</DialogTitle>
          <DialogDescription>
            Paste or summarize what the client was told. It goes to verification next.
          </DialogDescription>
        </DialogHeader>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} maxLength={4000} />
        <DialogFooter>
          <Button
            disabled={pending || text.trim().length < 3}
            onClick={() => run(() => recordSupportAnswer(ticketId, text), "Answer recorded", () => setOpen(false))}
          >
            Save answer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function VerifyDialog(props: TicketActionsProps) {
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState<string[]>([])
  const [reason, setReason] = useState("")
  const { pending, run } = useAction()
  const ready =
    props.checks.every((c) => checked.includes(c.key)) && (!props.overrideRequired || reason.trim().length >= 5)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Verify and resolve</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify the answer</DialogTitle>
          <DialogDescription>Tick each check. The Hub still blocks resolving if anything above is open.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {props.checks.map((c) => (
            <label key={c.key} className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={checked.includes(c.key)}
                onCheckedChange={(v) => setChecked((prev) => (v ? [...prev, c.key] : prev.filter((k) => k !== c.key)))}
              />
              {c.label}
            </label>
          ))}
        </div>
        {props.overrideRequired && (
          <div className="space-y-1">
            <Label htmlFor="override-reason">Why is the answer still correct?</Label>
            <Textarea id="override-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
        )}
        <DialogFooter>
          <Button
            disabled={pending || !ready}
            onClick={() =>
              run(() => verifySupportTicket(props.ticket.id, checked, reason), "Verified and resolved", () => setOpen(false))
            }
          >
            Resolve ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NoteDialog({
  trigger,
  title,
  description,
  label,
  required,
  confirm,
  onConfirm,
}: {
  trigger: React.ReactNode
  title: string
  description: string
  label: string
  required: boolean
  confirm: string
  onConfirm: (note: string) => Promise<Result>
}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")
  const { pending, run } = useAction()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="action-note">{label}</Label>
          <Textarea id="action-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} />
        </div>
        <DialogFooter>
          <Button
            disabled={pending || (required && note.trim().length === 0)}
            onClick={() => run(() => onConfirm(note), "Saved", () => setOpen(false))}
          >
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SendBackDialog({ ticketId }: { ticketId: string }) {
  return (
    <NoteDialog
      trigger={
        <Button size="sm" variant="outline">
          Send back
        </Button>
      }
      title="Send the answer back"
      description="The ticket returns to the queue and needs a new answer."
      label="What's missing?"
      required
      confirm="Send back"
      onConfirm={(note) => sendBackSupportTicket(ticketId, note)}
    />
  )
}

function ReopenDialog({ ticketId }: { ticketId: string }) {
  return (
    <NoteDialog
      trigger={
        <Button size="sm" variant="outline">
          <RotateCcw className="size-4" aria-hidden />
          Reopen
        </Button>
      }
      title="Reopen this ticket"
      description="It goes back to the queue. Its earlier verification is cleared."
      label="Why (optional)"
      required={false}
      confirm="Reopen"
      onConfirm={(note) => reopenSupportTicket(ticketId, note)}
    />
  )
}

function MergeButton(props: TicketActionsProps & { targetId?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState(props.targetId ?? "")
  const { pending, run } = useAction()
  const targets = props.otherTickets
  const preset = props.targetId ? targets.find((o) => o.id === props.targetId) : null
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <GitMerge className="size-4" aria-hidden />
          {preset ? `Merge into ${ticketRef(preset.ticket_number)}` : "Merge"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge into another ticket</DialogTitle>
          <DialogDescription>
            Promises, properties, and Adjustments move to the ticket you pick. This one closes as a duplicate.
          </DialogDescription>
        </DialogHeader>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger className="w-full" aria-label="Ticket to keep">
            <SelectValue placeholder="Pick the ticket to keep" />
          </SelectTrigger>
          <SelectContent>
            {targets.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {ticketRef(o.ticket_number)} · {o.summary.slice(0, 70)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button
            disabled={pending || !target}
            onClick={() =>
              run(() => mergeSupportTicket(props.ticket.id, target), "Merged", (r) => {
                setOpen(false)
                if (r.ticketId) router.push(supportTicketPath(r.ticketId))
              })
            }
          >
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DismissDialog({ ticketId }: { ticketId: string }) {
  const [reason, setReason] = useState<string>("")
  const [note, setNote] = useState("")
  const { pending, run } = useAction()
  const needsNote = SUPPORT_DISMISS_REASONS.find((r) => r.value === reason)?.requiresNote ?? false
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-muted-foreground">
          <Trash2 className="size-4" aria-hidden />
          Dismiss
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Dismiss this ticket?</AlertDialogTitle>
          <AlertDialogDescription>
            It leaves the queue but stays on record. Use Merge instead if it duplicates another ticket.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger className="w-full" aria-label="Reason">
            <SelectValue placeholder="Pick a reason" />
          </SelectTrigger>
          <SelectContent>
            {SUPPORT_DISMISS_REASONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder={needsNote ? "Required for this reason" : "Note (optional)"}
          aria-label="Note"
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || !reason || (needsNote && !note.trim())}
            onClick={(event) => {
              event.preventDefault()
              run(() => dismissSupportTicket(ticketId, reason, note), "Dismissed")
            }}
          >
            Dismiss
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
