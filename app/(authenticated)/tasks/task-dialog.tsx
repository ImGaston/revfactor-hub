"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { createTask } from "./actions"
import type { OwnerOption } from "./tasks-board"

type ClientWithListings = {
  id: string
  name: string
  listings: { id: string; name: string }[]
}

type TaskDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultStatus: string
  clients: ClientWithListings[]
  owners: OwnerOption[]
  tags: string[]
}

export function TaskDialog({
  open,
  onOpenChange,
  defaultStatus,
  clients,
  owners,
  tags,
}: TaskDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [clientId, setClientId] = useState("")
  const [clientOpen, setClientOpen] = useState(false)
  const [selectedListings, setSelectedListings] = useState<Set<string>>(
    new Set()
  )
  const router = useRouter()

  const selectedClient = clients.find((c) => c.id === clientId)
  const clientListings = selectedClient?.listings ?? []

  function handleClientChange(id: string) {
    setClientId(id)
    setSelectedListings(new Set())
  }

  function toggleListing(listingId: string) {
    setSelectedListings((prev) => {
      const next = new Set(prev)
      if (next.has(listingId)) next.delete(listingId)
      else next.add(listingId)
      return next
    })
  }

  function toggleAllListings() {
    if (selectedListings.size === clientListings.length) {
      setSelectedListings(new Set())
    } else {
      setSelectedListings(new Set(clientListings.map((l) => l.id)))
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError("")

    const formData = new FormData(e.currentTarget)
    formData.set("client_id", clientId)
    formData.set("listing_ids", JSON.stringify(Array.from(selectedListings)))
    formData.set("status", defaultStatus)

    const result = await createTask(formData)
    setLoading(false)

    if (result.error) {
      setError(result.error)
    } else {
      onOpenChange(false)
      setClientId("")
      setSelectedListings(new Set())
      router.refresh()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" rows={2} />
          </div>

          <div className="space-y-2">
            <Label>Client</Label>
            <Popover open={clientOpen} onOpenChange={setClientOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between font-normal"
                >
                  {selectedClient?.name ?? "Select client..."}
                  <ChevronsUpDown className="ml-2 size-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                  <CommandInput placeholder="Search client..." />
                  <CommandList>
                    <CommandEmpty>No client found.</CommandEmpty>
                    <CommandGroup>
                      {clients.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={c.name}
                          onSelect={() => {
                            handleClientChange(c.id)
                            setClientOpen(false)
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 size-4",
                              clientId === c.id
                                ? "opacity-100"
                                : "opacity-0"
                            )}
                          />
                          {c.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {clientListings.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Listings</Label>
                <button
                  type="button"
                  onClick={toggleAllListings}
                  className="text-xs text-primary hover:underline"
                >
                  {selectedListings.size === clientListings.length
                    ? "Deselect all"
                    : "Select all"}
                </button>
              </div>
              <ScrollArea className="max-h-36 rounded-md border p-2">
                <div className="space-y-1.5">
                  {clientListings.map((listing) => (
                    <label
                      key={listing.id}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedListings.has(listing.id)}
                        onCheckedChange={() => toggleListing(listing.id)}
                      />
                      <span className="truncate">{listing.name}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="owner">Owner</Label>
              <Select name="owner">
                <SelectTrigger>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {owners.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tag">Tag</Label>
              <Select name="tag">
                <SelectTrigger>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {tags.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating..." : "Create Task"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
