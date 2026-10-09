"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { GitMerge, Sparkles } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
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
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SUPPORT_MERGE_VERDICT_LABEL, type SupportMergeCheck } from "@/lib/support-merge-check"
import { supportTicketPath, ticketRef } from "@/lib/support-tickets"
import { cn } from "@/lib/utils"
import { checkMergeAction } from "../ask-actions"
import { assignSupportTicketAction, mergeSupportTicketAction } from "../close-actions"

const VERDICT_BADGE: Record<SupportMergeCheck["verdict"], string> = {
  same: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  related: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  different: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
}

const UNASSIGNED = "unassigned"

export function OwnerSelect({
  ticketId,
  assigneeId,
  team,
  disabled,
}: {
  ticketId: string
  assigneeId: string | null
  team: { id: string; name: string }[]
  disabled: boolean
}) {
  const [pending, start] = useTransition()
  return (
    <Select
      value={assigneeId ?? UNASSIGNED}
      disabled={disabled || pending}
      onValueChange={(value) =>
        start(async () => {
          const result = await assignSupportTicketAction(ticketId, value === UNASSIGNED ? null : value)
          if (!result.ok) toast.error(result.error)
          else toast.success("Owner updated")
        })
      }
    >
      <SelectTrigger className="w-full" aria-label="Owner">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
        {team.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Merge this ticket into another open one for the same client. It closes as a duplicate. */
export function MergeTicketButton({
  ticketId,
  targets,
  suggestedId,
}: {
  ticketId: string
  targets: { id: string; ticket_number: number; summary: string }[]
  suggestedId: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState(
    suggestedId && targets.some((o) => o.id === suggestedId) ? suggestedId : ""
  )
  const suggested = suggestedId ? targets.find((o) => o.id === suggestedId) : null
  const [check, setCheck] = useState<SupportMergeCheck | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [checking, startCheck] = useTransition()
  const [useTitle, setUseTitle] = useState(false)
  if (targets.length === 0) return null
  const targetRef = targets.find((o) => o.id === target)
  const pickTarget = (id: string) => {
    setTarget(id)
    setCheck(null)
    setCheckError(null)
    setUseTitle(false)
  }
  const runCheck = () =>
    startCheck(async () => {
      setCheckError(null)
      const result = await checkMergeAction(ticketId, target)
      if (result.ok) {
        setCheck(result.check)
        setUseTitle(result.check.verdict !== "different")
      } else setCheckError(result.error)
    })

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" className="w-full">
          <GitMerge className="size-4" aria-hidden />
          {suggested ? `Merge into ${ticketRef(suggested.ticket_number)}` : "Merge into another ticket"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Merge into another ticket</AlertDialogTitle>
          <AlertDialogDescription>
            Promises, properties, and Adjustments move to the ticket you pick, and its timeline shows this
            one&apos;s history. This ticket closes as a duplicate.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Select value={target} onValueChange={pickTarget}>
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
        <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground">Check what this ticket adds before you merge.</p>
            <Button size="sm" variant="outline" disabled={!target || checking || pending} onClick={runCheck}>
              <Sparkles className={cn("size-4", checking && "animate-pulse")} aria-hidden />
              {checking ? "Checking…" : check ? "Check again" : "Check with AI"}
            </Button>
          </div>
          {checkError && <p className="text-red-700 dark:text-red-300">{checkError}</p>}
          {check && (
            <div className="space-y-2">
              <Badge className={VERDICT_BADGE[check.verdict]}>{SUPPORT_MERGE_VERDICT_LABEL[check.verdict]}</Badge>
              {check.warning && <p className="text-amber-800 dark:text-amber-300">{check.warning}</p>}
              {check.adds.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase">What this ticket adds</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {check.adds.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex items-start gap-2">
                <Checkbox id="merge-use-title" checked={useTitle} onCheckedChange={(v) => setUseTitle(v === true)} />
                <Label htmlFor="merge-use-title" className="leading-snug font-normal">
                  Rename {targetRef ? ticketRef(targetRef.ticket_number) : "the kept ticket"} to “{check.title}”
                </Label>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            The client messages from both tickets stay on the kept ticket, and its plain-English digest is rewritten from all of them.
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            disabled={pending || !target}
            onClick={() =>
              start(async () => {
                const result = await mergeSupportTicketAction(ticketId, target, useTitle && check ? check.title : null)
                if (!result.ok) {
                  toast.error(result.error)
                  return
                }
                toast.success("Merged")
                setOpen(false)
                router.push(supportTicketPath(target))
              })
            }
          >
            Merge
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
