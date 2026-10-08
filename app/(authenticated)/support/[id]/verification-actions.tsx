"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

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
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { SupportRequestType, SupportStatus } from "@/lib/support-tickets"
import {
  acceptSupportTriageAction,
  confirmSupportPropertyAction,
  markSupportToldLiveAction,
  sendBackSupportTicketAction,
  verifySupportTicketAction,
} from "../close-actions"

type Result = { ok: true } | { ok: false; error: string }

export type VerificationActionsProps = {
  ticketId: string
  status: SupportStatus
  requestType: SupportRequestType
  propertyScope: string
  propertyValidated: boolean
  selectedListingIds: string[]
  listings: { id: string; name: string; status: string | null }[]
  clientToldLive: boolean
  blocked: boolean
  overrideRequired: boolean
  checks: { key: string; label: string }[]
  canEdit: boolean
  canControl: boolean
}

function useAction() {
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<Result>, ok: string, after?: () => void) =>
    start(async () => {
      const result = await fn()
      if (!result.ok) return void toast.error(result.error)
      toast.success(ok)
      after?.()
    })
  return { pending, run }
}

/** The buttons under the Verification card's checklist. */
export function VerificationActions(props: VerificationActionsProps) {
  const { pending, run } = useAction()
  const triage = props.status === "new"
  const answered = props.status === "answered"

  return (
    <div className="space-y-3 border-t pt-3">
      {triage && props.canEdit && (
        <div className="space-y-1.5">
          <Button
            size="sm"
            disabled={pending || !props.propertyValidated}
            onClick={() => run(() => acceptSupportTriageAction(props.ticketId), "Moved to the queue")}
          >
            Accept to queue
          </Button>
          {!props.propertyValidated && <p className="text-xs text-muted-foreground">Confirm the property first.</p>}
        </div>
      )}

      {props.canEdit && (
        <div className="flex flex-wrap gap-2">
          <PropertyDialog {...props} />
          {props.requestType === "change" && !props.clientToldLive && !triage && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => markSupportToldLiveAction(props.ticketId), "Marked as told it's live")}
            >
              Client told it&apos;s live
            </Button>
          )}
        </div>
      )}

      {answered && props.canControl && (
        <div className="flex flex-wrap gap-2">
          <VerifyDialog {...props} />
          <SendBackDialog ticketId={props.ticketId} />
        </div>
      )}
      {answered && !props.canControl && (
        <p className="text-xs text-muted-foreground">Someone with verify rights resolves it.</p>
      )}
    </div>
  )
}

function PropertyDialog(props: VerificationActionsProps) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState(props.propertyScope === "unknown" ? "listings" : props.propertyScope)
  const [selected, setSelected] = useState<string[]>(props.selectedListingIds)
  const { pending, run } = useAction()
  const sorted = [
    ...props.listings.filter((l) => !l.status || l.status === "active"),
    ...props.listings.filter((l) => l.status && l.status !== "active"),
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={props.propertyValidated ? "outline" : "default"}>
          {props.propertyValidated ? "Change property" : "Confirm property"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Which property is this about?</DialogTitle>
          <DialogDescription>Confirming it validates the property for this ticket.</DialogDescription>
        </DialogHeader>
        <ToggleGroup type="single" value={scope} onValueChange={(v) => v && setScope(v)} variant="outline" className="w-full">
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
            {sorted.length === 0 && <p className="p-2 text-sm text-muted-foreground">This client has no listings in the Hub.</p>}
            {sorted.map((l) => (
              <label key={l.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent">
                <Checkbox
                  checked={selected.includes(l.id)}
                  onCheckedChange={(checked) =>
                    setSelected((prev) => (checked ? [...prev, l.id] : prev.filter((id) => id !== l.id)))
                  }
                />
                <span className="wrap-anywhere">{l.name}</span>
                {l.status && l.status !== "active" && <span className="ml-auto text-xs text-muted-foreground">{l.status}</span>}
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button
            disabled={pending || (scope === "listings" && selected.length === 0)}
            onClick={() =>
              run(
                () => confirmSupportPropertyAction(props.ticketId, scope, scope === "listings" ? selected : []),
                "Property confirmed",
                () => setOpen(false)
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

function VerifyDialog(props: VerificationActionsProps) {
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState<string[]>([])
  const [reason, setReason] = useState("")
  const { pending, run } = useAction()
  const ready = props.checks.every((c) => checked.includes(c.key)) && (!props.overrideRequired || reason.trim().length >= 5)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Verify and resolve</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify the answer</DialogTitle>
          <DialogDescription>
            {props.blocked
              ? "The checklist above still has open items. Fix those first or the Hub won't resolve it."
              : "Tick each check, then resolve."}
          </DialogDescription>
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
            <Label htmlFor={`override-${props.ticketId}`}>The bot flagged the answer. Why is it still correct?</Label>
            <Textarea id={`override-${props.ticketId}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
        )}
        <DialogFooter>
          <Button
            disabled={pending || !ready}
            onClick={() =>
              run(() => verifySupportTicketAction(props.ticketId, checked, reason), "Verified and resolved", () => setOpen(false))
            }
          >
            Resolve ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SendBackDialog({ ticketId }: { ticketId: string }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")
  const { pending, run } = useAction()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Send back
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send the answer back</DialogTitle>
          <DialogDescription>The ticket returns to the queue and needs a new answer.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor={`sendback-${ticketId}`}>What&apos;s missing?</Label>
          <Textarea id={`sendback-${ticketId}`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} />
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !note.trim()}
            onClick={() => run(() => sendBackSupportTicketAction(ticketId, note), "Sent back", () => setOpen(false))}
          >
            Send back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
