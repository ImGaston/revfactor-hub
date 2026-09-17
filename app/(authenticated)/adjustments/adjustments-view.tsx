"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  AlertTriangle,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Copy,
  ExternalLink,
  Filter,
  MessageCircleWarning,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
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
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { MultiSelectFilter } from "@/components/filters/multi-select-filter"
import type { Adjustment, AdjustmentStatus } from "@/lib/types"
import {
  ADJUSTMENT_ORIGINS,
  ADJUSTMENT_STATUSES,
  ADJUSTMENT_TYPES,
  ADJUSTMENT_URGENCIES,
  NOTE_REQUIRED_STATUSES,
  OPEN_STATUSES,
  ORIGIN_BADGE,
  SETUP_CONTROL_CHECKLIST,
  STALE_HIGH_URGENCY_DAYS,
  STATUS_BADGE,
  URGENCY_BADGE,
  adjustmentOriginLabel,
  adjustmentShareUrl,
  adjustmentStatusLabel,
  adjustmentStatusLabelFor,
  adjustmentSummary,
  adjustmentTypeLabel,
  buildWhatsappUpdate,
  hasUnansweredExternalComment,
  isEscalated,
  isPendingApproval,
  pricelabsUrl,
} from "@/lib/adjustments"
import {
  deleteAdjustment,
  duplicateAdjustment,
  updateAdjustmentStatus,
} from "./actions"
import { AdjustmentDialog } from "./adjustment-dialog"

const URGENCY_WEIGHT: Record<string, number> = { high: 0, medium: 1, low: 2 }

// Count rows per value so every filter option can show how many rows it holds
function countBy<T>(rows: T[], key: (row: T) => string | null | undefined) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const k = key(row)
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return counts
}

