"use client"

import Link from "next/link"
import { Building2 } from "lucide-react"
import type { ClientListItem } from "@/lib/types"
import { StatusBadge } from "@/components/status-badge"

export function ClientCard({
  client,
  isSuperAdmin: _isSuperAdmin,
}: {
  client: ClientListItem
  isSuperAdmin: boolean
}) {
  return (
    <Link
      href={`/clients/${client.id}`}
      className="block w-full rounded-lg border p-4 text-left transition-colors hover:bg-accent/50"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium leading-tight">{client.name}</h3>
        <StatusBadge status={client.status} />
      </div>
      <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <Building2 className="size-3.5" />
          {client.listings.length} {client.listings.length === 1 ? "listing" : "listings"}
        </span>
      </div>
    </Link>
  )
}
