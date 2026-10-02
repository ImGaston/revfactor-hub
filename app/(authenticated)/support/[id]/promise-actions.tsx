"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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
import { closeSupportPromise } from "../actions"

export function PromiseActions({ commitmentId }: { commitmentId: string }) {
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")

  const close = (outcome: "kept" | "cancelled") =>
    start(async () => {
      const result = await closeSupportPromise(commitmentId, outcome, note)
      if ("error" in result) toast.error(result.error)
      else {
        toast.success(outcome === "kept" ? "Promise kept" : "Promise cancelled")
        setOpen(false)
      }
    })

  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => close("kept")}>
        Kept
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={pending}>
            Cancel promise
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this promise</DialogTitle>
            <DialogDescription>It stays on the timeline. Say why it no longer applies.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`cancel-${commitmentId}`}>Why</Label>
            <Textarea
              id={`cancel-${commitmentId}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
            />
          </div>
          <DialogFooter>
            <Button disabled={pending || !note.trim()} onClick={() => close("cancelled")}>
              Cancel promise
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
