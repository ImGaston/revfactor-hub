"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import {
  ExternalLink,
  Mail,
  Calendar,
  CreditCard,
  Building2,
  CheckSquare,
  ArrowLeft,
  Link2,
  Unlink,
  MessageSquare,
  Users,
  Loader2,
  MapPin,
  ArrowUpDown,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Client, ClientCredential, Listing } from "@/lib/types"
import { resolveProfile } from "@/lib/types"
import { ClientCredentials } from "./client-credentials"
import { BreadcrumbSetter } from "@/components/layout/breadcrumb-context"

/**
 * Color based on listing occupancy vs market occupancy:
 * Red:    occ < 0.8 × market
 * Amber:  occ between 0.8 × market and market
 * Green:  occ between market and 1.2 × market
 * Blue:   occ > 1.2 × market
 */
function occColor(occ: number, marketOcc: number | null): "green" | "amber" | "red" | "blue" {
  if (marketOcc == null || marketOcc === 0) return occ > 0 ? "green" : "amber"
  if (occ > 1.2 * marketOcc) return "blue"
  if (occ >= marketOcc) return "green"
  if (occ >= 0.8 * marketOcc) return "amber"
  return "red"
}

type SortOption = "name" | "occ7n" | "occ30n" | "mpi30n" | "last_booked"

function sortListings(listings: Listing[], sort: SortOption, dir: "asc" | "desc"): Listing[] {
  const sorted = [...listings].sort((a, b) => {
    switch (sort) {
      case "name":
        return a.name.localeCompare(b.name)
      case "occ7n":
        return (a.pl_occupancy_next_7 ?? -1) - (b.pl_occupancy_next_7 ?? -1)
      case "occ30n":
        return (a.pl_occupancy_next_30 ?? -1) - (b.pl_occupancy_next_30 ?? -1)
      case "mpi30n":
        return (a.pl_mpi_next_30 ?? -1) - (b.pl_mpi_next_30 ?? -1)
      case "last_booked": {
        const da = a.pl_last_booked_date ? new Date(a.pl_last_booked_date).getTime() : 0
        const db = b.pl_last_booked_date ? new Date(b.pl_last_booked_date).getTime() : 0
        return da - db
      }
      default:
        return 0
    }
  })
  return dir === "desc" ? sorted.reverse() : sorted
}

function ListingKPI({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: "green" | "amber" | "red" | "blue"
}) {
  const colorClass =
    color === "blue"
      ? "text-blue-600 dark:text-blue-400"
      : color === "green"
        ? "text-green-600 dark:text-green-400"
        : color === "amber"
          ? "text-amber-600 dark:text-amber-400"
          : color === "red"
            ? "text-red-600 dark:text-red-400"
            : "text-foreground"
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={`text-base font-bold font-mono flex items-center gap-1 ${colorClass}`}>
        {value}
      </span>
    </div>
  )
}

const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  onboarding: "secondary",
  inactive: "outline",
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div>
        <p className="text-muted-foreground">{label}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  )
}

