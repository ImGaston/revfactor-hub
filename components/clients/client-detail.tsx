"use client"

import {
  ExternalLink,
  Mail,
  Calendar,
  CreditCard,
  Building2,
  CheckSquare,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Client } from "@/lib/types"
import { resolveProfile } from "@/lib/types"

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

export function ClientDetail({
  client,
  isSuperAdmin,
  onClose,
}: {
  client: Client
  isSuperAdmin: boolean
  onClose: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 p-4 pb-0">
        <div>
          <h2 className="text-lg font-semibold">{client.name}</h2>
          <Badge
            variant={statusVariant[client.status] ?? "outline"}
            className="mt-1"
          >
            {client.status}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="size-8">
          <X className="size-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4">
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

          <div className="flex gap-2">
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
            {client.assembly_link && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={client.assembly_link}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Assembly
                  <ExternalLink className="ml-1 size-3" />
                </a>
              </Button>
            )}
          </div>
        </div>

        {client.tasks.filter((t) => t.status !== "done").length > 0 && (
          <>
            <Separator className="my-4" />
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

        <Separator className="my-4" />

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
                className="rounded-md border p-3 text-sm"
              >
                <p className="font-medium leading-tight">{listing.name}</p>
                {(listing.city || listing.state) && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[listing.city, listing.state].filter(Boolean).join(", ")}
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  {listing.airbnb_link && listing.airbnb_link !== "https://www.airbnb.com/rooms/" && (
                    <a
                      href={listing.airbnb_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Airbnb <ExternalLink className="inline size-2.5" />
                    </a>
                  )}
                  {listing.pricelabs_link && (
                    <a
                      href={listing.pricelabs_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      PriceLabs <ExternalLink className="inline size-2.5" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
