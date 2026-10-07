"use client"

import Link from "next/link"
import {
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  ArrowUpDown,
  Ban,
  BookmarkPlus,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Download,
  Hourglass,
  Filter,
  Home,
  Search,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Card, CardContent } from "@/components/ui/card"
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
import { DateRangePicker } from "@/components/date-range-picker"
import {
  dateRangePresetLabel,
  type DateRangePresetKey,
} from "@/lib/date-range-presets"
import {
  currentViewParams,
  sanitizeViewParams,
  viewMatchesParams,
  VIEW_NAME_MAX,
  type ReservationView,
} from "@/lib/reservation-views"
import {
  createReservationView,
  deleteReservationView,
} from "./actions"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type {
  Reservation,
  ReservationDateField,
  ReservationSortField,
  ReservationStats,
} from "@/lib/reservations"

type Filters = {
  clientIds: string[]
  clientExclude?: boolean // true → all clients except clientIds
  listingIds: string[]
  listingExclude?: boolean // true → all listings except listingIds
  bwMin?: number // booking window lower bound, days
  bwMax?: number // booking window upper bound, days
  dateField: ReservationDateField
  range?: DateRangePresetKey // relative preset; when set, from/to are derived
  from?: string
  to?: string
  q?: string
  sort: ReservationSortField
  dir: "asc" | "desc"
}