function creatorName(a: Adjustment): string | null {
  return a.creator?.full_name || a.creator?.email || null
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
  isHostpricing,
  whatsappInviteUrl,
}: {
  adjustments: Adjustment[]
  canControl: boolean
  canCreate: boolean
  canEdit: boolean
  isHostpricing: boolean
  whatsappInviteUrl: string | null
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Adjustment | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Adjustment | null>(null)
  const [search, setSearch] = useState("")
  // Each filter is a multi-select; an empty array means "no filter".
  const [clientFilter, setClientFilter] = useState<string[]>([])
  const [originFilter, setOriginFilter] = useState<string[]>([])
  const [typeFilter, setTypeFilter] = useState<string[]>([])
  const [urgencyFilter, setUrgencyFilter] = useState<string[]>([])
  const [creatorFilter, setCreatorFilter] = useState<string[]>([])
  const [noteTarget, setNoteTarget] = useState<{
    adjustment: Adjustment
    status: AdjustmentStatus
  } | null>(null)

  const clientOptions = useMemo(() => {
    const byId = new Map<string, { name: string; count: number }>()
    for (const a of adjustments) {
      if (!a.client_id || !a.clients?.name) continue
      const entry = byId.get(a.client_id)
      if (entry) entry.count += 1
      else byId.set(a.client_id, { name: a.clients.name, count: 1 })
    }
    return [...byId.entries()]
      .map(([id, { name, count }]) => ({ id, name, count }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [adjustments])

  // Origin / type / urgency follow the canonical order from lib/adjustments;
  // options with zero rows are hidden so the dropdowns stay short.
  const originOptions = useMemo(() => {
    const counts = countBy(adjustments, (a) => a.origin)
    return ADJUSTMENT_ORIGINS.filter((o) => counts.has(o.value)).map((o) => ({
      ...o,
      count: counts.get(o.value)!,
    }))
  }, [adjustments])

  const typeOptions = useMemo(() => {
    const counts = countBy(adjustments, (a) => a.type)
    return ADJUSTMENT_TYPES.filter((t) => counts.has(t.value)).map((t) => ({
      ...t,
      count: counts.get(t.value)!,
    }))
  }, [adjustments])

  const urgencyOptions = useMemo(() => {
    const counts = countBy(adjustments, (a) => a.urgency)
    return [...ADJUSTMENT_URGENCIES]
      .reverse()
      .filter((u) => counts.has(u.value))
      .map((u) => ({ ...u, count: counts.get(u.value)! }))
  }, [adjustments])

  // "Created by" is the hub user who filed the ticket (created_by → profiles),
  // distinct from origin (who asked for the change) and requested_by (free text).
  const creatorOptions = useMemo(() => {
    const byId = new Map<string, { name: string; count: number }>()
    for (const a of adjustments) {
      const name = creatorName(a)
      if (!a.created_by || !name) continue
      const entry = byId.get(a.created_by)
      if (entry) entry.count += 1
      else byId.set(a.created_by, { name, count: 1 })
    }
    return [...byId.entries()]
      .map(([id, { name, count }]) => ({ id, name, count }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [adjustments])

  const activeFilters =
    (clientFilter.length ? 1 : 0) +
    (originFilter.length ? 1 : 0) +
    (typeFilter.length ? 1 : 0) +
    (urgencyFilter.length ? 1 : 0) +
    (creatorFilter.length ? 1 : 0) +
    (search.trim() ? 1 : 0)

  function clearFilters() {
    setSearch("")
    setClientFilter([])
    setOriginFilter([])
    setTypeFilter([])
    setUrgencyFilter([])
    setCreatorFilter([])
  }

  const { visible, waitingOnUs, triage, awaitingControl, closed } = useMemo(() => {
    const q = search.trim().toLowerCase()
    // Values within one filter are OR'd; filters are AND'd together.
    const matches = (selected: string[], value: string | null | undefined) =>
      selected.length === 0 || (value != null && selected.includes(value))
    const visible = adjustments.filter((a) => {
      if (!matches(clientFilter, a.client_id)) return false
      if (!matches(originFilter, a.origin)) return false
      if (!matches(typeFilter, a.type)) return false
      if (!matches(urgencyFilter, a.urgency)) return false
      if (!matches(creatorFilter, a.created_by)) return false
      if (!q) return true
      const haystack = [
        adjustmentTypeLabel(a.type),
        a.target_value,
        a.clients?.name,
        a.listings?.name,
        a.requested_by,
        creatorName(a),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(q)
    })
    const byUrgencyThenAge = (a: Adjustment, b: Adjustment) =>
      URGENCY_WEIGHT[a.urgency] - URGENCY_WEIGHT[b.urgency] ||
      Number(isEscalated(b)) - Number(isEscalated(a)) ||
      a.created_at.localeCompare(b.created_at)
    // The internal bottleneck: blocked on info from us, a HostPricing proposal
    // awaiting approval, or the last word on the ticket came from outside.
    // Rendered first so it can't be missed.
    const waitingOnUs = visible
      .filter(
        (a) =>
          a.status === "needs_info" ||
          isPendingApproval(a) ||
          (a.status !== "controlled" &&
            a.status !== "rejected" &&
            hasUnansweredExternalComment(a.comment_stats))
      )
      .sort(byUrgencyThenAge)
    // needs_info and pending-approval rows live only in "Waiting on us" (their
    // sole next step is internal); unanswered-comment rows stay in their status
    // queue too — the flag is an overlay, not a status
    const triage = visible
      .filter(
        (a) =>
          OPEN_STATUSES.includes(a.status) &&
          a.status !== "needs_info" &&
          !isPendingApproval(a)
      )
      .sort(byUrgencyThenAge)
    const awaitingControl = visible
      .filter((a) => a.status === "resolved")
      .sort((a, b) => (a.resolved_at ?? "").localeCompare(b.resolved_at ?? ""))
    const closed = visible
      .filter((a) => a.status === "controlled" || a.status === "rejected")
      .slice(0, 20)
    return { visible, waitingOnUs, triage, awaitingControl, closed }
  }, [
    adjustments,
    search,
    clientFilter,
    originFilter,
    typeFilter,
    urgencyFilter,
    creatorFilter,
  ])

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

      {/* Search + filters row. Filters apply to every queue below. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] max-w-xs flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search request, client, listing…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Client filter is searchable — the client list is long */}
        <MultiSelectFilter
          placeholder="All clients"
          title="Clients"
          icon={Building2}
          searchable
          searchPlaceholder="Search clients…"
          emptyLabel="No clients found."
          options={clientOptions.map((c) => ({
            value: c.id,
            label: c.name,
            count: c.count,
          }))}
          selected={clientFilter}
          onChange={setClientFilter}
          className="w-[200px]"
          contentClassName="w-[260px]"
        />

        <MultiSelectFilter
          placeholder="All origins"
          title="Origins"
          options={originOptions.map((o) => ({
            value: o.value,
            label: o.label,
            count: o.count,
          }))}
          selected={originFilter}
          onChange={setOriginFilter}
          className="w-[150px]"
        />

        <MultiSelectFilter
          placeholder="All types"
          title="Types"
          options={typeOptions.map((t) => ({
            value: t.value,
            label: t.label,
            count: t.count,
          }))}
          selected={typeFilter}
          onChange={setTypeFilter}
          className="w-[170px]"
        />

        <MultiSelectFilter
          placeholder="All urgencies"
          title="Urgencies"
          options={urgencyOptions.map((u) => ({
            value: u.value,
            label: u.label,
            count: u.count,
          }))}
          selected={urgencyFilter}
          onChange={setUrgencyFilter}
          className="w-[140px]"
        />

        <MultiSelectFilter
          placeholder="Created by anyone"
          title="Creators"
          options={creatorOptions.map((c) => ({
            value: c.id,
            label: c.name,
            count: c.count,
          }))}
          selected={creatorFilter}
          onChange={setCreatorFilter}
          className="w-[170px]"
        />

        {activeFilters > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Filter className="size-3" />
            Clear filters ({activeFilters}) · {visible.length} of {adjustments.length}
          </button>
        )}
      </div>

      {waitingOnUs.length > 0 && (
        <QueueSection
          title="Waiting on us"
          description="Blocked on the internal team — needs info, a HostPricing proposal to approve, or an unanswered external comment."
          adjustments={waitingOnUs}
          emptyLabel="Nothing waiting on us"
          canControl={canControl}
          canEdit={canEdit}
          onCopyLink={copyLink}
          onStatusChange={handleStatusChange}
          onEdit={setEditTarget}
          onDuplicate={handleDuplicate}
          onDelete={setDeleteTarget}
          onCopyUpdate={copyUpdate}
        />
      )}

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
        lockOriginToHostpricing={isHostpricing}
      />

      <AdjustmentDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        whatsappInviteUrl={whatsappInviteUrl}
        adjustment={editTarget}
        lockOriginToHostpricing={isHostpricing}
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
  const router = useRouter()
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
                const needsReply = hasUnansweredExternalComment(adjustment.comment_stats)
                return (
                  <TableRow
                    key={adjustment.id}
                    onClick={() => router.push(`/adjustments/${adjustment.id}`)}
                    className={`cursor-pointer ${stale ? "bg-red-50 dark:bg-red-950/30" : ""}`}
                  >
                    <TableCell className="whitespace-normal">
                      <span className="font-medium">
                        {adjustmentTypeLabel(adjustment.type)}
                        {adjustment.target_value ? ` ${adjustment.target_value}` : ""}
                      </span>
                      {(adjustment.comment_stats?.comment_count ?? 0) > 0 &&
                        (needsReply ? (
                          <span
                            title="Awaiting internal reply"
                            className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400"
                          >
                            <MessageCircleWarning className="size-3" />
                            {adjustment.comment_stats!.comment_count}
                            <span>needs reply</span>
                          </span>
                        ) : (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <MessageSquare className="size-3" />
                            {adjustment.comment_stats!.comment_count}
                          </span>
                        ))}
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
                    <TableCell className="whitespace-normal text-sm text-muted-foreground">
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
                      <TableCell onClick={(e) => e.stopPropagation()}>
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
                    <TableCell onClick={(e) => e.stopPropagation()}>
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

  const title =
    target?.status === "needs_info"
      ? "Needs info from the internal team"
      : target?.status === "rejected"
        ? target.adjustment.origin === "hostpricing" &&
          target.adjustment.status === "open"
          ? "Deny proposal"
          : "Reject adjustment"
        : "Mark as issue"
  const description =
    target?.status === "needs_info"
      ? "What information do you need? The question is posted as a note and the ticket reopens when an internal user replies."
      : target?.status === "rejected"
        ? "Why is this request not being done? The reason is kept as a note for the client-facing trail."
        : "What is blocking this adjustment? A note is required so it doesn't become a dead end."

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={target?.status === "needs_info" ? "What's missing…" : "Reason…"}
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
