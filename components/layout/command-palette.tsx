"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Users, Building2, ArrowUp, ArrowDown, CornerDownLeft } from "lucide-react"
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
  CommandSeparator,
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
// Entity types + preloading
// ---------------------------------------------------------------------------

type EntityResult = {
  id: string
  label: string
  sublabel?: string
  href: string
  type: "client" | "listing"
}

function hasViewPermission(
  permissionMap: Record<string, boolean>,
  resource: Resource,
  isSuperAdmin: boolean,
): boolean {
  if (isSuperAdmin) return true
  return checkPermission(permissionMap, resource, "view")
}

function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  return lower.includes(q)
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

  // Preloaded entity data
  const [allClients, setAllClients] = useState<EntityResult[]>([])
  const [allListings, setAllListings] = useState<EntityResult[]>([])
  const loadedRef = useRef(false)

  const isSuperAdmin = profile?.role === "super_admin" || false
  const canViewClients = hasViewPermission(permissionMap, "clients", isSuperAdmin)
  const canViewListings = hasViewPermission(permissionMap, "listings", isSuperAdmin)

  // Load recents on mount (avoids hydration mismatch)
  useEffect(() => {
    setRecentIds(getRecentIds())
  }, [])

  // Reset search when dialog closes
  useEffect(() => {
    if (!open) setSearch("")
  }, [open])

  // Preload clients + listings when palette opens
  useEffect(() => {
    if (!open || loadedRef.current) return

    async function load() {
      const supabase = createClient()

      const [clientRes, listingRes] = await Promise.all([
        canViewClients
          ? supabase.from("clients").select("id, name, email, status").order("name")
          : Promise.resolve({ data: null }),
        canViewListings
          ? supabase.from("listings").select("id, name, city, state, clients(name)").order("name")
          : Promise.resolve({ data: null }),
      ])

      if (clientRes.data) {
        setAllClients(
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
        setAllListings(
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

      loadedRef.current = true
    }

    load()
  }, [open, canViewClients, canViewListings])

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

  // Client-side filtered entities (instant)
  const filteredClients = useMemo(() => {
    if (search.length < 2) return []
    return allClients
      .filter((c) => fuzzyMatch(c.label, search) || fuzzyMatch(c.sublabel ?? "", search))
      .slice(0, 6)
  }, [search, allClients])

  const filteredListings = useMemo(() => {
    if (search.length < 2) return []
    return allListings
      .filter((l) => fuzzyMatch(l.label, search) || fuzzyMatch(l.sublabel ?? "", search))
      .slice(0, 6)
  }, [search, allListings])

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

  function renderEntity(entity: EntityResult, icon: React.ReactNode) {
    return (
      <CommandItem
        key={entity.id}
        value={`${entity.label} ${entity.sublabel ?? ""}`}
        onSelect={() => handleEntitySelect(entity)}
      >
        {icon}
        <div className="flex flex-col gap-0.5">
          <span>{entity.label}</span>
          {entity.sublabel && (
            <span className="text-xs text-muted-foreground">{entity.sublabel}</span>
          )}
        </div>
      </CommandItem>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-2xl! top-[25%]"
    >
      <Command className="rounded-4xl" shouldFilter={search.length < 2}>
        <CommandInput
          placeholder="Search clients, listings, or type a command..."
          value={search}
          onValueChange={setSearch}
          className="text-base"
        />
        <CommandList className="max-h-[400px]">
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

          {filteredClients.length > 0 && (
            <CommandGroup heading="Clients">
              {filteredClients.map((c) =>
                renderEntity(c, <Users className="mr-2 size-4 shrink-0 opacity-60" />),
              )}
            </CommandGroup>
          )}

          {filteredListings.length > 0 && (
            <CommandGroup heading="Listings">
              {filteredListings.map((l) =>
                renderEntity(l, <Building2 className="mr-2 size-4 shrink-0 opacity-60" />),
              )}
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
        </CommandList>

        <CommandSeparator />
        <div className="flex items-center gap-4 px-4 py-2.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ArrowUp className="size-3" />
            <ArrowDown className="size-3" />
            <span>to navigate</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="size-3" />
            <span>to select</span>
          </span>
          <span className="ml-auto">
            Press <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">esc</kbd> to close
          </span>
        </div>
      </Command>
    </CommandDialog>
  )
}
