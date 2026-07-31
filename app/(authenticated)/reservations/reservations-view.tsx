"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  ArrowUpDown,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Filter,
  Home,
  Search,
} from "lucide-react"
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
import { cn } from "@/lib/utils"
import type { Reservation, ReservationSortField } from "@/lib/reservations"

type Filters = {
  clientId?: string
  listingId?: string
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

export function ReservationsView({
  rows,
  count,
  page,
  pageSize,
  filters,
  clients,
  listings,
}: {
  rows: Reservation[]
  count: number
  page: number
  pageSize: number
  filters: Filters
  clients: { id: string; name: string }[]
  listings: { id: string; name: string; client_id: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [searchInput, setSearchInput] = useState(filters.q ?? "")
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false)
  const [listingPopoverOpen, setListingPopoverOpen] = useState(false)

  function setParams(patch: Record<string, string | null>, resetPage = true) {
    const params = new URLSearchParams(searchParams.toString())
    if (resetPage) params.delete("page")
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === "") params.delete(key)
      else params.set(key, value)
    }
    const qs = params.toString()
    startTransition(() => {
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

  const listingOptions = useMemo(
    () =>
      filters.clientId
        ? listings.filter((l) => l.client_id === filters.clientId)
        : listings,
    [listings, filters.clientId]
  )

  const selectedClient = clients.find((c) => c.id === filters.clientId)
  const selectedListing = listings.find((l) => l.id === filters.listingId)

  const activeFilters =
    (filters.clientId ? 1 : 0) +
    (filters.listingId ? 1 : 0) +
    (filters.from ? 1 : 0) +
    (filters.to ? 1 : 0) +
    (filters.q ? 1 : 0)

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reservations</h1>
        <p className="text-sm text-muted-foreground">
          {count.toLocaleString("en-US")} reservations
        </p>
      </div>

      {/* Search + Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search guest, listing, confirmation..."
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Client combobox */}
        <Popover open={clientPopoverOpen} onOpenChange={setClientPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={clientPopoverOpen}
              className="w-[220px] justify-between font-normal"
            >
              <div className="flex items-center gap-2 truncate">
                <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">
                  {selectedClient?.name ?? "All clients"}
                </span>
              </div>
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[260px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search clients..." />
              <CommandList>
                <CommandEmpty>No clients found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="all"
                    onSelect={() => {
                      setParams({ client: null, listing: null })
                      setClientPopoverOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-3.5",
                        !filters.clientId ? "opacity-100" : "opacity-0"
                      )}
                    />
                    All clients
                  </CommandItem>
                  {clients.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={c.name}
                      onSelect={() => {
                        // changing client invalidates a listing filter from another client
                        setParams({ client: c.id, listing: null })
                        setClientPopoverOpen(false)
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 size-3.5",
                          filters.clientId === c.id
                            ? "opacity-100"
                            : "opacity-0"
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

        {/* Listing combobox */}
        <Popover open={listingPopoverOpen} onOpenChange={setListingPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={listingPopoverOpen}
              className="w-[220px] justify-between font-normal"
            >
              <div className="flex items-center gap-2 truncate">
                <Home className="size-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">
                  {selectedListing?.name ?? "All listings"}
                </span>
              </div>
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search listings..." />
              <CommandList>
                <CommandEmpty>No listings found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="all"
                    onSelect={() => {
                      setParams({ listing: null })
                      setListingPopoverOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-3.5",
                        !filters.listingId ? "opacity-100" : "opacity-0"
                      )}
                    />
                    All listings
                  </CommandItem>
                  {listingOptions.map((l) => (
                    <CommandItem
                      key={l.id}
                      value={l.name}
                      onSelect={() => {
                        setParams({ listing: l.id })
                        setListingPopoverOpen(false)
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 size-3.5",
                          filters.listingId === l.id
                            ? "opacity-100"
                            : "opacity-0"
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

        {/* Check-in date range */}
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={filters.from ?? ""}
            onChange={(e) => setParams({ from: e.target.value || null })}
            className="w-[150px]"
            aria-label="Check-in from"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={filters.to ?? ""}
            onChange={(e) => setParams({ to: e.target.value || null })}
            className="w-[150px]"
            aria-label="Check-in to"
          />
        </div>

        {activeFilters > 0 && (
          <button
            onClick={() => {
              setSearchInput("")
              setParams({
                client: null,
                listing: null,
                from: null,
                to: null,
                q: null,
              })
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
              <TableHead>Guest</TableHead>
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
                  colSpan={12}
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
                  <TableCell className="max-w-[160px] truncate">
                    {r.guest_name ?? "—"}
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
    </div>
  )
}
