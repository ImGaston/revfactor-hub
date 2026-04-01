"use client"

import { useState, useMemo } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { ClientCard } from "./client-card"
import { ClientDetail } from "./client-detail"
import type { Client } from "@/lib/types"
import { cn } from "@/lib/utils"

const statuses = ["active", "onboarding", "inactive"] as const

export function ClientsView({
  clients,
  isSuperAdmin,
}: {
  clients: Client[]
  isSuperAdmin: boolean
}) {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<Set<string>>(
    new Set(["active", "onboarding"])
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const isMobile = useIsMobile()

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return clients.filter((c) => {
      if (!statusFilter.has(c.status)) return false
      if (q && !c.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [clients, search, statusFilter])

  const selected = clients.find((c) => c.id === selectedId) ?? null

  function toggleStatus(status: string) {
    setStatusFilter((prev) => {
      const next = new Set(prev)
      if (next.has(status)) {
        next.delete(status)
      } else {
        next.add(status)
      }
      return next
    })
  }

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of clients) {
      counts[c.status] = (counts[c.status] || 0) + 1
    }
    return counts
  }, [clients])

  const listContent = (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-muted-foreground">
          {filtered.length} of {clients.length} clients
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
                statusFilter.has(s)
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-transparent bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {s}
              <span className="text-[10px] opacity-60">
                {statusCounts[s] || 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((client) => (
          <ClientCard
            key={client.id}
            client={client}
            isSelected={client.id === selectedId}
            isSuperAdmin={isSuperAdmin}
            onClick={() =>
              setSelectedId(client.id === selectedId ? null : client.id)
            }
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No clients match your filters.
        </p>
      )}
    </div>
  )

  return (
    <>
      {listContent}
      <Sheet
        open={!!selected}
        onOpenChange={(open) => !open && setSelectedId(null)}
      >
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={cn(
            "p-0",
            isMobile ? "h-[85vh]" : "w-[450px] sm:w-[450px] sm:max-w-none"
          )}
        >
          <SheetTitle className="sr-only">
            {selected?.name ?? "Client detail"}
          </SheetTitle>
          {selected && (
            <ClientDetail
              client={selected}
              isSuperAdmin={isSuperAdmin}
              onClose={() => setSelectedId(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
