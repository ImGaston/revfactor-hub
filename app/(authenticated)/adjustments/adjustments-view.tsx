"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Pencil,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  SETUP_CONTROL_CHECKLIST,
  STALE_HIGH_URGENCY_DAYS,
  adjustmentOriginLabel,
  adjustmentShareUrl,
  adjustmentStatusLabel,
  adjustmentStatusLabelFor,
  adjustmentSummary,
  adjustmentTypeLabel,
  buildWhatsappUpdate,
  isEscalated,
  pricelabsUrl,
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

// Only non-internal origins get a badge — internal is the default and would be noise
const ORIGIN_BADGE: Record<string, string> = {
  client: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  hostpricing: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
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
  canEdit,
  whatsappInviteUrl,
}: {
  adjustments: Adjustment[]
  canControl: boolean
  canCreate: boolean
  canEdit: boolean
  whatsappInviteUrl: string | null
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Adjustment | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Adjustment | null>(null)
  const [clientFilter, setClientFilter] = useState("all")
  const [noteTarget, setNoteTarget] = useState<{
    adjustment: Adjustment
    status: AdjustmentStatus
  } | null>(null)

  const clientOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const a of adjustments) {
      if (a.client_id && a.clients?.name) byId.set(a.client_id, a.clients.name)
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [adjustments])

  const { triage, awaitingControl, closed } = useMemo(() => {
    const visible =
      clientFilter === "all"
        ? adjustments
        : adjustments.filter((a) => a.client_id === clientFilter)
    const triage = visible
      .filter((a) => OPEN_STATUSES.includes(a.status))
      .sort(
        (a, b) =>
          URGENCY_WEIGHT[a.urgency] - URGENCY_WEIGHT[b.urgency] ||
          Number(isEscalated(b)) - Number(isEscalated(a)) ||
          a.created_at.localeCompare(b.created_at)
      )
    const awaitingControl = visible
      .filter((a) => a.status === "resolved")
      .sort((a, b) => (a.resolved_at ?? "").localeCompare(b.resolved_at ?? ""))
    const closed = visible
      .filter((a) => a.status === "controlled" || a.status === "rejected")
      .slice(0, 20)
    return { triage, awaitingControl, closed }
  }, [adjustments, clientFilter])

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
        <div className="flex items-center gap-2">
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clientOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canCreate && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              New Adjustment
            </Button>
          )}
        </div>
      </div>

      <QueueSection
        title="Triage"
        description="Open requests, highest urgency and oldest first."
        adjustments={triage}
        emptyLabel="No open adjustments"
        canControl={canControl}
        canEdit={canEdit}
        onCopyLink={copyLink}
        onStatusChange={handleStatusChange}
        onEdit={setEditTarget}
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
        canEdit={canEdit}
        onCopyLink={copyLink}
        onStatusChange={handleStatusChange}
        onEdit={setEditTarget}
        onDuplicate={handleDuplicate}
        onDelete={setDeleteTarget}
        onCopyUpdate={copyUpdate}
        showControlActions
      />

      <QueueSection
        title="Recently closed"
        description="Controlled or rejected."
        adjustments={closed}
        emptyLabel="Nothing closed yet"
        canControl={canControl}
        canEdit={canEdit}
        onCopyLink={copyLink}
        onStatusChange={handleStatusChange}
        onEdit={setEditTarget}
        onDuplicate={handleDuplicate}
        onDelete={setDeleteTarget}
        onCopyUpdate={copyUpdate}
        collapsedLimit={3}
      />

      <AdjustmentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        whatsappInviteUrl={whatsappInviteUrl}
      />

      <AdjustmentDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        whatsappInviteUrl={whatsappInviteUrl}
        adjustment={editTarget}
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
  canEdit,
  onCopyLink,
  onStatusChange,
  onEdit,
  onDuplicate,
  onDelete,
  onCopyUpdate,
  flagStale = false,
  showControlActions = false,
  collapsedLimit,
}: {
  title: string
  description: string
  adjustments: Adjustment[]
  emptyLabel: string
  canControl: boolean
  canEdit: boolean
  onCopyLink: (a: Adjustment) => void
  onStatusChange: (a: Adjustment, s: AdjustmentStatus) => void
  onEdit: (a: Adjustment) => void
  onDuplicate: (a: Adjustment) => void
  onDelete: (a: Adjustment) => void
  onCopyUpdate: (a: Adjustment) => void
  flagStale?: boolean
  showControlActions?: boolean
  collapsedLimit?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const collapsed = collapsedLimit !== undefined && !expanded
  const visible = collapsed ? adjustments.slice(0, collapsedLimit) : adjustments
  const hiddenCount = adjustments.length - visible.length

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
                {showControlActions && <TableHead />}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((adjustment) => {
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
                        {adjustmentTypeLabel(adjustment.type)}
                        {adjustment.target_value ? ` ${adjustment.target_value}` : ""}
                      </Link>
                      {stale && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                          <AlertTriangle className="size-3" />
                          stale
                        </span>
                      )}
                      {isEscalated(adjustment) && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                          <AlertTriangle className="size-3" />
                          client escalation
                        </span>
                      )}
                      {showControlActions && adjustment.type === "setup" && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Verify: {SETUP_CONTROL_CHECKLIST.join(" · ").toLowerCase()}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {adjustment.clients?.name}
                      {adjustment.scope === "single_listing" && adjustment.listings
                        ? ` · ${adjustment.listings.name}`
                        : " · portfolio"}
                      {adjustment.origin !== "internal" && (
                        <Badge
                          variant="outline"
                          className={`ml-2 ${ORIGIN_BADGE[adjustment.origin]}`}
                        >
                          {adjustmentOriginLabel(adjustment.origin)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={URGENCY_BADGE[adjustment.urgency]}>
                        {adjustment.urgency}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE[adjustment.status]}>
                        {adjustmentStatusLabelFor(adjustment)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ageLabel(adjustment.created_at)}
                    </TableCell>
                    {showControlActions && (
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          {adjustment.listings &&
                            pricelabsUrl(adjustment.listings) && (
                              <Button asChild variant="outline" size="sm">
                                <a
                                  href={pricelabsUrl(adjustment.listings)!}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <ExternalLink />
                                  PriceLabs
                                </a>
                              </Button>
                            )}
                          {canControl && (
                            <Button
                              size="sm"
                              onClick={() => onStatusChange(adjustment, "controlled")}
                            >
                              <Check />
                              Confirm control
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
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
                          {canEdit && OPEN_STATUSES.includes(adjustment.status) && (
                            <DropdownMenuItem onClick={() => onEdit(adjustment)}>
                              <Pencil />
                              Edit
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>Move to…</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {ADJUSTMENT_STATUSES.filter(
                                (s) =>
                                  s.value !== adjustment.status &&
                                  (s.value !== "controlled" ||
                                    (canControl && adjustment.status === "resolved"))
                              ).map((s) => {
                                // HostPricing proposals: moving out of `open` is the approval step
                                const isProposal =
                                  adjustment.origin === "hostpricing" &&
                                  adjustment.status === "open"
                                const label =
                                  isProposal && s.value === "in_progress"
                                    ? "Approve → In Progress"
                                    : isProposal && s.value === "rejected"
                                      ? "Deny (reject)"
                                      : s.label
                                return (
                                  <DropdownMenuItem
                                    key={s.value}
                                    onClick={() => onStatusChange(adjustment, s.value)}
                                  >
                                    {label}
                                  </DropdownMenuItem>
                                )
                              })}
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
          {collapsedLimit !== undefined &&
            (hiddenCount > 0 || expanded) && (
              <div className="border-t p-1.5 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded ? (
                    <>
                      <ChevronUp />
                      Show less
                    </>
                  ) : (
                    <>
                      <ChevronDown />
                      Show all {adjustments.length}
                    </>
                  )}
                </Button>
              </div>
            )}
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
            {target?.status !== "rejected"
              ? "Mark as issue"
              : target.adjustment.origin === "hostpricing" &&
                  target.adjustment.status === "open"
                ? "Deny proposal"
                : "Reject adjustment"}
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
