"use client"

import { Building2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { Client } from "@/lib/types"
import { cn } from "@/lib/utils"

const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  onboarding: "secondary",
  inactive: "outline",
}

export function ClientCard({
  client,
  isSelected,
  isSuperAdmin: _isSuperAdmin,
  onClick,
}: {
  client: Client
  isSelected: boolean
  isSuperAdmin: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border p-4 text-left transition-colors hover:bg-accent/50",
        isSelected && "border-primary bg-accent/50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium leading-tight">{client.name}</h3>
        <Badge variant={statusVariant[client.status] ?? "outline"}>
          {client.status}
        </Badge>
      </div>
      <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <Building2 className="size-3.5" />
          {client.listings.length} {client.listings.length === 1 ? "listing" : "listings"}
        </span>
      </div>
    </button>
  )
}
