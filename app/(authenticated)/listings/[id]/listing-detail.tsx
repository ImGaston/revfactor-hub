"use client"

import Link from "next/link"
import { useState } from "react"
import {
  ArrowLeft,
  ExternalLink,
  Building2,
  MapPin,
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart3,
  RefreshCw,
  Activity,
  CreditCard,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ChangeListingSubscriptionDialog,
  type ListingSubscriptionOption,
} from "./change-listing-subscription-dialog"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { ListingReport, ListingWithMetrics } from "@/lib/types"
import {
  ReportOverview,
  ReportMarket,
  ReportBookingWindow,
  ReportPacing,
} from "./listing-report-dashboard"

type ClientData = {
  id: string
  name: string
  status: string
} | null

const subscriptionStatusColors: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  canceled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  past_due: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  trialing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  incomplete: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
}

// ─── Helper Components ──────────────────────────────────────

function KPIMetric({
  label,
  value,
  badgeColor,
}: {
  label: string
  value: string
  badgeColor?: "green" | "amber" | "red" | "blue"
}) {
  const colorClasses = {
    red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800",
    amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
    green: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800",
    blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800",
  }

  return (
    <div className="flex flex-col items-center justify-center gap-2 px-3 py-4">
      <span className="text-sm font-medium text-muted-foreground text-center leading-tight">
        {label}
      </span>
      {badgeColor ? (
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-1 text-sm font-bold font-mono",
            colorClasses[badgeColor]
          )}
        >
          {value}
        </span>
      ) : (
        <span className="text-sm font-bold font-mono">{value}</span>
      )}
    </div>
  )
}

