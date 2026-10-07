"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { SUPPORT_OVERRIDE_STATUSES, SUPPORT_NOTE_MAX } from "@/lib/support-status"
import { SUPPORT_DISMISS_REASONS, supportStatusLabel, type SupportStatus } from "@/lib/support-tickets"
import { addSupportNoteAction, setSupportStatusAction } from "../status-actions"

/** Super admins only (the page decides): set the status with a note, or add a note. */
export function StatusAndNotes({
  ticketId,
  status,
  merged,
  openPromises,
}: {
  ticketId: string
  status: SupportStatus
  merged: boolean
  openPromises: number
}) {
  const [pending, start] = useTransition()
  const [next, setNext] = useState("")
  const [reason, setReason] = useState("")
  const [statusNote, setStatusNote] = useState("")
  const [note, setNote] = useState("")
  const options = SUPPORT_OVERRIDE_STATUSES.filter((s) => s.value !== status)
  const closing = next === "resolved" || next === "dismissed"
  const needsReason = next === "dismissed"
  const canSave = !!next && statusNote.trim().length >= 3 && (!needsReason || !!reason)

  const saveStatus = () =>
    start(async () => {
      const result = await setSupportStatusAction(ticketId, next, statusNote, needsReason ? reason : null)
      if (!result.ok) return void toast.error(result.error)
      toast.success("Status updated")
      setNext("")
      setReason("")
      setStatusNote("")
    })

  const saveNote = () =>
    start(async () => {
      const result = await addSupportNoteAction(ticketId, note)
      if (!result.ok) return void toast.error(result.error)
      toast.success("Note added")
      setNote("")
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between gap-2 text-base">
          Status and notes
          <span className="text-xs font-normal text-muted-foreground">Fede and Gastón</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {merged ? (
          <p className="text-muted-foreground">This ticket was merged. Change the status on the ticket it was merged into.</p>
        ) : (
          <div className="space-y-2">
            <Label htmlFor={`status-${ticketId}`}>Change status from {supportStatusLabel(status)}</Label>
            <Select value={next} onValueChange={setNext}>
              <SelectTrigger id={`status-${ticketId}`} className="w-full">
                <SelectValue placeholder="Pick a status" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {needsReason && (
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
            )}
            <Textarea
              value={statusNote}
              onChange={(e) => setStatusNote(e.target.value)}
              rows={3}
              maxLength={SUPPORT_NOTE_MAX}
              placeholder={
                next === "resolved" ? "How it was resolved, and where (call, email, PriceLabs…)" : "Why the status is changing"
              }
              aria-label="Note for the status change"
            />
            {closing && openPromises > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {openPromises === 1 ? "The open promise" : `The ${openPromises} open promises`} will be cancelled with this note.
              </p>
            )}
            {next === "resolved" && (
              <p className="text-xs text-muted-foreground">Resolving outside the Hub skips the verification checklist.</p>
            )}
            <Button size="sm" disabled={pending || !canSave} onClick={saveStatus}>
              Save status
            </Button>
          </div>
        )}

        <div className="space-y-2 border-t pt-4">
          <Label htmlFor={`note-${ticketId}`}>Add a note</Label>
          <Textarea
            id={`note-${ticketId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={SUPPORT_NOTE_MAX}
            placeholder="Shows on the timeline, also on closed tickets"
          />
          <Button size="sm" variant="outline" disabled={pending || note.trim().length < 3} onClick={saveNote}>
            Add note
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
