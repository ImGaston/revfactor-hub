"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Search,
  ArrowUpDown,
  ExternalLink,
  MapPin,
  Building2,
  Filter,
  Check,
  ChevronsUpDown,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ListingDialog } from "@/app/(authenticated)/settings/listings/listing-dialog"
import { deleteListingAction } from "@/app/(authenticated)/settings/listings/actions"

export type FlatListing = {
  id: string
  name: string
  listing_id: string | null
  pricelabs_link: string | null
  airbnb_link: string | null
  city: string | null
  state: string | null
  client_id: string
  client_name: string | null
  client_status: string | null
}

type ListingFormData = {
  id?: string
  client_id: string
  name: string
  listing_id: string | null
  pricelabs_link: string | null
  airbnb_link: string | null
  city: string | null
  state: string | null
}

type ClientOption = { id: string; name: string }

type SortField = "name" | "client_name" | "city" | "state"
type SortDir = "asc" | "desc"

const clientStatusColor: Record<string, string> = {
  active:
    "bg-green-500/10 text-green-700 border-green-300 dark:text-green-400 dark:border-green-700",
  onboarding:
    "bg-blue-500/10 text-blue-700 border-blue-300 dark:text-blue-400 dark:border-blue-700",
  inactive: "bg-muted text-muted-foreground border-border",
}

