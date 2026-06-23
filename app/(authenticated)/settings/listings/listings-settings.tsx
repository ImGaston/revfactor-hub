"use client"

import { useState, useMemo, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  X,
  ChevronDown,
  Check,
  RefreshCw,
  Eye,
  EyeOff,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import { ListingDialog } from "./listing-dialog"
import { ReportOverrides, type ReportOverrideRow } from "./report-overrides"
import {
  deleteListingAction,
  syncPriceLabsAction,
  syncReportBuilderAction,
  updateListingStatusAction,
} from "./actions"

type SettingsListing = {
  id: string
  name: string
  status: string
  listing_id: string | null
  pricelabs_link: string | null
  airbnb_link: string | null
  city: string | null
  state: string | null
  client_id: string
  client_name: string | null
  pl_synced_at: string | null
}

type StatusFilter = "all" | "active" | "inactive"
type ListingSyncRunResult = {
  status: "synced" | "not_found" | "failed"
  syncedAt: string | null
  error?: string
}

function formatSyncDate(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function ListingsSettings({
  listings,
  overrides,
}: {
  listings: SettingsListing[]
  overrides: ReportOverrideRow[]
}) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active")
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set())
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SettingsListing | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<SettingsListing | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncingReport, setSyncingReport] = useState(false)
  const [syncResults, setSyncResults] = useState<
    Record<string, ListingSyncRunResult>
  >({})
  const [, startTransition] = useTransition()

  const statusCounts = useMemo(() => {
    let active = 0
    let inactive = 0
    for (const l of listings) {
      if (l.status === "inactive") inactive++
      else active++
    }
    return { all: listings.length, active, inactive }
  }, [listings])

  const clientNames = useMemo(() => {
    const names = new Set<string>()
    for (const l of listings) if (l.client_name) names.add(l.client_name)
    return Array.from(names).sort()
  }, [listings])

  const states = useMemo(() => {
    const s = new Set<string>()
    for (const l of listings) if (l.state) s.add(l.state)
    return Array.from(s).sort()
  }, [listings])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return listings.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false
      if (
        q &&
        !l.name.toLowerCase().includes(q) &&
        !l.listing_id?.toLowerCase().includes(q)
      )
        return false
      if (
        selectedClients.size > 0 &&
        (!l.client_name || !selectedClients.has(l.client_name))
      )
        return false
      if (selectedStates.size > 0 && (!l.state || !selectedStates.has(l.state)))
        return false
      return true
    })
  }, [listings, search, statusFilter, selectedClients, selectedStates])

  function toggleFilter(
    set: Set<string>,
    value: string,
    setter: (s: Set<string>) => void
  ) {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setter(next)
  }

  const hasFilters =
    search || selectedClients.size > 0 || selectedStates.size > 0

  function clearFilters() {
    setSearch("")
    setSelectedClients(new Set())
    setSelectedStates(new Set())
  }

  function handleNew() {
    setEditing(undefined)
    setDialogOpen(true)
  }

  function handleEdit(listing: SettingsListing) {
    setEditing(listing)
    setDialogOpen(true)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const result = await deleteListingAction(deleteTarget.id)
    setDeleting(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Listing deleted")
    }
    setDeleteTarget(null)
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const result = await syncPriceLabsAction()
      if (result.error) {
        toast.error(result.error)
        return
      }

      setSyncResults(
        Object.fromEntries(
          result.results.map((item) => [
            item.listingId,
            {
              status: item.status,
              syncedAt: item.syncedAt,
              error: item.error,
            },
          ])
        )
      )

      const summary = [
        `${result.synced} synced`,
        `${result.notFound} not found`,
        `${result.failed} failed`,
      ].join(", ")

      if (result.failed > 0) {
        toast.error(`PriceLabs sync completed: ${summary}`)
      } else if (result.notFound > 0) {
        toast.warning(`PriceLabs sync completed: ${summary}`)
      } else {
        toast.success(`PriceLabs sync completed: ${summary}`)
      }

      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "PriceLabs sync failed"
      )
    } finally {
      setSyncing(false)
    }
  }

  async function handleSyncReport() {
    setSyncingReport(true)
    try {
      const result = await syncReportBuilderAction()
      if (result.error) {
        toast.error(result.error)
        return
      }
      if (result.status === "completed") {
        toast.success(
          `Report Builder synced: ${result.metricRowCount ?? 0} rows, ${
            result.listingCount ?? 0
          } listings${
            result.unresolvedCount ? `, ${result.unresolvedCount} unresolved` : ""
          }`
        )
        router.refresh()
      } else if (result.status === "polling") {
        toast.info(
          "Report is still generating. Click Sync again in a minute to resume."
        )
      } else {
        toast.warning(result.message ?? "Report Builder sync finished")
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Report Builder sync failed"
      )
    } finally {
      setSyncingReport(false)
    }
  }

  function handleToggleStatus(listing: SettingsListing, nextActive: boolean) {
    const nextStatus = nextActive ? "active" : "inactive"
    startTransition(async () => {
      const result = await updateListingStatusAction(listing.id, nextStatus)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(
          nextActive
            ? `${listing.name} is now visible`
            : `${listing.name} hidden from Clients & Listings`
        )
      }
    })
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {filtered.length} of {listings.length} listing
            {listings.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSync}
              disabled={syncing}
            >
              <RefreshCw
                className={cn("mr-1 size-4", syncing && "animate-spin")}
              />
              {syncing ? "Syncing..." : "Sync PriceLabs"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSyncReport}
              disabled={syncingReport}
            >
              <RefreshCw
                className={cn("mr-1 size-4", syncingReport && "animate-spin")}
              />
              {syncingReport ? "Syncing..." : "Sync Report Builder"}
            </Button>
            <Button size="sm" onClick={handleNew}>
              <Plus className="mr-1 size-4" />
              Add Listing
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-1 border-b">
          {(["active", "inactive", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "relative px-3 py-2 text-sm font-medium capitalize transition-colors",
                statusFilter === s
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="flex items-center gap-1.5">
                {s === "active" && <Eye className="size-3.5" />}
                {s === "inactive" && <EyeOff className="size-3.5" />}
                {s}
                <Badge
                  variant="secondary"
                  className="ml-1 rounded-full px-1.5 text-[10px]"
                >
                  {statusCounts[s]}
                </Badge>
              </span>
              {statusFilter === s && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
              )}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or listing ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {clientNames.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1">
                  Clients
                  {selectedClients.size > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-1 rounded-full px-1.5 text-[10px]"
                    >
                      {selectedClients.size}
                    </Badge>
                  )}
                  <ChevronDown className="size-3.5 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-52 p-2" align="start">
                <div className="max-h-56 space-y-0.5 overflow-y-auto">
                  {clientNames.map((name) => (
                    <button
                      key={name}
                      onClick={() =>
                        toggleFilter(selectedClients, name, setSelectedClients)
                      }
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                    >
                      <div
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                          selectedClients.has(name)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/30"
                        )}
                      >
                        {selectedClients.has(name) && (
                          <Check className="size-3" />
                        )}
                      </div>
                      <span className="truncate">{name}</span>
                    </button>
                  ))}
                </div>
                {selectedClients.size > 0 && (
                  <button
                    onClick={() => setSelectedClients(new Set())}
                    className="mt-2 w-full border-t pt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </PopoverContent>
            </Popover>
          )}

          {states.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1">
                  State
                  {selectedStates.size > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-1 rounded-full px-1.5 text-[10px]"
                    >
                      {selectedStates.size}
                    </Badge>
                  )}
                  <ChevronDown className="size-3.5 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-44 p-2" align="start">
                <div className="max-h-56 space-y-0.5 overflow-y-auto">
                  {states.map((st) => (
                    <button
                      key={st}
                      onClick={() =>
                        toggleFilter(selectedStates, st, setSelectedStates)
                      }
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                    >
                      <div
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                          selectedStates.has(st)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/30"
                        )}
                      >
                        {selectedStates.has(st) && <Check className="size-3" />}
                      </div>
                      <span>{st}</span>
                    </button>
                  ))}
                </div>
                {selectedStates.size > 0 && (
                  <button
                    onClick={() => setSelectedStates(new Set())}
                    className="mt-2 w-full border-t pt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </PopoverContent>
            </Popover>
          )}

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3" />
              Clear all
            </button>
          )}
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table className="w-full table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[25%] min-w-[180px]">Name</TableHead>
                <TableHead className="w-[17%] min-w-[120px]">Client</TableHead>
                <TableHead className="w-[12%] min-w-[100px]">
                  Location
                </TableHead>
                <TableHead className="w-[12%] min-w-[90px]">
                  Listing ID
                </TableHead>
                <TableHead className="w-[16%] min-w-[130px]">
                  PriceLabs Sync
                </TableHead>
                <TableHead className="w-[10%] min-w-[90px]">Status</TableHead>
                <TableHead className="w-[8%] min-w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((listing) => {
                const isActive = listing.status !== "inactive"
                const syncResult = syncResults[listing.id]
                const latestSyncAt =
                  syncResult?.status === "synced"
                    ? syncResult.syncedAt
                    : listing.pl_synced_at
                return (
                  <TableRow
                    key={listing.id}
                    className={cn(!isActive && "opacity-60")}
                  >
                    <TableCell className="truncate font-medium">
                      {listing.name}
                    </TableCell>
                    <TableCell className="truncate text-muted-foreground">
                      {listing.client_name ?? "—"}
                    </TableCell>
                    <TableCell className="truncate text-muted-foreground">
                      {[listing.city, listing.state]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </TableCell>
                    <TableCell className="truncate font-mono text-xs text-muted-foreground">
                      {listing.listing_id ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div
                        className="flex flex-col items-start gap-1"
                        title={syncResult?.error}
                      >
                        {syncResult?.status === "failed" ? (
                          <Badge variant="destructive">Failed</Badge>
                        ) : syncResult?.status === "not_found" ? (
                          <Badge variant="secondary">Not found</Badge>
                        ) : latestSyncAt ? (
                          <Badge variant="outline">Synced</Badge>
                        ) : (
                          <Badge variant="secondary">Never synced</Badge>
                        )}
                        {latestSyncAt && (
                          <span className="text-xs text-muted-foreground">
                            {formatSyncDate(latestSyncAt)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <label className="flex cursor-pointer items-center gap-2">
                        <Switch
                          checked={isActive}
                          onCheckedChange={(checked) =>
                            handleToggleStatus(listing, checked)
                          }
                          aria-label={`Toggle ${listing.name} status`}
                        />
                        <span className="text-xs text-muted-foreground">
                          {isActive ? "Active" : "Hidden"}
                        </span>
                      </label>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => handleEdit(listing)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(listing)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {hasFilters || statusFilter !== "all"
                      ? "No listings match your filters."
                      : "No listings yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <ReportOverrides overrides={overrides} />
      </div>

      <ListingDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        listing={editing}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this listing. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="text-destructive-foreground bg-destructive hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
