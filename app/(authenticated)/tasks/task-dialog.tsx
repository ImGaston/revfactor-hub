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
import { Badge } from "@/components/ui/badge"
import { Check, ChevronsUpDown, Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { createTask, updateTask } from "./actions"
import type { OwnerOption } from "./tasks-board"
import type { Task } from "@/lib/types"

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
  task?: Task | null
}

export function TaskDialog({
  open,
  onOpenChange,
  defaultStatus,
  clients,
  owners,
  tags,
  task,
}: TaskDialogProps) {
  const isEdit = !!task
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [clientId, setClientId] = useState(task?.client_id ?? "")
  const [clientOpen, setClientOpen] = useState(false)
  const [selectedListings, setSelectedListings] = useState<Set<string>>(
    () => new Set(task?.task_listings?.map((tl) => tl.listing_id) ?? [])
  )
  const [selectedTags, setSelectedTags] = useState<string[]>(task?.tags ?? [])
  const [availableTags, setAvailableTags] = useState<string[]>(() =>
    Array.from(new Set([...tags, ...(task?.tags ?? [])])).sort((a, b) =>
      a.localeCompare(b)
    )
  )
  const [tagOpen, setTagOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState("")
  const router = useRouter()

  // Reset form when task changes (open for different task or new)
  const [prevTaskId, setPrevTaskId] = useState(task?.id)
  if (task?.id !== prevTaskId) {
    setPrevTaskId(task?.id)
    setClientId(task?.client_id ?? "")
    setSelectedListings(new Set(task?.task_listings?.map((tl) => tl.listing_id) ?? []))
    setSelectedTags(task?.tags ?? [])
    setAvailableTags(
      Array.from(new Set([...tags, ...(task?.tags ?? [])])).sort((a, b) =>
        a.localeCompare(b)
      )
    )
    setTagQuery("")
    setError("")
  }
  if (!task && prevTaskId) {
    setPrevTaskId(undefined)
    setClientId("")
    setSelectedListings(new Set())
    setSelectedTags([])
    setAvailableTags([...tags].sort((a, b) => a.localeCompare(b)))
    setTagQuery("")
    setError("")
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  function createTag() {
    const trimmed = tagQuery.trim()
    if (!trimmed) return
    const exists = availableTags.find(
      (t) => t.toLowerCase() === trimmed.toLowerCase()
    )
    const canonical = exists ?? trimmed
    if (!exists) {
      setAvailableTags((prev) =>
        [...prev, trimmed].sort((a, b) => a.localeCompare(b))
      )
    }
    if (!selectedTags.includes(canonical)) {
      setSelectedTags((prev) => [...prev, canonical])
    }
    setTagQuery("")
  }

  const trimmedQuery = tagQuery.trim()
  const canCreate =
    trimmedQuery.length > 0 &&
    !availableTags.some(
      (t) => t.toLowerCase() === trimmedQuery.toLowerCase()
    )

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
    formData.set("tags", JSON.stringify(selectedTags))
    formData.set("status", isEdit ? (task.status ?? defaultStatus) : defaultStatus)

    const result = isEdit
      ? await updateTask(task.id, formData)
      : await createTask(formData)
    setLoading(false)

    if (result.error) {
      setError(result.error)
    } else {
      onOpenChange(false)
      if (!isEdit) {
        setClientId("")
        setSelectedListings(new Set())
      }
      router.refresh()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Task" : "New Task"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required defaultValue={task?.title ?? ""} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" rows={2} defaultValue={task?.description ?? ""} />
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

          <div className="space-y-2">
            <Label htmlFor="owner">Owner</Label>
            <Select name="owner" defaultValue={task?.owner ?? undefined}>
              <SelectTrigger className="w-full">
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
            <Label>Tags</Label>
            <Popover open={tagOpen} onOpenChange={setTagOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1.5 text-left text-sm shadow-xs transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {selectedTags.length === 0 ? (
                    <span className="text-muted-foreground px-1">
                      Add tags...
                    </span>
                  ) : (
                    selectedTags.map((t) => (
                      <Badge
                        key={t}
                        variant="secondary"
                        className="gap-1 pl-2 pr-1 font-normal"
                      >
                        {t}
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            toggleTag(t)
                          }}
                          className="flex size-4 items-center justify-center rounded-sm hover:bg-muted-foreground/20"
                        >
                          <X className="size-3" />
                        </span>
                      </Badge>
                    ))
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[--radix-popover-trigger-width] p-0"
                align="start"
              >
                <Command>
                  <CommandInput
                    placeholder="Search or create tag..."
                    value={tagQuery}
                    onValueChange={setTagQuery}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canCreate) {
                        e.preventDefault()
                        createTag()
                      }
                    }}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {canCreate ? (
                        <button
                          type="button"
                          onClick={createTag}
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-accent"
                        >
                          <Plus className="size-4" />
                          Create &quot;{trimmedQuery}&quot;
                        </button>
                      ) : (
                        "No tags yet."
                      )}
                    </CommandEmpty>
                    {availableTags.length > 0 && (
                      <CommandGroup heading="Tags">
                        {availableTags.map((t) => {
                          const selected = selectedTags.includes(t)
                          return (
                            <CommandItem
                              key={t}
                              value={t}
                              onSelect={() => toggleTag(t)}
                            >
                              <Check
                                className={cn(
                                  "mr-2 size-4",
                                  selected ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {t}
                            </CommandItem>
                          )
                        })}
                      </CommandGroup>
                    )}
                    {canCreate && availableTags.length > 0 && (
                      <CommandGroup>
                        <CommandItem
                          value={`__create__${trimmedQuery}`}
                          onSelect={createTag}
                          className="text-primary"
                        >
                          <Plus className="mr-2 size-4" />
                          Create &quot;{trimmedQuery}&quot;
                        </CommandItem>
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (isEdit ? "Saving..." : "Creating...") : (isEdit ? "Save Changes" : "Create Task")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
