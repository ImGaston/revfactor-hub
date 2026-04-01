"use client"

import { useState, useMemo } from "react"
import { Plus, Pencil, Trash2, Search, X, ChevronDown, Check } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
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
import { deleteListingAction } from "./actions"

type SettingsListing = {
  id: string
  name: string
  listing_id: string | null
  pricelabs_link: string | null
  airbnb_link: string | null
  city: string | null
  state: string | null
  client_id: string
  client_name: string | null
}

type ClientOption = { id: string; name: string }

export function ListingsSettings({
  listings,
  clients,
}: {
  listings: SettingsListing[]
  clients: ClientOption[]
}) {
  const [search, setSearch] = useState("")
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set())
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SettingsListing | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<SettingsListing | null>(null)
  const [deleting, setDeleting] = useState(false)

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
      if (q && !l.name.toLowerCase().includes(q) && !l.listing_id?.toLowerCase().includes(q)) return false
      if (selectedClients.size > 0 && (!l.client_name || !selectedClients.has(l.client_name))) return false
      if (selectedStates.size > 0 && (!l.state || !selectedStates.has(l.state))) return false
      return true
    })
  }, [listings, search, selectedClients, selectedStates])

  function toggleFilter(set: Set<string>, value: string, setter: (s: Set<string>) => void) {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setter(next)
  }

  const hasFilters = search || selectedClients.size > 0 || selectedStates.size > 0

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

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {filtered.length} of {listings.length} listing{listings.length !== 1 ? "s" : ""}
          </p>
          <Button size="sm" onClick={handleNew}>
            <Plus className="mr-1 size-4" />
            Add Listing
          </Button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
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
                    <Badge variant="secondary" className="ml-1 rounded-full px-1.5 text-[10px]">
                      {selectedClients.size}
                    </Badge>
                  )}
                  <ChevronDown className="size-3.5 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-52 p-2" align="start">
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {clientNames.map((name) => (
                    <button
                      key={name}
                      onClick={() => toggleFilter(selectedClients, name, setSelectedClients)}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                    >
                      <div className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                        selectedClients.has(name)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/30"
                      )}>
                        {selectedClients.has(name) && <Check className="size-3" />}
                      </div>
                      <span className="truncate">{name}</span>
                    </button>
                  ))}
                </div>
                {selectedClients.size > 0 && (
                  <button
                    onClick={() => setSelectedClients(new Set())}
                    className="mt-2 w-full border-t pt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
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
                    <Badge variant="secondary" className="ml-1 rounded-full px-1.5 text-[10px]">
                      {selectedStates.size}
                    </Badge>
                  )}
                  <ChevronDown className="size-3.5 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-44 p-2" align="start">
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {states.map((st) => (
                    <button
                      key={st}
                      onClick={() => toggleFilter(selectedStates, st, setSelectedStates)}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                    >
                      <div className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                        selectedStates.has(st)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/30"
                      )}>
                        {selectedStates.has(st) && <Check className="size-3" />}
                      </div>
                      <span>{st}</span>
                    </button>
                  ))}
                </div>
                {selectedStates.size > 0 && (
                  <button
                    onClick={() => setSelectedStates(new Set())}
                    className="mt-2 w-full border-t pt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
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
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-3" />
              Clear all
            </button>
          )}
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Listing ID</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((listing) => (
                <TableRow key={listing.id}>
                  <TableCell className="font-medium">{listing.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {listing.client_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {[listing.city, listing.state].filter(Boolean).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {listing.listing_id ?? "—"}
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
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    {hasFilters ? "No listings match your filters." : "No listings yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <ListingDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        listing={editing}
        clients={clients}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this listing. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