function formatDate(date: string | null) {
  if (!date) return "—"
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function ClientDetailPage({
  client,
  credentials = [],
  isSuperAdmin,
  assemblyConfigured,
  onLinkAssembly,
  onUnlinkAssembly,
}: {
  client: Client
  credentials?: ClientCredential[]
  isSuperAdmin: boolean
  assemblyConfigured: boolean
  onLinkAssembly?: (clientId: string) => Promise<{ error: string | null }>
  onUnlinkAssembly?: (clientId: string) => Promise<{ error: string | null }>
}) {
  const [linking, setLinking] = useState(false)
  const [sortBy, setSortBy] = useState<SortOption>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  const sortedListings = useMemo(
    () => sortListings(client.listings, sortBy, sortDir),
    [client.listings, sortBy, sortDir]
  )
  const isLinked = !!client.assembly_client_id

  async function handleLink() {
    if (!onLinkAssembly) return
    setLinking(true)
    const result = await onLinkAssembly(client.id)
    setLinking(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Linked to Assembly")
    }
  }

  async function handleUnlink() {
    if (!onUnlinkAssembly) return
    setLinking(true)
    const result = await onUnlinkAssembly(client.id)
    setLinking(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Unlinked from Assembly")
    }
  }

  return (
    <div className="space-y-6">
      <BreadcrumbSetter segment={client.id} label={client.name} />
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/clients">
            <ArrowLeft className="mr-1 size-4" />
            Back to clients
          </Link>
        </Button>

        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {client.name}
          </h1>
          <Badge
            variant={statusVariant[client.status] ?? "outline"}
          >
            {client.status}
          </Badge>
        </div>
      </div>

      <div className="space-y-4">
        {client.email && (
          <InfoRow icon={Mail} label="Email">
            <span>{client.email}</span>
          </InfoRow>
        )}

        {isSuperAdmin && (
          <InfoRow icon={CreditCard} label="Billing">
            <span className="font-mono">
              {client.billing_amount
                ? `$${Number(client.billing_amount).toLocaleString()}/mo`
                : "—"}
            </span>
            {client.autopayment_set_up && (
              <Badge variant="secondary" className="ml-2">
                Autopay
              </Badge>
            )}
          </InfoRow>
        )}

        <InfoRow icon={Calendar} label="Contract">
          <span>
            {formatDate(client.onboarding_date)} — {formatDate(client.ending_date)}
          </span>
        </InfoRow>

        <div className="flex flex-wrap gap-2">
          {isSuperAdmin && client.stripe_dashboard && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={client.stripe_dashboard}
                target="_blank"
                rel="noopener noreferrer"
              >
                Stripe
                <ExternalLink className="ml-1 size-3" />
              </a>
            </Button>
          )}
          {isLinked && client.assembly_link && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={client.assembly_link}
                target="_blank"
                rel="noopener noreferrer"
              >
                {client.assembly_company_id ? (
                  <Users className="mr-1 size-3" />
                ) : (
                  <MessageSquare className="mr-1 size-3" />
                )}
                {client.assembly_company_id ? "Company Chat" : "Messages"}
                <ExternalLink className="ml-1 size-3" />
              </a>
            </Button>
          )}
          {isLinked && client.assembly_company_id && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={`https://dashboard.assembly.com/clients/users/details/${client.assembly_client_id}/messages`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageSquare className="mr-1 size-3" />
                Direct Chat
                <ExternalLink className="ml-1 size-3" />
              </a>
            </Button>
          )}
          {assemblyConfigured && !isLinked && client.email && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLink}
              disabled={linking}
            >
              {linking ? (
                <Loader2 className="mr-1 size-3 animate-spin" />
              ) : (
                <Link2 className="mr-1 size-3" />
              )}
              Link to Assembly
            </Button>
          )}
          {isLinked && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleUnlink}
              disabled={linking}
              className="text-muted-foreground"
            >
              <Unlink className="mr-1 size-3" />
              Unlink
            </Button>
          )}
        </div>
      </div>

      {client.tasks.filter((t) => t.status !== "done").length > 0 && (
        <>
          <Separator />
          <div>
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <CheckSquare className="size-4" />
              Open Tasks
              <span className="text-muted-foreground">
                ({client.tasks.filter((t) => t.status !== "done").length})
              </span>
            </h3>
            <div className="mt-3 space-y-1.5">
              {client.tasks
                .filter((t) => t.status !== "done")
                .map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between rounded-md border p-2.5 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="size-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            task.status === "in_progress"
                              ? "#3b82f6"
                              : task.status === "waiting"
                                ? "#f59e0b"
                                : "#6b7280",
                        }}
                      />
                      <span className="truncate">{task.title}</span>
                    </div>
                    <div className="flex shrink-0 gap-1.5 ml-2">
                      {task.owner && (() => {
                        const p = resolveProfile(task.profiles)
                        return (
                          <Badge variant="outline" className="text-[10px]">
                            {p?.full_name || p?.email || task.owner}
                          </Badge>
                        )
                      })()}
                      {task.tag && (
                        <Badge variant="secondary" className="text-[10px]">
                          {task.tag}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}

      <Separator />

      <ClientCredentials clientId={client.id} credentials={credentials} />

      <Separator />

      <div>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Building2 className="size-4" />
            Listings
            <span className="text-muted-foreground">
              ({client.listings.length})
            </span>
          </h3>
          {client.listings.length > 1 && (
            <div className="flex items-center gap-2">
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <ArrowUpDown className="mr-1 size-3" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="occ7n">Occ (7N)</SelectItem>
                  <SelectItem value="occ30n">Occ (30N)</SelectItem>
                  <SelectItem value="mpi30n">MPI (30N)</SelectItem>
                  <SelectItem value="last_booked">Last Booked</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                title={sortDir === "asc" ? "Ascending" : "Descending"}
              >
                <span className="text-xs font-mono">{sortDir === "asc" ? "↑" : "↓"}</span>
              </Button>
            </div>
          )}
        </div>
        <div className="mt-3 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {sortedListings.map((listing) => {
            const location = [listing.city, listing.state].filter(Boolean).join(", ")
            return (
              <Link
                key={listing.id}
                href={`/listings/${listing.id}`}
                className="block rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50 hover:shadow-sm"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-semibold leading-tight">
                      {listing.name}
                    </p>
                    {location && (
                      <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="size-3.5 shrink-0" />
                        <span>{location}</span>
                        {listing.airbnb_link && listing.airbnb_link !== "https://www.airbnb.com/rooms/" && (
                          <span
                            onClick={(e) => {
                              e.preventDefault()
                              window.open(listing.airbnb_link!, "_blank")
                            }}
                            className="opacity-60 hover:opacity-100 transition-opacity cursor-pointer ml-0.5"
                            title="Airbnb"
                          >
                            <img src="/airbnb-logo.webp" alt="Airbnb" className="size-4 rounded" />
                          </span>
                        )}
                        {listing.pricelabs_link && (
                          <span
                            onClick={(e) => {
                              e.preventDefault()
                              window.open(listing.pricelabs_link!, "_blank")
                            }}
                            className="opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
                            title="PriceLabs"
                          >
                            <img src="/Pricelabs-Logo.webp" alt="PriceLabs" className="size-4 rounded" />
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Divider */}
                <div className="my-3 border-t" />

                {/* KPIs */}
                <div className="grid grid-cols-4 gap-x-6">
                  <ListingKPI
                    label="Occ (7N)"
                    value={listing.pl_occupancy_next_7 != null ? `${listing.pl_occupancy_next_7}%` : "—"}
                    color={listing.pl_occupancy_next_7 != null ? occColor(listing.pl_occupancy_next_7, listing.pl_market_occupancy_next_7) : undefined}
                  />
                  <ListingKPI
                    label="Occ (30N)"
                    value={listing.pl_occupancy_next_30 != null ? `${listing.pl_occupancy_next_30}%` : "—"}
                    color={listing.pl_occupancy_next_30 != null ? occColor(listing.pl_occupancy_next_30, listing.pl_market_occupancy_next_30) : undefined}
                  />
                  <ListingKPI
                    label="MPI (30N)"
                    value={listing.pl_mpi_next_30 != null ? String(listing.pl_mpi_next_30) : "—"}
                    color={listing.pl_mpi_next_30 != null ? (listing.pl_mpi_next_30 >= 1.2 ? "blue" : listing.pl_mpi_next_30 >= 1 ? "green" : listing.pl_mpi_next_30 >= 0.8 ? "amber" : "red") : undefined}
                  />
                  <ListingKPI
                    label="Last Booked"
                    value={listing.pl_last_booked_date ? new Date(listing.pl_last_booked_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                  />
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
