"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Users, Building2 } from "lucide-react"
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command"
import {
  commands,
  filterCommandsByPermission,
  type CommandDef,
} from "@/lib/command-registry"
import { createClient } from "@/lib/supabase/client"
import { checkPermission, type Resource } from "@/lib/permissions"
import type { Profile } from "@/lib/supabase/profile"

// ---------------------------------------------------------------------------
// Recent searches (localStorage)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "revfactor-cmd-recent"
const MAX_RECENT = 5

function getRecentIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")
  } catch {
    return []
  }
}

function saveRecentId(id: string) {
  const ids = getRecentIds().filter((i) => i !== id)
  ids.unshift(id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)))
}

// ---------------------------------------------------------------------------
// Dynamic entity search
// ---------------------------------------------------------------------------

type EntityResult = {
  id: string
  label: string
  sublabel?: string
  href: string
  type: "client" | "listing"
}

const DEBOUNCE_MS = 250
const MIN_SEARCH_LENGTH = 2

function hasViewPermission(
  permissionMap: Record<string, boolean>,
  resource: Resource,
  isSuperAdmin: boolean,
): boolean {
  if (isSuperAdmin) return true
  return checkPermission(permissionMap, resource, "view")
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Props = {
  profile: Profile | null
  permissionMap: Record<string, boolean>
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({
  profile,
  permissionMap,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [search, setSearch] = useState("")
  const [recentIds, setRecentIds] = useState<string[]>([])
  const [clients, setClients] = useState<EntityResult[]>([])
  const [listings, setListings] = useState<EntityResult[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  const isSuperAdmin = profile?.role === "super_admin" || false
  const canViewClients = hasViewPermission(permissionMap, "clients", isSuperAdmin)
  const canViewListings = hasViewPermission(permissionMap, "listings", isSuperAdmin)

  // Load recents on mount (avoids hydration mismatch)
  useEffect(() => {
    setRecentIds(getRecentIds())
  }, [])

  // Reset search and results when dialog closes
  useEffect(() => {
    if (!open) {
      setSearch("")
      setClients([])
      setListings([])
    }
  }, [open])

  // Debounced entity search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (search.length < MIN_SEARCH_LENGTH) {
      setClients([])
      setListings([])
      return
    }

    debounceRef.current = setTimeout(async () => {
      const supabase = createClient()
      const term = `%${search}%`

      const [clientRes, listingRes] = await Promise.all([
        canViewClients
          ? supabase
              .from("clients")
              .select("id, name, email, status")
              .or(`name.ilike.${term},email.ilike.${term}`)
              .limit(5)
          : Promise.resolve({ data: null }),
        canViewListings
          ? supabase
              .from("listings")
              .select("id, name, city, state, clients(name)")
              .ilike("name", term)
              .limit(5)
          : Promise.resolve({ data: null }),
      ])

      if (clientRes.data) {
        setClients(
          clientRes.data.map((c: { id: string; name: string; email: string | null; status: string }) => ({
            id: c.id,
            label: c.name,
            sublabel: [c.email, c.status].filter(Boolean).join(" · "),
            href: `/clients/${c.id}`,
            type: "client" as const,
          })),
        )
      }

      if (listingRes.data) {
        setListings(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          listingRes.data.map((l: any) => {
            const clientName = Array.isArray(l.clients) ? l.clients[0]?.name : l.clients?.name
            return {
              id: l.id,
              label: l.name,
              sublabel: [clientName, [l.city, l.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
              href: `/listings/${l.id}`,
              type: "listing" as const,
            }
          }),
        )
      }
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search, canViewClients, canViewListings])

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, onOpenChange])

  // Permission-filtered commands
  const visibleCommands = useMemo(
    () => filterCommandsByPermission(commands, permissionMap, isSuperAdmin),
    [permissionMap, isSuperAdmin],
  )

  // Group by category
  const pages = useMemo(() => visibleCommands.filter((c) => c.category === "pages"), [visibleCommands])
  const actions = useMemo(() => visibleCommands.filter((c) => c.category === "actions"), [visibleCommands])
  const settings = useMemo(() => visibleCommands.filter((c) => c.category === "settings"), [visibleCommands])

  // Context-suggested commands (only when search is empty)
  const suggested = useMemo(() => {
    if (search) return []
    return visibleCommands.filter((cmd) =>
      cmd.contextRoutes?.some((route) => pathname.startsWith(route)),
    )
  }, [visibleCommands, pathname, search])

  // Recent commands (only when search is empty)
  const recents = useMemo(() => {
    if (search) return []
    return recentIds
      .map((id) => visibleCommands.find((c) => c.id === id))
      .filter((c): c is CommandDef => c != null)
  }, [recentIds, visibleCommands, search])

  const handleSelect = useCallback(
    (cmd: CommandDef) => {
      saveRecentId(cmd.id)
      setRecentIds(getRecentIds())
      onOpenChange(false)
      if (cmd.href) router.push(cmd.href)
    },
    [router, onOpenChange],
  )

  const handleEntitySelect = useCallback(
    (entity: EntityResult) => {
      saveRecentId(entity.id)
      setRecentIds(getRecentIds())
      onOpenChange(false)
      router.push(entity.href)
    },
    [router, onOpenChange],
  )

  function renderItem(cmd: CommandDef) {
    return (
      <CommandItem
        key={cmd.id}
        value={`${cmd.label} ${cmd.keywords?.join(" ") ?? ""}`}
        onSelect={() => handleSelect(cmd)}
      >
        <cmd.icon className="mr-2 size-4 shrink-0 opacity-60" />
        <span>{cmd.label}</span>
      </CommandItem>
    )
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command className="rounded-4xl">
        <CommandInput
          placeholder="Type a command or search..."
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {suggested.length > 0 && (
            <CommandGroup heading="Suggested">
              {suggested.map(renderItem)}
            </CommandGroup>
          )}

          {recents.length > 0 && (
            <CommandGroup heading="Recent">
              {recents.map(renderItem)}
            </CommandGroup>
          )}

          {pages.length > 0 && (
            <CommandGroup heading="Pages">
              {pages.map(renderItem)}
            </CommandGroup>
          )}

          {actions.length > 0 && (
            <CommandGroup heading="Actions">
              {actions.map(renderItem)}
            </CommandGroup>
          )}

          {settings.length > 0 && (
            <CommandGroup heading="Settings">
              {settings.map(renderItem)}
            </CommandGroup>
          )}

          {clients.length > 0 && (
            <CommandGroup heading="Clients">
              {clients.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.label} ${c.sublabel ?? ""}`}
                  onSelect={() => handleEntitySelect(c)}
                >
                  <Users className="mr-2 size-4 shrink-0 opacity-60" />
                  <div className="flex flex-col">
                    <span>{c.label}</span>
                    {c.sublabel && (
                      <span className="text-xs text-muted-foreground">{c.sublabel}</span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {listings.length > 0 && (
            <CommandGroup heading="Listings">
              {listings.map((l) => (
                <CommandItem
                  key={l.id}
                  value={`${l.label} ${l.sublabel ?? ""}`}
                  onSelect={() => handleEntitySelect(l)}
                >
                  <Building2 className="mr-2 size-4 shrink-0 opacity-60" />
                  <div className="flex flex-col">
                    <span>{l.label}</span>
                    {l.sublabel && (
                      <span className="text-xs text-muted-foreground">{l.sublabel}</span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
