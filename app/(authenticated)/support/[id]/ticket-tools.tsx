"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { GitMerge } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { supportTicketPath, ticketRef } from "@/lib/support-tickets"
import { assignSupportTicketAction, mergeSupportTicketAction } from "../close-actions"

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
  if (targets.length === 0) return null

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
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            disabled={pending || !target}
            onClick={() =>
              start(async () => {
                const result = await mergeSupportTicketAction(ticketId, target)
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
