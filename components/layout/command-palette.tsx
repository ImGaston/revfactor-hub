"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { useRouter, usePathname } from "next/navigation"
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

  // Load recents on mount (avoids hydration mismatch)
  useEffect(() => {
    setRecentIds(getRecentIds())
  }, [])

  // Reset search when dialog closes
  useEffect(() => {
    if (!open) setSearch("")
  }, [open])

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
  const isSuperAdmin = profile?.role === "super_admin"
  const visibleCommands = useMemo(
    () => filterCommandsByPermission(commands, permissionMap, isSuperAdmin ?? false),
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
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
