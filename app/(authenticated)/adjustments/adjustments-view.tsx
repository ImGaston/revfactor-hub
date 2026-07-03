"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Copy,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import type { Adjustment, AdjustmentStatus } from "@/lib/types"
import {
  ADJUSTMENT_STATUSES,
  NOTE_REQUIRED_STATUSES,
  OPEN_STATUSES,
  STALE_HIGH_URGENCY_DAYS,
  adjustmentShareUrl,
  adjustmentStatusLabel,
  adjustmentSummary,
  adjustmentTagLabel,
  buildWhatsappUpdate,
} from "@/lib/adjustments"
import {
  deleteAdjustment,
  duplicateAdjustment,
  updateAdjustmentStatus,
} from "./actions"
import { AdjustmentDialog } from "./adjustment-dialog"

const URGENCY_WEIGHT: Record<string, number> = { high: 0, medium: 1, low: 2 }

const URGENCY_BADGE: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
}

const STATUS_BADGE: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  in_progress: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  controlled: "bg-emerald-200 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  issue: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  rejected: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
}

function ageInDays(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000)
}

function ageLabel(createdAt: string): string {
  const days = ageInDays(createdAt)
  if (days === 0) return "today"
  if (days === 1) return "1d"
  return `${days}d`
}

export function AdjustmentsView({
  adjustments,
  canControl,
  canCreate,
  whatsappInviteUrl,
}: {
  adjustments: Adjustment[]
  canControl: boolean
  canCreate: boolean
  whatsappInviteUrl: string | null
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Adjustment | null>(null)
  const [noteTarget, setNoteTarget] = useState<{
    adjustment: Adjustment
    status: AdjustmentStatus
  } | null>(null)

  const { triage, awaitingControl, closed } = useMemo(() => {
    const triage = adjustments
      .filter((a) => OPEN_STATUSES.includes(a.status))
      .sort(
        (a, b) =>
          URGENCY_WEIGHT[a.urgency] - URGENCY_WEIGHT[b.urgency] ||
          a.created_at.localeCompare(b.created_at)
      )
    const awaitingControl = adjustments
      .filter((a) => a.status === "resolved")
      .sort((a, b) => (a.resolved_at ?? "").localeCompare(b.resolved_at ?? ""))
    const closed = adjustments
      .filter((a) => a.status === "controlled" || a.status === "rejected")
      .slice(0, 20)
    return { triage, awaitingControl, closed }
  }, [adjustments])

  async function copyLink(adjustment: Adjustment) {
    await navigator.clipboard.writeText(adjustmentShareUrl(adjustment.public_token))
    toast.success("Link copied")
  }

  async function copyUpdate(adjustment: Adjustment) {
    await navigator.clipboard.writeText(buildWhatsappUpdate(adjustment))
    toast.success("Update message copied — paste it in the group")
  }

  async function handleStatusChange(adjustment: Adjustment, status: AdjustmentStatus) {
    if (NOTE_REQUIRED_STATUSES.includes(status)) {
      setNoteTarget({ adjustment, status })
      return
    }
    const result = await updateAdjustmentStatus(adjustment.id, status)
    if (result?.error) toast.error(result.error)
    else if (status === "resolved")
      toast.success("Resolved — awaiting internal control")
    else toast.success(`Status: ${adjustmentStatusLabel(status)}`)
  }

  async function handleDuplicate(adjustment: Adjustment) {
    const result = await duplicateAdjustment(adjustment.id)
    if (result?.error) toast.error(result.error)
    else toast.success("Adjustment duplicated")
  }

  async function handleDelete() {
    if (!deleteTarget) return
    const result = await deleteAdjustment(deleteTarget.id)
    if (result?.error) toast.error(result.error)
    else toast.success("Adjustment deleted")
    setDeleteTarget(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Adjustments</h1>
          <p className="text-sm text-muted-foreground">
            Change requests, triaged so nothing falls through the cracks.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            New Adjustment
          </Button>
        )}
      </div>

      <QueueSection
        title="Triage"
        description="Open requests, highest urgency and oldest first."
        adjustments={triage}
        emptyLabel="No open adjustments"
        canControl={canControl}
        onCopyLink={copyLink}
        onStatusChange={handleStatusChange}
        onDuplicate={handleDuplicate}
        onDelete={setDeleteTarget}
        onCopyUpdate={copyUpdate}
        flagStale
      />

      <QueueSection
        title="Awaiting control"
        description="Resolved — needs an internal check before it counts as done."
        adjustments={awaitingControl}
        emptyLabel="Nothing waiting for control"
        canControl={canControl}
        onCopyLink={copyLink}
        onStatusChange={handleStatusChange}
        onDuplicate={handleDuplicate}
        onDelete={setDeleteTarget}
        onCopyUpdate={copyUpdate}
      />

      <QueueSection
        title="Recently closed"
        description="Controlled or rejected."
        adjustments={closed}
        emptyLabel="Nothing closed yet"
        canControl={canControl}
        onCopyLink={copyLink}
        onStatusChange={handleStatusChange}
        onDuplicate={handleDuplicate}
        onDelete={setDeleteTarget}
        onCopyUpdate={copyUpdate}
      />

      <AdjustmentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        whatsappInviteUrl={whatsappInviteUrl}
      />

      <StatusNoteDialog
        target={noteTarget}
        onClose={() => setNoteTarget(null)}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete adjustment?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? adjustmentSummary(deleteTarget) : ""} — this also deletes
              its notes and the shared link stops working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function QueueSection({
  title,
  description,
  adjustments,
  emptyLabel,
  canControl,
  onCopyLink,
  onStatusChange,
  onDuplicate,
  onDelete,
  onCopyUpdate,
  flagStale = false,
}: {
  title: string
  description: string
  adjustments: Adjustment[]
  emptyLabel: string
  canControl: boolean
  onCopyLink: (a: Adjustment) => void
  onStatusChange: (a: Adjustment, s: AdjustmentStatus) => void
  onDuplicate: (a: Adjustment) => void
  onDelete: (a: Adjustment) => void
  onCopyUpdate: (a: Adjustment) => void
  flagStale?: boolean
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-medium">{title}</h2>
        <Badge variant="secondary">{adjustments.length}</Badge>
        <span className="text-sm text-muted-foreground">{description}</span>
      </div>
      {adjustments.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {emptyLabel}
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Client / Listing</TableHead>
                <TableHead>Urgency</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Age</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {adjustments.map((adjustment) => {
                const stale =
                  flagStale &&
                  adjustment.urgency === "high" &&
                  ageInDays(adjustment.created_at) >= STALE_HIGH_URGENCY_DAYS
                return (
                  <TableRow key={adjustment.id} className={stale ? "bg-red-50 dark:bg-red-950/30" : undefined}>
                    <TableCell>
                      <Link
                        href={`/a/${adjustment.public_token}`}
                        className="font-medium hover:underline"
                      >
                        {adjustmentTagLabel(adjustment.tag)}
                        {adjustment.target_value ? ` ${adjustment.target_value}` : ""}
                      </Link>
                      {stale && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                          <AlertTriangle className="size-3" />
                          stale
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {adjustment.clients?.name}
                      {adjustment.scope === "single_listing" && adjustment.listings
                        ? ` · ${adjustment.listings.name}`
                        : " · portfolio"}
                    </TableCell>
                    <TableCell>
                      <Badge className={URGENCY_BADGE[adjustment.urgency]}>
                        {adjustment.urgency}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE[adjustment.status]}>
                        {adjustmentStatusLabel(adjustment.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ageLabel(adjustment.created_at)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onCopyLink(adjustment)}>
                            <ClipboardCopy />
                            Copy link
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onCopyUpdate(adjustment)}>
                            <Check />
                            Copy WhatsApp update
                          </DropdownMenuItem>
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>Move to…</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {ADJUSTMENT_STATUSES.filter(
                                (s) =>
                                  s.value !== adjustment.status &&
                                  (s.value !== "controlled" ||
                                    (canControl && adjustment.status === "resolved"))
                              ).map((s) => (
                                <DropdownMenuItem
                                  key={s.value}
                                  onClick={() => onStatusChange(adjustment, s.value)}
                                >
                                  {s.label}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          <DropdownMenuItem onClick={() => onDuplicate(adjustment)}>
                            <Copy />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => onDelete(adjustment)}
                          >
                            <Trash2 />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}

function StatusNoteDialog({
  target,
  onClose,
}: {
  target: { adjustment: Adjustment; status: AdjustmentStatus } | null
  onClose: () => void
}) {
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!target) return
    setSaving(true)
    const result = await updateAdjustmentStatus(target.adjustment.id, target.status, note)
    setSaving(false)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    toast.success(`Status: ${adjustmentStatusLabel(target.status)}`)
    setNote("")
    onClose()
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {target?.status === "rejected" ? "Reject adjustment" : "Mark as issue"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {target?.status === "rejected"
            ? "Why is this request not being done? The reason is kept as a note for the client-facing trail."
            : "What is blocking this adjustment? A note is required so it doesn't become a dead end."}
        </p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason…"
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !note.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