function formatDateOnly(value: string | null): string {
  if (!value) return "—"
  return new Date(value + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatBookedAt(value: string | null): string {
  if (!value) return "—"
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatCurrency(amount: number | null, currency: string | null): string {
  if (amount == null) return "—"
  return Number(amount).toLocaleString("en-US", {
    style: "currency",
    currency: currency ?? "USD",
    maximumFractionDigits: 0,
  })
}

// "Is / Is not" switch at the top of a filter combobox; "Is not" turns the
// selection into an exclusion (e.g. every client except one).
function ExcludeToggle({
  exclude,
  onChange,
}: {
  exclude: boolean
  onChange: (exclude: boolean) => void
}) {
  return (
    <div className="flex gap-1 border-b p-1.5">
      {[
        { value: false, label: "Is" },
        { value: true, label: "Is not" },
      ].map((option) => (
        <Button
          key={option.label}
          type="button"
          variant={exclude === option.value ? "secondary" : "ghost"}
          size="sm"
          className="h-7 flex-1 text-xs"
          aria-pressed={exclude === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

// Quick picks mirror the client report's booking-window segments
// (lib/reservations-export.ts); "≤ 14" has no lower bound so negative
// windows (post-check-in alterations) land there too, as in the report.
const BOOKING_WINDOW_PRESETS: { label: string; min?: number; max?: number }[] = [
  { label: "0–14 days", max: 14 },
  { label: "15–45 days", min: 15, max: 45 },
  { label: "46–60 days", min: 46, max: 60 },
  { label: "61–120 days", min: 61, max: 120 },
  { label: "120+ days", min: 121 },
]

function bookingWindowLabel(min?: number, max?: number): string | null {
  if (min == null && max == null) return null
  if (min == null) return `≤ ${max} days`
  if (max == null) return `≥ ${min} days`
  return min === max ? `${min} days` : `${min}–${max} days`
}

// Trigger text for a multi-select client/listing filter.
function selectionLabel(
  names: string[],
  exclude: boolean,
  allLabel: string,
  noun: string
): string {
  if (names.length === 0) return allLabel
  const what = names.length === 1 ? names[0] : `${names.length} ${noun}`
  return exclude ? `All except ${what}` : what
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="py-0">
      <CardContent className="px-4 py-3">
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

export function ReservationsView({
  rows,
  count,
  page,
  pageSize,
  stats,
  statsScope,
  filters,
  clients,
  listings,
  views,
  currentUserId,
}: {
  rows: Reservation[]
  count: number
  page: number
  pageSize: number
  stats: ReservationStats
  statsScope: "range" | "last30"
  filters: Filters
  clients: { id: string; name: string }[]
  listings: { id: string; name: string; client_id: string }[]
  views: ReservationView[]
  currentUserId: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [searchInput, setSearchInput] = useState(filters.q ?? "")
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false)
  const [listingPopoverOpen, setListingPopoverOpen] = useState(false)
  // Mode picked before a client/listing is selected; once one is selected
  // the URL (xclient/xlisting) is the source of truth.
  const [clientExcludeDraft, setClientExcludeDraft] = useState(false)
  const [listingExcludeDraft, setListingExcludeDraft] = useState(false)

  // Saved views
  const [savePopoverOpen, setSavePopoverOpen] = useState(false)
  const [viewName, setViewName] = useState("")
  const [savingView, setSavingView] = useState(false)
  const [viewToDelete, setViewToDelete] = useState<ReservationView | null>(null)
  const [deletingView, setDeletingView] = useState(false)

  // Selected ids update optimistically so several picks in a row (popover
  // stays open) build on each other before the server round trip lands.
  const [clientIds, setOptimisticClientIds] = useOptimistic(
    filters.clientIds,
    (_: string[], next: string[]) => next
  )
  const [listingIds, setOptimisticListingIds] = useOptimistic(
    filters.listingIds,
    (_: string[], next: string[]) => next
  )

  function setParams(
    patch: Record<string, string | null>,
    resetPage = true,
    optimistic?: () => void
  ) {
    const params = new URLSearchParams(searchParams.toString())
    if (resetPage) params.delete("page")
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === "") params.delete(key)
      else params.set(key, value)
    }
    const qs = params.toString()
    startTransition(() => {
      optimistic?.()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    })
  }

  // Debounced free-text search → q URL param
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])
  function handleSearchChange(value: string) {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setParams({ q: value.trim() || null })
    }, 350)
  }

  // CSV of the full filtered set (not just the current page) — same
  // searchParams contract, handled by /reservations/export.
  const exportHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("page")
    const qs = params.toString()
    return qs ? `/reservations/export?${qs}` : "/reservations/export"
  }, [searchParams])

  const clientExclude =
    clientIds.length > 0 ? Boolean(filters.clientExclude) : clientExcludeDraft
  const listingExclude =
    listingIds.length > 0 ? Boolean(filters.listingExclude) : listingExcludeDraft

  // Listings that fit a client selection: the picked clients' listings
  // ("is"), or everyone else's ("is not").
  function listingsForClients(ids: string[], exclude: boolean) {
    if (ids.length === 0) return listings
    const set = new Set(ids)
    return listings.filter((l) => set.has(l.client_id) !== exclude)
  }

  // Apply a new client and/or listing selection. Listings that no longer
  // fit the client selection are dropped so they can't linger unseen.
  function applySelection(next: {
    clientIds?: string[]
    clientExclude?: boolean
    listingIds?: string[]
    listingExclude?: boolean
  }) {
    const nextClientIds = next.clientIds ?? clientIds
    const nextClientExclude = next.clientExclude ?? clientExclude
    const fitting = new Set(
      listingsForClients(nextClientIds, nextClientExclude).map((l) => l.id)
    )
    const nextListingIds = (next.listingIds ?? listingIds).filter((id) =>
      fitting.has(id)
    )
    const nextListingExclude = next.listingExclude ?? listingExclude
    setParams(
      {
        client: nextClientIds.join(",") || null,
        xclient: nextClientIds.length > 0 && nextClientExclude ? "1" : null,
        listing: nextListingIds.join(",") || null,
        xlisting: nextListingIds.length > 0 && nextListingExclude ? "1" : null,
      },
      true,
      () => {
        setOptimisticClientIds(nextClientIds)
        setOptimisticListingIds(nextListingIds)
      }
    )
  }

  function toggleId(ids: string[], id: string): string[] {
    return ids.includes(id)
      ? ids.filter((x) => x !== id)
      : [...ids, id].sort()
  }

  function setClientExclude(exclude: boolean) {
    setClientExcludeDraft(exclude)
    if (clientIds.length > 0) applySelection({ clientExclude: exclude })
  }

  function setListingExclude(exclude: boolean) {
    setListingExcludeDraft(exclude)
    if (listingIds.length > 0) applySelection({ listingExclude: exclude })
  }

  const listingOptions = useMemo(
    () => listingsForClients(filters.clientIds, Boolean(filters.clientExclude)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listings, filters.clientIds.join(","), filters.clientExclude]
  )

  const clientNameById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.name])),
    [clients]
  )
  const listingNameById = useMemo(
    () => new Map(listings.map((l) => [l.id, l.name])),
    [listings]
  )
  const selectedClientNames = clientIds.map(
    (id) => clientNameById.get(id) ?? "Unknown client"
  )
  const selectedListingNames = listingIds.map(
    (id) => listingNameById.get(id) ?? "Unknown listing"
  )

  // Booking window popover: draft inputs, applied on submit
  const [bwPopoverOpen, setBwPopoverOpen] = useState(false)
  const [bwMinDraft, setBwMinDraft] = useState("")
  const [bwMaxDraft, setBwMaxDraft] = useState("")
  const bwLabel = bookingWindowLabel(filters.bwMin, filters.bwMax)

  function setBookingWindow(min?: number, max?: number) {
    setParams({
      bwmin: min != null ? String(min) : null,
      bwmax: max != null ? String(max) : null,
    })
    setBwPopoverOpen(false)
  }

  function handleBookingWindowSubmit(event: React.FormEvent) {
    event.preventDefault()
    const parse = (v: string) => {
      const t = v.trim()
      if (!t) return undefined
      const n = Number(t)
      return Number.isInteger(n) && n >= 0 ? n : Number.NaN
    }
    const min = parse(bwMinDraft)
    const max = parse(bwMaxDraft)
    if (Number.isNaN(min) || Number.isNaN(max)) {
      toast.error("Booking window must be whole days (0 or more)")
      return
    }
    if (min != null && max != null && min > max) {
      toast.error("Booking window minimum is above the maximum")
      return
    }
    setBookingWindow(min, max)
  }

  const activeFilters =
    (clientIds.length > 0 ? 1 : 0) +
    (listingIds.length > 0 ? 1 : 0) +
    (filters.bwMin != null || filters.bwMax != null ? 1 : 0) +
    (filters.range || filters.from || filters.to ? 1 : 0) +
    (filters.q ? 1 : 0)

  const activeParams = currentViewParams(filters)
  const activeView = views.find((v) => viewMatchesParams(v, activeParams))

  function applyView(view: ReservationView) {
    const p = sanitizeViewParams(view.params) ?? {}
    setSearchInput(p.q ?? "")
    setParams({
      client: p.client ?? null,
      xclient: p.xclient ?? null,
      listing: p.listing ?? null,
      xlisting: p.xlisting ?? null,
      bwmin: p.bwmin ?? null,
      bwmax: p.bwmax ?? null,
      df: p.df ?? null,
      range: p.range ?? null,
      from: p.from ?? null,
      to: p.to ?? null,
      q: p.q ?? null,
      sort: p.sort ?? null,
      dir: p.dir ?? null,
    })
  }

  async function handleSaveView(event: React.FormEvent) {
    event.preventDefault()
    setSavingView(true)
    const result = await createReservationView(viewName, activeParams)
    setSavingView(false)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    toast.success(`View "${viewName.trim()}" saved`)
    setViewName("")
    setSavePopoverOpen(false)
  }

  async function handleDeleteView() {
    if (!viewToDelete) return
    setDeletingView(true)
    const result = await deleteReservationView(viewToDelete.id)
    setDeletingView(false)
    setViewToDelete(null)
    if (result?.error) toast.error(result.error)
  }

  function toggleSort(field: ReservationSortField) {
    if (filters.sort === field) {
      setParams(
        { sort: field, dir: filters.dir === "desc" ? "asc" : "desc" },
        false
      )
    } else {
      setParams({ sort: field, dir: "desc" }, false)
    }
  }

  function SortHeader({
    field,
    children,
    className,
  }: {
    field: ReservationSortField
    children: React.ReactNode
    className?: string
  }) {
    return (
      <TableHead
        className={cn("cursor-pointer select-none", className)}
        onClick={() => toggleSort(field)}
      >
        <span className="flex items-center gap-1">
          {children}
          <ArrowUpDown
            className={cn(
              "size-3",
              filters.sort === field
                ? "text-foreground"
                : "text-muted-foreground/50"
            )}
          />
        </span>
      </TableHead>
    )
  }

  const totalPages = Math.max(1, Math.ceil(count / pageSize))
  const start = count === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, count)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reservations</h1>
          <p className="text-sm text-muted-foreground">
            {count.toLocaleString("en-US")} reservations
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeFilters > 0 && !activeView && (
            <Popover open={savePopoverOpen} onOpenChange={setSavePopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline">
                  <BookmarkPlus className="size-3.5" />
                  Save view
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3" align="end">
                <form onSubmit={handleSaveView} className="space-y-2">
                  <p className="text-xs font-medium">
                    Save current filters as a shared view
                  </p>
                  <div className="flex gap-1.5">
                    <Input
                      value={viewName}
                      onChange={(e) => setViewName(e.target.value)}
                      placeholder="View name"
                      maxLength={VIEW_NAME_MAX}
                      autoFocus
                      className="h-8"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={savingView || !viewName.trim()}
                    >
                      Save
                    </Button>
                  </div>
                </form>
              </PopoverContent>
            </Popover>
          )}
          <Button variant="outline" asChild>
            <a href={exportHref} download>
              <Download className="size-3.5" />
              Export CSV
            </a>
          </Button>
        </div>
      </div>

      {/* Stats header */}
      <div
        className={cn(
          "space-y-1.5 transition-opacity",
          isPending && "opacity-60"
        )}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="Rental Revenue"
            value={formatCurrency(stats.rentalRevenueUsd, "USD")}
          />
          <StatCard
            label="ADR"
            value={
              stats.adrUsd != null ? formatCurrency(stats.adrUsd, "USD") : "—"
            }
          />
          <StatCard
            label="Avg Booking Window"
            value={
              stats.avgBookingWindowDays != null
                ? `${Math.round(stats.avgBookingWindowDays)}d`
                : "—"
            }
          />
          <StatCard
            label="Nights"
            value={stats.totalNights.toLocaleString("en-US")}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {stats.reservationCount.toLocaleString("en-US")} reservations ·{" "}
          {statsScope === "last30"
            ? "last 30 days by booked date"
            : `${
                filters.range
                  ? dateRangePresetLabel(filters.range).toLowerCase()
                  : `${filters.from ? formatDateOnly(filters.from) : "…"} – ${
                      filters.to ? formatDateOnly(filters.to) : "today"
                    }`
              } by ${filters.dateField === "booked" ? "booked date" : "check-in"}`}
          {stats.nonUsdCount > 0 &&
            ` · revenue & ADR exclude ${stats.nonUsdCount.toLocaleString("en-US")} non-USD reservation${stats.nonUsdCount === 1 ? "" : "s"}`}
        </p>
      </div>

      {/* Saved views */}
      {views.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {views.map((view) => {
            const isActive = activeView?.id === view.id
            const canDelete =
              currentUserId != null && view.created_by === currentUserId
            return (
              <div key={view.id} className="group/view relative">
                <Button
                  variant={isActive ? "secondary" : "outline"}
                  size="sm"
                  className={cn(
                    "h-7 rounded-full px-3 text-xs font-normal",
                    canDelete && "group-hover/view:pr-7"
                  )}
                  onClick={() => applyView(view)}
                >
                  {view.name}
                </Button>
                {canDelete && (
                  <button
                    onClick={() => setViewToDelete(view)}
                    aria-label={`Delete view ${view.name}`}
                    className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full p-0.5 text-muted-foreground transition-colors hover:text-destructive group-hover/view:flex"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Search + Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:flex-1 sm:w-auto sm:min-w-[200px] sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search listing, confirmation..."
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Client combobox (multi-select) */}
        <Popover open={clientPopoverOpen} onOpenChange={setClientPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={clientPopoverOpen}
              className="w-full sm:w-[220px] justify-between font-normal"
            >
              <div className="flex items-center gap-2 truncate">
                {clientIds.length > 0 && clientExclude ? (
                  <Ban className="size-3.5 text-destructive shrink-0" />
                ) : (
                  <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="truncate">
                  {selectionLabel(
                    selectedClientNames,
                    clientExclude,
                    "All clients",
                    "clients"
                  )}
                </span>
              </div>
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[260px] p-0" align="start">
            <ExcludeToggle
              exclude={clientExclude}
              onChange={setClientExclude}
            />
            <Command>
              <CommandInput placeholder="Search clients..." />
              <CommandList>
                <CommandEmpty>No clients found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="all"
                    onSelect={() => {
                      applySelection({ clientIds: [], listingIds: [] })
                      setClientPopoverOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-3.5",
                        clientIds.length === 0 ? "opacity-100" : "opacity-0"
                      )}
                    />
                    All clients
                  </CommandItem>
                  {clients.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={c.name}
                      onSelect={() =>
                        applySelection({ clientIds: toggleId(clientIds, c.id) })
                      }
                    >
                      <Check
                        className={cn(
                          "mr-2 size-3.5",
                          clientIds.includes(c.id) ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="truncate">{c.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Listing combobox (multi-select) */}
        <Popover open={listingPopoverOpen} onOpenChange={setListingPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={listingPopoverOpen}
              className="w-full sm:w-[220px] justify-between font-normal"
            >
              <div className="flex items-center gap-2 truncate">
                {listingIds.length > 0 && listingExclude ? (
                  <Ban className="size-3.5 text-destructive shrink-0" />
                ) : (
                  <Home className="size-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="truncate">
                  {selectionLabel(
                    selectedListingNames,
                    listingExclude,
                    "All listings",
                    "listings"
                  )}
                </span>
              </div>
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0" align="start">
            <ExcludeToggle
              exclude={listingExclude}
              onChange={setListingExclude}
            />
            <Command>
              <CommandInput placeholder="Search listings..." />
              <CommandList>
                <CommandEmpty>No listings found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="all"
                    onSelect={() => {
                      applySelection({ listingIds: [] })
                      setListingPopoverOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-3.5",
                        listingIds.length === 0 ? "opacity-100" : "opacity-0"
                      )}
                    />
                    All listings
                  </CommandItem>
                  {listingOptions.map((l) => (
                    <CommandItem
                      key={l.id}
                      value={`${l.name} ${l.id}`}
                      onSelect={() =>
                        applySelection({ listingIds: toggleId(listingIds, l.id) })
                      }
                    >
                      <Check
                        className={cn(
                          "mr-2 size-3.5",
                          listingIds.includes(l.id) ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="truncate">{l.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Booking window (days between booking and check-in) */}
        <Popover
          open={bwPopoverOpen}
          onOpenChange={(open) => {
            if (open) {
              setBwMinDraft(filters.bwMin != null ? String(filters.bwMin) : "")
              setBwMaxDraft(filters.bwMax != null ? String(filters.bwMax) : "")
            }
            setBwPopoverOpen(open)
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-full sm:w-auto justify-between font-normal"
            >
              <div className="flex items-center gap-2 truncate">
                <Hourglass className="size-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">
                  {bwLabel ? `Booking window: ${bwLabel}` : "Booking window"}
                </span>
              </div>
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[260px] p-3" align="start">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {BOOKING_WINDOW_PRESETS.map((preset) => {
                  const active =
                    filters.bwMin === preset.min && filters.bwMax === preset.max
                  return (
                    <Button
                      key={preset.label}
                      type="button"
                      variant={active ? "secondary" : "outline"}
                      size="sm"
                      className="h-7 px-2.5 text-xs font-normal"
                      onClick={() => setBookingWindow(preset.min, preset.max)}
                    >
                      {preset.label}
                    </Button>
                  )
                })}
              </div>
              <form onSubmit={handleBookingWindowSubmit} className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Custom range (days before check-in)
                </p>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={bwMinDraft}
                    onChange={(e) => setBwMinDraft(e.target.value)}
                    placeholder="Min"
                    aria-label="Minimum booking window in days"
                    className="h-8"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={bwMaxDraft}
                    onChange={(e) => setBwMaxDraft(e.target.value)}
                    placeholder="Max"
                    aria-label="Maximum booking window in days"
                    className="h-8"
                  />
                </div>
                <div className="flex justify-between gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!bwLabel}
                    onClick={() => setBookingWindow()}
                  >
                    Clear
                  </Button>
                  <Button type="submit" size="sm">
                    Apply
                  </Button>
                </div>
              </form>
            </div>
          </PopoverContent>
        </Popover>

        {/* Date range, anchored on check-in or booked date */}
        <div className="flex w-full items-center gap-1.5 sm:w-auto">
          <Select
            value={filters.dateField}
            onValueChange={(value) =>
              setParams({ df: value === "checkin" ? null : value })
            }
          >
            <SelectTrigger
              className="w-[120px]"
              aria-label="Date range field"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="checkin">Check-in</SelectItem>
              <SelectItem value="booked">Booked</SelectItem>
            </SelectContent>
          </Select>
          <DateRangePicker
            preset={filters.range}
            from={filters.from}
            to={filters.to}
            onChange={({ preset, from, to }) =>
              setParams({ range: preset, from, to })
            }
            className="min-w-0 flex-1 sm:flex-initial sm:min-w-[210px]"
          />
        </div>

        {activeFilters > 0 && (
          <button
            onClick={() => {
              setSearchInput("")
              setClientExcludeDraft(false)
              setListingExcludeDraft(false)
              setParams(
                {
                  client: null,
                  xclient: null,
                  listing: null,
                  xlisting: null,
                  bwmin: null,
                  bwmax: null,
                  df: null,
                  range: null,
                  from: null,
                  to: null,
                  q: null,
                },
                true,
                () => {
                  setOptimisticClientIds([])
                  setOptimisticListingIds([])
                }
              )
            }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <Filter className="size-3" />
            Clear filters ({activeFilters})
          </button>
        )}

      </div>

      {/* Table */}
      <div
        className={cn(
          "rounded-md border w-full overflow-x-auto transition-opacity",
          isPending && "opacity-60"
        )}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader field="booked_at">Booked Date</SortHeader>
              <SortHeader field="check_in">Check In</SortHeader>
              <SortHeader field="check_out">Check Out</SortHeader>
              <SortHeader field="number_of_days" className="w-[80px]">
                Nights
              </SortHeader>
              <SortHeader field="booking_window_days" className="w-[110px]">
                Bkg Window
              </SortHeader>
              <TableHead>Listing</TableHead>
              <TableHead>Client</TableHead>
              <SortHeader field="rental_revenue">Rental Revenue</SortHeader>
              <SortHeader field="total_cost">Total Revenue</SortHeader>
              <TableHead className="text-right">ADR</TableHead>
              <TableHead>Channel</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={11}
                  className="text-center text-muted-foreground py-12"
                >
                  No reservations match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.row_key}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatBookedAt(r.booked_at)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateOnly(r.check_in)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateOnly(r.check_out)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.number_of_days ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.booking_window_days != null
                      ? `${r.booking_window_days}d`
                      : "—"}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate">
                    {r.hub_listing_id ? (
                      <Link
                        href={`/listings/${r.hub_listing_id}`}
                        className="hover:underline"
                      >
                        {r.listing_name ?? "—"}
                      </Link>
                    ) : (
                      (r.listing_name ?? "—")
                    )}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate">
                    {r.client_id ? (
                      <Link
                        href={`/clients/${r.client_id}`}
                        className="hover:underline"
                      >
                        {r.client_name ?? "—"}
                      </Link>
                    ) : (
                      (r.client_name ?? "—")
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(r.rental_revenue, r.currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(r.total_cost, r.currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.rental_revenue != null &&
                    r.number_of_days != null &&
                    r.number_of_days > 0
                      ? formatCurrency(
                          r.rental_revenue / r.number_of_days,
                          r.currency
                        )
                      : "—"}
                  </TableCell>
                  <TableCell className="capitalize text-muted-foreground">
                    {r.booking_channel ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {start.toLocaleString("en-US")}–{end.toLocaleString("en-US")}{" "}
          of {count.toLocaleString("en-US")}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || isPending}
            onClick={() => setParams({ page: String(page - 1) }, false)}
          >
            <ChevronLeft className="size-3.5 mr-1" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages.toLocaleString("en-US")}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || isPending}
            onClick={() => setParams({ page: String(page + 1) }, false)}
          >
            Next
            <ChevronRight className="size-3.5 ml-1" />
          </Button>
        </div>
      </div>

      <AlertDialog
        open={viewToDelete != null}
        onOpenChange={(open) => {
          if (!open) setViewToDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete view “{viewToDelete?.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Saved views are shared with the whole team. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteView} disabled={deletingView}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
