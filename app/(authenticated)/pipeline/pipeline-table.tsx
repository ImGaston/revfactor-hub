"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Search,
  ArrowUpDown,
  Plus,
  Trash2,
  ArrowRightLeft,
  Tag,
  Users,
  X,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { LeadFormDialog } from "./lead-form-dialog"
import { STAGE_COLUMNS } from "./pipeline-kanban"
import { bulkDeleteLeads, bulkUpdateLeads, bulkAssignTeam } from "./actions"
import type { Lead, LeadTag } from "@/lib/types"

const SERVICE_TYPES = [
  { value: "a_ideal_fit", label: "A – Ideal Fit" },
  { value: "b_needs_evaluation", label: "B – Needs Evaluation" },
  { value: "c_not_a_fit", label: "C – Not a Fit" },
]

const LEAD_SOURCES = [
  { value: "landing_page", label: "Landing Page" },
  { value: "referral", label: "Referral" },
  { value: "web_form", label: "Web Form" },
  { value: "social_media", label: "Social Media" },
  { value: "cold_outreach", label: "Cold Outreach" },
  { value: "other", label: "Other" },
]

type ProfileOption = {
  id: string
  full_name: string | null
  email: string
  avatar_url: string | null
}

type Props = {
  leads: Lead[]
  tags: LeadTag[]
  profiles: ProfileOption[]
}

type SortField =
  | "project_name"
  | "full_name"
  | "stage"
  | "scheduled_date"
  | "created_at"
type SortDir = "asc" | "desc"

