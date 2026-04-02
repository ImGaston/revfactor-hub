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
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { Client } from "@/lib/types"
import { resolveProfile } from "@/lib/types"
import { BreadcrumbSetter } from "@/components/layout/breadcrumb-context"

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
  isSuperAdmin,
  assemblyConfigured,
  onLinkAssembly,
  onUnlinkAssembly,
}: {
  client: Client
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

      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Building2 className="size-4" />
          Listings
          <span className="text-muted-foreground">
            ({client.listings.length})
          </span>
        </h3>
        <div className="mt-3 space-y-2">
          {client.listings.map((listing) => (
            <div
              key={listing.id}
              className="relative rounded-md border p-3 text-sm"
            >
              <div className="absolute top-2 right-2 flex items-center gap-1.5">
                {listing.airbnb_link && listing.airbnb_link !== "https://www.airbnb.com/rooms/" && (
                  <a
                    href={listing.airbnb_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="opacity-60 hover:opacity-100 transition-opacity"
                    title="Airbnb"
                  >
                    <img
                      src="/airbnb-logo.webp"
                      alt="Airbnb"
                      className="size-5 rounded"
                    />
                  </a>
                )}
                {listing.pricelabs_link && (
                  <a
                    href={listing.pricelabs_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="opacity-60 hover:opacity-100 transition-opacity"
                    title="PriceLabs"
                  >
                    <img
                      src="/Pricelabs-Logo.webp"
                      alt="PriceLabs"
                      className="size-5 rounded"
                    />
                  </a>
                )}
              </div>
              <p className="font-medium leading-tight pr-14">{listing.name}</p>
              {(listing.city || listing.state) && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[listing.city, listing.state].filter(Boolean).join(", ")}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
