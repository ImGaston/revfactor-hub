"use client"

import { useState } from "react"
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
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { Client, ClientCredential } from "@/lib/types"
import { resolveProfile } from "@/lib/types"
import { ClientCredentials } from "./client-credentials"
import { BreadcrumbSetter } from "@/components/layout/breadcrumb-context"

// Mock KPIs per listing — deterministic based on ID hash
function getMockListingKPIs(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0x7fffffff
  const occ30n = 55 + (hash % 40)             // 55–94%
  const adr = 180 + (hash % 280)              // 180–459
  const revpar = Math.round(adr * (occ30n / 100))
  const mpi = Number(((hash % 20) / 10 + 0.5).toFixed(1)) // 0.5–2.4
  return { occ30n, adr, revpar, mpi }
}

function ListingKPI({
  label,
  value,
  color,
  trend,
}: {
  label: string
  value: string
  color?: "green" | "amber" | "red"
  trend?: "up" | "down"
}) {
  const colorClass =
    color === "green"
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
        {trend === "up" && <span className="text-green-500 text-xs">↗</span>}
        {trend === "down" && <span className="text-red-500 text-xs">↘</span>}
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
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Building2 className="size-4" />
          Listings
          <span className="text-muted-foreground">
            ({client.listings.length})
          </span>
        </h3>
        <div className="mt-3 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {client.listings.map((listing) => {
            const mock = getMockListingKPIs(listing.id)
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
                  <ListingKPI label="OCC (30N)" value={`${mock.occ30n}%`} color={mock.occ30n >= 75 ? "green" : mock.occ30n >= 50 ? "amber" : "red"} />
                  <ListingKPI label="ADR" value={`$${mock.adr}`} />
                  <ListingKPI label="REVPAR" value={`$${mock.revpar}`} color={mock.revpar >= 200 ? "green" : undefined} />
                  <ListingKPI label="MPI" value={mock.mpi.toFixed(2)} color={mock.mpi >= 1 ? "green" : "red"} trend={mock.mpi >= 1 ? "up" : "down"} />
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