export function PipelineTable({ leads, tags, profiles }: Props) {
  const [search, setSearch] = useState("")
  const [stageFilter, setStageFilter] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>("created_at")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [formOpen, setFormOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const router = useRouter()

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDir("asc")
    }
  }

  const filtered = useMemo(() => {
    let result = leads

    if (stageFilter) {
      result = result.filter((l) => l.stage === stageFilter)
    }

    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (l) =>
          l.project_name.toLowerCase().includes(q) ||
          (l.full_name?.toLowerCase().includes(q) ?? false) ||
          (l.email?.toLowerCase().includes(q) ?? false)
      )
    }

    result = [...result].sort((a, b) => {
      const aVal = a[sortField] ?? ""
      const bVal = b[sortField] ?? ""
      const cmp = String(aVal).localeCompare(String(bVal))
      return sortDir === "asc" ? cmp : -cmp
    })

    return result
  }, [leads, search, stageFilter, sortField, sortDir])

  const filteredIds = useMemo(
    () => new Set(filtered.map((l) => l.id)),
    [filtered]
  )

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of leads) {
      counts[l.stage] = (counts[l.stage] ?? 0) + 1
    }
    return counts
  }, [leads])

  // ─── Selection helpers ──────────────────────────────────

  const selectedCount = selected.size
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((l) => selected.has(l.id))
  const someFilteredSelected =
    filtered.some((l) => selected.has(l.id)) && !allFilteredSelected

  function toggleSelectAll() {
    if (allFilteredSelected) {
      // Deselect all filtered
      setSelected((prev) => {
        const next = new Set(prev)
        for (const l of filtered) next.delete(l.id)
        return next
      })
    } else {
      // Select all filtered
      setSelected((prev) => {
        const next = new Set(prev)
        for (const l of filtered) next.add(l.id)
        return next
      })
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
  }

  // Filter selected to only those currently visible
  const activeSelectedIds = useMemo(
    () => Array.from(selected).filter((id) => filteredIds.has(id)),
    [selected, filteredIds]
  )

  // ─── Bulk actions ───────────────────────────────────────

  async function handleBulkDelete() {
    setBulkLoading(true)
    const result = await bulkDeleteLeads(activeSelectedIds)
    setBulkLoading(false)
    setDeleteDialogOpen(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(`Deleted ${result.count} lead${result.count !== 1 ? "s" : ""}`)
      clearSelection()
      router.refresh()
    }
  }

  async function handleBulkStage(newStage: string) {
    setBulkLoading(true)
    const result = await bulkUpdateLeads(activeSelectedIds, { stage: newStage })
    setBulkLoading(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      const label =
        STAGE_COLUMNS.find((c) => c.id === newStage)?.label ?? newStage
      toast.success(`Moved ${result.count} lead${result.count !== 1 ? "s" : ""} to ${label}`)
      clearSelection()
      router.refresh()
    }
  }

  async function handleBulkServiceType(value: string) {
    setBulkLoading(true)
    const result = await bulkUpdateLeads(activeSelectedIds, {
      service_type: value,
    })
    setBulkLoading(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(`Updated service type for ${result.count} lead${result.count !== 1 ? "s" : ""}`)
      clearSelection()
      router.refresh()
    }
  }

  async function handleBulkSource(value: string) {
    setBulkLoading(true)
    const result = await bulkUpdateLeads(activeSelectedIds, {
      lead_source: value,
    })
    setBulkLoading(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(`Updated lead source for ${result.count} lead${result.count !== 1 ? "s" : ""}`)
      clearSelection()
      router.refresh()
    }
  }

  async function handleBulkAssign(profileId: string) {
    setBulkLoading(true)
    const result = await bulkAssignTeam(activeSelectedIds, [profileId])
    setBulkLoading(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      const name =
        profiles.find((p) => p.id === profileId)?.full_name ?? "team member"
      toast.success(`Assigned ${name} to ${result.count} lead${result.count !== 1 ? "s" : ""}`)
      clearSelection()
      router.refresh()
    }
  }

  // ─── Helpers ────────────────────────────────────────────

  function getStageColor(stage: string) {
    return STAGE_COLUMNS.find((c) => c.id === stage)?.color ?? "#6b7280"
  }

  function getStageLabel(stage: string) {
    return STAGE_COLUMNS.find((c) => c.id === stage)?.label ?? stage
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "—"
    const d = new Date(dateStr)
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  function SortHeader({
    field,
    children,
  }: {
    field: SortField
    children: React.ReactNode
  }) {
    return (
      <TableHead
        className="cursor-pointer select-none"
        onClick={() => toggleSort(field)}
      >
        <div className="flex items-center gap-1">
          {children}
          <ArrowUpDown className="size-3 text-muted-foreground" />
        </div>
      </TableHead>
    )
  }

  return (
    <div className="space-y-4">
      {/* Stage filter tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStageFilter(null)}
          className={`text-sm px-2.5 py-1 rounded-md transition-colors ${
            !stageFilter
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          All ({leads.length})
        </button>
        {STAGE_COLUMNS.map((col) => (
          <button
            key={col.id}
            onClick={() =>
              setStageFilter(stageFilter === col.id ? null : col.id)
            }
            className={`text-sm px-2.5 py-1 rounded-md transition-colors ${
              stageFilter === col.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {col.label} ({stageCounts[col.id] ?? 0})
          </button>
        ))}
      </div>

      {/* Search + Add */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setFormOpen(true)} size="sm">
          <Plus className="size-4 mr-1" />
          New Lead
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={
                    allFilteredSelected
                      ? true
                      : someFilteredSelected
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </TableHead>
              <SortHeader field="project_name">Project</SortHeader>
              <SortHeader field="full_name">Contact</SortHeader>
              <TableHead>Service Type</TableHead>
              <SortHeader field="stage">Stage</SortHeader>
              <TableHead>Team</TableHead>
              <SortHeader field="scheduled_date">Scheduled</SortHeader>
              <SortHeader field="created_at">Created</SortHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-12"
                >
                  No leads found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((lead) => {
                const team = lead.lead_team_assignments ?? []
                const isSelected = selected.has(lead.id)
                return (
                  <TableRow
                    key={lead.id}
                    className={`cursor-pointer hover:bg-muted/50 ${
                      isSelected ? "bg-primary/5" : ""
                    }`}
                    onClick={() => router.push(`/pipeline/${lead.id}`)}
                  >
                    <TableCell
                      onClick={(e) => e.stopPropagation()}
                      className="w-10"
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(lead.id)}
                        aria-label={`Select ${lead.project_name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {lead.project_name}
                    </TableCell>
                    <TableCell>
                      <div>
                        {lead.full_name && (
                          <p className="text-sm">{lead.full_name}</p>
                        )}
                        {lead.email && (
                          <p className="text-xs text-muted-foreground">
                            {lead.email}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {lead.service_type ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className="text-[10px]"
                        style={{
                          backgroundColor: getStageColor(lead.stage),
                          color: "white",
                          borderColor: getStageColor(lead.stage),
                        }}
                      >
                        {getStageLabel(lead.stage)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex -space-x-1.5">
                        {team.slice(0, 3).map((t) => (
                          <Avatar
                            key={t.profile_id}
                            className="size-6 border-2 border-background"
                          >
                            <AvatarImage
                              src={t.profiles?.avatar_url ?? undefined}
                            />
                            <AvatarFallback className="text-[9px]">
                              {(
                                t.profiles?.full_name?.[0] ??
                                t.profiles?.email[0] ??
                                "?"
                              ).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                        {team.length > 3 && (
                          <span className="flex items-center justify-center size-6 rounded-full bg-muted text-[9px] border-2 border-background">
                            +{team.length - 3}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(lead.scheduled_date)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(lead.created_at)}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* ─── Floating Bulk Action Bar ──────────────────────── */}
      {selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-2 rounded-lg border bg-background px-4 py-2.5 shadow-lg">
            <span className="text-sm font-medium whitespace-nowrap">
              {selectedCount} selected
            </span>

            <div className="h-5 w-px bg-border" />

            {/* Move to Stage */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulkLoading}
                >
                  <ArrowRightLeft className="size-3.5 mr-1.5" />
                  Stage
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-1" align="center" side="top">
                {STAGE_COLUMNS.map((col) => (
                  <button
                    key={col.id}
                    onClick={() => handleBulkStage(col.id)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                  >
                    <span
                      className="size-2 rounded-full shrink-0"
                      style={{ backgroundColor: col.color }}
                    />
                    {col.label}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            {/* Service Type */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulkLoading}
                >
                  <Tag className="size-3.5 mr-1.5" />
                  Service Type
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-52 p-1" align="center" side="top">
                {SERVICE_TYPES.map((st) => (
                  <button
                    key={st.value}
                    onClick={() => handleBulkServiceType(st.value)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                  >
                    {st.label}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            {/* Lead Source */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulkLoading}
                >
                  <Tag className="size-3.5 mr-1.5" />
                  Source
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-44 p-1" align="center" side="top">
                {LEAD_SOURCES.map((ls) => (
                  <button
                    key={ls.value}
                    onClick={() => handleBulkSource(ls.value)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                  >
                    {ls.label}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            {/* Assign Team */}
            {profiles.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={bulkLoading}
                  >
                    <Users className="size-3.5 mr-1.5" />
                    Assign
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-52 p-1" align="center" side="top">
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleBulkAssign(p.id)}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                    >
                      <Avatar className="size-5">
                        <AvatarImage src={p.avatar_url ?? undefined} />
                        <AvatarFallback className="text-[8px]">
                          {(
                            p.full_name?.[0] ??
                            p.email[0] ??
                            "?"
                          ).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      {p.full_name ?? p.email}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            )}

            <div className="h-5 w-px bg-border" />

            {/* Delete */}
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              disabled={bulkLoading}
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="size-3.5 mr-1.5" />
              Delete
            </Button>

            {/* Clear selection */}
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={clearSelection}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedCount} lead{selectedCount !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected leads and all their
              associated data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkLoading}
            >
              {bulkLoading ? "Deleting..." : `Delete ${selectedCount}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LeadFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultStage="inquiry"
        tags={tags}
        profiles={profiles}
      />
    </div>
  )
}