export function ListingsView({
  listings,
  clients: allClients,
  canEdit,
  canDelete,
}: {
  listings: FlatListing[]
  clients: ClientOption[]
  canEdit: boolean
  canDelete: boolean
}) {
  const [search, setSearch] = useState("")
  const [locationFilter, setLocationFilter] = useState<string>("all")
  const [clientFilter, setClientFilter] = useState<string>("all")
  const [sortField, setSortField] = useState<SortField>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false)
  const [editingListing, setEditingListing] = useState<ListingFormData | null>(
    null
  )
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FlatListing | null>(null)
  const [deleting, setDeleting] = useState(false)
  const router = useRouter()

  const showActions = canEdit || canDelete

  function handleEdit(listing: FlatListing) {
    setEditingListing({
      id: listing.id,
      client_id: listing.client_id,
      name: listing.name,
      listing_id: listing.listing_id,
      pricelabs_link: listing.pricelabs_link,
      airbnb_link: listing.airbnb_link,
      city: listing.city,
      state: listing.state,
    })
    setDialogOpen(true)
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const result = await deleteListingAction(deleteTarget.id)
    setDeleting(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Listing deleted")
      setDeleteTarget(null)
      router.refresh()
    }
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDir("asc")
    }
  }

  // Unique locations (state) for filter
  const locations = useMemo(() => {
    const states = new Map<string, number>()
    for (const l of listings) {
      if (l.state) {
        states.set(l.state, (states.get(l.state) ?? 0) + 1)
      }
    }
    return Array.from(states.entries())
      .sort(([a], [b]) => a.localeCompare(b))
  }, [listings])

  // Unique clients for filter
  const clients = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>()
    for (const l of listings) {
      if (l.client_id && l.client_name) {
        const existing = map.get(l.client_id)
        if (existing) {
          existing.count++
        } else {
          map.set(l.client_id, { name: l.client_name, count: 1 })
        }
      }
    }
    return Array.from(map.entries())
      .sort(([, a], [, b]) => a.name.localeCompare(b.name))
  }, [listings])

  const filtered = useMemo(() => {
    let result = listings

    if (locationFilter !== "all") {
      result = result.filter((l) => l.state === locationFilter)
    }

    if (clientFilter !== "all") {
      result = result.filter((l) => l.client_id === clientFilter)
    }

    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          (l.client_name?.toLowerCase().includes(q) ?? false) ||
          (l.city?.toLowerCase().includes(q) ?? false) ||
          (l.state?.toLowerCase().includes(q) ?? false) ||
          (l.listing_id?.toLowerCase().includes(q) ?? false)
      )
    }

    result = [...result].sort((a, b) => {
      const aVal = a[sortField] ?? ""
      const bVal = b[sortField] ?? ""
      const cmp = String(aVal).localeCompare(String(bVal))
      return sortDir === "asc" ? cmp : -cmp
    })

    return result
  }, [listings, search, locationFilter, clientFilter, sortField, sortDir])

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

  const activeFilters =
    (locationFilter !== "all" ? 1 : 0) + (clientFilter !== "all" ? 1 : 0)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Listings</h1>
        <p className="text-sm text-muted-foreground">
          {filtered.length} of {listings.length} listings
        </p>
      </div>

      {/* Search + Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search listings..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* State dropdown */}
        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger className="w-[180px]">
            <div className="flex items-center gap-2">
              <MapPin className="size-3.5 text-muted-foreground" />
              <SelectValue placeholder="All states" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {locations.map(([state, count]) => (
              <SelectItem key={state} value={state}>
                {state} ({count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Client combobox (searchable) */}
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
                  {clientFilter !== "all"
                    ? clients.find(([id]) => id === clientFilter)?.[1].name ?? "All clients"
                    : "All clients"}
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
                      setClientFilter("all")
                      setClientPopoverOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-3.5",
                        clientFilter === "all" ? "opacity-100" : "opacity-0"
                      )}
                    />
                    All clients
                  </CommandItem>
                  {clients.map(([id, { name, count }]) => (
                    <CommandItem
                      key={id}
                      value={name}
                      onSelect={() => {
                        setClientFilter(id)
                        setClientPopoverOpen(false)
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 size-3.5",
                          clientFilter === id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="truncate">{name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {count}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {activeFilters > 0 && (
          <button
            onClick={() => {
              setLocationFilter("all")
              setClientFilter("all")
            }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <Filter className="size-3" />
            Clear filters ({activeFilters})
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader field="name">Listing</SortHeader>
              <SortHeader field="client_name">Client</SortHeader>
              <SortHeader field="city">City</SortHeader>
              <SortHeader field="state">State</SortHeader>
              <TableHead>Airbnb</TableHead>
              <TableHead>PriceLabs</TableHead>
              {showActions && <TableHead className="w-[60px]"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={showActions ? 7 : 6}
                  className="text-center text-muted-foreground py-12"
                >
                  No listings found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((listing) => (
                <TableRow
                  key={listing.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/listings/${listing.id}`)}
                >
                  <TableCell>
                    <div>
                      <p className="font-medium">{listing.name}</p>
                      {listing.listing_id && (
                        <p className="text-xs text-muted-foreground font-mono">
                          ID: {listing.listing_id}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {listing.client_name ? (
                      <div className="flex items-center gap-2">
                        <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm">{listing.client_name}</span>
                        {listing.client_status && (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[9px] capitalize",
                              clientStatusColor[listing.client_status] ?? ""
                            )}
                          >
                            {listing.client_status}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {listing.city ? (
                      <span className="flex items-center gap-1.5 text-sm">
                        <MapPin className="size-3.5 text-muted-foreground shrink-0" />
                        {listing.city}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {listing.state ?? "—"}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {listing.airbnb_link ? (
                      <a
                        href={listing.airbnb_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        <ExternalLink className="size-3.5" />
                        View
                      </a>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {listing.pricelabs_link ? (
                      <a
                        href={listing.pricelabs_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        <ExternalLink className="size-3.5" />
                        View
                      </a>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {showActions && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label="Listing actions"
                          >
                            <MoreVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canEdit && (
                            <DropdownMenuItem
                              onSelect={() => handleEdit(listing)}
                            >
                              <Pencil className="mr-2 size-4" />
                              Edit
                            </DropdownMenuItem>
                          )}
                          {canDelete && (
                            <DropdownMenuItem
                              onSelect={() => setDeleteTarget(listing)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 size-4" />
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {canEdit && (
        <ListingDialog
          key={editingListing?.id ?? "new"}
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) setEditingListing(null)
          }}
          listing={editingListing ?? undefined}
          clients={allClients}
        />
      )}

      {canDelete && (
        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete listing?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget?.name
                  ? `"${deleteTarget.name}" will be permanently removed. This cannot be undone.`
                  : "This listing will be permanently removed. This cannot be undone."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault()
                  handleConfirmDelete()
                }}
                disabled={deleting}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {deleting ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}