function KPICard({
  title,
  value,
  change,
  icon: Icon,
  prefix,
  suffix,
}: {
  title: string
  value: number | string
  change?: number
  icon: React.ElementType
  prefix?: string
  suffix?: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono">
          {prefix}
          {typeof value === "number" ? value.toLocaleString() : value}
          {suffix}
        </div>
        {change !== undefined && (
          <p
            className={cn(
              "text-xs flex items-center gap-0.5 mt-1",
              change >= 0
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            )}
          >
            {change >= 0 ? (
              <TrendingUp className="size-3" />
            ) : (
              <TrendingDown className="size-3" />
            )}
            {change >= 0 ? "+" : ""}
            {change}% vs last month
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Color based on listing occupancy vs market occupancy:
 * Red:    occ < 0.8 × market
 * Amber:  occ between 0.8 × market and market
 * Green:  occ between market and 1.2 × market
 * Blue:   occ > 1.2 × market
 */
function occColor(occ: number, marketOcc: number | null): "red" | "amber" | "green" | "blue" {
  if (marketOcc == null || marketOcc === 0) return occ > 0 ? "green" : "amber"
  if (occ > 1.2 * marketOcc) return "blue"
  if (occ >= marketOcc) return "green"
  if (occ >= 0.8 * marketOcc) return "amber"
  return "red"
}

// ─── Component ──────────────────────────────────────────────

export function ListingDetail({
  listing,
  client,
  report = null,
  canManageSubscription = false,
  currentSubscriptionId = null,
  subscriptionOptions = [],
  clientCustomerIds = [],
}: {
  listing: ListingWithMetrics
  client: ClientData
  report?: ListingReport | null
  canManageSubscription?: boolean
  currentSubscriptionId?: string | null
  subscriptionOptions?: ListingSubscriptionOption[]
  clientCustomerIds?: string[]
}) {
  const hasPLData = listing.pl_synced_at != null
  const [subDialogOpen, setSubDialogOpen] = useState(false)

  const currentSubscription = currentSubscriptionId
    ? subscriptionOptions.find((s) => s.id === currentSubscriptionId) ?? null
    : null

  return (
    <div className="space-y-6">
      {/* ─── Header ──────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" asChild className="mt-0.5">
            <Link href="/listings">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {listing.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-muted-foreground">
              {(listing.city || listing.state) && (
                <span className="flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {[listing.city, listing.state].filter(Boolean).join(", ")}
                </span>
              )}
              {client && (
                <Link
                  href={`/clients/${client.id}`}
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <Building2 className="size-3.5" />
                  {client.name}
                </Link>
              )}
              {listing.listing_id && (
                <span className="font-mono text-xs">
                  ID: {listing.listing_id}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {listing.airbnb_link && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={listing.airbnb_link}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="size-3.5 mr-1.5" />
                Airbnb
              </a>
            </Button>
          )}
          {listing.pricelabs_link && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={listing.pricelabs_link}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="size-3.5 mr-1.5" />
                PriceLabs
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* ─── Sync Status Banner ─────────────────────────── */}
      {hasPLData ? (
        <div className="rounded-lg border border-green-200 bg-green-50/50 dark:bg-green-950/20 dark:border-green-800 px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
            <RefreshCw className="size-3.5" />
            <span>
              PriceLabs data synced{" "}
              {new Date(listing.pl_synced_at!).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            {listing.pl_push_enabled && (
              <Badge variant="outline" className="text-[10px] ml-1 border-green-300 text-green-700 dark:text-green-400">
                Push ON
              </Badge>
            )}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            <strong>Preview:</strong> PriceLabs data has not been synced yet.
            Reservations, reviews, and pricing calendar show mockup data and will
            use real data once PMS and Airbnb integrations are connected.
          </p>
        </div>
      )}

      {/* ─── Subscription (super_admin only) ───────────── */}
      {canManageSubscription && (
        <div className="rounded-lg border px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <CreditCard className="size-4 text-muted-foreground shrink-0" />
            {currentSubscription ? (
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="text-sm font-medium truncate">
                  {currentSubscription.customerName ?? "Subscription"}
                </span>
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[10px]",
                    subscriptionStatusColors[currentSubscription.status] ?? ""
                  )}
                >
                  {currentSubscription.status}
                </Badge>
                <Link
                  href={`/financials/subscriptions/${currentSubscription.id}`}
                  className="text-xs text-muted-foreground font-mono hover:underline truncate"
                >
                  {currentSubscription.id}
                </Link>
              </div>
            ) : currentSubscriptionId ? (
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="text-xs text-muted-foreground font-mono truncate">
                  {currentSubscriptionId}
                </span>
                <Badge
                  variant="outline"
                  className="text-[10px] text-amber-700 border-amber-300 dark:text-amber-400"
                >
                  Not found in Stripe / canceled
                </Badge>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                No subscription linked
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSubDialogOpen(true)}
          >
            Change subscription
          </Button>
        </div>
      )}

      {canManageSubscription && (
        <ChangeListingSubscriptionDialog
          open={subDialogOpen}
          onOpenChange={setSubDialogOpen}
          listingId={listing.id}
          currentSubscriptionId={currentSubscriptionId}
          subscriptions={subscriptionOptions}
          clientCustomerIds={clientCustomerIds}
        />
      )}

      {/* ─── PriceLabs KPI Row ─────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="grid grid-cols-10 min-w-[900px] divide-x">
              <KPIMetric
                label="Base Price"
                value={listing.pl_base_price != null ? `$${listing.pl_base_price}` : "—"}
              />
              <KPIMetric
                label="Min Price"
                value={listing.pl_min_price != null ? `$${listing.pl_min_price}` : "—"}
              />
              <KPIMetric
                label="Occ (7N)"
                value={listing.pl_occupancy_next_7 != null ? `${listing.pl_occupancy_next_7}%` : "—"}
                badgeColor={listing.pl_occupancy_next_7 != null ? occColor(listing.pl_occupancy_next_7, listing.pl_market_occupancy_next_7) : undefined}
              />
              <KPIMetric
                label="Mkt Occ (7N)"
                value={listing.pl_market_occupancy_next_7 != null ? `${listing.pl_market_occupancy_next_7}%` : "—"}
              />
              <KPIMetric
                label="Occ (30N)"
                value={listing.pl_occupancy_next_30 != null ? `${listing.pl_occupancy_next_30}%` : "—"}
                badgeColor={listing.pl_occupancy_next_30 != null ? occColor(listing.pl_occupancy_next_30, listing.pl_market_occupancy_next_30) : undefined}
              />
              <KPIMetric
                label="Mkt Occ (30N)"
                value={listing.pl_market_occupancy_next_30 != null ? `${listing.pl_market_occupancy_next_30}%` : "—"}
              />
              <KPIMetric
                label="Wknd Occ (30N)"
                value={listing.pl_wknd_occupancy_next_30 != null ? `${listing.pl_wknd_occupancy_next_30}%` : "—"}
                badgeColor={listing.pl_wknd_occupancy_next_30 != null ? occColor(listing.pl_wknd_occupancy_next_30, listing.pl_market_wknd_occupancy_next_30) : undefined}
              />
              <KPIMetric
                label="Mkt Wknd (30N)"
                value={listing.pl_market_wknd_occupancy_next_30 != null ? `${listing.pl_market_wknd_occupancy_next_30}%` : "—"}
              />
              <KPIMetric
                label="MPI (30N)"
                value={listing.pl_mpi_next_30 != null ? String(listing.pl_mpi_next_30) : "—"}
                badgeColor={listing.pl_mpi_next_30 != null ? (listing.pl_mpi_next_30 >= 1.2 ? "blue" : listing.pl_mpi_next_30 >= 1 ? "green" : listing.pl_mpi_next_30 >= 0.8 ? "amber" : "red") : undefined}
              />
              <KPIMetric
                label="Last Booked"
                value={listing.pl_last_booked_date ? new Date(listing.pl_last_booked_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Secondary KPI Cards ─────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Base Price"
          value={listing.pl_base_price ?? "—"}
          icon={DollarSign}
          prefix={listing.pl_base_price != null ? "$" : ""}
        />
        <KPICard
          title="Recommended Price"
          value={listing.pl_recommended_base_price ?? "—"}
          icon={BarChart3}
          prefix={listing.pl_recommended_base_price != null ? "$" : ""}
        />
        <KPICard
          title="MPI (60N)"
          value={listing.pl_mpi_next_60 ?? "—"}
          icon={Activity}
        />
        <KPICard
          title="Occ 90N"
          value={listing.pl_occupancy_past_90 ?? "—"}
          icon={TrendingUp}
          suffix={listing.pl_occupancy_past_90 != null ? "%" : ""}
        />
      </div>

      {/* ─── Tabs ────────────────────────────────────────── */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="market">Market Position</TabsTrigger>
          <TabsTrigger value="window">Booking Window</TabsTrigger>
          <TabsTrigger value="pacing">Pacing</TabsTrigger>
        </TabsList>

        {/* ─── Overview Tab (Report Builder) ───────────────── */}
        <TabsContent value="overview" className="space-y-4">
          <ReportOverview report={report} />
        </TabsContent>

        {/* ─── Market Position Tab ─────────────────────────── */}
        <TabsContent value="market" className="space-y-4">
          <ReportMarket report={report} />
        </TabsContent>

        {/* ─── Booking Window Tab ──────────────────────────── */}
        <TabsContent value="window" className="space-y-4">
          <ReportBookingWindow report={report} />
        </TabsContent>

        {/* ─── Pacing Tab (Report Builder) ─────────────────── */}
        <TabsContent value="pacing" className="space-y-4">
          <ReportPacing report={report} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
